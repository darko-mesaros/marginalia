import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { randomUUID } from "node:crypto";
import { ConversationLibrary } from "../conversation-library.js";
import type { PersistenceAdapter } from "../persistence-adapter.js";
import type { Conversation, ConversationSummary } from "../models.js";

// ---------------------------------------------------------------------------
// In-memory PersistenceAdapter for testing
// ---------------------------------------------------------------------------

class InMemoryAdapter implements PersistenceAdapter {
  private store = new Map<string, Conversation>();

  async save(conversation: Conversation): Promise<void> {
    this.store.set(conversation.id, conversation);
  }

  async load(id: string): Promise<Conversation> {
    const c = this.store.get(id);
    if (!c) throw new Error(`Conversation not found: ${id}`);
    return c;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }

  async listSummaries(): Promise<ConversationSummary[]> {
    return Array.from(this.store.values()).map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messageCount:
        c.mainThread.length +
        c.sideThreads.reduce((sum, st) => sum + st.messages.length, 0),
    }));
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbDate = fc
  .date({ min: new Date("2000-01-01"), max: new Date("2030-12-31") })
  .filter((d) => !isNaN(d.getTime()));

const arbMessage = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom("user" as const, "assistant" as const),
  content: fc.string({ minLength: 0, maxLength: 100 }),
  toolInvocations: fc.constant([] as import("../models.js").ToolInvocation[]),
  timestamp: arbDate,
});

const arbAnchor = fc.record({
  messageId: fc.uuid(),
  startOffset: fc.nat(500),
  endOffset: fc.nat(500),
  selectedText: fc.string({ minLength: 1, maxLength: 50 }),
});

const arbSideThread = fc.record({
  id: fc.uuid(),
  anchor: arbAnchor,
  messages: fc.array(arbMessage, { minLength: 0, maxLength: 5 }),
  collapsed: fc.boolean(),
});

const arbConversation: fc.Arbitrary<Conversation> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 0, maxLength: 100 }),
  mainThread: fc.array(arbMessage, { minLength: 0, maxLength: 10 }),
  sideThreads: fc.array(arbSideThread, { minLength: 0, maxLength: 3 }),
  createdAt: arbDate,
  updatedAt: arbDate,
});

// ---------------------------------------------------------------------------
// Property 2: Summary list is sorted by updatedAt descending
// Feature: conversation-saving, Property 2: summary list sorted by updatedAt desc
// ---------------------------------------------------------------------------

describe("ConversationLibrary", () => {
  it(
    "Property 2: summary list sorted by updatedAt desc — list() returns summaries in descending updatedAt order\n  Validates: Requirements 2.2",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbConversation, { minLength: 1, maxLength: 20 }),
          async (conversations) => {
            const adapter = new InMemoryAdapter();
            const library = new ConversationLibrary(adapter);

            // Ensure unique IDs (fast-check may generate duplicates)
            const unique = Array.from(
              new Map(conversations.map((c) => [c.id, c])).values()
            );

            for (const c of unique) {
              await library.save(c);
            }

            const summaries = await library.list();

            // Every adjacent pair must satisfy a.updatedAt >= b.updatedAt
            for (let i = 0; i < summaries.length - 1; i++) {
              const a = new Date(summaries[i].updatedAt).getTime();
              const b = new Date(summaries[i + 1].updatedAt).getTime();
              expect(a).toBeGreaterThanOrEqual(b);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  // ---------------------------------------------------------------------------
  // Property 3: Summary messageCount matches conversation content
  // Feature: conversation-saving, Property 3: messageCount matches content
  // ---------------------------------------------------------------------------

  it(
    "Property 3: messageCount matches content — summary.messageCount equals mainThread.length + sum(sideThread.messages.length)\n  Validates: Requirements 2.3",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbConversation, { minLength: 1, maxLength: 20 }),
          async (conversations) => {
            const adapter = new InMemoryAdapter();
            const library = new ConversationLibrary(adapter);

            // Ensure unique IDs
            const unique = Array.from(
              new Map(conversations.map((c) => [c.id, c])).values()
            );

            for (const c of unique) {
              await library.save(c);
            }

            const summaries = await library.list();

            for (const summary of summaries) {
              const original = unique.find((c) => c.id === summary.id);
              expect(original).toBeDefined();
              if (!original) continue;

              const expectedCount =
                original.mainThread.length +
                original.sideThreads.reduce(
                  (sum, st) => sum + st.messages.length,
                  0
                );

              expect(summary.messageCount).toBe(expectedCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
