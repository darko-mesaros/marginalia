# Design Document: Conversation Library UI

## Overview

This design adds a collapsible sidebar, conversation list, and supporting UI elements to Marginalia's frontend so users can browse, create, and load saved conversations. All work is confined to `frontend/index.html` and `frontend/app.js` — vanilla HTML/JS with no build step, no framework, no Tailwind.

The backend API is already implemented:
- `GET /api/conversations` → `ConversationSummary[]` sorted by most recent
- `GET /api/conversations/:id` → full `Conversation` object (replaces active conversation in store)
- `POST /api/conversations/new` → `{ id }` (creates fresh conversation, cleans up empty ones)
- The `title` SSE event is already emitted during `/api/ask` streaming

The frontend currently has no awareness of multiple conversations. This design introduces:
1. A sidebar panel with a toggle button, "New Conversation" button, and a conversation list
2. A conversation title display above the main panel
3. Logic to load a saved conversation (re-rendering main thread, side threads, and CSS Custom Highlight API anchors)
4. Automatic sidebar refresh after any streaming completes
5. A pure-function relative timestamp formatter

### Design Rationale

- **No new files**: All changes go into the existing `index.html` and `app.js` to keep the zero-build-step architecture intact.
- **CSS Grid adjustment**: The current `body` grid is `grid-template-rows: auto 1fr`. The content area uses `grid-template-columns: minmax(0, 1fr) 340px`. The sidebar will be added as a new column in `#content-area`, toggled via a CSS class on the body or content area.
- **Sidebar hidden by default**: Avoids layout shift on first load. The toggle button lives in the input bar alongside the existing settings button.
- **Fetch on visibility**: The conversation list fetches from the API each time the sidebar opens, plus after every streaming `done` event, so it's always current.
- **Pure rendering functions**: Loading a conversation re-uses existing rendering patterns (markdown → sanitize → innerHTML) and existing `highlightAnchor` / `drawAnchorConnectors` functions.

## Architecture

```mermaid
graph TD
    subgraph "index.html"
        IB["#input-bar (toggle btn added)"]
        CA["#content-area"]
        SB["#sidebar (new)"]
        MC["#main-column"]
        CT["#conversation-title (new)"]
        MP["#main-panel"]
        MNP["#margin-note-panel"]
    end

    subgraph "app.js"
        TS["toggleSidebar()"]
        FL["fetchConversationList()"]
        RC["renderConversationList()"]
        NC["handleNewConversation()"]
        LC["loadConversation(id)"]
        RMT["renderMainThread(messages)"]
        RST["renderSideThreads(threads)"]
        RAH["reapplyHighlights(threads)"]
        FRT["formatRelativeTime(date)"]
        RTH["handleTitleEvent(title)"]
    end

    subgraph "Backend API"
        API1["GET /api/conversations"]
        API2["GET /api/conversations/:id"]
        API3["POST /api/conversations/new"]
    end

    IB -->|click| TS
    TS -->|toggle class| SB
    SB --> FL
    FL -->|fetch| API1
    API1 -->|ConversationSummary[]| RC
    RC -->|click entry| LC
    LC -->|fetch| API2
    API2 -->|Conversation| RMT
    API2 -->|Conversation| RST
    RST --> RAH
    NC -->|fetch| API3
    API3 -->|{ id }| NC
    RC --> FRT
    RTH -->|SSE title event| CT
```

### Layout Changes

The current grid layout:

```
┌──────────────────────────────────────────────┐
│ #input-bar (full width)                      │
├──────────────────────┬───────────────────────┤
│ #main-column         │ #margin-note-panel    │
│  ├─ #main-panel      │                       │
│  └─ #continuation    │                       │
└──────────────────────┴───────────────────────┘
```

Becomes (when sidebar is visible):

```
┌──────────────────────────────────────────────┐
│ #input-bar (full width, toggle btn added)    │
├────────┬─────────────┬───────────────────────┤
│#sidebar│#main-column  │ #margin-note-panel   │
│        │ ├─ #title    │                       │
│        │ ├─ #main     │                       │
│        │ └─ #cont.    │                       │
└────────┴─────────────┴───────────────────────┘
```

