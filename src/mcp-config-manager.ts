import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { MCPServerConfig } from "./models.js";

export interface McpConfigFileEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpConfigFileEntry>;
}

export class McpConfigManager {
  constructor(private readonly filePath: string = "./data/mcp.json") {}

  async load(): Promise<MCPServerConfig[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf-8");
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      console.warn(`Failed to read MCP config file: ${e.message}`);
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("MCP config file contains invalid JSON, starting with empty config");
      return [];
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("MCP config file is not a JSON object, starting with empty config");
      return [];
    }

    const obj = parsed as Record<string, unknown>;
    const mcpServers = obj["mcpServers"];

    if (typeof mcpServers !== "object" || mcpServers === null || Array.isArray(mcpServers)) {
      console.warn("MCP config file missing valid mcpServers object, starting with empty config");
      return [];
    }

    const serversMap = mcpServers as Record<string, unknown>;
    const configs: MCPServerConfig[] = [];

    for (const [name, entry] of Object.entries(serversMap)) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        console.warn(`Skipping MCP server "${name}": entry is not an object`);
        continue;
      }

      const entryObj = entry as Record<string, unknown>;
      const command = entryObj["command"];

      if (typeof command !== "string" || command.length === 0) {
        console.warn(`Skipping MCP server "${name}": missing or invalid command`);
        continue;
      }

      const args = Array.isArray(entryObj["args"]) ? (entryObj["args"] as string[]) : [];
      const env =
        typeof entryObj["env"] === "object" &&
        entryObj["env"] !== null &&
        !Array.isArray(entryObj["env"])
          ? (entryObj["env"] as Record<string, string>)
          : {};
      const enabled = typeof entryObj["enabled"] === "boolean" ? entryObj["enabled"] : true;

      configs.push({
        id: randomUUID(),
        name,
        command,
        args,
        env,
        enabled,
      });
    }

    return configs;
  }

  async save(servers: MCPServerConfig[]): Promise<void> {
    const mcpServers: Record<string, McpConfigFileEntry> = {};

    for (const server of servers) {
      mcpServers[server.name] = {
        command: server.command,
        args: server.args,
        env: server.env,
        enabled: server.enabled,
      };
    }

    const fileContent: McpConfigFile = { mcpServers };
    const json = JSON.stringify(fileContent, null, 2);
    const tmpPath = `${this.filePath}.tmp`;

    try {
      await fs.writeFile(tmpPath, json, "utf-8");
      await fs.rename(tmpPath, this.filePath);
    } catch (err: unknown) {
      const e = err as Error;
      console.error(`Failed to save MCP config: ${e.message}`);
    }
  }
}
