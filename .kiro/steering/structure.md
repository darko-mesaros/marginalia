# Project Structure

```
marginalia/
├── src/                        # TypeScript backend source
│   ├── index.ts                # Entry point — Express app setup, config, wiring
│   ├── models.ts               # Domain types + factory functions (Message, SideThread, Conversation, ConversationSummary, etc.)
│   ├── conversation-store.ts   # In-memory store for the single active conversation
│   ├── conversation-ops.ts     # Business logic for submitting questions/followups (with validation)
│   ├── context-assembler.ts    # Builds LLM context windows for main vs side thread requests
│   ├── agent.ts                # MarginaliaAgent — creates a fresh Strands agent per request, passes full reconstructed context, translates SDK events to SSE stream; disconnectAll() for graceful shutdown
│   ├── data-dir.ts             # resolveDataDir() — single source of truth for base data directory (env var override or platform default)
│   ├── system-prompt.ts        # loadSystemPrompt(dataDir) / saveSystemPrompt(dataDir, content) — persistent system prompt I/O
│   ├── routes.ts               # Orchestration hub — validation, store mutation, context assembly, agent invocation, SSE streaming, persistence saves, settings endpoints
│   ├── persistence-adapter.ts  # PersistenceAdapter interface + JsonFilePersistenceAdapter (JSON file I/O under dataDir/chats/)
│   ├── conversation-library.ts # ConversationLibrary — CRUD wrapper over PersistenceAdapter with typed errors (LibraryError)
│   ├── title-generator.ts      # TitleGenerator — fire-and-forget async title generation via a separate Bedrock model call; processTitle() strips markdown formatting before trim/truncate
│   ├── sse.ts                  # SSE helpers (initSSE, writeTokenEvent, writeDoneEvent, etc.)
│   ├── validation.ts           # Express middleware for request body validation
│   ├── layout.ts               # HTML layout/rendering utilities
│   ├── mcp-config-manager.ts    # McpConfigManager — reads/writes mcp.json from dataDir (atomic save via tmp+rename, validation, defaults)
│   ├── retry.ts                # Retry logic utilities
│   └── __tests__/              # Vitest test files (mirrors src structure)
├── data/                       # (legacy — data now stored in ~/.config/marginalia/ by default)
│   └── ...                     # Override with MARGINALIA_DATA_DIR env var
├── frontend/                   # Static frontend (no build step)
│   ├── index.html              # Single-page app shell (includes collapsible sidebar for conversation library)
│   ├── color-palette.js        # 32-color palette, getThreadColor(index), hexToRgba() — pure functions, no DOM deps
│   ├── connector-math.js       # Pure math for SVG connector path computation
│   └── app.js                  # All frontend logic (vanilla JS) — conversation library sidebar, streaming, side threads, text selection
├── package.json
├── tsconfig.json               # ES2022, Node16 modules, strict mode
└── vitest.config.ts
```

## Architecture Patterns

- **Conversation persistence**: Conversations are auto-saved to JSON files under `dataDir/chats/` via `ConversationLibrary` → `JsonFilePersistenceAdapter`. The store remains the in-memory source of truth; persistence is fire-and-forget on each mutation.
- **Separation of concerns**: validation middleware → conversation-ops (business logic) → store mutation → context assembly → agent streaming → SSE response → persistence save
- **Factory functions**: all domain objects created via `createMessage()`, `createConversation()`, etc. in `models.ts`
- **MCP config persistence**: MCP server configs are persisted to `dataDir/mcp.json` via `McpConfigManager`. The file is loaded once on startup to seed `AppConfig.mcpServers`, then written (fire-and-forget, atomic) on every add/remove/toggle. Servers can be enabled/disabled without removal via `PATCH /api/settings/mcp-servers/:id`.
- **Dependency injection**: `createRouter()` accepts `{ store, agent, config, library, titleGenerator, mcpConfigManager, dataDir }` — makes testing straightforward
- **Context assembly**: `ContextAssembler` is the single place that decides what the LLM sees; it projects the graph-like conversation state (main thread + side threads + anchors) into a linear message array per request
- **Fresh agent per request**: `MarginaliaAgent` creates a new Strands agent for each invocation, passing the full reconstructed message array and a request-specific system prompt. Strands is used as a per-invocation execution engine, not a long-lived history store. This avoids state drift between app-managed history and Strands-managed history.
- **routes.ts is the orchestration hub**: it handles validation, store mutation, context assembly, agent invocation, SSE streaming, persistence saves, and settings endpoints in one place
- **Typed error boundaries**: `PersistenceError` for storage I/O, `LibraryError` (with `NOT_FOUND` / `INTERNAL` codes) for route-level error handling — routes never inspect raw `fs` error codes
- **Centralized data directory**: `resolveDataDir()` in `data-dir.ts` is the single source of truth for the base data directory — checks `MARGINALIA_DATA_DIR` env var first, falls back to `~/.config/marginalia/` (Linux/macOS) or `%APPDATA%/marginalia/` (Windows)
- **Persistent system prompt**: System prompt is loaded from `dataDir/system-prompt.md` on startup and saved on change via `PUT /api/settings`. Empty prompt deletes the file and reverts to the built-in default.
- **Graceful shutdown**: `registerShutdownHandlers()` in `index.ts` listens for SIGINT/SIGTERM, calls `agent.disconnectAll()` with a 5-second timeout to prevent orphaned MCP child processes

## Conventions

- All imports use `.js` extension (Node16 ESM resolution requires it even for `.ts` files)
- Validation happens at two layers: Express middleware (`validation.ts`) for HTTP shape, and `conversation-ops.ts` for business rules
- SSE events follow a consistent shape: `{ type, ...payload }` — token, tool_use, done, error
- API uses snake_case for JSON fields (`selected_text`, `anchor_position`, `thread_id`)
- Internal TypeScript uses camelCase
- Tests use property-based testing (fast-check) alongside unit tests
