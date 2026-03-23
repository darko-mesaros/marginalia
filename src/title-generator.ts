import { Agent, BedrockModel } from "@strands-agents/sdk";

const TITLE_PROMPT = `Generate a short title (3-7 words) for the user's question. Output ONLY the title, no explanation. Examples:
"How does Rust ownership work?" → Rust Ownership Explained
"Tell me about black holes" → Black Holes Overview
"How to deploy Lambda with CDK" → Lambda Deployment with CDK`;

/**
 * Process raw model output into a valid title.
 * Strips markdown formatting, trims whitespace, truncates to 60 chars,
 * falls back to "Untitled Conversation" if empty.
 */
export function processTitle(raw: string): string {
  // Strip markdown formatting before trimming
  let title = raw;
  title = title.replace(/<think>[\s\S]*?<\/think>/gi, ""); // thinking tags
  title = title.replace(/^#{1,6}\s+/gm, "");           // heading markers
  title = title.replace(/!\[(.+?)\]\(.+?\)/g, "$1");    // images (before links)
  title = title.replace(/\[(.+?)\]\(.+?\)/g, "$1");     // links
  title = title.replace(/\*\*(.+?)\*\*/g, "$1");        // bold
  title = title.replace(/\*(.+?)\*/g, "$1");             // italic (asterisk)
  title = title.replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1");  // italic (underscore)
  title = title.replace(/~~(.+?)~~/g, "$1");             // strikethrough
  title = title.replace(/`(.+?)`/g, "$1");               // inline code
  title = title.replace(/^>\s?/gm, "");                  // blockquote markers
  title = title.replace(/^[-*+]\s+/gm, "");              // unordered list markers
  title = title.replace(/^\d+\.\s+/gm, "");              // ordered list markers
  title = title.replace(/^["']+|["']+$/g, "");           // surrounding quotes
  title = title.replace(/\s{2,}/g, " ");                 // collapse multiple spaces

  // Take only the first line — ignore anything after a newline
  title = title.split("\n")[0].trim();
  if (title.length === 0) {
    title = "Untitled Conversation";
  }
  if (title.length > 60) {
    // Truncate at the last word boundary before 60 chars
    const truncated = title.substring(0, 60);
    const lastSpace = truncated.lastIndexOf(" ");
    title = lastSpace > 10 ? truncated.substring(0, lastSpace) : truncated;
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