The sidebar is toggled by adding/removing a `.sidebar-open` class on `#content-area`. When hidden, the sidebar has `display: none` and the main column takes the full first column. When visible, the grid gains a `260px` sidebar column.

## Components and Interfaces

### 1. ToggleButton (HTML + JS)

A `<button>` in `#input-bar` with a hamburger icon (☰). Placed before the question input.

```html
<button id="sidebar-toggle-btn" type="button" aria-label="Open conversation library">☰</button>
```

JS handler: toggles `.sidebar-open` on `#content-area`, updates `aria-label`, and calls `fetchConversationList()` when opening.

### 2. Sidebar Panel (HTML + CSS)

```html
<nav id="sidebar" role="complementary" aria-label="Conversation library">
  <button id="new-conversation-btn" type="button">+ New Conversation</button>
  <div id="conversation-list" aria-label="Saved conversations"></div>
</nav>
```

CSS: Fixed width `260px`, `overflow-y: auto`, `border-right: 1px solid var(--color-border)`, background `var(--color-surface)`. Hidden by default via `display: none` when `.sidebar-open` is not present on `#content-area`.

### 3. ConversationList (JS)

`fetchConversationList()` — fetches `GET /api/conversations`, stores result, calls `renderConversationList()`.

`renderConversationList(summaries)` — clears `#conversation-list`, creates a `<button>` for each entry with title (truncated via CSS `text-overflow: ellipsis`) and relative timestamp. Highlights the active conversation. Shows placeholder text if empty, error message with retry button if fetch failed.

### 4. ConversationEntry (HTML rendered by JS)

```html
<button class="conversation-entry" data-id="{id}" type="button">
  <span class="conversation-entry-title">{title}</span>
  <span class="conversation-entry-time">{relativeTime}</span>
</button>
```

### 5. ConversationTitle (HTML + JS)

A `<div id="conversation-title">` inserted at the top of `#main-column`, above `#main-panel`.

```html
<div id="conversation-title">Untitled Conversation</div>
```

Styled with `font-size: 0.85rem`, `color: var(--color-text-secondary)`, `padding: 12px 32px 0`. Updated by:
- `handleTitleEvent(title)` — called when a `title` SSE event arrives
- `loadConversation(id)` — sets to loaded conversation's title
- `handleNewConversation()` — resets to "Untitled Conversation"

### 6. New Conversation Button (JS)

`handleNewConversation()`:
1. `POST /api/conversations/new`
2. On success: clear `#main-panel`, `#margin-note-panel`, `#continuation-area`, reset `state.conversation`, set title to "Untitled Conversation", re-enable and focus question input, clear `anchorRanges` and CSS highlights, refresh conversation list
3. On failure: show error message (toast or inline), do not clear current conversation

### 7. loadConversation(id) (JS)

1. `GET /api/conversations/:id`
2. On success:
   - Replace `state.conversation` with loaded data
   - Clear `#main-panel` and re-render main thread messages:
     - User messages: render as continuation dividers with the question text
     - Assistant messages: render as `<section data-message-id="{id}">` with `renderMarkdown(content)`
   - Set conversation title
   - Clear `#margin-note-panel` and re-render side threads as margin notes (reusing `renderMarginNote` pattern but with pre-filled content instead of streaming)
   - Clear `anchorRanges`, clear CSS highlights, then call `highlightAnchor()` for each side thread
   - Call `drawAnchorConnectors()` after all notes are rendered
   - Show continuation area if main thread has assistant messages
3. On 404: show error, refresh conversation list
4. On other error: show error, don't modify current state

### 8. formatRelativeTime(dateString) (JS — pure function)

Computes the difference between `now` and the given ISO date string. Returns:
- `< 60s` → `"just now"`
- `< 60m` → `"N minutes ago"` (singular for 1)
- `< 24h` → `"N hours ago"` (singular for 1)
- `< 30d` → `"N days ago"` (singular for 1)
- `≥ 30d` → short date string like `"Jan 15"` or `"Jan 15, 2024"` (if different year)

Accepts an optional `now` parameter for testability.

### 9. Sidebar Refresh Logic (JS)

