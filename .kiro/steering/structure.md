# Project Structure

```
marginalia/
├── src/                        # TypeScript backend source
│   ├── index.ts                # Entry point — Express app setup, config, wiring
│   ├── models.ts               # Domain types + factory functions (Message, SideThread, Conversation, etc.)
│   ├── conversation-store.ts   # In-memory store for the single active conversation
│   ├── conversation-ops.ts     # Business logic for submitting questions/followups (with validation)
│   ├── context-assembler.ts    # Builds LLM context windows for main vs side thread requests
│   ├── agent.ts                # Strands Agent wrapper — streaming, MCP config, system prompt
│   ├── routes.ts               # Express router — all API endpoints
│   ├── sse.ts                  # SSE helpers (initSSE, writeTokenEvent, writeDoneEvent, etc.)
│   ├── validation.ts           # Express middleware for request body validation
│   ├── layout.ts               # HTML layout/rendering utilities
│   ├── retry.ts                # Retry logic utilities
│   └── __tests__/              # Vitest test files (mirrors src structure)
├── frontend/                   # Static frontend (no build step)
│   ├── index.html              # Single-page app shell
│   └── app.js                  # All frontend logic (vanilla JS)
├── package.json
├── tsconfig.json               # ES2022, Node16 modules, strict mode
└── vitest.config.ts
```

## Architecture Patterns

- **Single conversation**: `ConversationStore` holds one active `Conversation` in memory (no persistence)
- **Separation of concerns**: validation middleware → conversation-ops (business logic) → store mutation → agent streaming → SSE response
- **Factory functions**: all domain objects created via `createMessage()`, `createConversation()`, etc. in `models.ts`
- **Dependency injection**: `createRouter()` accepts `{ store, agent, config }` — makes testing straightforward
- **Context assembly**: `ContextAssembler` is the single place that decides what the LLM sees; main vs side thread assembly differs intentionally

## Conventions

- All imports use `.js` extension (Node16 ESM resolution requires it even for `.ts` files)
- Validation happens at two layers: Express middleware (`validation.ts`) for HTTP shape, and `conversation-ops.ts` for business rules
- SSE events follow a consistent shape: `{ type, ...payload }` — token, tool_use, done, error
- API uses snake_case for JSON fields (`selected_text`, `anchor_position`, `thread_id`)
- Internal TypeScript uses camelCase
- Tests use property-based testing (fast-check) alongside unit tests
