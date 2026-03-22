# Implementation Plan: Conversation Library UI

## Overview

Add a collapsible sidebar, conversation list, title display, and conversation loading to Marginalia's frontend. All changes are in `frontend/index.html` and `frontend/app.js` (vanilla HTML/JS, no build step). Tests use Vitest + fast-check in `src/__tests__/`.

## Tasks

- [x] 1. Add sidebar HTML structure, CSS, and toggle logic
  - [x] 1.1 Add sidebar HTML and toggle button to `frontend/index.html`
    - Add `<button id="sidebar-toggle-btn">` with hamburger icon (☰) in `#input-bar`, before the question input
    - Add `<nav id="sidebar">` inside `#content-area` as the first child, containing `<button id="new-conversation-btn">` and `<div id="conversation-list">`
    - Add `<div id="conversation-title">Untitled Conversation</div>` at the top of `#main-column`, above `#main-panel`
    - Add `role="complementary"` and `aria-label="Conversation library"` on the sidebar
    - _Requirements: 1.1, 1.2, 1.8, 5.1_

  - [x] 1.2 Add sidebar CSS styles to `frontend/index.html`
    - Style `#sidebar` with fixed 260px width, `overflow-y: auto`, `border-right`, hidden by default via `display: none`
    - Add `.sidebar-open` class on `#content-area` that shows the sidebar and adjusts grid to `260px minmax(0, 1fr) 340px`
    - Style `.conversation-entry` buttons with title ellipsis truncation and hover/active states
    - Style `#conversation-title` with `font-size: 0.85rem`, `color: var(--color-text-secondary)`, `padding: 12px 32px 0`
    - Style `#new-conversation-btn` at the top of the sidebar
    - Ensure responsive behavior: sidebar hidden at ≤1024px or adjust grid accordingly
    - _Requirements: 1.4, 1.5, 1.6, 2.6, 5.5_

  - [x] 1.3 Implement `toggleSidebar()` in `frontend/app.js`
    - Toggle `.sidebar-open` class on `#content-area`
    - Update `aria-label` on the toggle button: "Open conversation library" ↔ "Close conversation library"
    - When opening, call `fetchConversationList()`
    - Wire up click event on `#sidebar-toggle-btn`
    - _Requirements: 1.3, 1.6, 1.7_

  - [x] 1.4 Write property test for toggle consistency (Property 1)
    - **Property 1: Toggle consistency**
    - For any N toggle clicks (1–100), sidebar visible iff N is odd, aria-label matches state
    - **Validates: Requirements 1.3, 1.7**

- [x] 2. Implement `formatRelativeTime` and conversation list fetching/rendering
  - [x] 2.1 Implement `formatRelativeTime(dateString, now)` in `frontend/app.js`
    - Pure function: accepts ISO 8601 date string and optional `now` parameter
    - Returns: "just now" (<60s), "N minutes ago" (<60m), "N hours ago" (<24h), "N days ago" (<30d), short date ("Jan 15" or "Jan 15, 2024" if different year) for ≥30d
    - Handle singular/plural ("1 minute ago" vs "2 minutes ago")
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 2.2 Write property test for relative timestamp formatting (Property 7)
    - **Property 7: Relative timestamp formatting**
    - Generate random (date, now) pairs across all time ranges, assert output format matches range
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x] 2.3 Implement `fetchConversationList()` and `renderConversationList()` in `frontend/app.js`
    - `fetchConversationList()`: GET `/api/conversations`, store result in `state.conversationList`, call `renderConversationList()`
    - `renderConversationList()`: clear `#conversation-list`, create a `<button class="conversation-entry">` per summary with title and relative timestamp
    - Highlight the active conversation entry (matching `state.conversation.id`)
    - Show "No saved conversations" placeholder if array is empty
    - Show error message with "Retry" button if fetch fails
    - Wire click on each entry to call `loadConversation(id)`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.4 Write property test for conversation list entry rendering (Property 2)
    - **Property 2: Conversation list entry rendering**
    - For any array of ConversationSummary objects, rendered list has one entry per summary with title text and non-empty timestamp
    - **Validates: Requirements 2.2, 2.3**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement new conversation creation and state management
  - [x] 4.1 Extend `state.conversation` with `id` and `title` fields in `frontend/app.js`
    - Add `id: null` and `title: "Untitled Conversation"` to `state.conversation`
    - Add `state.conversationList: []` for caching conversation summaries
    - _Requirements: 5.2_

  - [x] 4.2 Implement `handleNewConversation()` in `frontend/app.js`
    - POST `/api/conversations/new`
    - On success: clear `#main-panel`, `#margin-note-panel`, hide `#continuation-area`, reset `state.conversation` (empty mainThread, empty sideThreads, new id, title "Untitled Conversation"), clear `anchorRanges` and CSS highlights, re-enable and focus question input, call `fetchConversationList()`
    - On failure: show error message, do not clear current conversation
    - Wire click event on `#new-conversation-btn`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 4.3 Write property test for state reset (Property 3)
    - **Property 3: State reset produces clean defaults**
    - For any conversation state, after reset: mainThread empty, sideThreads empty, title equals "Untitled Conversation"
    - **Validates: Requirements 3.3, 3.4**

