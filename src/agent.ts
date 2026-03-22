import { Agent, BedrockModel, McpClient } from "@strands-agents/sdk";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import type { AppConfig, MCPServerConfig } from "./models.js";
import { getFullSystemPrompt } from "./models.js";

type InputMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// --- StreamEvent types for our SSE layer ---

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_use"; toolName: string; input: object; result: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

/**
 * Wraps the Strands Agent SDK to provide a streaming interface
 * tailored for Marginalia's SSE-based frontend.
 */
export class MarginaliaAgent {
  private agent: Agent;
  private config: AppConfig;
  private mcpClients: McpClient[] = [];

  constructor(config: AppConfig) {
    this.config = config;
    this.agent = this.buildAgent([]);
  }

  /**
   * Build (or rebuild) the internal Strands Agent with the given tools.
   */
  private buildAgent(tools: McpClient[]): Agent {
    return this.buildAgentWithSystemPrompt(tools, getFullSystemPrompt(this.config));
  }

  private buildAgentWithSystemPrompt(
    tools: McpClient[],
    systemPrompt: string
  ): Agent {
    const model = new BedrockModel({
      modelId: this.config.bedrockModelId,
    });

    return new Agent({
      model,
      systemPrompt,
      tools: [...tools],
      printer: false,
    });
  }

  private normalizeInvocationMessages(messages: InputMessage[]): {
    systemPrompt: string;
    messages: Array<{ role: "user" | "assistant"; content: Array<{ text: string }> }>;
  } {
    const systemParts: string[] = [];
    const conversationMessages: Array<{
      role: "user" | "assistant";
      content: Array<{ text: string }>;
    }> = [];

    for (const message of messages) {
      if (message.role === "system") {
        systemParts.push(message.content);
        continue;
      }

      conversationMessages.push({
        role: message.role,
        content: [{ text: message.content }],
      });
    }

    return {
      systemPrompt:
        systemParts.length > 0
          ? systemParts.join("\n\n")
          : getFullSystemPrompt(this.config),
      messages: conversationMessages,
    };
  }

  /**
   * Stream a response from the agent, yielding StreamEvent objects.
   *
   * Translates the Strands SDK's AgentStreamEvent into our simplified
   * StreamEvent types suitable for SSE delivery to the frontend.
   */
  async *streamResponse(
    messages: InputMessage[]
  ): AsyncGenerator<StreamEvent> {
    try {
      if (messages.length === 0) {
        yield { type: "error", message: "No messages provided" };
        return;
      }

      const invocation = this.normalizeInvocationMessages(messages);
      if (invocation.messages.length === 0) {
        yield { type: "error", message: "No conversational messages provided" };
        return;
      }

      const agent = this.buildAgentWithSystemPrompt(
        this.mcpClients,
        invocation.systemPrompt
      );
      const messageId = randomUUID();

      // Pending tool use state — we accumulate tool info across events
      // because tool name arrives in ContentBlockStart and result in ToolResult.
      const pendingTools = new Map<
        string,
        { name: string; input: object }
      >();

      const stream = agent.stream(invocation.messages);

      for await (const event of stream) {
        switch (event.type) {
          // Text deltas — the core streaming tokens
          case "modelStreamUpdateEvent": {
            const inner = event.event;
            if (
              inner.type === "modelContentBlockDeltaEvent" &&
              inner.delta.type === "textDelta"
            ) {
              yield { type: "token", content: inner.delta.text };
            }
            // Track tool use starts so we can pair them with results later
            if (
              inner.type === "modelContentBlockStartEvent" &&
              inner.start?.type === "toolUseStart"
            ) {
              pendingTools.set(inner.start.toolUseId, {
                name: inner.start.name,
                input: {},
              });
            }
            break;
          }

          // Completed content blocks — capture tool use input
          case "contentBlockEvent": {
            const block = event.contentBlock;
            if (block.type === "toolUseBlock") {
              pendingTools.set(block.toolUseId, {
                name: block.name,
                input: (block.input as object) ?? {},
              });
            }
            break;
          }

          // Tool execution results
          case "toolResultEvent": {
            const result = event.result;
            const pending = pendingTools.get(result.toolUseId);
            const toolName = pending?.name ?? "unknown";
            const input = pending?.input ?? {};

            // Extract text content from the tool result
            const resultText = result.content
              .map((c) => {
                if (c.type === "textBlock") return c.text;
                if (c.type === "jsonBlock")
                  return JSON.stringify(c.json);
                return "";
              })
              .filter(Boolean)
              .join("\n");

            yield {
              type: "tool_use",
              toolName,
              input,
              result: resultText,
            };

            pendingTools.delete(result.toolUseId);
            break;
          }

          default:
            // Other event types (lifecycle hooks, etc.) are not surfaced to the frontend
            break;
        }
      }

      yield { type: "done", messageId };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown agent error";
      yield { type: "error", message };
    }
  }

  /**
   * Connect to MCP servers and discover their tools.
   * Rebuilds the agent with the newly discovered tools.
   */
  async configureMcp(mcpConfigs: MCPServerConfig[]): Promise<void> {
    // Disconnect any previously connected clients
    for (const client of this.mcpClients) {
      try {
        await client.disconnect();
      } catch {
        // Best-effort cleanup
      }
    }

    const enabledConfigs = mcpConfigs.filter((c) => c.enabled);
    this.mcpClients = enabledConfigs.map(
      (c) =>
        new McpClient({
          transport: new StdioClientTransport({
            command: c.command,
            args: c.args,
            env: Object.keys(c.env).length > 0 ? c.env : undefined,
          }),
        })
    );

    // Rebuild the agent with MCP clients as tool providers.
    // The Strands SDK handles tool discovery from McpClient instances
    // automatically during agent initialization.
    this.agent = this.buildAgent(this.mcpClients);
  }

  /**
   * Update the system prompt used by the agent.
   * Rebuilds the agent to pick up the new prompt.
   */
  updateSystemPrompt(prompt: string): void {
    this.config = { ...this.config, systemPrompt: prompt };
    this.agent = this.buildAgent(this.mcpClients);
  }
}
