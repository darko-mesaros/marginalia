import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { Request, Response, NextFunction } from "express";
import { processTitle } from "../title-generator.js";
import { validateSideQuestionBody } from "../validation.js";
import { submitSideQuestion, ValidationError } from "../conversation-ops.js";
import { ConversationStore } from "../conversation-store.js";

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


// ---------------------------------------------------------------------------
// Bug 3 — Double-click anchor offset: equal start_offset and end_offset rejected
// Validates: Requirements 1.1, 1.2, 2.1, 2.2
//
// Bug condition: start_offset >= 0 AND start_offset == end_offset
//   AND selected_text IS non-empty AND question IS non-empty
//   AND message_id IS non-empty
//
// Both validateSideQuestionBody (validation.ts) and submitSideQuestion
// (conversation-ops.ts) use `>=` comparison which rejects equal offsets.
// These tests encode the EXPECTED (fixed) behavior — they WILL FAIL on
// unfixed code, confirming the bug exists.
// ---------------------------------------------------------------------------

/** Helper to create a mock Express request with a given body. */
function mockReq(body: unknown): Request {
  return { body } as unknown as Request;
}

/** Helper to create a mock Express response that captures status + json calls. */
function mockRes() {
  const res = {
    statusCode: 0,
    jsonBody: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; jsonBody: unknown };
}

describe("Bug 3 — Double-click anchor offset: equal offsets rejected", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
  });

  // -----------------------------------------------------------------------
  // Unit tests — specific equal-offset examples
  // -----------------------------------------------------------------------

  it("validateSideQuestionBody should call next() for equal offsets (start_offset: 5, end_offset: 5)\n  Validates: Requirements 1.1, 2.1", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        selected_text: "Rust",
        question: "What is this?",
        anchor_position: { start_offset: 5, end_offset: 5, message_id: "msg-1" },
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).not.toBe(422);
  });

  it("submitSideQuestion should return { thread, userMessage } for equal offsets (startOffset: 5, endOffset: 5)\n  Validates: Requirements 1.2, 2.2", () => {
    const result = submitSideQuestion(store, "Rust", "What is this?", {
      messageId: "msg-1",
      startOffset: 5,
      endOffset: 5,
    });
    expect(result).toHaveProperty("thread");
    expect(result).toHaveProperty("userMessage");
    expect(result.thread.anchor.startOffset).toBe(5);
    expect(result.thread.anchor.endOffset).toBe(5);
    expect(result.userMessage.role).toBe("user");
  });

  it("validateSideQuestionBody should call next() for zero-zero offsets with valid non-empty selected_text\n  Validates: Requirements 1.1, 2.1", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        selected_text: "Hello",
        question: "Explain this",
        anchor_position: { start_offset: 0, end_offset: 0, message_id: "msg-1" },
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).not.toBe(422);
  });

  it("submitSideQuestion should not throw for zero-zero offsets with valid non-empty selected_text\n  Validates: Requirements 1.2, 2.2", () => {
    expect(() =>
      submitSideQuestion(store, "Hello", "Explain this", {
        messageId: "msg-1",
        startOffset: 0,
        endOffset: 0,
      }),
    ).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Property-based tests — for all non-negative n, equal offsets accepted
  // -----------------------------------------------------------------------

  it("Property 1 (middleware): for all non-negative n, validateSideQuestionBody({ start_offset: n, end_offset: n }) should call next()\n  Validates: Requirements 1.1, 2.1", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }),
        (n) => {
          const next = vi.fn();
          const res = mockRes();
          validateSideQuestionBody(
            mockReq({
              selected_text: "selected word",
              question: "What does this mean?",
              anchor_position: { start_offset: n, end_offset: n, message_id: "msg-abc" },
            }),
            res,
            next,
          );
          expect(next).toHaveBeenCalled();
          expect(res.statusCode).not.toBe(422);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 1 (business logic): for all non-negative n, submitSideQuestion with equal offsets should not throw\n  Validates: Requirements 1.2, 2.2", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }),
        (n) => {
          const localStore = new ConversationStore();
          expect(() =>
            submitSideQuestion(localStore, "selected word", "What does this mean?", {
              messageId: "msg-abc",
              startOffset: n,
              endOffset: n,
            }),
          ).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Bug 4 — Continue message display: submitContinuation skips user question div
// Validates: Requirements 1.1, 1.2, 2.1, 2.2
//
// Bug condition: submitContinuation() does NOT create a user question <div>
//   between the <hr> divider append and the createResponseSection() call.
//   The user's continuation question text is never rendered in the main panel.
//
// This test reads frontend/app.js, extracts the submitContinuation function
// body, and asserts that the 4-line question div creation pattern exists
// AFTER the continuation-divider append and BEFORE createResponseSection.
//
// EXPECTED TO FAIL on unfixed code — failure confirms the bug exists.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";

describe("Bug 4 — Continue message display: submitContinuation skips user question div", () => {
  // Read the source file once for all tests
  const appJsPath = path.resolve(__dirname, "../../frontend/app.js");
  const appJsSource = fs.readFileSync(appJsPath, "utf-8");

  /**
   * Extract the body of the submitContinuation function from the source.
   * Finds "async function submitContinuation(question)" and captures everything
   * between the divider append and createResponseSection call.
   */
  function extractSubmitContinuationBody(): string {
    // Match the entire submitContinuation function (greedy enough to get the full body)
    const fnMatch = appJsSource.match(
      /async function submitContinuation\(question\)\s*\{([\s\S]*?)^\}/m
    );
    if (!fnMatch) {
      throw new Error("Could not find submitContinuation function in frontend/app.js");
    }
    return fnMatch[1];
  }

  /**
   * Extract the code segment between the divider append and createResponseSection.
   * This is the critical zone where the question div should be created.
   */
  function extractDividerToResponseSection(fnBody: string): string {
    const dividerAppendIdx = fnBody.indexOf("mainPanel.appendChild(divider)");
    const createResponseIdx = fnBody.indexOf("createResponseSection(");

    if (dividerAppendIdx === -1) {
      throw new Error("Could not find mainPanel.appendChild(divider) in submitContinuation");
    }
    if (createResponseIdx === -1) {
      throw new Error("Could not find createResponseSection() call in submitContinuation");
    }

    // Extract the code between divider append and createResponseSection
    return fnBody.substring(
      dividerAppendIdx + "mainPanel.appendChild(divider)".length,
      createResponseIdx
    );
  }

  it("Property 1 (Bug Condition): for any non-empty trimmed question, submitContinuation should contain question div creation pattern\n  Validates: Requirements 1.1, 1.2, 2.1, 2.2", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        (_question) => {
          const fnBody = extractSubmitContinuationBody();
          const criticalZone = extractDividerToResponseSection(fnBody);

          // Assert: the critical zone between divider append and createResponseSection
          // must contain the 4-line question div creation pattern

          // 1. Must create a div element for the question
          expect(criticalZone).toContain('document.createElement("div")');

          // 2. Must apply font-weight: 600 styling
          expect(criticalZone).toContain("font-weight: 600");

          // 3. Must apply border-left card styling
          expect(criticalZone).toContain("border-left: 3px solid var(--color-primary)");

          // 4. Must assign textContent for the question text
          expect(criticalZone).toMatch(/\.textContent\s*=/);
        }
      ),
      { numRuns: 100 }
    );
  });
});
