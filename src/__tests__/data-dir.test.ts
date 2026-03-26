import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import * as path from "node:path";
import { resolveDataDir } from "../data-dir.js";

/**
 * Feature: app-config-improvements, Property 3: resolveDataDir respects MARGINALIA_DATA_DIR
 * Validates: Requirements 3.1, 3.8
 */
describe("Property 3: resolveDataDir respects MARGINALIA_DATA_DIR", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.MARGINALIA_DATA_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MARGINALIA_DATA_DIR;
    } else {
      process.env.MARGINALIA_DATA_DIR = originalEnv;
    }
  });

  it("for any non-empty MARGINALIA_DATA_DIR, resolveDataDir() returns path.resolve(value)", () => {
    const nonEmptyString = fc.oneof(
      fc.string({ minLength: 1 }),
      fc.constant("/absolute/path"),
      fc.constant("relative/path")
    ).filter((s) => s.length > 0);

    fc.assert(
      fc.property(nonEmptyString, (dirValue) => {
        process.env.MARGINALIA_DATA_DIR = dirValue;
        const result = resolveDataDir();
        const expected = path.resolve(dirValue);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});

import * as os from "node:os";

/**
 * Unit tests for resolveDataDir
 * Validates: Requirements 3.1, 3.8, 3.9
 */
describe("resolveDataDir unit tests", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.MARGINALIA_DATA_DIR;
    delete process.env.MARGINALIA_DATA_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MARGINALIA_DATA_DIR;
    } else {
      process.env.MARGINALIA_DATA_DIR = originalEnv;
    }
  });

  it("returns ~/.config/marginalia when MARGINALIA_DATA_DIR is unset", () => {
    const result = resolveDataDir();
    const expected = path.join(os.homedir(), ".config", "marginalia");
    expect(result).toBe(expected);
  });

  it("returns absolute MARGINALIA_DATA_DIR as-is", () => {
    process.env.MARGINALIA_DATA_DIR = "/custom/data";
    const result = resolveDataDir();
    expect(result).toBe("/custom/data");
  });

  it("resolves relative MARGINALIA_DATA_DIR against cwd", () => {
    process.env.MARGINALIA_DATA_DIR = "./local-data";
    const result = resolveDataDir();
    expect(result).toBe(path.resolve("./local-data"));
  });
});
