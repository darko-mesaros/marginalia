# Implementation Plan: Conversation Export

## Overview

Implement conversation export in three formats (Markdown, HTML, JSON) via a new backend endpoint and frontend export button. The approach is incremental: pure exporter functions first, then the route handler, then frontend UI. Tests are interleaved with implementation to catch errors early.

## Tasks

- [x] 1. Create `src/exporters.ts` with `sanitiseTitle` and `exportMarkdown`
  - [x] 1.1 Implement `sanitiseTitle(title: string): string`
    - Replace characters not in `[a-zA-Z0-9 _-]` with underscores
    - Trim result to max 100 characters
    - Fall back to `"conversation"` if result is empty or whitespace-only
    - _Requirements: 1.7_
  - [x] 1.2 Write property test for `sanitiseTitle` (Property 1: Title sanitisation invariant)
    - **Property 1: Title sanitisation invariant**
    - Generate random Unicode strings via fast-check, verify output matches `[a-zA-Z0-9 _-]` and length ≤ 100
    - **Validates: Requirements 1.7**
  - [x] 1.3 Implement `exportMarkdown(conversation: Conversation): string`
    - Start with `# {title}` level-1 heading
    - Render user messages as `## Question` heading followed by content
    - Render assistant messages content as-is (preserving original Markdown)
    - Handle empty conversations: title heading + "Empty conversation" note
    - Inline side threads as blockquotes after the paragraph containing the anchor's `selectedText`
    - Prefix each blockquote with `> **On: "{selectedText}"**`
    - Render follow-up exchanges with `> **Q:**` and `> **A:**` prefixes
    - Insert blank lines before and after each blockquote
    - Fall back to appending blockquote at end of anchored message if `selectedText` not found
    - Maintain side thread insertion order matching `sideThreads` array order
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.1, 7.2, 7.3, 7.4_
  - [x] 1.4 Write property test for Markdown title heading (Property 4)
    - **Property 4: Markdown title heading**
    - Generate random conversations, verify first line is `# {title}`
    - **Validates: Requirements 2.1**
  - [x] 1.5 Write property test for Markdown message content preservation (Property 5)
    - **Property 5: Markdown message content preservation**
    - Generate conversations with messages, verify user content appears after `## Question` and assistant content appears verbatim
    - **Validates: Requirements 2.2, 2.3**
  - [x] 1.6 Write property test for Markdown side thread blockquote structure (Property 6)
    - **Property 6: Markdown side thread blockquote structure**
    - Generate conversations with side threads, verify blockquote format with `> **On: "..."**`, `> **Q:**`, `> **A:**`, and blank line boundaries
    - **Validates: Requirements 2.5, 2.6, 7.4**
  - [x] 1.7 Write property test for Markdown side thread placement order (Property 7)
    - **Property 7: Markdown side thread placement order**
    - Generate conversations with multiple side threads on the same message, verify insertion order matches `sideThreads` array order
    - **Validates: Requirements 2.4, 7.1, 7.3**

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement `exportHtml` in `src/exporters.ts`
  - [x] 3.1 Implement `exportHtml(conversation: Conversation): string`
    - Produce valid HTML5 document with `<!DOCTYPE html>`, `<meta charset="UTF-8">`, `<title>` set to conversation title
    - Inline all CSS in a `<style>` element — no external resources (no CDN links, no external stylesheets/scripts)
    - Two-column layout: main thread content in left column, margin notes in right column
    - Convert assistant message Markdown to HTML using `marked` server-side
    - Render each side thread as a margin note card with anchored text excerpt, user question, and assistant response
    - Duplicate the 32-color palette from `frontend/color-palette.js` as a constant array in `exporters.ts`
    - Apply color-coded border on margin note cards and `<mark>` highlights on anchor text using `COLOR_PALETTE[threadIndex % 32]` at ~0.25 alpha
    - Fall back to text-search using `selectedText` if character offsets can't resolve against rendered HTML
    - Handle multiple anchors on the same message with distinct colors
    - Handle empty conversations: minimal HTML with title and "Empty conversation" note
    - No interactive UI elements (`<input>`, `<textarea>`, `<nav>`, `<dialog>`)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 3.2 Write property test for HTML standalone structure (Property 8)
    - **Property 8: HTML standalone structure**
    - Generate random conversations, verify `<!DOCTYPE html>`, `<meta charset="UTF-8">`, `<title>` matches title, `<style>` present, no external URLs in `src`/`href`, no interactive elements
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.9**
  - [x] 3.3 Write property test for HTML markdown-to-HTML conversion (Property 9)
    - **Property 9: HTML markdown-to-HTML conversion**
    - Generate conversations with Markdown formatting in assistant messages, verify corresponding HTML elements appear
    - **Validates: Requirements 3.5**
  - [x] 3.4 Write property test for HTML side thread content presence (Property 10)
    - **Property 10: HTML side thread content presence**
    - Generate conversations with side threads, verify `selectedText`, first user question, and first assistant response appear in output
    - **Validates: Requirements 3.6**
  - [x] 3.5 Write property test for HTML anchor color highlighting (Property 11)
    - **Property 11: HTML anchor color highlighting**
    - Generate conversations with N ≥ 1 side threads, verify `<mark>` elements with correct palette colors at ~0.25 alpha
    - **Validates: Requirements 3.7, 3.8, 6.1, 6.2, 6.3, 6.5**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add export route handler in `src/routes.ts`
  - [x] 5.1 Add `GET /api/conversations/:id/export` route inside `createRouter()`
    - Validate `format` query parameter — return 400 with `{ "error": "Invalid or missing format. Supported formats: markdown, html, json" }` if missing or unsupported
    - For `markdown` and `html`: load conversation via `library.load(id)`, catch `LibraryError` NOT_FOUND → 404
    - For `json`: check `library.exists(id)`, then read raw file from `{dataDir}/chats/{id}.json` via `fs.readFile`; handle ENOENT → 404
    - Sanitise title via `sanitiseTitle()` for `Content-Disposition` filename
    - Set correct `Content-Type` and `Content-Disposition` headers per format
    - Catch-all error handler returning 500 `{ "error": "Export failed" }`
    - Import `sanitiseTitle`, `exportMarkdown`, `exportHtml` from `./exporters.js`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 4.1, 4.2_
  - [x] 5.2 Write unit tests for the export route
    - Test HTTP 400 for missing/invalid format parameter
    - Test HTTP 404 for non-existent conversation ID
    - Test correct Content-Type and Content-Disposition headers for each format
    - Test JSON export serves raw file content
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_
  - [x] 5.3 Write property test for invalid format rejection (Property 3)
    - **Property 3: Invalid format rejection**
    - Generate random strings not in `{"markdown", "html", "json"}`, verify 400 response
    - **Validates: Requirements 1.2**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add export button and format selector to frontend
  - [x] 7.1 Add export button markup and CSS to `frontend/index.html`
    - Add export button element in `#input-bar` between settings gear and ask button
    - Add dropdown/popover markup for format selector with three options: "Markdown (.md)", "HTML (.html)", "JSON (.json)"
    - Add CSS for export button styling (consistent with existing buttons), dropdown positioning, and visibility toggling
    - Add accessible label `"Export conversation"` on the button
    - _Requirements: 5.1, 5.2, 5.5_
  - [x] 7.2 Add export logic to `frontend/app.js`
    - Show/hide export button based on conversation state (visible only when conversation has ≥ 1 message)
    - Toggle format selector dropdown on button click
    - On format selection: initiate download via `GET /api/conversations/:id/export?format={format}`
    - Disable export button while request is in progress, re-enable on completion
    - Close dropdown when clicking outside or after selection
    - Make dropdown keyboard-navigable
    - Update visibility on conversation load, new conversation, and after streaming completes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 8. Write edge-case unit tests
  - [x] 8.1 Write unit tests for empty conversation export
    - Test Markdown export produces title + "Empty conversation" note
    - Test HTML export produces minimal document with title + "Empty conversation" note
    - _Requirements: 2.7, 3.10_
  - [x] 8.2 Write unit tests for side thread fallback placement
    - Test Markdown: side thread blockquote appended at end of message when `selectedText` not found
    - Test HTML: text-search fallback when anchor offsets can't resolve
    - _Requirements: 7.2, 6.4_
  - [x] 8.3 Write property test for JSON round-trip (Property 12)
    - **Property 12: JSON export round-trip**
    - Generate random conversations, save via `JsonFilePersistenceAdapter`, read raw file, load back, verify equivalence of `id`, `title`, `mainThread`, `sideThreads`, `createdAt`, `updatedAt`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All imports in new/modified `.ts` files must use `.js` extension (Node16 ESM)
- The `marked` library is already a devDependency — import it server-side in `exporters.ts`
- Color palette is duplicated from `frontend/color-palette.js` into `exporters.ts` as a static constant