- [x] 5. Implement conversation loading and rendering
  - [x] 5.1 Implement `loadConversation(id)` in `frontend/app.js`
    - GET `/api/conversations/:id`
    - On success: replace `state.conversation` with loaded data, clear and re-render `#main-panel` (user messages as dividers with question text, assistant messages as `<section data-message-id>` with `renderMarkdown`), set conversation title, show continuation area if main thread has assistant messages
    - On 404: show error, call `fetchConversationList()` to remove stale entry
    - On other error: show error, don't modify current state
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.7, 4.8_

  - [x] 5.2 Implement side thread re-rendering in `loadConversation()`
    - Clear `#margin-note-panel` and re-render each side thread as a margin note with pre-filled content (not streaming)
    - Each margin note shows the anchor excerpt, question text, and rendered assistant response
    - Wire follow-up input on each re-rendered margin note
    - _Requirements: 4.3_

  - [x] 5.3 Implement anchor highlight re-application in `loadConversation()`
    - Clear `anchorRanges` array before re-applying
    - Call `highlightAnchor(messageId, startOffset, endOffset)` for each side thread
    - Call `drawAnchorConnectors()` after all margin notes and highlights are rendered
    - Gracefully skip if CSS Custom Highlight API is unsupported
    - _Requirements: 4.4, 8.1, 8.2, 8.3, 8.4_

  - [x] 5.4 Write property test for loaded conversation rendering completeness (Property 4)
    - **Property 4: Loaded conversation rendering completeness**
    - For any Conversation with N assistant messages and M side threads, main panel has N sections with correct message IDs, margin note panel has M notes with correct content
    - **Validates: Requirements 4.2, 4.3**

  - [x] 5.5 Write property test for continuation area visibility (Property 5)
    - **Property 5: Continuation area visibility**
    - For any loaded conversation, continuation area visible iff main thread has at least one assistant message
    - **Validates: Requirements 4.5**

  - [x] 5.6 Write property test for state replacement on load (Property 6)
    - **Property 6: State replacement on load**
    - After loading any Conversation, state.conversation.id, title, mainThread length/IDs, sideThreads length/IDs all match loaded data
    - **Validates: Requirements 4.6, 5.4**

  - [x] 5.7 Write property test for anchor ranges cleanup (Property 8)
    - **Property 8: Anchor ranges cleanup on load**
    - After loading two conversations sequentially, anchorRanges.length equals second conversation's side thread count (not cumulative)
    - **Validates: Requirements 8.2**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire up title SSE event and sidebar refresh after mutations
  - [x] 7.1 Handle `title` SSE event in `submitQuestion()` in `frontend/app.js`
    - Add `case "title"` to the SSE event switch in `submitQuestion()`
    - Update `state.conversation.title` and the `#conversation-title` element with the received title
    - Implement `updateConversationTitle(title)` helper to set `#conversation-title` text content
    - _Requirements: 5.3_

  - [x] 7.2 Add sidebar refresh calls after streaming completes
    - Call `fetchConversationList()` after every `done` SSE event in `submitQuestion()`, `submitContinuation()`, `submitSideQuestion()`, and `submitSideFollowup()`
    - Refresh occurs regardless of sidebar visibility so the list is current when next opened
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All frontend changes are confined to `frontend/index.html` and `frontend/app.js`
- Tests go in `src/__tests__/` using Vitest + fast-check (TypeScript)
