# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install       # Install dependencies
npm run build     # Build plugin (requires Node.js 18+)
```

No test or lint scripts are defined. After building, copy the plugin directory into an Obsidian vault:

```bash
cp -r . /path/to/vault/.obsidian/plugins/obsidian-copilot-chat/
```

## Architecture

This is an Obsidian plugin that integrates GitHub Copilot Chat into the Obsidian sidebar. The plugin is desktop-only and uses the GitHub Copilot internal API.

### Component Map

| File | Role |
|------|------|
| `main.ts` | Plugin entry point — registers sidebar view, editor commands, settings tab; owns plugin state |
| `src/auth/GitHubAuth.ts` | GitHub Device OAuth flow + Copilot token exchange and caching |
| `src/api/CopilotClient.ts` | OpenAI-compatible HTTP client for `api.githubcopilot.com` with SSE streaming |
| `src/views/ChatView.ts` | Obsidian `ItemView` sidebar — full chat UI, message history, document context |
| `src/settings/SettingsTab.ts` | Settings UI and login flow UI |
| `styles.css` | CSS with variables for dark/light mode support |

### Authentication Flow

The plugin uses GitHub Device OAuth (same flow as GitHub CLI and VS Code extension):

1. `GitHubAuth.requestDeviceCode()` → `github.com/login/device/code`
2. User visits `github.com/login/device` and enters the displayed code
3. `GitHubAuth.pollForToken()` polls `github.com/login/oauth/access_token` until authorized
4. GitHub token is stored persistently in Obsidian's `data.json`
5. `GitHubAuth.getCopilotToken()` exchanges the GitHub token for a short-lived Copilot API token (~30 min) via `api.github.com/copilot_internal/v2/token` — cached in memory, auto-refreshed

The Client ID `Iv1.b507a08c87ecfe98` is the public VS Code Copilot extension OAuth app.

### Chat Flow

1. `CopilotChatView` builds a system prompt (Copilot role definition + optional active document content, truncated to `maxContextChars`)
2. The last 10 messages of history are sent with each request
3. `CopilotClient.stream()` sends to `api.githubcopilot.com/chat/completions` and fires a chunk callback per SSE token
4. Chunks are rendered to the DOM in real-time; the full response is stored in message history

### Document Editing Commands

Three editor commands are registered in `main.ts`:
- **Explain selection** — sends selected text to chat with an explain prompt
- **Improve selection** — sends selected text to chat with an improve prompt, replaces selection on response
- **Summarize document** — sends full document content with a summarize prompt

All three commands open/activate the chat view and pre-fill the input.

### Settings

```typescript
interface CopilotChatSettings {
  githubToken: string;           // Persistent OAuth token
  githubLogin: string;           // Display username
  model: string;                 // Default: "gpt-4o"
  includeActiveDocument: boolean; // Default: true
  maxContextChars: number;       // Default: 20000
}
```

Available models: `gpt-4o`, `gpt-4o-mini`, `gpt-4`, `claude-3.5-sonnet` (availability depends on Copilot plan).
