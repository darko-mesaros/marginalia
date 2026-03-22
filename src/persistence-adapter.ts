import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Conversation, ConversationSummary } from "./models.js";

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceError";
  }
}

export interface PersistenceAdapter {
  save(conversation: Conversation): Promise<void>;
  load(id: string): Promise<Conversation>;
  delete(id: string): Promise<void>;
  listSummaries(): Promise<ConversationSummary[]>;
  exists(id: string): Promise<boolean>;
}

// Plain object shape used for JSON serialisation (Dates as ISO strings)
interface SerialisedMessage {
  id: string;
  role: string;
  content: string;
  toolInvocations: unknown[];
  timestamp: string;
}

interface SerialisedSideThread {
  id: string;
  anchor: unknown;
  messages: SerialisedMessage[];
  collapsed: boolean;
}

interface SerialisedConversation {
  id: string;
  title: string;
  mainThread: SerialisedMessage[];
  sideThreads: SerialisedSideThread[];
  createdAt: string;
  updatedAt: string;
}

export class JsonFilePersistenceAdapter implements PersistenceAdapter {
  private dirEnsured: boolean = false;

  constructor(private readonly dataDir: string = "./data/conversations") {}

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    this.dirEnsured = true;
  }

  private filePath(id: string): string {
    return path.join(this.dataDir, `${id}.json`);
  }

  async save(conversation: Conversation): Promise<void> {
    await this.ensureDir();
    const serialised: SerialisedConversation = {
      id: conversation.id,
      title: conversation.title,
      mainThread: conversation.mainThread.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolInvocations: m.toolInvocations,
        timestamp: m.timestamp.toISOString(),
      })),
      sideThreads: conversation.sideThreads.map((st) => ({
        id: st.id,
        anchor: st.anchor,
        messages: st.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolInvocations: m.toolInvocations,
          timestamp: m.timestamp.toISOString(),
        })),
        collapsed: st.collapsed,
      })),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
    await fs.writeFile(this.filePath(conversation.id), JSON.stringify(serialised, null, 2), "utf-8");
  }

  async load(id: string): Promise<Conversation> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(id), "utf-8");
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        throw new PersistenceError(`Conversation not found: ${id}`);
      }
      throw new PersistenceError(`Failed to read conversation ${id}: ${e.message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new PersistenceError(`Invalid JSON for conversation ${id}`);
    }

    return this.deserialise(parsed, id);
  }

  private deserialise(parsed: unknown, id: string): Conversation {
    if (typeof parsed !== "object" || parsed === null) {
      throw new PersistenceError(`Invalid conversation data for ${id}: not an object`);
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj["id"] !== "string") {
      throw new PersistenceError(`Invalid conversation data for ${id}: missing or invalid 'id' field`);
    }
    if (!Array.isArray(obj["mainThread"])) {
      throw new PersistenceError(`Invalid conversation data for ${id}: missing or invalid 'mainThread' field`);
    }
    if (!Array.isArray(obj["sideThreads"])) {
      throw new PersistenceError(`Invalid conversation data for ${id}: missing or invalid 'sideThreads' field`);
    }
    if (typeof obj["createdAt"] !== "string" || isNaN(Date.parse(obj["createdAt"]))) {
      throw new PersistenceError(`Invalid conversation data for ${id}: missing or invalid 'createdAt' field`);
    }

    const mainThread = (obj["mainThread"] as unknown[]).map((m, i) =>
      this.deserialiseMessage(m, `mainThread[${i}]`, id)
    );

    const sideThreads = (obj["sideThreads"] as unknown[]).map((st, i) => {
      if (typeof st !== "object" || st === null) {
        throw new PersistenceError(`Invalid sideThread[${i}] in conversation ${id}`);
      }
      const stObj = st as Record<string, unknown>;
      const messages = Array.isArray(stObj["messages"])
        ? (stObj["messages"] as unknown[]).map((m, j) =>
            this.deserialiseMessage(m, `sideThreads[${i}].messages[${j}]`, id)
          )
        : [];
      return {
        id: String(stObj["id"] ?? ""),
        anchor: stObj["anchor"] as Conversation["sideThreads"][number]["anchor"],
        messages,
        collapsed: Boolean(stObj["collapsed"]),
      };
    });

    const updatedAtStr = typeof obj["updatedAt"] === "string" ? obj["updatedAt"] : obj["createdAt"] as string;

    return {
      id: obj["id"] as string,
      title: typeof obj["title"] === "string" ? obj["title"] : "Untitled Conversation",
      mainThread,
      sideThreads,
      createdAt: new Date(obj["createdAt"] as string),
      updatedAt: new Date(updatedAtStr as string),
    };
  }

  private deserialiseMessage(raw: unknown, path: string, convId: string): Conversation["mainThread"][number] {
    if (typeof raw !== "object" || raw === null) {
      throw new PersistenceError(`Invalid message at ${path} in conversation ${convId}`);
    }
    const m = raw as Record<string, unknown>;
    return {
      id: String(m["id"] ?? ""),
      role: (m["role"] as "user" | "assistant") ?? "user",
      content: String(m["content"] ?? ""),
      toolInvocations: Array.isArray(m["toolInvocations"]) ? (m["toolInvocations"] as Conversation["mainThread"][number]["toolInvocations"]) : [],
      timestamp: new Date(typeof m["timestamp"] === "string" ? m["timestamp"] : Date.now()),
    };
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(id));
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        throw new PersistenceError(`Failed to delete conversation ${id}: ${e.message}`);
      }
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(this.filePath(id));
      return true;
    } catch {
      return false;
    }
  }

  async listSummaries(): Promise<ConversationSummary[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.dataDir);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      throw new PersistenceError(`Failed to list conversations: ${e.message}`);
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const summaries: ConversationSummary[] = [];

    for (const file of jsonFiles) {
      const id = file.slice(0, -5); // strip .json
      try {
        const conversation = await this.load(id);
        const messageCount =
          conversation.mainThread.length +
          conversation.sideThreads.reduce((sum, st) => sum + st.messages.length, 0);
        summaries.push({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
          messageCount,
        });
      } catch {
        // skip malformed files
      }
    }

    return summaries;
  }
}
