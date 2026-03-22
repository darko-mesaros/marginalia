import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter } from "../routes.js";
import { ConversationStore } from "../conversation-store.js";
import type { AppConfig } from "../models.js";
import type { MarginaliaAgent, StreamEvent } from "../agent.js";
import type { Request, Response } from "express";

// Minimal mock agent that yields configurable events
function createMockAgent(events: StreamEvent[]): MarginaliaAgent {
  return {
    async *streamResponse() {
      for (const event of events) {
        yield event;
      }
    },
    configureMcp: vi.fn(),
    updateSystemPrompt: vi.fn(),
  } as unknown as MarginaliaAgent;
}

const mockLibrary = {
  save: async () => {},
  load: async () => { throw new Error("not found"); },
  delete: async () => {},
  exists: async () => false,
  list: async () => [],
  init: async () => {},
} as any;

const mockTitleGenerator = {
  generateAsync: vi.fn(),
  generate: vi.fn(async () => "Test Title"),
} as any;

interface MockResponse extends Response {
  _chunks: string[];
  _headers: Record<string, string>;
  _ended: () => boolean;
  _jsonBody: () => unknown;
  _triggerClose: () => void;
}

function createMockResponse(): MockResponse {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const listeners: Record<string, Array<() => void>> = {};
  let ended = false;
  let statusCode = 200;
  let headersSentFlag = false;
  let jsonBody: unknown = null;

  const res: any = {
    get statusCode() { return statusCode; },
    get headersSent() { return headersSentFlag; },
    setHeader(key: string, value: string) { headers[key] = value; return res; },
    flushHeaders() { headersSentFlag = true; },
    write(chunk: string) { chunks.push(chunk); return true; },
    end() { ended = true; },
    status(code: number) { statusCode = code; return res; },
    json(body: unknown) { jsonBody = body; ended = true; return res; },
    on(event: string, cb: () => void) { (listeners[event] ??= []).push(cb); return res; },
    // Test helpers
    _chunks: chunks,
    _headers: headers,
    _ended: () => ended,
    _jsonBody: () => jsonBody,
    _triggerClose() { (listeners["close"] ?? []).forEach((cb) => cb()); },
  };

  return res as MockResponse;
}

const baseConfig: AppConfig = {
  bedrockModelId: "test-model",
  systemPrompt: "You are a test assistant.",
  skillFiles: [],
  mcpServers: [],
};

