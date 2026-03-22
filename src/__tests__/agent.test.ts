import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppConfig } from "../models.js";
import type { StreamEvent } from "../agent.js";

// We test MarginaliaAgent's public interface by mocking the Strands SDK
// internals. The agent is a thin wrapper — the key contract is that
// streamResponse() translates SDK events into our StreamEvent types.

// Mock the Strands SDK modules
vi.mock("@strands-agents/sdk", () => {
  const MockBedrockModel = vi.fn().mockImplementation(() => ({}));

  const MockAgent = vi.fn().mockImplementation(() => ({
    stream: vi.fn(),
  }));

  const MockMcpClient = vi.fn().mockImplementation(() => ({
    disconnect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([]),
  }));

  return {
    Agent: MockAgent,
    BedrockModel: MockBedrockModel,
    McpClient: MockMcpClient,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

const defaultConfig: AppConfig = {
  bedrockModelId: "us.anthropic.claude-sonnet-4-20250514",
  systemPrompt: "You are a helpful assistant.",
  skillFiles: [],
  mcpServers: [],
};

describe("MarginaliaAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should construct without errors", async () => {
    const { MarginaliaAgent } = await import("../agent.js");
    const agent = new MarginaliaAgent(defaultConfig);
    expect(agent).toBeDefined();
  });

  it("should yield token events for text deltas", async () => {
    const { Agent } = await import("@strands-agents/sdk");
    const { MarginaliaAgent } = await import("../agent.js");

    // Create a fake async generator that yields text delta events
    const fakeStream = async function* () {
      yield {
        type: "modelStreamUpdateEvent" as const,
        agent: {} as any,
        event: {
          type: "modelContentBlockDeltaEvent" as const,
          delta: { type: "textDelta" as const, text: "Hello" },
        },
      };
      yield {
        type: "modelStreamUpdateEvent" as const,
        agent: {} as any,
        event: {
          type: "modelContentBlockDeltaEvent" as const,
          delta: { type: "textDelta" as const, text: " world" },
        },
      };
      return { type: "agentResult" as const, stopReason: "endTurn", lastMessage: {} } as any;
    };

    // Override the mock's stream method
    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: vi.fn().mockReturnValue(fakeStream()),
        }) as any
    );

    const agent = new MarginaliaAgent(defaultConfig);
    const events: StreamEvent[] = [];
    for await (const event of agent.streamResponse([
      { role: "user", content: "Hi" },
    ])) {
      events.push(event);
    }

    const tokens = events.filter((e) => e.type === "token");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ type: "token", content: "Hello" });
    expect(tokens[1]).toEqual({ type: "token", content: " world" });

    // Should end with a done event
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.type).toBe("done");
  });

  it("should yield tool_use events for tool invocations", async () => {
    const { Agent } = await import("@strands-agents/sdk");
    const { MarginaliaAgent } = await import("../agent.js");

    const fakeStream = async function* () {
      // Tool use start
      yield {
        type: "modelStreamUpdateEvent" as const,
        agent: {} as any,
        event: {
          type: "modelContentBlockStartEvent" as const,
          start: {
            type: "toolUseStart" as const,
            name: "calculator",
            toolUseId: "tool-1",
          },
        },
      };
      // Completed tool use block with input
      yield {
        type: "contentBlockEvent" as const,
        agent: {} as any,
        contentBlock: {
          type: "toolUseBlock" as const,
          name: "calculator",
          toolUseId: "tool-1",
          input: { expression: "2+2" },
        },
      };
      // Tool result
      yield {
        type: "toolResultEvent" as const,
        agent: {} as any,
        result: {
          type: "toolResultBlock" as const,
          toolUseId: "tool-1",
          status: "success",
          content: [{ type: "textBlock" as const, text: "4" }],
        },
      };
      return { type: "agentResult" as const, stopReason: "endTurn", lastMessage: {} } as any;
    };

    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: vi.fn().mockReturnValue(fakeStream()),
        }) as any
    );

    const agent = new MarginaliaAgent(defaultConfig);
    const events: StreamEvent[] = [];
    for await (const event of agent.streamResponse([
      { role: "user", content: "What is 2+2?" },
    ])) {
      events.push(event);
    }

    const toolEvents = events.filter((e) => e.type === "tool_use");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toEqual({
      type: "tool_use",
      toolName: "calculator",
      input: { expression: "2+2" },
      result: "4",
    });
  });

  it("should yield error event when agent throws", async () => {
    const { Agent } = await import("@strands-agents/sdk");
    const { MarginaliaAgent } = await import("../agent.js");

    const fakeStream = async function* (): AsyncGenerator<any, any, undefined> {
      throw new Error("Bedrock unavailable");
    };

    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: vi.fn().mockReturnValue(fakeStream()),
        }) as any
    );

    const agent = new MarginaliaAgent(defaultConfig);
    const events: StreamEvent[] = [];
    for await (const event of agent.streamResponse([
      { role: "user", content: "Hi" },
    ])) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "error",
      message: "Bedrock unavailable",
    });
  });

  it("should yield error event when no messages provided", async () => {
    const { MarginaliaAgent } = await import("../agent.js");

    const agent = new MarginaliaAgent(defaultConfig);
    const events: StreamEvent[] = [];
    for await (const event of agent.streamResponse([])) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "error",
      message: "No messages provided",
    });
  });

  it("should pass full assembled context as message array to Strands", async () => {
    const { Agent } = await import("@strands-agents/sdk");
    const { MarginaliaAgent } = await import("../agent.js");

    const streamMock = vi.fn().mockReturnValue(
      (async function* () {
        yield {
          type: "modelStreamUpdateEvent" as const,
          agent: {} as any,
          event: {
            type: "modelContentBlockDeltaEvent" as const,
            delta: { type: "textDelta" as const, text: "Done" },
          },
        };
        return { type: "agentResult" as const, stopReason: "endTurn", lastMessage: {} } as any;
      })()
    );

    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: streamMock,
        }) as any
    );

    const agent = new MarginaliaAgent(defaultConfig);
    const inputMessages = [
      { role: "system" as const, content: "System from assembler" },
      { role: "user" as const, content: "Original question" },
      { role: "assistant" as const, content: "Original answer" },
      { role: "user" as const, content: "Margin note summary" },
      { role: "assistant" as const, content: "I will keep that in mind." },
      { role: "user" as const, content: "New follow-up" },
    ];

    const events: StreamEvent[] = [];
    for await (const event of agent.streamResponse(inputMessages)) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "done")).toBe(true);

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(streamMock).toHaveBeenCalledWith([
      { role: "user", content: [{ text: "Original question" }] },
      { role: "assistant", content: [{ text: "Original answer" }] },
      { role: "user", content: [{ text: "Margin note summary" }] },
      { role: "assistant", content: [{ text: "I will keep that in mind." }] },
      { role: "user", content: [{ text: "New follow-up" }] },
    ]);

    const lastAgentCall = vi.mocked(Agent).mock.calls.at(-1)?.[0] as {
      systemPrompt: string;
    };
    expect(lastAgentCall.systemPrompt).toBe("System from assembler");
  });

  it("should return an error when only system messages are provided", async () => {
    const { MarginaliaAgent } = await import("../agent.js");

    const agent = new MarginaliaAgent(defaultConfig);
    const events: StreamEvent[] = [];

    for await (const event of agent.streamResponse([
      { role: "system", content: "System only" },
    ])) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "error", message: "No conversational messages provided" },
    ]);
  });

  it("should configure MCP servers and rebuild agent", async () => {
    const { Agent, McpClient } = await import("@strands-agents/sdk");
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const { MarginaliaAgent } = await import("../agent.js");

    const agent = new MarginaliaAgent(defaultConfig);

    await agent.configureMcp([
      {
        id: "1",
        name: "test-server",
        command: "node",
        args: ["server.js"],
        env: {},
        enabled: true,
      },
      {
        id: "2",
        name: "disabled-server",
        command: "node",
        args: ["other.js"],
        env: {},
        enabled: false,
      },
    ]);

    // StdioClientTransport should be created only for enabled servers
    expect(StdioClientTransport).toHaveBeenCalledTimes(1);
    expect(StdioClientTransport).toHaveBeenCalledWith({
      command: "node",
      args: ["server.js"],
      env: undefined,
    });

    // McpClient should be created for enabled servers
    expect(McpClient).toHaveBeenCalledTimes(1);

    // Agent should be rebuilt (initial + after configureMcp)
    expect(Agent).toHaveBeenCalledTimes(2);
  });

  it("should update system prompt and rebuild agent", async () => {
    const { Agent } = await import("@strands-agents/sdk");
    const { MarginaliaAgent } = await import("../agent.js");

    const agent = new MarginaliaAgent(defaultConfig);
    const initialCallCount = vi.mocked(Agent).mock.calls.length;

    agent.updateSystemPrompt("New system prompt");

    // Agent should be rebuilt
    expect(vi.mocked(Agent).mock.calls.length).toBe(initialCallCount + 1);

    // The new agent should use the updated system prompt
    const lastCall = vi.mocked(Agent).mock.calls.at(-1)![0] as any;
    expect(lastCall.systemPrompt).toBe("New system prompt");
  });

  it("should pass env to StdioClientTransport when non-empty", async () => {
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const { MarginaliaAgent } = await import("../agent.js");

    const agent = new MarginaliaAgent(defaultConfig);

    await agent.configureMcp([
      {
        id: "1",
        name: "env-server",
        command: "node",
        args: [],
        env: { API_KEY: "secret" },
        enabled: true,
      },
    ]);

    expect(StdioClientTransport).toHaveBeenCalledWith({
      command: "node",
      args: [],
      env: { API_KEY: "secret" },
    });
  });
});
