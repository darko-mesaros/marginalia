# Implementation Plan: Marginalia

## Overview

Incremental implementation of the Marginalia LLM explainer tool. Starts with data models and core logic (context assembly, conversation management), then builds the Express API with SSE streaming, then the frontend UI, and finally wires everything together with settings, MCP, and responsive layout. Each step builds on the previous and ends integrated — no orphaned code.

## Tasks

- [x] 1. Set up project structure, dependencies, and core data models
  - [x] 1.1 Initialize the project with TypeScript, Express, Vitest, fast-check, and Strands SDK dependencies
    - Create `package.json` with dependencies: `express`, `@strands-agents/sdk`, `@strands-agents/mcp`, `@modelcontextprotocol/sdk`, `uuid`
    - Create `tsconfig.json` with strict mode, ES2022 target, Node module resolution
    - Create `vitest.config.ts`
    - Set up `src/` directory for backend and `frontend/` directory for static files
    - _Requirements: 9.1, 9.2_

  - [x] 1.2 Implement core data models and factory functions
    - Create `src/models.ts` with `Message`, `ToolInvocation`, `AnchorPosition`, `SideThread`, `Conversation`, `SkillFile`, `MCPServerConfig`, `AppConfig` interfaces
    - Implement `createMessage()`, `createSideThread()`, `createConversation()`, `getSideThread()`, `addSideThread()` factory/helper functions
    - Implement `getFullSystemPrompt()` that concatenates base system prompt with sorted skill file contents
    - _Requirements: 7.1, 7.2, 11.1, 11.2, 11.3_

  - [x] 1.3 Write property tests for data models
    - **Property 10: Full system prompt includes base prompt and all skill files**
    - **Validates: Requirements 11.3, 11.6**

  - [x] 1.4 Write property test for side thread creation
    - **Property 3: Side thread creation preserves anchor data**
    - **Validates: Requirements 3.2, 4.3, 5.1**

- [x] 2. Implement conversation store and context assembler
  - [x] 2.1 Implement the in-memory conversation store
    - Create `src/conversation-store.ts` with methods to get/create conversations, add messages to main thread, create side threads, add messages to side threads
    - Store manages a single active conversation (weekend project scope)
    - _Requirements: 7.1, 7.2, 8.2_

  - [x] 2.2 Implement the context assembler
    - Create `src/context-assembler.ts` with `ContextAssembler` class
    - Implement `assembleForMain()` — builds context from system prompt + skill files, main thread history, all side thread summaries with anchor metadata, and the new question
    - Implement `assembleForSide()` — builds context including main thread, all side threads, and the new question scoped to the target thread
    - Implement `formatSideThreads()` — formats side threads as structured context blocks with anchor text and thread identity markers
    - _Requirements: 3.3, 7.1, 7.2, 7.3, 7.4_

  - [x] 2.3 Write property tests for context assembler
    - **Property 4: Context assembly includes all side threads with anchor metadata**
    - **Validates: Requirements 3.3, 7.1, 7.2, 7.4**

  - [x] 2.4 Write property test for side thread follow-up context
    - **Property 6: Side thread follow-up includes thread history**
    - **Validates: Requirements 6.2**

