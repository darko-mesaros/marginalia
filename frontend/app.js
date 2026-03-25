// ── Marginalia Frontend ──
// Core application state and rendering logic

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  conversation: {
    id: null,                         // Active conversation ID
    title: "Untitled Conversation",   // Active conversation title
    mainThread: [],     // [{id, role, content, toolInvocations}]
    sideThreads: [],    // [{id, anchor, messages, collapsed}]
  },
  conversationList: [],   // ConversationSummary[] cache
  settings: {
    systemPrompt: "",
    skillFiles: [],     // [{id, name, order}]
    mcpServers: [],     // [{id, name, command, args, enabled}]
  },
  ui: {
    loading: false,
    activeStreams: new Set(),
    selectedText: null,
    settingsOpen: false,
  },
};

// ---------------------------------------------------------------------------
// Configure marked.js with highlight.js
// ---------------------------------------------------------------------------
(function configureMarked() {
  if (typeof marked === "undefined") return;

  marked.setOptions({
    highlight(code, lang) {
      if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      if (typeof hljs !== "undefined") {
        return hljs.highlightAuto(code).value;
      }
      return code;
    },
    breaks: false,
    gfm: true,
  });
})();

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
const contentArea = document.getElementById("content-area");
const questionInput = document.getElementById("question-input");
const askBtn = document.getElementById("ask-btn");
const mainPanel = document.getElementById("main-panel");
const marginNotePanel = document.getElementById("margin-note-panel");
const continuationInput = document.getElementById("continuation-input");
const continueBtn = document.getElementById("continue-btn");
const newConversationBtn = document.getElementById("new-conversation-btn");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize HTML through DOMPurify (falls back to raw html if unavailable). */
function sanitize(html) {
  if (typeof DOMPurify !== "undefined") {
    return DOMPurify.sanitize(html);
  }
  return html;
}

/** Render markdown string to sanitized HTML. */
function renderMarkdown(md) {
  const raw = marked.parse(md);
  return sanitize(raw);
}

/** Generate a simple unique id (fallback when crypto.randomUUID unavailable). */
function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * Format an ISO 8601 date string as a human-readable relative timestamp.
 * @param {string} dateString — ISO 8601 date string
 * @param {Date} [now=new Date()] — reference time (for testability)
 * @returns {string}
 */
