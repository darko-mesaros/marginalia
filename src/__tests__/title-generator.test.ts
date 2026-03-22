import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { processTitle } from "../title-generator.js";

// ---------------------------------------------------------------------------
// Property 4: Title length invariant
// Feature: conversation-saving, Property 4: title length invariant
// ---------------------------------------------------------------------------

describe("TitleGenerator", () => {
  it(
    "Property 4: title length invariant — processTitle always returns a non-empty string of at most 60 characters\n  Validates: Requirements 4.3",
    () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), (raw) => {
          const title = processTitle(raw);
          expect(title.length).toBeGreaterThan(0);
          expect(title.length).toBeLessThanOrEqual(60);
        }),
        { numRuns: 100 }
      );
    }
  );
});