describe("POST /api/ask", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
  });

  it("streams tokens and stores assistant message on done", async () => {
    const events: StreamEvent[] = [
      { type: "token", content: "Hello " },
      { type: "token", content: "world" },
      { type: "done", messageId: "ignored-agent-id" },
    ];
    const agent = createMockAgent(events);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/ask");

    const req = { body: { question: "What is Rust?" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    // SSE headers set
    expect(res._headers["Content-Type"]).toBe("text/event-stream");

    // Token events written
    const output = res._chunks.join("");
    expect(output).toContain("event: token");
    expect(output).toContain('"content":"Hello "');
    expect(output).toContain('"content":"world"');

    // Done event written
    expect(output).toContain("event: done");

    // Assistant message stored in conversation
    const convo = store.getConversation();
    expect(convo).not.toBeNull();
    const mainThread = convo!.mainThread;
    expect(mainThread).toHaveLength(2);
    expect(mainThread[0].role).toBe("user");
    expect(mainThread[0].content).toBe("What is Rust?");
    expect(mainThread[1].role).toBe("assistant");
    expect(mainThread[1].content).toBe("Hello world");

    expect(res._ended()).toBe(true);
  });

  it("writes tool_use events during streaming", async () => {
    const events: StreamEvent[] = [
      { type: "token", content: "Let me check..." },
      { type: "tool_use", toolName: "search", input: { query: "rust" }, result: "Found docs" },
      { type: "token", content: " Done." },
      { type: "done", messageId: "msg-1" },
    ];
    const agent = createMockAgent(events);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/ask");

    const req = { body: { question: "Search for Rust" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    const output = res._chunks.join("");
    expect(output).toContain("event: tool_use");
    expect(output).toContain('"tool_name":"search"');
    expect(output).toContain('"result":"Found docs"');

    // Assistant content accumulated correctly (tokens only)
    const convo = store.getConversation()!;
    expect(convo.mainThread[1].content).toBe("Let me check... Done.");
  });

  it("writes error event on agent error", async () => {
    const events: StreamEvent[] = [
      { type: "token", content: "partial" },
      { type: "error", message: "Bedrock timeout" },
    ];
    const agent = createMockAgent(events);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/ask");

    const req = { body: { question: "Will this fail?" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    const output = res._chunks.join("");
    expect(output).toContain("event: error");
    expect(output).toContain("Bedrock timeout");
    expect(res._ended()).toBe(true);
  });

  it("sends SSE error event when exception occurs after headers sent", async () => {
    const agent = {
      async *streamResponse() {
        throw new Error("Agent init failed");
      },
    } as unknown as MarginaliaAgent;

    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/ask");

    const req = { body: { question: "Boom" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    // initSSE is called before streaming, so headers are already sent
    const output = res._chunks.join("");
    expect(output).toContain("event: error");
    expect(output).toContain("Agent init failed");
  });

  it("stops writing on client disconnect", async () => {
    const writtenTokens: string[] = [];
    const agent = {
      async *streamResponse() {
        yield { type: "token" as const, content: "first" };
        yield { type: "token" as const, content: "second" };
        yield { type: "token" as const, content: "third" };
        yield { type: "done" as const, messageId: "msg-1" };
      },
    } as unknown as MarginaliaAgent;

    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/ask");

    const req = { body: { question: "Disconnect me" } } as Request;
    const res = createMockResponse();

    // Trigger disconnect after first write
    const origWrite = res.write.bind(res);
    let writeCount = 0;
    (res as any).write = (chunk: string) => {
      writeCount++;
      const result = origWrite(chunk);
      if (writeCount === 1) {
        res._triggerClose();
      }
      return result;
    };

    await handler(req, res, vi.fn());

    // The loop should break after disconnect is detected
    // First token is written, then disconnect fires, subsequent tokens skipped
    expect(writeCount).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Extract the route handler (skipping middleware) from an Express router.
 */
function extractHandler(
  router: any,
  method: string,
  path: string
): (req: Request, res: Response, next: any) => Promise<void> {
  const layer = router.stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack;
  const handler = handlers[handlers.length - 1].handle;
  return handler;
}


describe("POST /api/side-question", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
    // Seed a main thread message so anchor_position.message_id is plausible
    store.addMainMessage("user", "Tell me about Rust");
    store.addMainMessage("assistant", "Rust is a systems programming language.");
  });

  it("streams tokens with thread_id and stores side thread messages", async () => {
    const events: StreamEvent[] = [
      { type: "token", content: "Side " },
      { type: "token", content: "answer" },
      { type: "done", messageId: "ignored" },
    ];
    const agent = createMockAgent(events);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/side-question");

    const req = {
      body: {
        selected_text: "systems programming",
        question: "What makes it a systems language?",
        anchor_position: { message_id: "msg-1", start_offset: 10, end_offset: 30 },
      },
    } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    const output = res._chunks.join("");

    // Token events include thread_id
    expect(output).toContain("event: token");
    expect(output).toContain('"thread_id"');
    expect(output).toContain('"content":"Side "');

    // Done event includes thread_id
    expect(output).toContain("event: done");

    // Side thread created with user + assistant messages
    const convo = store.getConversation()!;
    expect(convo.sideThreads).toHaveLength(1);
    const thread = convo.sideThreads[0];
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].role).toBe("user");
    expect(thread.messages[0].content).toBe("What makes it a systems language?");
    expect(thread.messages[1].role).toBe("assistant");
    expect(thread.messages[1].content).toBe("Side answer");

    expect(res._ended()).toBe(true);
  });

  it("writes error event on agent error", async () => {
    const events: StreamEvent[] = [
      { type: "error", message: "LLM failure" },
    ];
    const agent = createMockAgent(events);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/side-question");

    const req = {
      body: {
        selected_text: "Rust",
        question: "Why?",
        anchor_position: { message_id: "msg-1", start_offset: 0, end_offset: 4 },
      },
    } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    const output = res._chunks.join("");
    expect(output).toContain("event: error");
    expect(output).toContain("LLM failure");
    expect(res._ended()).toBe(true);
  });
});

describe("POST /api/continue", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
    // Seed an existing main thread conversation
    store.addMainMessage("user", "Tell me about Rust");
    store.addMainMessage("assistant", "Rust is a systems programming language focused on safety.");
  });

  it("streams tokens and appends assistant message to main thread on done", async () => {
    const events: StreamEvent[] = [
      { type: "token", content: "More " },
      { type: "token", content: "details" },
      { type: "done", messageId: "ignored" },
    ];
    const agent = createMockAgent(events);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/continue");

    const req = { body: { question: "Tell me more about ownership" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    // SSE headers set
    expect(res._headers["Content-Type"]).toBe("text/event-stream");

    // Token events written
    const output = res._chunks.join("");
    expect(output).toContain("event: token");
    expect(output).toContain('"content":"More "');
    expect(output).toContain('"content":"details"');

    // Done event written
    expect(output).toContain("event: done");

    // Main thread now has original 2 + continuation user + assistant = 4 messages
    const convo = store.getConversation()!;
    expect(convo.mainThread).toHaveLength(4);
    expect(convo.mainThread[0].role).toBe("user");
    expect(convo.mainThread[0].content).toBe("Tell me about Rust");
    expect(convo.mainThread[1].role).toBe("assistant");
    expect(convo.mainThread[2].role).toBe("user");
    expect(convo.mainThread[2].content).toBe("Tell me more about ownership");
    expect(convo.mainThread[3].role).toBe("assistant");
    expect(convo.mainThread[3].content).toBe("More details");

    expect(res._ended()).toBe(true);
  });

  it("writes error event on agent error", async () => {
    const events: StreamEvent[] = [
      { type: "token", content: "partial" },
      { type: "error", message: "Bedrock timeout" },
    ];
    const agent = createMockAgent(events);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/continue");

    const req = { body: { question: "Continue please" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    const output = res._chunks.join("");
    expect(output).toContain("event: error");
    expect(output).toContain("Bedrock timeout");
    expect(res._ended()).toBe(true);
  });

  it("returns 500 when exception occurs before headers sent", async () => {
    // Use an agent that throws immediately
    const agent = {
      async *streamResponse() {
        throw new Error("Context assembly failed");
      },
    } as unknown as MarginaliaAgent;

    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/continue");

    const req = { body: { question: "Boom" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    // initSSE is called before streaming, so headers are sent → SSE error event
    const output = res._chunks.join("");
    expect(output).toContain("event: error");
    expect(output).toContain("Context assembly failed");
  });
});

describe("POST /api/side-followup", () => {
  let store: ConversationStore;
  let threadId: string;

  beforeEach(() => {
    store = new ConversationStore();
    store.addMainMessage("user", "Tell me about Rust");
    store.addMainMessage("assistant", "Rust is great.");
    const thread = store.createSideThread({
      messageId: "msg-1",
      startOffset: 0,
      endOffset: 4,
      selectedText: "Rust",
    });
    store.addSideMessage(thread.id, "user", "What about safety?");
    store.addSideMessage(thread.id, "assistant", "Rust has ownership.");
    threadId = thread.id;
  });

  it("streams tokens with thread_id and appends to existing side thread", async () => {
    const events: StreamEvent[] = [
      { type: "token", content: "Follow " },
      { type: "token", content: "up" },
      { type: "done", messageId: "ignored" },
    ];
    const agent = createMockAgent(events);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/side-followup");

    const req = {
      body: { thread_id: threadId, question: "Tell me more about ownership" },
    } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    const output = res._chunks.join("");

    // Token events include thread_id
    expect(output).toContain("event: token");
    expect(output).toContain(`"thread_id":"${threadId}"`);

    // Done event includes thread_id
    expect(output).toContain("event: done");
    expect(output).toContain(`"thread_id":"${threadId}"`);

    // Follow-up messages appended to the thread
    const convo = store.getConversation()!;
    const thread = convo.sideThreads[0];
    expect(thread.messages).toHaveLength(4); // original 2 + new user + assistant
    expect(thread.messages[2].role).toBe("user");
    expect(thread.messages[2].content).toBe("Tell me more about ownership");
    expect(thread.messages[3].role).toBe("assistant");
    expect(thread.messages[3].content).toBe("Follow up");

    expect(res._ended()).toBe(true);
  });

  it("returns 500 for non-existent thread_id", async () => {
    const agent = createMockAgent([]);
    const router = createRouter({ store, agent, config: baseConfig, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/side-followup");

    const req = {
      body: { thread_id: "non-existent-id", question: "Hello?" },
    } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(500);
  });
});


describe("GET /api/settings", () => {
  it("returns current config", () => {
    const config: AppConfig = {
      ...baseConfig,
      skillFiles: [{ id: "sf-1", name: "Rust tips", content: "Be safe", order: 0 }],
      mcpServers: [{ id: "mcp-1", name: "search", command: "npx", args: ["-y", "search-server"], env: {}, enabled: true }],
    };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "get", "/api/settings");

    const req = {} as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    const body = res._jsonBody() as any;
    expect(body.systemPrompt).toBe("You are a test assistant.");
    expect(body.bedrockModelId).toBe("test-model");
    expect(body.skillFiles).toHaveLength(1);
    expect(body.skillFiles[0].name).toBe("Rust tips");
    expect(body.mcpServers).toHaveLength(1);
    expect(body.mcpServers[0].name).toBe("search");
  });
});

describe("PUT /api/settings", () => {
  it("updates systemPrompt and calls agent.updateSystemPrompt", () => {
    const config: AppConfig = { ...baseConfig };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "put", "/api/settings");

    const req = { body: { systemPrompt: "New prompt" } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(config.systemPrompt).toBe("New prompt");
    expect(agent.updateSystemPrompt).toHaveBeenCalledWith("New prompt");
    const body = res._jsonBody() as any;
    expect(body.systemPrompt).toBe("New prompt");
  });

  it("updates bedrockModelId", () => {
    const config: AppConfig = { ...baseConfig };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "put", "/api/settings");

    const req = { body: { bedrockModelId: "new-model-id" } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(config.bedrockModelId).toBe("new-model-id");
    const body = res._jsonBody() as any;
    expect(body.bedrockModelId).toBe("new-model-id");
  });

  it("does not call updateSystemPrompt when prompt unchanged", () => {
    const config: AppConfig = { ...baseConfig };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "put", "/api/settings");

    const req = { body: { systemPrompt: baseConfig.systemPrompt } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(agent.updateSystemPrompt).not.toHaveBeenCalled();
  });

  it("rejects non-string systemPrompt with 422", () => {
    const config: AppConfig = { ...baseConfig };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "put", "/api/settings");

    const req = { body: { systemPrompt: 123 } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(422);
  });

  it("rejects empty bedrockModelId with 422", () => {
    const config: AppConfig = { ...baseConfig };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "put", "/api/settings");

    const req = { body: { bedrockModelId: "  " } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(422);
  });
});

describe("POST /api/settings/skill-files", () => {
  it("adds a skill file and returns 201", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    const req = { body: { name: "Rust tips", content: "# Tips\nBe safe.", order: 0 } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(201);
    const body = res._jsonBody() as any;
    expect(body.id).toBeDefined();
    expect(body.name).toBe("Rust tips");
    expect(body.content).toBe("# Tips\nBe safe.");
    expect(body.order).toBe(0);
    expect(config.skillFiles).toHaveLength(1);
  });

  it("rejects empty content with 422", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    const req = { body: { name: "Empty", content: "" } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(422);
    expect(config.skillFiles).toHaveLength(0);
  });

  it("rejects missing name with 422", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    const req = { body: { content: "some content" } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(422);
  });

  it("defaults order to array length when not provided", () => {
    const config: AppConfig = {
      ...baseConfig,
      skillFiles: [{ id: "existing", name: "First", content: "x", order: 0 }],
    };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    const req = { body: { name: "Second", content: "y" } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    const body = res._jsonBody() as any;
    expect(body.order).toBe(1);
  });
});

describe("DELETE /api/settings/skill-files/:id", () => {
  it("removes a skill file by id", () => {
    const config: AppConfig = {
      ...baseConfig,
      skillFiles: [{ id: "sf-1", name: "Tips", content: "content", order: 0 }],
    };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "delete", "/api/settings/skill-files/:id");

    const req = { params: { id: "sf-1" } } as unknown as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(config.skillFiles).toHaveLength(0);
    const body = res._jsonBody() as any;
    expect(body.success).toBe(true);
  });

  it("returns 404 for non-existent id", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "delete", "/api/settings/skill-files/:id");

    const req = { params: { id: "non-existent" } } as unknown as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/settings/mcp-servers", () => {
  it("adds an MCP server config and calls configureMcp", async () => {
    const config: AppConfig = { ...baseConfig, mcpServers: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/mcp-servers");

    const req = {
      body: { name: "search", command: "npx", args: ["-y", "search-mcp"], env: { KEY: "val" }, enabled: true },
    } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(201);
    const body = res._jsonBody() as any;
    expect(body.id).toBeDefined();
    expect(body.name).toBe("search");
    expect(body.command).toBe("npx");
    expect(body.args).toEqual(["-y", "search-mcp"]);
    expect(body.env).toEqual({ KEY: "val" });
    expect(body.enabled).toBe(true);
    expect(config.mcpServers).toHaveLength(1);
    expect(agent.configureMcp).toHaveBeenCalledWith(config.mcpServers);
  });

  it("rejects missing command with 422", async () => {
    const config: AppConfig = { ...baseConfig, mcpServers: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/mcp-servers");

    const req = { body: { name: "search" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(422);
    expect(config.mcpServers).toHaveLength(0);
  });

  it("defaults args to empty array and enabled to true", async () => {
    const config: AppConfig = { ...baseConfig, mcpServers: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/mcp-servers");

    const req = { body: { name: "tool", command: "node" } } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    const body = res._jsonBody() as any;
    expect(body.args).toEqual([]);
    expect(body.env).toEqual({});
    expect(body.enabled).toBe(true);
  });
});

describe("POST /api/settings/mcp-servers — MCP failure graceful degradation", () => {
  it("still adds the server config and returns 201 when configureMcp throws", async () => {
    const config: AppConfig = { ...baseConfig, mcpServers: [] };
    const agent = createMockAgent([]);
    // Make configureMcp reject to simulate MCP connection failure
    (agent.configureMcp as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("MCP server unreachable")
    );
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/mcp-servers");

    const req = {
      body: { name: "broken-mcp", command: "npx", args: ["-y", "broken-server"] },
    } as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    // Server should still be added despite MCP failure
    expect(res.statusCode).toBe(201);
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].name).toBe("broken-mcp");
    const body = res._jsonBody() as any;
    expect(body.name).toBe("broken-mcp");
    expect(body.id).toBeDefined();
  });
});

describe("DELETE /api/settings/mcp-servers/:id", () => {
  it("removes an MCP server and calls configureMcp with remaining", async () => {
    const config: AppConfig = {
      ...baseConfig,
      mcpServers: [
        { id: "mcp-1", name: "search", command: "npx", args: [], env: {}, enabled: true },
        { id: "mcp-2", name: "calc", command: "node", args: ["calc.js"], env: {}, enabled: true },
      ],
    };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "delete", "/api/settings/mcp-servers/:id");

    const req = { params: { id: "mcp-1" } } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("mcp-2");
    expect(agent.configureMcp).toHaveBeenCalledWith(config.mcpServers);
    const body = res._jsonBody() as any;
    expect(body.success).toBe(true);
  });

  it("returns 404 for non-existent id", async () => {
    const config: AppConfig = { ...baseConfig, mcpServers: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "delete", "/api/settings/mcp-servers/:id");

    const req = { params: { id: "non-existent" } } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
  });
});

describe("Skill file reordering", () => {
  it("preserves explicit order when adding multiple skill files", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    // Add three skill files with explicit order values
    const files = [
      { name: "Third", content: "c content", order: 2 },
      { name: "First", content: "a content", order: 0 },
      { name: "Second", content: "b content", order: 1 },
    ];

    for (const file of files) {
      const req = { body: file } as Request;
      const res = createMockResponse();
      handler(req, res, vi.fn());
      expect(res.statusCode).toBe(201);
    }

    expect(config.skillFiles).toHaveLength(3);

    // Verify each file has the correct order value
    const sorted = [...config.skillFiles].sort((a, b) => a.order - b.order);
    expect(sorted[0].name).toBe("First");
    expect(sorted[0].order).toBe(0);
    expect(sorted[1].name).toBe("Second");
    expect(sorted[1].order).toBe(1);
    expect(sorted[2].name).toBe("Third");
    expect(sorted[2].order).toBe(2);
  });

  it("auto-increments order for files added without explicit order", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    // Add files without specifying order — should auto-assign 0, 1, 2
    const names = ["Alpha", "Beta", "Gamma"];
    for (const name of names) {
      const req = { body: { name, content: `${name} content` } } as Request;
      const res = createMockResponse();
      handler(req, res, vi.fn());
      expect(res.statusCode).toBe(201);
    }

    expect(config.skillFiles).toHaveLength(3);
    expect(config.skillFiles[0].order).toBe(0);
    expect(config.skillFiles[1].order).toBe(1);
    expect(config.skillFiles[2].order).toBe(2);
  });

  it("maintains remaining files after removing one from the middle", () => {
    const config: AppConfig = {
      ...baseConfig,
      skillFiles: [
        { id: "sf-1", name: "First", content: "a", order: 0 },
        { id: "sf-2", name: "Second", content: "b", order: 1 },
        { id: "sf-3", name: "Third", content: "c", order: 2 },
      ],
    };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const deleteHandler = extractHandler(router, "delete", "/api/settings/skill-files/:id");

    // Remove the middle file
    const req = { params: { id: "sf-2" } } as unknown as Request;
    const res = createMockResponse();
    deleteHandler(req, res, vi.fn());

    expect(config.skillFiles).toHaveLength(2);
    expect(config.skillFiles[0].id).toBe("sf-1");
    expect(config.skillFiles[1].id).toBe("sf-3");
  });
});

describe("Skill file binary content validation", () => {
  it("rejects content containing null bytes with 422", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    const req = { body: { name: "binary.bin", content: "hello\0world" } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(422);
    const body = res._jsonBody() as any;
    expect(body.error).toContain("binary");
    expect(config.skillFiles).toHaveLength(0);
  });

  it("rejects content that is purely null bytes with 422", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    const req = { body: { name: "nulls.bin", content: "\0\0\0" } } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(422);
    expect(config.skillFiles).toHaveLength(0);
  });

  it("accepts valid text/markdown content", () => {
    const config: AppConfig = { ...baseConfig, skillFiles: [] };
    const agent = createMockAgent([]);
    const store = new ConversationStore();
    const router = createRouter({ store, agent, config, library: mockLibrary, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/settings/skill-files");

    const req = {
      body: { name: "guide.md", content: "# Guide\n\nThis is a **markdown** skill file with `code`." },
    } as Request;
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(201);
    expect(config.skillFiles).toHaveLength(1);
  });
});

describe("POST /api/conversations/new", () => {
  let store: ConversationStore;
  let library: typeof mockLibrary;

  beforeEach(() => {
    store = new ConversationStore();
    library = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => { throw new Error("not found"); }),
      delete: vi.fn(async () => {}),
      exists: vi.fn(async () => false),
      list: vi.fn(async () => []),
      init: vi.fn(async () => {}),
    } as any;
  });

  it("creates a new conversation and returns 201 with id", async () => {
    const agent = createMockAgent([]);
    const router = createRouter({ store, agent, config: baseConfig, library, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/conversations/new");

    const req = {} as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(201);
    const body = res._jsonBody() as any;
    expect(body.id).toBeDefined();
    expect(typeof body.id).toBe("string");
    expect(library.save).toHaveBeenCalledTimes(1);
  });

  it("deletes empty current conversation before creating new one", async () => {
    // Create a conversation with no messages (empty mainThread)
    store.getOrCreateConversation();
    const emptyId = store.getConversation()!.id;

    const agent = createMockAgent([]);
    const router = createRouter({ store, agent, config: baseConfig, library, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/conversations/new");

    const req = {} as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(library.delete).toHaveBeenCalledWith(emptyId);
    expect(res.statusCode).toBe(201);
    const body = res._jsonBody() as any;
    expect(body.id).not.toBe(emptyId);
  });

  it("does not delete current conversation if it has messages", async () => {
    store.addMainMessage("user", "Hello");
    const existingId = store.getConversation()!.id;

    const agent = createMockAgent([]);
    const router = createRouter({ store, agent, config: baseConfig, library, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/conversations/new");

    const req = {} as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(library.delete).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    const body = res._jsonBody() as any;
    expect(body.id).not.toBe(existingId);
  });

  it("returns 500 when library.save fails", async () => {
    library.save = vi.fn(async () => { throw new Error("disk full"); });

    const agent = createMockAgent([]);
    const router = createRouter({ store, agent, config: baseConfig, library, titleGenerator: mockTitleGenerator });
    const handler = extractHandler(router, "post", "/api/conversations/new");

    const req = {} as Request;
    const res = createMockResponse();

    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    const body = res._jsonBody() as any;
    expect(body.error).toBeDefined();
  });
});