After every `done` SSE event in `submitQuestion`, `submitContinuation`, `submitSideQuestion`, and `submitSideFollowup`, call `refreshConversationList()`. This function fetches and re-renders regardless of sidebar visibility, so the list is current when next opened.

### 10. Title SSE Event Handling (JS)

The existing SSE parsing in `submitQuestion` needs a new case for `event: "title"`:

```js
case "title": {
  const title = evt.data.title;
  if (title) {
    state.conversation.title = title;
    updateConversationTitle(title);
  }
  break;
}
```

## Data Models

### Frontend State Additions

```js
const state = {
  conversation: {
    id: null,           // NEW — active conversation ID
    title: "Untitled Conversation", // NEW
    mainThread: [],
    sideThreads: [],
  },
  conversationList: [], // NEW — ConversationSummary[] cache
  // ... existing settings, ui
};
```

### ConversationSummary (from API)

```ts
interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  messageCount: number;
}
```

### Conversation (from API — full load)

```ts
interface Conversation {
  id: string;
  title: string;
  mainThread: Message[];
  sideThreads: SideThread[];
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolInvocations: ToolInvocation[];
  timestamp: string;  // ISO 8601
}

interface SideThread {
  id: string;
  anchor: {
    messageId: string;
    startOffset: number;
    endOffset: number;
    selectedText: string;
  };
  messages: Message[];
  collapsed: boolean;
}
```

### CSS Additions

New CSS custom properties and selectors following existing patterns:

```css
/* Sidebar */
#sidebar { /* hidden by default */ }
#content-area.sidebar-open #sidebar { display: flex; }
#content-area.sidebar-open { grid-template-columns: 260px minmax(0, 1fr) 340px; }

/* Conversation entries */
.conversation-entry { /* button reset, full width, hover state */ }
.conversation-entry.active { /* highlight for current conversation */ }
.conversation-entry-title { /* ellipsis truncation */ }
.conversation-entry-time { /* secondary color, small font */ }

/* Conversation title */
#conversation-title { /* metadata styling above main panel */ }
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Toggle consistency

*For any* initial hidden state and any sequence of N toggle clicks, the sidebar should be visible if and only if N is odd, and the toggle button's `aria-label` should be `"Close conversation library"` when visible and `"Open conversation library"` when hidden.

**Validates: Requirements 1.3, 1.7**

### Property 2: Conversation list entry rendering

*For any* array of `ConversationSummary` objects, the rendered conversation list should contain exactly one entry per summary, and each entry should contain the summary's title text and a non-empty relative timestamp string derived from its `updatedAt` field.

**Validates: Requirements 2.2, 2.3**

### Property 3: State reset produces clean defaults

*For any* conversation state (with arbitrary main thread messages, side threads, and a non-default title), calling the reset function should produce a state where `mainThread` is empty, `sideThreads` is empty, and `title` equals `"Untitled Conversation"`.

**Validates: Requirements 3.3, 3.4**

### Property 4: Loaded conversation rendering completeness

*For any* valid `Conversation` object with N assistant messages in the main thread and M side threads, after loading and rendering: the main panel should contain exactly N `<section>` elements each with a `data-message-id` matching the corresponding assistant message ID, and the margin note panel should contain exactly M margin notes each containing the side thread's first user message question text and the assistant response content.

**Validates: Requirements 4.2, 4.3**

### Property 5: Continuation area visibility

*For any* loaded conversation, the continuation area should be visible if and only if the main thread contains at least one message with `role === "assistant"`.

**Validates: Requirements 4.5**

### Property 6: State replacement on load

*For any* valid `Conversation` object, after loading it, `state.conversation.id` should equal the loaded conversation's `id`, `state.conversation.title` should equal the loaded conversation's `title`, `state.conversation.mainThread` should have the same length and message IDs as the loaded conversation's `mainThread`, and `state.conversation.sideThreads` should have the same length and thread IDs as the loaded conversation's `sideThreads`.

**Validates: Requirements 4.6, 5.4**

### Property 7: Relative timestamp formatting

*For any* ISO 8601 date string and a reference `now` time, `formatRelativeTime(dateString, now)` should return: `"just now"` when the difference is less than 60 seconds, `"N minutes ago"` (with correct singular/plural) when less than 60 minutes, `"N hours ago"` when less than 24 hours, `"N days ago"` when less than 30 days, and a short date string (e.g. `"Jan 15"`) when 30 days or more.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 8: Anchor ranges cleanup on load

*For any* sequence of two conversation loads where the first conversation has P side threads and the second has Q side threads, after the second load completes, the `anchorRanges` array should contain exactly Q entries (not P + Q), ensuring stale highlights from the previous conversation do not persist.

**Validates: Requirements 8.2**

## Error Handling

| Scenario | Behavior | User Feedback |
|---|---|---|
| `GET /api/conversations` fails | Conversation list shows error message with "Retry" button | Inline error in sidebar |
| `GET /api/conversations` returns empty `[]` | Placeholder message: "No saved conversations" | Inline placeholder in sidebar |
| `POST /api/conversations/new` fails | Current conversation state preserved | Inline error in sidebar or brief toast |
| `GET /api/conversations/:id` returns 404 | Error message shown, conversation list refreshed to remove stale entry | Inline error |
| `GET /api/conversations/:id` returns 5xx | Error message shown, current conversation state preserved | Inline error |
| CSS Custom Highlight API unsupported | `highlightAnchor` returns early (existing guard: `if (!CSS.highlights) return`) | No visual feedback — silent degradation |
| Network error during any fetch | Caught in try/catch, error displayed | Inline error with context |

Error messages follow the existing pattern in `app.js`: inline elements with `color: #c62828`, `background: #ffebee`, `border-radius: 4px`.

