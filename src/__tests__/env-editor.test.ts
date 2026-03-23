import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Pure logic extracted from `collectEnvVars()` in frontend/app.js.
 * Takes an array of [key, value] tuples (as if read from DOM rows)
 * and produces a Record<string, string> with:
 *   - empty keys (after trim) excluded
 *   - duplicate keys resolved by last-value-wins
 */
export function buildEnvObject(pairs: [string, string][]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [rawKey, value] of pairs) {
    const key = rawKey.trim();
    if (key) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Pure logic extracted from `renderMcpServerList()` in frontend/app.js.
 * Given the count of env vars, returns the display string:
 *   - "" when count is 0
 *   - " · 1 env var" when count is 1
 *   - " · N env vars" when count > 1
 */
export function formatEnvCount(envCount: number): string {
  if (envCount <= 0) return "";
  return ` · ${envCount} env var${envCount === 1 ? "" : "s"}`;
}

// Property 1: Env collection produces correct object from key-value rows
// Validates: Requirements 1.5, 1.6
describe("Env_Editor — Property: Env collection produces correct object from key-value rows", () => {
  it("result contains only non-empty-key entries and last value wins for duplicates", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string(), fc.string())),
        (pairs) => {
          const result = buildEnvObject(pairs);

          // 1. No empty keys in the result
          for (const key of Object.keys(result)) {
            expect(key.trim().length).toBeGreaterThan(0);
          }

          // 2. For duplicate keys, last value wins
          // Build expected map by iterating pairs in order
          const expected: Record<string, string> = {};
          for (const [rawKey, value] of pairs) {
            const key = rawKey.trim();
            if (key) {
              expected[key] = value;
            }
          }

          // Result should match the expected map exactly
          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Property 2: Env count display matches actual env object size
// Validates: Requirements 2.1, 2.2
describe("Env_Editor — Property: Env count display matches actual env object size", () => {
  it("shows correct count text when N > 0, no indicator when N === 0", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1 }), fc.string()),
        (env) => {
          const count = Object.keys(env).length;
          const result = formatEnvCount(count);

          if (count === 0) {
            // No env indicator when empty
            expect(result).toBe("");
          } else {
            // Contains the correct count
            expect(result).toContain(`${count}`);
            // Contains "env var"
            expect(result).toContain("env var");
            // Correct singular/plural
            if (count === 1) {
              expect(result).toBe(" · 1 env var");
            } else {
              expect(result).toBe(` · ${count} env vars`);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
