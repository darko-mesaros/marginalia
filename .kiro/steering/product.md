# Marginalia — Product Overview

Marginalia is a web-based LLM explainer tool. Users ask a question, receive a markdown-rendered explanation in a main panel, then select any passage to ask a follow-up "side question" — which appears as a margin note anchored to that selection.

## Core Concepts

- **Main thread**: The primary Q&A conversation rendered as a document
- **Side thread**: A margin note conversation anchored to a specific text selection in the main thread
- **Context awareness**: The LLM sees the full main thread + all side thread discussions when answering any question
- **Continuation**: Users can continue the main conversation after side notes have been added

## Key Behaviors

- Text selection triggers a popover for asking a side question
- Each side thread is assigned a unique color from a 32-color palette based on creation order — the color is applied to the margin note border, connector line, and anchor text highlight for easy visual tracing
- Side thread answers are concise (2–4 sentences, plain prose, no headers/bullets)
- Main thread answers are structured markdown with headings, code blocks, examples
- All threads share context — the LLM is aware of every margin note discussion
- MCP tool integration is configurable via a settings UI
- MCP servers can be enabled/disabled individually via a toggle without removing them
- Tool invocations render as compact inline indicators (`🔧 Used {tool_name}`) — raw tool output is not shown to the user
- Conversation titles are markdown-stripped (`processTitle()` removes headings, bold, italic, links, etc.) before display
- Skill files can be added to extend the system prompt

## API Endpoints

- `POST /api/ask` — submit a main thread question (also triggers title generation on first message, emits `title` SSE event)
- `POST /api/side-question` — spawn a new side thread anchored to a text selection
- `POST /api/side-followup` — continue an existing side thread
- `POST /api/continue` — continue the main thread after side notes have been added
- `GET /api/conversations` — list saved conversations (returns `ConversationSummary[]` sorted by most recent)
- `GET /api/conversations/:id` — load a saved conversation (replaces active conversation in store)
- `POST /api/conversations/new` — start a fresh conversation (cleans up empty ones)
- `PATCH /api/settings/mcp-servers/:id` — toggle an MCP server's enabled state (`{ "enabled": bool }`)

## Persistence

Conversations are auto-saved to `./data/conversations/{id}.json` after every message. Each conversation has a `title` (generated asynchronously from the first question via a separate Bedrock model call) and an `updatedAt` timestamp bumped on every mutation.

MCP server configurations are persisted to `./data/mcp.json` in a VS Code-compatible format (top-level `mcpServers` map keyed by name). The file is loaded on startup and written atomically on every add/remove/toggle. Servers can be enabled or disabled without removal.

## Conversation Library UI

The frontend includes a collapsible sidebar for browsing and managing saved conversations:

- Sidebar toggles open/closed via a hamburger button in the top bar
- Lists all saved conversations sorted by most recent, showing title and relative timestamp
- Clicking a conversation loads it fully (main thread + all side threads with anchors)
- "New Conversation" button starts a fresh session (auto-cleans empty conversations)
- Active conversation title is displayed in the top bar header
- Conversation list auto-refreshes after every completed streaming response (ask, continue, side-question, side-followup)
- Title updates arrive via SSE `title` events and reflect in both the header and the sidebar list

## Architectural Decision: Conversation Ownership

`ConversationStore` is the canonical source of truth — not Strands' internal message history. The app's conversation model is non-linear (main thread + multiple anchored side threads), so `ContextAssembler` projects that structure into a linear message sequence for each request. Strands is used as a stateless per-invocation execution engine. A fresh agent is created per request with the full reconstructed context, avoiding state drift.

Known limitation: tool invocation history is not yet persisted back into stored messages, so replayable tool-aware context is future work.
