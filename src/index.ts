import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationStore } from "./conversation-store.js";
import { MarginaliaAgent } from "./agent.js";
import { createRouter } from "./routes.js";
import { JsonFilePersistenceAdapter } from "./persistence-adapter.js";
import { ConversationLibrary } from "./conversation-library.js";
import { TitleGenerator } from "./title-generator.js";
import { McpConfigManager } from "./mcp-config-manager.js";
import { resolveDataDir } from "./data-dir.js";
import { loadSystemPrompt } from "./system-prompt.js";
import type { AppConfig } from "./models.js";

/**
 * Register process signal handlers for graceful MCP server shutdown.
 * Disconnects all active MCP clients before exiting, with a 5-second timeout.
 */
export function registerShutdownHandlers(agent: MarginaliaAgent): void {
  let shuttingDown = false;

  const handler = async (signal: string) => {
    if (shuttingDown) return; // prevent double-fire
    shuttingDown = true;
    console.log(`\n[shutdown] Received ${signal}, disconnecting MCP servers...`);

    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
    const disconnect = agent.disconnectAll().then(results => {
      const failed = results.filter(r => r.status === "rejected");
      if (failed.length > 0) {
        console.warn(`[shutdown] ${failed.length} MCP disconnect(s) failed`);
      }
    });

    await Promise.race([disconnect, timeout]);
    process.exit(0);
  };

  process.on("SIGINT", () => { handler("SIGINT"); });
  process.on("SIGTERM", () => { handler("SIGTERM"); });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SYSTEM_PROMPT = `You are Marginalia, a technical explainer. When a user asks a question, provide a clear, structured explanation using markdown formatting. Use headings, code blocks, and examples where appropriate. Be thorough but concise.`;

const config: AppConfig = {
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? "qwen.qwen3-vl-235b-a22b",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  skillFiles: [],
  mcpServers: [],
};

const store = new ConversationStore();
const agent = new MarginaliaAgent(config);
const titleGenerator = new TitleGenerator();

const app = express();

app.use(express.json());

const port = parseInt(process.env.PORT ?? "3000", 10);

(async () => {
  const dataDir = resolveDataDir();
  console.log(`[startup] Data directory: ${dataDir}`);
  await fs.mkdir(path.join(dataDir, "chats"), { recursive: true });

  const adapter = new JsonFilePersistenceAdapter(path.join(dataDir, "chats"));
  const library = new ConversationLibrary(adapter);
  await library.init();

  const mcpConfigManager = new McpConfigManager(path.join(dataDir, "mcp.json"));
  config.mcpServers = await mcpConfigManager.load();

  if (config.mcpServers.some(s => s.enabled)) {
    await agent.configureMcp(config.mcpServers);
  }

  const persistedPrompt = await loadSystemPrompt(dataDir);
  if (persistedPrompt) {
    config.systemPrompt = persistedPrompt;
  }

  const router = createRouter({ store, agent, config, library, titleGenerator, mcpConfigManager, dataDir });
  app.use(router);
  app.use(express.static(path.resolve(__dirname, "..", "frontend")));

  app.listen(port, () => {
    console.log(`Marginalia server listening on http://localhost:${port}`);
  });

  registerShutdownHandlers(agent);
})();

export { app };
