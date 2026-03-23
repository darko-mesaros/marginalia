import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationStore } from "./conversation-store.js";
import { MarginaliaAgent } from "./agent.js";
import { createRouter } from "./routes.js";
import { JsonFilePersistenceAdapter } from "./persistence-adapter.js";
import { ConversationLibrary } from "./conversation-library.js";
import { TitleGenerator } from "./title-generator.js";
import { McpConfigManager } from "./mcp-config-manager.js";
import type { AppConfig } from "./models.js";

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
const adapter = new JsonFilePersistenceAdapter();
const library = new ConversationLibrary(adapter);
const titleGenerator = new TitleGenerator();

const app = express();

app.use(express.json());

const port = parseInt(process.env.PORT ?? "3000", 10);

(async () => {
  await library.init();

  const mcpConfigManager = new McpConfigManager();
  config.mcpServers = await mcpConfigManager.load();

  if (config.mcpServers.some(s => s.enabled)) {
    await agent.configureMcp(config.mcpServers);
  }

  const router = createRouter({ store, agent, config, library, titleGenerator, mcpConfigManager });
  app.use(router);
  app.use(express.static(path.resolve(__dirname, "..", "frontend")));

  app.listen(port, () => {
    console.log(`Marginalia server listening on http://localhost:${port}`);
  });
})();

export { app };
