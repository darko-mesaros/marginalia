# Implementation Plan: Colored Side Threads

## Overview

Add color-coded visual differentiation to side threads by creating a new `color-palette.js` module with a 32-color palette and `getThreadColor(index)` function, then integrating colors into margin note borders, SVG connector lines, and anchor text highlights. All changes are frontend-only.

## Tasks

- [x] 1. Create the color-palette module
  - [x] 1.1 Create `frontend/color-palette.js` with `COLOR_PALETTE` (32 hex colors) and `getThreadColor(index)` using `((index % 32) + 32) % 32` for safe modulo, plus `hexToRgba(hex, alpha)` helper
    - Follow the dual-export pattern from `connector-math.js` (`if (typeof exports !== 'undefined')`)
    - Export `COLOR_PALETTE`, `getThreadColor`, and `hexToRgba`
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 5.1_

  - [x] 1.2 Add `<script src="color-palette.js"></script>` to `frontend/index.html` before the `app.js` script tag
    - _Requirements: 1.3_

  - [x] 1.3 Write property test: Color assignment is index modulo palette size
    - **Property 1: Color assignment is index modulo palette size**
    - Create `src/__tests__/color-palette.test.ts` with re-implemented pure functions (same pattern as `connector-math.test.ts`)
    - For any non-negative integer index, `getThreadColor(index)` returns `COLOR_PALETTE[index % 32]`; also holds at wrapping boundary and for large indices
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 2.1, 2.2, 2.3, 7.1, 7.2**

  - [x] 1.4 Write property test: Appending a thread preserves existing color assignments
    - **Property 2: Appending a thread preserves existing color assignments**
    - For any array of N side threads and a new thread appended, colors at indices 0 through N−1 remain unchanged
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 6.1**

  - [x] 1.5 Write property test: Hex-to-rgba conversion preserves RGB components
    - **Property 3: Hex-to-rgba conversion preserves RGB components**
    - For any valid 6-digit hex color and alpha in [0, 1], `hexToRgba` produces correct `rgba(r, g, b, a)` string
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 5.1**

  - [x] 1.6 Write unit tests for color-palette
    - `COLOR_PALETTE` has exactly 32 entries, each a valid 7-character hex string (`#rrggbb`)
    - Boundary examples: `getThreadColor(0)` → first color, `getThreadColor(31)` → last, `getThreadColor(32)` → wraps to first
    - `hexToRgba("#ff0000", 0.25)` → `"rgba(255, 0, 0, 0.25)"`
    - Edge cases: `hexToRgba("#000000", 0.5)` and `hexToRgba("#ffffff", 0.5)`
    - _Requirements: 1.1, 1.2, 2.1, 5.1, 7.1, 7.2_

- [x] 2. Checkpoint - Verify color-palette module
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Apply color to margin note borders
  - [x] 3.1 Modify `renderMarginNote()` in `app.js` to accept a `colorIndex` parameter and apply `border-left: 3px solid <color>` to the `.margin-note` element using `getThreadColor(colorIndex)`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.2 Update all call sites of `renderMarginNote()` in `app.js` to pass the thread's index from `state.conversation.sideThreads`
    - Both the side-question creation path and the `loadConversation` re-render loop must pass the correct index
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Apply color to connector lines
  - [x] 4.1 Modify the WRITE PHASE of `updateConnectors()` in `app.js` to set `stroke` attribute on each SVG `<path>` to the thread's color via `getThreadColor(threadIndex)`
    - Look up the thread's index in `state.conversation.sideThreads` by matching `threadId`
    - Retain existing `stroke-width`, `stroke-dasharray`, and `opacity` from CSS
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 5. Apply color to anchor text highlights
  - [x] 5.1 Modify `highlightAnchor()` in `app.js` to accept a `colorIndex` parameter and create per-thread named highlights (`marginalia-anchor-N`) instead of the shared `marginalia-anchors` highlight
    - Dynamically inject `::highlight(marginalia-anchor-N) { background-color: rgba(r, g, b, 0.25); }` CSS rules via a managed `<style>` element
    - Use `hexToRgba(getThreadColor(colorIndex), 0.25)` for the background color
    - Keep the existing `CSS.highlights` guard for graceful degradation
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.2 Update all call sites of `highlightAnchor()` in `app.js` to pass the thread's `colorIndex`
    - Both the side-question creation path and the `loadConversation` re-render loop
    - Update `handleNewConversation` to clear per-thread highlights (delete all `marginalia-anchor-*` entries from `CSS.highlights`)
    - _Requirements: 2.1, 2.2, 5.2, 6.1_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- No backend changes required — all work is in `frontend/` and `src/__tests__/`
