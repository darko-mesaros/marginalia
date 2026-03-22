# Requirements Document

## Introduction

The Conversation Library UI adds a sidebar and supporting UI elements to Marginalia's frontend so users can browse, create, and load saved conversations. The backend API endpoints (`GET /api/conversations`, `GET /api/conversations/:id`, `POST /api/conversations/new`) and the `title` SSE event are already implemented. This feature is purely frontend work in `frontend/index.html` and `frontend/app.js` — vanilla HTML/JS, no build step, no framework.

## Glossary

- **Sidebar**: A collapsible left-side panel that displays the list of saved conversations and a "New Conversation" button.
- **ConversationList**: The ordered list of conversation entries rendered inside the Sidebar, fetched from `GET /api/conversations`.
- **ConversationEntry**: A single item in the ConversationList showing the conversation title and a relative timestamp.
- **ConversationTitle**: The title displayed at the top of the main content area for the active conversation.
- **ToggleButton**: A hamburger-style button that shows or hides the Sidebar.
- **MainPanel**: The existing main content area where explanations and continuations are rendered.
- **MarginNotePanel**: The existing right-side panel where side thread margin notes are rendered.
- **AnchorHighlight**: The CSS Custom Highlight API-based highlighting of text selections that anchor side threads.

---

## Requirements

### Requirement 1: Sidebar Layout and Toggle

**User Story:** As a user, I want a collapsible sidebar on the left side of the screen, so that I can access my conversation library without permanently losing main content space.

#### Acceptance Criteria

1. THE Sidebar SHALL be rendered as a left-side panel adjacent to the existing content area in `frontend/index.html`.
2. THE ToggleButton SHALL be rendered in the input bar area and SHALL use a hamburger icon (☰) or similar recognizable icon.
3. WHEN the ToggleButton is clicked, THE Sidebar SHALL toggle between visible and hidden states.
4. WHILE the Sidebar is hidden, THE MainPanel SHALL expand to use the full available width.
5. WHILE the Sidebar is visible, THE Sidebar SHALL occupy a fixed width and THE MainPanel SHALL shrink to accommodate the Sidebar.
6. THE Sidebar SHALL default to the hidden state on initial page load.
7. THE ToggleButton SHALL have an accessible `aria-label` that reflects the current state ("Open conversation library" or "Close conversation library").
8. THE Sidebar SHALL include a `role="complementary"` attribute and an `aria-label="Conversation library"` for accessibility.

---

### Requirement 2: Conversation List Display

**User Story:** As a user, I want to see a list of my saved conversations in the sidebar, so that I can find and resume past conversations.

#### Acceptance Criteria

1. WHEN the Sidebar becomes visible, THE ConversationList SHALL fetch conversation summaries from `GET /api/conversations`.
2. THE ConversationList SHALL display each ConversationEntry with the conversation title and a relative timestamp derived from the `updatedAt` field (e.g., "2 hours ago", "3 days ago").
3. THE ConversationList SHALL display conversations sorted by most recent first (the API returns them in this order).
4. IF the API returns an empty array, THEN THE ConversationList SHALL display a placeholder message indicating no saved conversations exist.
5. IF the fetch request fails, THEN THE ConversationList SHALL display an error message and allow the user to retry.
6. WHEN a conversation title exceeds the available width, THE ConversationEntry SHALL truncate the title with an ellipsis rather than wrapping.

---

### Requirement 3: New Conversation Creation

**User Story:** As a user, I want a "New Conversation" button in the sidebar, so that I can start a fresh conversation without losing my history.

#### Acceptance Criteria

1. THE Sidebar SHALL display a "New Conversation" button at the top, above the ConversationList.
2. WHEN the "New Conversation" button is clicked, THE frontend SHALL send a `POST /api/conversations/new` request.
3. WHEN the `POST /api/conversations/new` response is received successfully, THE frontend SHALL clear the MainPanel, the MarginNotePanel, the continuation area, and reset the in-memory conversation state.
4. WHEN a new conversation is created, THE ConversationTitle SHALL reset to "Untitled Conversation".
5. WHEN a new conversation is created, THE ConversationList SHALL refresh to reflect the updated library.
6. WHEN a new conversation is created, THE question input SHALL be re-enabled and focused so the user can immediately start typing.
7. IF the `POST /api/conversations/new` request fails, THEN THE frontend SHALL display an error message to the user without clearing the current conversation.

---

### Requirement 4: Load a Saved Conversation

**User Story:** As a user, I want to click a conversation in the sidebar to load it, so that I can resume where I left off.

#### Acceptance Criteria

