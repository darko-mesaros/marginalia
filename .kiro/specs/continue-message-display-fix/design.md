# Continue Message Display Fix — Bugfix Design

## Overview

When a user submits a continuation question via `POST /api/continue`, the `submitContinuation()` function in `frontend/app.js` adds an `<hr>` divider and immediately creates the assistant response section — skipping the creation of a DOM element for the user's question text. The message is correctly stored in `state.conversation.mainThread` and persisted to the backend, and it renders correctly when the conversation is reloaded via `loadConversation()`. The fix is a single missing DOM insertion in `submitContinuation()`.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — submitting a continuation question via the continue input, which calls `submitContinuation(question)` in `frontend/app.js`
- **Property (P)**: The desired behavior — the user's continuation question text should be rendered as a styled `<div>` in the main panel between the `<hr>` divider and the assistant response section
- **Preservation**: All existing behavior that must remain unchanged — initial question rendering, assistant streaming, state management, conversation loading, side threads, continuation input enable/disable cycle
- **submitContinuation()**: The function in `frontend/app.js` that handles the continue flow — adds user message to state, creates DOM elements, streams the assistant response via `POST /api/continue`
- **loadConversation()**: The function in `frontend/app.js` that re-renders a saved conversation — correctly renders user messages with `font-weight: 600` and `var(--color-text-secondary)` styling
- **submitQuestion()**: The function in `frontend/app.js` that handles the initial ask flow — does NOT render the user's question as a separate element (by design, the first question is shown in the input bar context)

## Bug Details

### Bug Condition

The bug manifests when a user submits a continuation question via the continue input. The `submitContinuation()` function adds the user message to `state.conversation.mainThread`, appends an `<hr>` divider to the main panel, then immediately creates a `<section>` for the assistant's streaming response — without first creating a `<div>` for the user's question text.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { action: string, question: string }
  OUTPUT: boolean
  
  RETURN input.action == "submitContinuation"
         AND input.question.trim().length > 0
         AND mainPanel exists in DOM
