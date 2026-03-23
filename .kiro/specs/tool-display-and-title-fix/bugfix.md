# Bugfix Requirements Document

## Introduction

Two related display bugs in Marginalia degrade the user experience when the LLM agent uses MCP tools and when conversation titles are generated. First, raw tool output (which can be entire web pages or large JSON payloads) is rendered directly into the response canvas, overwhelming the user with irrelevant content. Second, conversation titles sometimes contain markdown formatting characters (`#`, `**`, `*`, `_`, etc.) that appear literally in the UI instead of being stripped to plain text.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the LLM agent invokes an MCP tool (e.g., brave_web_search, fetch) during a main thread response THEN the system renders the full raw tool result as a markdown blockquote (`> **Tool:** ... > **Result:** <full output>`) directly into the response content area

1.2 WHEN the LLM agent invokes an MCP tool during a continuation response THEN the system renders the full raw tool result as a markdown blockquote directly into the response content area

1.3 WHEN the LLM agent invokes an MCP tool during a side thread or side followup response THEN the system renders the full raw tool result as a markdown blockquote directly into the margin note content area

1.4 WHEN the title generator LLM returns a title containing markdown characters (e.g., `# Strands Agents`, `**My Title**`, `_italic title_`) THEN the system displays the raw markdown characters literally in the conversation title header and sidebar entry

### Expected Behavior (Correct)

2.1 WHEN the LLM agent invokes an MCP tool during a main thread response THEN the system SHALL display only a compact, non-intrusive indicator showing the tool name (e.g., "🔧 Used brave_web_search") styled in a visually distinct color that differentiates it from the surrounding response text, without including the raw tool result in the rendered content

2.2 WHEN the LLM agent invokes an MCP tool during a continuation response THEN the system SHALL display only a compact indicator showing the tool name styled in a visually distinct color that differentiates it from the surrounding response text, without including the raw tool result in the rendered content

2.3 WHEN the LLM agent invokes an MCP tool during a side thread or side followup response THEN the system SHALL display only a compact indicator showing the tool name styled in a visually distinct color that differentiates it from the surrounding margin note text, without including the raw tool result in the margin note content

2.4 WHEN the title generator LLM returns a title containing markdown characters THEN the system SHALL strip all markdown formatting (headings, bold, italic, strikethrough, inline code, links, images, blockquotes, list markers) and display only the plain text content

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the LLM agent streams text tokens (non-tool events) during any response THEN the system SHALL CONTINUE TO render the streamed markdown content progressively in the appropriate panel

3.2 WHEN the LLM agent completes a response with a `done` event THEN the system SHALL CONTINUE TO store the assistant message in state and persist the conversation

3.3 WHEN the title generator returns a plain text title with no markdown characters THEN the system SHALL CONTINUE TO display the title as-is (trimmed and truncated to 60 characters)

3.4 WHEN a tool_use SSE event is emitted by the backend THEN the system SHALL CONTINUE TO send the full tool result in the SSE payload (the backend contract is unchanged; only the frontend rendering changes)

3.5 WHEN a user loads a saved conversation THEN the system SHALL CONTINUE TO render all main thread and side thread messages correctly
