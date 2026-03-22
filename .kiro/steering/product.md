# Marginalia — Product Overview

Marginalia is a web-based LLM explainer tool. Users ask a question, receive a markdown-rendered explanation in a main panel, then select any passage to ask a follow-up "side question" — which appears as a margin note anchored to that selection.

## Core Concepts

- **Main thread**: The primary Q&A conversation rendered as a document
- **Side thread**: A margin note conversation anchored to a specific text selection in the main thread
- **Context awareness**: The LLM sees the full main thread + all side thread discussions when answering any question
- **Continuation**: Users can continue the main conversation after side notes have been added

## Key Behaviors

- Text selection triggers a popover for asking a side question
- Side thread answers are concise (2–4 sentences, plain prose, no headers/bullets)
- Main thread answers are structured markdown with headings, code blocks, examples
- All threads share context — the LLM is aware of every margin note discussion
- MCP tool integration is configurable via a settings UI
- Skill files can be added to extend the system prompt
