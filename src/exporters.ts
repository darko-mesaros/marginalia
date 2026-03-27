import { marked } from "marked";
import type { Conversation, SideThread } from "./models.js";

/**
 * Sanitise a conversation title for use in filenames.
 * - Replaces characters not in [a-zA-Z0-9 _-] with underscores
 * - Trims to max 100 characters
 * - Falls back to "conversation" if result is empty or whitespace-only
 */
export function sanitiseTitle(title: string): string {
  const sanitised = title.replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 100);
  return sanitised.trim() === "" ? "conversation" : sanitised;
}

/**
 * Render a side thread as a Markdown blockquote.
 */
function renderSideThreadBlockquote(thread: SideThread): string {
  const lines: string[] = [];
  lines.push(`> **On: "${thread.anchor.selectedText}"**`);

  for (const msg of thread.messages) {
    if (msg.role === "user") {
      lines.push(`> **Q:** ${msg.content}`);
    } else {
      lines.push(`> **A:** ${msg.content}`);
    }
  }

  return lines.join("\n");
}

/**
 * Render a Conversation as a Markdown string.
 *
 * - Title as level-1 heading
 * - User messages as `## Question` + content
 * - Assistant messages as-is (preserving original Markdown)
 * - Side threads inlined as blockquotes after the paragraph containing the anchor's selectedText
 * - Empty conversations produce title + "Empty conversation" note
 */
export function exportMarkdown(conversation: Conversation): string {
  const parts: string[] = [];
  parts.push(`# ${conversation.title}`);

  if (conversation.mainThread.length === 0) {
    parts.push("");
    parts.push("Empty conversation");
    return parts.join("\n");
  }

  for (const message of conversation.mainThread) {
    if (message.role === "user") {
      parts.push("");
      parts.push("## Question");
      parts.push("");
      parts.push(message.content);
    } else {
      // Collect side threads anchored to this message
      const anchored = conversation.sideThreads.filter(
        (st) => st.anchor.messageId === message.id
      );

      if (anchored.length === 0) {
        // No side threads — render content as-is
        parts.push("");
        parts.push(message.content);
      } else {
        // Split content into paragraphs and insert side thread blockquotes
        const paragraphs = message.content.split(/\n\n/);

        // For each side thread, determine which paragraph it belongs to.
        // Build a map: paragraphIndex -> list of side threads to insert after it.
        // If selectedText not found, fall back to last paragraph.
        const insertions = new Map<number, SideThread[]>();

        for (const thread of anchored) {
          let targetIdx = -1;
          for (let i = 0; i < paragraphs.length; i++) {
            if (paragraphs[i].includes(thread.anchor.selectedText)) {
              targetIdx = i;
              break;
            }
          }
          // Fallback: append at end of message (after last paragraph)
          if (targetIdx === -1) {
            targetIdx = paragraphs.length - 1;
          }

          if (!insertions.has(targetIdx)) {
            insertions.set(targetIdx, []);
          }
          insertions.get(targetIdx)!.push(thread);
        }

        // Render paragraphs with interleaved blockquotes
        for (let i = 0; i < paragraphs.length; i++) {
          parts.push("");
          parts.push(paragraphs[i]);

          const threads = insertions.get(i);
          if (threads) {
            for (const thread of threads) {
              parts.push("");
              parts.push(renderSideThreadBlockquote(thread));
              parts.push("");
            }
          }
        }
      }
    }
  }

  return parts.join("\n");
}


// ---------------------------------------------------------------------------
// HTML Export
// ---------------------------------------------------------------------------

/**
 * 32-color palette duplicated from frontend/color-palette.js.
 * Used for color-coded margin note borders and anchor text highlights.
 */
export const COLOR_PALETTE: readonly string[] = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
  '#dcbeff', '#9a6324', '#fffac8', '#800000', '#aaffc3',
  '#808000', '#ffd8b1', '#000075', '#a9a9a9', '#e6beff',
  '#1abc9c', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#e67e22', '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
  '#17becf', '#7f7f7f',
];

/**
 * Convert a 7-character hex color string to an rgba() CSS string.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Strip HTML tags from a string, returning only the text content.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Find the position in an HTML string where a plain-text needle occurs,
 * accounting for HTML tags that interrupt the text flow.
 * Returns the index in the HTML string where the match starts, or -1.
 */
