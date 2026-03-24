// src/api/CopilotClient.ts
// OpenAI-kompatibler Client für die GitHub Copilot Chat API mit Streaming-Support.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

const COPILOT_API_BASE = "https://api.githubcopilot.com";

export class CopilotClient {
  constructor(
    private getToken: () => Promise<string>,
    private defaultModel: string = "gpt-4o"
  ) {}

  /**
   * Sendet eine Chat-Anfrage und gibt die vollständige Antwort zurück.
   */
  async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {}
  ): Promise<string> {
    const token = await this.getToken();
    const model = options.model ?? this.defaultModel;

    const response = await fetch(`${COPILOT_API_BASE}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(token),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.1,
        stream: false,
      }),
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  /**
   * Streaming-Variante: ruft onChunk für jedes empfangene Token auf.
   * Gibt die vollständige Antwort zurück wenn fertig.
   */
  async stream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    options: CompletionOptions = {}
  ): Promise<string> {
    const token = await this.getToken();
    const model = options.model ?? this.defaultModel;

    const response = await fetch(`${COPILOT_API_BASE}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(token),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.1,
        stream: true,
        n: 1,
      }),
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    if (!response.body) {
      throw new Error("Keine Streaming-Antwort erhalten");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
        } catch {
          // Unvollständige JSON-Chunks ignorieren
        }
      }
    }

    return fullText;
  }

  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Editor-Version": "vscode/1.90.0",
      "Editor-Plugin-Version": "copilot-chat/0.17.0",
      "Openai-Intent": "conversation-panel",
      "User-Agent": "obsidian-copilot-chat/1.0.0",
      "X-Request-Id": crypto.randomUUID(),
    };
  }

  private async handleError(response: Response): Promise<never> {
    let message = `API Fehler: ${response.status}`;
    try {
      const body = await response.json();
      message = body.error?.message ?? message;
    } catch { /* ignore */ }

    if (response.status === 401) {
      throw new Error("Authentifizierung fehlgeschlagen. Bitte neu anmelden.");
    }
    if (response.status === 403) {
      throw new Error("Kein Copilot-Zugang. Stelle sicher, dass du ein aktives Copilot-Abo hast.");
    }
    if (response.status === 429) {
      throw new Error("Rate Limit erreicht. Bitte kurz warten.");
    }
    throw new Error(message);
  }
}
