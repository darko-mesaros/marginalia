# Bugfix Requirements Document

## Introduction

When a user double-clicks a line of text in the main panel to select it and then submits a side question, the request fails with a 422 error: `"Invalid anchor position: start_offset must be less than end_offset"`. The bug exists in both the Express validation middleware (`validation.ts`) and the business logic layer (`conversation-ops.ts`), which both use a strict less-than comparison (`start_offset >= end_offset`) that rejects cases where the two offsets are equal. The frontend's `computeOffsetsRelativeToSection` function can produce equal offsets when the browser's double-click selection range resolves to the same computed character position (e.g., when `startContainer` and `endContainer` are the same node and the range spans the full node text, or when the fallback path sets `endOffset = startOffset`).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user double-clicks to select text and the computed `start_offset` equals `end_offset`, THEN the Express validation middleware in `validation.ts` rejects the request with a 422 error: `"Invalid anchor position: start_offset must be less than end_offset"`

1.2 WHEN a user double-clicks to select text and the computed `startOffset` equals `endOffset`, THEN the business logic in `conversation-ops.ts` throws a `ValidationError` with message `"Invalid anchor position: start offset must be less than end offset"`

1.3 WHEN the browser selection range's `endContainer` is not found during the tree walk in `computeOffsetsRelativeToSection`, THEN the frontend falls back to `endOffset = startOffset`, producing equal offsets that will be rejected by the backend

### Expected Behavior (Correct)

2.1 WHEN a user double-clicks to select text and the computed `start_offset` equals `end_offset`, THEN the Express validation middleware SHALL accept the request (allowing `start_offset <= end_offset` where both are non-negative and `selected_text` is non-empty)

2.2 WHEN a user double-clicks to select text and the computed `startOffset` equals `endOffset`, THEN the business logic in `conversation-ops.ts` SHALL accept the anchor position and create the side thread normally

2.3 WHEN the browser selection range produces equal offsets in `computeOffsetsRelativeToSection`, THEN the frontend SHALL send the request with those equal offsets and the backend SHALL process it successfully

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `start_offset` is strictly less than `end_offset` (normal text selection), THEN the system SHALL CONTINUE TO accept the request and create a side thread as before

3.2 WHEN `start_offset` is negative, THEN the system SHALL CONTINUE TO reject the request with a 422 error

3.3 WHEN `start_offset` is strictly greater than `end_offset` (inverted range), THEN the system SHALL CONTINUE TO reject the request with a 422 error

3.4 WHEN `selected_text` is empty or missing, THEN the system SHALL CONTINUE TO reject the request with a 422 error

3.5 WHEN `question` is empty or missing, THEN the system SHALL CONTINUE TO reject the request with a 422 error

3.6 WHEN `message_id` is empty or missing, THEN the system SHALL CONTINUE TO reject the request with a 422 error
