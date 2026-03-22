import { describe, it, expect, beforeEach } from "vitest";
import { ConversationStore } from "../conversation-store";
import type { AnchorPosition } from "../models";

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
