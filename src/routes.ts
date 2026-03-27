import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ConversationStore } from "./conversation-store.js";
import { MarginaliaAgent } from "./agent.js";
import { ContextAssembler } from "./context-assembler.js";
import { submitMainQuestion, submitSideQuestion, submitSideFollowup, submitContinuation } from "./conversation-ops.js";
import { validateAskBody, validateSideQuestionBody, validateSideFollowupBody, validateContinueBody } from "./validation.js";
import type { AppConfig } from "./models.js";
import { LibraryError } from "./conversation-library.js";
import type { ConversationLibrary } from "./conversation-library.js";
import type { TitleGenerator } from "./title-generator.js";
import type { McpConfigManager } from "./mcp-config-manager.js";
import { sanitiseTitle, exportMarkdown, exportHtml } from "./exporters.js";
import {
  initSSE,
  onClientDisconnect,
  writeSSEEvent,
  writeTokenEvent,
  writeToolUseEvent,
  writeDoneEvent,
  writeErrorEvent,
} from "./sse.js";
import { saveSystemPrompt } from "./system-prompt.js";

interface RouterDeps {
  store: ConversationStore;
  agent: MarginaliaAgent;
  config: AppConfig;
  library: ConversationLibrary;
  titleGenerator: TitleGenerator;
  mcpConfigManager: McpConfigManager;
  dataDir: string;
}