function formatRelativeTime(dateString, now) {
  if (!now) now = new Date();
  const then = new Date(dateString);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;
  }

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return diffHr === 1 ? "1 hour ago" : `${diffHr} hours ago`;
  }

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) {
    return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`;
  }

  // ≥30 days — short date
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months[then.getMonth()];
  const day = then.getDate();
  if (then.getFullYear() === now.getFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${then.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// InputBar logic
// ---------------------------------------------------------------------------

function disableInputBar() {
  questionInput.disabled = true;
  askBtn.disabled = true;
}

function handleAskSubmit() {
  const question = questionInput.value.trim();
  if (!question) return;

  disableInputBar();
  submitQuestion(question);
}

// Wire up InputBar events
askBtn.addEventListener("click", handleAskSubmit);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleAskSubmit();
  }
});

// ---------------------------------------------------------------------------
// Sidebar toggle logic
// ---------------------------------------------------------------------------

function toggleSidebar() {
  const isOpen = contentArea.classList.toggle("sidebar-open");
  sidebarToggleBtn.setAttribute(
    "aria-label",
    isOpen ? "Close conversation library" : "Open conversation library"
  );
  if (isOpen) {
    fetchConversationList();
  }
  markConnectorsDirty();
}

sidebarToggleBtn.addEventListener("click", toggleSidebar);

// ---------------------------------------------------------------------------
// Conversation list fetching and rendering
// ---------------------------------------------------------------------------

/**
 * Fetch conversation summaries from the API and render them in the sidebar.
 * Stores the result in state.conversationList for caching.
 */
async function fetchConversationList() {
  try {
    const res = await fetch("/api/conversations");
    if (!res.ok) {
      throw new Error(`Failed to load conversations (${res.status})`);
    }
    const summaries = await res.json();
    state.conversationList = summaries;
    renderConversationList();
  } catch (err) {
    state.conversationList = [];
    const listEl = document.getElementById("conversation-list");
    listEl.innerHTML = "";
    const errorEl = document.createElement("div");
    errorEl.style.cssText = "color: #c62828; background: #ffebee; border-radius: 4px; padding: 12px; margin: 8px;";
    errorEl.textContent = err.message || "Failed to load conversations";
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.textContent = "Retry";
    retryBtn.style.cssText = "margin-top: 8px; cursor: pointer;";
    retryBtn.addEventListener("click", fetchConversationList);
    errorEl.appendChild(retryBtn);
    listEl.appendChild(errorEl);
  }
}

/**
 * Render the cached conversation list into the #conversation-list element.
 * Highlights the active conversation entry if one matches state.conversation.id.
 */
function renderConversationList() {
  const listEl = document.getElementById("conversation-list");
  listEl.innerHTML = "";

  const summaries = state.conversationList || [];

  if (summaries.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.style.cssText = "color: var(--color-text-secondary, #888); padding: 12px; text-align: center;";
    placeholder.textContent = "No saved conversations";
    listEl.appendChild(placeholder);
    return;
  }

  const activeId = state.conversation && state.conversation.id;

  for (const summary of summaries) {
    const btn = document.createElement("button");
    btn.className = "conversation-entry";
    btn.type = "button";
    btn.setAttribute("data-id", summary.id);

    if (summary.id === activeId) {
      btn.classList.add("active");
    }

    const titleSpan = document.createElement("span");
    titleSpan.className = "conversation-entry-title";
    titleSpan.textContent = summary.title || "Untitled Conversation";

    const timeSpan = document.createElement("span");
    timeSpan.className = "conversation-entry-time";
    timeSpan.textContent = formatRelativeTime(summary.updatedAt);

    btn.appendChild(titleSpan);
    btn.appendChild(timeSpan);

    btn.addEventListener("click", () => {
      loadConversation(summary.id);
    });

    listEl.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// New conversation creation and title helpers
// ---------------------------------------------------------------------------

/**
 * Update the conversation title display element.
 * @param {string} title
 */
function updateConversationTitle(title) {
  document.getElementById("conversation-title").textContent = title;
}

/**
 * Create a new conversation via the API and reset the UI to a clean state.
 * On failure, shows an error without clearing the current conversation.
 */
async function handleNewConversation() {
  try {
    const res = await fetch("/api/conversations/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      throw new Error(`Failed to create conversation (${res.status})`);
    }

    const data = await res.json();

    // Clear panels
    mainPanel.innerHTML = "";
    marginNotePanel.innerHTML = "";
    document.getElementById("continuation-area").classList.remove("visible");

    // Reset state
    state.conversation = {
      id: data.id,
      title: "Untitled Conversation",
      mainThread: [],
      sideThreads: [],
    };

    // Update title display
    updateConversationTitle("Untitled Conversation");

    // Clear anchor highlights
    anchorRanges.length = 0;
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete("marginalia-anchors");
      // Clear per-thread highlights
      for (const key of CSS.highlights.keys()) {
        if (key.startsWith("marginalia-anchor-")) CSS.highlights.delete(key);
      }
    }
    // Clear dynamic highlight style rules
    if (highlightStyleEl && highlightStyleEl.sheet) {
      while (highlightStyleEl.sheet.cssRules.length > 0) {
        highlightStyleEl.sheet.deleteRule(0);
      }
    }

    // Re-enable and focus input
    questionInput.disabled = false;
    askBtn.disabled = false;
    questionInput.value = "";
    questionInput.focus();

    // Refresh sidebar list
    fetchConversationList();
  } catch (err) {
    // Show error in sidebar without clearing current conversation
    const listEl = document.getElementById("conversation-list");
    const errorEl = document.createElement("div");
    errorEl.style.cssText = "color: #c62828; background: #ffebee; border-radius: 4px; padding: 12px; margin: 8px;";
    errorEl.textContent = err.message || "Failed to create new conversation";
    listEl.prepend(errorEl);
  }
}

// Wire click event on New Conversation button
newConversationBtn.addEventListener("click", handleNewConversation);

// ---------------------------------------------------------------------------
// Load conversation
// ---------------------------------------------------------------------------

/**
 * Show an inline error message in the main panel.
 * @param {string} message
 */
function showLoadError(message) {
  const errorEl = document.createElement("div");
  errorEl.className = "error-message";
  errorEl.style.cssText = "color: #c62828; padding: 12px; background: #ffebee; border-radius: 6px; margin-top: 8px;";
  errorEl.textContent = message;
  mainPanel.appendChild(errorEl);
}

/**
 * Load a saved conversation by ID and re-render the main panel.
 * Handles 404 (stale entry) and other errors gracefully.
 * NOTE: Side thread re-rendering (task 5.2) and anchor highlights (task 5.3) will be added later.
 * @param {string} id
 */
async function loadConversation(id) {
  try {
    const res = await fetch(`/api/conversations/${id}`);

    if (res.status === 404) {
      showLoadError("Conversation not found");
      fetchConversationList();
      return;
    }

    if (!res.ok) {
      throw new Error(`Failed to load conversation (${res.status})`);
    }

    const data = await res.json();

    // Replace state
    state.conversation = {
      id: data.id,
      title: data.title || "Untitled Conversation",
      mainThread: data.mainThread || [],
      sideThreads: data.sideThreads || [],
    };

    // Update title
    updateConversationTitle(state.conversation.title);

    // Clear and re-render main panel
    mainPanel.innerHTML = "";

    let isFirstUser = true;
    for (const msg of state.conversation.mainThread) {
      if (msg.role === "user") {
        // Show <hr> divider for subsequent user messages (not the first)
        if (!isFirstUser) {
          const divider = document.createElement("hr");
          divider.className = "continuation-divider";
          mainPanel.appendChild(divider);
        }
        isFirstUser = false;

        const questionDiv = document.createElement("div");
        questionDiv.style.cssText = "font-weight: 600; margin-bottom: 12px; color: var(--color-text-secondary);";
        questionDiv.textContent = msg.content;
        mainPanel.appendChild(questionDiv);
      } else if (msg.role === "assistant") {
        const section = document.createElement("section");
        section.setAttribute("data-message-id", msg.id);
        section.innerHTML = renderMarkdown(msg.content);
        mainPanel.appendChild(section);
      }
    }

    // Show/hide continuation area
    const hasAssistant = state.conversation.mainThread.some(m => m.role === "assistant");
    const continuationArea = document.getElementById("continuation-area");
    if (hasAssistant) {
      continuationArea.classList.add("visible");
    } else {
      continuationArea.classList.remove("visible");
    }

    // Re-enable input
    questionInput.disabled = false;
    askBtn.disabled = false;

    // Refresh sidebar to highlight active conversation
    renderConversationList();

    // Clear and re-render side threads as margin notes
    marginNotePanel.innerHTML = "";

    for (let threadIdx = 0; threadIdx < state.conversation.sideThreads.length; threadIdx++) {
      const thread = state.conversation.sideThreads[threadIdx];
      // Find first user message and last assistant message
      const userMsg = thread.messages.find(m => m.role === "user");
      if (!userMsg) continue;

      const noteUI = renderMarginNote({
        selectedText: thread.anchor.selectedText,
        question: userMsg.content,
        anchorMessageId: thread.anchor.messageId,
        colorIndex: threadIdx,
      });

      // Remove loading indicator and fill in content
      removeMarginNoteLoading(noteUI.responseEl);

      // Find the first assistant response
      const firstAssistant = thread.messages.find(m => m.role === "assistant");
      if (firstAssistant) {
        noteUI.responseEl.innerHTML = renderMarkdown(firstAssistant.content);
      }

      // Set thread ID for follow-up wiring
      noteUI.el.dataset.threadId = thread.id;

      // Render any follow-up Q&A pairs (messages beyond the first user+assistant pair)
      const followUpMessages = thread.messages.slice(2); // skip first user + first assistant
      for (let i = 0; i < followUpMessages.length; i += 2) {
        const followUpQ = followUpMessages[i];
        const followUpA = followUpMessages[i + 1];

        if (followUpQ && followUpQ.role === "user") {
          const qEl = document.createElement("div");
          qEl.className = "margin-note-question";
          qEl.textContent = followUpQ.content;
          noteUI.bodyEl.appendChild(qEl);
        }

        if (followUpA && followUpA.role === "assistant") {
          const aEl = document.createElement("div");
          aEl.className = "margin-note-response";
          aEl.innerHTML = renderMarkdown(followUpA.content);
          noteUI.bodyEl.appendChild(aEl);
        }
      }
    }

    // Clear stale anchor highlights from previous conversation
    anchorRanges.length = 0;
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete("marginalia-anchors");
      // Clear per-thread highlights
      for (const key of CSS.highlights.keys()) {
        if (key.startsWith("marginalia-anchor-")) CSS.highlights.delete(key);
      }
    }
    // Clear dynamic highlight style rules
    if (highlightStyleEl && highlightStyleEl.sheet) {
      while (highlightStyleEl.sheet.cssRules.length > 0) {
        highlightStyleEl.sheet.deleteRule(0);
      }
    }

    // Re-apply highlights for each side thread
    for (let i = 0; i < state.conversation.sideThreads.length; i++) {
      const thread = state.conversation.sideThreads[i];
      highlightAnchor(
        thread.anchor.messageId,
        thread.anchor.startOffset,
        thread.anchor.endOffset,
        i
      );
    }

    // Redraw connector lines after all notes and highlights are rendered
    markConnectorsDirty();

  } catch (err) {
    // On non-404 error: show error, don't modify current state
    showLoadError(err.message || "Failed to load conversation");
  }
}

// ---------------------------------------------------------------------------
// MainPanel rendering
// ---------------------------------------------------------------------------

/**
 * Create a new section element for a response in the MainPanel.
 * @param {string} messageId
 * @returns {HTMLElement}
 */
function createResponseSection(messageId) {
  const section = document.createElement("section");
  section.setAttribute("data-message-id", messageId);
  mainPanel.appendChild(section);
  return section;
}

/**
 * Show a loading indicator inside a section.
 * @param {HTMLElement} section
 */
function showLoading(section) {
  const indicator = document.createElement("span");
  indicator.className = "loading-indicator";
  indicator.setAttribute("aria-label", "Loading response");
  section.appendChild(indicator);
}

/**
 * Remove the loading indicator from a section.
 * @param {HTMLElement} section
 */
function removeLoading(section) {
  const indicator = section.querySelector(".loading-indicator");
  if (indicator) indicator.remove();
}

/**
 * Display an error message inside a section.
 * @param {HTMLElement} section
 * @param {string} message
 */
function showError(section, message) {
  removeLoading(section);
  const errorEl = document.createElement("div");
  errorEl.className = "error-message";
  errorEl.style.cssText = "color: #c62828; padding: 12px; background: #ffebee; border-radius: 6px; margin-top: 8px;";
  errorEl.textContent = message;
  section.appendChild(errorEl);
}

// ---------------------------------------------------------------------------
// SSE streaming via fetch (POST endpoints require fetch, not EventSource)
// ---------------------------------------------------------------------------

/**
 * Parse a single SSE line chunk and return {event, data} or null.
 * Handles the standard SSE text format:
 *   event: <type>\n
 *   data: <json>\n\n
 */
function parseSSE(raw) {
  const events = [];
  const blocks = raw.split("\n\n");

  for (const block of blocks) {
    if (!block.trim()) continue;

    let eventType = "message";
    let dataLines = [];

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length > 0) {
      const dataStr = dataLines.join("\n");
      try {
        events.push({ event: eventType, data: JSON.parse(dataStr) });
      } catch {
        events.push({ event: eventType, data: dataStr });
      }
    }
  }

  return events;
}

/**
 * Submit a question to the backend and stream the response into the MainPanel.
 * @param {string} question
 */
async function submitQuestion(question) {
  state.ui.loading = true;

  // Add user message to state
  const userMsgId = uid();
  state.conversation.mainThread.push({
    id: userMsgId,
    role: "user",
    content: question,
    toolInvocations: [],
  });

  // Create a placeholder section with a temporary id; will be updated on `done`
  const tempId = uid();
  const section = createResponseSection(tempId);
  showLoading(section);

  let accumulatedContent = "";

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const errText = await response.text();
      showError(section, `Request failed (${response.status}): ${errText}`);
      state.ui.loading = false;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE blocks (separated by double newline)
      const parts = buffer.split("\n\n");
      // Keep the last (possibly incomplete) chunk in the buffer
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;

        const events = parseSSE(part + "\n\n");
        for (const evt of events) {
          switch (evt.event) {
            case "token": {
              removeLoading(section);
              accumulatedContent += evt.data.content || "";
              section.innerHTML = renderMarkdown(accumulatedContent);
              break;
            }

            case "tool_use": {
              removeLoading(section);
              // Append tool invocation info to the accumulated content
              const toolInfo = `\n\n🔧 Used ${evt.data.tool_name}\n\n`;
              accumulatedContent += toolInfo;
              section.innerHTML = renderMarkdown(accumulatedContent);
              break;
            }

            case "title": {
              const title = evt.data.title;
              if (title) {
                state.conversation.title = title;
                updateConversationTitle(title);
              }
              break;
            }

            case "done": {
              removeLoading(section);
              const messageId = evt.data.message_id || tempId;
              section.setAttribute("data-message-id", messageId);

              // Store assistant message in state
              state.conversation.mainThread.push({
                id: messageId,
                role: "assistant",
                content: accumulatedContent,
                toolInvocations: [],
              });

              // Final render pass
              section.innerHTML = renderMarkdown(accumulatedContent);

              // Show continuation input if it exists
              const continuationArea = document.getElementById("continuation-area");
              if (continuationArea) {
                continuationArea.classList.add("visible");
              }
              fetchConversationList();
              break;
            }

            case "error": {
              const errMsg = evt.data.message || evt.data || "An error occurred";
              showError(section, errMsg);
              break;
            }
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const events = parseSSE(buffer + "\n\n");
      for (const evt of events) {
        if (evt.event === "token") {
          removeLoading(section);
          accumulatedContent += evt.data.content || "";
          section.innerHTML = renderMarkdown(accumulatedContent);
        } else if (evt.event === "title") {
          const title = evt.data.title;
          if (title) {
            state.conversation.title = title;
            updateConversationTitle(title);
          }
        } else if (evt.event === "done") {
          removeLoading(section);
          const messageId = evt.data.message_id || tempId;
          section.setAttribute("data-message-id", messageId);
          state.conversation.mainThread.push({
            id: messageId,
            role: "assistant",
            content: accumulatedContent,
            toolInvocations: [],
          });
          section.innerHTML = renderMarkdown(accumulatedContent);
          const continuationArea = document.getElementById("continuation-area");
          if (continuationArea) {
            continuationArea.classList.add("visible");
          }
          fetchConversationList();
        } else if (evt.event === "error") {
          showError(section, evt.data.message || evt.data || "An error occurred");
        }
      }
    }
  } catch (err) {
    showError(section, `Network error: ${err.message}`);
  } finally {
    state.ui.loading = false;
  }
}

// ---------------------------------------------------------------------------
// ContinuationInput logic
// ---------------------------------------------------------------------------

function disableContinuationInput() {
  continuationInput.disabled = true;
  continueBtn.disabled = true;
}

function enableContinuationInput() {
  continuationInput.disabled = false;
  continueBtn.disabled = false;
}

function handleContinueSubmit() {
  const question = continuationInput.value.trim();
  if (!question || state.ui.loading) return;

  continuationInput.value = "";
  submitContinuation(question);
}

/**
 * Submit a continuation question and stream the response into a new section.
 * @param {string} question
 */
async function submitContinuation(question) {
  state.ui.loading = true;
  disableContinuationInput();

  // Add user message to state
  const userMsgId = uid();
  state.conversation.mainThread.push({
    id: userMsgId,
    role: "user",
    content: question,
    toolInvocations: [],
  });

  // Visual divider before the new continuation exchange
  const divider = document.createElement("hr");
  divider.className = "continuation-divider";
  mainPanel.appendChild(divider);

  // Create a new section for the response
  const tempId = uid();
  const section = createResponseSection(tempId);
  showLoading(section);

  let accumulatedContent = "";

  try {
    const response = await fetch("/api/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const errText = await response.text();
      showError(section, `Request failed (${response.status}): ${errText}`);
      state.ui.loading = false;
      enableContinuationInput();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;

        const events = parseSSE(part + "\n\n");
        for (const evt of events) {
          switch (evt.event) {
            case "token": {
              removeLoading(section);
              accumulatedContent += evt.data.content || "";
              section.innerHTML = renderMarkdown(accumulatedContent);
              break;
            }

            case "tool_use": {
              removeLoading(section);
              const toolInfo = `\n\n🔧 Used ${evt.data.tool_name}\n\n`;
              accumulatedContent += toolInfo;
              section.innerHTML = renderMarkdown(accumulatedContent);
              break;
            }

            case "done": {
              removeLoading(section);
              const messageId = evt.data.message_id || tempId;
              section.setAttribute("data-message-id", messageId);

              state.conversation.mainThread.push({
                id: messageId,
                role: "assistant",
                content: accumulatedContent,
                toolInvocations: [],
              });

              section.innerHTML = renderMarkdown(accumulatedContent);
              fetchConversationList();
              break;
            }

            case "error": {
              const errMsg = evt.data.message || evt.data || "An error occurred";
              showError(section, errMsg);
              break;
            }
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const events = parseSSE(buffer + "\n\n");
      for (const evt of events) {
        if (evt.event === "token") {
          removeLoading(section);
          accumulatedContent += evt.data.content || "";
          section.innerHTML = renderMarkdown(accumulatedContent);
        } else if (evt.event === "done") {
          removeLoading(section);
          const messageId = evt.data.message_id || tempId;
          section.setAttribute("data-message-id", messageId);
          state.conversation.mainThread.push({
            id: messageId,
            role: "assistant",
            content: accumulatedContent,
            toolInvocations: [],
          });
          section.innerHTML = renderMarkdown(accumulatedContent);
          fetchConversationList();
        } else if (evt.event === "error") {
          showError(section, evt.data.message || evt.data || "An error occurred");
        }
      }
    }
  } catch (err) {
    showError(section, `Network error: ${err.message}`);
  } finally {
    state.ui.loading = false;
    enableContinuationInput();
  }
}

// Wire up ContinuationInput events
continueBtn.addEventListener("click", handleContinueSubmit);
continuationInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleContinueSubmit();
  }
});

// ---------------------------------------------------------------------------
// TextSelectionPopover
// ---------------------------------------------------------------------------

/** Active tippy instance for the selection popover. */
let selectionPopover = null;

/**
 * Compute character offsets of a Range relative to the text content of a
 * container element. Walks the text node tree in document order and sums
 * character lengths until the range's start/end containers are reached.
 *
 * @param {Range} range
 * @param {HTMLElement} container
 * @returns {{ startOffset: number, endOffset: number }}
 */
function computeOffsetsRelativeToSection(range, container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let startOffset = 0;
  let endOffset = 0;
  let foundStart = false;
  let foundEnd = false;

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (node === range.startContainer) {
      startOffset = charCount + range.startOffset;
      foundStart = true;
    }
    if (node === range.endContainer) {
      endOffset = charCount + range.endOffset;
      foundEnd = true;
      break;
    }

    charCount += node.textContent.length;
  }

  // Fallback: if containers weren't found (shouldn't happen), use 0
  if (!foundStart) startOffset = 0;
  if (!foundEnd) endOffset = startOffset;

  return { startOffset, endOffset };
}

/**
 * Find the closest parent <section> with a data-message-id attribute.
 * @param {Node} node
 * @returns {HTMLElement|null}
 */
function findParentSection(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== mainPanel) {
    if (el.tagName === "SECTION" && el.hasAttribute("data-message-id")) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Destroy the current selection popover if it exists.
 */
function destroySelectionPopover() {
  if (selectionPopover) {
    // Clean up the positioning element we appended to the body
    const ref = selectionPopover.reference;
    selectionPopover.destroy();
    if (ref && ref.parentNode && ref.style && ref.style.opacity === "0") {
      ref.parentNode.removeChild(ref);
    }
    selectionPopover = null;
  }
  state.ui.selectedText = null;
}

/**
 * Handle mouseup on the MainPanel — show the "Ask about this" popover
 * when a valid text selection exists.
 */
function handleMainPanelMouseUp() {
  // Small delay to let the browser finalize the selection
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Ensure the selection is within the main panel
    if (!mainPanel.contains(range.commonAncestorContainer)) return;

    // Find the parent section for the anchor
    const section = findParentSection(range.startContainer);
    if (!section) return;

    const messageId = section.getAttribute("data-message-id");
    const { startOffset, endOffset } = computeOffsetsRelativeToSection(range, section);

    // Capture selection data locally before destroying any existing popover.
    // destroySelectionPopover() clears state.ui.selectedText, so we must
    // save the new selection first and restore it after.
    const selectionData = {
      text: selectedText,
      messageId,
      startOffset,
      endOffset,
    };

    // Destroy any existing popover (this clears state.ui.selectedText)
    destroySelectionPopover();

    // Restore the selection data for the new popover
    state.ui.selectedText = selectionData;

    // Get the bounding rect of the selection for positioning
    const rect = range.getBoundingClientRect();

    // Create a real DOM element positioned at the selection rect.
    // Tippy v6 doesn't accept plain virtual reference objects — it tries
    // to use them as a CSS selector string, causing querySelectorAll errors.
    const virtualRef = document.createElement("span");
    virtualRef.style.position = "fixed";
    virtualRef.style.left = `${rect.left}px`;
    virtualRef.style.top = `${rect.top}px`;
    virtualRef.style.width = `${rect.width}px`;
    virtualRef.style.height = `${rect.height}px`;
    virtualRef.style.pointerEvents = "none";
    virtualRef.style.opacity = "0";
    document.body.appendChild(virtualRef);

    // Build the popover content — starts with "Ask about this" button
    const contentEl = document.createElement("div");
    contentEl.className = "marginalia-popover";

    const askButton = document.createElement("button");
    askButton.className = "ask-btn";
    askButton.textContent = "Ask about this";
    askButton.type = "button";
    contentEl.appendChild(askButton);

    // Create the tippy instance
    selectionPopover = tippy(virtualRef, {
      content: contentEl,
      showOnCreate: true,
      interactive: true,
      trigger: "manual",
      placement: "bottom-start",
      appendTo: document.body,
      hideOnClick: false,
    });

    // On "Ask about this" click, transform into a text input
    askButton.addEventListener("click", () => {
      // Capture selection data NOW — global state may be cleared by the time
      // the user clicks the submit button (e.g. mousedown dismiss handler).
      const capturedSelection = state.ui.selectedText
        ? { ...state.ui.selectedText }
        : null;

      contentEl.innerHTML = "";

      const form = document.createElement("div");
      form.className = "side-question-form";

      // Stop mousedown from bubbling to the document dismiss handler.
      // Without this, clicks on the input/button can trigger
      // destroySelectionPopover() because the popover lives in document.body,
      // outside mainPanel.
      form.addEventListener("mousedown", (e) => e.stopPropagation());

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Ask a question about this selection…";
      input.setAttribute("aria-label", "Side question about selected text");

      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.textContent = "Ask";

      form.appendChild(input);
      form.appendChild(submitBtn);
      contentEl.appendChild(form);

      // Re-position tippy after content change
      if (selectionPopover && selectionPopover.popperInstance) {
        selectionPopover.popperInstance.update();
      }

      input.focus();

      const doSubmit = () => {
        const question = input.value.trim();
        if (!question || !capturedSelection) return;

        submitBtn.disabled = true;
        input.disabled = true;

        submitSideQuestion(
          capturedSelection.text,
          question,
          {
            message_id: capturedSelection.messageId,
            start_offset: capturedSelection.startOffset,
            end_offset: capturedSelection.endOffset,
          }
        );

        // Close the popover
        destroySelectionPopover();
        // Clear the browser selection
        window.getSelection().removeAllRanges();
      };

      submitBtn.addEventListener("click", doSubmit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          doSubmit();
        }
      });
    });
  }, 10);
}

// ---------------------------------------------------------------------------
// MarginNote rendering
// ---------------------------------------------------------------------------

/**
 * Create and append a MarginNote element to the MarginNotePanel.
 * Returns an object with references to key DOM elements for streaming updates.
 *
 * @param {{ selectedText: string, question: string, anchorMessageId: string }} opts
 * @returns {{ el: HTMLElement, responseEl: HTMLElement, loadingEl: HTMLElement, bodyEl: HTMLElement }}
 */
function renderMarginNote({ selectedText, question, anchorMessageId, colorIndex }) {
  const note = document.createElement("div");
  note.className = "margin-note";
  if (colorIndex !== undefined) {
    note.style.borderLeft = `3px solid ${getThreadColor(colorIndex)}`;
  }

  // ── Header: excerpt + toggle ──
  const header = document.createElement("div");
  header.className = "margin-note-header";

  const excerpt = document.createElement("span");
  excerpt.className = "margin-note-excerpt";
  excerpt.textContent = selectedText.length > 120 ? selectedText.slice(0, 120) + "…" : selectedText;
  excerpt.title = "Click to scroll to anchored section";
  excerpt.addEventListener("click", () => {
    const section = mainPanel.querySelector(`section[data-message-id="${anchorMessageId}"]`);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const toggle = document.createElement("button");
  toggle.className = "margin-note-toggle";
  toggle.type = "button";
  toggle.textContent = "▾";
  toggle.setAttribute("aria-label", "Collapse note");

  header.appendChild(excerpt);
  header.appendChild(toggle);

  // ── Body: question + response ──
  const body = document.createElement("div");
  body.className = "margin-note-body";

  const questionEl = document.createElement("div");
  questionEl.className = "margin-note-question";
  questionEl.textContent = question;

  const responseEl = document.createElement("div");
  responseEl.className = "margin-note-response";

  const loadingEl = document.createElement("span");
  loadingEl.className = "margin-note-loading";
  loadingEl.setAttribute("aria-label", "Loading response");
  responseEl.appendChild(loadingEl);

  body.appendChild(questionEl);
  body.appendChild(responseEl);

  // ── Follow-up input ──
  const inputArea = document.createElement("div");
  inputArea.className = "margin-note-input";

  const followUpInput = document.createElement("input");
  followUpInput.type = "text";
  followUpInput.placeholder = "Ask a follow-up…";
  followUpInput.setAttribute("aria-label", "Follow-up question");

  const followUpBtn = document.createElement("button");
  followUpBtn.type = "button";
  followUpBtn.textContent = "Ask";

  inputArea.appendChild(followUpInput);
  inputArea.appendChild(followUpBtn);

  // ── Collapse/expand toggle ──
  toggle.addEventListener("click", () => {
    const isCollapsed = body.classList.toggle("collapsed");
    toggle.textContent = isCollapsed ? "▸" : "▾";
    toggle.setAttribute("aria-label", isCollapsed ? "Expand note" : "Collapse note");
  });

  // ── Follow-up input event handlers ──
  const doFollowUp = () => {
    const q = followUpInput.value.trim();
    if (!q) return;
    const tid = note.dataset.threadId;
    if (!tid) return;
    submitSideFollowup(tid, q, { el: note, bodyEl: body, followUpInput, followUpBtn });
  };

  followUpBtn.addEventListener("click", doFollowUp);
  followUpInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doFollowUp();
    }
  });

  // ── Assemble ──
  note.appendChild(header);
  note.appendChild(body);
  note.appendChild(inputArea);
  marginNotePanel.appendChild(note);

  return { el: note, responseEl, loadingEl, bodyEl: body, followUpInput, followUpBtn };
}

/**
 * Remove the loading indicator from a margin note response area.
 * @param {HTMLElement} responseEl
 */
function removeMarginNoteLoading(responseEl) {
  const indicator = responseEl.querySelector(".margin-note-loading");
  if (indicator) indicator.remove();
}

/**
 * Display an error message in a margin note response area.
 * @param {HTMLElement} responseEl
 * @param {string} message
 */
function showMarginNoteError(responseEl, message) {
  removeMarginNoteLoading(responseEl);
  const errorEl = document.createElement("div");
  errorEl.className = "margin-note-error";
  errorEl.textContent = message;
  responseEl.appendChild(errorEl);
}

// ---------------------------------------------------------------------------
// Side question submission (with margin note rendering)
// ---------------------------------------------------------------------------

/**
 * Submit a side question to the backend.
 * @param {string} selectedText
 * @param {string} question
 * @param {{ message_id: string, start_offset: number, end_offset: number }} anchorPosition
 */
async function submitSideQuestion(selectedText, question, anchorPosition) {
  // Color index is the next available slot in sideThreads
  const colorIndex = state.conversation.sideThreads.length;

  // Create the margin note UI immediately
  const noteUI = renderMarginNote({
    selectedText,
    question,
    anchorMessageId: anchorPosition.message_id,
    colorIndex,
  });

  let threadId = null;
  let accumulatedContent = "";

  try {
    const response = await fetch("/api/side-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected_text: selectedText,
        question,
        anchor_position: anchorPosition,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      showMarginNoteError(noteUI.responseEl, `Request failed (${response.status}): ${errText}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;

        const events = parseSSE(part + "\n\n");
        for (const evt of events) {
          if (evt.event === "token") {
            removeMarginNoteLoading(noteUI.responseEl);
            accumulatedContent += evt.data.content || "";
            noteUI.responseEl.innerHTML = renderMarkdown(accumulatedContent);
            if (evt.data.thread_id && !threadId) {
              threadId = evt.data.thread_id;
            }
          } else if (evt.event === "tool_use") {
            removeMarginNoteLoading(noteUI.responseEl);
            const toolInfo = `\n\n🔧 Used ${evt.data.tool_name}\n\n`;
            accumulatedContent += toolInfo;
            noteUI.responseEl.innerHTML = renderMarkdown(accumulatedContent);
          } else if (evt.event === "done") {
            removeMarginNoteLoading(noteUI.responseEl);
            const messageId = evt.data.message_id;
            if (evt.data.thread_id) threadId = evt.data.thread_id;

            // Final render
            noteUI.responseEl.innerHTML = renderMarkdown(accumulatedContent);

            // Store the side thread in state
            const sideThread = {
              id: threadId || uid(),
              anchor: {
                messageId: anchorPosition.message_id,
                startOffset: anchorPosition.start_offset,
                endOffset: anchorPosition.end_offset,
                selectedText,
              },
              messages: [
                { id: uid(), role: "user", content: question, toolInvocations: [] },
                { id: messageId || uid(), role: "assistant", content: accumulatedContent, toolInvocations: [] },
              ],
              collapsed: false,
            };
            state.conversation.sideThreads.push(sideThread);

            // Highlight the anchored text in the main panel
            highlightAnchor(anchorPosition.message_id, anchorPosition.start_offset, anchorPosition.end_offset, colorIndex);

            // Store thread id on the note element for follow-up wiring
            noteUI.el.dataset.threadId = sideThread.id;

            // Re-layout margin notes after new note is fully rendered
            layoutMarginNotes();
            markConnectorsDirty();
            fetchConversationList();
          } else if (evt.event === "error") {
            const errMsg = evt.data.message || evt.data || "An error occurred";
            showMarginNoteError(noteUI.responseEl, errMsg);
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const events = parseSSE(buffer + "\n\n");
      for (const evt of events) {
        if (evt.event === "token") {
          removeMarginNoteLoading(noteUI.responseEl);
          accumulatedContent += evt.data.content || "";
          noteUI.responseEl.innerHTML = renderMarkdown(accumulatedContent);
          if (evt.data.thread_id && !threadId) {
            threadId = evt.data.thread_id;
          }
        } else if (evt.event === "tool_use") {
          removeMarginNoteLoading(noteUI.responseEl);
          const toolInfo = `\n\n🔧 Used ${evt.data.tool_name}\n\n`;
          accumulatedContent += toolInfo;
          noteUI.responseEl.innerHTML = renderMarkdown(accumulatedContent);
        } else if (evt.event === "done") {
          removeMarginNoteLoading(noteUI.responseEl);
          if (evt.data.thread_id) threadId = evt.data.thread_id;
          noteUI.responseEl.innerHTML = renderMarkdown(accumulatedContent);

          const sideThread = {
            id: threadId || uid(),
            anchor: {
              messageId: anchorPosition.message_id,
              startOffset: anchorPosition.start_offset,
              endOffset: anchorPosition.end_offset,
              selectedText,
            },
            messages: [
              { id: uid(), role: "user", content: question, toolInvocations: [] },
              { id: evt.data.message_id || uid(), role: "assistant", content: accumulatedContent, toolInvocations: [] },
            ],
            collapsed: false,
          };
          state.conversation.sideThreads.push(sideThread);
          noteUI.el.dataset.threadId = sideThread.id;

          // Highlight the anchored text in the main panel
          highlightAnchor(anchorPosition.message_id, anchorPosition.start_offset, anchorPosition.end_offset, colorIndex);

          // Re-layout margin notes after new note is fully rendered
          layoutMarginNotes();
          markConnectorsDirty();
          fetchConversationList();
        } else if (evt.event === "error") {
          showMarginNoteError(noteUI.responseEl, evt.data.message || evt.data || "An error occurred");
        }
      }
    }
  } catch (err) {
    showMarginNoteError(noteUI.responseEl, `Network error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Side thread follow-up submission
// ---------------------------------------------------------------------------

/**
 * Submit a follow-up question within an existing side thread.
 * Streams the response into the existing MarginNote, appending below prior messages.
 *
 * @param {string} threadId — the side thread ID
 * @param {string} question — the follow-up question text
 * @param {{ el: HTMLElement, bodyEl: HTMLElement, followUpInput: HTMLInputElement, followUpBtn: HTMLButtonElement }} noteUI
 */
async function submitSideFollowup(threadId, question, noteUI) {
  const { bodyEl, followUpInput, followUpBtn } = noteUI;

  // Disable input during streaming
  followUpInput.disabled = true;
  followUpBtn.disabled = true;

  // Append the follow-up question display
  const questionEl = document.createElement("div");
  questionEl.className = "margin-note-question";
  questionEl.textContent = question;
  bodyEl.appendChild(questionEl);

  // Append a new response area with loading indicator
  const responseEl = document.createElement("div");
  responseEl.className = "margin-note-response";
  const loadingEl = document.createElement("span");
  loadingEl.className = "margin-note-loading";
  loadingEl.setAttribute("aria-label", "Loading response");
  responseEl.appendChild(loadingEl);
  bodyEl.appendChild(responseEl);

  let accumulatedContent = "";

  try {
    const response = await fetch("/api/side-followup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId, question }),
    });

    if (!response.ok) {
      const errText = await response.text();
      removeMarginNoteLoading(responseEl);
      showMarginNoteError(responseEl, `Request failed (${response.status}): ${errText}`);
      followUpInput.disabled = false;
      followUpBtn.disabled = false;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;

        const events = parseSSE(part + "\n\n");
        for (const evt of events) {
          if (evt.event === "token") {
            removeMarginNoteLoading(responseEl);
            accumulatedContent += evt.data.content || "";
            responseEl.innerHTML = renderMarkdown(accumulatedContent);
          } else if (evt.event === "tool_use") {
            removeMarginNoteLoading(responseEl);
            const toolInfo = `\n\n🔧 Used ${evt.data.tool_name}\n\n`;
            accumulatedContent += toolInfo;
            responseEl.innerHTML = renderMarkdown(accumulatedContent);
          } else if (evt.event === "done") {
            removeMarginNoteLoading(responseEl);
            responseEl.innerHTML = renderMarkdown(accumulatedContent);

            // Update state: append user + assistant messages to the side thread
            const sideThread = state.conversation.sideThreads.find((t) => t.id === threadId);
            if (sideThread) {
              sideThread.messages.push(
                { id: uid(), role: "user", content: question, toolInvocations: [] },
                { id: evt.data.message_id || uid(), role: "assistant", content: accumulatedContent, toolInvocations: [] }
              );
            }
            fetchConversationList();
          } else if (evt.event === "error") {
            removeMarginNoteLoading(responseEl);
            showMarginNoteError(responseEl, evt.data.message || evt.data || "An error occurred");
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const events = parseSSE(buffer + "\n\n");
      for (const evt of events) {
        if (evt.event === "token") {
          removeMarginNoteLoading(responseEl);
          accumulatedContent += evt.data.content || "";
          responseEl.innerHTML = renderMarkdown(accumulatedContent);
        } else if (evt.event === "tool_use") {
          removeMarginNoteLoading(responseEl);
          const toolInfo = `\n\n🔧 Used ${evt.data.tool_name}\n\n`;
          accumulatedContent += toolInfo;
          responseEl.innerHTML = renderMarkdown(accumulatedContent);
        } else if (evt.event === "done") {
          removeMarginNoteLoading(responseEl);
          responseEl.innerHTML = renderMarkdown(accumulatedContent);

          const sideThread = state.conversation.sideThreads.find((t) => t.id === threadId);
          if (sideThread) {
            sideThread.messages.push(
              { id: uid(), role: "user", content: question, toolInvocations: [] },
              { id: evt.data.message_id || uid(), role: "assistant", content: accumulatedContent, toolInvocations: [] }
            );
          }
          fetchConversationList();
        } else if (evt.event === "error") {
          removeMarginNoteLoading(responseEl);
          showMarginNoteError(responseEl, evt.data.message || evt.data || "An error occurred");
        }
      }
    }
  } catch (err) {
    removeMarginNoteLoading(responseEl);
    showMarginNoteError(responseEl, `Network error: ${err.message}`);
  } finally {
    // Re-enable input
    followUpInput.disabled = false;
    followUpBtn.disabled = false;
    followUpInput.value = "";
    followUpInput.focus();
  }
}

// ---------------------------------------------------------------------------
// CSS Custom Highlight API — anchor highlighting
// ---------------------------------------------------------------------------

/** Collection of all anchor Range objects for persistent highlighting. */
const anchorRanges = [];

/** Managed <style> element for per-thread highlight CSS rules. */
let highlightStyleEl = null;

/**
 * Ensure the managed <style> element exists for dynamic highlight rules.
 * @returns {CSSStyleSheet}
 */
function getHighlightStyleSheet() {
  if (!highlightStyleEl) {
    highlightStyleEl = document.createElement("style");
    highlightStyleEl.id = "marginalia-highlight-styles";
    document.head.appendChild(highlightStyleEl);
  }
  return highlightStyleEl.sheet;
}

/**
 * Highlight a text range within a section using the CSS Custom Highlight API.
 * Walks the text node tree of the section identified by messageId, builds a
 * Range spanning [startOffset, endOffset] in character space, and registers
 * it via CSS.highlights.set().
 *
 * Gracefully degrades when the API is not supported.
 *
 * @param {string} messageId  — data-message-id of the target <section>
 * @param {number} startOffset — character start offset relative to section text
 * @param {number} endOffset   — character end offset relative to section text
 */
function highlightAnchor(messageId, startOffset, endOffset, colorIndex) {
  // Graceful degradation: CSS Custom Highlight API not supported
  if (typeof CSS === "undefined" || !CSS.highlights) return;

  const section = mainPanel.querySelector(`section[data-message-id="${messageId}"]`);
  if (!section) return;

  const range = document.createRange();
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let foundStart = false;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLen = node.textContent.length;

    // Set range start
    if (!foundStart && charCount + nodeLen > startOffset) {
      range.setStart(node, startOffset - charCount);
      foundStart = true;
    }

    // Set range end
    if (foundStart && charCount + nodeLen >= endOffset) {
      range.setEnd(node, endOffset - charCount);
      break;
    }

    charCount += nodeLen;
  }

  // Only register if we successfully built a valid range
  if (!foundStart) return;

  anchorRanges.push(range);

  if (colorIndex !== undefined) {
    // Per-thread named highlight with thread color
    const highlightName = `marginalia-anchor-${colorIndex}`;
    const highlight = new Highlight(range);
    CSS.highlights.set(highlightName, highlight);

    // Inject a CSS rule for this highlight
    try {
      const sheet = getHighlightStyleSheet();
      const bgColor = hexToRgba(getThreadColor(colorIndex), 0.25);
      const rule = `::highlight(${highlightName}) { background-color: ${bgColor}; }`;
      // Check if rule already exists to avoid duplicates
      let exists = false;
      for (let i = 0; i < sheet.cssRules.length; i++) {
        if (sheet.cssRules[i].cssText.includes(highlightName)) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        sheet.insertRule(rule, sheet.cssRules.length);
      }
    } catch (e) {
      // Degrade gracefully — fall back to shared highlight
      const highlight = new Highlight(...anchorRanges);
      CSS.highlights.set("marginalia-anchors", highlight);
    }
  } else {
    // Fallback: shared highlight (no color index provided)
    const highlight = new Highlight(...anchorRanges);
    CSS.highlights.set("marginalia-anchors", highlight);
  }
}

// ---------------------------------------------------------------------------
// Margin note layout algorithm
// ---------------------------------------------------------------------------

/** Minimum gap (px) between adjacent margin notes. */
const MARGIN_NOTE_GAP = 8;

/**
 * Pure layout computation: given an array of { anchorY, noteHeight }, returns
 * an array of { top } positions such that notes are as close to their anchor
 * as possible while never overlapping.
 *
 * Algorithm (greedy, sorted by anchorY):
 *   1. Sort notes by anchorY
 *   2. For each note, top = max(anchorY, previousNoteBottom + gap)
 *
 * @param {{ anchorY: number, noteHeight: number }[]} anchors
 * @param {number} [gap]  — minimum vertical gap between notes (default 8)
 * @returns {{ top: number }[]}
 */
function computeNotePositions(anchors, gap) {
  if (typeof gap !== "number") gap = MARGIN_NOTE_GAP;

  if (!anchors || anchors.length === 0) return [];

  // Build indexed entries so we can restore original order after sorting
  const indexed = anchors.map((a, i) => ({ ...a, originalIndex: i }));
  indexed.sort((a, b) => a.anchorY - b.anchorY);

  const results = new Array(anchors.length);
  let previousBottom = -Infinity;

  for (const entry of indexed) {
    const top = Math.max(entry.anchorY, previousBottom + gap);
    results[entry.originalIndex] = { top };
    previousBottom = top + entry.noteHeight;
  }

  return results;
}

/**
 * Reset any inline positioning on margin notes so they flow naturally.
 * The absolute-positioning layout algorithm was causing notes to overlap
 * and the panel's minHeight to clip the main content.
 */
function layoutMarginNotes() {
  const notes = marginNotePanel.querySelectorAll(".margin-note");
  for (const note of notes) {
    note.style.position = "";
    note.style.top = "";
    note.style.left = "";
    note.style.right = "";
  }
  marginNotePanel.style.position = "";
  marginNotePanel.style.minHeight = "";
}

// ---------------------------------------------------------------------------
// Anchor connector lines
// ---------------------------------------------------------------------------

const connectorSvg = document.getElementById("anchor-connector-svg");

/** Map of threadId → SVG <path> element for reuse (Task 2.3) */
const connectorPaths = new Map();

/** Dirty flag — set by event listeners, cleared after redraw (Task 3.1) */
let connectorsDirty = true;

/** rAF handle for cleanup if needed */
let connectorRafId = null;

/** Set the dirty flag so the next rAF frame redraws connectors (Task 3.1) */
function markConnectorsDirty() {
  connectorsDirty = true;
}

/**
 * Batch-read DOM positions, compute Bézier paths, batch-write SVG attributes.
 * Handles element reuse (Task 2.3), visibility culling (Task 4), and
 * read-then-write batching (Task 5).
 */
function updateConnectors() {
  // ── READ PHASE (Task 5.1) ──
  // Collect all measurements before any DOM writes.

  // The SVG is positioned inside #content-area, so we need to offset
  // viewport-relative getBoundingClientRect() coords by the container origin.
  const contentArea = document.getElementById("content-area");
  const containerRect = contentArea.getBoundingClientRect();
  const ox = containerRect.left;
  const oy = containerRect.top;

  const mainRect = mainPanel.getBoundingClientRect();
  const marginRect = marginNotePanel.getBoundingClientRect();

  const measurements = []; // { threadId, threadIndex, x1, y1, x2, y2, noteVisible }
  const activeThreadIds = new Set();

  const notes = marginNotePanel.querySelectorAll(".margin-note");
  for (const note of notes) {
    const threadId = note.dataset.threadId;
    if (!threadId) continue;

    const threadIndex = state.conversation.sideThreads.findIndex((t) => t.id === threadId);
    const sideThread = threadIndex >= 0 ? state.conversation.sideThreads[threadIndex] : null;
    if (!sideThread) continue;

    // Left edge of the note header (where the line ends)
    const noteRect = note.getBoundingClientRect();
    const noteVisible = isRectInViewport(noteRect, marginRect);

    // If the note is off-screen, skip entirely
    if (!noteVisible) {
      activeThreadIds.add(threadId);
      measurements.push({ threadId, threadIndex, x1: 0, y1: 0, x2: 0, y2: 0, noteVisible: false });
      continue;
    }

    const x2 = noteRect.left - ox;
    const y2 = noteRect.top + 20 - oy; // ~top of header

    // Find the highlighted anchor range in the main panel
    const section = mainPanel.querySelector(
      `section[data-message-id="${sideThread.anchor.messageId}"]`
    );

    let anchorRect = null;
    if (section) {
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      const { startOffset, endOffset } = sideThread.anchor;

      while (walker.nextNode()) {
        const node = walker.currentNode;
        const len = node.textContent.length;
        if (charCount + len > startOffset) {
          const range = document.createRange();
          range.setStart(node, startOffset - charCount);
          const endOff = Math.min(endOffset - charCount, len);
          range.setEnd(node, endOff);
          const rects = range.getClientRects();
          if (rects.length > 0) {
            anchorRect = rects[0];
          }
          break;
        }
        charCount += len;
      }
    }

    let x1, y1;
    if (anchorRect && isRectInViewport(anchorRect, mainRect)) {
      // Anchor is visible — use its actual position
      x1 = anchorRect.right - ox;
      y1 = anchorRect.top + anchorRect.height / 2 - oy;
    } else if (anchorRect) {
      // Anchor exists but is off-screen — keep original x so the vertical
      // column stays in the same place; only clamp y to viewport edge.
      x1 = anchorRect.right - ox;
      y1 = anchorRect.top + anchorRect.height / 2 - oy;
      if (y1 < mainRect.top - oy) y1 = mainRect.top - oy;
      if (y1 > mainRect.bottom - oy) y1 = mainRect.bottom - oy;
    } else {
      // Anchor rect not found — use main panel right edge, same Y as note
      x1 = mainRect.right - ox;
      y1 = y2;
    }

    activeThreadIds.add(threadId);
    measurements.push({ threadId, threadIndex, x1, y1, x2, y2, noteVisible: true });
  }

  // ── WRITE PHASE (Task 5.2) ──
  // Create/update/hide SVG path elements using collected measurements.

  for (const m of measurements) {
    let path = connectorPaths.get(m.threadId);

    // Create new path element if needed (Task 2.3)
    if (!path) {
      path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      connectorSvg.appendChild(path);
      connectorPaths.set(m.threadId, path);
    }

    if (!m.noteVisible) {
      path.setAttribute("display", "none");
    } else {
      path.removeAttribute("display");
      const d = computeBezierPath(m.x1, m.y1, m.x2, m.y2);
      path.setAttribute("d", d);
      path.setAttribute("stroke", getThreadColor(m.threadIndex));
    }
  }

  // Remove stale paths for threads no longer present (Task 2.3)
  for (const [threadId, path] of connectorPaths) {
    if (!activeThreadIds.has(threadId)) {
      path.remove();
      connectorPaths.delete(threadId);
    }
  }
}

/**
 * rAF loop — checks dirty flag each frame, redraws when needed (Task 3.2).
 */
function connectorLoop() {
  if (connectorsDirty) {
    connectorsDirty = false;
    try {
      updateConnectors();
    } catch (e) {
      // Connector rendering is non-critical; log and continue
      console.error("Connector update error:", e);
    }
  }
  connectorRafId = requestAnimationFrame(connectorLoop);
}

/** Start the rAF loop. Called once on page load (Task 3.3). */
function startConnectorLoop() {
  connectorRafId = requestAnimationFrame(connectorLoop);
}

// Kick off the connector loop (Task 3.3)
startConnectorLoop();

// Scroll and resize listeners set dirty flag instead of debouncing (Task 3.4)
mainPanel.addEventListener("scroll", markConnectorsDirty, { passive: true });
marginNotePanel.addEventListener("scroll", markConnectorsDirty, { passive: true });
window.addEventListener("resize", markConnectorsDirty);

// Dismiss popover when clicking outside the main panel and outside the popover
document.addEventListener("mousedown", (e) => {
  if (!selectionPopover) return;
  if (mainPanel.contains(e.target)) return;

  // Walk up from the click target — if we hit a tippy-box, the click is inside the popover
  let node = e.target;
  while (node && node !== document.body) {
    if (node.classList && (node.classList.contains("tippy-box") || node.classList.contains("tippy-content"))) {
      return; // Click is inside the popover, don't dismiss
    }
    node = node.parentElement;
  }

  destroySelectionPopover();
});

// Wire up the mouseup handler on the main panel
mainPanel.addEventListener("mouseup", handleMainPanelMouseUp);

// ---------------------------------------------------------------------------
// Settings Dialog
// ---------------------------------------------------------------------------

const settingsBtn = document.getElementById("settings-btn");
const settingsDialog = document.getElementById("settings-dialog");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const systemPromptEditor = document.getElementById("system-prompt-editor");
const saveSystemPromptBtn = document.getElementById("save-system-prompt-btn");
const skillFileList = document.getElementById("skill-file-list");
const skillFileNameInput = document.getElementById("skill-file-name");
const skillFileContentInput = document.getElementById("skill-file-content");
const addSkillFileBtn = document.getElementById("add-skill-file-btn");
const mcpServerList = document.getElementById("mcp-server-list");
const mcpServerNameInput = document.getElementById("mcp-server-name");
const mcpServerCommandInput = document.getElementById("mcp-server-command");
const mcpServerArgsInput = document.getElementById("mcp-server-args");
const addMcpServerBtn = document.getElementById("add-mcp-server-btn");

/**
 * Open the settings dialog: fetch current settings and populate the UI.
 */
async function openSettings() {
  state.ui.settingsOpen = true;

  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
    const data = await res.json();

    state.settings.systemPrompt = data.systemPrompt || "";
    state.settings.skillFiles = data.skillFiles || [];
    state.settings.mcpServers = data.mcpServers || [];

    systemPromptEditor.value = state.settings.systemPrompt;
    renderSkillFileList();
    renderMcpServerList();
  } catch (err) {
    systemPromptEditor.value = state.settings.systemPrompt;
    renderSkillFileList();
    renderMcpServerList();
    console.error("Failed to load settings:", err);
  }

  settingsDialog.showModal();
}

/**
 * Close the settings dialog.
 */
function closeSettings() {
  state.ui.settingsOpen = false;
  settingsDialog.close();
}

// ── System Prompt ──

async function saveSystemPrompt() {
  saveSystemPromptBtn.disabled = true;
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemPrompt: systemPromptEditor.value }),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
    state.settings.systemPrompt = systemPromptEditor.value;
    showSettingsStatus(saveSystemPromptBtn, "Saved!", "success");
  } catch (err) {
    showSettingsStatus(saveSystemPromptBtn, err.message, "error");
  } finally {
    saveSystemPromptBtn.disabled = false;
  }
}

// ── Skill Files ──

function renderSkillFileList() {
  skillFileList.innerHTML = "";
  const sorted = [...state.settings.skillFiles].sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const sf of sorted) {
    const li = document.createElement("li");
    li.dataset.id = sf.id;
    li.draggable = true;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = sf.name;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove ${sf.name}`);
    removeBtn.addEventListener("click", () => removeSkillFile(sf.id));

    li.appendChild(handle);
    li.appendChild(name);
    li.appendChild(removeBtn);

    // Drag-and-drop reorder
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", sf.id);
      li.style.opacity = "0.5";
    });
    li.addEventListener("dragend", () => { li.style.opacity = ""; });
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.style.background = "#e3f2fd"; });
    li.addEventListener("dragleave", () => { li.style.background = ""; });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.style.background = "";
      const draggedId = e.dataTransfer.getData("text/plain");
      reorderSkillFiles(draggedId, sf.id);
    });

    skillFileList.appendChild(li);
  }
}

