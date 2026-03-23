# Implementation Plan: MCP Persistent Configuration

## Overview

Implement persistent storage for MCP server configurations via `./data/mcp.json`, a PATCH endpoint for toggling enabled state, and a frontend toggle UI. The implementation follows the existing dependency-injection and fire-and-forget persistence patterns.

## Tasks

- [x] 1. Create McpConfigManager module
  - [x] 1.1 Create `src/mcp-config-manager.ts` with `McpConfigFileEntry`, `McpConfigFile` interfaces and `McpConfigManager` class
    - Implement `load()`: read `./data/mcp.json`, handle ENOENT (return `[]`), handle invalid JSON (log warning, return `[]`), validate each entry (`command` required, skip invalid), coerce optional fields (`args` → `[]`, `env` → `{}`, `enabled` → `true`), generate UUID `id` per entry, ignore extra fields
    - Implement `save()`: convert `MCPServerConfig[]` to map-keyed `McpConfigFile` format, serialize with 2-space indent, write to `.tmp` file then rename atomically, log errors without throwing
    - Import `MCPServerConfig` from `./models.js`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4, 7.2, 7.3_

  - [x] 1.2 Write property test: Configuration round-trip (Property 1)
    - **Property 1: Configuration round-trip**
    - For any array of valid `MCPServerConfig` objects, `save()` then `load()` produces equivalent entries (same name, command, args, env, enabled; ids excluded)
    - Use a temp directory for file I/O isolation
    - **Validates: Requirements 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 7.2**

  - [x] 1.3 Write property test: Loaded entries have unique IDs (Property 2)
    - **Property 2: Loaded entries have unique IDs**
    - For any valid `mcp.json` with N entries, `load()` returns N entries with distinct non-empty `id` values
    - **Validates: Requirements 2.3**

  - [x] 1.4 Write property test: Invalid entries skipped, defaults applied (Property 3)
    - **Property 3: Invalid entries are skipped, optional fields get defaults**
    - For any `mcp.json` with a mix of valid and invalid entries (missing `command`), `load()` returns only valid entries with `args` as `[]`, `env` as `{}`, `enabled` as `true` for missing optional fields
    - **Validates: Requirements 6.1, 6.4**

  - [x] 1.5 Write property test: Extra fields ignored (Property 4)
    - **Property 4: Extra fields are ignored**
    - For any valid `mcp.json`, adding arbitrary extra fields to entries does not change the loaded result
    - **Validates: Requirements 6.3**

- [x] 2. Checkpoint - Ensure McpConfigManager tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add PATCH endpoint and wire McpConfigManager into routes
  - [x] 3.1 Update `RouterDeps` interface in `src/routes.ts` to include `mcpConfigManager: McpConfigManager`
    - Destructure `mcpConfigManager` from deps in `createRouter()`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.2 Add `PATCH /api/settings/mcp-servers/:id` route in `src/routes.ts`
    - Validate `enabled` is a boolean → 422 with `{ "error": "enabled must be a boolean" }`
    - Validate server ID exists → 404 with `{ "error": "MCP server config not found" }`
    - Update `config.mcpServers[i].enabled`
    - Call `agent.configureMcp(config.mcpServers)` (best-effort)
    - Call `mcpConfigManager.save(config.mcpServers)` fire-and-forget
    - Return updated `MCPServerConfig` object
    - _Requirements: 4.3, 4.4, 5.1, 5.2, 5.3, 5.4_

  - [x] 3.3 Add fire-and-forget `mcpConfigManager.save()` calls to existing `POST /api/settings/mcp-servers` and `DELETE /api/settings/mcp-servers/:id` routes
    - Use `.catch(err => console.error(...))` pattern matching existing persistence calls
    - _Requirements: 3.1, 3.2, 3.4_

  - [x] 3.4 Write property test: PATCH toggle updates enabled state (Property 5)
    - **Property 5: PATCH toggle updates enabled state**
    - For any MCP server in config and any boolean value, PATCH with `{ "enabled": value }` returns the server with `enabled` set to that value
    - **Validates: Requirements 4.3, 5.4**

  - [x] 3.5 Write property test: PATCH rejects non-boolean enabled (Property 6)
    - **Property 6: PATCH rejects non-boolean enabled values**
    - For any non-boolean value (string, number, null, object, array), PATCH returns HTTP 422
    - **Validates: Requirements 5.2**

  - [x] 3.6 Write property test: PATCH returns 404 for non-existent ID (Property 7)
    - **Property 7: PATCH returns 404 for non-existent server ID**
    - For any UUID not matching a server in config, PATCH returns HTTP 404
    - **Validates: Requirements 5.3**

- [x] 4. Checkpoint - Ensure PATCH endpoint tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update startup sequence in index.ts
  - [x] 5.1 Update `src/index.ts` to instantiate `McpConfigManager`, call `load()` to seed `config.mcpServers`, call `agent.configureMcp()` if any enabled servers exist, and pass `mcpConfigManager` into `createRouter()`
    - Import `McpConfigManager` from `./mcp-config-manager.js`
    - Place config loading before router creation inside the async IIFE
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1_

- [x] 6. Add frontend toggle UI
  - [x] 6.1 Update `renderMcpServerList()` in `frontend/app.js` to add a toggle control (checkbox or button) for each server's enabled state
    - Toggle sends `PATCH /api/settings/mcp-servers/:id` with `{ "enabled": !current }`
    - On success, update `state.settings.mcpServers` and re-render
    - Disabled servers render with `opacity: 0.5` on the `<li>` element
    - No page reload required
    - _Requirements: 4.1, 4.2, 4.5, 4.6_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- The `McpConfigManager` test file should be `src/__tests__/mcp-config-manager.test.ts`
- All imports must use `.js` extension per Node16 ESM resolution
