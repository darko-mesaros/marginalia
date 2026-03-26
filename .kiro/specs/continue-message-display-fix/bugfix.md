# Bugfix Requirements Document

## Introduction

When a user sends a follow-up message via the "continue" flow (`POST /api/continue`), the user's own message is not displayed in the main thread panel. The LLM response streams back and renders correctly, but the user's continuation question is visually absent — it gets "eaten." The message is correctly stored in both the frontend state (`state.conversation.mainThread`) and the backend (`ConversationStore`), and it appears when the conversation is reloaded via `loadConversation()`. The bug is purely a rendering omission in the live `submitContinuation()` flow in `frontend/app.js`.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user submits a continuation question via the continue input THEN the system does not render the user's question text in the main panel — only the `<hr>` divider and the assistant's streaming response section are added to the DOM

1.2 WHEN a user submits multiple continuation questions in a single session THEN none of the user's continuation messages are visible in the main panel, making the conversation appear as a series of disconnected assistant responses separated by dividers

### Expected Behavior (Correct)

2.1 WHEN a user submits a continuation question via the continue input THEN the system SHALL render the user's question text as a styled div in the main panel, positioned after the `<hr>` divider and before the assistant's response section, matching the style used by `loadConversation()` (font-weight 600, secondary text color)

2.2 WHEN a user submits multiple continuation questions in a single session THEN each continuation question SHALL be visible in the main panel above its corresponding assistant response, producing a coherent readable conversation thread

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user submits the initial question via the ask input THEN the system SHALL CONTINUE TO render the assistant's streaming response in the main panel as it does today

3.2 WHEN a saved conversation is loaded via the conversation library THEN the system SHALL CONTINUE TO render all user messages (including continuation messages) and assistant responses correctly with dividers between continuation exchanges

3.3 WHEN a continuation question is submitted THEN the system SHALL CONTINUE TO add the user message to `state.conversation.mainThread` and send it to the backend via `POST /api/continue`

3.4 WHEN a continuation response finishes streaming THEN the system SHALL CONTINUE TO store the assistant message in state, re-enable the continuation input, and refresh the conversation list
