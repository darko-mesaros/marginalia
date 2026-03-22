import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeNotePositions } from "../layout.js";

// Feature: marginalia, Property 5: Margin note layout produces non-overlapping positions
// **Validates: Requirements 5.3**

describe("computeNotePositions", () => {
  const anchorArb = fc.record({
    anchorY: fc.nat(10000),
    noteHeight: fc.integer({ min: 20, max: 500 }),
  });

  it("should produce non-overlapping positions for any set of notes", () => {
    fc.assert(
      fc.property(fc.array(anchorArb, { minLength: 2, maxLength: 50 }), (anchors) => {
        const positions = computeNotePositions(anchors);

        expect(positions).toHaveLength(anchors.length);

        // For any two distinct notes A and B, they must not overlap:
        // either A's bottom <= B's top or B's bottom <= A's top
        for (let i = 0; i < positions.length; i++) {
          for (let j = i + 1; j < positions.length; j++) {
            const aTop = positions[i].top;
            const aBottom = aTop + anchors[i].noteHeight;
            const bTop = positions[j].top;
            const bBottom = bTop + anchors[j].noteHeight;

            const noOverlap = aBottom <= bTop || bBottom <= aTop;
            expect(noOverlap).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("should return empty array for empty input", () => {
    expect(computeNotePositions([])).toEqual([]);
  });

  it("should return a single position for a single note", () => {
    fc.assert(
      fc.property(anchorArb, (anchor) => {
        const positions = computeNotePositions([anchor]);
        expect(positions).toHaveLength(1);
        expect(positions[0].top).toBe(anchor.anchorY);
      }),
      { numRuns: 100 },
    );
  });
});
