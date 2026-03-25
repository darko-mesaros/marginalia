# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Equal Offset Anchor Rejection
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate both validation layers reject equal offsets
  - **Scoped PBT Approach**: Generate random non-negative integers and use as both `start_offset` and `end_offset` with valid `selected_text`, `question`, and `message_id`
  - **File**: `src/__tests__/bug-condition-exploration.test.ts` — append a new describe block for this bug
  - Test `validateSideQuestionBody` with equal offsets (e.g., `start_offset: 5, end_offset: 5`) — assert it calls `next()` (no 422)
  - Test `submitSideQuestion` with equal offsets (e.g., `startOffset: 5, endOffset: 5`) — assert it returns `{ thread, userMessage }` without throwing `ValidationError`
  - Test zero-zero edge case: `start_offset: 0, end_offset: 0` with valid non-empty `selected_text`
  - PBT: for all non-negative `n`, `validateSideQuestionBody({ start_offset: n, end_offset: n, ... })` should call `next()`
  - PBT: for all non-negative `n`, `submitSideQuestion(store, text, question, { messageId, startOffset: n, endOffset: n })` should not throw
  - Bug condition from design: `isBugCondition(input)` where `start_offset >= 0 AND start_offset == end_offset AND selected_text IS non-empty AND question IS non-empty AND message_id IS non-empty`
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the `>=` comparison rejects equal offsets)
  - Document counterexamples found (e.g., `validateSideQuestionBody({ start_offset: 5, end_offset: 5 })` returns 422 instead of calling `next()`)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Equal Offset Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - **File**: `src/__tests__/preservation.test.ts` — append a new describe block for this bug
  - Observe on UNFIXED code: `validateSideQuestionBody({ start_offset: 0, end_offset: 9, ... })` calls `next()` (accepted)
  - Observe on UNFIXED code: `validateSideQuestionBody({ start_offset: 15, end_offset: 5, ... })` returns 422 (rejected — inverted range)
  - Observe on UNFIXED code: `validateSideQuestionBody({ start_offset: -1, end_offset: 5, ... })` returns 422 (rejected — negative offset)
  - Observe on UNFIXED code: `submitSideQuestion(store, text, question, { startOffset: 0, endOffset: 10 })` succeeds
  - Observe on UNFIXED code: `submitSideQuestion(store, text, question, { startOffset: 15, endOffset: 5 })` throws `ValidationError`
  - PBT: for all `start_offset < end_offset` (both non-negative), both validators accept — verify on UNFIXED code
  - PBT: for all `start_offset > end_offset` (start non-negative), both validators reject — verify on UNFIXED code
  - PBT: for all negative `start_offset`, middleware rejects with 422 — verify on UNFIXED code
  - PBT: empty `selected_text`, empty `question`, empty `message_id` all still rejected — verify on UNFIXED code
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for double-click equal-offset anchor rejection

  - [x] 3.1 Implement the fix
    - In `src/validation.ts`, function `validateSideQuestionBody`: change `if (start_offset >= end_offset)` to `if (start_offset > end_offset)` — allows equal offsets through while still rejecting inverted ranges
    - In `src/conversation-ops.ts`, function `submitSideQuestion`: change `if (anchorPosition.startOffset >= anchorPosition.endOffset)` to `if (anchorPosition.startOffset > anchorPosition.endOffset)` — same fix at the business logic layer
    - _Bug_Condition: isBugCondition(input) where input.anchor_position.start_offset >= 0 AND input.anchor_position.start_offset == input.anchor_position.end_offset AND selected_text IS non-empty AND question IS non-empty AND message_id IS non-empty_
    - _Expected_Behavior: equal-offset anchor positions are accepted by both validation layers, side thread is created normally_
    - _Preservation: all inputs where start_offset != end_offset produce the same accept/reject result as before the fix_
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Equal Offset Anchor Acceptance
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (equal offsets accepted)
    - When this test passes, it confirms the `>=` to `>` fix resolves the bug in both layers
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Equal Offset Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions for normal selections, inverted ranges, negative offsets, empty fields)
    - Confirm all tests still pass after fix (no regressions)

  - [x] 3.4 Update existing tests to reflect new behavior
    - In `src/__tests__/validation.test.ts`: the test `"returns 422 when start_offset >= end_offset"` uses equal offsets (`start_offset: 5, end_offset: 5`) — update it to expect acceptance (calls `next()`) for equal offsets, and add/keep a separate test for inverted ranges (`start_offset: 15, end_offset: 5`) that still expects 422
    - In `src/__tests__/conversation-ops.test.ts`: the test `"throws ValidationError when start >= end"` uses equal offsets (`startOffset: 10, endOffset: 10`) — update it to expect success for equal offsets, and verify the test `"throws ValidationError when start > end"` still expects `ValidationError` for inverted ranges
    - _Requirements: 2.1, 2.2, 3.3_

- [x] 4. Checkpoint — Ensure all tests pass
  - Run `npm test` to verify all tests pass (bug condition exploration, preservation, updated existing tests)
  - Ensure no regressions in any other test suites
  - Ask the user if questions arise
