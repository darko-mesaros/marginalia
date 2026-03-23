import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { processTitle } from "../title-generator.js";

// ---------------------------------------------------------------------------
// Bug Condition Exploration Tests
// These tests are EXPECTED TO FAIL on unfixed code — failure confirms bugs exist.
// DO NOT fix the code or the tests when they fail.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bug 1 — Tool display: blockquote template vs compact indicator
// Validates: Requirements 1.1, 1.2, 1.3
// ---------------------------------------------------------------------------
describe("Bug 1 — Tool display rendering", () => {
  it("tool_use handler should produce compact indicator, not blockquote with raw result", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        (toolName, result) => {
          // Current (buggy) implementation — this is what the frontend does today
          const currentOutput = `\n\n> **Tool:** ${toolName}\n> **Result:** ${result}\n\n`;

          // Expected (fixed) format
          const expectedOutput = `\n\n🔧 Used ${toolName}\n\n`;

          // The current output should NOT contain the raw result
          expect(currentOutput).not.toContain(result);

          // The current output should match the compact indicator format
          expect(currentOutput).toBe(expectedOutput);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — Title markdown: processTitle should strip markdown formatting
// Validates: Requirements 1.4, 2.4
// ---------------------------------------------------------------------------

// Helpers: markdown pattern generators that always produce at least one markdown pattern
const markdownGenerators = {
  heading: fc
    .tuple(
      fc.integer({ min: 1, max: 6 }),
      fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /\w/.test(s))
    )
    .map(([level, text]) => `${"#".repeat(level)} ${text.trim()}`),

  bold: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s) && !s.includes("*"))
    .map((text) => `**${text.trim()}**`),

  italicAsterisk: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s) && !s.includes("*"))
    .map((text) => `*${text.trim()}*`),

  italicUnderscore: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s) && !s.includes("_"))
    .map((text) => `_${text.trim()}_`),

  strikethrough: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s) && !s.includes("~"))
    .map((text) => `~~${text.trim()}~~`),

  inlineCode: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s) && !s.includes("`"))
    .map((text) => `\`${text.trim()}\``),

  link: fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /\w/.test(s) && !s.includes("]") && !s.includes("[")),
      fc.webUrl()
    )
    .map(([text, url]) => `[${text.trim()}](${url})`),

  image: fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /\w/.test(s) && !s.includes("]") && !s.includes("[")),
      fc.webUrl()
    )
    .map(([alt, url]) => `![${alt.trim()}](${url})`),

  blockquote: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s))
    .map((text) => `> ${text.trim()}`),

  unorderedListDash: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s))
    .map((text) => `- ${text.trim()}`),

  unorderedListAsterisk: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s))
    .map((text) => `* ${text.trim()}`),

  unorderedListPlus: fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => /\w/.test(s))
    .map((text) => `+ ${text.trim()}`),

  orderedList: fc
    .tuple(
      fc.integer({ min: 1, max: 99 }),
      fc.string({ minLength: 1, maxLength: 40 }).filter((s) => /\w/.test(s))
    )
    .map(([num, text]) => `${num}. ${text.trim()}`),
};

/** Regex patterns that detect remaining markdown syntax in a string */
const markdownPatterns = [
  /^#{1,6}\s/m,          // heading markers
  /\*\*.+?\*\*/,         // bold
  /(?<!\*)\*(?!\*).+?(?<!\*)\*(?!\*)/,  // italic asterisk (not bold)
  /(?<!\w)_.+?_(?!\w)/,  // italic underscore
  /~~.+?~~/,             // strikethrough
  /`.+?`/,               // inline code
  /\[.+?\]\(.+?\)/,      // links
  /!\[.*?\]\(.+?\)/,     // images
  /^>\s/m,               // blockquotes
  /^[-*+]\s/m,           // unordered list markers
  /^\d+\.\s/m,           // ordered list markers
];

function containsMarkdown(str: string): boolean {
  return markdownPatterns.some((pattern) => pattern.test(str));
}

/** Arbitrary that picks one markdown generator at random */
const anyMarkdownString = fc.oneof(
  markdownGenerators.heading,
  markdownGenerators.bold,
  markdownGenerators.italicAsterisk,
  markdownGenerators.italicUnderscore,
  markdownGenerators.strikethrough,
  markdownGenerators.inlineCode,
  markdownGenerators.link,
  markdownGenerators.image,
  markdownGenerators.blockquote,
  markdownGenerators.unorderedListDash,
  markdownGenerators.unorderedListAsterisk,
  markdownGenerators.unorderedListPlus,
  markdownGenerators.orderedList
);

describe("Bug 2 — Title markdown stripping", () => {
  it("Property 1: processTitle() should return a string with no markdown syntax remaining\n  Validates: Requirements 1.4, 2.4", () => {
    fc.assert(
      fc.property(anyMarkdownString, (input) => {
        const result = processTitle(input);

        // The result should NOT contain any markdown syntax
        expect(containsMarkdown(result)).toBe(false);

        // The result should be non-empty (markdown content has text inside)
        expect(result.length).toBeGreaterThan(0);

        // The result should respect the 60-char limit
        expect(result.length).toBeLessThanOrEqual(60);
      }),
      { numRuns: 200 }
    );
  });
});
