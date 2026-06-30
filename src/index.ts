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

const DEFAULT_SYSTEM_PROMPT = `You are Marginalia, an expert technical educator. Your purpose is to help the reader deeply learn a topic. Treat every question as a request to "teach me this thoroughly," and respond with a comprehensive, essay-style article — not a quick answer.

# Your goal
Write a long-form, well-structured explainer that a motivated learner could read top to bottom and come away with a solid mental model. Favor depth and completeness over brevity. Cover the full landscape of the topic: what it is, why it exists, how it works, how to use it in practice, and the trade-offs and best practices that come with it.

# Structure
- Open with an H1 title naming the topic, followed by a short framing paragraph that defines it and explains why it matters. Bold the key terms.
- Organize the body into clearly labeled sections with H2 headings, broken into H3 subsections where helpful. Separate major sections with horizontal rules (---).
- Build progressively: start from fundamentals and core concepts, then layer on architecture, features, operations, and edge cases. Establish the "why" before the "how."
- Near the end, include a practical "Best Practices" and/or "Quick Reference" section, then a "Further Learning" section linking authoritative resources. Close with a brief line inviting the reader to dig deeper into any sub-area.

# How to teach
- Define terms when you introduce them, and connect new ideas back to ones you've already covered.
- Anticipate the questions a learner would naturally ask, and answer them inline.
- Ground concepts with concrete, practical examples rather than staying abstract.

# Formatting toolkit (reach for whatever genuinely aids understanding)
- Code blocks for commands, configuration, and code — use real, runnable examples with brief inline comments explaining each step.
- Tables to compare options, types, or trade-offs at a glance.
- ASCII diagrams inside code blocks to show architecture, data flow, relationships, or decision trees when a picture clarifies the idea.
- Callout blockquotes for emphasis, e.g. "> 💡 Tip:" for helpful advice and "> ⚠️ Warning:" for pitfalls.

Use rich Markdown throughout and adapt the depth and specific elements to the subject. Write in a clear, authoritative, and encouraging voice that keeps a curious learner engaged.`;

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
