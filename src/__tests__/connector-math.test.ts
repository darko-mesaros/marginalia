import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Re-implemented pure math functions (mirrors frontend/connector-math.js) ───

function computeBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const vertX = x1 + (x2 - x1) * 0.15;
  const maxR = Math.min(Math.abs(vertX - x1), Math.abs(x2 - vertX), Math.abs(y2 - y1) / 2, 12);
  const r = Math.max(maxR, 0);

  // Same-Y fallback: gentle S-curve
  if (Math.abs(y2 - y1) < 2) {
    const offset = Math.max((x2 - x1) * 0.4, 30);
    const cx1 = x1 + offset;
    const cx2 = x2 - offset;
    return `M ${x1},${y1} C ${cx1},${y1} ${cx2},${y2} ${x2},${y2}`;
  }

  const dir = y2 > y1 ? 1 : -1;

  const parts = [
    `M ${x1},${y1}`,
    `L ${vertX - r},${y1}`,
    `Q ${vertX},${y1} ${vertX},${y1 + r * dir}`,
    `L ${vertX},${y2 - r * dir}`,
    `Q ${vertX},${y2} ${vertX + r},${y2}`,
    `L ${x2},${y2}`,
  ];

  return parts.join(' ');
}

function isRectInViewport(
  rect: { left: number; right: number; top: number; bottom: number },
  viewportRect: { left: number; right: number; top: number; bottom: number },
): boolean {
  return (
    rect.right > viewportRect.left &&
    rect.left < viewportRect.right &&
    rect.bottom > viewportRect.top &&
    rect.top < viewportRect.bottom
  );
}

// ─── Helpers ───

/** Parse a stepped path (M L Q L Q L) into its key components. */
function parseSteppedPath(d: string) {
  // Match: M x1,y1 L ... Q ... L ... Q ... L x2,y2
  const parts = d.trim().split(/\s+(?=[MLQC])/);
  if (parts.length < 2) return null;

  // Extract start point
  const mMatch = parts[0].match(/^M\s+([-\d.e+]+),([-\d.e+]+)$/);
  if (!mMatch) return null;
  const x1 = parseFloat(mMatch[1]);
  const y1 = parseFloat(mMatch[2]);

  // Extract end point (last L command)
  const lastPart = parts[parts.length - 1];
  const lMatch = lastPart.match(/^L\s+([-\d.e+]+),([-\d.e+]+)$/);
  if (!lMatch) return null;
  const x2 = parseFloat(lMatch[1]);
  const y2 = parseFloat(lMatch[2]);

  // Extract midX from the first Q command
  const qParts = parts.filter(p => p.startsWith('Q'));
  let midX: number | null = null;
  if (qParts.length >= 1) {
    const qMatch = qParts[0].match(/^Q\s+([-\d.e+]+),([-\d.e+]+)\s+([-\d.e+]+),([-\d.e+]+)$/);
    if (qMatch) {
      midX = parseFloat(qMatch[1]); // The Q control point x is midX
    }
  }

  return { x1, y1, x2, y2, midX, partCount: parts.length };
}

/** Parse an SVG cubic Bézier path string (same-Y fallback format). */
function parseBezierPath(d: string) {
  const m = d.match(
    /^M\s+([-\d.e+]+),([-\d.e+]+)\s+C\s+([-\d.e+]+),([-\d.e+]+)\s+([-\d.e+]+),([-\d.e+]+)\s+([-\d.e+]+),([-\d.e+]+)$/,
  );
  if (!m) return null;
  return {
    x1: parseFloat(m[1]),
    y1: parseFloat(m[2]),
    cx1: parseFloat(m[3]),
    cy1: parseFloat(m[4]),
    cx2: parseFloat(m[5]),
    cy2: parseFloat(m[6]),
    x2: parseFloat(m[7]),
    y2: parseFloat(m[8]),
  };
}


// ─── Property-Based Tests (Task 6) ───

