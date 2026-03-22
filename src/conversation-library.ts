import type { Conversation, ConversationSummary } from "./models.js";
import type { PersistenceAdapter } from "./persistence-adapter.js";
import { PersistenceError } from "./persistence-adapter.js";

export class LibraryError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "INTERNAL"
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

export class ConversationLibrary {
  constructor(private readonly adapter: PersistenceAdapter) {}

  async save(conversation: Conversation): Promise<void> {
    try {
      await this.adapter.save(conversation);
    } catch (err) {
      console.error("[ConversationLibrary] save failed:", err);
      throw new LibraryError(
        `Failed to save conversation ${conversation.id}`,
        "INTERNAL"
      );
    }
  }

  async load(id: string): Promise<Conversation> {
    try {
      return await this.adapter.load(id);
    } catch (err) {
      if (
        err instanceof PersistenceError &&
        err.message.toLowerCase().includes("not found")
      ) {
        throw new LibraryError(`Conversation not found: ${id}`, "NOT_FOUND");
      }
      console.error("[ConversationLibrary] load failed:", err);
      throw new LibraryError(
        `Failed to load conversation ${id}`,
        "INTERNAL"
      );
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.adapter.delete(id);
    } catch (err) {
      console.error("[ConversationLibrary] delete failed:", err);
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      return await this.adapter.exists(id);
    } catch {
      return false;
    }
  }

  async list(): Promise<ConversationSummary[]> {
    const summaries = await this.adapter.listSummaries();
    return summaries.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async init(): Promise<void> {
    await this.adapter.listSummaries();
  }
}
