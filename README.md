# Marginalia

> NOTE: This is very much a work in progress. Use at your own peril

One of the best things you can do these days with LLMs is bridge that skill gap you always had. Learn, experiment, explore, become better. While, straight up asking a model something is good, I found that I tend to get sidetracked from time to ime. I wanted to have the ability to ask a LLM questions about a part of it's answer without having to scroll all the way down and lose my flow. So, because of this [Kiro](https://kiro.dev) and I built **Marginalia** - get your knowledge on the margins of an answer!

Marginalia is a web-based LLM explainer tool that renders structured explanations as documents and supports inline margin notes for follow-up questions. Select any passage in the explanation, ask a side question, and get an answer in a margin note, all while the LLM maintains full context of every thread.

This all started with this Excalidraw drawing I made:

![Excalidraw drawing](/img/skill_gap.png)

And from there, with some [Strands](https://strandsagents.com/) and a whole lot of TypeScript, it sort of became this freakin' thing! 🥳

![Marginalia UI](/img/marginalia.png)

## Prerequisites

- Node.js 18+
- AWS credentials configured (Bedrock access required)
- A Bedrock-enabled model (defaults to `qwen.qwen3-vl-235b-a22b`)

## Setup

```bash
npm install
```

## Running

```bash
npm start
```

Opens on [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `BEDROCK_MODEL_ID` | `qwen.qwen3-vl-235b-a22b` | Bedrock model to use |

If you want to start it with a different model you can do:
```bash
BEDROCK_MODEL_ID="moonshotai.kimi-k2.5" npm start
```

### Development Mode

```bash
npm run dev
```

Uses `tsx watch` for auto-reload on file changes.

## Tests

```bash
npm test
```

Runs 180 tests (property-based + unit) (thank you Kiro ❤️) via Vitest across models, context assembly, conversation ops, validation, agent, retry, SSE, routes, layout, markdown rendering, and MCP config management.

## How It Works

1. Type a question in the input bar at the top
2. The LLM streams a markdown-rendered explanation into the main panel
3. Select any text in the explanation > a popover appears > ask a side question
4. The answer appears as a margin note anchored to your selection with some SVG lines
5. Each margin note supports follow-up questions within its own thread
6. Continue the main conversation below, the **LLM sees all margin note context**

## Stack

- TypeScript / Express backend
- Strands Agents SDK for Bedrock integration
- SSE streaming for real-time responses
- Vanilla HTML/JS frontend (no build step)
- marked.js, highlight.js, tippy.js (this one caused me troubl), DOMPurify via CDN
- CSS Custom Highlight API for text anchoring
- MCP tool integration via settings UI with persistent config (`./data/mcp.json`)

## MCP Server Configuration

MCP servers can be configured through the settings UI or by editing `./data/mcp.json` directly. The file follows the VS Code/Cursor/Kiro convention:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": { "API_KEY": "..." },
      "enabled": true
    }
  }
}
```

Servers can be enabled/disabled individually without removing them. Config is loaded on startup and saved automatically on every change.

## TODO
- [ ] Add support to other model providers
- [ ] Improve stability (yeah)
- [ ] The SVG lines get messed all the time up until you scroll
- [ ] Dark mode
- [ ] Make the SVG lines smoother