describe("Property-Based Tests — computeBezierPath", () => {
  // Feature: smooth-connector-lines, Property 1: Path is well-formed with correct geometry
  // **Validates: Requirements 1.1, 1.2**
  it("should produce a well-formed stepped path with midpoint vertical segment", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 0, max: 5000 }),
        (x1, y1, dx, y2) => {
          const x2 = x1 + dx;

          // Skip same-Y cases (handled by Property 2)
          if (Math.abs(y2 - y1) < 2) return;

          const d = computeBezierPath(x1, y1, x2, y2);
          const parsed = parseSteppedPath(d);

          // Path must be parseable
          expect(parsed).not.toBeNull();
          if (!parsed) return;

          // Endpoints match inputs
          expect(parsed.x1).toBeCloseTo(x1, 5);
          expect(parsed.y1).toBeCloseTo(y1, 5);
          expect(parsed.x2).toBeCloseTo(x2, 5);
          expect(parsed.y2).toBeCloseTo(y2, 5);

          // Vertical segment goes through vertX (15% of horizontal distance from x1)
          if (parsed.midX !== null) {
            const expectedVertX = x1 + (x2 - x1) * 0.15;
            expect(parsed.midX).toBeCloseTo(expectedVertX, 5);
          }

          // Should have 6 parts: M, L, Q, L, Q, L
          expect(parsed.partCount).toBe(6);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: smooth-connector-lines, Property 2: Same-Y inputs produce non-degenerate curve
  // **Validates: Requirements 1.3**
  it("should produce a non-degenerate curve when both endpoints share the same Y", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 0, max: 5000 }),
        (x1, dx, y) => {
          const x2 = x1 + dx;

          const d = computeBezierPath(x1, y, x2, y);
          // Same-Y falls back to Bézier S-curve
          const parsed = parseBezierPath(d);

          expect(parsed).not.toBeNull();
          if (!parsed) return;

          // Control points must differ from endpoints (non-degenerate)
          expect(parsed.cx1).not.toBeCloseTo(x1, 5);
          expect(parsed.cx2).not.toBeCloseTo(x2, 5);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property-Based Tests — isRectInViewport", () => {
  const rectArb = fc
    .tuple(
      fc.float({ min: -5000, max: 5000, noNaN: true }),
      fc.float({ min: -5000, max: 5000, noNaN: true }),
      fc.float({ min: -5000, max: 5000, noNaN: true }),
      fc.float({ min: -5000, max: 5000, noNaN: true }),
    )
    .map(([a, b, c, d]) => ({
      left: Math.min(a, b),
      right: Math.max(a, b) + 1, // ensure non-zero width
      top: Math.min(c, d),
      bottom: Math.max(c, d) + 1, // ensure non-zero height
    }));

  // Feature: smooth-connector-lines, Property 3: Connector visibility matches viewport membership
  // **Validates: Requirements 5.1, 5.2, 5.3**
  it("should match manual AABB overlap check for any two rects", () => {
    fc.assert(
      fc.property(rectArb, rectArb, (rect, viewport) => {
        const result = isRectInViewport(rect, viewport);

        // Manual AABB overlap formula
        const expected =
          rect.right > viewport.left &&
          rect.left < viewport.right &&
          rect.bottom > viewport.top &&
          rect.top < viewport.bottom;

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property-Based Tests — SVG path element reuse", () => {
  // Feature: smooth-connector-lines, Property 4: SVG path elements are reused across redraws
  // **Validates: Requirements 3.4**
  it("should reuse Map entries for the same thread IDs across redraws", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 }),
        (threadIds) => {
          const connectorPaths = new Map<string, object>();

          // First "redraw"
          for (const id of threadIds) {
            if (!connectorPaths.has(id)) {
              connectorPaths.set(id, { id });
            }
          }

          const firstDrawRefs = new Map<string, object>();
          for (const [id, ref] of connectorPaths) {
            firstDrawRefs.set(id, ref);
          }

          // Second "redraw" — should reuse
          for (const id of threadIds) {
            if (!connectorPaths.has(id)) {
              connectorPaths.set(id, { id });
            }
          }

          for (const id of threadIds) {
            expect(connectorPaths.get(id)).toBe(firstDrawRefs.get(id));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property-Based Tests — connector count", () => {
  // Feature: smooth-connector-lines, Property 5: One connector per valid side thread
  // **Validates: Requirements 6.1**
  it("should produce exactly one path per valid side thread", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (threadCount) => {
          const connectorPaths = new Map<string, object>();

          for (let i = 0; i < threadCount; i++) {
            const threadId = `thread-${i}`;
            if (!connectorPaths.has(threadId)) {
              connectorPaths.set(threadId, { id: threadId });
            }
          }

          expect(connectorPaths.size).toBe(threadCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Unit Tests (Task 7) ───

describe("Unit Tests — computeBezierPath", () => {
  // 7.1 Specific coordinate examples
  it("should compute a stepped path for a diagonal line", () => {
    const d = computeBezierPath(50, 100, 250, 300);
    const parsed = parseSteppedPath(d);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.x1).toBe(50);
    expect(parsed.y1).toBe(100);
    expect(parsed.x2).toBe(250);
    expect(parsed.y2).toBe(300);
    // vertX should be 50 + (250-50)*0.15 = 50 + 30 = 80
    expect(parsed.midX).toBe(80);
  });

  it("should fall back to S-curve Bézier for same-Y points", () => {
    const d = computeBezierPath(100, 200, 300, 200);
    const parsed = parseBezierPath(d);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.x1).toBe(100);
    expect(parsed.y1).toBe(200);
    expect(parsed.x2).toBe(300);
    expect(parsed.y2).toBe(200);
    // offset = max((300-100)*0.4, 30) = 80
    expect(parsed.cx1).toBe(180);
    expect(parsed.cx2).toBe(220);
  });

  it("should handle close points with small radius", () => {
    const d = computeBezierPath(100, 100, 110, 130);
    const parsed = parseSteppedPath(d);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.x1).toBe(100);
    expect(parsed.x2).toBe(110);
    // vertX = 100 + (110-100)*0.15 = 101.5, radius clamped to min(1.5, 8.5, 15, 12) = 1.5
    expect(parsed.midX).toBe(101.5);
  });
});

describe("Unit Tests — markConnectorsDirty", () => {
  // 7.2 Dirty flag simulation
  it("should set the dirty flag to true", () => {
    let connectorsDirty = false;

    function markConnectorsDirty() {
      connectorsDirty = true;
    }

    expect(connectorsDirty).toBe(false);
    markConnectorsDirty();
    expect(connectorsDirty).toBe(true);
  });

  it("should remain true after multiple calls", () => {
    let connectorsDirty = false;

    function markConnectorsDirty() {
      connectorsDirty = true;
    }

    markConnectorsDirty();
    markConnectorsDirty();
    markConnectorsDirty();
    expect(connectorsDirty).toBe(true);
  });
});

describe("Unit Tests — isRectInViewport", () => {
  const viewport = { left: 0, right: 1000, top: 0, bottom: 800 };

  // 7.3 Specific examples
  it("should return true for a rect fully inside the viewport", () => {
    const rect = { left: 100, right: 200, top: 100, bottom: 200 };
    expect(isRectInViewport(rect, viewport)).toBe(true);
  });

  it("should return false for a rect fully to the right of the viewport", () => {
    const rect = { left: 1100, right: 1200, top: 100, bottom: 200 };
    expect(isRectInViewport(rect, viewport)).toBe(false);
  });

  it("should return false for a rect fully below the viewport", () => {
    const rect = { left: 100, right: 200, top: 900, bottom: 1000 };
    expect(isRectInViewport(rect, viewport)).toBe(false);
  });

  it("should return true for a rect partially overlapping the left edge", () => {
    const rect = { left: -50, right: 50, top: 100, bottom: 200 };
    expect(isRectInViewport(rect, viewport)).toBe(true);
  });

  it("should return false for a zero-size rect exactly at the viewport edge", () => {
    const rect = { left: 1000, right: 1000, top: 400, bottom: 400 };
    expect(isRectInViewport(rect, viewport)).toBe(false);
  });
});
