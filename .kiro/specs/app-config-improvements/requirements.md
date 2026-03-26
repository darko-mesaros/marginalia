# Requirements Document

## Introduction

This feature set covers three improvements to Marginalia's application configuration and lifecycle management:

1. Graceful MCP server shutdown on application exit
2. A configurable system prompt that persists across resets (stored locally like MCP configs)
3. Relocating all data and config from the local `./data/` directory to `~/.config/marginalia/`

These changes improve operational reliability (no orphaned MCP child processes), user customisation (persistent system prompt), and follow platform conventions for config/data storage (XDG-style paths).

## Glossary

- **Application**: The Marginalia Express server process started via `npm start` or `npm run dev`
- **MCP_Server**: An external tool server launched as a child process via stdio transport, managed by `MarginaliaAgent`
- **MCP_Client**: A `McpClient` instance inside `MarginaliaAgent` that holds a connection to one MCP_Server
- **McpConfigManager**: The module responsible for reading and writing MCP server configurations to disk
- **PersistenceAdapter**: The interface responsible for saving and loading conversation JSON files
- **Config_Directory**: The platform-appropriate configuration directory, defaulting to `~/.config/marginalia/` on Linux/macOS and `%APPDATA%/marginalia/` on Windows (resolved via `MARGINALIA_DATA_DIR` environment variable override or OS default)
- **System_Prompt**: The base instruction text sent to the LLM at the start of every request context
- **Shutdown_Handler**: A process-level signal listener (SIGINT, SIGTERM) that runs cleanup logic before the Application exits

## Requirements

### Requirement 1: Graceful MCP Server Shutdown

**User Story:** As a user, I want MCP servers to be cleanly shut down when I stop the application, so that no orphaned child processes are left running on my system.

#### Acceptance Criteria

1. WHEN the Application receives a SIGINT or SIGTERM signal, THE Shutdown_Handler SHALL disconnect all active MCP_Client instances before the process exits.
2. WHEN the Application receives a shutdown signal, THE Shutdown_Handler SHALL wait for all MCP_Client disconnect operations to settle (resolve or reject) within a 5-second timeout before forcing process exit.
3. IF an MCP_Client disconnect operation fails, THEN THE Shutdown_Handler SHALL log the failure and continue shutting down remaining MCP_Client instances.
4. WHEN no MCP_Client instances are active at shutdown time, THE Shutdown_Handler SHALL exit the process without delay.
5. THE MarginaliaAgent SHALL expose a method to disconnect all active MCP_Client instances and return a promise that resolves when all disconnections have settled.

### Requirement 2: Configurable Persistent System Prompt

**User Story:** As a user, I want to customise the system prompt and have that customisation persist across application restarts, so that I do not have to reconfigure the prompt every time.

#### Acceptance Criteria

1. THE Application SHALL load the system prompt from a `system-prompt.md` file in the Config_Directory on startup.
2. WHEN no `system-prompt.md` file exists in the Config_Directory, THE Application SHALL use the built-in default system prompt.
3. WHEN the user updates the system prompt via `PUT /api/settings`, THE Application SHALL persist the new system prompt to `system-prompt.md` in the Config_Directory.
4. WHEN the user updates the system prompt to an empty string via `PUT /api/settings`, THE Application SHALL delete the `system-prompt.md` file and revert to the built-in default system prompt.
5. IF writing the `system-prompt.md` file fails, THEN THE Application SHALL log the error and continue operating with the in-memory system prompt value.
6. WHEN the system prompt is loaded from `system-prompt.md`, THE Application SHALL trim leading and trailing whitespace from the file content before use.

### Requirement 3: Relocate Data and Config to ~/.config/marginalia/

**User Story:** As a user, I want my Marginalia data and configuration stored in `~/.config/marginalia/` by default, so that the application follows platform conventions and keeps the project directory clean.

#### Acceptance Criteria

1. THE Application SHALL resolve the base data directory using the `MARGINALIA_DATA_DIR` environment variable when set, falling back to `~/.config/marginalia/` on Linux/macOS or `%APPDATA%/marginalia/` on Windows.
2. THE Application SHALL store conversation JSON files under a `chats/` subdirectory within the resolved base data directory.
3. THE Application SHALL store the `mcp.json` configuration file in the root of the resolved base data directory.
4. THE Application SHALL store the `system-prompt.md` file in the root of the resolved base data directory.
5. WHEN the resolved base data directory or its `chats/` subdirectory does not exist, THE Application SHALL create the directories recursively on startup.
6. THE PersistenceAdapter SHALL accept the conversations directory path as a constructor parameter, defaulting to the `chats/` subdirectory within the resolved base data directory.
7. THE McpConfigManager SHALL accept the config file path as a constructor parameter, defaulting to `mcp.json` within the resolved base data directory.
8. WHEN `MARGINALIA_DATA_DIR` is set to a non-absolute path, THE Application SHALL resolve the path relative to the current working directory.
9. THE Application SHALL expose a single `resolveDataDir()` function that all modules use to determine the base data directory, ensuring consistent path resolution across the codebase.