export function createRouter(deps: RouterDeps): Router {
  const { store, agent, config, library, titleGenerator, mcpConfigManager, dataDir } = deps;
  const router = Router();

  router.post("/api/ask", validateAskBody, async (req: Request, res: Response) => {
    const { question } = req.body;

    try {
      // Add user message to the main thread
      submitMainQuestion(store, question);

      // Assemble context for the LLM
      const conversation = store.getOrCreateConversation();
      library.save(conversation).catch(err => console.error("[routes] save failed:", err));

      // Fire-and-forget title generation on first message
      if (conversation.mainThread.length === 1) {
        titleGenerator.generateAsync(conversation.id, question, async (title) => {
          conversation.title = title;
          library.save(conversation).catch(err => console.error("[routes] title save failed:", err));
          if (res.writable) {
            writeSSEEvent(res, "title", { conversation_id: conversation.id, title });
          }
        });
      }

      const assembler = new ContextAssembler(config);
      const contextMessages = assembler.assembleForMain(conversation, question);

      // Set up SSE streaming
      initSSE(res);

      let disconnected = false;
      onClientDisconnect(res, () => {
        disconnected = true;
      });

      // Stream the agent response
      let accumulatedContent = "";
      const toolInvocations: Array<{ toolName: string; input: object; result: string }> = [];

      for await (const event of agent.streamResponse(contextMessages)) {
        if (disconnected) break;

        switch (event.type) {
          case "token":
            accumulatedContent += event.content;
            writeTokenEvent(res, event.content);
            break;

          case "tool_use":
            toolInvocations.push({
              toolName: event.toolName,
              input: event.input,
              result: event.result,
            });
            writeToolUseEvent(res, event.toolName, event.input, event.result);
            break;

          case "done": {
            const assistantMsg = store.addMainMessage("assistant", accumulatedContent);
            library.save(store.getOrCreateConversation()).catch(err => console.error("[routes] save failed:", err));
            writeDoneEvent(res, assistantMsg.id);
            res.end();
            return;
          }

          case "error":
            writeErrorEvent(res, event.message);
            res.end();
            return;
        }
      }

      // If we exited the loop without a done/error event (e.g. client disconnect),
      // still store whatever content we accumulated
      if (!disconnected && accumulatedContent.length > 0) {
        store.addMainMessage("assistant", accumulatedContent);
        library.save(store.getOrCreateConversation()).catch(err => console.error("[routes] save failed:", err));
      }
      if (!disconnected) {
        res.end();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";
      // If headers haven't been sent yet, return a JSON error
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        // Headers already sent (SSE mode), write an error event
        writeErrorEvent(res, message);
        res.end();
      }
    }
  });

  router.post("/api/side-question", validateSideQuestionBody, async (req: Request, res: Response) => {
    const { selected_text, question, anchor_position } = req.body;

    try {
      const { thread } = submitSideQuestion(store, selected_text, question, {
        messageId: anchor_position.message_id,
        startOffset: anchor_position.start_offset,
        endOffset: anchor_position.end_offset,
      });

      const conversation = store.getOrCreateConversation();
      const assembler = new ContextAssembler(config);
      const contextMessages = assembler.assembleForSide(conversation, thread.id, question);

      initSSE(res);

      let disconnected = false;
      onClientDisconnect(res, () => {
        disconnected = true;
      });

      let accumulatedContent = "";

      for await (const event of agent.streamResponse(contextMessages)) {
        if (disconnected) break;

        switch (event.type) {
          case "token":
            accumulatedContent += event.content;
            writeSSEEvent(res, "token", { content: event.content, thread_id: thread.id });
            break;

          case "tool_use":
            writeToolUseEvent(res, event.toolName, event.input, event.result);
            break;

          case "done": {
            const assistantMsg = store.addSideMessage(thread.id, "assistant", accumulatedContent);
            library.save(store.getOrCreateConversation()).catch(err => console.error("[routes] save failed:", err));
            writeSSEEvent(res, "done", { message_id: assistantMsg.id, thread_id: thread.id });
            res.end();
            return;
          }

          case "error":
            writeErrorEvent(res, event.message);
            res.end();
            return;
        }
      }

      if (!disconnected && accumulatedContent.length > 0) {
        store.addSideMessage(thread.id, "assistant", accumulatedContent);
        library.save(store.getOrCreateConversation()).catch(err => console.error("[routes] save failed:", err));
      }
      if (!disconnected) {
        res.end();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        writeErrorEvent(res, message);
        res.end();
      }
    }
  });

  router.post("/api/side-followup", validateSideFollowupBody, async (req: Request, res: Response) => {
    const { thread_id, question } = req.body;

    try {
      submitSideFollowup(store, thread_id, question);

      const conversation = store.getOrCreateConversation();
      const assembler = new ContextAssembler(config);
      const contextMessages = assembler.assembleForSide(conversation, thread_id, question);

      initSSE(res);

      let disconnected = false;
      onClientDisconnect(res, () => {
        disconnected = true;
      });

      let accumulatedContent = "";

      for await (const event of agent.streamResponse(contextMessages)) {
        if (disconnected) break;

        switch (event.type) {
          case "token":
            accumulatedContent += event.content;
            writeSSEEvent(res, "token", { content: event.content, thread_id });
            break;

          case "tool_use":
            writeToolUseEvent(res, event.toolName, event.input, event.result);
            break;

          case "done": {
            const assistantMsg = store.addSideMessage(thread_id, "assistant", accumulatedContent);
            library.save(store.getOrCreateConversation()).catch(err => console.error("[routes] save failed:", err));
            writeSSEEvent(res, "done", { message_id: assistantMsg.id, thread_id });
            res.end();
            return;
          }

          case "error":
            writeErrorEvent(res, event.message);
            res.end();
            return;
        }
      }

      if (!disconnected && accumulatedContent.length > 0) {
        store.addSideMessage(thread_id, "assistant", accumulatedContent);
        library.save(store.getOrCreateConversation()).catch(err => console.error("[routes] save failed:", err));
      }
      if (!disconnected) {
        res.end();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        writeErrorEvent(res, message);
        res.end();
      }
    }
  });

  router.post("/api/continue", validateContinueBody, async (req: Request, res: Response) => {
    const { question } = req.body;

    try {
      // Add user message to the main thread
      submitContinuation(store, question);

      // Assemble full context (main + all side threads)
      const conversation = store.getOrCreateConversation();
      const assembler = new ContextAssembler(config);
      const contextMessages = assembler.assembleForMain(conversation, question);

      // Set up SSE streaming
      initSSE(res);

      let disconnected = false;
      onClientDisconnect(res, () => {
        disconnected = true;
      });

      // Stream the agent response
      let accumulatedContent = "";

      for await (const event of agent.streamResponse(contextMessages)) {
        if (disconnected) break;

        switch (event.type) {
          case "token":
            accumulatedContent += event.content;
            writeTokenEvent(res, event.content);
            break;

          case "tool_use":
            writeToolUseEvent(res, event.toolName, event.input, event.result);
            break;

          case "done": {
            const assistantMsg = store.addMainMessage("assistant", accumulatedContent);
            library.save(store.getOrCreateConversation()).catch(err => console.error("[routes] save failed:", err));
            writeDoneEvent(res, assistantMsg.id);
            res.end();
            return;
          }

          case "error":
            writeErrorEvent(res, event.message);
            res.end();
            return;
        }
      }

      if (!disconnected && accumulatedContent.length > 0) {
        store.addMainMessage("assistant", accumulatedContent);
        library.save(store.getOrCreateConversation()).catch(err => console.error("[routes] save failed:", err));
      }
      if (!disconnected) {
        res.end();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        writeErrorEvent(res, message);
        res.end();
      }
    }
  });

  // --- Conversation library endpoints ---

  router.get("/api/conversations", async (_req: Request, res: Response) => {
    try {
      const summaries = await library.list();
      res.status(200).json(summaries);
    } catch {
      res.status(500).json({ error: "Failed to list conversations" });
    }
  });

  router.post("/api/conversations/new", async (_req: Request, res: Response) => {
    try {
      const conversation = store.getConversation();
      if (conversation && conversation.mainThread.length === 0) {
        await library.delete(conversation.id);
      }
      store.reset();
      const newConversation = store.getOrCreateConversation();
      await library.save(newConversation);
      res.status(201).json({ id: newConversation.id });
    } catch {
      res.status(500).json({ error: "Failed to create new conversation" });
    }
  });

  router.get("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const loaded = await library.load(id);
      store.setConversation(loaded);
      res.status(200).json(loaded);
    } catch (err) {
      if (err instanceof LibraryError && err.code === "NOT_FOUND") {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      res.status(500).json({ error: "Failed to load conversation" });
    }
  });

  router.get("/api/conversations/:id/export", async (req: Request, res: Response) => {
    const VALID_FORMATS = ["markdown", "html", "json"] as const;
    type ExportFormat = (typeof VALID_FORMATS)[number];

    const format = req.query.format as string | undefined;
    if (!format || !VALID_FORMATS.includes(format as ExportFormat)) {
      res.status(400).json({ error: "Invalid or missing format. Supported formats: markdown, html, json" });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      if (format === "json") {
        const exists = await library.exists(id);
        if (!exists) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }

        let rawJson: string;
        try {
          rawJson = await fs.readFile(path.join(dataDir, "chats", `${id}.json`), "utf-8");
        } catch (err: unknown) {
          const e = err as NodeJS.ErrnoException;
          if (e.code === "ENOENT") {
            res.status(404).json({ error: "Conversation not found" });
            return;
          }
          throw e;
        }

        const parsed = JSON.parse(rawJson);
        const title = sanitiseTitle(typeof parsed.title === "string" ? parsed.title : "conversation");

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${title}.json"`);
        res.send(rawJson);
      } else {
        const conversation = await library.load(id);
        const title = sanitiseTitle(conversation.title);

        if (format === "markdown") {
          const content = exportMarkdown(conversation);
          res.setHeader("Content-Type", "text/markdown; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="${title}.md"`);
          res.send(content);
        } else {
          const content = exportHtml(conversation);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="${title}.html"`);
          res.send(content);
        }
      }
    } catch (err) {
      if (err instanceof LibraryError && err.code === "NOT_FOUND") {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      console.error("[routes] export failed:", err);
      res.status(500).json({ error: "Export failed" });
    }
  });

  // --- Settings endpoints ---

  router.get("/api/settings", (_req: Request, res: Response) => {
    res.json({
      systemPrompt: config.systemPrompt,
      bedrockModelId: config.bedrockModelId,
      skillFiles: config.skillFiles,
      mcpServers: config.mcpServers,
    });
  });

  router.put("/api/settings", (req: Request, res: Response) => {
    const { systemPrompt, bedrockModelId } = req.body ?? {};

    if (systemPrompt !== undefined) {
      if (typeof systemPrompt !== "string") {
        res.status(422).json({ error: "systemPrompt must be a string" });
        return;
      }
      const oldPrompt = config.systemPrompt;
      config.systemPrompt = systemPrompt;
      if (systemPrompt !== oldPrompt) {
        agent.updateSystemPrompt(systemPrompt);
        saveSystemPrompt(dataDir, systemPrompt).catch(err =>
          console.error("[routes] system prompt save failed:", err)
        );
      }
    }

    if (bedrockModelId !== undefined) {
      if (typeof bedrockModelId !== "string" || bedrockModelId.trim().length === 0) {
        res.status(422).json({ error: "bedrockModelId must be a non-empty string" });
        return;
      }
      config.bedrockModelId = bedrockModelId;
    }

    res.json({
      systemPrompt: config.systemPrompt,
      bedrockModelId: config.bedrockModelId,
      skillFiles: config.skillFiles,
      mcpServers: config.mcpServers,
    });
  });

  router.post("/api/settings/skill-files", (req: Request, res: Response) => {
    const { name, content, order } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(422).json({ error: "name must be a non-empty string" });
      return;
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      res.status(422).json({ error: "content must be a non-empty string" });
      return;
    }

    // Reject binary content (e.g., files containing null bytes)
    if (content.includes("\0")) {
      res.status(422).json({ error: "Skill file content must be readable text, binary files are not allowed" });
      return;
    }

    const skillFile = {
      id: randomUUID(),
      name: name.trim(),
      content,
      order: typeof order === "number" ? order : config.skillFiles.length,
    };

    config.skillFiles.push(skillFile);
    res.status(201).json(skillFile);
  });

  router.delete("/api/settings/skill-files/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const index = config.skillFiles.findIndex((sf) => sf.id === id);

    if (index === -1) {
      res.status(404).json({ error: "Skill file not found" });
      return;
    }

    config.skillFiles.splice(index, 1);
    res.json({ success: true });
  });

  router.post("/api/settings/mcp-servers", async (req: Request, res: Response) => {
    const { name, command, args, env, enabled } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(422).json({ error: "name must be a non-empty string" });
      return;
    }

    if (!command || typeof command !== "string" || command.trim().length === 0) {
      res.status(422).json({ error: "command must be a non-empty string" });
      return;
    }

    // Validate env field
    let sanitizedEnv: Record<string, string> = {};
    if (env !== undefined) {
      if (typeof env !== "object" || env === null || Array.isArray(env)) {
        res.status(422).json({ error: "env must be a plain object" });
        return;
      }
      for (const val of Object.values(env as Record<string, unknown>)) {
        if (typeof val !== "string") {
          res.status(422).json({ error: "All env values must be strings" });
          return;
        }
      }
      // Strip entries where the key is an empty string (after trim)
      for (const [key, val] of Object.entries(env as Record<string, string>)) {
        if (key.trim().length > 0) {
          sanitizedEnv[key] = val;
        }
      }
    }

    const mcpServer = {
      id: randomUUID(),
      name: name.trim(),
      command: command.trim(),
      args: Array.isArray(args) ? args : [],
      env: sanitizedEnv,
      enabled: typeof enabled === "boolean" ? enabled : true,
    };

    config.mcpServers.push(mcpServer);

    try {
      await agent.configureMcp(config.mcpServers);
    } catch {
      // MCP configuration is best-effort; server is still added
    }

    mcpConfigManager.save(config.mcpServers).catch(err => console.error("[routes] MCP config save failed:", err));

    res.status(201).json(mcpServer);
  });

  router.patch("/api/settings/mcp-servers/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { enabled } = req.body ?? {};

    if (typeof enabled !== "boolean") {
      res.status(422).json({ error: "enabled must be a boolean" });
      return;
    }

    const server = config.mcpServers.find((s) => s.id === id);

    if (!server) {
      res.status(404).json({ error: "MCP server config not found" });
      return;
    }

    server.enabled = enabled;

    try {
      await agent.configureMcp(config.mcpServers);
    } catch {
      // MCP reconfiguration is best-effort
    }

    mcpConfigManager.save(config.mcpServers).catch(err => console.error("[routes] MCP config save failed:", err));

    res.json(server);
  });

  router.delete("/api/settings/mcp-servers/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const index = config.mcpServers.findIndex((s) => s.id === id);

    if (index === -1) {
      res.status(404).json({ error: "MCP server config not found" });
      return;
    }

    config.mcpServers.splice(index, 1);

    try {
      await agent.configureMcp(config.mcpServers);
    } catch {
      // MCP reconfiguration is best-effort
    }

    mcpConfigManager.save(config.mcpServers).catch(err => console.error("[routes] MCP config save failed:", err));

    res.json({ success: true });
  });

  return router;
}
