// src/views/ChatView.ts
// Main view: sidebar chat panel with streaming, document actions, and vault context.

import {
  ItemView,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { CopilotClient, type ChatMessage } from "../api/CopilotClient";
import type CopilotChatPlugin from "../../main";

export const VIEW_TYPE_COPILOT_CHAT = "copilot-chat-view";

export class CopilotChatView extends ItemView {
  private plugin: CopilotChatPlugin;
  private client: CopilotClient;
  private messages: ChatMessage[] = [];
  private isStreaming = false;

  // DOM elements
  private messagesContainer: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private statusBar: HTMLElement;
  private contextToggle: HTMLInputElement;
  private contextLabel: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: CopilotChatPlugin, client: CopilotClient) {
    super(leaf);
    this.plugin = plugin;
    this.client = client;
  }

  getViewType(): string {
    return VIEW_TYPE_COPILOT_CHAT;
  }

  getDisplayText(): string {
    return "Copilot Chat";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen() {
    this.buildUI();
    this.updateStatus("Ready");
  }

  async onClose() {}

  // ── UI Build ──────────────────────────────────────────────────────────────

  private buildUI() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("copilot-chat-view");

    // Header
    const header = contentEl.createDiv({ cls: "copilot-header" });
    const titleWrap = header.createDiv({ cls: "copilot-title-wrap" });
    const iconEl = titleWrap.createSpan({ cls: "copilot-icon" });
    setIcon(iconEl, "bot");
    titleWrap.createSpan({ text: "Copilot Chat", cls: "copilot-title" });

    const headerActions = header.createDiv({ cls: "copilot-header-actions" });

    // Clear button
    const clearBtn = headerActions.createEl("button", { cls: "copilot-btn-icon", title: "Clear history" });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => this.clearChat());

    // Create new note from response
    const newDocBtn = headerActions.createEl("button", { cls: "copilot-btn-icon", title: "Save response as new note" });
    setIcon(newDocBtn, "file-plus");
    newDocBtn.addEventListener("click", () => this.createNoteFromLastResponse());

    // ── Context toggle ──
    const contextBar = contentEl.createDiv({ cls: "copilot-context-bar" });
    this.contextToggle = contextBar.createEl("input", { type: "checkbox" });
    this.contextToggle.id = "copilot-ctx-toggle";
    this.contextToggle.checked = this.plugin.settings.includeActiveDocument;
    this.contextToggle.addEventListener("change", () => {
      this.plugin.settings.includeActiveDocument = this.contextToggle.checked;
      this.plugin.saveSettings();
      this.updateContextLabel();
    });

    const ctxLabelEl = contextBar.createEl("label");
    ctxLabelEl.htmlFor = "copilot-ctx-toggle";
    const ctxIcon = ctxLabelEl.createSpan({ cls: "copilot-ctx-icon" });
    setIcon(ctxIcon, "file-text");
    this.contextLabel = ctxLabelEl.createSpan({ cls: "copilot-ctx-text" });
    this.updateContextLabel();

    // ── Messages ──
    this.messagesContainer = contentEl.createDiv({ cls: "copilot-messages" });
    this.renderWelcome();

    // ── Input area ──
    const inputArea = contentEl.createDiv({ cls: "copilot-input-area" });

    // Action bar above input
    const actionBar = inputArea.createDiv({ cls: "copilot-action-bar" });

    const insertBtn = actionBar.createEl("button", {
      cls: "copilot-action-btn",
      title: "Append last response to end of document",
    });
    setIcon(insertBtn.createSpan(), "arrow-down-to-line");
    insertBtn.createSpan({ text: " Append" });
    insertBtn.addEventListener("click", () => this.appendLastResponseToDocument());

    const replaceBtn = actionBar.createEl("button", {
      cls: "copilot-action-btn",
      title: "Replace selection with last response",
    });
    setIcon(replaceBtn.createSpan(), "replace");
    replaceBtn.createSpan({ text: " Replace" });
    replaceBtn.addEventListener("click", () => this.replaceSelectionWithLastResponse());

    // Textarea + Send
    const inputRow = inputArea.createDiv({ cls: "copilot-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "copilot-input",
      placeholder: "Type a message… (Shift+Enter for new line)",
    });
    this.inputEl.rows = 3;
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    this.inputEl.addEventListener("input", () => this.autoResize());

    this.sendBtn = inputRow.createEl("button", { cls: "copilot-send-btn" });
    setIcon(this.sendBtn, "send");
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    // Status bar
    this.statusBar = contentEl.createDiv({ cls: "copilot-status" });
  }

  private updateContextLabel() {
    const active = this.plugin.settings.includeActiveDocument;
    const file = this.app.workspace.getActiveFile();
    const name = file ? file.basename : "no document open";
    this.contextLabel.setText(active ? `Context: ${name}` : "No context");
    this.contextToggle.checked = active;
  }

  private renderWelcome() {
    const welcome = this.messagesContainer.createDiv({ cls: "copilot-welcome" });
    const iconEl = welcome.createDiv({ cls: "copilot-welcome-icon" });
    setIcon(iconEl, "bot");
    welcome.createEl("p", {
      text: "Hello! I'm GitHub Copilot. How can I help you?",
      cls: "copilot-welcome-text",
    });
    welcome.createEl("p", {
      text: "Enable the context toggle above to include your active document as context.",
      cls: "copilot-welcome-hint",
    });
  }

  // ── Chat Logic ────────────────────────────────────────────────────────────

  private async sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isStreaming) return;

    this.inputEl.value = "";
    this.autoResize();
    this.isStreaming = true;
    this.sendBtn.disabled = true;
    this.sendBtn.classList.add("loading");

    // Remove welcome screen if present
    const welcome = this.messagesContainer.querySelector(".copilot-welcome");
    welcome?.remove();

    // Render user message
    this.renderMessage("user", text);

    // Build context
    const apiMessages = await this.buildApiMessages(text);

    // Prepare assistant bubble
    const assistantBubble = this.renderMessage("assistant", "");
    const contentEl = assistantBubble.querySelector(".copilot-msg-content") as HTMLElement;

    this.updateStatus("Typing…");

    try {
      let fullText = "";
      await this.client.stream(
        apiMessages,
        (chunk) => {
          fullText += chunk;
          contentEl.setText(fullText);
          this.scrollToBottom();
        },
        { model: this.plugin.settings.model }
      );

      // Store last response
      this.messages.push({ role: "assistant", content: fullText });
      this.updateStatus("Ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      contentEl.setText(`Error: ${msg}`);
      contentEl.addClass("copilot-error");
      this.updateStatus("Error");
      new Notice(`Copilot error: ${msg}`);
    } finally {
      this.isStreaming = false;
      this.sendBtn.disabled = false;
      this.sendBtn.classList.remove("loading");
      this.scrollToBottom();
    }
  }

  private async buildApiMessages(userText: string): Promise<ChatMessage[]> {
    const systemParts: string[] = [
      "You are GitHub Copilot, a helpful AI assistant.",
      "You help with writing, editing, and structuring Markdown documents in Obsidian.",
      "Answer precisely and use Markdown formatting where appropriate.",
    ];

    // Include active document as context
    if (this.plugin.settings.includeActiveDocument) {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile instanceof TFile) {
        const content = await this.app.vault.read(activeFile);
        const truncated = this.truncate(content, this.plugin.settings.maxContextChars);
        systemParts.push(
          `\n## Active document: "${activeFile.basename}"\n\n${truncated}`
        );
      }
    }

    const systemMessage: ChatMessage = {
      role: "system",
      content: systemParts.join("\n"),
    };

    // Last N messages from history (excluding system)
    const historyLimit = 10;
    const history = this.messages.slice(-historyLimit);

    this.messages.push({ role: "user", content: userText });

    return [systemMessage, ...history, { role: "user", content: userText }];
  }

  // ── Document actions ───────────────────────────────────────────────────

  private getLastAssistantText(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i]?.role === "assistant") {
        return this.messages[i]?.content ?? null;
      }
    }
    return null;
  }

  private async appendLastResponseToDocument() {
    const text = this.getLastAssistantText();
    if (!text) {
      new Notice("No Copilot response available yet.");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active document open.");
      return;
    }
    const current = await this.app.vault.read(file);
    await this.app.vault.modify(file, current + "\n\n" + text);
    new Notice(`Response appended to "${file.basename}".`);
  }

  private async replaceSelectionWithLastResponse() {
    const text = this.getLastAssistantText();
    if (!text) {
      new Notice("No Copilot response available yet.");
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("No active Markdown document.");
      return;
    }
    const editor = view.editor;
    const selection = editor.getSelection();
    if (!selection) {
      new Notice("No text selected.");
      return;
    }
    editor.replaceSelection(text);
    new Notice("Selection replaced.");
  }

  async createNoteFromLastResponse() {
    const text = this.getLastAssistantText();
    if (!text) {
      new Notice("No Copilot response available yet.");
      return;
    }
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const filename = `Copilot - ${timestamp}.md`;
    try {
      const file = await this.app.vault.create(filename, text);
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`New note created: ${filename}`);
    } catch (err) {
      new Notice(`Error creating note: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Rendering helpers ──────────────────────────────────────────────────

  private renderMessage(role: "user" | "assistant", text: string): HTMLElement {
    const wrapper = this.messagesContainer.createDiv({
      cls: `copilot-msg copilot-msg-${role}`,
    });

    const avatar = wrapper.createDiv({ cls: "copilot-msg-avatar" });
    setIcon(avatar, role === "user" ? "user" : "bot");

    const bubble = wrapper.createDiv({ cls: "copilot-msg-bubble" });
    bubble.createDiv({ text, cls: "copilot-msg-content" });

    if (role === "assistant" && text === "") {
      // Typing indicator
      const typing = bubble.createDiv({ cls: "copilot-typing" });
      typing.createSpan();
      typing.createSpan();
      typing.createSpan();
    }

    this.scrollToBottom();
    return wrapper;
  }

  private clearChat() {
    this.messages = [];
    this.messagesContainer.empty();
    this.renderWelcome();
    this.updateStatus("Ready");
  }

  private updateStatus(text: string) {
    this.statusBar.setText(text);
  }

  private scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private autoResize() {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + "px";
  }

  private truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n\n[… document truncated]";
  }
}
