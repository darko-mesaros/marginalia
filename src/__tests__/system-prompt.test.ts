import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadSystemPrompt, saveSystemPrompt } from "../system-prompt.js";

/**
 * Feature: app-config-improvements, Property 2: System prompt save/load round-trip
 * Validates: Requirements 2.1, 2.3, 2.6
 */
describe("Property 2: System prompt save/load round-trip", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "marginalia-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("for any non-empty-after-trim string, saveSystemPrompt then loadSystemPrompt returns content.trim()", async () => {
    const nonEmptyAfterTrim = fc
      .tuple(fc.string(), fc.string({ minLength: 1 }), fc.string())
      .map(([leading, core, trailing]) => leading + core + trailing)
      .filter((s) => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(nonEmptyAfterTrim, async (content) => {
        await saveSystemPrompt(tmpDir, content);
        const loaded = await loadSystemPrompt(tmpDir);
        expect(loaded).toBe(content.trim());
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Unit tests for system prompt edge cases
 * Validates: Requirements 2.2, 2.4, 2.5, 2.6
 */
describe("System prompt unit tests", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "marginalia-unit-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loadSystemPrompt with missing file returns null", async () => {
    const result = await loadSystemPrompt(tmpDir);
    expect(result).toBeNull();
  });

  it("saveSystemPrompt with empty string deletes the file, subsequent load returns null", async () => {
    // First save a real prompt so the file exists
    await saveSystemPrompt(tmpDir, "some prompt");
    const loaded = await loadSystemPrompt(tmpDir);
    expect(loaded).toBe("some prompt");

    // Now save empty string — should delete the file
    await saveSystemPrompt(tmpDir, "");
    const afterDelete = await loadSystemPrompt(tmpDir);
    expect(afterDelete).toBeNull();
  });

  it("loadSystemPrompt with whitespace-only file returns null", async () => {
    await fs.writeFile(path.join(tmpDir, "system-prompt.md"), "   \n\t\n  ", "utf-8");
    const result = await loadSystemPrompt(tmpDir);
    expect(result).toBeNull();
  });
});
