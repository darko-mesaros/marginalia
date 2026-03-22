import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  createSideThread,
  createConversation,
  addSideThread,
  type AnchorPosition,
} from "../models";
import { ConversationStore } from "../conversation-store";
import {
  submitMainQuestion,
  submitContinuation,
  submitSideQuestion,
  submitSideFollowup,
} from "../conversation-ops";

// Feature: marginalia, Property 3: Side thread creation preserves anchor data
// **Validates: Requirements 3.2, 4.3, 5.1**

describe("Property 3: Side thread creation preserves anchor data", () => {
  /**
   * Arbitrary for a valid AnchorPosition:
   * - non-empty selectedText
   * - startOffset >= 0, endOffset > startOffset
   * - non-empty messageId (UUID-like)
   */
  const anchorArb: fc.Arbitrary<AnchorPosition> = fc
    .tuple(
      fc.uuid(),
      fc.nat({ max: 10000 }),
      fc.integer({ min: 1, max: 10000 }),
      fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0)
    )
    .map(([messageId, start, length, selectedText]) => ({
      messageId,
      startOffset: start,
      endOffset: start + length,
      selectedText,
    }));

  it("createSideThread preserves the exact anchor data", () => {
    fc.assert(
      fc.property(anchorArb, (anchor) => {
        const thread = createSideThread(anchor);

        // Anchor selectedText must match exactly
        expect(thread.anchor.selectedText).toBe(anchor.selectedText);
        // Anchor offsets must match
        expect(thread.anchor.startOffset).toBe(anchor.startOffset);
        expect(thread.anchor.endOffset).toBe(anchor.endOffset);
        // start < end invariant holds
        expect(thread.anchor.startOffset).toBeLessThan(thread.anchor.endOffset);
        // messageId must match
        expect(thread.anchor.messageId).toBe(anchor.messageId);
        // Thread should have an id and empty messages
        expect(thread.id).toBeDefined();
        expect(thread.messages).toHaveLength(0);
        expect(thread.collapsed).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("adding N side threads with different anchors results in exactly N side threads", () => {
    fc.assert(
      fc.property(
        fc.array(anchorArb, { minLength: 0, maxLength: 20 }),
        (anchors) => {
          const conversation = createConversation();

          for (const anchor of anchors) {
            addSideThread(conversation, anchor);
          }

          // Conversation should have exactly N side threads
          expect(conversation.sideThreads).toHaveLength(anchors.length);

          // Each side thread's anchor should match the corresponding input anchor
          for (let i = 0; i < anchors.length; i++) {
            const thread = conversation.sideThreads[i];
            expect(thread.anchor.selectedText).toBe(anchors[i].selectedText);
            expect(thread.anchor.startOffset).toBe(anchors[i].startOffset);
            expect(thread.anchor.endOffset).toBe(anchors[i].endOffset);
            expect(thread.anchor.messageId).toBe(anchors[i].messageId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Feature: marginalia, Property 1: Question submission grows the main thread
// **Validates: Requirements 1.2**

describe("Property 1: Question submission grows the main thread", () => {
  /**
   * Arbitrary for a non-empty question string.
   * Generates strings of length 1–500 that are non-empty after trimming.
   */
  const questionArb = fc
    .string({ minLength: 1, maxLength: 500 })
    .filter((s) => s.trim().length > 0);

  it("submitMainQuestion adds exactly one user message to the main thread", () => {
    fc.assert(
      fc.property(questionArb, (question) => {
        const store = new ConversationStore();
        const convo = store.getOrCreateConversation();
        const beforeLength = convo.mainThread.length;

        submitMainQuestion(store, question);

        // Main thread should have grown by exactly 1 (user message only)
        expect(convo.mainThread.length).toBe(beforeLength + 1);

        // The added message should be a user message with matching content
        const addedMessage = convo.mainThread[convo.mainThread.length - 1];
        expect(addedMessage.role).toBe("user");
        expect(addedMessage.content).toBe(question);
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: marginalia, Property 8: Continuation appends to main thread
// **Validates: Requirements 8.2**

describe("Property 8: Continuation appends to main thread", () => {
  /**
   * Arbitrary for a non-empty question string (trimmed non-empty).
   */
  const questionArb = fc
    .string({ minLength: 1, maxLength: 500 })
    .filter((s) => s.trim().length > 0);

  /**
   * Generates an alternating user/assistant message pair sequence of length M (2–10).
   * Even indices are "user", odd indices are "assistant".
   */
  const mainThreadMessagesArb = fc
    .integer({ min: 2, max: 10 })
    .chain((m) =>
      fc
        .array(
          fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
          { minLength: m, maxLength: m }
        )
        .map((contents) =>
          contents.map((content, i) => ({
            role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
            content,
          }))
        )
    );

  it("submitContinuation adds the user question to the main thread, preserving all prior messages", () => {
    fc.assert(
      fc.property(
        mainThreadMessagesArb,
        questionArb,
        (existingMessages, continuationQuestion) => {
          // Set up a store pre-populated with M alternating messages
          const store = new ConversationStore();
          const convo = store.getOrCreateConversation();

          for (const msg of existingMessages) {
            store.addMainMessage(msg.role, msg.content);
          }

          const M = existingMessages.length;

          // Snapshot the prior messages (id, role, content) before continuation
          const priorSnapshots = convo.mainThread.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }));

          // Submit continuation
          submitContinuation(store, continuationQuestion);

          // Main thread should now have M + 1 messages (user question added)
          expect(convo.mainThread).toHaveLength(M + 1);

          // The last message should be the user's continuation question
          const lastMessage = convo.mainThread[M];
          expect(lastMessage.role).toBe("user");
          expect(lastMessage.content).toBe(continuationQuestion);

          // All prior M messages remain unchanged (same id, role, content)
          for (let i = 0; i < M; i++) {
            expect(convo.mainThread[i].id).toBe(priorSnapshots[i].id);
            expect(convo.mainThread[i].role).toBe(priorSnapshots[i].role);
            expect(convo.mainThread[i].content).toBe(priorSnapshots[i].content);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Feature: marginalia, Property 7: Side thread messages maintain chronological order
// **Validates: Requirements 6.3**

describe("Property 7: Side thread messages maintain chronological order", () => {
  const questionArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  const anchorArb = fc
    .tuple(
      fc.uuid(),
      fc.nat({ max: 10000 }),
      fc.integer({ min: 1, max: 10000 }),
      fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0)
    )
    .map(([messageId, start, length, selectedText]) => ({
      messageId,
      startOffset: start,
      endOffset: start + length,
      selectedText,
    }));

  it("side thread messages are ordered by timestamp after multiple follow-ups", () => {
    fc.assert(
      fc.property(
        anchorArb,
        questionArb,
        fc.array(questionArb, { minLength: 2, maxLength: 8 }),
        (anchor, initialQuestion, followUps) => {
          const store = new ConversationStore();
          store.getOrCreateConversation();

          // Create the side thread with the initial question
          const { thread } = submitSideQuestion(
            store,
            anchor.selectedText,
            initialQuestion,
            anchor
          );

          // Simulate assistant response for the initial question
          store.addSideMessage(thread.id, "assistant", "Response to: " + initialQuestion);

          // Add follow-up user messages and assistant responses
          for (const followUp of followUps) {
            submitSideFollowup(store, thread.id, followUp);
            store.addSideMessage(thread.id, "assistant", "Response to: " + followUp);
          }

          const messages = thread.messages;

          // There should be at least the initial pair + follow-up pairs
          expect(messages.length).toBeGreaterThanOrEqual(2);

          // Assert chronological ordering: for all consecutive pairs,
          // message[i].timestamp <= message[i+1].timestamp
          for (let i = 0; i < messages.length - 1; i++) {
            expect(messages[i].timestamp.getTime()).toBeLessThanOrEqual(
              messages[i + 1].timestamp.getTime()
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Feature: marginalia, Property 12: Side thread contains both question and response
// **Validates: Requirements 4.2**

describe("Property 12: Side thread contains both question and response", () => {
  const questionArb = fc
    .string({ minLength: 1, maxLength: 300 })
    .filter((s) => s.trim().length > 0);

  const selectedTextArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  const anchorArb = fc
    .tuple(
      fc.uuid(),
      fc.nat({ max: 10000 }),
      fc.integer({ min: 1, max: 10000 }),
      selectedTextArb
    )
    .map(([messageId, start, length, selectedText]) => ({
      messageId,
      startOffset: start,
      endOffset: start + length,
      selectedText,
    }));

  const assistantContentArb = fc
    .string({ minLength: 1, maxLength: 500 })
    .filter((s) => s.trim().length > 0);

  it("side thread contains user question and assistant response after submitSideQuestion + addSideMessage", () => {
    fc.assert(
      fc.property(
        anchorArb,
        questionArb,
        assistantContentArb,
        (anchor, question, assistantContent) => {
          const store = new ConversationStore();

          // Create the side thread with the user's question
          const { thread } = submitSideQuestion(
            store,
            anchor.selectedText,
            question,
            anchor
          );

          // Simulate the assistant response
          store.addSideMessage(thread.id, "assistant", assistantContent);

          // Thread should contain at least 2 messages
          expect(thread.messages.length).toBeGreaterThanOrEqual(2);

          // First message should be the user's question
          const firstMessage = thread.messages[0];
          expect(firstMessage.role).toBe("user");
          expect(firstMessage.content).toBe(question);

          // Second message should be the assistant's response with non-empty content
          const secondMessage = thread.messages[1];
          expect(secondMessage.role).toBe("assistant");
          expect(secondMessage.content).toBe(assistantContent);
          expect(secondMessage.content.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
