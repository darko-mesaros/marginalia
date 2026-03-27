import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { sanitiseTitle, exportMarkdown, exportHtml, COLOR_PALETTE, hexToRgba } from "../exporters.js";
import { JsonFilePersistenceAdapter } from "../persistence-adapter.js";
import type {
  Conversation,
  Message,
  SideThread,
  AnchorPosition,
  ToolInvocation,
} from "../models.js";

// ---------------------------------------------------------------------------
// Shared fast-check arbitraries
// ---------------------------------------------------------------------------

/** Non-empty printable string (no newlines) for single-line content. */
const arbSingleLine = fc.string({ minLength: 1, maxLength: 80 }).filter(
  (s) => !s.includes("\n") && !s.includes("\r") && s.trim().length > 0
);

/**
 * Arbitrary content with at least one non-whitespace character.
 * Avoids content that is purely whitespace (which causes ambiguous substring matches).
 */
const arbContent = fc.string({ minLength: 1, maxLength: 200 }).filter(
  (s) => !s.includes("\r") && s.trim().length > 0
);

const arbDate = fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") });

function arbMessage(role: "user" | "assistant"): fc.Arbitrary<Message> {
  return fc.record({
    id: fc.uuid(),
    role: fc.constant(role),
    content: arbContent,
    toolInvocations: fc.constant([] as ToolInvocation[]),
    timestamp: arbDate,
  });
}

/** A pair of user + assistant messages (the typical exchange). */
const arbExchangePair: fc.Arbitrary<[Message, Message]> = fc
  .tuple(arbMessage("user"), arbMessage("assistant"))
  .map(([u, a]) => [u, a]);

/** Build a mainThread from 1..4 exchange pairs (alternating user/assistant). */
const arbMainThread: fc.Arbitrary<Message[]> = fc
  .array(arbExchangePair, { minLength: 1, maxLength: 4 })
  .map((pairs) => pairs.flat());

function arbAnchor(messageId: string, content: string): fc.Arbitrary<AnchorPosition> {
  // Pick a substring of the content as selectedText
  return fc.nat({ max: Math.max(0, content.length - 1) }).chain((start) => {
    const maxEnd = Math.min(content.length, start + 40);
    const end = Math.max(start + 1, maxEnd);
    const selectedText = content.slice(start, end);
    return fc.constant<AnchorPosition>({
      messageId,
      startOffset: start,
      endOffset: end,
      selectedText,
    });
  });
}

function arbSideThread(messageId: string, content: string): fc.Arbitrary<SideThread> {
  return fc.record({
    id: fc.uuid(),
    anchor: arbAnchor(messageId, content),
    messages: fc
      .array(
        fc.tuple(arbMessage("user"), arbMessage("assistant")),
        { minLength: 1, maxLength: 2 }
      )
      .map((pairs) => pairs.flat()),
    collapsed: fc.boolean(),
  });
}

/** Conversation with at least one exchange and no side threads. */
const arbConversation: fc.Arbitrary<Conversation> = arbMainThread.chain((mainThread) =>
  fc.record({
    id: fc.uuid(),
    title: arbSingleLine,
    mainThread: fc.constant(mainThread),
    sideThreads: fc.constant([] as SideThread[]),
    createdAt: arbDate,
    updatedAt: arbDate,
  })
);

/** Conversation that may have zero messages (for title-only tests). */
const arbConversationMaybeEmpty: fc.Arbitrary<Conversation> = fc
  .oneof(
    fc.constant([] as Message[]),
    arbMainThread
  )
  .chain((mainThread) =>
    fc.record({
      id: fc.uuid(),
      title: arbSingleLine,
      mainThread: fc.constant(mainThread),
      sideThreads: fc.constant([] as SideThread[]),
      createdAt: arbDate,
      updatedAt: arbDate,
    })
  );

/**
 * Conversation with at least one assistant message and 1..3 side threads
 * anchored to the first assistant message.
 */
