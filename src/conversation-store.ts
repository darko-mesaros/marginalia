import {
  createConversation,
  createMessage,
  addSideThread,
  getSideThread,
  type Conversation,
  type Message,
  type MessageRole,
  type AnchorPosition,
  type SideThread,
} from "./models";

/**
 * In-memory conversation store.
 * Manages a single active conversation (weekend project scope).
 */
export class ConversationStore {
  private conversation: Conversation | null = null;

  /** Returns the existing conversation or creates a new one. */
  getOrCreateConversation(): Conversation {
    if (!this.conversation) {
      this.conversation = createConversation();
    }
    return this.conversation;
  }

  /** Returns the current conversation, or null if none exists. */
  getConversation(): Conversation | null {
    return this.conversation;
  }

  /** Adds a message to the main thread. Creates a conversation if needed. */
  addMainMessage(role: MessageRole, content: string): Message {
    const convo = this.getOrCreateConversation();
    const message = createMessage(role, content);
    convo.mainThread.push(message);
    return message;
  }

  /** Creates a new side thread anchored to the given position. */
  createSideThread(anchor: AnchorPosition): SideThread {
    const convo = this.getOrCreateConversation();
    return addSideThread(convo, anchor);
  }

  /** Adds a message to a specific side thread. Throws if thread not found. */
  addSideMessage(threadId: string, role: MessageRole, content: string): Message {
    const convo = this.getOrCreateConversation();
    const thread = getSideThread(convo, threadId);
    if (!thread) {
      throw new Error(`Side thread not found: ${threadId}`);
    }
    const message = createMessage(role, content);
    thread.messages.push(message);
    return message;
  }

  /** Clears the conversation, resetting the store. */
  reset(): void {
    this.conversation = null;
  }
}
