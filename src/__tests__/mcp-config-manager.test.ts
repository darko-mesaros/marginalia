import { describe, it, expect, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { McpConfigManager } from "../mcp-config-manager.js";
import type { MCPServerConfig } from "../models.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a valid MCPServerConfig with random fields. */
const arbMcpServerConfig: fc.Arbitrary<MCPServerConfig> = fc.record({
  id: fc.uuid(),
  name: fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,19}$/),
  command: fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,29}$/),
  args: fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 5 }),
  env: fc.dictionary(
    fc.stringMatching(/^[A-Z][A-Z0-9_]{0,14}$/),
    fc.string({ minLength: 0, maxLength: 50 }),
    { minKeys: 0, maxKeys: 4 }
  ),
  enabled: fc.boolean(),
});

/**
 * Generates an array of MCPServerConfig with unique names.
 * Uniqueness is enforced by post-filtering via a Set.
 */
const arbMcpServerConfigArray: fc.Arbitrary<MCPServerConfig[]> = fc
  .array(arbMcpServerConfig, { minLength: 0, maxLength: 8 })
  .map((configs) => {
    const seen = new Set<string>();
    return configs.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
  });

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-cfg-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});


// ---------------------------------------------------------------------------
// Feature: mcp-persistent-config, Property 1: Configuration round-trip
// ---------------------------------------------------------------------------

