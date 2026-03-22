// ── Margin note layout algorithm ──
// Pure function extracted from frontend/app.js for testability.

/** Minimum gap (px) between adjacent margin notes. */
const DEFAULT_GAP = 8;

export interface AnchorInput {
  anchorY: number;
  noteHeight: number;
}

export interface NotePosition {
  top: number;
}

/**
 * Compute non-overlapping vertical positions for margin notes.
 *
 * Algorithm:
 *   1. Sort notes by anchorY (ascending)
 *   2. For each note, top = max(anchorY, previousNoteBottom + gap)
 *
 * Returns positions in the same order as the input array.
 */
export function computeNotePositions(
  anchors: AnchorInput[],
  gap?: number,
): NotePosition[] {
  const g = typeof gap === "number" ? gap : DEFAULT_GAP;

  if (!anchors || anchors.length === 0) return [];

  // Build indexed entries so we can restore original order after sorting
  const indexed = anchors.map((a, i) => ({ ...a, originalIndex: i }));
  indexed.sort((a, b) => a.anchorY - b.anchorY);

  const results = new Array<NotePosition>(anchors.length);
  let previousBottom = -Infinity;

  for (const entry of indexed) {
    const top = Math.max(entry.anchorY, previousBottom + g);
    results[entry.originalIndex] = { top };
    previousBottom = top + entry.noteHeight;
  }

  return results;
}
