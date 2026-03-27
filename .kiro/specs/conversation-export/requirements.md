# Requirements Document

## Introduction

Conversation export adds the ability to export a Marginalia conversation in three formats: Markdown (portable text for sharing), HTML (self-contained visual artifact preserving the two-column layout), and JSON (raw data dump for backup/restore). The feature includes a backend export endpoint and a frontend export button in the top bar. The HTML format is the primary "share my research" format, producing a standalone file that recipients can open in any browser without external dependencies.

## Glossary

- **Exporter**: The backend subsystem responsible for transforming a `Conversation` object into a specific output format (Markdown, HTML, or JSON).
- **Markdown_Exporter**: The component that renders a conversation as a Markdown document with side threads inlined as blockquotes near their anchor positions.
- **HTML_Exporter**: The component that renders a conversation as a self-contained HTML file with all CSS inlined, preserving the Marginalia two-column layout (main content + margin notes).
- **JSON_Exporter**: The component that serialises a conversation as a raw JSON data dump suitable for backup and re-import.
- **Export_Button**: The UI control in the top bar that triggers format selection and initiates the export download.
- **Format_Selector**: The UI element that lets the user choose between Markdown, HTML, and JSON export formats.
- **Anchor_Highlight**: The color-coded text highlight in the HTML export that visually links a passage in the main content to its corresponding margin note, using the same 32-color palette as the live application.
- **Standalone_HTML**: An HTML file with all CSS inlined and no external resource dependencies, openable in any modern browser.

---

## Requirements

### Requirement 1: Export API Endpoint

**User Story:** As a user, I want a single API endpoint for exporting conversations, so that I can request any format through a consistent interface.

#### Acceptance Criteria

1. THE Exporter SHALL expose a `GET /api/conversations/:id/export` endpoint that accepts a `format` query parameter with values `markdown`, `html`, or `json`.
2. IF the `format` query parameter is missing or contains an unsupported value, THEN THE Exporter SHALL return HTTP 400 with a JSON error body `{ "error": "Invalid or missing format. Supported formats: markdown, html, json" }`.
3. IF the requested conversation ID does not exist, THEN THE Exporter SHALL return HTTP 404 with a JSON error body `{ "error": "Conversation not found" }`.
4. WHEN the format is `markdown`, THE Exporter SHALL return the response with `Content-Type: text/markdown; charset=utf-8` and a `Content-Disposition` header of `attachment; filename="{title}.md"`.
5. WHEN the format is `html`, THE Exporter SHALL return the response with `Content-Type: text/html; charset=utf-8` and a `Content-Disposition` header of `attachment; filename="{title}.html"`.
6. WHEN the format is `json`, THE Exporter SHALL return the response with `Content-Type: application/json; charset=utf-8` and a `Content-Disposition` header of `attachment; filename="{title}.json"`.
7. THE Exporter SHALL sanitise the conversation title for use in filenames by replacing characters not in `[a-zA-Z0-9 _-]` with underscores and trimming to a maximum of 100 characters. IF the sanitised result is empty or whitespace-only, THE Exporter SHALL fall back to the filename `"conversation"`.

---

### Requirement 2: Markdown Export

**User Story:** As a user, I want to export a conversation as Markdown, so that I can share it in Obsidian, blog posts, or documentation.

#### Acceptance Criteria

1. THE Markdown_Exporter SHALL produce a valid Markdown document starting with the conversation title as a level-1 heading.
2. WHEN a main thread contains user messages, THE Markdown_Exporter SHALL render each user message as a level-2 heading with the text "Question" followed by the message content.
3. WHEN a main thread contains assistant messages, THE Markdown_Exporter SHALL render each assistant message's content as-is (preserving the original Markdown formatting).
4. WHEN a conversation has side threads, THE Markdown_Exporter SHALL inline each side thread as a blockquote immediately after the assistant message paragraph that contains the anchor position.
5. THE Markdown_Exporter SHALL prefix each inlined side thread blockquote with a bold label showing the anchored text, formatted as `> **On: "{selectedText}"**`.
6. WHEN a side thread contains multiple exchanges (follow-up questions and answers), THE Markdown_Exporter SHALL include all exchanges within the same blockquote block, with user messages prefixed by `> **Q:**` and assistant messages prefixed by `> **A:**`.
7. WHEN a conversation has no messages, THE Markdown_Exporter SHALL produce a document containing only the title heading and a note stating "Empty conversation".

---

### Requirement 3: HTML Export

**User Story:** As a user, I want to export a conversation as a self-contained HTML file, so that I can share a visual artifact that preserves the Marginalia spatial layout and can be opened in any browser.

#### Acceptance Criteria