/**
 * Validate that content looks like readable text/markdown (not binary).
 * @param {string} content
 * @returns {boolean}
 */
function isReadableTextContent(content) {
  if (!content || typeof content !== "string") return false;
  // Check for null bytes or excessive non-printable characters (binary indicator)
  const nonPrintable = content.match(/[\x00-\x08\x0E-\x1F]/g);
  if (nonPrintable && nonPrintable.length > content.length * 0.05) return false;
  if (content.includes("\x00")) return false;
  return true;
}

async function addSkillFile() {
  const name = skillFileNameInput.value.trim();
  const content = skillFileContentInput.value;

  if (!name) {
    showSettingsStatus(addSkillFileBtn, "Name is required", "error");
    return;
  }
  if (!content) {
    showSettingsStatus(addSkillFileBtn, "Content is required", "error");
    return;
  }
  if (!isReadableTextContent(content)) {
    showSettingsStatus(addSkillFileBtn, "Content must be readable text/markdown", "error");
    return;
  }

  addSkillFileBtn.disabled = true;
  try {
    const order = state.settings.skillFiles.length;
    const res = await fetch("/api/settings/skill-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content, order }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `Failed (${res.status})`);
    }
    const added = await res.json();
    state.settings.skillFiles.push(added);
    renderSkillFileList();
    skillFileNameInput.value = "";
    skillFileContentInput.value = "";
    showSettingsStatus(addSkillFileBtn, "Added!", "success");
  } catch (err) {
    showSettingsStatus(addSkillFileBtn, err.message, "error");
  } finally {
    addSkillFileBtn.disabled = false;
  }
}

