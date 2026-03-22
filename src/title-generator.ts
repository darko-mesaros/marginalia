import { Agent, BedrockModel } from "@strands-agents/sdk";

const TITLE_PROMPT = `You are a title generator. Given a user's question, produce a short descriptive title that summarises the topic. Rules:
- Return ONLY the title text, nothing else
- Maximum 60 characters
- No quotes, no punctuation at the end
- Be specific and descriptive`;

/**
 * Process raw model output into a valid title.
 * Trims whitespace, truncates to 60 chars, falls back to "Untitled Conversation" if empty.
 */
export function processTitle(raw: string): string {
  let title = raw.trim();
  if (title.length === 0) {
    title = "Untitled Conversation";
  }
  if (title.length > 60) {
    title = title.substring(0, 60);
  }
  return title;
}

export class TitleGenerator {
  private readonly titleModelId: string;

  constructor(titleModelId?: string) {
    this.titleModelId = titleModelId ?? process.env.TITLE_MODEL_ID ?? process.env.BEDROCK_MODEL_ID ?? "qwen.qwen3-vl-235b-a22b";
  }

  /**
   * Fire-and-forget title generation.
   * Starts generation in background, calls onComplete(title) on success.
   * Logs and swallows errors on failure.
   */
  generateAsync(
    conversationId: string,
    firstQuestion: string,
    onComplete: (title: string) => Promise<void>
  ): void {
    this.generate(firstQuestion)
      .then((title) => onComplete(title))
      .catch((err) => {
        console.error(`[TitleGenerator] Failed to generate title for ${conversationId}:`, err);
      });
  }

  /**
   * Generate a title from the first question. Truncates to 60 chars.
   */
  async generate(firstQuestion: string): Promise<string> {
    const model = new BedrockModel({ modelId: this.titleModelId });
    const agent = new Agent({
      model,
      systemPrompt: TITLE_PROMPT,
      tools: [],
      printer: false,
    });

    const result = await agent.invoke(firstQuestion);
    const raw = result.toString();

    return processTitle(raw);
  }
}
