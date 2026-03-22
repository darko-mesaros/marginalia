# Implementation Plan: Conversation Saving

## Overview

Implement persistence for Marginalia conversations using JSON file storage. The work proceeds in layers: extend the domain model first, add the persistence adapter and library, wire in the routes, then add async title generation.

## Tasks

- [x] 1. Extend domain models with `title` and `updatedAt` fields
  - Add `title: string` and `updatedAt: Date` to the `Conversation` interface in `src/models.ts`
  - Update `createConversation()` to initialise `title` to `"Untitled Conversation"` and `updatedAt` to the same value as `createdAt`
  - Add `ConversationSummary` interface with `id`, `title`, `createdAt` (string), `updatedAt` (string), `messageCount`
  - _Requirements: 5.1, 5.2, 5.4, 2.3_

  - [x] 1.1 Write property test for new conversation defaults (Property 5)
    - **Property 5: New conversation title default**
    - **Validates: Requirements 5.2, 5.4**

- [x] 2. Update `ConversationStore` to bump `updatedAt` and support `setConversation`
  - In `src/conversation-store.ts`, update `addMainMessage` and `addSideMessage` to set `conversation.updatedAt = new Date()` after each mutation
  - Add `setConversation(conversation: Conversation): void` method that replaces the active conversation
  - _Requirements: 5.3, 3.3_

  - [x] 2.1 Write property test for `updatedAt` advancing on mutation (Property 6)
    - **Property 6: updatedAt advances on message addition**
    - **Validates: Requirements 5.3**

- [x] 3. Implement `JsonFilePersistenceAdapter` in `src/persistence-adapter.ts`
  - Define the `PersistenceAdapter` interface (`save`, `load`, `delete`, `listSummaries`, `exists`)
  - Define `PersistenceError` typed error class
  - Implement `JsonFilePersistenceAdapter` class with `dataDir` constructor param (default `./data/conversations`)
  - Implement `save`: serialise `Conversation` to JSON (Dates as ISO strings), write to `{dataDir}/{id}.json`
  - Implement `load`: read file, parse JSON, deserialise ISO strings back to `Date` objects, validate required fields (`id`, `mainThread`, `sideThreads`, `createdAt`), throw `PersistenceError` if invalid
  - Implement `delete`, `exists`, `listSummaries` (compute `messageCount` inline)
  - Call `fs.mkdir` with `recursive: true` lazily on first write
  - _Requirements: 1.3, 1.4, 7.1, 7.2, 7.3_

  - [x] 3.1 Write property test for serialisation round-trip (Property 1)
    - **Property 1: Conversation serialisation round-trip**
    - **Validates: Requirements 7.1, 7.2**

  - [x] 3.2 Write property test for deserialisation validation (Property 7)
    - **Property 7: Deserialisation validates required fields**
    - **Validates: Requirements 7.3**

- [x] 4. Implement `ConversationLibrary` in `src/conversation-library.ts`
  - Define `LibraryError` typed error class with `code: "NOT_FOUND" | "INTERNAL"`
  - Implement `ConversationLibrary` class wrapping `PersistenceAdapter`
  - Implement `save`, `load` (re-throw as `LibraryError`), `delete`, `exists`, `init` (calls adapter to ensure dir)
  - Implement `list()`: calls `adapter.listSummaries()`, sorts by `updatedAt` descending, returns result
  - _Requirements: 1.1, 1.2, 1.5, 2.2, 3.2_

  - [x] 4.1 Write property test for summary list sort order (Property 2)
    - **Property 2: Summary list is sorted by updatedAt descending**
    - **Validates: Requirements 2.2**

  - [x] 4.2 Write property test for `messageCount` accuracy (Property 3)
    - **Property 3: Summary messageCount matches conversation content**
    - **Validates: Requirements 2.3**

- [x] 5. Checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Wire `ConversationLibrary` into `createRouter` and existing endpoints
  - Update `RouterDeps` interface in `src/routes.ts` to include `library: ConversationLibrary`
  - In `/api/ask`: call `library.save(conversation)` before streaming starts (first message path), and again after the assistant message is committed to the store
  - In `/api/side-question`, `/api/side-followup`, `/api/continue`: call `library.save(conversation)` after each assistant message is committed
  - Update `src/index.ts` to instantiate `JsonFilePersistenceAdapter`, `ConversationLibrary`, call `library.init()`, and pass `library` to `createRouter`
  - _Requirements: 1.1, 1.2_

- [x] 7. Add `GET /api/conversations` and `GET /api/conversations/:id` endpoints
  - `GET /api/conversations`: call `library.list()`, return array; return `[]` with HTTP 200 if empty
  - `GET /api/conversations/:id`: call `library.load(id)`, call `store.setConversation(loaded)`, return full conversation; return HTTP 404 with `{ "error": "Conversation not found" }` on `LibraryError NOT_FOUND`
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.2, 3.3_

- [x] 8. Add `POST /api/conversations/new` endpoint
  - If the current conversation has zero messages, call `library.delete(conversation.id)` before resetting
  - Call `store.reset()`, then `store.getOrCreateConversation()` to get a fresh conversation
  - Call `library.save(newConversation)` immediately
  - Return `{ "id": newConversation.id }` with HTTP 201
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 9. Implement `TitleGenerator` in `src/title-generator.ts`
  - Implement `TitleGenerator` class with `titleModelId` constructor param (default from `TITLE_MODEL_ID` env var, fallback `amazon.nova-micro-v1:0`)
  - Use a separate `BedrockModel` instance (not the main agent) to call the model with a prompt instructing it to return ≤ 60 characters summarising the question
  - Implement `generateAsync(conversationId, firstQuestion, onComplete)`: fire-and-forget — starts generation in background, calls `onComplete(title)` on success, logs and swallows errors on failure
  - Truncate model output to 60 characters if it exceeds the limit
  - _Requirements: 4.1, 4.2, 4.3, 4.5_

  - [x] 9.1 Write property test for title length invariant (Property 4)
    - **Property 4: Title length invariant**
    - **Validates: Requirements 4.3**

- [x] 10. Wire `TitleGenerator` into `/api/ask` and emit `title` SSE event
  - Instantiate `TitleGenerator` in `src/index.ts` and pass it to `createRouter` via `RouterDeps`
  - In `/api/ask`, after the first user message is added: call `titleGenerator.generateAsync(...)` with an `onComplete` callback that updates `conversation.title`, calls `library.save(conversation)`, and — if `res.writable` — emits `writeSSEEvent(res, "title", { conversation_id, title })`
  - _Requirements: 4.1, 4.4, 4.6_

- [x] 11. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests use `fast-check` (already in devDependencies) with Vitest
- All new source files go in `src/`, test files in `src/__tests__/`
- All imports must use `.js` extension (Node16 ESM resolution)
- `LibraryError` and `PersistenceError` are the only error types routes should inspect — never raw `fs` error codes
