# GitHub Copilot Chat for Obsidian

Chat with GitHub Copilot directly in Obsidian — with OAuth login, real-time streaming responses, document editing, and vault context.

## Features

- **Sidebar Chat** — persistent chat history in the right sidebar
- **GitHub OAuth** — secure Device Flow login (no redirect, no API key required)
- **GitHub Enterprise support** — authenticate against any `*.ghe.com` domain
- **Responses** — full response rendered at once after the API call completes
- **Subscription-based model list** — available models are fetched from the Copilot API and reflect your plan
- **Active Document as Context** — Copilot sees the content of your currently open note
- **Document Actions:**
  - **Append** the last response to the document
  - **Replace selection** with Copilot's response
  - **Save** response as a new note
- **Editor Commands:**
  - `Explain selection`
  - `Improve selection`
  - `Summarize current document`

## Requirements

- An active [GitHub Copilot](https://github.com/features/copilot) subscription (Individual, Business, or Enterprise)
- Obsidian 1.4.0+
- Node.js 18+ (build only)
- Desktop only (mobile is not supported)

## Installation

### Manual (Development Build)

```bash
# 1. Clone the repository
git clone https://github.com/hauridev/obsidian-github-copilot-plugin.git
cd obsidian-github-copilot-plugin

# 2. Install dependencies
npm install

# 3. Build the plugin
npm run build

# 4. Copy the required files into your vault
mkdir -p /path/to/vault/.obsidian/plugins/obsidian-copilot-chat/
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/obsidian-copilot-chat/
```

Then in Obsidian: **Settings → Community Plugins → Installed Plugins** → enable "GitHub Copilot Chat".

## Login

### GitHub.com

1. Open **Settings → GitHub Copilot Chat**
2. Click **"Sign in"**
3. Visit the displayed URL (`https://github.com/login/device`) and enter the code
4. The plugin detects the confirmation automatically — you're done

### GitHub Enterprise (`*.ghe.com`)

1. Open **Settings → GitHub Copilot Chat**
2. Under **GitHub Enterprise**, enter your domain (e.g. `mycompany.ghe.com`)
3. Click **"Sign in"** and follow the same device flow — OAuth and API calls are routed through your enterprise domain automatically

The GitHub OAuth token is stored securely in Obsidian's plugin data (`data.json`). Copilot API tokens (short-lived, ~30 min) are held in memory and refreshed automatically. Changing the enterprise domain clears the stored token and requires re-authentication.

## Models

After signing in, click **"Load models"** in the Model section of the settings to fetch the models available for your Copilot subscription. The list is cached and updated on each login or manual refresh.

If no models have been fetched yet, the following defaults are shown as a fallback:

| Model | Notes |
|-------|-------|
| `gpt-4o` | Default, recommended |
| `gpt-4o-mini` | Faster, lighter |
| `gpt-4` | — |
| `claude-3.5-sonnet` | — |

Actual availability depends on your Copilot plan.

## How the OAuth Flow Works

This plugin uses the same Device Flow as GitHub CLI and the VS Code Copilot extension:

1. Plugin requests a device code from `{host}/login/device/code`
2. User visits `{host}/login/device` and enters the displayed code
3. Plugin polls `{host}/login/oauth/access_token` until authorized
4. The GitHub token is exchanged for a short-lived Copilot API token via `api.{host}/copilot_internal/v2/token`
5. The Copilot token's `endpoints.api` field determines the API base URL (e.g. `https://api.githubcopilot.com`) — this ensures enterprise tenants are routed to the correct endpoint
6. All API requests use Obsidian's built-in `requestUrl` instead of `fetch`, which is required for the plugin to work on desktop

`{host}` is `github.com` by default, or your configured enterprise domain (e.g. `mycompany.ghe.com`).

The Client ID `Iv1.b507a08c87ecfe98` is the public VS Code Copilot extension OAuth app, the same one used by community tools for Neovim, Emacs, and JetBrains.

## Architecture

```
main.ts                      # Plugin entry — registers sidebar view, commands, settings tab
src/
  auth/GitHubAuth.ts         # Device OAuth flow + Copilot token exchange and caching
  api/CopilotClient.ts       # OpenAI-compatible HTTP client using Obsidian's requestUrl
  views/ChatView.ts          # Obsidian ItemView sidebar — chat UI and message history
  settings/SettingsTab.ts    # Settings UI and login flow
styles.css                   # CSS with variables for dark/light mode
```

## Disclaimer

This plugin uses the internal Copilot API (`copilot_internal`), which is also used by other community tools (Neovim, Emacs, JetBrains). Use is subject to the [GitHub Copilot Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot).

## Contributing

Contributions are welcome! Please open issues and pull requests on the GitHub repository:

**https://github.com/hauridev/obsidian-github-copilot-plugin**

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

MIT