- [x] 3. Implement conversation operations and validation
  - [x] 3.1 Implement question submission logic
    - Create `src/conversation-ops.ts` with functions for adding a question+response pair to the main thread, adding a side question+response to a side thread, and adding a continuation question+response
    - Each operation validates inputs (non-empty question, valid anchor for side questions)
    - _Requirements: 1.1, 1.2, 3.2, 3.4, 6.1, 8.2_

  - [x] 3.2 Implement input validation middleware
    - Create `src/validation.ts` with Express middleware for validating request bodies
    - Validate: non-empty question strings, non-empty selected_text for side questions, valid anchor_position with start < end, valid thread_id for follow-ups
    - Return HTTP 422 with descriptive validation messages on failure
    - _Requirements: 1.1, 3.4_

  - [x] 3.3 Write property tests for conversation operations
    - **Property 1: Question submission grows the main thread**
    - **Validates: Requirements 1.2**

  - [x] 3.4 Write property test for continuation append
    - **Property 8: Continuation appends to main thread**
    - **Validates: Requirements 8.2**

  - [x] 3.5 Write property test for chronological ordering
    - **Property 7: Side thread messages maintain chronological order**
    - **Validates: Requirements 6.3**

  - [x] 3.6 Write property test for side thread question and response
    - **Property 12: Side thread contains both question and response**
    - **Validates: Requirements 4.2**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Strands Agent integration with SSE streaming
  - [x] 5.1 Implement the Strands Agent wrapper
    - Create `src/agent.ts` with `MarginaliaAgent` class
    - Configure `Agent` from `@strands-agents/sdk` with Bedrock as default provider
    - Implement `streamResponse()` as an async generator yielding `StreamEvent` objects (token, tool_use, done, error)
    - Implement `configureMcp()` to connect MCP servers via `McpClient` + `StdioClientTransport` and rebuild the agent with discovered tools
    - _Requirements: 9.1, 9.2, 9.4, 12.1, 12.3, 12.4_

  - [x] 5.2 Implement retry logic with exponential backoff
    - Create `src/retry.ts` with `retryWithBackoff()` async generator
    - Implement exponential backoff: `baseDelay * 2^attempt + jitter` with max 3 retries
    - Implement `isThrottlingError()` to detect Bedrock rate limit responses
    - Yield `delay` events to notify the client of retry wait times
    - _Requirements: 9.3_

  - [x] 5.3 Implement SSE streaming utilities
    - Create `src/sse.ts` with helper functions to write SSE events (`token`, `tool_use`, `done`, `error`, `delay`) to an Express response
    - Handle client disconnect detection (response close event) to cancel in-flight requests
    - _Requirements: 9.4, 12.5_

  - [x] 5.4 Write property test for exponential backoff
    - **Property 9: Exponential backoff on throttle responses**
    - **Validates: Requirements 9.3**

  - [x] 5.5 Write property test for tool invocation SSE events
    - **Property 11: Tool invocations are serialized as SSE events**
    - **Validates: Requirements 12.5**

