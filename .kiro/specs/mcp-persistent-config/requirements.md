# Requirements Document

## Introduction

Marginalia's MCP server configuration is currently stored only in memory — every restart wipes the config. This feature adds persistent storage of MCP server configurations via a `mcp.json` file (following the convention used by VS Code, Cursor, Kiro, and similar tools). The file serves as both the initial seed on startup and the durable store for changes made through the settings UI. Additionally, users gain the ability to enable or disable individual MCP servers on the fly without removing them.

## Glossary

- **MCP_Config_File**: A JSON file at `./data/mcp.json` that stores the array of MCP server configurations persistently
- **MCP_Config_Manager**: A backend module responsible for reading, writing, and validating the MCP_Config_File
- **Settings_Dialog**: The modal dialog in the frontend (`#settings-dialog`) where users configure MCP servers
- **MCP_Server_List**: The `<ul>` element (`#mcp-server-list`) that displays configured MCP servers
- **Backend_API**: The Express 5 REST API serving MCP server configuration endpoints
- **MarginaliaAgent**: The backend agent class that connects to MCP servers via stdio transport
- **AppConfig**: The in-memory application configuration object holding `mcpServers` among other settings

## Requirements

### Requirement 1: Load MCP Configuration from File on Startup

**User Story:** As a user, I want my MCP server configurations to be loaded automatically when Marginalia starts, so that I do not have to re-enter them after every restart.

#### Acceptance Criteria

1. WHEN the application starts, THE MCP_Config_Manager SHALL read the MCP_Config_File from `./data/mcp.json`
2. WHEN the MCP_Config_File exists and contains valid JSON, THE MCP_Config_Manager SHALL parse the file and populate the AppConfig `mcpServers` array with the loaded configurations
3. WHEN the MCP_Config_File does not exist, THE MCP_Config_Manager SHALL start with an empty `mcpServers` array and proceed without error
4. WHEN the MCP_Config_File contains invalid JSON, THE MCP_Config_Manager SHALL log a warning, start with an empty `mcpServers` array, and proceed without error
5. WHEN MCP server configurations are loaded from the MCP_Config_File, THE MarginaliaAgent SHALL configure itself with the enabled servers before the HTTP server begins accepting requests

### Requirement 2: MCP Configuration File Format

**User Story:** As a user, I want the `mcp.json` file to follow a familiar format similar to VS Code and other tools, so that I can hand-edit it or copy configurations from other tools.

#### Acceptance Criteria

1. THE MCP_Config_File SHALL use a JSON object with a top-level `mcpServers` key containing a map of server names to their configuration objects
2. THE MCP_Config_File SHALL store each server configuration with the fields: `command` (string), `args` (string array), `env` (string-to-string object), and `enabled` (boolean)
3. THE MCP_Config_Manager SHALL generate a unique `id` for each server entry that lacks one when loading from the file
4. WHEN the MCP_Config_File is written, THE MCP_Config_Manager SHALL format the JSON with 2-space indentation for human readability

### Requirement 3: Save MCP Configuration Changes to File

**User Story:** As a user, I want changes I make to MCP servers through the settings UI to be saved to `mcp.json`, so that my configuration survives restarts.

#### Acceptance Criteria

1. WHEN a new MCP server is added via the Backend_API, THE MCP_Config_Manager SHALL write the updated configuration to the MCP_Config_File
2. WHEN an MCP server is removed via the Backend_API, THE MCP_Config_Manager SHALL write the updated configuration to the MCP_Config_File
3. WHEN an MCP server is enabled or disabled via the Backend_API, THE MCP_Config_Manager SHALL write the updated configuration to the MCP_Config_File
4. IF the MCP_Config_File write fails, THEN THE Backend_API SHALL log the error and continue operating with the in-memory configuration without failing the API request

### Requirement 4: Enable and Disable MCP Servers

**User Story:** As a user, I want to enable or disable individual MCP servers without removing them, so that I can temporarily turn off servers I do not need.

#### Acceptance Criteria

1. THE MCP_Server_List SHALL display a toggle control for each MCP server indicating its enabled or disabled state
2. WHEN the user toggles an MCP server's enabled state, THE Settings_Dialog SHALL send a PATCH request to the Backend_API with the new enabled value
3. WHEN the Backend_API receives a PATCH request to toggle an MCP server, THE Backend_API SHALL update the server's `enabled` field in the AppConfig
4. WHEN the Backend_API updates an MCP server's enabled state, THE MarginaliaAgent SHALL reconfigure itself using only the currently enabled servers
5. WHEN an MCP server is disabled, THE MCP_Server_List SHALL visually indicate the disabled state (e.g., reduced opacity)
6. THE MCP_Server_List SHALL allow toggling the enabled state without requiring a page reload

### Requirement 5: Backend API for Toggling MCP Server State

**User Story:** As a developer, I want a dedicated API endpoint for toggling MCP server enabled state, so that the frontend can enable or disable servers without resending the full configuration.

#### Acceptance Criteria

1. THE Backend_API SHALL expose a `PATCH /api/settings/mcp-servers/:id` endpoint that accepts a JSON body with an `enabled` boolean field
2. WHEN the `enabled` field is not a boolean, THE Backend_API SHALL respond with HTTP 422 and a descriptive error message
3. WHEN the specified server ID does not exist, THE Backend_API SHALL respond with HTTP 404 and an error message
4. WHEN the toggle is successful, THE Backend_API SHALL respond with the updated MCP server configuration object

### Requirement 6: MCP Configuration File Validation

**User Story:** As a user, I want the application to handle malformed `mcp.json` files gracefully, so that a typo in the file does not prevent the application from starting.

#### Acceptance Criteria

1. WHEN the MCP_Config_File contains entries missing the required `command` field, THE MCP_Config_Manager SHALL skip those entries and log a warning for each skipped entry
2. WHEN the MCP_Config_File contains entries with invalid field types (e.g., `args` is not an array), THE MCP_Config_Manager SHALL coerce or skip the entry and log a warning
3. WHEN the MCP_Config_File contains extra unrecognized fields, THE MCP_Config_Manager SHALL ignore the extra fields without error
4. THE MCP_Config_Manager SHALL validate that `command` is a non-empty string, `args` is an array of strings, `env` is a string-to-string object, and `enabled` is a boolean (defaulting to `true` if omitted)

### Requirement 7: Bidirectional Sync Between File and In-Memory State

**User Story:** As a user, I want the `mcp.json` file and the in-memory configuration to stay in sync, so that the file always reflects the current state of my MCP servers.

#### Acceptance Criteria

1. WHEN the application starts, THE MCP_Config_Manager SHALL treat the MCP_Config_File as the source of truth and overwrite any in-memory defaults
2. WHEN any mutation occurs to the MCP server configuration (add, remove, toggle), THE MCP_Config_Manager SHALL write the complete current state to the MCP_Config_File
3. THE MCP_Config_Manager SHALL write the file atomically (write to a temporary file then rename) to prevent corruption from partial writes
