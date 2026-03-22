import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { ConversationStore } from "../conversation-store.js";
import type { AnchorPosition } from "../models.js";

describe("ConversationStore", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
  });

  describe("getOrCreateConversation", () => {
    it("creates a new conversation on first call", () => {
      const convo = store.getOrCreateConversation();
      expect(convo).toBeDefined();
      expect(convo.id).toBeDefined();
      expect(convo.mainThread).toHaveLength(0);
      expect(convo.sideThreads).toHaveLength(0);
    });

    it("returns the same conversation on subsequent calls", () => {
      const first = store.getOrCreateConversation();
      const second = store.getOrCreateConversation();
      expect(first.id).toBe(second.id);
    });
  });

  describe("getConversation", () => {
    it("returns null when no conversation exists", () => {
      expect(store.getConversation()).toBeNull();
    });

    it("returns the conversation after it is created", () => {
      store.getOrCreateConversation();
      expect(store.getConversation()).not.toBeNull();
    });
  });

  describe("addMainMessage", () => {
    it("adds a user message to the main thread", () => {
      const msg = store.addMainMessage("user", "Hello");
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Hello");
      expect(store.getConversation()!.mainThread).toHaveLength(1);
    });

    it("adds an assistant message to the main thread", () => {
      store.addMainMessage("user", "Hello");
      const msg = store.addMainMessage("assistant", "Hi there");
      expect(msg.role).toBe("assistant");
      expect(store.getConversation()!.mainThread).toHaveLength(2);
    });

    it("creates a conversation if none exists", () => {
      expect(store.getConversation()).toBeNull();
      store.addMainMessage("user", "Hello");
      expect(store.getConversation()).not.toBeNull();
    });
  });

  describe("createSideThread", () => {
    const anchor: AnchorPosition = {
      messageId: "msg-1",
      startOffset: 0,
      endOffset: 10,
      selectedText: "some text",
    };

    it("creates a side thread with the given anchor", () => {
      const thread = store.createSideThread(anchor);
      expect(thread.anchor.selectedText).toBe("some text");
      expect(thread.anchor.messageId).toBe("msg-1");
      expect(thread.messages).toHaveLength(0);
    });

    it("adds the thread to the conversation", () => {
      store.createSideThread(anchor);
      expect(store.getConversation()!.sideThreads).toHaveLength(1);
    });
  });

  describe("addSideMessage", () => {
    const anchor: AnchorPosition = {
      messageId: "msg-1",
      startOffset: 0,
      endOffset: 10,
      selectedText: "some text",
    };

    it("adds a message to an existing side thread", () => {
      const thread = store.createSideThread(anchor);
      const msg = store.addSideMessage(thread.id, "user", "What is this?");
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("What is this?");
      expect(thread.messages).toHaveLength(1);
    });

    it("throws when the thread does not exist", () => {
      store.getOrCreateConversation();
      expect(() => store.addSideMessage("nonexistent", "user", "Hello")).toThrow(
        "Side thread not found: nonexistent"
      );
    });
  });

  describe("setConversation", () => {
    it("replaces the active conversation", () => {
      const first = store.getOrCreateConversation();
      const store2 = new ConversationStore();
      const second = store2.getOrCreateConversation();
      store.setConversation(second);
      expect(store.getConversation()!.id).toBe(second.id);
      expect(store.getConversation()!.id).not.toBe(first.id);
    });
  });

  describe("reset", () => {
    it("clears the conversation", () => {
      store.addMainMessage("user", "Hello");
      store.reset();
      expect(store.getConversation()).toBeNull();
    });

    it("allows creating a new conversation after reset", () => {
      const first = store.getOrCreateConversation();
      store.reset();
      const second = store.getOrCreateConversation();
      expect(first.id).not.toBe(second.id);
    });
  });
});

/**
 * Feature: conversation-saving, Property 6: updatedAt advances on mutation
 * Validates: Requirements 5.3
 */
describe("Property 6: updatedAt advances on message addition", () => {
  const roleArb = fc.constantFrom("user" as const, "assistant" as const);
  const contentArb = fc.string({ minLength: 1 });

  it("updatedAt >= previous updatedAt after addMainMessage", () => {
    fc.assert(
      fc.property(roleArb, contentArb, (role, content) => {
        const store = new ConversationStore();
        store.getOrCreateConversation();
        const before = store.getConversation()!.updatedAt.getTime();
        store.addMainMessage(role, content);
        const after = store.getConversation()!.updatedAt.getTime();
        return after >= before;
      }),
      { numRuns: 100 }
    );
  });

  it("updatedAt >= previous updatedAt after addSideMessage", () => {
    const anchor: AnchorPosition = {
      messageId: "msg-1",
      startOffset: 0,
      endOffset: 5,
      selectedText: "hello",
    };
    fc.assert(
      fc.property(roleArb, contentArb, (role, content) => {
        const store = new ConversationStore();
        const thread = store.createSideThread(anchor);
        const before = store.getConversation()!.updatedAt.getTime();
        store.addSideMessage(thread.id, role, content);
        const after = store.getConversation()!.updatedAt.getTime();
        return after >= before;
      }),
      { numRuns: 100 }
    );
  });
});