1. THE HTML_Exporter SHALL produce a valid HTML5 document with all CSS inlined in a `<style>` element within the `<head>`.
2. THE HTML_Exporter SHALL include no external resource dependencies (no CDN links, no external stylesheets, no external scripts).
3. THE HTML_Exporter SHALL render the main thread content in a left column and side thread margin notes in a right column, preserving the Marginalia two-column layout.
4. THE HTML_Exporter SHALL render only the conversation content and margin notes — no input boxes, navigation bars, sidebar, settings controls, or other interactive UI elements. The exported document is a clean, read-only presentation of the research.
5. WHEN the main thread content contains Markdown, THE HTML_Exporter SHALL convert the Markdown to HTML using the `marked` library on the server side.
6. WHEN a conversation has side threads, THE HTML_Exporter SHALL render each side thread as a margin note card in the right column, showing the anchored text excerpt, the user question, and the assistant response.
7. THE HTML_Exporter SHALL apply color-coded styling to each side thread's margin note card border and anchor text highlight using the same 32-color palette defined in `color-palette.js`, assigned by creation order index. The colors in the export SHALL match the colors shown in the live application for the same conversation.
8. WHEN a side thread has an anchor, THE HTML_Exporter SHALL wrap the corresponding text span in the main content with a `<mark>` element styled with the thread's assigned background color at reduced opacity.
9. THE HTML_Exporter SHALL include a `<meta charset="UTF-8">` declaration and a `<title>` element set to the conversation title.
10. WHEN a conversation has no messages, THE HTML_Exporter SHALL produce a minimal HTML document displaying the title and a note stating "Empty conversation".
11. THE Standalone_HTML SHALL be openable and render correctly in current versions of Chrome, Firefox, Safari, and Edge without requiring a web server.

---

### Requirement 4: JSON Export

**User Story:** As a user, I want to export a conversation as JSON, so that I can back up my data or import it into another Marginalia instance.

#### Acceptance Criteria

1. THE JSON_Exporter SHALL produce output in the exact same format as the persisted conversation files written by `JsonFilePersistenceAdapter` (i.e., the same structure stored in `{dataDir}/chats/{id}.json`).
2. THE JSON_Exporter SHALL serve the persisted conversation file directly without transformation, ensuring byte-level compatibility with the storage format.
3. FOR ALL valid `Conversation` objects, the exported JSON file SHALL be directly importable by placing it into another Marginalia instance's `{dataDir}/chats/` directory and loading it via `JsonFilePersistenceAdapter.load()` without any conversion step.
4. THE JSON_Exporter SHALL preserve all fields including `id`, `title`, `mainThread`, `sideThreads` (with complete anchor metadata), `createdAt`, and `updatedAt`.

---

### Requirement 5: Export Button UI

**User Story:** As a user, I want an export button in the top bar, so that I can easily export the current conversation without navigating away.

#### Acceptance Criteria

1. THE Export_Button SHALL be placed in the `#input-bar` element, between the settings gear button and the ask button area, and SHALL be visible only when a conversation with at least one message is loaded.
2. WHEN the Export_Button is clicked, THE Format_Selector SHALL appear as a dropdown or popover presenting three options: "Markdown (.md)", "HTML (.html)", and "JSON (.json)".
3. WHEN the user selects a format from the Format_Selector, THE frontend SHALL initiate a download of the exported file by requesting `GET /api/conversations/:id/export?format={selected_format}`.
4. WHILE no conversation is loaded or the conversation has no messages, THE Export_Button SHALL be hidden.
5. THE Export_Button SHALL have an accessible label of "Export conversation" and the Format_Selector options SHALL be keyboard-navigable.
6. WHILE an export request is in progress, THE Export_Button SHALL be disabled to prevent duplicate requests.

---

### Requirement 6: HTML Export Anchor Highlighting

**User Story:** As a user, I want the HTML export to show which text passages have margin notes, so that readers can visually trace the connection between main content and side discussions.

#### Acceptance Criteria

1. WHEN a side thread's anchor references a specific message and character offsets, THE HTML_Exporter SHALL locate the corresponding text span in the rendered HTML and wrap it with a styled `<mark>` element.
2. THE HTML_Exporter SHALL assign each `<mark>` element a background color derived from the thread's index in the `sideThreads` array, using the same color palette and index-to-color mapping as the live application.
3. THE HTML_Exporter SHALL apply the highlight color at reduced opacity (approximately 0.25 alpha) so that the underlying text remains readable.
4. IF an anchor's character offsets cannot be resolved against the rendered HTML content (due to Markdown-to-HTML transformation changing offsets), THEN THE HTML_Exporter SHALL fall back to a text-search approach using the `selectedText` field to locate and highlight the passage.
5. WHEN multiple side threads anchor to the same assistant message, THE HTML_Exporter SHALL apply distinct color highlights for each anchor without overlapping or replacing previous highlights.

---

### Requirement 7: Markdown Export Side Thread Placement

**User Story:** As a user, I want side threads placed near their anchor positions in the Markdown export, so that the exported document reads naturally with annotations in context.

#### Acceptance Criteria

1. WHEN placing a side thread blockquote, THE Markdown_Exporter SHALL insert the blockquote after the paragraph in the assistant message that contains the anchor's `selectedText`.
2. IF the `selectedText` cannot be found in the assistant message content, THEN THE Markdown_Exporter SHALL append the side thread blockquote at the end of the assistant message that matches the anchor's `messageId`.
3. WHEN multiple side threads anchor to the same paragraph, THE Markdown_Exporter SHALL insert the blockquotes in the order the side threads appear in the `sideThreads` array.
4. THE Markdown_Exporter SHALL insert a blank line before and after each side thread blockquote to ensure proper Markdown rendering.
