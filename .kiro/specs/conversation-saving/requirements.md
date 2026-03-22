# Requirements Document

## Introduction

Conversation saving adds persistence to Marginalia so that conversations are no longer lost when the page is refreshed or the server restarts. Users will be able to browse a library of past conversations and resume any of them. Each saved conversation gets a title generated asynchronously from the first question, using a smaller/cheaper Bedrock model to keep costs low. The feature covers the full lifecycle: auto-save on creation, title generation in the background, library browsing, and conversation loading.

## Glossary

- **Conversation**: The full state of a Marginalia session — a main thread plus zero or more anchored side threads, as defined in `models.ts`.
- **ConversationLibrary**: The persistent store of all saved conversations, indexed by conversation ID.
- **ConversationSummary**: A lightweight record used in library listings — contains `id`, `title`, `createdAt`, and `updatedAt` without full message content.
- **TitleGenerator**: The subsystem responsible for producing a short, descriptive title for a conversation using a dedicated LLM call.
- **TitleModel**: The smaller/cheaper Bedrock model used exclusively for title generation (distinct from the main `BEDROCK_MODEL_ID`).
- **PersistenceAdapter**: The interface that abstracts the storage backend (initially file-system JSON, swappable later).
- **ActiveConversation**: The conversation currently loaded and being interacted with in the UI.

---

## Requirements

### Requirement 1: Persist Conversations to Disk

**User Story:** As a user, I want my conversations to be saved automatically, so that I don't lose them when I close the browser or restart the server.

#### Acceptance Criteria

1. WHEN a new conversation is created, THE ConversationLibrary SHALL persist the conversation to disk before the first response is streamed to the client.
2. WHEN a message is added to the main thread or any side thread, THE ConversationLibrary SHALL update the persisted conversation within 5 seconds of the mutation.
3. THE PersistenceAdapter SHALL store each conversation as a separate JSON file under a configurable data directory (default: `./data/conversations/`).
4. IF the data directory does not exist at startup, THEN THE PersistenceAdapter SHALL create it before attempting any write operation.
5. IF a write operation fails, THEN THE ConversationLibrary SHALL log the error and continue serving the request without crashing.

---

### Requirement 2: List Saved Conversations

**User Story:** As a user, I want to see a library of my past conversations, so that I can find and resume one I care about.

#### Acceptance Criteria

1. THE ConversationLibrary SHALL expose a `GET /api/conversations` endpoint that returns an array of `ConversationSummary` objects.
2. WHEN the library is listed, THE ConversationLibrary SHALL return summaries sorted by `updatedAt` descending (most recent first).
3. THE ConversationSummary SHALL include: `id` (string), `title` (string), `createdAt` (ISO 8601 string), `updatedAt` (ISO 8601 string), and `messageCount` (total messages across main thread and all side threads).
4. IF no conversations exist, THEN THE ConversationLibrary SHALL return an empty array with HTTP 200.
5. WHEN a conversation has no generated title yet, THE ConversationLibrary SHALL return `"Untitled Conversation"` as the title in the summary.

---

### Requirement 3: Load a Saved Conversation

**User Story:** As a user, I want to resume a past conversation, so that I can continue where I left off.

#### Acceptance Criteria

1. THE ConversationLibrary SHALL expose a `GET /api/conversations/:id` endpoint that returns the full `Conversation` object for the given ID.
2. IF the requested conversation ID does not exist, THEN THE ConversationLibrary SHALL return HTTP 404 with a JSON error body `{ "error": "Conversation not found" }`.
3. WHEN a conversation is loaded via `GET /api/conversations/:id`, THE ConversationStore SHALL replace the active conversation with the loaded one.
4. WHEN a conversation is loaded, THE frontend SHALL re-render the full main thread and all side threads from the loaded conversation state.
5. THE ConversationLibrary SHALL expose a `POST /api/conversations/new` endpoint that clears the active conversation and creates a fresh one, returning the new conversation's `id`.

---

### Requirement 4: Asynchronous Title Generation

**User Story:** As a user, I want each conversation to have a descriptive title generated from my first question, so that I can identify conversations in the library without reading the full content.

#### Acceptance Criteria

1. WHEN the first user message is added to a conversation's main thread, THE TitleGenerator SHALL begin generating a title asynchronously without blocking the main response stream.
2. THE TitleGenerator SHALL use a dedicated TitleModel (configurable via `TITLE_MODEL_ID` environment variable, default: `amazon.nova-micro-v1:0`) that is separate from the main `BEDROCK_MODEL_ID`.
3. THE TitleGenerator SHALL produce a title of no more than 60 characters that summarises the first user question.
4. WHEN title generation completes successfully, THE ConversationLibrary SHALL persist the updated title and THE ConversationStore SHALL update the in-memory conversation's title field.
5. IF title generation fails, THEN THE TitleGenerator SHALL log the error and THE conversation SHALL retain the `"Untitled Conversation"` title without retrying.
6. WHEN title generation completes, THE server SHALL emit a `title` SSE event to any connected client with payload `{ "conversation_id": string, "title": string }`.

---

### Requirement 5: Conversation Title in Domain Model

**User Story:** As a developer, I want the `Conversation` type to carry a title field, so that the rest of the system can read and update it without extra lookups.

#### Acceptance Criteria

1. THE Conversation type SHALL include a `title` field of type `string`.
2. WHEN a new `Conversation` is created via `createConversation()`, THE Conversation SHALL have `title` set to `"Untitled Conversation"`.
3. THE Conversation type SHALL include an `updatedAt` field of type `Date` that is updated whenever a message is added to any thread.
4. WHEN `createConversation()` is called, THE Conversation SHALL have `updatedAt` set to the same value as `createdAt`.

---

### Requirement 6: New Conversation Flow

**User Story:** As a user, I want to start a fresh conversation from the library view, so that I can begin a new topic without losing my history.

#### Acceptance Criteria

1. WHEN `POST /api/conversations/new` is called, THE ConversationStore SHALL reset to a new empty conversation and THE ConversationLibrary SHALL persist the new conversation immediately.
2. THE `POST /api/conversations/new` endpoint SHALL return `{ "id": string }` with HTTP 201.
3. WHEN a new conversation is started while an existing conversation has no messages, THE ConversationLibrary SHALL delete the empty conversation from the library rather than keeping it.

---

### Requirement 7: Persistence Round-Trip Integrity

**User Story:** As a developer, I want the serialisation and deserialisation of conversations to be lossless, so that loaded conversations behave identically to in-memory ones.

#### Acceptance Criteria

1. FOR ALL valid `Conversation` objects, serialising to JSON and then deserialising SHALL produce a `Conversation` that is structurally equivalent to the original (round-trip property).
2. WHEN a `Conversation` is deserialised from disk, all `Date` fields (`createdAt`, `updatedAt`, `timestamp` on messages) SHALL be restored as `Date` objects, not strings.
3. THE PersistenceAdapter SHALL validate that a deserialised object contains the required fields (`id`, `mainThread`, `sideThreads`, `createdAt`) before returning it; IF validation fails, THEN THE PersistenceAdapter SHALL throw a descriptive error.
