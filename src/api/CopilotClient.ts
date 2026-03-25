// src/api/CopilotClient.ts
// OpenAI-compatible client for the GitHub Copilot Chat API with streaming support.
import { requestUrl } from "obsidian";

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

const DEFAULT_COPILOT_API_BASE = "https://api.githubcopilot.com";

export class CopilotClient {
  constructor(
    private getToken: () => Promise<string>,
    private getApiBase: () => string = () => DEFAULT_COPILOT_API_BASE,
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

    const response = await requestUrl({
      url: `${this.getApiBase()}/chat/completions`,
      method: "POST",
      headers: this.buildHeaders(token),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.1,
        stream: false,
      }),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      this.handleError(response.status, response.json);
    }

    return response.json?.choices?.[0]?.message?.content ?? "";
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

    const response = await requestUrl({
      url: `${this.getApiBase()}/chat/completions`,
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
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      let body: unknown;
      try { body = JSON.parse(response.text); } catch { body = {}; }
      this.handleError(response.status, body);
    }

    const lines = response.text.split("\n");
    let fullText = "";

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
        // Ignore malformed SSE lines
      }
    }

    return fullText;
  }

  /**
   * Returns the models available for the current Copilot subscription.
   */
  async fetchModels(): Promise<{ id: string; name: string }[]> {
    const token = await this.getToken();
    const response = await requestUrl({
      url: `${this.getApiBase()}/models`,
      headers: this.buildHeaders(token),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) return [];

    const models: { id: string; name?: string }[] = response.json?.data ?? [];
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

  private handleError(status: number, body?: any): never {
    let message = `API error: ${status}`;
    if (body?.error?.message) {
      message = body.error.message;
    }

    if (status === 401) {
      throw new Error("Authentication failed. Please sign in again.");
    }
    if (status === 403) {
      throw new Error("No Copilot access. Make sure you have an active Copilot subscription.");
    }
    if (status === 429) {
      throw new Error("Rate limit reached. Please wait a moment.");
    }
    throw new Error(message);
  }
}
