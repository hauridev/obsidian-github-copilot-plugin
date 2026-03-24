// src/api/CopilotClient.ts
// OpenAI-compatible client for the GitHub Copilot Chat API with streaming support.

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
   * Sends a chat request and returns the full response.
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
   * Streaming variant: calls onChunk for each received token.
   * Returns the full response when done.
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
      throw new Error("No streaming response received");
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
          // Ignore incomplete JSON chunks
        }
      }
    }

    return fullText;
  }

  /**
   * Returns the models available for the current Copilot subscription.
   */
  async fetchModels(): Promise<{ id: string; name: string }[]> {
    const token = await this.getToken();
    const response = await fetch(`${COPILOT_API_BASE}/models`, {
      headers: this.buildHeaders(token),
    });

    if (!response.ok) return [];

    const data = await response.json();
    const models: { id: string; name?: string }[] = data.data ?? [];
    return models.map((m) => ({ id: m.id, name: m.name ?? m.id }));
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
    let message = `API error: ${response.status}`;
    try {
      const body = await response.json();
      message = body.error?.message ?? message;
    } catch { /* ignore */ }

    if (response.status === 401) {
      throw new Error("Authentication failed. Please sign in again.");
    }
    if (response.status === 403) {
      throw new Error("No Copilot access. Make sure you have an active Copilot subscription.");
    }
    if (response.status === 429) {
      throw new Error("Rate limit reached. Please wait a moment.");
    }
    throw new Error(message);
  }
}
