# Implementation Plan: MCP Environment Variables

## Overview

Add environment variable support to the MCP server settings UI and strengthen backend validation. The backend model and transport wiring already support `env`, so the work focuses on: (1) backend validation in the route handler, (2) frontend Env_Editor widget in the MCP form, (3) env count display in the server list, and (4) property-based tests.

## Tasks

- [x] 1. Add backend validation for the `env` field in `POST /api/settings/mcp-servers`
  - [x] 1.1 Validate `env` field in the route handler (`src/routes.ts`)
    - After the existing `command` validation, add env validation logic:
      - If `env` is provided and is not a plain object (array, null, non-object), respond 422 with `"env must be a plain object"`
      - If `env` is a plain object but contains any non-string value, respond 422 with `"All env values must be strings"`
      - Strip entries where the key is an empty string (after trim)
      - Keep existing fallback to `{}` when `env` is omitted
    - Update the `mcpServer` object construction to use the validated/sanitized env
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.2 Write unit tests for env validation in the route handler
    - Add tests to `src/__tests__/routes.test.ts` in a new `describe` block under the existing `POST /api/settings/mcp-servers` tests
    - Test: rejects `env` as array → 422
    - Test: rejects `env` as null → 422
    - Test: rejects `env` with non-string values → 422
    - Test: strips empty-string keys from env
    - Test: accepts valid env object with string values → 201
    - Test: omitted env defaults to `{}`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.3 Write property test: Invalid env payloads are rejected with 422
    - **Property 3: Invalid env payloads are rejected with 422**
    - Generator: `fc.oneof(fc.array(...), fc.constant(null), fc.integer(), fc.string(), fc.dictionary(fc.string(), fc.oneof(fc.integer(), fc.boolean(), fc.constant(null))))` — various invalid env shapes
    - Assertion: Route handler responds 422; `config.mcpServers` length unchanged
    - Add to `src/__tests__/routes.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.5**

  - [x] 1.4 Write property test: Empty keys are stripped from stored env
    - **Property 4: Empty keys are stripped from stored env**
    - Generator: `fc.dictionary(fc.oneof(fc.constant(""), fc.string()), fc.string())` — env objects with some empty keys
    - Assertion: Stored `MCPServerConfig.env` has no empty-string keys; all non-empty-key entries preserved
    - Add to `src/__tests__/routes.test.ts`
    - **Validates: Requirements 3.3**

- [x] 2. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add the Env_Editor widget to the frontend MCP server form
  - [x] 3.1 Add env row container and button to `frontend/index.html`
    - Inside the MCP Servers `.settings-add-form`, after the args input and before the "Add MCP Server" button, add:
      - `<div id="mcp-env-rows" aria-label="Environment variables"></div>`
      - `<button type="button" id="add-env-row-btn" class="env-add-btn">+ Add Environment Variable</button>`
    - Add CSS for `.env-row` (flex row with key input, value input, remove button) and `.env-add-btn`
    - _Requirements: 1.1, 1.3_

  - [x] 3.2 Implement `addEnvRow()`, `collectEnvVars()`, and `clearEnvRows()` in `frontend/app.js`
    - `addEnvRow()`: Appends a new `.env-row` div to `#mcp-env-rows` containing a key input (`.env-key`, placeholder "KEY"), a value input (`.env-value`, placeholder "Value"), and a remove button (×)
    - `collectEnvVars()`: Iterates `.env-row` elements, reads key/value, skips empty keys, last value wins for duplicates → returns `Record<string, string>`
    - `clearEnvRows()`: Removes all `.env-row` children from `#mcp-env-rows`
    - Wire `#add-env-row-btn` click to `addEnvRow()`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 3.3 Update `addMcpServer()` to collect and send env vars
    - Replace the hardcoded `env: {}` in the fetch body with `collectEnvVars()`
    - After successful add, call `clearEnvRows()` to reset the env editor
    - _Requirements: 1.5, 1.7_

  - [x] 3.4 Write property test: Env collection produces correct object from key-value rows
    - **Property 1: Env collection produces correct object from key-value rows**
    - Since `collectEnvVars()` reads from the DOM, extract the pure logic into a testable function `buildEnvObject(pairs: [string, string][])` that can be tested independently
    - Generator: `fc.array(fc.tuple(fc.string(), fc.string()))` — list of (key, value) pairs
    - Assertion: Result contains only non-empty-key entries; for duplicates, last value wins
    - Add to a new test file `src/__tests__/env-editor.test.ts`
    - **Validates: Requirements 1.5, 1.6**

- [x] 4. Display env var count in the MCP server list
  - [x] 4.1 Update `renderMcpServerList()` in `frontend/app.js`
    - When `Object.keys(srv.env).length > 0`, append ` · N env vars` (or `1 env var` singular) to the detail span text
    - When env is empty or missing, show only command and args (no env indicator)
    - _Requirements: 2.1, 2.2, 5.1, 5.2_

  - [x] 4.2 Write property test: Env count display matches actual env object size
    - **Property 2: Env count display matches actual env object size**
    - Generator: `fc.dictionary(fc.string({minLength: 1}), fc.string())` — random env objects
    - Assertion: Rendered detail text contains correct count when N > 0, no indicator when N === 0
    - Add to `src/__tests__/env-editor.test.ts`
    - **Validates: Requirements 2.1, 2.2**

- [x] 5. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The transport wiring in `src/agent.ts` already passes `env` to `StdioClientTransport` — no changes needed (Requirements 4.1, 4.2, 4.3 are already satisfied)
- `GET /api/settings` already returns `mcpServers` including `env` — Requirement 5.1 is already satisfied
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
