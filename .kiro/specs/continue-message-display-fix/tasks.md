# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** — Continuation Question Missing from DOM
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate `submitContinuation()` skips creating a user question `<div>`
  - **Scoped PBT Approach**: Since this is a frontend DOM bug, use a structural code analysis approach — read `frontend/app.js` and assert that the `submitContinuation` function body contains the 4-line question div creation pattern (`document.createElement("div")`, `style.cssText` with `font-weight: 600`, `textContent = question`, `mainPanel.appendChild(questionDiv)`) between the `<hr>` divider append and the `createResponseSection()` call
  - Write a property-based test in `src/__tests__/bug-condition-exploration.test.ts` (append to existing file)
  - Use `fast-check` to generate random non-empty trimmed question strings
  - For each generated question string, extract the `submitContinuation` function body from `frontend/app.js` and assert:
    - The function body contains a `document.createElement("div")` call for the question div AFTER the `continuation-divider` append and BEFORE `createResponseSection`
    - The function body contains `font-weight: 600` styling assignment
    - The function body contains `color: var(--color-text-secondary)` styling assignment
    - The function body contains a `textContent` assignment for the question
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (the `submitContinuation` function body does NOT contain the question div creation pattern — this proves the bug exists)
  - Document counterexamples found: the function jumps from `mainPanel.appendChild(divider)` directly to `createResponseSection(tempId)` with no question div in between
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** — Non-Continuation Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Write preservation tests in `src/__tests__/preservation.test.ts` (append to existing file)
  - Observe on UNFIXED code:
    - `submitQuestion()` in `frontend/app.js` does NOT create a user question div (by design — the first question is shown in the input bar context)
    - `loadConversation()` in `frontend/app.js` DOES create user question divs with `font-weight: 600` and `color: var(--color-text-secondary)` styling
    - `submitContinuation()` DOES add the `<hr>` divider with class `continuation-divider`
    - `submitContinuation()` DOES push user message to `state.conversation.mainThread`
    - `submitContinuation()` DOES call `disableContinuationInput()` and `enableContinuationInput()`
    - Token accumulation pattern `accumulatedContent += evt.data.content` exists in all streaming functions
  - Write property-based tests capturing observed behavior:
    - Structural test: `submitQuestion` function body does NOT contain a question div creation pattern (this is by design and must be preserved)
    - Structural test: `loadConversation` function body DOES contain the question div pattern with correct styling (`font-weight: 600`, `color: var(--color-text-secondary)`)
    - Structural test: `submitContinuation` function body contains `continuation-divider` class for the `<hr>` element
    - Structural test: `submitContinuation` function body contains `state.conversation.mainThread.push` for user message storage
    - Structural test: `submitContinuation` function body calls `disableContinuationInput()` and `enableContinuationInput()`
    - Structural test: token accumulation pattern appears in all streaming functions (at least 4 occurrences)
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for missing continuation question display in submitContinuation()

  - [x] 3.1 Implement the fix
    - In `frontend/app.js`, inside the `submitContinuation(question)` function, add 4 lines AFTER the `<hr>` divider is appended to `mainPanel` and BEFORE `createResponseSection(tempId)` is called:
      ```js
      const questionDiv = document.createElement("div");
      questionDiv.style.cssText = "font-weight: 600; margin-bottom: 12px; color: var(--color-text-secondary);";
      questionDiv.textContent = question;
      mainPanel.appendChild(questionDiv);
      ```
    - This replicates the exact pattern used in `loadConversation()` for rendering user messages
    - No other files or functions need to change
    - _Bug_Condition: isBugCondition(input) where input.action == "submitContinuation" AND input.question.trim().length > 0_
    - _Expected_Behavior: A styled `<div>` with the question text appears in the main panel after the `<hr>` divider and before the assistant response `<section>`_
    - _Preservation: submitQuestion() must NOT gain a question div; loadConversation() rendering unchanged; state management unchanged; continuation input enable/disable cycle unchanged_
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** — Continuation Question Rendered in DOM
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (question div creation pattern exists in `submitContinuation`)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — `submitContinuation` now contains the question div creation pattern)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** — Non-Continuation Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — `submitQuestion` still has no question div, `loadConversation` still renders correctly, state management and input cycling unchanged)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run full test suite with `npm test`
  - Ensure all tests pass, ask the user if questions arise
