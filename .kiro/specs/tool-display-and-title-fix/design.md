# Tool Display and Title Fix — Bugfix Design

## Overview

Two display bugs degrade the Marginalia user experience. First, when the LLM agent invokes MCP tools (e.g., `brave_web_search`, `fetch`), the frontend appends the full raw tool result as a markdown blockquote into the accumulated response content, overwhelming users with irrelevant data. Second, the `processTitle()` function in `title-generator.ts` only trims and truncates but does not strip markdown formatting, causing literal markdown characters (`#`, `**`, `_`, etc.) to appear in conversation titles.

The fix is scoped to two files: `frontend/app.js` (change all `tool_use` event handlers to render a compact indicator instead of the raw result) and `src/title-generator.ts` (add markdown stripping to `processTitle()`). The backend SSE contract is unchanged.

## Glossary

- **Bug_Condition (C)**: Two conditions: (1) a `tool_use` SSE event is received by the frontend during streaming, (2) `processTitle()` receives a string containing markdown formatting characters
- **Property (P)**: (1) Tool use events render as a compact, color-differentiated indicator showing only the tool name, (2) `processTitle()` returns plain text with all markdown syntax stripped
- **Preservation**: Token streaming, done event handling, plain-text title processing, backend SSE payloads, and saved conversation loading must remain unchanged
- **`accumulatedContent`**: The string variable in each streaming function (`submitQuestion`, `submitContinuation`, `submitSideQuestion`, `submitSideFollowup`) that accumulates the response text rendered to the DOM
- **`processTitle(raw)`**: The function in `src/title-generator.ts` that sanitizes raw LLM output into a display-ready title string

## Bug Details

### Bug Condition

The bugs manifest in two independent conditions:

**Bug 1 — Tool output rendering**: When the frontend receives a `tool_use` SSE event during any streaming response, the event handler appends a markdown blockquote containing the full raw tool result into `accumulatedContent`, which is then rendered as HTML via `renderMarkdown()`. This happens identically in four streaming functions: `submitQuestion()`, `submitContinuation()`, `submitSideQuestion()`, and `submitSideFollowup()`.

**Bug 2 — Title markdown**: When the title-generation LLM returns a string containing markdown formatting characters, `processTitle()` passes them through unchanged because it only trims whitespace and truncates length.

**Formal Specification:**
```
FUNCTION isBugCondition_ToolDisplay(input)
  INPUT: input of type SSEEvent
  OUTPUT: boolean

  RETURN input.event === "tool_use"
         AND input.data.tool_name IS defined
         AND input.data.result IS defined
END FUNCTION

FUNCTION isBugCondition_TitleMarkdown(input)
  INPUT: input of type string (raw title from LLM)
  OUTPUT: boolean

  RETURN input MATCHES any of:
         /^#{1,6}\s/m       (heading markers)
         OR /\*\*.+?\*\*/   (bold)
         OR /\*.+?\*/        (italic with asterisk)
         OR /_.+?_/          (italic with underscore)
         OR /~~.+?~~/        (strikethrough)
         OR /`.+?`/          (inline code)
         OR /\[.+?\]\(.+?\)/ (links)
         OR /!\[.*?\]\(.+?\)/(images)
         OR /^>\s/m          (blockquotes)
         OR /^[-*+]\s/m      (unordered list markers)
         OR /^\d+\.\s/m      (ordered list markers)
END FUNCTION
```

### Examples

- **Tool display — main thread**: User asks "What is Rust?", agent calls `brave_web_search`. Current: renders `> **Tool:** brave_web_search\n> **Result:** [500 lines of HTML]`. Expected: renders `🔧 Used brave_web_search` as a compact styled indicator.
- **Tool display — continuation**: User asks a follow-up, agent calls `fetch`. Current: same blockquote dump. Expected: same compact indicator.
- **Tool display — side thread**: User highlights text and asks a side question, agent calls a tool. Current: raw result floods the margin note. Expected: compact indicator in the margin note.
- **Title markdown — heading**: LLM returns `# Strands Agents Overview`. Current: title displays as `# Strands Agents Overview`. Expected: `Strands Agents Overview`.
- **Title markdown — bold**: LLM returns `**My Great Title**`. Current: title displays as `**My Great Title**`. Expected: `My Great Title`.
- **Title markdown — plain text**: LLM returns `Simple Title`. Current and expected: `Simple Title` (no change).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Text token streaming (`token` events) must continue to accumulate content and render progressively via `renderMarkdown()` in all four streaming functions
- The `done` event handler must continue to store the assistant message in state, persist the conversation, and update the UI
- Plain-text titles (no markdown characters) must continue to pass through `processTitle()` unchanged (trimmed and truncated to 60 chars)
- The backend SSE `tool_use` event payload must continue to include the full `tool_name`, `input`, and `result` fields — no backend changes
- Loading saved conversations must continue to render all main thread and side thread messages correctly

