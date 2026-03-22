import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  getFullSystemPrompt,
  type AppConfig,
  type SkillFile,
  type Message,
  type AnchorPosition,
  type SideThread,
  type Conversation,
} from "../models.js";
import { ContextAssembler } from "../context-assembler.js";

// Feature: marginalia, Property 10: Full system prompt includes base prompt and all skill files
// **Validates: Requirements 11.3, 11.6**

describe("Property 10: Full system prompt includes base prompt and all skill files", () => {
  /**
   * Arbitrary for a non-empty skill file with a unique order value.
   * We generate unique orders by using the index in a mapped array.
   */
  const skillFileArb = (order: number): fc.Arbitrary<SkillFile> =>
    fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      content: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
      order: fc.constant(order),
    });

  const skillFilesArb: fc.Arbitrary<SkillFile[]> = fc
    .integer({ min: 0, max: 10 })
    .chain((count) =>
      count === 0
        ? fc.constant([])
        : fc.tuple(...Array.from({ length: count }, (_, i) => skillFileArb(i))).map((arr) => arr as SkillFile[])
    );

  const appConfigArb: fc.Arbitrary<AppConfig> = fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 300 }).filter((s) => s.trim().length > 0),
      skillFilesArb
    )
    .map(([systemPrompt, skillFiles]) => ({
      bedrockModelId: "us.anthropic.claude-sonnet-4-20250514",
      systemPrompt,
      skillFiles,
      mcpServers: [],
    }));

  it("should contain the base system prompt and every skill file's content", () => {
    fc.assert(
      fc.property(appConfigArb, (config) => {
        const result = getFullSystemPrompt(config);

        // The result must contain the base system prompt
        expect(result).toContain(config.systemPrompt);

        // The result must contain every skill file's content
        for (const sf of config.skillFiles) {
          expect(result).toContain(sf.content);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: marginalia, Property 4: Context assembly includes all side threads with anchor metadata
// **Validates: Requirements 3.3, 7.1, 7.2, 7.4**

describe("Property 4: Context assembly includes all side threads with anchor metadata", () => {
  // --- Arbitraries ---

  const messageArb: fc.Arbitrary<Message> = fc.record({
    id: fc.uuid(),
    role: fc.constantFrom("user" as const, "assistant" as const),
    content: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    toolInvocations: fc.constant([]),
    timestamp: fc.date(),
  });

  const anchorArb: fc.Arbitrary<AnchorPosition> = fc
    .tuple(
      fc.uuid(),
      fc.nat({ max: 500 }),
      fc.integer({ min: 1, max: 200 }),
      fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0)
    )
    .map(([messageId, start, len, selectedText]) => ({
      messageId,
      startOffset: start,
      endOffset: start + len,
      selectedText,
    }));

  const sideThreadArb: fc.Arbitrary<SideThread> = fc
    .tuple(
      fc.uuid(),
      anchorArb,
      fc.array(messageArb, { minLength: 1, maxLength: 4 })
    )
    .map(([id, anchor, messages]) => ({
      id,
      anchor,
      messages,
      collapsed: false,
    }));

  const mainThreadArb: fc.Arbitrary<Message[]> = fc.array(messageArb, {
    minLength: 1,
    maxLength: 5,
  });

  const sideThreadsArb: fc.Arbitrary<SideThread[]> = fc.array(sideThreadArb, {
    minLength: 0,
    maxLength: 5,
  });

  const conversationArb: fc.Arbitrary<Conversation> = fc
    .tuple(fc.uuid(), mainThreadArb, sideThreadsArb, fc.date())
    .map(([id, mainThread, sideThreads, createdAt]) => ({
      id,
      mainThread,
      sideThreads,
      createdAt,
    }));

  const appConfigArb: fc.Arbitrary<AppConfig> = fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0)
    .map((systemPrompt) => ({
      bedrockModelId: "us.anthropic.claude-sonnet-4-20250514",
      systemPrompt,
      skillFiles: [],
      mcpServers: [],
    }));

  const questionArb: fc.Arbitrary<string> = fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0);

  // --- Tests ---

  it("assembleForMain includes every side thread's selectedText and message content", () => {
    fc.assert(
      fc.property(
        appConfigArb,
        conversationArb,
        questionArb,
        (config, conversation, newQuestion) => {
          const assembler = new ContextAssembler(config);
          const result = assembler.assembleForMain(conversation, newQuestion);
          const fullContext = result.map((m) => m.content).join("\n");

          for (const thread of conversation.sideThreads) {
            // Every side thread's anchor selectedText must appear
            expect(fullContext).toContain(thread.anchor.selectedText);

            // Every side thread's message content must appear
            for (const msg of thread.messages) {
              expect(fullContext).toContain(msg.content);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("assembleForSide includes every side thread's selectedText and message content", () => {
    fc.assert(
      fc.property(
        appConfigArb,
        conversationArb.filter((c) => c.sideThreads.length > 0),
        questionArb,
        (config, conversation, newQuestion) => {
          // Pick the first side thread as the target
          const targetThread = conversation.sideThreads[0];
          const assembler = new ContextAssembler(config);
          const result = assembler.assembleForSide(
            conversation,
            targetThread.id,
            newQuestion
          );
          const fullContext = result.map((m) => m.content).join("\n");

          for (const thread of conversation.sideThreads) {
            // Every side thread's anchor selectedText must appear
            expect(fullContext).toContain(thread.anchor.selectedText);

            // Every side thread's message content must appear
            for (const msg of thread.messages) {
              expect(fullContext).toContain(msg.content);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: marginalia, Property 6: Side thread follow-up includes thread history
// **Validates: Requirements 6.2**

describe("Property 6: Side thread follow-up includes thread history", () => {
  // --- Arbitraries ---

  /**
   * Generate a unique, tagged content string using a prefix + uuid to avoid
   * substring collisions that break indexOf-based ordering assertions.
   */
  const uniqueContentArb = (prefix: string): fc.Arbitrary<string> =>
    fc.uuid().map((id) => `${prefix}-${id}`);

  /**
   * Generate 1-3 exchanges (2-6 messages) for a side thread.
   * Each message gets a unique tagged content string.
   */
  const threadMessagesArb: fc.Arbitrary<Message[]> = fc
    .integer({ min: 1, max: 3 })
    .chain((exchangeCount) =>
      fc
        .tuple(
          ...Array.from({ length: exchangeCount }, (_, i) =>
            fc
              .tuple(
                uniqueContentArb(`user-msg-${i}`),
                uniqueContentArb(`asst-msg-${i}`)
              )
              .map(
                ([uContent, aContent]): Message[] => [
                  {
                    id: `u-${i}-${uContent}`,
                    role: "user" as const,
                    content: uContent,
                    toolInvocations: [],
                    timestamp: new Date(),
                  },
                  {
                    id: `a-${i}-${aContent}`,
                    role: "assistant" as const,
                    content: aContent,
                    toolInvocations: [],
                    timestamp: new Date(),
                  },
                ]
              )
          )
        )
        .map((exchanges) => exchanges.flat())
    );

  const anchorArb: fc.Arbitrary<AnchorPosition> = fc
    .tuple(
      fc.uuid(),
      fc.nat({ max: 500 }),
      fc.integer({ min: 1, max: 200 }),
      uniqueContentArb("anchor")
    )
    .map(([messageId, start, len, selectedText]) => ({
      messageId,
      startOffset: start,
      endOffset: start + len,
      selectedText,
    }));

  const sideThreadWithMessagesArb: fc.Arbitrary<SideThread> = fc
    .tuple(fc.uuid(), anchorArb, threadMessagesArb)
    .map(([id, anchor, messages]) => ({
      id,
      anchor,
      messages,
      collapsed: false,
    }));

  const otherSideThreadArb: fc.Arbitrary<SideThread> = fc
    .tuple(fc.uuid(), anchorArb)
    .map(([id, anchor]) => ({
      id,
      anchor,
      messages: [],
      collapsed: false,
    }));

  const mainMessageArb: fc.Arbitrary<Message> = uniqueContentArb(
    "main"
  ).map((content) => ({
    id: `main-${content}`,
    role: "user" as const,
    content,
    toolInvocations: [],
    timestamp: new Date(),
  }));

  const mainThreadArb: fc.Arbitrary<Message[]> = fc.array(mainMessageArb, {
    minLength: 1,
    maxLength: 4,
  });

  const appConfigArb: fc.Arbitrary<AppConfig> = fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0)
    .map((systemPrompt) => ({
      bedrockModelId: "us.anthropic.claude-sonnet-4-20250514",
      systemPrompt,
      skillFiles: [],
      mcpServers: [],
    }));

  const newQuestionArb: fc.Arbitrary<string> =
    uniqueContentArb("new-question");

  it("assembleForSide includes all M prior messages from the target thread in order, plus the new question", () => {
    fc.assert(
      fc.property(
        appConfigArb,
        mainThreadArb,
        sideThreadWithMessagesArb,
        fc.array(otherSideThreadArb, { minLength: 0, maxLength: 3 }),
        newQuestionArb,
        (config, mainThread, targetThread, otherThreads, newQuestion) => {
          const conversation: Conversation = {
            id: "conv-1",
            mainThread,
            sideThreads: [targetThread, ...otherThreads],
            createdAt: new Date(),
          };

          const assembler = new ContextAssembler(config);
          const result = assembler.assembleForSide(
            conversation,
            targetThread.id,
            newQuestion
          );
          const fullContext = result.map((m) => m.content).join("\n");

          // All M prior messages from the target thread must appear in the context
          for (const msg of targetThread.messages) {
            expect(fullContext).toContain(msg.content);
          }

          // Messages must appear in order: for each consecutive pair,
          // the first must appear before the second in the context
          for (let i = 0; i < targetThread.messages.length - 1; i++) {
            const posA = fullContext.indexOf(
              targetThread.messages[i].content
            );
            const posB = fullContext.indexOf(
              targetThread.messages[i + 1].content
            );
            expect(posA).toBeLessThan(posB);
          }

          // The new question must appear in the context
          expect(fullContext).toContain(newQuestion);

          // The new question must appear after all prior thread messages
          if (targetThread.messages.length > 0) {
            const lastMsg =
              targetThread.messages[targetThread.messages.length - 1];
            const lastMsgPos = fullContext.indexOf(lastMsg.content);
            const newQuestionPos = fullContext.indexOf(newQuestion);
            expect(newQuestionPos).toBeGreaterThan(lastMsgPos);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
