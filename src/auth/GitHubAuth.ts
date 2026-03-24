// src/auth/GitHubAuth.ts
// GitHub Device OAuth Flow — kein Browser-Redirect nötig.
// Nutzt denselben Flow wie GitHub CLI und VS Code Copilot Extension.

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

// Client ID der GitHub Copilot VS Code Extension (öffentlich bekannt)
const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GITHUB_SCOPE = "read:user";

export class GitHubAuth {
  private cachedCopilotToken: CopilotToken | null = null;

  /**
   * Startet den Device OAuth Flow.
   * Gibt user_code und verification_uri zurück, die dem User angezeigt werden.
   */
  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const response = await fetch(
      "https://github.com/login/device/code",
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
   * Pollt auf den GitHub Token, bis der User den Code eingegeben hat oder der Flow abläuft.
   * Gibt den GitHub OAuth Access Token zurück.
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
        "https://github.com/login/oauth/access_token",
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
        throw new Error("Device code expired. Bitte versuche es erneut.");
      }

      if (data.error === "access_denied") {
        throw new Error("Zugriff verweigert. Bitte autorisiere die App auf GitHub.");
      }

      throw new Error(data.error_description || data.error || "Unbekannter Fehler");
    }

    throw new Error("Timeout: Der Device Code ist abgelaufen.");
  }

  /**
   * Tauscht den GitHub OAuth Token gegen einen kurzlebigen Copilot API Token.
   * Copilot Tokens laufen nach ~30 Minuten ab und werden automatisch erneuert.
   */
  async getCopilotToken(githubToken: string): Promise<string> {
    // Cache prüfen
    if (this.cachedCopilotToken) {
      const expiresAt = new Date(this.cachedCopilotToken.expires_at).getTime();
      const refreshIn = this.cachedCopilotToken.refresh_in * 1000;
      if (Date.now() < expiresAt - refreshIn) {
        return this.cachedCopilotToken.token;
      }
    }

    const response = await fetch(
      "https://api.github.com/copilot_internal/v2/token",
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
      throw new Error("GitHub Token ungültig oder abgelaufen. Bitte neu anmelden.");
    }

    if (!response.ok) {
      throw new Error(`Copilot Token Anfrage fehlgeschlagen: ${response.status}`);
    }

    const data: CopilotToken = await response.json();
    this.cachedCopilotToken = data;
    return data.token;
  }

  /**
   * Prüft ob ein GitHub Token noch gültig ist (hat der User Copilot-Zugang?).
   */
  async validateGitHubToken(token: string): Promise<{ valid: boolean; login?: string }> {
    try {
      const response = await fetch("https://api.github.com/user", {
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
