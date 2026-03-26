# Tech Stack

## Runtime & Language
- **Node.js 18+** with **TypeScript** (ES2022, Node16 module resolution)
- Executed directly via `tsx` (no compile step needed for dev/run)

## Backend
- **Express 5** — HTTP server and routing
- **Strands Agents SDK** (`@strands-agents/sdk`) — LLM agent with Bedrock integration
- **AWS Bedrock** — LLM provider (default model: `qwen.qwen3-vl-235b-a22b`)
- **MCP SDK** (`@modelcontextprotocol/sdk`) — MCP server integration via stdio transport
- **SSE** (Server-Sent Events) — streaming responses to the frontend
- **uuid** — ID generation

## Frontend
- Vanilla HTML/JS — no build step, no framework
- Served as static files from `frontend/`
- CDN dependencies: `marked.js`, `highlight.js`, `tippy.js`, `DOMPurify`
- CSS Custom Highlight API for text selection anchoring

## Testing
- **Vitest** — test runner
- **fast-check** — property-based testing
- Tests live in `src/__tests__/`, named `*.test.ts`

## Common Commands

```bash
# Install dependencies
npm install

# Start server (production-style)
npm start

# Development with auto-reload
npm run dev

# Run all tests (single pass)
npm test

# TypeScript compile check (passes as of 2026-03-22)
npm run build
```

## Build Notes

- `npm run build` passes — root cause of prior failures was Node16 ESM resolution requiring explicit `.js` extensions on all internal and test imports
- All imports must use `.js` extension even for `.ts` source files (Node16 module resolution requirement)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `BEDROCK_MODEL_ID` | `qwen.qwen3-vl-235b-a22b` | Bedrock model ID for main agent |
| `TITLE_MODEL_ID` | (falls back to `BEDROCK_MODEL_ID`) | Bedrock model ID for title generation |
| `MARGINALIA_DATA_DIR` | `~/.config/marginalia/` (Linux/macOS), `%APPDATA%/marginalia/` (Windows) | Override base data directory. Relative paths resolve against cwd. |
