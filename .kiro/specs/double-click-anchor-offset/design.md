# Double-Click Anchor Offset Bugfix Design

## Overview

When a user double-clicks text to select an entire word or line, the browser's selection range can resolve to equal `startOffset` and `endOffset` values after the frontend's `computeOffsetsRelativeToSection` tree walk. Both the Express validation middleware (`validation.ts`) and the business logic layer (`conversation-ops.ts`) use strict less-than comparison (`start_offset >= end_offset`) to reject this case, returning a 422 error. The fix changes both comparisons from `>=` to `>` so that equal offsets are accepted while inverted ranges remain rejected.

## Glossary

- **Bug_Condition (C)**: The condition where `start_offset === end_offset` — a valid double-click selection that is incorrectly rejected by both validation layers
- **Property (P)**: Equal-offset anchor positions should be accepted and create a side thread normally, just like any other valid selection
- **Preservation**: All existing validation behavior for non-equal-offset inputs must remain unchanged — normal selections (start < end), inverted ranges (start > end), negative offsets, empty text, and missing fields must all behave exactly as before
- **`validateSideQuestionBody`**: Express middleware in `src/validation.ts` that validates the HTTP request shape for `POST /api/side-question`
- **`submitSideQuestion`**: Business logic function in `src/conversation-ops.ts` that validates anchor positions and creates side threads
- **`computeOffsetsRelativeToSection`**: Frontend function in `frontend/app.js` that walks the DOM tree to compute character offsets relative to a section container

## Bug Details

### Bug Condition

The bug manifests when a user double-clicks text to select it and the frontend's `computeOffsetsRelativeToSection` function produces equal `startOffset` and `endOffset` values. This happens in two scenarios: (1) when `startContainer` and `endContainer` are the same text node and the range spans the full node text such that the computed offsets coincide, or (2) when the `endContainer` is not found during the tree walk and the fallback path sets `endOffset = startOffset`. Both backend validation layers reject this with `start_offset >= end_offset`.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SideQuestionRequest {
    selected_text: string,
    question: string,
    anchor_position: { start_offset: number, end_offset: number, message_id: string }
  }
  OUTPUT: boolean

  RETURN input.anchor_position.start_offset >= 0
         AND input.anchor_position.start_offset == input.anchor_position.end_offset
         AND input.selected_text IS non-empty
         AND input.question IS non-empty
         AND input.anchor_position.message_id IS non-empty
END FUNCTION
```

### Examples

- **Double-click single word**: User double-clicks "Rust" at offset 5 in a section. Frontend computes `{ startOffset: 5, endOffset: 5 }`. Backend rejects with 422: `"Invalid anchor position: start_offset must be less than end_offset"`. Expected: request accepted, side thread created.
- **Fallback path**: `endContainer` not found in tree walk, fallback sets `endOffset = startOffset = 12`. Backend rejects with 422. Expected: request accepted.
- **Zero-zero offsets**: Double-click at start of section produces `{ startOffset: 0, endOffset: 0 }`. Backend rejects. Expected: request accepted (selected_text is non-empty).
- **Normal selection (not a bug)**: User drags to select text, producing `{ startOffset: 3, endOffset: 15 }`. Backend accepts. This must continue to work.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Normal text selections where `start_offset < end_offset` must continue to be accepted
- Inverted ranges where `start_offset > end_offset` must continue to be rejected with 422
- Negative `start_offset` values must continue to be rejected with 422
- Empty or missing `selected_text` must continue to be rejected with 422
- Empty or missing `question` must continue to be rejected with 422
- Empty or missing `message_id` must continue to be rejected with 422
- Non-numeric offsets must continue to be rejected with 422
- Missing `anchor_position` object must continue to be rejected with 422

**Scope:**
All inputs where `start_offset !== end_offset` should be completely unaffected by this fix. This includes:
- Normal drag selections (`start_offset < end_offset`)
- Inverted ranges (`start_offset > end_offset`)
- Negative offsets
- All other validation checks (empty text, missing fields, type checks)

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is straightforward:

1. **Overly strict comparison operator in `validation.ts`**: Line `if (start_offset >= end_offset)` uses `>=` which rejects the equal case. The intent was to reject inverted ranges, but the `>=` also catches the legitimate equal-offset case from double-click selections.

2. **Duplicate overly strict comparison in `conversation-ops.ts`**: Line `if (anchorPosition.startOffset >= anchorPosition.endOffset)` has the same `>=` operator, providing a second rejection point for equal offsets. Even if the middleware were fixed alone, this business logic check would still reject the request.

3. **Frontend fallback produces equal offsets**: The `computeOffsetsRelativeToSection` function's fallback path (`if (!foundEnd) endOffset = startOffset`) explicitly sets equal offsets when the end container isn't found in the tree walk. This is a defensive fallback that produces a valid-but-equal offset pair.

4. **No bug in the frontend**: The frontend correctly computes and sends the offsets. The bug is entirely in the backend validation logic.

## Correctness Properties

Property 1: Bug Condition - Equal Offset Acceptance

_For any_ side question request where `start_offset` equals `end_offset`, both offsets are non-negative, and all other fields (`selected_text`, `question`, `message_id`) are valid and non-empty, the fixed validation functions SHALL accept the request and allow side thread creation to proceed.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-Equal Offset Behavior Unchanged

_For any_ side question request where `start_offset` does NOT equal `end_offset`, the fixed validation functions SHALL produce exactly the same accept/reject result as the original functions, preserving all existing behavior for normal selections, inverted ranges, negative offsets, and all other validation checks.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/validation.ts`

