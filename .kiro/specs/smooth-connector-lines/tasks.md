# Tasks: Smooth Connector Lines

## Task 1: Extract pure math functions into testable module

- [x] 1.1 Create `frontend/connector-math.js` with `computeBezierPath(x1, y1, x2, y2)` function that returns an SVG cubic Bézier path `d` attribute string
- [x] 1.2 Add `isRectInViewport(rect, viewportRect)` helper function to `connector-math.js` for visibility culling logic
- [x] 1.3 Verify functions work standalone (no DOM dependencies in this module)

## Task 2: Replace straight lines with S-curve Bézier paths

- [x] 2.1 Update `#anchor-connector-svg line` CSS rule in `index.html` to target `path` elements instead, adding `fill: none`
- [x] 2.2 Replace `drawAnchorConnectors()` in `app.js` with new `updateConnectors()` function that creates `<path>` elements using `computeBezierPath` from `connector-math.js`
- [x] 2.3 Add `connectorPaths` Map for DOM element reuse — keyed by thread ID, update existing paths in place, remove stale ones

## Task 3: Implement requestAnimationFrame-based update loop

- [x] 3.1 Add `connectorsDirty` flag and `markConnectorsDirty()` function
- [x] 3.2 Implement `connectorLoop()` rAF loop that checks dirty flag and calls `updateConnectors()` when dirty
- [x] 3.3 Add `startConnectorLoop()` and call it on page load
- [x] 3.4 Replace debounced scroll/resize listeners with passive `markConnectorsDirty` listeners
- [x] 3.5 Replace all existing `drawAnchorConnectors()` call sites with `markConnectorsDirty()`

## Task 4: Add visibility culling

- [x] 4.1 In `updateConnectors()`, compute main panel and margin panel viewport rects
- [x] 4.2 For each connector, check if anchor rect and note rect are within their respective viewports using `isRectInViewport`
- [x] 4.3 Set `display: none` on paths where either endpoint is off-screen, remove the attribute when both are visible

## Task 5: Implement read-then-write batching

- [x] 5.1 In `updateConnectors()`, batch all `getBoundingClientRect()` calls into a read phase before any SVG mutations
- [x] 5.2 Perform all `setAttribute` calls in a separate write phase after all reads are complete

## Task 6: Write property-based tests

- [x] 6.1 Create `src/__tests__/connector-math.test.ts` with test setup importing/reimplementing the pure math functions
- [x] 6.2 Property test: Bézier path is well-formed with correct control point geometry (Property 1, min 100 iterations)
- [x] 6.3 Property test: Same-Y inputs produce non-degenerate curve (Property 2, min 100 iterations)
- [x] 6.4 Property test: Connector visibility matches viewport membership (Property 3, min 100 iterations)
- [x] 6.5 Property test: SVG path elements are reused across redraws (Property 4, min 100 iterations)
- [x] 6.6 Property test: One connector per valid side thread (Property 5, min 100 iterations)

## Task 7: Write unit tests

- [x] 7.1 Unit test: specific coordinate examples for `computeBezierPath` (horizontal, diagonal, close points)
- [x] 7.2 Unit test: `markConnectorsDirty` sets the dirty flag
- [x] 7.3 Unit test: `isRectInViewport` returns correct results for inside, outside, and partially overlapping rects

## Task 8: Manual verification

- [x] 8.1 Verify S-curve connectors render correctly with multiple side threads
- [x] 8.2 Verify real-time scroll updates (no lag or delay)
- [x] 8.3 Verify window resize repositions connectors correctly
- [x] 8.4 Verify loading a saved conversation draws connectors for all restored threads
- [x] 8.5 Verify connector lines don't interfere with text selection or clicking
