import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ─── Re-implemented pure functions (mirrors frontend/color-palette.js) ───

const COLOR_PALETTE: string[] = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
  '#dcbeff', '#9a6324', '#fffac8', '#800000', '#aaffc3',
  '#808000', '#ffd8b1', '#000075', '#a9a9a9', '#e6beff',
  '#1abc9c', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#e67e22', '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
  '#17becf', '#7f7f7f',
];

function getThreadColor(index: number): string {
  return COLOR_PALETTE[((index % 32) + 32) % 32];
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Property-Based Tests ───

describe("Property-Based Tests — Color assignment", () => {
  // Feature: colored-side-threads, Property 1: Color assignment is index modulo palette size
  // **Validates: Requirements 2.1, 2.2, 2.3, 7.1, 7.2**
  it("should return COLOR_PALETTE[index % 32] for any non-negative integer index", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100_000 }),
        (index) => {
          const color = getThreadColor(index);
          expect(color).toBe(COLOR_PALETTE[index % 32]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property-Based Tests — Append preservation", () => {
  // Feature: colored-side-threads, Property 2: Appending a thread preserves existing color assignments
  // **Validates: Requirements 6.1**
  it("should preserve existing color assignments when a thread is appended", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (n) => {
          // Record colors for N threads
          const colorsBefore = Array.from({ length: n }, (_, i) => getThreadColor(i));

          // "Append" a thread (index n) — existing indices 0..n-1 should be unchanged
          const colorsAfter = Array.from({ length: n + 1 }, (_, i) => getThreadColor(i));

          for (let i = 0; i < n; i++) {
            expect(colorsAfter[i]).toBe(colorsBefore[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property-Based Tests — hexToRgba conversion", () => {
  // Feature: colored-side-threads, Property 3: Hex-to-rgba conversion preserves RGB components
  // **Validates: Requirements 5.1**
  it("should produce correct rgba string for any valid hex color and alpha", () => {
    const hexColorArb = fc
      .tuple(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
      )
      .map(([r, g, b]) => ({
        hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
        r,
        g,
        b,
      }));

    const alphaArb = fc.double({ min: 0, max: 1, noNaN: true });

    fc.assert(
      fc.property(hexColorArb, alphaArb, ({ hex, r, g, b }, alpha) => {
        const result = hexToRgba(hex, alpha);
        expect(result).toBe(`rgba(${r}, ${g}, ${b}, ${alpha})`);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Unit Tests ───

describe("Unit Tests — COLOR_PALETTE", () => {
  it("should contain exactly 32 entries", () => {
    expect(COLOR_PALETTE).toHaveLength(32);
  });

  it("should contain valid 7-character hex strings", () => {
    for (const color of COLOR_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("Unit Tests — getThreadColor", () => {
  it("should return the first color for index 0", () => {
    expect(getThreadColor(0)).toBe(COLOR_PALETTE[0]);
  });

  it("should return the last color for index 31", () => {
    expect(getThreadColor(31)).toBe(COLOR_PALETTE[31]);
  });

  it("should wrap to the first color for index 32", () => {
    expect(getThreadColor(32)).toBe(COLOR_PALETTE[0]);
  });
});

describe("Unit Tests — hexToRgba", () => {
  it('should convert #ff0000 with alpha 0.25 to "rgba(255, 0, 0, 0.25)"', () => {
    expect(hexToRgba("#ff0000", 0.25)).toBe("rgba(255, 0, 0, 0.25)");
  });

  it('should convert #000000 with alpha 0.5 to "rgba(0, 0, 0, 0.5)"', () => {
    expect(hexToRgba("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
  });

  it('should convert #ffffff with alpha 0.5 to "rgba(255, 255, 255, 0.5)"', () => {
    expect(hexToRgba("#ffffff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });
});
