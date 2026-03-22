import { describe, it, expect, beforeEach } from "vitest";
import { ConversationStore } from "../conversation-store";
import {
  ValidationError,
  submitMainQuestion,
  submitSideQuestion,
  submitSideFollowup,
  submitContinuation,
} from "../conversation-ops";

describe("conversation-ops", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
  });

  describe("ValidationError", () => {
    it("is an instance of Error with name ValidationError", () => {
      const err = new ValidationError("test");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("ValidationError");
      expect(err.message).toBe("test");
    });
  });

  describe("submitMainQuestion", () => {
    it("adds a user message to the main thread", () => {
      const msg = submitMainQuestion(store, "What is Rust?");
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("What is Rust?");
      expect(store.getConversation()!.mainThread).toHaveLength(1);
    });

    it("throws ValidationError for empty question", () => {
      expect(() => submitMainQuestion(store, "")).toThrow(ValidationError);
    });

    it("throws ValidationError for whitespace-only question", () => {
      expect(() => submitMainQuestion(store, "   ")).toThrow(ValidationError);
    });
  });

  describe("submitSideQuestion", () => {
    const validAnchor = { messageId: "msg-1", startOffset: 0, endOffset: 10 };

    it("creates a side thread with user message", () => {
      const { thread, userMessage } = submitSideQuestion(
        store, "some text", "Explain this", validAnchor
      );
      expect(thread.anchor.selectedText).toBe("some text");
      expect(thread.anchor.startOffset).toBe(0);
      expect(thread.anchor.endOffset).toBe(10);
      expect(userMessage.role).toBe("user");
      expect(userMessage.content).toBe("Explain this");
      expect(thread.messages).toHaveLength(1);
    });

    it("throws ValidationError for empty question", () => {
      expect(() =>
        submitSideQuestion(store, "some text", "", validAnchor)
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for empty selectedText", () => {
      expect(() =>
        submitSideQuestion(store, "", "Explain this", validAnchor)
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for whitespace-only selectedText", () => {
      expect(() =>
        submitSideQuestion(store, "   ", "Explain this", validAnchor)
      ).toThrow(ValidationError);
    });

    it("throws ValidationError when start >= end", () => {
      expect(() =>
        submitSideQuestion(store, "text", "question", {
          messageId: "msg-1", startOffset: 10, endOffset: 10,
        })
      ).toThrow(ValidationError);
    });

    it("throws ValidationError when start > end", () => {
      expect(() =>
        submitSideQuestion(store, "text", "question", {
          messageId: "msg-1", startOffset: 15, endOffset: 5,
        })
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for negative start offset", () => {
      expect(() =>
        submitSideQuestion(store, "text", "question", {
          messageId: "msg-1", startOffset: -1, endOffset: 5,
        })
      ).toThrow(ValidationError);
    });
  });

  describe("submitSideFollowup", () => {
    it("adds a user message to an existing side thread", () => {
      const { thread } = submitSideQuestion(
        store, "some text", "Initial question",
        { messageId: "msg-1", startOffset: 0, endOffset: 10 }
      );
      // Simulate assistant response
      store.addSideMessage(thread.id, "assistant", "Here is the answer");

      const msg = submitSideFollowup(store, thread.id, "Tell me more");
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Tell me more");
      expect(thread.messages).toHaveLength(3);
    });

    it("throws ValidationError for empty question", () => {
      const { thread } = submitSideQuestion(
        store, "some text", "Initial",
        { messageId: "msg-1", startOffset: 0, endOffset: 10 }
      );
      expect(() => submitSideFollowup(store, thread.id, "")).toThrow(ValidationError);
    });

    it("throws ValidationError for empty threadId", () => {
      store.getOrCreateConversation();
      expect(() => submitSideFollowup(store, "", "question")).toThrow(ValidationError);
    });

    it("throws ValidationError for nonexistent threadId", () => {
      store.getOrCreateConversation();
      expect(() => submitSideFollowup(store, "no-such-id", "question")).toThrow(
        ValidationError
      );
    });

    it("throws ValidationError when no conversation exists", () => {
      expect(() => submitSideFollowup(store, "some-id", "question")).toThrow(
        ValidationError
      );
    });
  });

  describe("submitContinuation", () => {
    it("adds a user message to the main thread", () => {
      // Set up initial exchange
      submitMainQuestion(store, "Initial question");
      store.addMainMessage("assistant", "Initial answer");

      const msg = submitContinuation(store, "Follow up");
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Follow up");
      expect(store.getConversation()!.mainThread).toHaveLength(3);
    });

    it("throws ValidationError for empty question", () => {
      expect(() => submitContinuation(store, "")).toThrow(ValidationError);
    });

    it("throws ValidationError for whitespace-only question", () => {
      expect(() => submitContinuation(store, "  \n\t  ")).toThrow(ValidationError);
    });
  });
});
