// ── Marginalia Frontend ──
// Core application state and rendering logic

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  conversation: {
    mainThread: [],     // [{id, role, content, toolInvocations}]
    sideThreads: [],    // [{id, anchor, messages, collapsed}]
  },
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
const questionInput = document.getElementById("question-input");
const askBtn = document.getElementById("ask-btn");
const mainPanel = document.getElementById("main-panel");
const marginNotePanel = document.getElementById("margin-note-panel");
const continuationInput = document.getElementById("continuation-input");
const continueBtn = document.getElementById("continue-btn");

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
              const toolInfo = `\n\n> **Tool:** ${evt.data.tool_name}\n> **Result:** ${evt.data.result || "..."}\n\n`;
              accumulatedContent += toolInfo;
              section.innerHTML = renderMarkdown(accumulatedContent);
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
              const toolInfo = `\n\n> **Tool:** ${evt.data.tool_name}\n> **Result:** ${evt.data.result || "..."}\n\n`;
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
function renderMarginNote({ selectedText, question, anchorMessageId }) {
  const note = document.createElement("div");
  note.className = "margin-note";

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
  // Create the margin note UI immediately
  const noteUI = renderMarginNote({
    selectedText,
    question,
    anchorMessageId: anchorPosition.message_id,
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
            const toolInfo = `\n\n> **Tool:** ${evt.data.tool_name}\n> **Result:** ${evt.data.result || "..."}\n\n`;
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
            highlightAnchor(anchorPosition.message_id, anchorPosition.start_offset, anchorPosition.end_offset);

            // Store thread id on the note element for follow-up wiring
            noteUI.el.dataset.threadId = sideThread.id;

            // Re-layout margin notes after new note is fully rendered
            layoutMarginNotes();
            drawAnchorConnectors();
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
          const toolInfo = `\n\n> **Tool:** ${evt.data.tool_name}\n> **Result:** ${evt.data.result || "..."}\n\n`;
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
          highlightAnchor(anchorPosition.message_id, anchorPosition.start_offset, anchorPosition.end_offset);

          // Re-layout margin notes after new note is fully rendered
          layoutMarginNotes();
          drawAnchorConnectors();
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
            const toolInfo = `\n\n> **Tool:** ${evt.data.tool_name}\n> **Result:** ${evt.data.result || "..."}\n\n`;
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
          const toolInfo = `\n\n> **Tool:** ${evt.data.tool_name}\n> **Result:** ${evt.data.result || "..."}\n\n`;
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
function highlightAnchor(messageId, startOffset, endOffset) {
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

  const highlight = new Highlight(...anchorRanges);
  CSS.highlights.set("marginalia-anchors", highlight);
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

/** Debounce helper. */
function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ---------------------------------------------------------------------------
// Anchor connector lines
// ---------------------------------------------------------------------------

const connectorSvg = document.getElementById("anchor-connector-svg");

/**
 * Draw dashed lines from each margin note's left edge to the midpoint of
 * its highlighted anchor text in the main panel.
 * Uses fixed-position coordinates so it works regardless of scroll.
 */
function drawAnchorConnectors() {
  connectorSvg.innerHTML = "";

  const notes = marginNotePanel.querySelectorAll(".margin-note");
  for (const note of notes) {
    const threadId = note.dataset.threadId;
    if (!threadId) continue;

    const sideThread = state.conversation.sideThreads.find((t) => t.id === threadId);
    if (!sideThread) continue;

    // Find the highlighted anchor range in the main panel
    const section = mainPanel.querySelector(
      `section[data-message-id="${sideThread.anchor.messageId}"]`
    );
    if (!section) continue;

    // Walk text nodes to find the anchor rect
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let anchorRect = null;
    const { startOffset, endOffset } = sideThread.anchor;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const len = node.textContent.length;
      if (!anchorRect && charCount + len > startOffset) {
        const range = document.createRange();
        range.setStart(node, startOffset - charCount);
        const endNode = node;
        const endOff = Math.min(endOffset - charCount, len);
        range.setEnd(endNode, endOff);
        const rects = range.getClientRects();
        if (rects.length > 0) {
          anchorRect = rects[0];
        }
        break;
      }
      charCount += len;
    }

    if (!anchorRect) continue;

    // Right edge of the anchor text (where the line starts)
    const x1 = anchorRect.right;
    const y1 = anchorRect.top + anchorRect.height / 2;

    // Left edge of the note header (where the line ends)
    const noteRect = note.getBoundingClientRect();
    const x2 = noteRect.left;
    const y2 = noteRect.top + 20; // ~top of header

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    connectorSvg.appendChild(line);
  }
}

// Redraw on scroll and resize
mainPanel.addEventListener("scroll", debounce(drawAnchorConnectors, 50));
marginNotePanel.addEventListener("scroll", debounce(drawAnchorConnectors, 50));
window.addEventListener("resize", debounce(drawAnchorConnectors, 100));

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

// ── MCP Servers ──

function renderMcpServerList() {
  mcpServerList.innerHTML = "";
  for (const srv of state.settings.mcpServers) {
    const li = document.createElement("li");
    li.dataset.id = srv.id;

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = srv.name;

    const detail = document.createElement("span");
    detail.className = "item-detail";
    const argsStr = Array.isArray(srv.args) ? srv.args.join(" ") : (srv.args || "");
    detail.textContent = `${srv.command || ""} ${argsStr}`.trim();
    detail.title = detail.textContent;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove ${srv.name}`);
    removeBtn.addEventListener("click", () => removeMcpServer(srv.id));

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
      body: JSON.stringify({ name, command, args, env: {}, enabled: true }),
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