async function removeSkillFile(id) {
  try {
    const res = await fetch(`/api/settings/skill-files/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    state.settings.skillFiles = state.settings.skillFiles.filter((sf) => sf.id !== id);
    renderSkillFileList();
  } catch (err) {
    console.error("Failed to remove skill file:", err);
  }
}

/**
 * Reorder skill files: move draggedId before targetId.
 */
async function reorderSkillFiles(draggedId, targetId) {
  if (draggedId === targetId) return;

  const sorted = [...state.settings.skillFiles].sort((a, b) => (a.order || 0) - (b.order || 0));
  const draggedIdx = sorted.findIndex((sf) => sf.id === draggedId);
  const targetIdx = sorted.findIndex((sf) => sf.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) return;

  // Move dragged item to target position
  const [dragged] = sorted.splice(draggedIdx, 1);
  sorted.splice(targetIdx, 0, dragged);

  // Reassign order values
  sorted.forEach((sf, i) => { sf.order = i; });
  state.settings.skillFiles = sorted;
  renderSkillFileList();
}

// ── MCP Servers — Env Editor ──

/**
 * Append a new environment variable key/value row to #mcp-env-rows.
 */
function addEnvRow() {
  const container = document.getElementById("mcp-env-rows");
  const row = document.createElement("div");
  row.className = "env-row";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "env-key";
  keyInput.placeholder = "KEY";

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "env-value";
  valueInput.placeholder = "Value";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "\u00d7";
  removeBtn.setAttribute("aria-label", "Remove environment variable");
  removeBtn.addEventListener("click", () => row.remove());

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

/**
 * Collect all env key/value pairs from the DOM rows.
 * Skips rows with empty keys. For duplicate keys, last value wins.
 * @returns {Record<string, string>}
 */
function collectEnvVars() {
  const rows = document.querySelectorAll("#mcp-env-rows .env-row");
  const env = {};
  for (const row of rows) {
    const key = row.querySelector(".env-key").value.trim();
    const value = row.querySelector(".env-value").value;
    if (key) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Remove all env rows from the container.
 */
function clearEnvRows() {
  const container = document.getElementById("mcp-env-rows");
  container.innerHTML = "";
}

// ── MCP Servers ──

function renderMcpServerList() {
  mcpServerList.innerHTML = "";
  for (const srv of state.settings.mcpServers) {
    const li = document.createElement("li");
    li.dataset.id = srv.id;
    if (srv.enabled === false) {
      li.style.opacity = "0.5";
    }

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = srv.enabled !== false;
    toggle.setAttribute("aria-label", `Enable/Disable ${srv.name}`);
    toggle.addEventListener("change", () => toggleMcpServer(srv.id, toggle.checked));

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = srv.name;

    const detail = document.createElement("span");
    detail.className = "item-detail";
    const argsStr = Array.isArray(srv.args) ? srv.args.join(" ") : (srv.args || "");
    let detailText = `${srv.command || ""} ${argsStr}`.trim();
    const envCount = srv.env && typeof srv.env === "object" ? Object.keys(srv.env).length : 0;
    if (envCount > 0) {
      detailText += ` · ${envCount} env var${envCount === 1 ? "" : "s"}`;
    }
    detail.textContent = detailText;
    detail.title = detail.textContent;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove ${srv.name}`);
    removeBtn.addEventListener("click", () => removeMcpServer(srv.id));

    li.appendChild(toggle);
    li.appendChild(name);
    li.appendChild(detail);
    li.appendChild(removeBtn);
    mcpServerList.appendChild(li);
  }
}