1. WHEN a ConversationEntry is clicked, THE frontend SHALL send a `GET /api/conversations/:id` request with the selected conversation's ID.
2. WHEN the full conversation is received, THE frontend SHALL clear the MainPanel and re-render all main thread messages (user questions as dividers, assistant responses as rendered markdown sections with correct `data-message-id` attributes).
3. WHEN the full conversation is received, THE frontend SHALL clear the MarginNotePanel and re-render all side threads as margin notes with their original anchor references, question text, and response content.
4. WHEN side threads are re-rendered from a loaded conversation, THE AnchorHighlight SHALL be re-applied using the CSS Custom Highlight API so that anchored text selections are visually highlighted in the MainPanel.
5. WHEN a conversation is loaded, THE continuation area SHALL become visible if the main thread contains at least one assistant message.
6. WHEN a conversation is loaded, THE in-memory `state.conversation` SHALL be replaced with the loaded conversation data.
7. IF the `GET /api/conversations/:id` request fails with a 404, THEN THE frontend SHALL display an error message and refresh the ConversationList to remove the stale entry.
8. IF the `GET /api/conversations/:id` request fails with a non-404 error, THEN THE frontend SHALL display an error message without modifying the current conversation state.

---

### Requirement 5: Conversation Title Display

**User Story:** As a user, I want to see the current conversation's title at the top of the main content area, so that I know which conversation I'm viewing.

#### Acceptance Criteria

1. THE ConversationTitle SHALL be displayed at the top of the main content area, above the rendered explanation sections.
2. WHEN a new conversation is created or the page first loads, THE ConversationTitle SHALL display "Untitled Conversation".
3. WHEN a `title` SSE event is received during streaming, THE ConversationTitle SHALL update to display the received title in real time.
4. WHEN a saved conversation is loaded, THE ConversationTitle SHALL display the loaded conversation's title.
5. THE ConversationTitle SHALL be styled distinctly from the explanation content (e.g., smaller font, secondary color) so it reads as metadata rather than part of the explanation.

---

### Requirement 6: Sidebar Refresh After Mutations

**User Story:** As a user, I want the sidebar conversation list to stay current after I interact with conversations, so that I always see accurate information.

#### Acceptance Criteria

1. WHEN a main thread message streaming completes (the `done` SSE event is received on `/api/ask` or `/api/continue`), THE ConversationList SHALL refresh by re-fetching from `GET /api/conversations`.
2. WHEN a side thread message streaming completes (the `done` SSE event is received on `/api/side-question` or `/api/side-followup`), THE ConversationList SHALL refresh by re-fetching from `GET /api/conversations`.
3. WHEN a new conversation is created via the "New Conversation" button, THE ConversationList SHALL refresh by re-fetching from `GET /api/conversations`.
4. WHILE the Sidebar is hidden, THE ConversationList refresh SHALL still occur so the list is current when the Sidebar is next opened.

---

### Requirement 7: Relative Timestamp Formatting

**User Story:** As a user, I want to see human-readable relative timestamps on conversation entries, so that I can quickly gauge how recent each conversation is.

#### Acceptance Criteria

1. THE ConversationEntry SHALL display the `updatedAt` field as a relative timestamp string (e.g., "just now", "5 minutes ago", "2 hours ago", "3 days ago").
2. THE relative timestamp formatter SHALL handle the following time ranges: seconds ("just now"), minutes ("N minutes ago"), hours ("N hours ago"), days ("N days ago"), and beyond 30 days (a short date string such as "Jan 15").
3. THE relative timestamp formatter SHALL compute the difference between the current time and the `updatedAt` value at the moment of rendering.

---

### Requirement 8: CSS Custom Highlight API Preservation

**User Story:** As a developer, I want the existing CSS Custom Highlight API anchoring to continue working after conversations are loaded from the library, so that side thread anchors remain visually connected to their source text.

#### Acceptance Criteria

1. WHEN a conversation with side threads is loaded from the library, THE frontend SHALL call the existing `highlightAnchor` function for each side thread using the anchor's `messageId`, `startOffset`, and `endOffset`.
2. WHEN a conversation is loaded, THE existing `anchorRanges` array SHALL be cleared before re-applying highlights, so stale ranges from the previous conversation do not persist.
3. WHEN a conversation is loaded, THE anchor connector lines SHALL be redrawn by calling the existing `drawAnchorConnectors` function after all margin notes and highlights are rendered.
4. WHILE the CSS Custom Highlight API is not supported by the browser, THE frontend SHALL degrade gracefully by skipping highlight registration without errors.