**Scope:**
All inputs that do NOT involve `tool_use` SSE events or markdown-containing title strings should be completely unaffected by this fix. This includes:
- All `token`, `done`, `error`, `title`, and `delay` SSE events
- Mouse clicks, keyboard input, and all other UI interactions
- Backend route handlers, SSE emission, agent streaming
- `processTitle()` calls with plain-text input

## Hypothesized Root Cause

Based on the code analysis, the root causes are clear and confirmed:

1. **Tool display — explicit blockquote construction**: In all four streaming functions in `frontend/app.js`, the `tool_use` event handler constructs a markdown blockquote string and appends it to `accumulatedContent`:
   ```javascript
   const toolInfo = `\n\n> **Tool:** ${evt.data.tool_name}\n> **Result:** ${evt.data.result || "..."}\n\n`;
   accumulatedContent += toolInfo;
   ```
   This is by design (not an accidental regression) — the original implementation chose to render tool results inline. The fix changes this design choice.

2. **Title markdown — missing stripping step**: The `processTitle()` function in `src/title-generator.ts` performs only `trim()` and length truncation:
   ```typescript
   let title = raw.trim();
   if (title.length === 0) title = "Untitled Conversation";
   if (title.length > 60) title = title.substring(0, 60);
   return title;
   ```
   There is no step to strip markdown formatting characters. The LLM prompt says "No quotes, no punctuation at the end" but does not explicitly forbid markdown syntax, and models sometimes return formatted text anyway.

## Correctness Properties

Property 1: Bug Condition — Tool Use Renders Compact Indicator

_For any_ `tool_use` SSE event with an arbitrary `tool_name` and `result`, the string appended to `accumulatedContent` by the event handler SHALL be a compact indicator containing only the tool name (e.g., `🔧 Used {tool_name}`) and SHALL NOT contain the raw `result` value.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Bug Condition — Title Markdown Stripping

_For any_ string containing markdown formatting characters (headings, bold, italic, strikethrough, inline code, links, images, blockquotes, list markers), `processTitle()` SHALL return a string with all markdown syntax removed, containing only the plain text content, trimmed and truncated to 60 characters.

**Validates: Requirements 2.4**

Property 3: Preservation — Plain Text Titles Unchanged

_For any_ string that does NOT contain markdown formatting characters, `processTitle()` SHALL produce the same result as the original implementation (trim + truncate to 60 chars + fallback to "Untitled Conversation" if empty).

**Validates: Requirements 3.3**

Property 4: Preservation — Token Streaming Unchanged

_For any_ `token` SSE event, the event handler SHALL continue to append `evt.data.content` to `accumulatedContent` and re-render via `renderMarkdown()`, exactly as the original implementation.

**Validates: Requirements 3.1**

## Fix Implementation

### Changes Required

**File**: `frontend/app.js`

**Functions**: `submitQuestion()`, `submitContinuation()`, `submitSideQuestion()`, `submitSideFollowup()` (and their trailing buffer-processing blocks)

**Specific Changes**:
1. **Replace blockquote construction with compact indicator**: In every `tool_use` case (8 occurrences total — main loop + buffer processing in each of the 4 functions), replace:
   ```javascript
   const toolInfo = `\n\n> **Tool:** ${evt.data.tool_name}\n> **Result:** ${evt.data.result || "..."}\n\n`;
   accumulatedContent += toolInfo;
   ```
   with:
   ```javascript
   const toolInfo = `\n\n🔧 Used ${evt.data.tool_name}\n\n`;
   accumulatedContent += toolInfo;
   ```
   The compact indicator does not include the raw result. The wrench emoji and tool name provide sufficient context.

2. **Add CSS for tool indicator styling**: In `frontend/index.html`, add a CSS rule to style the tool indicator text with a distinct color so it's visually differentiated from response content. This could target a class applied via a custom `renderMarkdown` post-processing step, or rely on the emoji + surrounding whitespace for visual distinction. A simple approach: no extra CSS needed since the emoji itself provides visual differentiation and the text is rendered as a normal paragraph by `marked.js`.