async function addMcpServer() {
  const name = mcpServerNameInput.value.trim();
  const command = mcpServerCommandInput.value.trim();
  const argsRaw = mcpServerArgsInput.value.trim();

  if (!name) {
    showSettingsStatus(addMcpServerBtn, "Name is required", "error");
    return;
  }
  if (!command) {
    showSettingsStatus(addMcpServerBtn, "Command is required", "error");
    return;
  }

  const args = argsRaw ? argsRaw.split(",").map((a) => a.trim()).filter(Boolean) : [];

  addMcpServerBtn.disabled = true;
  try {
    const res = await fetch("/api/settings/mcp-servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, command, args, env: collectEnvVars(), enabled: true }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `Failed (${res.status})`);
    }
    const added = await res.json();
    state.settings.mcpServers.push(added);
    renderMcpServerList();
    mcpServerNameInput.value = "";
    mcpServerCommandInput.value = "";
    mcpServerArgsInput.value = "";
    clearEnvRows();
    showSettingsStatus(addMcpServerBtn, "Added!", "success");
  } catch (err) {
    showSettingsStatus(addMcpServerBtn, err.message, "error");
  } finally {
    addMcpServerBtn.disabled = false;
  }
}

async function removeMcpServer(id) {
  try {
    const res = await fetch(`/api/settings/mcp-servers/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    state.settings.mcpServers = state.settings.mcpServers.filter((s) => s.id !== id);
    renderMcpServerList();
  } catch (err) {
    console.error("Failed to remove MCP server:", err);
  }
}

async function toggleMcpServer(id, enabled) {
  try {
    const res = await fetch(`/api/settings/mcp-servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`Toggle failed (${res.status})`);
    const updated = await res.json();
    const idx = state.settings.mcpServers.findIndex((s) => s.id === id);
    if (idx !== -1) {
      state.settings.mcpServers[idx] = updated;
    }
    renderMcpServerList();
  } catch (err) {
    console.error("Failed to toggle MCP server:", err);
    renderMcpServerList();
  }
}

// ── Status helper ──

/**
 * Show a brief status message near a button, then auto-clear.
 * @param {HTMLElement} nearEl — element to insert status after
 * @param {string} message
 * @param {"success"|"error"} type
 */
function showSettingsStatus(nearEl, message, type) {
  // Remove any existing status near this element
  const existing = nearEl.parentElement.querySelector(".settings-status");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = `settings-status ${type}`;
  el.textContent = message;
  nearEl.insertAdjacentElement("afterend", el);

  setTimeout(() => el.remove(), 3000);
}

// ── Wire up settings events ──

settingsBtn.addEventListener("click", openSettings);
settingsCloseBtn.addEventListener("click", closeSettings);
settingsDialog.addEventListener("close", () => { state.ui.settingsOpen = false; });
// Close on backdrop click
settingsDialog.addEventListener("click", (e) => {
  if (e.target === settingsDialog) closeSettings();
});

saveSystemPromptBtn.addEventListener("click", saveSystemPrompt);
addSkillFileBtn.addEventListener("click", addSkillFile);
addMcpServerBtn.addEventListener("click", addMcpServer);
document.getElementById("add-env-row-btn").addEventListener("click", addEnvRow);
