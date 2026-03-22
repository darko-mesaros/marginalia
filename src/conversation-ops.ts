import { ConversationStore } from "./conversation-store.js";
import type { Message, SideThread, AnchorPosition } from "./models.js";

/**
 * Custom error class for input validation failures.
 * Thrown when conversation operations receive invalid inputs.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validates that a question string is non-empty after trimming.
 */
function validateQuestion(question: string): void {
  if (!question || question.trim().length === 0) {
    throw new ValidationError("Question must not be empty");
  }
}

/**
 * Submit a main question. Adds a user message to the main thread.
 * The assistant response will be added later after LLM streaming completes.
 *
 * Validates: Requirements 1.1, 1.2
 */
export function submitMainQuestion(
  store: ConversationStore,
  question: string
): Message {
  validateQuestion(question);
  return store.addMainMessage("user", question);
}

/**
 * Submit a side question on selected text. Creates a new side thread
 * anchored to the selection and adds the user message to it.
 *
 * Validates: Requirements 3.2, 3.4
 */
export function submitSideQuestion(
  store: ConversationStore,
  selectedText: string,
  question: string,
  anchorPosition: { messageId: string; startOffset: number; endOffset: number }
): { thread: SideThread; userMessage: Message } {
  validateQuestion(question);

  if (!selectedText || selectedText.trim().length === 0) {
    throw new ValidationError("Selected text must not be empty");
  }

  if (anchorPosition.startOffset >= anchorPosition.endOffset) {
    throw new ValidationError(
      "Invalid anchor position: start offset must be less than end offset"
    );
  }

  if (anchorPosition.startOffset < 0) {
    throw new ValidationError(
      "Invalid anchor position: start offset must not be negative"
    );
  }

  const anchor: AnchorPosition = {
    messageId: anchorPosition.messageId,
    startOffset: anchorPosition.startOffset,
    endOffset: anchorPosition.endOffset,
    selectedText,
  };

  const thread = store.createSideThread(anchor);
  const userMessage = store.addSideMessage(thread.id, "user", question);

  return { thread, userMessage };
}

/**
 * Submit a follow-up question within an existing side thread.
 * Adds the user message to the specified thread.
 *
 * Validates: Requirements 6.1
 */
export function submitSideFollowup(
  store: ConversationStore,
  threadId: string,
  question: string
): Message {
  validateQuestion(question);

  if (!threadId || threadId.trim().length === 0) {
    throw new ValidationError("Thread ID must not be empty");
  }

  const convo = store.getConversation();
  if (!convo) {
    throw new ValidationError("No active conversation");
  }

  const thread = convo.sideThreads.find((t) => t.id === threadId);
  if (!thread) {
    throw new ValidationError(`Side thread not found: ${threadId}`);
  }

  return store.addSideMessage(threadId, "user", question);
}

/**
 * Submit a continuation question in the main thread.
 * Adds a user message to the existing main thread.
 *
 * Validates: Requirements 8.2
 */
export function submitContinuation(
  store: ConversationStore,
  question: string
): Message {
  validateQuestion(question);
  return store.addMainMessage("user", question);
}
