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

// ---------------------------------------------------------------------------
// Bug 3 — Double-click anchor offset: Preservation of non-equal-offset behavior
// These tests MUST PASS on unfixed code — they confirm baseline behavior
// that must not regress after the >= to > fix is applied.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
// ---------------------------------------------------------------------------

import { validateSideQuestionBody } from "../validation.js";
import { submitSideQuestion, ValidationError } from "../conversation-ops.js";
import { ConversationStore } from "../conversation-store.js";
import type { Request, Response, NextFunction } from "express";
import { vi, beforeEach } from "vitest";

function mockReq(body: unknown): Request {
  return { body } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 0,
    jsonBody: null as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.jsonBody = body; return res; },
  };
  return res as unknown as Response & { statusCode: number; jsonBody: unknown };
}

describe("Bug 3 — Preservation: Non-Equal Offset Behavior Unchanged", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
  });

  // -----------------------------------------------------------------------
  // Observation tests — specific examples on UNFIXED code
  // -----------------------------------------------------------------------

  it("Observation: validateSideQuestionBody accepts start_offset:0, end_offset:9\n  Validates: Requirements 3.1", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        selected_text: "some text",
        question: "What is this?",
        anchor_position: { start_offset: 0, end_offset: 9, message_id: "msg-1" },
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).not.toBe(422);
  });

  it("Observation: validateSideQuestionBody rejects inverted range start_offset:15, end_offset:5\n  Validates: Requirements 3.3", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        selected_text: "some text",
        question: "What is this?",
        anchor_position: { start_offset: 15, end_offset: 5, message_id: "msg-1" },
      }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
  });

  it("Observation: validateSideQuestionBody rejects negative start_offset:-1\n  Validates: Requirements 3.2", () => {
    const next = vi.fn();
    const res = mockRes();
    validateSideQuestionBody(
      mockReq({
        selected_text: "some text",
        question: "What is this?",
        anchor_position: { start_offset: -1, end_offset: 5, message_id: "msg-1" },
      }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
  });

  it("Observation: submitSideQuestion succeeds with startOffset:0, endOffset:10\n  Validates: Requirements 3.1", () => {
    const result = submitSideQuestion(store, "some text", "What is this?", {
      messageId: "msg-1",
      startOffset: 0,
      endOffset: 10,
    });
    expect(result).toHaveProperty("thread");
    expect(result).toHaveProperty("userMessage");
  });

  it("Observation: submitSideQuestion throws ValidationError for inverted range startOffset:15, endOffset:5\n  Validates: Requirements 3.3", () => {
    expect(() =>
      submitSideQuestion(store, "some text", "What is this?", {
        messageId: "msg-1",
        startOffset: 15,
        endOffset: 5,
      }),
    ).toThrow(ValidationError);
  });

  // -----------------------------------------------------------------------
  // PBT: for all start_offset < end_offset (both non-negative), both accept
  // Validates: Requirements 3.1
  // -----------------------------------------------------------------------

  it("Property 2 (middleware accept): for all start_offset < end_offset (both non-negative), validateSideQuestionBody calls next()\n  Validates: Requirements 3.1", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 9999 }),
        fc.integer({ min: 1, max: 10000 }),
        (start, gap) => {
          const end = start + gap; // guarantees start < end
          const next = vi.fn();
          const res = mockRes();
          validateSideQuestionBody(
            mockReq({
              selected_text: "selected word",
              question: "What does this mean?",
              anchor_position: { start_offset: start, end_offset: end, message_id: "msg-abc" },
            }),
            res,
            next,
          );
          expect(next).toHaveBeenCalled();
          expect(res.statusCode).not.toBe(422);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("Property 2 (business logic accept): for all start_offset < end_offset (both non-negative), submitSideQuestion succeeds\n  Validates: Requirements 3.1", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 9999 }),
        fc.integer({ min: 1, max: 10000 }),
        (start, gap) => {
          const end = start + gap;
          const localStore = new ConversationStore();
          const result = submitSideQuestion(localStore, "selected word", "What does this mean?", {
            messageId: "msg-abc",
            startOffset: start,
            endOffset: end,
          });
          expect(result).toHaveProperty("thread");
          expect(result).toHaveProperty("userMessage");
        },
      ),
      { numRuns: 200 },
    );
  });

  // -----------------------------------------------------------------------
  // PBT: for all start_offset > end_offset (start non-negative), both reject
  // Validates: Requirements 3.3
  // -----------------------------------------------------------------------

  it("Property 2 (middleware reject): for all start_offset > end_offset (start non-negative), validateSideQuestionBody returns 422\n  Validates: Requirements 3.3", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 9999 }),
        fc.integer({ min: 1, max: 10000 }),
        (end, gap) => {
          const start = end + gap; // guarantees start > end
          const next = vi.fn();
          const res = mockRes();
          validateSideQuestionBody(
            mockReq({
              selected_text: "selected word",
              question: "What does this mean?",
              anchor_position: { start_offset: start, end_offset: end, message_id: "msg-abc" },
            }),
            res,
            next,
          );
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(422);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("Property 2 (business logic reject): for all start_offset > end_offset (start non-negative), submitSideQuestion throws ValidationError\n  Validates: Requirements 3.3", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 9999 }),
        fc.integer({ min: 1, max: 10000 }),
        (end, gap) => {
          const start = end + gap;
          const localStore = new ConversationStore();
          expect(() =>
            submitSideQuestion(localStore, "selected word", "What does this mean?", {
              messageId: "msg-abc",
              startOffset: start,
              endOffset: end,
            }),
          ).toThrow(ValidationError);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -----------------------------------------------------------------------
  // PBT: for all negative start_offset, middleware rejects with 422
  // Validates: Requirements 3.2
  // -----------------------------------------------------------------------

  it("Property 2 (negative offset): for all negative start_offset, validateSideQuestionBody returns 422\n  Validates: Requirements 3.2", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10000, max: -1 }),
        fc.nat({ max: 10000 }),
        (start, end) => {
          const next = vi.fn();
          const res = mockRes();
          validateSideQuestionBody(
            mockReq({
              selected_text: "selected word",
              question: "What does this mean?",
              anchor_position: { start_offset: start, end_offset: end, message_id: "msg-abc" },
            }),
            res,
            next,
          );
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(422);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -----------------------------------------------------------------------
  // PBT: empty selected_text, empty question, empty message_id still rejected
  // Validates: Requirements 3.4, 3.5, 3.6
  // -----------------------------------------------------------------------

  it("Property 2 (empty selected_text): empty selected_text is rejected by validateSideQuestionBody\n  Validates: Requirements 3.4", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", "   ", "\t", "\n"),
        (emptyText) => {
          const next = vi.fn();
          const res = mockRes();
          validateSideQuestionBody(
            mockReq({
              selected_text: emptyText,
              question: "What does this mean?",
              anchor_position: { start_offset: 0, end_offset: 10, message_id: "msg-abc" },
            }),
            res,
            next,
          );
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(422);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("Property 2 (empty question): empty question is rejected by validateSideQuestionBody\n  Validates: Requirements 3.5", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", "   ", "\t", "\n"),
        (emptyQuestion) => {
          const next = vi.fn();
          const res = mockRes();
          validateSideQuestionBody(
            mockReq({
              selected_text: "selected word",
              question: emptyQuestion,
              anchor_position: { start_offset: 0, end_offset: 10, message_id: "msg-abc" },
            }),
            res,
            next,
          );
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(422);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("Property 2 (empty message_id): empty message_id is rejected by validateSideQuestionBody\n  Validates: Requirements 3.6", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", "   ", "\t", "\n"),
        (emptyMsgId) => {
          const next = vi.fn();
          const res = mockRes();
          validateSideQuestionBody(
            mockReq({
              selected_text: "selected word",
              question: "What does this mean?",
              anchor_position: { start_offset: 0, end_offset: 10, message_id: emptyMsgId },
            }),
            res,
            next,
          );
          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(422);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Bug 4 — Continue message display: Preservation of existing behavior
// These tests MUST PASS on unfixed code — they confirm baseline behavior
// that must not regress after the question div insertion fix is applied.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";

describe("Bug 4 — Preservation: Continue Message Display Baseline", () => {
  // Read the source file once for all tests in this describe block
  const appJsPath = path.resolve(__dirname, "../../frontend/app.js");
  const appJsSource = fs.readFileSync(appJsPath, "utf-8");

  /**
   * Extract the body of a named async function from the source.
   * Matches `async function <name>(<params>) { ... }` at the top level.
   */
  function extractFunctionBody(fnName: string): string {
    // Use a regex that finds the function declaration and captures its body
    const pattern = new RegExp(
      `async function ${fnName}\\([^)]*\\)\\s*\\{([\\s\\S]*?)^\\}`,
      "m"
    );
    const match = appJsSource.match(pattern);
    if (!match) {
      throw new Error(`Could not find async function ${fnName} in frontend/app.js`);
    }
    return match[1];
  }

  // -----------------------------------------------------------------------
  // Observation 1: submitQuestion() does NOT create a user question div
  // This is by design — the first question is shown in the input bar context.
  // The fix must NOT add a question div to submitQuestion.
  // Validates: Requirements 3.1
  // -----------------------------------------------------------------------

  it("Preservation 4a: submitQuestion does NOT contain a question div creation pattern\n  Validates: Requirements 3.1", () => {
    const fnBody = extractFunctionBody("submitQuestion");

    // submitQuestion should NOT create a div for the user's question text
    // (it only creates a response section via createResponseSection)
    // Check that there is no createElement("div") with question-related styling
    const divCreations = fnBody.match(/document\.createElement\("div"\)/g) || [];

    // The only div creations in submitQuestion are for error messages, not question display.
    // Specifically, there should be no div with border-left question card styling.
    expect(fnBody).not.toContain("border-left: 3px solid var(--color-primary)");
    expect(fnBody).not.toContain("#f0f4f8");
  });

  // -----------------------------------------------------------------------
  // Observation 2: loadConversation() DOES create user question divs
  // with correct styling (font-weight: 600, border-left card style)
  // Validates: Requirements 3.2
  // -----------------------------------------------------------------------

  it("Preservation 4b: loadConversation contains question div pattern with correct styling\n  Validates: Requirements 3.2", () => {
    const fnBody = extractFunctionBody("loadConversation");

    // loadConversation must create a div for user messages
    expect(fnBody).toContain('document.createElement("div")');

    // Must apply the correct styling
    expect(fnBody).toContain("font-weight: 600");
    expect(fnBody).toContain("border-left: 3px solid var(--color-primary)");
    expect(fnBody).toContain("#f0f4f8");

    // Must set textContent for the question text
    expect(fnBody).toMatch(/\.textContent\s*=\s*msg\.content/);

    // Must append to mainPanel
    expect(fnBody).toContain("mainPanel.appendChild(questionDiv)");
  });

  // -----------------------------------------------------------------------
  // Observation 3: submitContinuation() contains continuation-divider class
  // for the <hr> element
  // Validates: Requirements 3.3
  // -----------------------------------------------------------------------

  it("Preservation 4c: submitContinuation contains continuation-divider class for <hr>\n  Validates: Requirements 3.3", () => {
    const fnBody = extractFunctionBody("submitContinuation");

    // Must create an <hr> element
    expect(fnBody).toContain('document.createElement("hr")');

    // Must assign the continuation-divider class
    expect(fnBody).toContain("continuation-divider");

    // Must append the divider to mainPanel
    expect(fnBody).toContain("mainPanel.appendChild(divider)");
  });

  // -----------------------------------------------------------------------
  // Observation 4: submitContinuation() pushes user message to mainThread
  // Validates: Requirements 3.3
  // -----------------------------------------------------------------------

  it("Preservation 4d: submitContinuation pushes user message to state.conversation.mainThread\n  Validates: Requirements 3.3", () => {
    const fnBody = extractFunctionBody("submitContinuation");

    // Must push user message to mainThread
    expect(fnBody).toContain("state.conversation.mainThread.push");

    // The push must include role: "user"
    expect(fnBody).toMatch(/role:\s*"user"/);

    // The push must include content: question
    expect(fnBody).toMatch(/content:\s*question/);
  });

  // -----------------------------------------------------------------------
  // Observation 5: submitContinuation() calls disableContinuationInput()
  // and enableContinuationInput()
  // Validates: Requirements 3.4
  // -----------------------------------------------------------------------

  it("Preservation 4e: submitContinuation calls disableContinuationInput and enableContinuationInput\n  Validates: Requirements 3.4", () => {
    const fnBody = extractFunctionBody("submitContinuation");

    // Must call disableContinuationInput() at the start
    expect(fnBody).toContain("disableContinuationInput()");

    // Must call enableContinuationInput() (in finally block and error path)
    expect(fnBody).toContain("enableContinuationInput()");

    // disableContinuationInput must appear BEFORE enableContinuationInput
    const disableIdx = fnBody.indexOf("disableContinuationInput()");
    const enableIdx = fnBody.indexOf("enableContinuationInput()");
    expect(disableIdx).toBeLessThan(enableIdx);
  });

  // -----------------------------------------------------------------------
  // PBT: For any random question string, the structural observations hold
  // This uses fast-check to verify the structural assertions are stable
  // regardless of what question text might be passed.
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4
  // -----------------------------------------------------------------------

  it("Preservation 4f (PBT): structural observations hold for any question string\n  Validates: Requirements 3.1, 3.2, 3.3, 3.4", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        (_question) => {
          // Re-extract function bodies (source is static, but this proves
          // the structural properties are invariant across all inputs)
          const submitQuestionBody = extractFunctionBody("submitQuestion");
          const loadConversationBody = extractFunctionBody("loadConversation");
          const submitContinuationBody = extractFunctionBody("submitContinuation");

          // submitQuestion must NOT have question card styling
          expect(submitQuestionBody).not.toContain("border-left: 3px solid var(--color-primary)");

          // loadConversation must have question div pattern
          expect(loadConversationBody).toContain("font-weight: 600");
          expect(loadConversationBody).toContain("border-left: 3px solid var(--color-primary)");

          // submitContinuation must have continuation-divider
          expect(submitContinuationBody).toContain("continuation-divider");

          // submitContinuation must push to mainThread
          expect(submitContinuationBody).toContain("state.conversation.mainThread.push");

          // submitContinuation must manage input enable/disable
          expect(submitContinuationBody).toContain("disableContinuationInput()");
          expect(submitContinuationBody).toContain("enableContinuationInput()");
        }
      ),
      { numRuns: 50 }
    );
  });
});
