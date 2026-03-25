// src/views/ChatView.ts
// Main view: sidebar chat panel with document actions, vault context, and conversation history.

import {
  ItemView,
  MarkdownRenderer,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { CopilotClient, type ChatMessage } from "../api/CopilotClient";
import type CopilotChatPlugin from "../../main";
import type { SavedConversation } from "../../main";

export const VIEW_TYPE_COPILOT_CHAT = "copilot-chat-view";

export class CopilotChatView extends ItemView {
  private plugin: CopilotChatPlugin;
  private client: CopilotClient;
  private messages: ChatMessage[] = [];
  private isStreaming = false;
  private currentConversationId = "";

  // DOM elements
  private messagesContainer: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private statusBar: HTMLElement;
  private contextToggle: HTMLInputElement;
  private contextLabel: HTMLElement;
  private conversationSelect: HTMLSelectElement;
  private modelSelectEl: HTMLSelectElement;

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
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.updateContextLabel())
    );
    await this.initConversation();
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
    const clearBtn = headerActions.createEl("button", { cls: "copilot-btn-icon", title: "Clear conversation" });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => this.clearChat());

    // Create new note from response
    const newDocBtn = headerActions.createEl("button", { cls: "copilot-btn-icon", title: "Save response as new note" });
    setIcon(newDocBtn, "file-plus");
    newDocBtn.addEventListener("click", () => this.createNoteFromLastResponse());

    // ── Conversation bar ──
    const convBar = contentEl.createDiv({ cls: "copilot-conv-bar" });
    this.conversationSelect = convBar.createEl("select", { cls: "copilot-conv-select" });
    this.conversationSelect.addEventListener("change", () => {
      this.switchConversation(this.conversationSelect.value);
    });
    const newConvBtn = convBar.createEl("button", { cls: "copilot-btn-icon", title: "New conversation" });
    setIcon(newConvBtn, "plus");
    newConvBtn.addEventListener("click", () => this.createNewConversation());
    const delConvBtn = convBar.createEl("button", { cls: "copilot-btn-icon", title: "Delete conversation" });
    setIcon(delConvBtn, "trash-2");
    delConvBtn.addEventListener("click", () => this.deleteCurrentConversation());

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
      title: "Replace document content with last response",
    });
    setIcon(replaceBtn.createSpan(), "replace");
    replaceBtn.createSpan({ text: " Replace" });
    replaceBtn.addEventListener("click", () => this.replaceDocumentWithLastResponse());

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

    // Footer: model selector + status
    const footerBar = inputArea.createDiv({ cls: "copilot-footer-bar" });
    this.modelSelectEl = footerBar.createEl("select", { cls: "copilot-model-select" });
    this.refreshModelSelect();
    this.modelSelectEl.addEventListener("change", async () => {
      this.plugin.settings.model = this.modelSelectEl.value;
      await this.plugin.saveSettings();
    });
    this.statusBar = footerBar.createDiv({ cls: "copilot-status" });
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
      text: "Use [[note name]] to include vault notes as context.",
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

    // Prepare assistant bubble with typing indicator
    const assistantBubble = this.renderMessage("assistant", "", true);
    const contentEl = assistantBubble.querySelector(".copilot-msg-content") as HTMLElement;

    this.updateStatus("Thinking…");

    try {
      let fullText = "";
      await this.client.stream(
        apiMessages,
        (chunk) => {
          fullText += chunk;
          this.scrollToBottom();
        },
        { model: this.plugin.settings.model }
      );

      // Render the full response as markdown
      assistantBubble.querySelector(".copilot-typing")?.remove();
      contentEl.empty();
      const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
      await MarkdownRenderer.render(this.app, fullText, contentEl, sourcePath, this);

      // Store and persist
      this.messages.push({ role: "assistant", content: fullText });
      await this.saveCurrentConversation();
      this.updateStatus("Ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      contentEl.setText(`Error: ${msg}`);
      contentEl.addClass("copilot-error");
      this.updateStatus("Error");
      new Notice(`Copilot error: ${msg}`);
    } finally {
      assistantBubble.querySelector(".copilot-typing")?.remove();
      this.isStreaming = false;
      this.sendBtn.disabled = false;
      this.sendBtn.classList.remove("loading");
      this.scrollToBottom();
    }
  }

  private async buildApiMessages(userText: string): Promise<ChatMessage[]> {
    const defaultPrompt = [
      "You are GitHub Copilot, a helpful AI assistant.",
      "You help with writing, editing, and structuring Markdown documents in Obsidian.",
      "Answer precisely and use Markdown formatting where appropriate.",
      "When you provide a full document or a complete replacement for the active document, wrap the ENTIRE document content in a SINGLE ```markdown code fence. Do not split the document across multiple code fences.",
    ].join("\n");

    const systemContent = this.plugin.settings.customSystemPrompt?.trim() || defaultPrompt;
    const systemParts: string[] = [systemContent];

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

    // Inject [[wikilink]] note content
    const wikilinkContexts = await this.resolveWikilinks(userText);
    systemParts.push(...wikilinkContexts);

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

  private async resolveWikilinks(text: string): Promise<string[]> {
    const matches = [...text.matchAll(/\[\[([^\]]+)\]\]/g)];
    const contexts: string[] = [];
    const seen = new Set<string>();
    for (const match of matches) {
      const noteName = ((match[1] ?? "").split("|")[0] ?? "").trim();
      if (!noteName || seen.has(noteName)) continue;
      seen.add(noteName);
      const file = this.app.metadataCache.getFirstLinkpathDest(noteName, "");
      if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        contexts.push(
          `\n## Linked note: "${file.basename}"\n\n${this.truncate(content, this.plugin.settings.maxContextChars)}`
        );
      }
    }
    return contexts;
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

  private async replaceDocumentWithLastResponse() {
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
    // Extract content from the outer ```markdown fence (greedy — handles inner code fences)
    const fenceMatch = text.match(/```markdown\n([\s\S]*)```/);
    const content = fenceMatch?.[1] ?? text;
    await this.app.vault.modify(file, content);
    new Notice(`Document "${file.basename}" replaced with Copilot response.`);
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

  private renderMessage(role: "user" | "assistant", text: string, typing = false): HTMLElement {
    const wrapper = this.messagesContainer.createDiv({
      cls: `copilot-msg copilot-msg-${role}`,
    });

    const avatar = wrapper.createDiv({ cls: "copilot-msg-avatar" });
    setIcon(avatar, role === "user" ? "user" : "bot");

    const bubble = wrapper.createDiv({ cls: "copilot-msg-bubble" });
    const contentDiv = bubble.createDiv({ cls: "copilot-msg-content" });
    if (text) contentDiv.setText(text);

    if (typing) {
      const typingEl = bubble.createDiv({ cls: "copilot-typing" });
      typingEl.createSpan();
      typingEl.createSpan();
      typingEl.createSpan();
    }

    this.scrollToBottom();
    return wrapper;
  }

  private clearChat() {
    this.messages = [];
    this.messagesContainer.empty();
    this.renderWelcome();
    const conv = this.plugin.settings.savedConversations.find(c => c.id === this.currentConversationId);
    if (conv) { conv.messages = []; this.plugin.saveSettings(); }
    this.updateStatus("Ready");
  }

  // ── Conversation management ───────────────────────────────────────────

  private async initConversation() {
    const conv = this.plugin.settings.savedConversations.find(
      c => c.id === this.plugin.settings.activeConversationId
    );
    if (conv) {
      this.currentConversationId = conv.id;
      this.messages = [...conv.messages];
      this.refreshConversationSelect();
      if (this.messages.length > 0) {
        await this.renderLoadedMessages();
      } else {
        this.messagesContainer.empty();
        this.renderWelcome();
      }
    } else {
      this.createNewConversation();
    }
  }

  private createNewConversation() {
    const id = crypto.randomUUID();
    const timestamp = new Date().toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const conv: SavedConversation = {
      id,
      name: timestamp,
      messages: [],
      createdAt: Date.now(),
    };
    this.plugin.settings.savedConversations.push(conv);
    this.plugin.settings.activeConversationId = id;
    this.plugin.saveSettings();
    this.currentConversationId = id;
    this.messages = [];
    this.messagesContainer.empty();
    this.renderWelcome();
    this.refreshConversationSelect();
  }

  private async switchConversation(id: string) {
    if (id === this.currentConversationId) return;
    const conv = this.plugin.settings.savedConversations.find(c => c.id === id);
    if (!conv) return;
    this.plugin.settings.activeConversationId = id;
    await this.plugin.saveSettings();
    this.currentConversationId = id;
    this.messages = [...conv.messages];
    this.messagesContainer.empty();
    if (this.messages.length > 0) {
      await this.renderLoadedMessages();
    } else {
      this.renderWelcome();
    }
  }

  private async saveCurrentConversation() {
    const conv = this.plugin.settings.savedConversations.find(c => c.id === this.currentConversationId);
    if (!conv) return;
    // Auto-name from first user message if the name still looks like a timestamp (no custom name set)
    const firstUser = this.messages.find(m => m.role === "user");
    if (firstUser && conv.messages.length === 0) {
      // Only rename on the very first save (messages was empty before this response)
      conv.name = firstUser.content.slice(0, 45).replace(/\n/g, " ")
        + (firstUser.content.length > 45 ? "…" : "");
    }
    conv.messages = [...this.messages];
    await this.plugin.saveSettings();
    this.refreshConversationSelect();
  }

  private async deleteCurrentConversation() {
    const idx = this.plugin.settings.savedConversations.findIndex(c => c.id === this.currentConversationId);
    if (idx !== -1) this.plugin.settings.savedConversations.splice(idx, 1);

    // Switch to an adjacent conversation if one exists, otherwise create a fresh one
    const remaining = this.plugin.settings.savedConversations;
    if (remaining.length > 0) {
      const next = remaining[Math.min(idx, remaining.length - 1)];
      if (next) {
        await this.switchConversation(next.id);
        return;
      }
    }
    this.createNewConversation();
  }

  private refreshConversationSelect() {
    if (!this.conversationSelect) return;
    this.conversationSelect.innerHTML = "";
    for (const conv of this.plugin.settings.savedConversations) {
      const opt = document.createElement("option");
      opt.value = conv.id;
      opt.text = conv.name;
      opt.selected = conv.id === this.currentConversationId;
      this.conversationSelect.appendChild(opt);
    }
  }

  private refreshModelSelect() {
    if (!this.modelSelectEl) return;
    const fallback = [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    ];
    const models = this.plugin.settings.availableModels.length > 0
      ? this.plugin.settings.availableModels : fallback;
    this.modelSelectEl.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.text = m.name;
      opt.selected = m.id === this.plugin.settings.model;
      this.modelSelectEl.appendChild(opt);
    }
  }

  private async renderLoadedMessages() {
    this.messagesContainer.empty();
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
    for (const msg of this.messages) {
      if (msg.role === "system") continue;
      const wrapper = this.renderMessage(msg.role, "");
      const contentEl = wrapper.querySelector(".copilot-msg-content") as HTMLElement;
      if (msg.role === "assistant") {
        await MarkdownRenderer.render(this.app, msg.content, contentEl, sourcePath, this);
      } else {
        contentEl.setText(msg.content);
      }
    }
    this.scrollToBottom();
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
