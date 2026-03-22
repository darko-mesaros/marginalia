import {
  getFullSystemPrompt,
  type AppConfig,
  type Conversation,
  type SideThread,
} from "./models.js";

interface ContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const MARGIN_NOTE_INSTRUCTION =
  "The user has margin notes on specific passages. These are included below for context.";

/**
 * Builds the context window sent to the LLM.
 * Assembles context differently depending on the request type
 * (main thread vs side thread).
 */
export class ContextAssembler {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Build context for main thread questions.
   * Includes: system prompt + skill files, main thread history,
   * all side thread summaries with anchor metadata, new question.
   */
  assembleForMain(
    conversation: Conversation,
    newQuestion: string
  ): ContextMessage[] {
    const messages: ContextMessage[] = [];

    // System message: base prompt + skill files + margin note instruction
    messages.push(this.buildSystemMessage(conversation));

    // Main thread history (all existing exchanges)
    for (const msg of conversation.mainThread) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Side thread context as a single user message block (if any exist)
    if (conversation.sideThreads.length > 0) {
      const sideContext = this.formatSideThreads(conversation.sideThreads);
      messages.push({ role: "user", content: sideContext });
      messages.push({
        role: "assistant",
        content:
          "I've noted all the margin note discussions above. I'll keep them in mind.",
      });
    }

    // New user question
    messages.push({ role: "user", content: newQuestion });

    return messages;
  }

  /**
   * Build context for side thread questions.
   * Includes: system prompt + skill files, main thread history,
   * all side thread exchanges, new question scoped to thread.
   */
  assembleForSide(
    conversation: Conversation,
    threadId: string,
    newQuestion: string
  ): ContextMessage[] {
    const messages: ContextMessage[] = [];

    // System message
    messages.push(this.buildSystemMessage(conversation));

    // Main thread history
    for (const msg of conversation.mainThread) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // All side threads as context
    if (conversation.sideThreads.length > 0) {
      const sideContext = this.formatSideThreads(conversation.sideThreads);
      messages.push({ role: "user", content: sideContext });
      messages.push({
        role: "assistant",
        content:
          "I've noted all the margin note discussions above. I'll keep them in mind.",
      });
    }

    // New question scoped to the target thread
    const targetThread = conversation.sideThreads.find(
      (t: SideThread) => t.id === threadId
    );
    const scopePrefix = targetThread
      ? `[Regarding the margin note on: "${targetThread.anchor.selectedText}"]\n`
      : "";
    const conciseness = "Be concise — 2-4 sentences max. Use plain prose. No headers, no bullet lists, no emojis. Include a short code snippet only if it directly answers the question.\n\n";
    messages.push({ role: "user", content: `${conciseness}${scopePrefix}${newQuestion}` });

    return messages;
  }

  /**
   * Format all side threads as structured context blocks,
   * preserving anchor text and thread identity.
   */
  private formatSideThreads(threads: SideThread[]): string {
    const blocks: string[] = [
      "Here are the margin note discussions so far:\n",
    ];

    for (const thread of threads) {
      blocks.push(
        `--- Margin Note on: "${thread.anchor.selectedText}" ---`
      );
      for (const msg of thread.messages) {
        const label = msg.role === "user" ? "User" : "Assistant";
        blocks.push(`${label}: ${msg.content}`);
      }
      blocks.push("--- End Margin Note ---\n");
    }

    return blocks.join("\n");
  }

  /**
   * Build the system message with base prompt, skill files,
   * and margin note instruction if side threads exist.
   */
  private buildSystemMessage(conversation: Conversation): ContextMessage {
    let systemContent = getFullSystemPrompt(this.config);

    if (conversation.sideThreads.length > 0) {
      systemContent += `\n\n${MARGIN_NOTE_INSTRUCTION}`;
    }

    return { role: "system", content: systemContent };
  }
}
