import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processTitle } from "../title-generator.js";

// ---------------------------------------------------------------------------
// Preservation Property Tests
// These tests MUST PASS on unfixed code — they confirm baseline behavior
// that must not regress after the fix is applied.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: reference implementation of processTitle behavior
// (first line only, strip quotes, trim, word-boundary truncate to 60,
//  fallback to "Untitled Conversation")
// ---------------------------------------------------------------------------
function referenceProcessTitle(raw: string): string {
  let title = raw;
  title = title.replace(/^["']+|["']+$/g, "");
  title = title.split("\n")[0].trim();
  if (title.length === 0) {
    title = "Untitled Conversation";
  }
  if (title.length > 60) {
    const truncated = title.substring(0, 60);
    const lastSpace = truncated.lastIndexOf(" ");
    title = lastSpace > 10 ? truncated.substring(0, lastSpace) : truncated;
  }
  return title;
}

// ---------------------------------------------------------------------------
// Property 2a — Plain text title preservation
// For strings with NO markdown formatting characters, processTitle must
// produce the same result as the original implementation.
// Validates: Requirements 3.3
// ---------------------------------------------------------------------------

/**
 * Generator for strings that contain NO markdown-significant characters.
 * Excludes: # * _ ~ ` [ ] ( ) ! >
 * Also avoids line-start patterns like "- ", "+ ", "1. "
 */
const plainTextArbitrary = fc
  .string({ minLength: 0, maxLength: 200 })
  .filter((s) => {
    // No markdown-significant characters anywhere
    if (/[#*_~`\[\]()!>]/.test(s)) return false;
    // No quotes (stripped by processTitle)
    if (/["']/.test(s)) return false;
    // No unordered list markers at line starts
    if (/^[-+]\s/m.test(s)) return false;
    // No ordered list markers at line starts
    if (/^\d+\.\s/m.test(s)) return false;
    // No newlines (processTitle takes first line only)
    if (/\n/.test(s)) return false;
    // No HTML-like tags (stripped by thinking tag regex)
    if (/<[^>]*>/i.test(s)) return false;
    return true;
  });

describe("Preservation Properties", () => {
  // -------------------------------------------------------------------------
  // Property 2a — Plain text title preservation
  // -------------------------------------------------------------------------
  it("Property 2a: plain text titles produce identical output to original implementation\n  Validates: Requirements 3.3", () => {
    fc.assert(
      fc.property(plainTextArbitrary, (input) => {
        const actual = processTitle(input);
        const expected = referenceProcessTitle(input);
        expect(actual).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  // -------------------------------------------------------------------------
  // Property 2b — Token event string accumulation pattern
  // Structural assertion: the frontend code uses
  //   accumulatedContent += evt.data.content
  // for token events. This pattern must exist in all streaming functions.
  // Validates: Requirements 3.1
  // -------------------------------------------------------------------------
  it("Property 2b: token event accumulation pattern exists in frontend/app.js\n  Validates: Requirements 3.1", () => {
    const appJsPath = resolve(process.cwd(), "frontend", "app.js");
    const appJs = readFileSync(appJsPath, "utf-8");

    // The token accumulation pattern must appear in the file
    const tokenAccumulationPattern = /accumulatedContent\s*\+=\s*evt\.data\.content/g;
    const matches = appJs.match(tokenAccumulationPattern);

    // Must exist (at least in submitQuestion and submitContinuation)
    expect(matches).not.toBeNull();
    // There are 8 occurrences across 4 streaming functions (main loop + buffer each)
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  // -------------------------------------------------------------------------
  // Property 2c — Title length invariant (existing test verification)
  // The existing test in title-generator.test.ts already covers this.
  // We re-run it here as a sanity check.
  // Validates: Requirements 3.3
  // -------------------------------------------------------------------------
  it("Property 2c: processTitle always returns non-empty string of at most 60 characters\n  Validates: Requirements 3.3", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (raw) => {
        const title = processTitle(raw);
        expect(title.length).toBeGreaterThan(0);
        expect(title.length).toBeLessThanOrEqual(60);
      }),
      { numRuns: 100 }
    );
  });
});