function findTextInHtml(html: string, needle: string): { htmlStart: number; htmlEnd: number } | null {
  if (!needle) return null;

  // Build a mapping from text-content index to HTML index
  const textToHtml: number[] = [];
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    if (html[i] === "<") {
      inTag = true;
      continue;
    }
    if (html[i] === ">") {
      inTag = false;
      continue;
    }
    if (!inTag) {
      textToHtml.push(i);
    }
  }

  // Extract the plain text
  const plainText = stripHtmlTags(html);

  // Search for the needle in the plain text
  const textPos = plainText.indexOf(needle);
  if (textPos === -1) return null;

  const htmlStart = textToHtml[textPos];
  const htmlEnd = textToHtml[textPos + needle.length - 1] + 1;
  return { htmlStart, htmlEnd };
}

/**
 * Escape HTML special characters to prevent XSS in user-generated content.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Render a Conversation as a self-contained HTML5 document.
 *
 * - Valid HTML5 with all CSS inlined in a <style> element
 * - No external resources (no CDN links, no external stylesheets/scripts)
 * - Two-column layout: main thread left, margin notes right
 * - Markdown converted to HTML via marked
 * - Side threads rendered as margin note cards with color-coded borders
 * - Anchor text highlighted with <mark> elements at ~0.25 alpha
 * - No interactive UI elements
 */
export function exportHtml(conversation: Conversation): string {
  const titleEscaped = escapeHtml(conversation.title);

  if (conversation.mainThread.length === 0) {
    return buildHtmlDocument(titleEscaped, `<p class="empty-note">Empty conversation</p>`, "");
  }

  // Build a lookup: messageId -> array of { threadIndex, sideThread }
  const anchorsByMessage = new Map<string, { threadIndex: number; thread: SideThread }[]>();
  for (let i = 0; i < conversation.sideThreads.length; i++) {
    const thread = conversation.sideThreads[i];
    const msgId = thread.anchor.messageId;
    if (!anchorsByMessage.has(msgId)) {
      anchorsByMessage.set(msgId, []);
    }
    anchorsByMessage.get(msgId)!.push({ threadIndex: i, thread });
  }

  const mainParts: string[] = [];
  const marginParts: string[] = [];

  for (const message of conversation.mainThread) {
    if (message.role === "user") {
      mainParts.push(`<div class="user-message"><h2>Question</h2><p>${escapeHtml(message.content)}</p></div>`);
    } else {
      // Convert assistant markdown to HTML
      let html = marked.parse(message.content) as string;

      // Apply anchor highlights for side threads anchored to this message
      const anchored = anchorsByMessage.get(message.id) || [];

      // Sort anchors by position in the text (later first) so insertions don't shift earlier offsets
      const sortedAnchors = [...anchored].sort((a, b) => {
        const textA = a.thread.anchor.selectedText;
        const textB = b.thread.anchor.selectedText;
        const posA = html.indexOf(textA) !== -1 ? html.indexOf(textA) : (findTextInHtml(html, textA)?.htmlStart ?? html.length);
        const posB = html.indexOf(textB) !== -1 ? html.indexOf(textB) : (findTextInHtml(html, textB)?.htmlStart ?? html.length);
        return posB - posA; // later positions first
      });

      for (const { threadIndex, thread } of sortedAnchors) {
        const color = COLOR_PALETTE[threadIndex % 32];
        const bgColor = hexToRgba(color, 0.25);
        const selectedText = thread.anchor.selectedText;
        const noteNum = threadIndex + 1;
        const badge = `<a href="#note-${noteNum}" class="note-badge" style="background-color: ${color};" id="ref-${noteNum}"><sup>${noteNum}</sup></a>`;
        const markOpen = `<mark style="background-color: ${bgColor}">`;
        const markClose = `</mark>`;

        // Strategy 1: Direct text search in rendered HTML (works when selectedText has no markdown)
        const pos = html.indexOf(selectedText);
        if (pos !== -1) {
          html = html.slice(0, pos) + markOpen + html.slice(pos, pos + selectedText.length) + markClose + badge + html.slice(pos + selectedText.length);
        } else {
          // Strategy 2: Search for the plain text content within the HTML, ignoring tags.
          // This handles cases where markdown formatting in selectedText was converted to HTML tags.
          const match = findTextInHtml(html, selectedText);
          if (match) {
            html = html.slice(0, match.htmlStart) + markOpen + html.slice(match.htmlStart, match.htmlEnd) + markClose + badge + html.slice(match.htmlEnd);
          } else {
            // Strategy 3: Try HTML-escaped version of selectedText
            const escapedText = escapeHtml(selectedText);
            const escapedPos = html.indexOf(escapedText);
            if (escapedPos !== -1) {
              html = html.slice(0, escapedPos) + markOpen + html.slice(escapedPos, escapedPos + escapedText.length) + markClose + badge + html.slice(escapedPos + escapedText.length);
            }
            // If all strategies fail, the badge won't appear inline but the margin note card still renders
          }
        }
      }

      mainParts.push(`<div class="assistant-message">${html}</div>`);

      // Render margin note cards for anchored side threads (in original order)
      for (const { threadIndex, thread } of anchored) {
        const color = COLOR_PALETTE[threadIndex % 32];
        const bgColor = hexToRgba(color, 0.25);
        marginParts.push(renderMarginNoteCard(thread, color, bgColor, threadIndex + 1));
      }
    }
  }

  return buildHtmlDocument(titleEscaped, mainParts.join("\n"), marginParts.join("\n"));
}

