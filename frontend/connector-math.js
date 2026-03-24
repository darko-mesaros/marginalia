// frontend/connector-math.js
// Pure math functions for connector line rendering.
// No DOM dependencies — works in browser globals and as a module import for tests.

/**
 * Compute an SVG path `d` attribute string for a stepped connector
 * with rounded corners between two points.
 *
 * Shape: horizontal out → rounded corner → vertical → rounded corner → horizontal in
 *
 * @param {number} x1 - Start x (right edge of anchor highlight)
 * @param {number} y1 - Start y (vertical midpoint of anchor)
 * @param {number} x2 - End x (left edge of margin note)
 * @param {number} y2 - End y (vertical midpoint of note header)
 * @returns {string} SVG path `d` attribute
 */
function computeBezierPath(x1, y1, x2, y2) {
  // Place the vertical segment near the right edge of the main article,
  // with a small offset into the gap between panels.
  // Use 85% of the way from x1 to x2 (close to the margin panel edge).
  const vertX = x1 + (x2 - x1) * 0.95;

  // Corner radius — clamped so it doesn't exceed available space
  const maxR = Math.min(Math.abs(vertX - x1), Math.abs(x2 - vertX), Math.abs(y2 - y1) / 2, 12);
  const r = Math.max(maxR, 0);

  // If points are nearly at the same Y, just draw a gentle S-curve
  if (Math.abs(y2 - y1) < 2) {
    const offset = Math.max((x2 - x1) * 0.4, 30);
    const cx1 = x1 + offset;
    const cx2 = x2 - offset;
    return `M ${x1},${y1} C ${cx1},${y1} ${cx2},${y2} ${x2},${y2}`;
  }

  // Direction: going down (+1) or up (-1)
  const dir = y2 > y1 ? 1 : -1;

  // Build the stepped path with rounded corners:
  // 1. Horizontal from start to first corner
  // 2. Arc turn into vertical
  // 3. Vertical segment
  // 4. Arc turn into horizontal
  // 5. Horizontal to end
  const parts = [
    `M ${x1},${y1}`,
    // Horizontal to just before first corner
    `L ${vertX - r},${y1}`,
    // Arc: turn from horizontal to vertical
    `Q ${vertX},${y1} ${vertX},${y1 + r * dir}`,
    // Vertical segment
    `L ${vertX},${y2 - r * dir}`,
    // Arc: turn from vertical to horizontal
    `Q ${vertX},${y2} ${vertX + r},${y2}`,
    // Horizontal to end
    `L ${x2},${y2}`,
  ];

  return parts.join(' ');
}

/**
 * Check whether two rectangles intersect (overlap).
 * Used for visibility culling — determines if an element's bounding rect
 * is within (or partially within) a viewport rect.
 *
 * @param {{ left: number, right: number, top: number, bottom: number }} rect
 * @param {{ left: number, right: number, top: number, bottom: number }} viewportRect
 * @returns {boolean} true if the rectangles overlap
 */
function isRectInViewport(rect, viewportRect) {
  return (
    rect.right > viewportRect.left &&
    rect.left < viewportRect.right &&
    rect.bottom > viewportRect.top &&
    rect.top < viewportRect.bottom
  );
}

// Export for module/test contexts. In the browser as a plain <script>, these are globals.
if (typeof exports !== 'undefined') {
  exports.computeBezierPath = computeBezierPath;
  exports.isRectInViewport = isRectInViewport;
}
