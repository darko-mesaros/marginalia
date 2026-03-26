# Implementation Plan: App Config Improvements

## Overview

Implement three related improvements: a centralized `resolveDataDir()` function for platform-appropriate data storage, a persistent system prompt module, and graceful MCP server shutdown. Each task builds incrementally — data directory resolution first (shared dependency), then system prompt persistence, then shutdown handling, and finally startup wiring to connect everything.

## Tasks

- [x] 1. Create `src/data-dir.ts` — centralized data directory resolution
  - [x] 1.1 Implement `resolveDataDir()` function
    - Create `src/data-dir.ts` with a pure function that checks `MARGINALIA_DATA_DIR` env var first, then falls back to platform defaults (`~/.config/marginalia/` on Linux/macOS, `%APPDATA%/marginalia/` on Windows)
    - Use `path.resolve()` for env var values so relative paths resolve against cwd
    - Windows fallback: `os.homedir() + AppData/Roaming` if `%APPDATA%` is unset
    - No I/O — directory creation is the caller's responsibility
    - _Requirements: 3.1, 3.8, 3.9_

  - [x] 1.2 Write property test for `resolveDataDir` (Property 3)
    - **Property 3: resolveDataDir respects MARGINALIA_DATA_DIR**
    - For any non-empty string assigned to `MARGINALIA_DATA_DIR`, `resolveDataDir()` returns `path.resolve(value)`
    - Use `fc.string()` / `fc.oneof()` generators for absolute and relative path strings
    - Create `src/__tests__/data-dir.test.ts`
    - **Validates: Requirements 3.1, 3.8**

  - [x] 1.3 Write unit tests for `resolveDataDir`
    - Test platform default returns `~/.config/marginalia/` on Linux/macOS when env var is unset
    - Test absolute `MARGINALIA_DATA_DIR` is returned as-is
    - Test relative `MARGINALIA_DATA_DIR` resolves against cwd
    - _Requirements: 3.1, 3.8, 3.9_

- [x] 2. Create `src/system-prompt.ts` — persistent system prompt I/O
  - [x] 2.1 Implement `loadSystemPrompt(dataDir)` and `saveSystemPrompt(dataDir, content)`
    - Create `src/system-prompt.ts`
    - `loadSystemPrompt`: reads `system-prompt.md` from `dataDir`, returns trimmed content or `null` on ENOENT / empty file
    - `saveSystemPrompt`: writes content to `system-prompt.md`, deletes the file if content is empty (after trim)
    - Log warnings on unexpected I/O errors, never throw
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.2 Write property test for system prompt round-trip (Property 2)
    - **Property 2: System prompt save/load round-trip**
    - For any non-empty-after-trim string, `saveSystemPrompt` then `loadSystemPrompt` returns `content.trim()`
    - Use `fc.string()` filtered to non-empty-after-trim, use a temp directory per test run
    - Add to `src/__tests__/system-prompt.test.ts`
    - **Validates: Requirements 2.1, 2.3, 2.6**

  - [x] 2.3 Write unit tests for system prompt edge cases
    - `loadSystemPrompt` with missing file returns `null`
    - `saveSystemPrompt` with empty string deletes the file, subsequent load returns `null`
    - `loadSystemPrompt` with whitespace-only file returns `null`
    - _Requirements: 2.2, 2.4, 2.5, 2.6_

- [x] 3. Checkpoint — Verify data-dir and system-prompt modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add `disconnectAll()` to `MarginaliaAgent` and shutdown handler
  - [x] 4.1 Implement `disconnectAll()` on `MarginaliaAgent` in `src/agent.ts`
    - Add a public `async disconnectAll(): Promise<PromiseSettledResult<void>[]>` method
    - Use `Promise.allSettled` over `this.mcpClients.map(c => c.disconnect())`
    - Clear `this.mcpClients` array after settling
    - _Requirements: 1.1, 1.3, 1.5_

  - [x] 4.2 Write property test for `disconnectAll` (Property 1)
    - **Property 1: disconnectAll settles all clients**
    - For any array of mock MCP clients (each randomly resolving or rejecting), `disconnectAll()` returns a `PromiseSettledResult` array of the same length, with `disconnect()` called on every client
    - Use `fc.array(fc.boolean())` to determine which clients fail
    - Create `src/__tests__/agent-disconnect.test.ts`
    - **Validates: Requirements 1.1, 1.3**

  - [x] 4.3 Write unit tests for `disconnectAll` edge cases
    - `disconnectAll` with empty client list resolves with `[]`
    - `disconnectAll` clears the client list after settling
    - _Requirements: 1.4, 1.5_

  - [x] 4.4 Implement `registerShutdownHandlers(agent)` in `src/index.ts`
    - Register `SIGINT` and `SIGTERM` handlers that call `agent.disconnectAll()`
    - Use `Promise.race` with a 5-second timeout to prevent hanging
    - Add a `shuttingDown` flag to prevent double-fire
    - Log disconnect failures but don't block exit
    - Call `process.exit(0)` after race settles
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 5. Wire startup and routes to use new modules
  - [x] 5.1 Update `src/index.ts` startup to use `resolveDataDir()`
    - Import `resolveDataDir` from `./data-dir.js`
    - Import `loadSystemPrompt` from `./system-prompt.js`
    - Call `resolveDataDir()` to get `dataDir`, create `dataDir` and `dataDir/chats` with `fs.mkdir({ recursive: true })`
    - Pass `path.join(dataDir, "chats")` to `JsonFilePersistenceAdapter` constructor
    - Pass `path.join(dataDir, "mcp.json")` to `McpConfigManager` constructor
    - Load persisted system prompt via `loadSystemPrompt(dataDir)` and apply to `config.systemPrompt` if non-null
    - Pass `dataDir` to `createRouter` deps
    - Call `registerShutdownHandlers(agent)` after server starts listening
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.9_

  - [x] 5.2 Update `src/routes.ts` to persist system prompt on settings change
    - Add `dataDir: string` to the `RouterDeps` interface
    - Import `saveSystemPrompt` from `./system-prompt.js`
    - In `PUT /api/settings` handler, after updating `config.systemPrompt`, call `saveSystemPrompt(dataDir, systemPrompt)` (fire-and-forget with `.catch` error logging)
    - _Requirements: 2.3, 2.4, 2.5, 3.4_

- [x] 6. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All new files use `.js` extensions in imports (Node16 ESM requirement)