- [x] 6. Implement Express API routes
  - [x] 6.1 Implement the main question endpoint
    - Create `src/routes.ts` with Express router
    - `POST /api/ask` — validates input, calls conversation store to start main thread, assembles context, streams agent response via SSE, stores assistant message on completion
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 6.2 Implement side question and follow-up endpoints
    - `POST /api/side-question` — validates input (selected_text, question, anchor_position), creates side thread, assembles context with all threads, streams response, stores messages
    - `POST /api/side-followup` — validates thread_id and question, assembles context with thread history, streams response, appends to thread
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.4, 4.5, 6.1, 6.2, 7.4_

  - [x] 6.3 Implement continuation endpoint
    - `POST /api/continue` — validates input, assembles full context (main + all side threads), streams response, appends to main thread
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.2_

  - [x] 6.4 Implement settings endpoints
    - `GET /api/settings` — returns current system prompt, skill files, MCP server configs
    - `PUT /api/settings` — updates system prompt and Bedrock model ID
    - `POST /api/settings/skill-files` — adds a skill file (validates readable text/markdown content)
    - `DELETE /api/settings/skill-files/:id` — removes a skill file
    - `POST /api/settings/mcp-servers` — adds an MCP server config (command + args)
    - `DELETE /api/settings/mcp-servers/:id` — removes an MCP server config and reconfigures agent
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 12.2, 12.6_

  - [x] 6.5 Create the Express app entry point
    - Create `src/index.ts` — initializes Express app, mounts API routes, serves frontend static files from `frontend/`, loads default system prompt, starts server
    - _Requirements: 9.1, 9.2_

  - [x] 6.6 Write unit tests for input validation and error handling
    - Test empty question rejection (HTTP 422)
    - Test empty text selection rejection (HTTP 422)
    - Test Bedrock error produces SSE error event
    - Test MCP failure results in graceful degradation
    - _Requirements: 1.4, 3.4, 4.5, 12.6_

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the frontend — HTML structure and main panel
  - [x] 8.1 Create the base HTML page with CDN dependencies
    - Create `frontend/index.html` with CDN links for marked.js, highlight.js, tippy.js, @popperjs/core, DOMPurify
    - Set up CSS Grid layout: InputBar at top, MainPanel center, MarginNotePanel right side
    - Include responsive breakpoint at 1024px (side-by-side → stacked)
    - _Requirements: 2.1, 2.2, 10.1, 10.2, 10.3_

  - [x] 8.2 Implement the InputBar and MainPanel rendering
    - Create `frontend/app.js` with core frontend state object
    - Implement InputBar: text input + submit button, disabled after first submission
    - Implement MainPanel: scrollable area, renders markdown via `marked.parse()` + DOMPurify sanitization, each response block in a `<section data-message-id="...">`
    - Implement SSE consumption via `EventSource` for streaming token events into the MainPanel with incremental markdown rendering
    - Configure highlight.js as a marked.js extension for code block syntax highlighting
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 9.4_

  - [x] 8.3 Implement the ContinuationInput
    - Add text input below MainPanel content for continuing the main thread
    - On submit, POST to `/api/continue` and stream response into a new `<section>` appended to MainPanel
    - Visually separate each continuation exchange with a divider
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 9. Implement text selection and margin notes
  - [x] 9.1 Implement the TextSelectionPopover
    - On `mouseup` within MainPanel, check `window.getSelection()` for non-empty, non-collapsed selection
    - Create tippy.js instance at selection bounding rect with "Ask about this" button
    - On button click, transform popover into a text input for the side question
    - Capture: selected text string, character offsets relative to parent `<section>`, `data-message-id` of containing section
    - On submit, POST to `/api/side-question` with `{ selected_text, question, anchor_position }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 9.2 Implement MarginNotePanel and MarginNote components
    - Create right-side panel for margin notes using CSS Grid
    - Each MarginNote shows: selected text excerpt (clickable to scroll to anchor), user question, LLM response (streamed via SSE), follow-up input field
    - Implement collapse/expand toggle per note
    - Display loading indicator while streaming, error message on failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.4, 6.1, 6.3_

  - [x] 9.3 Implement CSS Custom Highlight API for anchor highlighting
    - After a margin note is created, create `Range` objects from stored offsets within the anchored `<section>`
    - Register highlights via `CSS.highlights.set('marginalia-anchors', highlight)`
    - Style with `::highlight(marginalia-anchors) { background-color: rgba(255, 213, 79, 0.3); }`
    - Highlights persist after text selection clears
    - _Requirements: 2.3, 3.2_

  - [x] 9.4 Implement margin note layout algorithm
    - Position notes vertically to align with anchor Y-position in MainPanel
    - Resolve overlaps by pushing notes downward while maintaining proximity to anchor
    - On narrow screens (≤1024px), stack notes below MainPanel instead
    - _Requirements: 5.3, 10.1, 10.2_

  - [x] 9.5 Write property test for margin note layout
    - **Property 5: Margin note layout produces non-overlapping positions**
    - **Validates: Requirements 5.3**

  - [x] 9.6 Write property test for markdown rendering
    - **Property 2: Markdown rendering produces correct HTML structure**
    - **Validates: Requirements 2.1**

- [x] 10. Implement side thread follow-ups in the frontend
  - [x] 10.1 Wire up side thread follow-up input
    - Each MarginNote's follow-up input submits to `POST /api/side-followup` with `{ thread_id, question }`
    - Stream response into the existing MarginNote, appending below prior messages
    - Display full side thread conversation history in chronological order
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 10.2 Implement tool invocation display
    - When SSE `tool_use` events arrive, render tool name, input summary, and result within the response content
    - Display in both MainPanel and MarginNote responses
    - _Requirements: 12.5_

- [x] 11. Implement settings UI and MCP configuration
  - [x] 11.1 Implement the SettingsDialog
    - Create modal dialog with three sections: SystemPromptEditor (textarea), SkillFileList (upload/remove/reorder via drag handles), MCPServerList (add/remove with command + args fields)
    - Load current settings via `GET /api/settings` on open
    - Save changes via `PUT /api/settings`, `POST/DELETE` for skill files and MCP servers
    - Validate skill files are readable text/markdown before upload
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 12.2, 12.6_

  - [x] 11.2 Write unit tests for settings CRUD operations
    - Test add/remove/reorder skill files
    - Test add/remove MCP server configs
    - Test skill file validation rejects binary files
    - _Requirements: 11.4, 11.5, 12.2_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript throughout (backend and frontend tests), with vanilla JS for the frontend runtime code
