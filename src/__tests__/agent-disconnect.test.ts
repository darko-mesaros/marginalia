import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type { AppConfig } from "../models.js";

// Mock the Strands SDK to avoid real SDK initialization
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
  bedrockModelId: "test-model",
  systemPrompt: "test",
  mcpServers: [],
  skillFiles: [],
};

describe("Feature: app-config-improvements, Property 1: disconnectAll settles all clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 1.1, 1.3**
   *
   * Property 1: For any array of mock MCP clients (each randomly resolving
   * or rejecting), disconnectAll() returns a PromiseSettledResult array of
   * the same length, with disconnect() called on every client.
   */
  it("disconnectAll settles all clients", async () => {
    const { MarginaliaAgent } = await import("../agent.js");

    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean()), async (shouldFailFlags) => {
        // Create mock clients based on the boolean array
        const mockClients = shouldFailFlags.map((shouldFail) => ({
          disconnect: vi.fn().mockImplementation(() =>
            shouldFail
              ? Promise.reject(new Error("disconnect failed"))
              : Promise.resolve()
          ),
        }));

        const agent = new MarginaliaAgent(defaultConfig);
        // Inject mock clients into the private field
        (agent as any).mcpClients = mockClients;

        const results = await agent.disconnectAll();

        // Result length must equal the number of clients
        expect(results.length).toBe(shouldFailFlags.length);

        // Every client must have had disconnect() called exactly once
        for (const client of mockClients) {
          expect(client.disconnect).toHaveBeenCalledTimes(1);
        }

        // Each result status must match the expected outcome
        for (let i = 0; i < shouldFailFlags.length; i++) {
          if (shouldFailFlags[i]) {
            expect(results[i].status).toBe("rejected");
          } else {
            expect(results[i].status).toBe("fulfilled");
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("Unit: disconnectAll edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 1.4, 1.5**
   * disconnectAll with empty client list resolves with []
   */
  it("resolves with [] when no clients are connected", async () => {
    const { MarginaliaAgent } = await import("../agent.js");
    const agent = new MarginaliaAgent(defaultConfig);

    // Ensure mcpClients is empty (default state)
    expect((agent as any).mcpClients).toEqual([]);

    const results = await agent.disconnectAll();

    expect(results).toEqual([]);
  });

  /**
   * **Validates: Requirements 1.4, 1.5**
   * disconnectAll clears the client list after settling
   */
  it("clears mcpClients after settling", async () => {
    const { MarginaliaAgent } = await import("../agent.js");
    const agent = new MarginaliaAgent(defaultConfig);

    // Inject mock clients
    const mockClients = [
      { disconnect: vi.fn().mockResolvedValue(undefined) },
      { disconnect: vi.fn().mockRejectedValue(new Error("fail")) },
      { disconnect: vi.fn().mockResolvedValue(undefined) },
    ];
    (agent as any).mcpClients = mockClients;

    expect((agent as any).mcpClients).toHaveLength(3);

    await agent.disconnectAll();

    expect((agent as any).mcpClients).toEqual([]);
  });
});