**Function**: `validateSideQuestionBody`

**Specific Changes**:
1. **Change comparison operator**: Replace `if (start_offset >= end_offset)` with `if (start_offset > end_offset)` — this allows equal offsets through while still rejecting inverted ranges

**File**: `src/conversation-ops.ts`

**Function**: `submitSideQuestion`

**Specific Changes**:
2. **Change comparison operator**: Replace `if (anchorPosition.startOffset >= anchorPosition.endOffset)` with `if (anchorPosition.startOffset > anchorPosition.endOffset)` — same fix at the business logic layer

**No frontend changes required**: The frontend already correctly computes and sends equal offsets. The bug is entirely in backend validation.

**Existing test updates**:
3. **Update `validation.test.ts`**: The test `"returns 422 when start_offset >= end_offset"` currently asserts that equal offsets are rejected. After the fix, equal offsets should be accepted — this test needs to be split into two: one for equal offsets (now accepted) and one for inverted ranges (still rejected).
4. **Update `conversation-ops.test.ts`**: The test `"throws ValidationError when start >= end"` currently uses equal offsets (`startOffset: 10, endOffset: 10`). After the fix, this should pass. The test needs to be updated to reflect the new behavior.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that submit side question requests with equal `start_offset` and `end_offset` values through both validation layers. Run these tests on the UNFIXED code to observe failures and confirm the `>=` comparison is the root cause.

**Test Cases**:
1. **Middleware equal-offset rejection**: Call `validateSideQuestionBody` with `start_offset: 5, end_offset: 5` and valid other fields — expect 422 on unfixed code (will fail on unfixed code)
2. **Business logic equal-offset rejection**: Call `submitSideQuestion` with `startOffset: 5, endOffset: 5` and valid other fields — expect ValidationError on unfixed code (will fail on unfixed code)
3. **Zero-zero offset rejection**: Call both validators with `start_offset: 0, end_offset: 0` — expect rejection on unfixed code (will fail on unfixed code)
4. **Various equal offsets via PBT**: Generate random non-negative integers and use them as both start and end offset — all should be rejected on unfixed code (will fail on unfixed code)

**Expected Counterexamples**:
- Both `validateSideQuestionBody` and `submitSideQuestion` reject equal offsets with 422 / ValidationError
- Root cause confirmed: the `>=` comparison operator in both files

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions accept the request.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result_middleware := validateSideQuestionBody_fixed(input)
  ASSERT result_middleware calls next() (no 422)

  result_ops := submitSideQuestion_fixed(input)
  ASSERT result_ops returns { thread, userMessage } (no ValidationError)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT validateSideQuestionBody_original(input) = validateSideQuestionBody_fixed(input)
  ASSERT submitSideQuestion_original(input) = submitSideQuestion_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-equal-offset inputs (normal selections, inverted ranges, negative offsets, missing fields), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Normal selection preservation**: Generate random `start_offset < end_offset` pairs with valid fields — verify both validators accept on unfixed code, then verify they still accept after fix
2. **Inverted range preservation**: Generate random `start_offset > end_offset` pairs — verify both validators reject on unfixed code, then verify they still reject after fix
3. **Negative offset preservation**: Generate random negative `start_offset` values — verify rejection is unchanged
4. **Empty field preservation**: Generate requests with empty `selected_text`, `question`, or `message_id` — verify rejection is unchanged

### Unit Tests

- Test `validateSideQuestionBody` accepts equal offsets after fix
- Test `submitSideQuestion` accepts equal offsets and creates side thread after fix
- Test that inverted ranges (`start > end`) are still rejected by both validators
- Test that negative offsets are still rejected by both validators
- Test edge case: `start_offset: 0, end_offset: 0` with valid text is accepted

### Property-Based Tests

- Generate random non-negative equal-offset pairs with valid fields — all should be accepted after fix (fix checking)
- Generate random `start < end` pairs with valid fields — all should be accepted both before and after fix (preservation)
- Generate random `start > end` pairs — all should be rejected both before and after fix (preservation)
- Generate random negative start offsets — all should be rejected both before and after fix (preservation)

### Integration Tests

- Test full request flow: equal-offset side question request through Express middleware → business logic → side thread creation
- Test that normal drag-selection side questions still work end-to-end after fix
- Test that the 422 error response format is unchanged for genuinely invalid requests
