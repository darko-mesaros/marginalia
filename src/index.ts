import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationStore } from "./conversation-store.js";
import { MarginaliaAgent } from "./agent.js";
import { createRouter } from "./routes.js";
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
const router = createRouter({ store, agent, config });

const app = express();

app.use(express.json());
app.use(router);
app.use(express.static(path.resolve(__dirname, "..", "frontend")));

const port = parseInt(process.env.PORT ?? "3000", 10);

app.listen(port, () => {
  console.log(`Marginalia server listening on http://localhost:${port}`);
});

export { app };