/**
 * Render a single side thread as a margin note card HTML string.
 */
function renderMarginNoteCard(thread: SideThread, borderColor: string, bgColor: string, noteNumber: number): string {
  const lines: string[] = [];
  lines.push(`<div class="margin-note" id="note-${noteNumber}" style="border-left: 3px solid ${borderColor}; background-color: ${bgColor};">`);
  lines.push(`<div class="margin-note-header"><a href="#ref-${noteNumber}" class="note-badge" style="background-color: ${borderColor};">${noteNumber}</a><span class="margin-note-anchor">${escapeHtml(thread.anchor.selectedText)}</span></div>`);

  for (const msg of thread.messages) {
    if (msg.role === "user") {
      lines.push(`<div class="margin-note-question"><strong>Q:</strong> ${escapeHtml(msg.content)}</div>`);
    } else {
      lines.push(`<div class="margin-note-answer"><strong>A:</strong> ${escapeHtml(msg.content)}</div>`);
    }
  }

  lines.push(`</div>`);
  return lines.join("\n");
}

/**
 * Build the full HTML5 document with inlined CSS.
 */
function buildHtmlDocument(titleEscaped: string, mainContent: string, marginContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${titleEscaped}</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  color: #1a1a1a;
  background: #ffffff;
  margin: 0;
  padding: 0;
}
.container {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}
.main-content {
  min-width: 0;
}
.margin-column {
  min-width: 0;
}
h1 {
  font-size: 1.8rem;
  margin: 0 0 1.5rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #e0e0e0;
}
.user-message {
  margin: 1.5rem 0;
}
.user-message h2 {
  font-size: 1.1rem;
  color: #555;
  margin: 0 0 0.5rem 0;
}
.user-message p {
  margin: 0;
}
.assistant-message {
  margin: 1rem 0;
}
.assistant-message pre {
  background: #f5f5f5;
  padding: 1rem;
  border-radius: 4px;
  overflow-x: auto;
}
.assistant-message code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.9em;
}
.assistant-message p code {
  background: #f0f0f0;
  padding: 0.15em 0.3em;
  border-radius: 3px;
}
.margin-note {
  padding: 0.75rem;
  margin-bottom: 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
}
.margin-note-anchor {
  font-style: italic;
  color: #666;
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e0e0e0;
}
.margin-note-question {
  margin: 0.4rem 0;
}
.margin-note-answer {
  margin: 0.4rem 0;
}
.empty-note {
  color: #888;
  font-style: italic;
}
mark {
  padding: 0.1em 0;
  border-radius: 2px;
  position: relative;
}
.note-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.3em;
  height: 1.3em;
  border-radius: 50%;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
  vertical-align: super;
  text-decoration: none;
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.note-badge:hover { transform: scale(1.2); }
.note-badge sup { font-size: inherit; vertical-align: baseline; }
sup.note-badge {
  margin-left: 1px;
}
.margin-note {
  scroll-margin-top: 1rem;
  transition: box-shadow 0.3s ease;
}
.margin-note:target {
  box-shadow: 0 0 0 3px rgba(0,0,0,0.15);
}
.margin-note-header {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e0e0e0;
}
.margin-note-header .margin-note-anchor {
  font-style: italic;
  color: #666;
  margin: 0;
  padding: 0;
  border: none;
}
@media (max-width: 768px) {
  .container {
    grid-template-columns: 1fr;
  }
}
</style>
</head>
<body>
<div class="container">
<div class="main-content">
<h1>${titleEscaped}</h1>
${mainContent}
</div>
<div class="margin-column">
${marginContent}
</div>
</div>
</body>
</html>`;
}
