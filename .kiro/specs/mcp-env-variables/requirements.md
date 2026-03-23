# Requirements Document

## Introduction

Add environment variable support to the MCP server configuration in Marginalia. MCP servers often require API keys and other secrets passed as environment variables when spawning via stdio transport (e.g., `BRAVE_API_KEY` for the Brave Search MCP server). The backend model (`MCPServerConfig.env`) and process spawning logic already support an `env` field, but the settings UI provides no way to input, view, or manage environment variables. This feature closes that gap by adding a key-value editor to the MCP server settings form and displaying configured env vars in the server list.

## Glossary

- **Settings_Dialog**: The modal dialog in the frontend (`#settings-dialog`) where users configure system prompt, skill files, and MCP servers
- **MCP_Server_Form**: The add-form within the Settings_Dialog for creating new MCP server configurations (name, command, args, and now env)
- **MCP_Server_List**: The `<ul>` element (`#mcp-server-list`) that displays configured MCP servers with their details
- **Env_Editor**: A dynamic key-value input widget within the MCP_Server_Form that allows users to add, remove, and edit environment variable entries
- **Backend_API**: The Express 5 REST API serving MCP server configuration endpoints (`POST /api/settings/mcp-servers`, `GET /api/settings`)
- **StdioTransport**: The `StdioClientTransport` from `@modelcontextprotocol/sdk` that spawns MCP server processes, accepting an `env` option

## Requirements

### Requirement 1: Environment Variable Input in MCP Server Form

**User Story:** As a user, I want to enter environment variables as key-value pairs when adding an MCP server, so that the server process receives the required configuration (e.g., API keys).

#### Acceptance Criteria

1. THE Env_Editor SHALL display an "Add Environment Variable" button below the args input in the MCP_Server_Form
2. WHEN the user clicks "Add Environment Variable", THE Env_Editor SHALL append a new row containing a key input field and a value input field
3. THE Env_Editor SHALL display a remove button on each environment variable row
4. WHEN the user clicks the remove button on an environment variable row, THE Env_Editor SHALL remove that row from the form
5. WHEN the user submits the MCP_Server_Form, THE MCP_Server_Form SHALL collect all non-empty key-value pairs from the Env_Editor into an object and include it as the `env` field in the API request body
6. WHEN the user submits the MCP_Server_Form with duplicate environment variable keys, THE MCP_Server_Form SHALL use the last value for each duplicate key
7. WHEN the MCP server is successfully added, THE Env_Editor SHALL clear all environment variable rows

### Requirement 2: Environment Variable Display in Server List

**User Story:** As a user, I want to see how many environment variables are configured for each MCP server in the list, so that I can verify my configuration at a glance.

#### Acceptance Criteria

1. WHEN an MCP server has one or more environment variables configured, THE MCP_Server_List SHALL display the count of environment variables (e.g., "2 env vars") alongside the command and args detail
2. WHEN an MCP server has zero environment variables configured, THE MCP_Server_List SHALL display only the command and args without any env var indicator

### Requirement 3: Backend Validation of Environment Variables

**User Story:** As a developer, I want the backend to validate the env field so that only well-formed string key-value pairs are accepted.

#### Acceptance Criteria

1. WHEN the `env` field is provided in the request body, THE Backend_API SHALL validate that `env` is a plain object (not an array, not null)
2. WHEN the `env` field contains a value that is not a string, THE Backend_API SHALL respond with HTTP 422 and an error message indicating that all env values must be strings
3. WHEN the `env` field contains a key that is an empty string, THE Backend_API SHALL exclude that entry from the stored configuration
4. WHEN the `env` field is omitted from the request body, THE Backend_API SHALL default to an empty object
5. IF the `env` field fails validation, THEN THE Backend_API SHALL respond with HTTP 422 and a descriptive error message without creating the MCP server entry

### Requirement 4: Environment Variables Passed to Stdio Transport

**User Story:** As a user, I want the environment variables I configure to be passed to the MCP server process when it starts, so that the server can access required API keys and configuration.

#### Acceptance Criteria

1. WHEN the MarginaliaAgent configures MCP servers, THE StdioTransport SHALL receive the `env` record from the MCPServerConfig for each server
2. WHEN an MCP server has an empty `env` object, THE StdioTransport SHALL receive `undefined` for the env option (inheriting the parent process environment)
3. THE MarginaliaAgent SHALL pass the env record without modification to the StdioClientTransport constructor

### Requirement 5: Environment Variables Persisted in Settings State

**User Story:** As a user, I want environment variables to be included when settings are loaded, so that the UI reflects the full configuration after a page refresh.

#### Acceptance Criteria

1. WHEN the Settings_Dialog is opened, THE Settings_Dialog SHALL load MCP server configurations including their `env` fields from the `GET /api/settings` endpoint
2. THE MCP_Server_List SHALL render environment variable counts based on the loaded `env` data for each server
