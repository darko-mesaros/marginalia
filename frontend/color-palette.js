// frontend/color-palette.js
// Color palette and assignment functions for side thread visual differentiation.
// No DOM dependencies — works in browser globals and as a module import for tests.

/**
 * Fixed palette of 32 visually distinct CSS color strings.
 * Chosen to be distinguishable against white (#ffffff) and light (#f5f7fa) backgrounds.
 * @type {string[]}
 */
const COLOR_PALETTE = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
  '#dcbeff', '#9a6324', '#fffac8', '#800000', '#aaffc3',
  '#808000', '#ffd8b1', '#000075', '#a9a9a9', '#e6beff',
  '#1abc9c', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#e67e22', '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
  '#17becf', '#7f7f7f',
];

/**
 * Get the color for a side thread given its zero-based index.
 * Uses safe modulo to handle any integer (including negative values).
 * @param {number} index — zero-based position in sideThreads array
 * @returns {string} CSS hex color string from COLOR_PALETTE
 */
function getThreadColor(index) {
  return COLOR_PALETTE[((index % 32) + 32) % 32];
}

/**
 * Convert a hex color string to an rgba() CSS string.
 * @param {string} hex — 7-character hex color (e.g. "#ff0000")
 * @param {number} alpha — alpha value in [0, 1]
 * @returns {string} CSS rgba string (e.g. "rgba(255, 0, 0, 0.25)")
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Export for module/test contexts. In the browser as a plain <script>, these are globals.
if (typeof exports !== 'undefined') {
  exports.COLOR_PALETTE = COLOR_PALETTE;
  exports.getThreadColor = getThreadColor;
  exports.hexToRgba = hexToRgba;
}