**File**: `src/title-generator.ts`

**Function**: `processTitle()`

**Specific Changes**:
3. **Add markdown stripping before trim**: Insert a markdown-stripping step at the beginning of `processTitle()` that removes:
   - Heading markers (`# `, `## `, etc.)
   - Bold markers (`**...**`)
   - Italic markers (`*...*`, `_..._`)
   - Strikethrough markers (`~~...~~`)
   - Inline code backticks (`` `...` ``)
   - Link syntax (`[text](url)` → `text`)
   - Image syntax (`![alt](url)` → `alt`)
   - Blockquote markers (`> `)
   - Unordered list markers (`- `, `* `, `+ `)
   - Ordered list markers (`1. `, `2. `, etc.)

4. **Collapse excess whitespace**: After stripping, collapse multiple consecutive spaces into a single space to avoid gaps left by removed syntax.

5. **Preserve existing trim + truncate + fallback logic**: The stripping step is inserted before the existing `trim()` call. The rest of the function remains unchanged.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm the root cause analysis.

**Test Plan**: Write tests that exercise `processTitle()` with markdown-containing strings and observe that markdown characters pass through unchanged. For the frontend tool display bug, manual inspection or a unit test simulating the string construction confirms the blockquote pattern.

**Test Cases**:
1. **Title with heading marker**: `processTitle("# My Title")` returns `# My Title` (will fail on unfixed code — markdown not stripped)
2. **Title with bold markers**: `processTitle("**Bold Title**")` returns `**Bold Title**` (will fail on unfixed code)
3. **Title with mixed markdown**: `processTitle("## **Important** _Topic_")` returns `## **Important** _Topic_` (will fail on unfixed code)
4. **Tool display string construction**: The blockquote template `\n\n> **Tool:** ...\n> **Result:** ...\n\n` contains the raw result (will fail on unfixed code)

**Expected Counterexamples**:
- `processTitle("# Heading")` returns `# Heading` instead of `Heading`
- `processTitle("**Bold**")` returns `**Bold**` instead of `Bold`
- Tool display handler produces a string containing the full raw result text

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL raw WHERE isBugCondition_TitleMarkdown(raw) DO
  result := processTitle_fixed(raw)
  ASSERT result does NOT contain markdown syntax characters
  ASSERT result contains the plain text content
  ASSERT result.length <= 60
  ASSERT result.length > 0
END FOR

FOR ALL toolEvent WHERE isBugCondition_ToolDisplay(toolEvent) DO
  indicator := buildToolIndicator(toolEvent.tool_name)
  ASSERT indicator contains toolEvent.tool_name
  ASSERT indicator does NOT contain toolEvent.result
  ASSERT indicator starts with "🔧"
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL raw WHERE NOT isBugCondition_TitleMarkdown(raw) DO
  ASSERT processTitle_original(raw) = processTitle_fixed(raw)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss (e.g., strings with characters that look like markdown but aren't)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for plain-text titles, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Plain text title preservation**: Verify `processTitle("Simple Title")` returns `"Simple Title"` identically before and after fix
2. **Empty string preservation**: Verify `processTitle("")` returns `"Untitled Conversation"` identically before and after fix
3. **Long string truncation preservation**: Verify `processTitle("a".repeat(100))` returns a 60-char string identically before and after fix
4. **Whitespace-only preservation**: Verify `processTitle("   ")` returns `"Untitled Conversation"` identically before and after fix

### Unit Tests

- Test `processTitle()` with each markdown pattern (headings, bold, italic, strikethrough, code, links, images, blockquotes, list markers)
- Test `processTitle()` with nested/combined markdown patterns
- Test `processTitle()` with edge cases (empty string, whitespace-only, exactly 60 chars, over 60 chars with markdown)
- Test the tool indicator string construction produces the expected compact format

### Property-Based Tests

- Generate random strings with injected markdown patterns and verify `processTitle()` strips them all
- Generate random plain-text strings (no markdown characters) and verify `processTitle()` output matches the original implementation
- Generate random tool names and results and verify the indicator string contains the tool name but not the result
- Test the title length invariant: `processTitle()` always returns a non-empty string of at most 60 characters (existing test, should continue to pass)

### Integration Tests

- Test full streaming flow with a `tool_use` event followed by `token` events to verify the compact indicator appears inline with the response text
- Test that loading a saved conversation with tool invocations in message history renders correctly
- Test that title updates via SSE `title` events display correctly after markdown stripping