No new error types are needed on the backend — all API error responses are already defined in `routes.ts`.

## Testing Strategy

### Unit Tests (Vitest)

Unit tests cover specific examples, edge cases, and integration points:

- `formatRelativeTime` edge cases: exactly 0 seconds, exactly 60 seconds boundary, exactly 30 days boundary, dates in a different year, invalid date strings
- Conversation list rendering: empty array shows placeholder, single entry renders correctly
- State reset: verify all fields return to defaults
- Toggle button: initial state is hidden, aria-label starts as "Open conversation library"
- Load conversation with no side threads: margin note panel is empty
- Load conversation with no assistant messages: continuation area stays hidden
- 404 error handling: state is not modified, list is refreshed
- CSS Highlight API graceful degradation: no error thrown when `CSS.highlights` is undefined

### Property-Based Tests (fast-check)

The project already uses `fast-check` for property-based testing. Each property test must:
- Run a minimum of 100 iterations
- Reference its design document property in a comment tag
- Use `fast-check` arbitraries to generate random inputs

Since this feature is frontend-only (vanilla JS in `app.js`), the property-testable pure functions should be extracted or mirrored as testable units. The key pure function is `formatRelativeTime`, which can be tested directly. The rendering and state management properties (Properties 2–6, 8) are best validated through DOM-based integration tests or by testing the logic functions that drive them.

**Property test targets:**

| Property | Test approach | Library |
|---|---|---|
| Property 1: Toggle consistency | Generate random N (1–100), simulate N toggles, assert visibility = N % 2 === 1 and aria-label matches | fast-check |
| Property 2: List entry rendering | Generate random `ConversationSummary[]`, render, assert each entry has title + timestamp | fast-check |
| Property 3: State reset | Generate random conversation state, call reset, assert defaults | fast-check |
| Property 4: Rendering completeness | Generate random `Conversation` with N messages and M threads, render, count sections and notes | fast-check |
| Property 5: Continuation visibility | Generate random conversations (some with assistant messages, some without), assert visibility matches | fast-check |
| Property 6: State replacement | Generate random `Conversation`, load it, assert state matches | fast-check |
| Property 7: Relative timestamp | Generate random (date, now) pairs across all time ranges, assert output format matches range | fast-check |
| Property 8: Anchor cleanup | Generate two random conversations with different side thread counts, load sequentially, assert anchorRanges.length equals second conversation's thread count | fast-check |

**Tag format for each test:**
```js
// Feature: conversation-library-ui, Property 7: Relative timestamp formatting
```

Each correctness property is implemented by a single property-based test. Unit tests complement these by covering specific edge cases and error conditions that property tests don't target (network failures, 404 handling, CSS API degradation).