END FUNCTION
```

### Examples

- User asks initial question "What is Rust?", gets a response, then types "How does ownership work?" in the continue input and submits → The `<hr>` divider appears, then the assistant response streams in, but "How does ownership work?" is never shown in the panel. Expected: "How does ownership work?" appears as styled text between the divider and the response.
- User submits three continuation questions in a row → The panel shows the initial response, then three `<hr>` dividers each followed by assistant responses, with no user questions visible between them. Expected: Each divider is followed by the user's question text, then the assistant response.
- User submits a continuation, then reloads the conversation from the sidebar → All user messages (including continuations) now appear correctly because `loadConversation()` handles them properly.
- User submits a continuation with only whitespace → `handleContinueSubmit()` trims and rejects empty input, so `submitContinuation()` is never called. This is not a bug condition.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The initial question flow via `submitQuestion()` must continue to work exactly as before (it intentionally does not render the user's question as a separate div)
- Assistant response streaming (token-by-token rendering, tool_use indicators, done/error handling) must remain unchanged
- State management — `state.conversation.mainThread.push()` for user and assistant messages must remain unchanged
- The `<hr>` divider with class `continuation-divider` must still be added before each continuation exchange
- Conversation loading via `loadConversation()` must continue to render all messages correctly
- The continuation input enable/disable cycle (`disableContinuationInput()` / `enableContinuationInput()`) must remain unchanged
- `fetchConversationList()` must still be called after streaming completes
- Side thread rendering, margin notes, and anchor highlights must be unaffected

**Scope:**
All inputs that do NOT involve the `submitContinuation()` function should be completely unaffected by this fix. This includes:
- Initial question submission via `submitQuestion()`
- Side question and side follow-up flows
- Conversation loading and sidebar interactions
- Settings changes
- All backend behavior (routes, store, persistence)

## Hypothesized Root Cause

Based on the code analysis, the root cause is confirmed (not hypothesized):

1. **Missing DOM element creation**: `submitContinuation()` jumps from appending the `<hr>` divider directly to `createResponseSection(tempId)` without inserting a `<div>` for the user's question text. This is a simple omission — the code was likely written to mirror `submitQuestion()` (which doesn't render the user question as a separate element), but continuation questions need to be visible because they appear mid-conversation.

2. **Reference implementation exists**: `loadConversation()` correctly renders continuation user messages with:
   ```js
   const questionDiv = document.createElement("div");
   questionDiv.style.cssText = "font-weight: 600; margin-bottom: 12px; color: var(--color-text-secondary);";
   questionDiv.textContent = msg.content;
   mainPanel.appendChild(questionDiv);
   ```
   The fix should replicate this exact pattern in `submitContinuation()`.

## Correctness Properties

Property 1: Bug Condition — Continuation Question Rendered in DOM

_For any_ continuation question submitted via `submitContinuation(question)` where the question is a non-empty trimmed string, the function SHALL create a `<div>` element containing the question text, styled with `font-weight: 600` and `color: var(--color-text-secondary)`, and insert it into the main panel after the `<hr>` divider and before the assistant response `<section>`.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Non-Continuation Behavior Unchanged

_For any_ interaction that does NOT go through `submitContinuation()` (initial questions, conversation loading, side threads, settings), the fixed code SHALL produce exactly the same DOM output and state mutations as the original code, preserving all existing rendering, streaming, and state management behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

**File**: `frontend/app.js`

**Function**: `submitContinuation(question)`

**Specific Changes**:
1. **Add user question div**: After appending the `<hr>` divider to `mainPanel` and before calling `createResponseSection(tempId)`, insert a new `<div>` element that displays the user's question text with the same styling used in `loadConversation()`:
   ```js
   const questionDiv = document.createElement("div");
   questionDiv.style.cssText = "font-weight: 600; margin-bottom: 12px; color: var(--color-text-secondary);";
   questionDiv.textContent = question;
   mainPanel.appendChild(questionDiv);
   ```

That's the entire fix — a 4-line insertion. No other files or functions need to change.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root cause by verifying that `submitContinuation()` does not create a user question div.

**Test Plan**: Write a JSDOM-based unit test that simulates the DOM environment and calls `submitContinuation()` logic (or a testable extraction of it), then asserts that the main panel contains a div with the user's question text between the `<hr>` and the response `<section>`. Run on unfixed code to observe failure.

**Test Cases**:
1. **Single continuation**: Call `submitContinuation("How does ownership work?")` and check that mainPanel contains a div with that text (will fail on unfixed code)
2. **Multiple continuations**: Submit two continuation questions and verify both question texts appear in the DOM (will fail on unfixed code)
3. **Question styling**: Verify the question div has `font-weight: 600` and secondary text color (will fail on unfixed code)
4. **DOM ordering**: Verify the question div appears after the `<hr>` and before the response section (will fail on unfixed code)

**Expected Counterexamples**:
- The main panel contains an `<hr>` followed immediately by a `<section>`, with no user question div in between
- Cause: `submitContinuation()` never creates the question div element

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := submitContinuation_fixed(input.question)
  children := mainPanel.children (after the last <hr>)
  ASSERT children[0] is <hr> with class "continuation-divider"
  ASSERT children[1] is <div> with textContent == input.question
  ASSERT children[1].style includes "font-weight: 600"
  ASSERT children[2] is <section> (assistant response area)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT submitQuestion_fixed(input) produces same DOM as submitQuestion_original(input)
  ASSERT loadConversation_fixed(input) produces same DOM as loadConversation_original(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for initial question submission and conversation loading, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Initial question preservation**: Verify that `submitQuestion()` does NOT create a user question div (this is by design) — behavior must be identical before and after fix
2. **Conversation load preservation**: Verify that `loadConversation()` continues to render user messages with correct styling — no change expected
3. **State mutation preservation**: Verify that `state.conversation.mainThread` receives the same user message object regardless of fix
4. **Continuation input cycle preservation**: Verify that `disableContinuationInput()` and `enableContinuationInput()` are called at the same points

### Unit Tests

- Test that `submitContinuation()` creates a question div with correct text content
- Test that the question div has `font-weight: 600` and `color: var(--color-text-secondary)` styling
- Test that DOM order is: `<hr>` → question `<div>` → response `<section>`
- Test that multiple continuations each produce their own question div
- Test that `submitQuestion()` still does NOT produce a question div (preservation)

### Property-Based Tests

- Generate random non-empty question strings and verify `submitContinuation()` always creates a correctly styled question div with matching text content
- Generate random sequences of continuation questions and verify each one produces the correct DOM structure (divider → question → response section)
- Generate random conversation states (varying numbers of main thread messages) and verify `loadConversation()` rendering is unchanged

### Integration Tests

- Test full continuation flow: initial question → response → continuation question → verify question visible → response streams in
- Test reload after continuation: submit continuation → reload conversation from sidebar → verify all messages render correctly
- Test multiple continuations in sequence: submit 3 continuations → verify all 3 question texts are visible in correct order