function arbConversationWithSideThreads(
  threadCount: { min: number; max: number } = { min: 1, max: 3 }
): fc.Arbitrary<Conversation> {
  return arbMainThread.chain((mainThread) => {
    // Find the first assistant message to anchor side threads to
    const assistantMsg = mainThread.find((m) => m.role === "assistant");
    if (!assistantMsg) {
      // Shouldn't happen with arbMainThread, but guard anyway
      return fc.constant<Conversation>({
        id: "fallback",
        title: "fallback",
        mainThread,
        sideThreads: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return fc
      .array(arbSideThread(assistantMsg.id, assistantMsg.content), {
        minLength: threadCount.min,
        maxLength: threadCount.max,
      })
      .chain((sideThreads) =>
        fc.record({
          id: fc.uuid(),
          title: arbSingleLine,
          mainThread: fc.constant(mainThread),
          sideThreads: fc.constant(sideThreads),
          createdAt: arbDate,
          updatedAt: arbDate,
        })
      );
  });
}

// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 1: Title sanitisation invariant
// ---------------------------------------------------------------------------

describe("sanitiseTitle", () => {
  it(
    "Property 1: Title sanitisation invariant — output contains only [a-zA-Z0-9 _-] and length ≤ 100\n  Validates: Requirements 1.7",
    () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 300 }),
          (title) => {
            const result = sanitiseTitle(title);

            // Output must only contain allowed characters
            expect(result).toMatch(/^[a-zA-Z0-9 _-]*$/);

            // Output must not exceed 100 characters
            expect(result.length).toBeLessThanOrEqual(100);

            // Output must never be empty — falls back to "conversation"
            expect(result.length).toBeGreaterThan(0);
            expect(result.trim().length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 4: Markdown title heading
// ---------------------------------------------------------------------------

describe("exportMarkdown — title heading", () => {
  it(
    "Property 4: Markdown title heading — first line is `# {title}` for any conversation\n  Validates: Requirements 2.1",
    () => {
      fc.assert(
        fc.property(arbConversationMaybeEmpty, (conversation) => {
          const md = exportMarkdown(conversation);
          const firstLine = md.split("\n")[0];
          expect(firstLine).toBe(`# ${conversation.title}`);
        }),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 5: Markdown message content preservation
// ---------------------------------------------------------------------------

describe("exportMarkdown — message content preservation", () => {
  it(
    "Property 5: Markdown message content preservation — user content after ## Question, assistant content verbatim\n  Validates: Requirements 2.2, 2.3",
    () => {
      fc.assert(
        fc.property(arbConversation, (conversation) => {
          const md = exportMarkdown(conversation);

          for (const msg of conversation.mainThread) {
            if (msg.role === "user") {
              // There must be a ## Question heading followed by the user content
              // Find all ## Question positions and verify content follows one of them
              const questionRegex = /## Question\n\n/g;
              let found = false;
              let match: RegExpExecArray | null;
              while ((match = questionRegex.exec(md)) !== null) {
                const afterHeading = md.slice(match.index + match[0].length);
                if (afterHeading.startsWith(msg.content)) {
                  found = true;
                  break;
                }
              }
              expect(found).toBe(true);
            } else {
              // Assistant content must appear verbatim in the output
              expect(md).toContain(msg.content);
            }
          }
        }),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 6: Markdown side thread blockquote structure
// ---------------------------------------------------------------------------

describe("exportMarkdown — side thread blockquote structure", () => {
  it(
    "Property 6: Markdown side thread blockquote structure — blockquote format with On:/Q:/A: and blank line boundaries\n  Validates: Requirements 2.5, 2.6, 7.4",
    () => {
      fc.assert(
        fc.property(
          arbConversationWithSideThreads({ min: 1, max: 3 }),
          (conversation) => {
            const md = exportMarkdown(conversation);
            const lines = md.split("\n");

            for (const thread of conversation.sideThreads) {
              // The blockquote must contain the On: header with selectedText
              const onHeader = `> **On: "${thread.anchor.selectedText}"**`;
              expect(md).toContain(onHeader);

              // Find the line index of the On: header
              const onIdx = lines.findIndex((l) => l === onHeader);
              expect(onIdx).toBeGreaterThanOrEqual(0);

              // There must be a blank line before the blockquote
              // (onIdx > 0 because the first line is the title)
              expect(lines[onIdx - 1]).toBe("");

              // Each user message in the thread should appear as > **Q:** ...
              // Each assistant message should appear as > **A:** ...
              for (const msg of thread.messages) {
                if (msg.role === "user") {
                  expect(md).toContain(`> **Q:** ${msg.content}`);
                } else {
                  expect(md).toContain(`> **A:** ${msg.content}`);
                }
              }

              // Find the last blockquote line for this thread to check trailing blank line
              // The blockquote block is contiguous lines starting with ">"
              let lastBlockquoteLine = onIdx;
              for (let i = onIdx + 1; i < lines.length; i++) {
                if (lines[i].startsWith(">")) {
                  lastBlockquoteLine = i;
                } else {
                  break;
                }
              }

              // There must be a blank line after the blockquote
              if (lastBlockquoteLine + 1 < lines.length) {
                expect(lines[lastBlockquoteLine + 1]).toBe("");
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 7: Markdown side thread placement order
// ---------------------------------------------------------------------------

describe("exportMarkdown — side thread placement order", () => {
  it(
    "Property 7: Markdown side thread placement order — blockquotes appear in sideThreads array order\n  Validates: Requirements 2.4, 7.1, 7.3",
    () => {
      fc.assert(
        fc.property(
          arbConversationWithSideThreads({ min: 2, max: 4 }),
          (conversation) => {
            const md = exportMarkdown(conversation);

            // Group side threads by anchor messageId, preserving array order
            const byMessage = new Map<string, SideThread[]>();
            for (const thread of conversation.sideThreads) {
              const msgId = thread.anchor.messageId;
              if (!byMessage.has(msgId)) {
                byMessage.set(msgId, []);
              }
              byMessage.get(msgId)!.push(thread);
            }

            // Within each message group, blockquotes must appear in array order
            for (const threads of byMessage.values()) {
              if (threads.length < 2) continue;

              // Find positions of each thread's On: header using incremental search
              let searchFrom = 0;
              const positions: number[] = [];

              for (const thread of threads) {
                const onHeader = `> **On: "${thread.anchor.selectedText}"**`;
                const pos = md.indexOf(onHeader, searchFrom);
                expect(pos).toBeGreaterThanOrEqual(0);
                positions.push(pos);
                searchFrom = pos + onHeader.length;
              }

              // Verify strictly increasing positions
              for (let i = 1; i < positions.length; i++) {
                expect(positions[i]).toBeGreaterThan(positions[i - 1]);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});


// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 8: HTML standalone structure
// ---------------------------------------------------------------------------

describe("exportHtml — standalone structure", () => {
  it(
    "Property 8: HTML standalone structure — valid HTML5, meta charset, title, style, no external URLs, no interactive elements\n  Validates: Requirements 3.1, 3.2, 3.4, 3.9",
    () => {
      fc.assert(
        fc.property(arbConversationMaybeEmpty, (conversation) => {
          const html = exportHtml(conversation);

          // Must contain DOCTYPE
          expect(html).toContain("<!DOCTYPE html>");

          // Must contain meta charset
          expect(html).toContain('<meta charset="UTF-8">');

          // Must contain <title> matching conversation title
          // Title is HTML-escaped in the output, so build a local escaper
          const escaped = conversation.title
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
          expect(html).toContain(`<title>${escaped}</title>`);

          // Must contain a <style> element
          expect(html).toContain("<style>");
          expect(html).toContain("</style>");

          // No external URLs in src or href attributes
          // Match src="http(s)://..." or href="http(s)://..."
          expect(html).not.toMatch(/\bsrc\s*=\s*["']https?:\/\//i);
          expect(html).not.toMatch(/\bhref\s*=\s*["']https?:\/\//i);

          // No interactive elements
          expect(html).not.toMatch(/<input[\s>]/i);
          expect(html).not.toMatch(/<textarea[\s>]/i);
          expect(html).not.toMatch(/<nav[\s>]/i);
          expect(html).not.toMatch(/<dialog[\s>]/i);
        }),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 9: HTML markdown-to-HTML conversion
// ---------------------------------------------------------------------------

describe("exportHtml — markdown-to-HTML conversion", () => {
  /**
   * Arbitrary that generates a conversation where the assistant message
   * contains known Markdown patterns so we can verify HTML conversion.
   */
  const arbConversationWithMarkdown: fc.Arbitrary<Conversation> = fc
    .tuple(
      fc.uuid(),
      fc.uuid(),
      fc.uuid(),
      arbSingleLine,
      arbContent, // user content
      arbDate,
      arbDate,
      arbDate,
      arbDate,
    )
    .map(([convId, userId, assistantId, title, userContent, d1, d2, d3, d4]) => {
      // Build assistant content with known markdown patterns
      const assistantContent = [
        "**bold text here**",
        "`inline code`",
        "# Heading One",
      ].join("\n\n");

      const userMsg: Message = {
        id: userId,
        role: "user",
        content: userContent,
        toolInvocations: [],
        timestamp: d1,
      };
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: assistantContent,
        toolInvocations: [],
        timestamp: d2,
      };

      return {
        id: convId,
        title,
        mainThread: [userMsg, assistantMsg],
        sideThreads: [],
        createdAt: d3,
        updatedAt: d4,
      };
    });

  it(
    "Property 9: HTML markdown-to-HTML conversion — Markdown formatting produces corresponding HTML elements\n  Validates: Requirements 3.5",
    () => {
      fc.assert(
        fc.property(arbConversationWithMarkdown, (conversation) => {
          const html = exportHtml(conversation);

          // **bold** should become <strong>
          expect(html).toContain("<strong>");
          expect(html).not.toContain("**bold text here**");

          // `inline code` should become <code>
          expect(html).toContain("<code>");
          expect(html).not.toContain("`inline code`");

          // # Heading One should become <h1>
          expect(html).toContain("<h1>");
        }),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 10: HTML side thread content presence
// ---------------------------------------------------------------------------

describe("exportHtml — side thread content presence", () => {
  /** Local HTML escape helper (mirrors the private escapeHtml in exporters.ts). */
  function escapeForCheck(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  it(
    "Property 10: HTML side thread content presence — selectedText, first user Q, first assistant A appear in output\n  Validates: Requirements 3.6",
    () => {
      fc.assert(
        fc.property(
          arbConversationWithSideThreads({ min: 1, max: 3 }),
          (conversation) => {
            const html = exportHtml(conversation);

            for (const thread of conversation.sideThreads) {
              // selectedText should appear (possibly HTML-escaped)
              const escapedSelected = escapeForCheck(thread.anchor.selectedText);
              expect(html).toContain(escapedSelected);

              // First user message content should appear (HTML-escaped)
              const firstUser = thread.messages.find((m) => m.role === "user");
              if (firstUser) {
                const escapedUser = escapeForCheck(firstUser.content);
                expect(html).toContain(escapedUser);
              }

              // First assistant message content should appear (HTML-escaped)
              const firstAssistant = thread.messages.find((m) => m.role === "assistant");
              if (firstAssistant) {
                const escapedAssistant = escapeForCheck(firstAssistant.content);
                expect(html).toContain(escapedAssistant);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 11: HTML anchor color highlighting
// ---------------------------------------------------------------------------

describe("exportHtml — anchor color highlighting", () => {
  /**
   * Arbitrary for conversations with side threads whose selectedText is
   * long enough (≥ 4 alphanumeric chars) to avoid false substring matches
   * inside HTML tag attributes during mark insertion.
   */
  const arbAlphaContent = fc
    .string({ minLength: 10, maxLength: 200 })
    .filter((s) => !s.includes("\r") && /[a-zA-Z]{4,}/.test(s) && s.trim().length > 0);

  function arbAlphaAnchor(messageId: string, content: string): fc.Arbitrary<AnchorPosition> {
    // Find all runs of 4+ alpha chars in the content to use as selectedText
    const alphaRuns: { start: number; end: number }[] = [];
    const re = /[a-zA-Z]{4,}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      alphaRuns.push({ start: m.index, end: m.index + m[0].length });
    }
    if (alphaRuns.length === 0) {
      // Fallback: use first 4 chars
      const sel = content.slice(0, Math.min(4, content.length));
      return fc.constant<AnchorPosition>({
        messageId,
        startOffset: 0,
        endOffset: sel.length,
        selectedText: sel,
      });
    }
    return fc.nat({ max: alphaRuns.length - 1 }).map((idx) => {
      const run = alphaRuns[idx];
      const selectedText = content.slice(run.start, run.end);
      return {
        messageId,
        startOffset: run.start,
        endOffset: run.end,
        selectedText,
      };
    });
  }

  function arbAlphaSideThread(messageId: string, content: string): fc.Arbitrary<SideThread> {
    return fc.record({
      id: fc.uuid(),
      anchor: arbAlphaAnchor(messageId, content),
      messages: fc
        .array(
          fc.tuple(arbMessage("user"), arbMessage("assistant")),
          { minLength: 1, maxLength: 2 }
        )
        .map((pairs) => pairs.flat()),
      collapsed: fc.boolean(),
    });
  }

  const arbConvForColorTest: fc.Arbitrary<Conversation> = fc
    .array(arbExchangePair, { minLength: 1, maxLength: 3 })
    .map((pairs) => pairs.flat())
    .filter((msgs) => {
      const asst = msgs.find((m) => m.role === "assistant");
      return !!asst && /[a-zA-Z]{4,}/.test(asst.content);
    })
    .chain((mainThread) => {
      const assistantMsg = mainThread.find((m) => m.role === "assistant")!;
      return fc
        .array(arbAlphaSideThread(assistantMsg.id, assistantMsg.content), {
          minLength: 1,
          maxLength: 3,
        })
        .chain((sideThreads) =>
          fc.record({
            id: fc.uuid(),
            title: arbSingleLine,
            mainThread: fc.constant(mainThread),
            sideThreads: fc.constant(sideThreads),
            createdAt: arbDate,
            updatedAt: arbDate,
          })
        );
    });

  it(
    "Property 11: HTML anchor color highlighting — <mark> elements with correct palette colors at ~0.25 alpha\n  Validates: Requirements 3.7, 3.8, 6.1, 6.2, 6.3, 6.5",
    () => {
      fc.assert(
        fc.property(arbConvForColorTest, (conversation) => {
          const html = exportHtml(conversation);

          // Each side thread's palette color at 0.25 alpha must appear in the
          // output — at minimum on the margin note card.
          for (let i = 0; i < conversation.sideThreads.length; i++) {
            const expectedColor = hexToRgba(COLOR_PALETTE[i % 32], 0.25);
            expect(html).toContain(expectedColor);
          }

          // <mark> elements must exist in the output
          expect(html).toMatch(/<mark\b/);

          // Every well-formed <mark> must use an rgba() color from the palette
          const markMatches = html.match(/<mark\s+style="background-color:\s*rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)"/g);
          if (markMatches) {
            const validColors = new Set(
              COLOR_PALETTE.map((hex) => hexToRgba(hex, 0.25))
            );
            for (const m of markMatches) {
              const rgbaMatch = m.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/);
              expect(rgbaMatch).not.toBeNull();
              expect(validColors.has(rgbaMatch![0])).toBe(true);
            }
          }
        }),
        { numRuns: 100 }
      );
    }
  );
});


// ---------------------------------------------------------------------------
// Task 8.1: Unit tests for empty conversation export
// Validates: Requirements 2.7, 3.10
// ---------------------------------------------------------------------------

describe("exportMarkdown — empty conversation", () => {
  it("produces title heading + 'Empty conversation' note when conversation has no messages", () => {
    const conversation: Conversation = {
      id: "empty-conv-1",
      title: "My Empty Chat",
      mainThread: [],
      sideThreads: [],
      createdAt: new Date("2024-06-01"),
      updatedAt: new Date("2024-06-01"),
    };

    const md = exportMarkdown(conversation);
    const lines = md.split("\n");

    expect(lines[0]).toBe("# My Empty Chat");
    expect(md).toContain("Empty conversation");
  });
});

describe("exportHtml — empty conversation", () => {
  it("produces minimal HTML document with title + 'Empty conversation' note when conversation has no messages", () => {
    const conversation: Conversation = {
      id: "empty-conv-2",
      title: "My Empty Chat",
      mainThread: [],
      sideThreads: [],
      createdAt: new Date("2024-06-01"),
      updatedAt: new Date("2024-06-01"),
    };

    const html = exportHtml(conversation);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>My Empty Chat</title>");
    expect(html).toContain("Empty conversation");
    // Should not contain any actual user/assistant message elements (class names in <style> are fine)
    expect(html).not.toMatch(/<div class="user-message"/);
    expect(html).not.toMatch(/<div class="assistant-message"/);
  });
});

// ---------------------------------------------------------------------------
// Task 8.2: Unit tests for side thread fallback placement
// Validates: Requirements 7.2, 6.4
// ---------------------------------------------------------------------------

describe("exportMarkdown — side thread fallback placement", () => {
  it("appends side thread blockquote at end of message when selectedText is not found in assistant content", () => {
    const assistantMsg: Message = {
      id: "asst-msg-1",
      role: "assistant",
      content: "This is the first paragraph.\n\nThis is the second paragraph.",
      toolInvocations: [],
      timestamp: new Date("2024-06-01"),
    };

    const conversation: Conversation = {
      id: "fallback-conv-1",
      title: "Fallback Test",
      mainThread: [
        {
          id: "user-msg-1",
          role: "user",
          content: "Tell me something",
          toolInvocations: [],
          timestamp: new Date("2024-06-01"),
        },
        assistantMsg,
      ],
      sideThreads: [
        {
          id: "thread-1",
          anchor: {
            messageId: "asst-msg-1",
            startOffset: 0,
            endOffset: 20,
            selectedText: "TEXT_THAT_DOES_NOT_EXIST_IN_MESSAGE",
          },
          messages: [
            {
              id: "st-user-1",
              role: "user",
              content: "What about this?",
              toolInvocations: [],
              timestamp: new Date("2024-06-01"),
            },
            {
              id: "st-asst-1",
              role: "assistant",
              content: "Here is the answer.",
              toolInvocations: [],
              timestamp: new Date("2024-06-01"),
            },
          ],
          collapsed: false,
        },
      ],
      createdAt: new Date("2024-06-01"),
      updatedAt: new Date("2024-06-01"),
    };

    const md = exportMarkdown(conversation);

    // The blockquote should appear after the last paragraph of the assistant message
    const blockquoteHeader = `> **On: "TEXT_THAT_DOES_NOT_EXIST_IN_MESSAGE"**`;
    expect(md).toContain(blockquoteHeader);

    // Verify the blockquote comes after the second paragraph (fallback = end of message)
    const secondParagraphIdx = md.indexOf("This is the second paragraph.");
    const blockquoteIdx = md.indexOf(blockquoteHeader);
    expect(blockquoteIdx).toBeGreaterThan(secondParagraphIdx);

    // Verify Q/A content is present
    expect(md).toContain(`> **Q:** What about this?`);
    expect(md).toContain(`> **A:** Here is the answer.`);
  });
});

describe("exportHtml — side thread fallback when selectedText not found", () => {
  it("still renders margin note card when selectedText cannot be found in rendered HTML", () => {
    const assistantMsg: Message = {
      id: "asst-msg-2",
      role: "assistant",
      content: "Some plain assistant content here.",
      toolInvocations: [],
      timestamp: new Date("2024-06-01"),
    };

    const conversation: Conversation = {
      id: "fallback-conv-2",
      title: "HTML Fallback Test",
      mainThread: [
        {
          id: "user-msg-2",
          role: "user",
          content: "Ask something",
          toolInvocations: [],
          timestamp: new Date("2024-06-01"),
        },
        assistantMsg,
      ],
      sideThreads: [
        {
          id: "thread-2",
          anchor: {
            messageId: "asst-msg-2",
            startOffset: 0,
            endOffset: 20,
            selectedText: "NONEXISTENT_SELECTED_TEXT_XYZ",
          },
          messages: [
            {
              id: "st-user-2",
              role: "user",
              content: "Follow up question",
              toolInvocations: [],
              timestamp: new Date("2024-06-01"),
            },
            {
              id: "st-asst-2",
              role: "assistant",
              content: "Follow up answer",
              toolInvocations: [],
              timestamp: new Date("2024-06-01"),
            },
          ],
          collapsed: false,
        },
      ],
      createdAt: new Date("2024-06-01"),
      updatedAt: new Date("2024-06-01"),
    };

    const html = exportHtml(conversation);

    // The margin note card should still be rendered even though the anchor text wasn't found
    expect(html).toContain("margin-note");
    expect(html).toContain("NONEXISTENT_SELECTED_TEXT_XYZ");
    expect(html).toContain("Follow up question");
    expect(html).toContain("Follow up answer");

    // No <mark> should be present since the selectedText wasn't found in the content
    // (neither raw nor HTML-escaped form exists in the assistant message)
    expect(html).not.toMatch(/<mark\b/);
  });
});


// ---------------------------------------------------------------------------
// Feature: conversation-export, Property 12: JSON export round-trip
// Validates: Requirements 4.1, 4.2, 4.3, 4.4
// ---------------------------------------------------------------------------

describe("JSON export round-trip", () => {
  /**
   * A valid-date arbitrary that avoids NaN dates during shrinking.
   * Uses integer timestamps to ensure dates are always valid.
   */
  const arbValidDate = fc
    .integer({ min: new Date("2020-01-01").getTime(), max: new Date("2030-01-01").getTime() })
    .map((ts) => new Date(ts));

  function arbValidMessage(role: "user" | "assistant"): fc.Arbitrary<Message> {
    return fc.record({
      id: fc.uuid(),
      role: fc.constant(role),
      content: arbContent,
      toolInvocations: fc.constant([] as ToolInvocation[]),
      timestamp: arbValidDate,
    });
  }

  const arbValidExchangePair: fc.Arbitrary<[Message, Message]> = fc
    .tuple(arbValidMessage("user"), arbValidMessage("assistant"))
    .map(([u, a]) => [u, a]);

  const arbValidMainThread: fc.Arbitrary<Message[]> = fc
    .array(arbValidExchangePair, { minLength: 1, maxLength: 4 })
    .map((pairs) => pairs.flat());

  function arbValidSideThread(messageId: string, content: string): fc.Arbitrary<SideThread> {
    return fc.record({
      id: fc.uuid(),
      anchor: arbAnchor(messageId, content),
      messages: fc
        .array(
          fc.tuple(arbValidMessage("user"), arbValidMessage("assistant")),
          { minLength: 1, maxLength: 2 }
        )
        .map((pairs) => pairs.flat()),
      collapsed: fc.boolean(),
    });
  }

  /** Conversation with valid dates and 0..3 side threads for round-trip testing. */
  const arbRoundTripConversation: fc.Arbitrary<Conversation> = arbValidMainThread.chain((mainThread) => {
    const assistantMsg = mainThread.find((m) => m.role === "assistant");
    if (!assistantMsg) {
      return fc.record({
        id: fc.uuid(),
        title: arbSingleLine,
        mainThread: fc.constant(mainThread),
        sideThreads: fc.constant([] as SideThread[]),
        createdAt: arbValidDate,
        updatedAt: arbValidDate,
      });
    }

    return fc
      .array(arbValidSideThread(assistantMsg.id, assistantMsg.content), {
        minLength: 0,
        maxLength: 3,
      })
      .chain((sideThreads) =>
        fc.record({
          id: fc.uuid(),
          title: arbSingleLine,
          mainThread: fc.constant(mainThread),
          sideThreads: fc.constant(sideThreads),
          createdAt: arbValidDate,
          updatedAt: arbValidDate,
        })
      );
  });

  it(
    "Property 12: JSON export round-trip — save, read raw file, load back, verify equivalence\n  Validates: Requirements 4.1, 4.2, 4.3, 4.4",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRoundTripConversation,
          async (conversation) => {
            // Create a temp directory for this test run
            const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "export-roundtrip-"));

            try {
              const adapter = new JsonFilePersistenceAdapter(tmpDir);

              // Save the conversation
              await adapter.save(conversation);

              // Read the raw file (simulating JSON export serving the file directly)
              const rawFilePath = path.join(tmpDir, `${conversation.id}.json`);
              const rawContent = await fs.readFile(rawFilePath, "utf-8");

              // Verify it's valid JSON
              const parsed = JSON.parse(rawContent);
              expect(parsed).toBeDefined();

              // Load it back via the adapter
              const loaded = await adapter.load(conversation.id);

              // Verify equivalence of key fields
              expect(loaded.id).toBe(conversation.id);
              expect(loaded.title).toBe(conversation.title);
              expect(loaded.createdAt.toISOString()).toBe(conversation.createdAt.toISOString());
              expect(loaded.updatedAt.toISOString()).toBe(conversation.updatedAt.toISOString());

              // Verify mainThread messages
              expect(loaded.mainThread.length).toBe(conversation.mainThread.length);
              for (let i = 0; i < conversation.mainThread.length; i++) {
                const orig = conversation.mainThread[i];
                const round = loaded.mainThread[i];
                expect(round.id).toBe(orig.id);
                expect(round.role).toBe(orig.role);
                expect(round.content).toBe(orig.content);
                expect(round.timestamp.toISOString()).toBe(orig.timestamp.toISOString());
              }

              // Verify sideThreads
              expect(loaded.sideThreads.length).toBe(conversation.sideThreads.length);
              for (let i = 0; i < conversation.sideThreads.length; i++) {
                const origSt = conversation.sideThreads[i];
                const roundSt = loaded.sideThreads[i];
                expect(roundSt.id).toBe(origSt.id);
                expect(roundSt.anchor.messageId).toBe(origSt.anchor.messageId);
                expect(roundSt.anchor.selectedText).toBe(origSt.anchor.selectedText);
                expect(roundSt.anchor.startOffset).toBe(origSt.anchor.startOffset);
                expect(roundSt.anchor.endOffset).toBe(origSt.anchor.endOffset);
                expect(roundSt.messages.length).toBe(origSt.messages.length);
                for (let j = 0; j < origSt.messages.length; j++) {
                  expect(roundSt.messages[j].id).toBe(origSt.messages[j].id);
                  expect(roundSt.messages[j].role).toBe(origSt.messages[j].role);
                  expect(roundSt.messages[j].content).toBe(origSt.messages[j].content);
                  expect(roundSt.messages[j].timestamp.toISOString()).toBe(
                    origSt.messages[j].timestamp.toISOString()
                  );
                }
              }
            } finally {
              // Clean up temp directory
              await fs.rm(tmpDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
