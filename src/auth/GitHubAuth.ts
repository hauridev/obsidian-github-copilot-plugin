// src/auth/GitHubAuth.ts
// GitHub Device OAuth flow — no browser redirect required.
// Uses the same flow as GitHub CLI and the VS Code Copilot extension.

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface CopilotToken {
  token: string;
  expires_at: string;
  refresh_in: number;
}

// Client ID of the GitHub Copilot VS Code extension (publicly known)
const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GITHUB_SCOPE = "read:user";

export class GitHubAuth {
  private cachedCopilotToken: CopilotToken | null = null;
  enterpriseDomain: string;

  constructor(enterpriseDomain: string = "") {
    this.enterpriseDomain = enterpriseDomain;
  }

  /** Base URL for OAuth flows (login/device/code, login/oauth/access_token) */
  private get authBase(): string {
    return this.enterpriseDomain
      ? `https://${this.enterpriseDomain}`
      : "https://github.com";
  }

  /** Base URL for REST API calls */
  private get apiBase(): string {
    return this.enterpriseDomain
      ? `https://api.${this.enterpriseDomain}`
      : "https://api.github.com";
  }

  /**
   * Starts the Device OAuth flow.
   * Returns user_code and verification_uri to display to the user.
   */
  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const response = await fetch(
      `${this.authBase}/login/device/code`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: GITHUB_SCOPE,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Device code request failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Polls for the GitHub token until the user enters the code or the flow expires.
   * Returns the GitHub OAuth access token.
   */
  async pollForToken(
    deviceCode: string,
    interval: number,
    expiresIn: number,
    onWaiting?: () => void
  ): Promise<string> {
    const deadline = Date.now() + expiresIn * 1000;
    let pollInterval = interval * 1000;

    while (Date.now() < deadline) {
      await this.sleep(pollInterval);

      const response = await fetch(
        `${this.authBase}/login/oauth/access_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        }
      );

      const data: TokenResponse = await response.json();

      if (data.access_token) {
        return data.access_token;
      }

      if (data.error === "authorization_pending") {
        onWaiting?.();
        continue;
      }

      if (data.error === "slow_down") {
        pollInterval += 5000;
        onWaiting?.();
        continue;
      }

      if (data.error === "expired_token") {
        throw new Error("Device code expired. Please try again.");
      }

      if (data.error === "access_denied") {
        throw new Error("Access denied. Please authorize the app on GitHub.");
      }

      throw new Error(data.error_description || data.error || "Unknown error");
    }

    throw new Error("Timeout: the device code has expired.");
  }

  /**
   * Exchanges the GitHub OAuth token for a short-lived Copilot API token.
   * Copilot tokens expire after ~30 minutes and are automatically refreshed.
   */
  async getCopilotToken(githubToken: string): Promise<string> {
    // Check cache
    if (this.cachedCopilotToken) {
      const expiresAt = new Date(this.cachedCopilotToken.expires_at).getTime();
      const refreshIn = this.cachedCopilotToken.refresh_in * 1000;
      if (Date.now() < expiresAt - refreshIn) {
        return this.cachedCopilotToken.token;
      }
    }

    const response = await fetch(
      `${this.apiBase}/copilot_internal/v2/token`,
      {
        headers: {
          Authorization: `token ${githubToken}`,
          "Editor-Version": "vscode/1.90.0",
          "Editor-Plugin-Version": "copilot-chat/0.17.0",
          "User-Agent": "obsidian-copilot-chat/1.0.0",
        },
      }
    );

    if (response.status === 401) {
      throw new Error("GitHub token invalid or expired. Please sign in again.");
    }

    if (!response.ok) {
      throw new Error(`Copilot token request failed: ${response.status}`);
    }

    const data: CopilotToken = await response.json();
    this.cachedCopilotToken = data;
    return data.token;
  }

  /**
   * Checks whether a GitHub token is still valid (does the user have Copilot access?).
   */
  async validateGitHubToken(token: string): Promise<{ valid: boolean; login?: string }> {
    try {
      const response = await fetch(`${this.apiBase}/user`, {
        headers: {
          Authorization: `token ${token}`,
          "User-Agent": "obsidian-copilot-chat/1.0.0",
        },
      });

      if (!response.ok) return { valid: false };

      const user = await response.json();
      return { valid: true, login: user.login };
    } catch {
      return { valid: false };
    }
  }

  clearCache() {
    this.cachedCopilotToken = null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