describe("McpConfigManager", () => {
  it(
    "Property 1: Configuration round-trip — save() then load() produces equivalent entries (ids excluded)\n  Validates: Requirements 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 7.2",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbMcpServerConfigArray, async (configs) => {
          const dir = await makeTempDir();
          const filePath = path.join(dir, "mcp.json");
          const manager = new McpConfigManager(filePath);

          await manager.save(configs);
          const loaded = await manager.load();

          // Same number of entries
          expect(loaded).toHaveLength(configs.length);

          // Sort both by name for stable comparison
          const sortByName = (a: MCPServerConfig, b: MCPServerConfig) =>
            a.name.localeCompare(b.name);
          const original = [...configs].sort(sortByName);
          const result = [...loaded].sort(sortByName);

          for (let i = 0; i < original.length; i++) {
            // Compare all fields except id (regenerated on load)
            expect(result[i].name).toBe(original[i].name);
            expect(result[i].command).toBe(original[i].command);
            expect(result[i].args).toEqual(original[i].args);
            expect(result[i].env).toEqual(original[i].env);
            expect(result[i].enabled).toBe(original[i].enabled);

            // id should exist but will differ from original
            expect(result[i].id).toBeTruthy();
            expect(typeof result[i].id).toBe("string");
          }
        }),
        { numRuns: 100 }
      );
    }
  );

  // Feature: mcp-persistent-config, Property 2: Loaded entries have unique IDs
  it(
    "Property 2: Loaded entries have unique IDs — load() returns N entries with distinct non-empty id values\n  Validates: Requirements 2.3",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbMcpServerConfigArray, async (configs) => {
          const dir = await makeTempDir();
          const filePath = path.join(dir, "mcp.json");
          const manager = new McpConfigManager(filePath);

          await manager.save(configs);
          const loaded = await manager.load();

          // Count matches input
          expect(loaded).toHaveLength(configs.length);

          // All IDs are non-empty strings
          for (const entry of loaded) {
            expect(typeof entry.id).toBe("string");
            expect(entry.id.length).toBeGreaterThan(0);
          }

          // All IDs are unique
          const ids = loaded.map((e) => e.id);
          expect(new Set(ids).size).toBe(ids.length);
        }),
        { numRuns: 100 }
      );
    }
  );

  // Feature: mcp-persistent-config, Property 3: Invalid entries are skipped, optional fields get defaults
  it(
    "Property 3: Invalid entries are skipped, optional fields get defaults\n  Validates: Requirements 6.1, 6.4",
    async () => {
      // Generator for a valid entry name (unique key in the map)
      const arbName = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/);
      const arbCommand = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,29}$/);

      // Generator for a valid entry (has command, but omits optional fields to test defaults)
      const arbValidEntry = arbCommand.map((cmd) => ({ command: cmd }));

      // Generator for an invalid entry (missing command or empty string command)
      const arbInvalidEntry: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
        // No command field at all
        fc.record({
          args: fc.constant(["--flag"]),
        }),
        // Empty string command
        fc.record({
          command: fc.constant(""),
          args: fc.array(fc.string(), { minLength: 0, maxLength: 2 }),
        }),
        // command is not a string
        fc.record({
          command: fc.oneof(fc.integer(), fc.constant(null), fc.constant(true)),
        })
      );

      // Generator for a mixed config file with unique names
      const arbMixedConfig = fc
        .tuple(
          fc.array(fc.tuple(arbName, arbValidEntry), { minLength: 1, maxLength: 5 }),
          fc.array(fc.tuple(arbName, arbInvalidEntry), { minLength: 1, maxLength: 5 })
        )
        .map(([validPairs, invalidPairs]) => {
          const servers: Record<string, unknown> = {};
          const seen = new Set<string>();
          const validNames: string[] = [];

          // Add valid entries first
          for (const [name, entry] of validPairs) {
            if (seen.has(name)) continue;
            seen.add(name);
            servers[name] = entry;
            validNames.push(name);
          }

          // Add invalid entries with distinct names
          for (const [name, entry] of invalidPairs) {
            if (seen.has(name)) continue;
            seen.add(name);
            servers[name] = entry;
          }

          return { servers, validNames };
        })
        // Ensure we have at least one valid and one invalid
        .filter(({ validNames, servers }) => {
          const totalKeys = Object.keys(servers).length;
          return validNames.length >= 1 && totalKeys > validNames.length;
        });

      await fc.assert(
        fc.asyncProperty(arbMixedConfig, async ({ servers, validNames }) => {
          const dir = await makeTempDir();
          const filePath = path.join(dir, "mcp.json");

          // Write the JSON file directly (not via save()) to control exact content
          const fileContent = JSON.stringify({ mcpServers: servers }, null, 2);
          await fs.writeFile(filePath, fileContent, "utf-8");

          const manager = new McpConfigManager(filePath);
          const loaded = await manager.load();

          // Only valid entries are returned
          expect(loaded).toHaveLength(validNames.length);

          const loadedNames = loaded.map((e) => e.name).sort();
          expect(loadedNames).toEqual([...validNames].sort());

          // For each loaded entry, verify defaults are applied for missing optional fields
          for (const entry of loaded) {
            expect(entry.args).toEqual([]);
            expect(entry.env).toEqual({});
            expect(entry.enabled).toBe(true);
            // id should be generated
            expect(typeof entry.id).toBe("string");
            expect(entry.id.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 }
      );
    }
  );

  // Feature: mcp-persistent-config, Property 4: Extra fields are ignored
  it(
    "Property 4: Extra fields are ignored — adding arbitrary extra fields to entries does not change the loaded result\n  Validates: Requirements 6.3",
    async () => {
      // Generator for arbitrary extra fields (key-value pairs that are NOT recognized config fields)
      const reservedKeys = new Set(["command", "args", "env", "enabled"]);
      const arbExtraKey = fc
        .stringMatching(/^[a-z][a-zA-Z0-9_]{1,19}$/)
        .filter((k) => !reservedKeys.has(k));
      const arbExtraValue = fc.oneof(
        fc.string({ minLength: 0, maxLength: 30 }),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(fc.integer(), { minLength: 0, maxLength: 3 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.string({ minLength: 0, maxLength: 10 }), { minKeys: 0, maxKeys: 3 })
      );
      const arbExtraFields = fc.dictionary(arbExtraKey, arbExtraValue, {
        minKeys: 1,
        maxKeys: 5,
      });

      await fc.assert(
        fc.asyncProperty(
          arbMcpServerConfigArray.filter((arr) => arr.length > 0),
          arbExtraFields,
          async (configs, extraFields) => {
            const dir = await makeTempDir();
            const filePath = path.join(dir, "mcp.json");

            // Build the mcp.json content with extra fields injected into each entry
            const mcpServers: Record<string, Record<string, unknown>> = {};
            for (const cfg of configs) {
              mcpServers[cfg.name] = {
                command: cfg.command,
                args: cfg.args,
                env: cfg.env,
                enabled: cfg.enabled,
                // Inject arbitrary extra fields
                ...extraFields,
              };
            }

            // Write directly to disk (not via save()) to include extra fields
            await fs.writeFile(
              filePath,
              JSON.stringify({ mcpServers }, null, 2),
              "utf-8"
            );

            const manager = new McpConfigManager(filePath);
            const loaded = await manager.load();

            // Same number of entries
            expect(loaded).toHaveLength(configs.length);

            // Sort both by name for stable comparison
            const sortByName = (a: { name: string }, b: { name: string }) =>
              a.name.localeCompare(b.name);
            const original = [...configs].sort(sortByName);
            const result = [...loaded].sort(sortByName);

            for (let i = 0; i < original.length; i++) {
              expect(result[i].name).toBe(original[i].name);
              expect(result[i].command).toBe(original[i].command);
              expect(result[i].args).toEqual(original[i].args);
              expect(result[i].env).toEqual(original[i].env);
              expect(result[i].enabled).toBe(original[i].enabled);

              // id should be generated and valid
              expect(typeof result[i].id).toBe("string");
              expect(result[i].id.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  // Feature: mcp-persistent-config, Property 5: PATCH toggle updates enabled state
  it(
    "Property 5: PATCH toggle updates enabled state — PATCH with { enabled: value } returns the server with enabled set to that value\n  Validates: Requirements 4.3, 5.4",
    async () => {
      // Inline helpers mirroring routes.test.ts mock patterns
      const { createRouter } = await import("../routes.js");
      const { ConversationStore } = await import("../conversation-store.js");

      function extractHandler(
        router: any,
        method: string,
        routePath: string
      ): (req: any, res: any, next: any) => Promise<void> {
        const layer = router.stack.find(
          (l: any) => l.route?.path === routePath && l.route?.methods?.[method]
        );
        if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found`);
        const handlers = layer.route.stack;
        return handlers[handlers.length - 1].handle;
      }

      function createMockResponse(): any {
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
          _jsonBody: () => jsonBody,
          _ended: () => ended,
        };
        return res;
      }

      await fc.assert(
        fc.asyncProperty(arbMcpServerConfig, fc.boolean(), async (serverCfg, toggleValue) => {
          const config = {
            bedrockModelId: "test-model",
            systemPrompt: "test",
            skillFiles: [] as any[],
            mcpServers: [{ ...serverCfg }],
          };

          const mockAgent = {
            async *streamResponse() {},
            configureMcp: vi.fn(),
            updateSystemPrompt: vi.fn(),
          } as any;

          const mockLibrary = {
            save: async () => {},
            load: async () => { throw new Error("not found"); },
            delete: async () => {},
            exists: async () => false,
            list: async () => [],
            init: async () => {},
          } as any;

          const mockTitleGen = {
            generateAsync: vi.fn(),
            generate: vi.fn(async () => "Test"),
          } as any;

          const mockMcpCfgMgr = {
            load: vi.fn(async () => []),
            save: vi.fn(async () => {}),
          } as any;

          const store = new ConversationStore();
          const router = createRouter({
            store,
            agent: mockAgent,
            config,
            library: mockLibrary,
            titleGenerator: mockTitleGen,
            mcpConfigManager: mockMcpCfgMgr,
          });

          const handler = extractHandler(router, "patch", "/api/settings/mcp-servers/:id");

          const req = {
            params: { id: serverCfg.id },
            body: { enabled: toggleValue },
          };
          const res = createMockResponse();

          await handler(req, res, vi.fn());

          // Response status is 200 (default)
          expect(res.statusCode).toBe(200);

          // Response body has enabled set to the generated boolean value
          const body = res._jsonBody() as any;
          expect(body.enabled).toBe(toggleValue);
          expect(body.id).toBe(serverCfg.id);

          // The in-memory config is also updated
          expect(config.mcpServers[0].enabled).toBe(toggleValue);
        }),
        { numRuns: 100 }
      );
    }
  );

  // Feature: mcp-persistent-config, Property 6: PATCH rejects non-boolean enabled values
  it(
    "Property 6: PATCH rejects non-boolean enabled values — for any non-boolean value, PATCH returns HTTP 422\n  Validates: Requirements 5.2",
    async () => {
      const { createRouter } = await import("../routes.js");
      const { ConversationStore } = await import("../conversation-store.js");

      function extractHandler(
        router: any,
        method: string,
        routePath: string
      ): (req: any, res: any, next: any) => Promise<void> {
        const layer = router.stack.find(
          (l: any) => l.route?.path === routePath && l.route?.methods?.[method]
        );
        if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found`);
        const handlers = layer.route.stack;
        return handlers[handlers.length - 1].handle;
      }

      function createMockResponse(): any {
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
          _jsonBody: () => jsonBody,
          _ended: () => ended,
        };
        return res;
      }

      // Generator for non-boolean values
      const arbNonBoolean = fc.oneof(
        fc.string(),
        fc.integer(),
        fc.constant(null),
        fc.dictionary(fc.string(), fc.string()),
        fc.array(fc.string())
      );

      await fc.assert(
        fc.asyncProperty(arbMcpServerConfig, arbNonBoolean, async (serverCfg, nonBoolValue) => {
          const config = {
            bedrockModelId: "test-model",
            systemPrompt: "test",
            skillFiles: [] as any[],
            mcpServers: [{ ...serverCfg }],
          };

          const mockAgent = {
            async *streamResponse() {},
            configureMcp: vi.fn(),
            updateSystemPrompt: vi.fn(),
          } as any;

          const mockLibrary = {
            save: async () => {},
            load: async () => { throw new Error("not found"); },
            delete: async () => {},
            exists: async () => false,
            list: async () => [],
            init: async () => {},
          } as any;

          const mockTitleGen = {
            generateAsync: vi.fn(),
            generate: vi.fn(async () => "Test"),
          } as any;

          const mockMcpCfgMgr = {
            load: vi.fn(async () => []),
            save: vi.fn(async () => {}),
          } as any;

          const store = new ConversationStore();
          const router = createRouter({
            store,
            agent: mockAgent,
            config,
            library: mockLibrary,
            titleGenerator: mockTitleGen,
            mcpConfigManager: mockMcpCfgMgr,
          });

          const handler = extractHandler(router, "patch", "/api/settings/mcp-servers/:id");

          const req = {
            params: { id: serverCfg.id },
            body: { enabled: nonBoolValue },
          };
          const res = createMockResponse();

          await handler(req, res, vi.fn());

          // Should reject with 422
          expect(res.statusCode).toBe(422);

          // Should return a descriptive error
          const body = res._jsonBody() as any;
          expect(body.error).toBe("enabled must be a boolean");
        }),
        { numRuns: 100 }
      );
    }
  );

  // Feature: mcp-persistent-config, Property 7: PATCH returns 404 for non-existent server ID
  it(
    "Property 7: PATCH returns 404 for non-existent server ID — for any UUID not matching a server in config, PATCH returns HTTP 404\n  Validates: Requirements 5.3",
    async () => {
      const { createRouter } = await import("../routes.js");
      const { ConversationStore } = await import("../conversation-store.js");

      function extractHandler(
        router: any,
        method: string,
        routePath: string
      ): (req: any, res: any, next: any) => Promise<void> {
        const layer = router.stack.find(
          (l: any) => l.route?.path === routePath && l.route?.methods?.[method]
        );
        if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found`);
        const handlers = layer.route.stack;
        return handlers[handlers.length - 1].handle;
      }

      function createMockResponse(): any {
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
          _jsonBody: () => jsonBody,
          _ended: () => ended,
        };
        return res;
      }

      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.array(arbMcpServerConfig, { minLength: 0, maxLength: 5 }).map((configs) => {
            const seen = new Set<string>();
            return configs.filter((c) => {
              if (seen.has(c.name)) return false;
              seen.add(c.name);
              return true;
            });
          }),
          async (nonExistentId, existingServers) => {
            // Ensure the generated UUID does not match any server in the config
            const matchesExisting = existingServers.some((s) => s.id === nonExistentId);
            fc.pre(!matchesExisting);

            const config = {
              bedrockModelId: "test-model",
              systemPrompt: "test",
              skillFiles: [] as any[],
              mcpServers: existingServers.map((s) => ({ ...s })),
            };

            const mockAgent = {
              async *streamResponse() {},
              configureMcp: vi.fn(),
              updateSystemPrompt: vi.fn(),
            } as any;

            const mockLibrary = {
              save: async () => {},
              load: async () => { throw new Error("not found"); },
              delete: async () => {},
              exists: async () => false,
              list: async () => [],
              init: async () => {},
            } as any;

            const mockTitleGen = {
              generateAsync: vi.fn(),
              generate: vi.fn(async () => "Test"),
            } as any;

            const mockMcpCfgMgr = {
              load: vi.fn(async () => []),
              save: vi.fn(async () => {}),
            } as any;

            const store = new ConversationStore();
            const router = createRouter({
              store,
              agent: mockAgent,
              config,
              library: mockLibrary,
              titleGenerator: mockTitleGen,
              mcpConfigManager: mockMcpCfgMgr,
            });

            const handler = extractHandler(router, "patch", "/api/settings/mcp-servers/:id");

            const req = {
              params: { id: nonExistentId },
              body: { enabled: true },
            };
            const res = createMockResponse();

            await handler(req, res, vi.fn());

            // Should return 404
            expect(res.statusCode).toBe(404);

            // Should return descriptive error
            const body = res._jsonBody() as any;
            expect(body.error).toBe("MCP server config not found");
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
