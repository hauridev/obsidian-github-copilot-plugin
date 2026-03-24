// src/views/ChatView.ts
// Hauptansicht: Sidebar Chat Panel mit Streaming, Dokument-Aktionen und Vault-Kontext.

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

  // DOM-Elemente
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
    this.updateStatus("Bereit");
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

    // Clear-Button
    const clearBtn = headerActions.createEl("button", { cls: "copilot-btn-icon", title: "Verlauf löschen" });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => this.clearChat());

    // Neues Dokument erstellen
    const newDocBtn = headerActions.createEl("button", { cls: "copilot-btn-icon", title: "Antwort als neue Notiz" });
    setIcon(newDocBtn, "file-plus");
    newDocBtn.addEventListener("click", () => this.createNoteFromLastResponse());

    // ── Kontext-Toggle ──
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

    // ── Nachrichten ──
    this.messagesContainer = contentEl.createDiv({ cls: "copilot-messages" });
    this.renderWelcome();

    // ── Input-Bereich ──
    const inputArea = contentEl.createDiv({ cls: "copilot-input-area" });

    // Aktionen über dem Input
    const actionBar = inputArea.createDiv({ cls: "copilot-action-bar" });

    const insertBtn = actionBar.createEl("button", {
      cls: "copilot-action-btn",
      title: "Letzte Antwort ans Dokument-Ende anfügen",
    });
    setIcon(insertBtn.createSpan(), "arrow-down-to-line");
    insertBtn.createSpan({ text: " Anfügen" });
    insertBtn.addEventListener("click", () => this.appendLastResponseToDocument());

    const replaceBtn = actionBar.createEl("button", {
      cls: "copilot-action-btn",
      title: "Auswahl mit letzter Antwort ersetzen",
    });
    setIcon(replaceBtn.createSpan(), "replace");
    replaceBtn.createSpan({ text: " Ersetzen" });
    replaceBtn.addEventListener("click", () => this.replaceSelectionWithLastResponse());

    // Textarea + Send
    const inputRow = inputArea.createDiv({ cls: "copilot-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "copilot-input",
      placeholder: "Nachricht eingeben… (Shift+Enter für Zeilenumbruch)",
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

    // Status
    this.statusBar = contentEl.createDiv({ cls: "copilot-status" });
  }

  private updateContextLabel() {
    const active = this.plugin.settings.includeActiveDocument;
    const file = this.app.workspace.getActiveFile();
    const name = file ? file.basename : "kein Dokument geöffnet";
    this.contextLabel.setText(active ? `Kontext: ${name}` : "Kein Kontext");
    this.contextToggle.checked = active;
  }

  private renderWelcome() {
    const welcome = this.messagesContainer.createDiv({ cls: "copilot-welcome" });
    const iconEl = welcome.createDiv({ cls: "copilot-welcome-icon" });
    setIcon(iconEl, "bot");
    welcome.createEl("p", {
      text: "Hallo! Ich bin GitHub Copilot. Wie kann ich dir helfen?",
      cls: "copilot-welcome-text",
    });
    welcome.createEl("p", {
      text: "Aktiviere den Kontext-Toggle oben, um dein aktuelles Dokument als Kontext einzubinden.",
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

    // Ggf. Welcome-Screen entfernen
    const welcome = this.messagesContainer.querySelector(".copilot-welcome");
    welcome?.remove();

    // User-Nachricht anzeigen
    this.renderMessage("user", text);

    // Context aufbauen
    const apiMessages = await this.buildApiMessages(text);

    // Assistenten-Bubble vorbereiten
    const assistantBubble = this.renderMessage("assistant", "");
    const contentEl = assistantBubble.querySelector(".copilot-msg-content") as HTMLElement;

    this.updateStatus("Schreibe…");

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

      // Letzte Antwort speichern
      this.messages.push({ role: "assistant", content: fullText });
      this.updateStatus("Bereit");
    } catch (err) {
      contentEl.setText(`Fehler: ${err.message}`);
      contentEl.addClass("copilot-error");
      this.updateStatus("Fehler");
      new Notice(`Copilot Fehler: ${err.message}`);
    } finally {
      this.isStreaming = false;
      this.sendBtn.disabled = false;
      this.sendBtn.classList.remove("loading");
      this.scrollToBottom();
    }
  }

  private async buildApiMessages(userText: string): Promise<ChatMessage[]> {
    const systemParts: string[] = [
      "Du bist GitHub Copilot, ein hilfreicher KI-Assistent.",
      "Du hilfst beim Schreiben, Bearbeiten und Strukturieren von Markdown-Dokumenten in Obsidian.",
      "Antworte präzise und nutze Markdown-Formatierung wo sinnvoll.",
    ];

    // Aktives Dokument als Kontext
    if (this.plugin.settings.includeActiveDocument) {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile instanceof TFile) {
        const content = await this.app.vault.read(activeFile);
        const truncated = this.truncate(content, this.plugin.settings.maxContextChars);
        systemParts.push(
          `\n## Aktuelles Dokument: "${activeFile.basename}"\n\n${truncated}`
        );
      }
    }

    const systemMessage: ChatMessage = {
      role: "system",
      content: systemParts.join("\n"),
    };

    // Letzten N Nachrichten aus Verlauf (ohne system)
    const historyLimit = 10;
    const history = this.messages.slice(-historyLimit);

    this.messages.push({ role: "user", content: userText });

    return [systemMessage, ...history, { role: "user", content: userText }];
  }

  // ── Dokument-Aktionen ──────────────────────────────────────────────────

  private getLastAssistantText(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") {
        return this.messages[i].content;
      }
    }
    return null;
  }

  private async appendLastResponseToDocument() {
    const text = this.getLastAssistantText();
    if (!text) {
      new Notice("Noch keine Copilot-Antwort vorhanden.");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Kein aktives Dokument geöffnet.");
      return;
    }
    const current = await this.app.vault.read(file);
    await this.app.vault.modify(file, current + "\n\n" + text);
    new Notice(`Antwort an "${file.basename}" angefügt.`);
  }

  private async replaceSelectionWithLastResponse() {
    const text = this.getLastAssistantText();
    if (!text) {
      new Notice("Noch keine Copilot-Antwort vorhanden.");
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Kein aktives Markdown-Dokument.");
      return;
    }
    const editor = view.editor;
    const selection = editor.getSelection();
    if (!selection) {
      new Notice("Kein Text ausgewählt.");
      return;
    }
    editor.replaceSelection(text);
    new Notice("Auswahl ersetzt.");
  }

  async createNoteFromLastResponse() {
    const text = this.getLastAssistantText();
    if (!text) {
      new Notice("Noch keine Copilot-Antwort vorhanden.");
      return;
    }
    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const filename = `Copilot - ${timestamp}.md`;
    try {
      const file = await this.app.vault.create(filename, text);
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(`Neue Notiz erstellt: ${filename}`);
    } catch (err) {
      new Notice(`Fehler beim Erstellen der Notiz: ${err.message}`);
    }
  }

  // ── Rendering Helpers ──────────────────────────────────────────────────

  private renderMessage(role: "user" | "assistant", text: string): HTMLElement {
    const wrapper = this.messagesContainer.createDiv({
      cls: `copilot-msg copilot-msg-${role}`,
    });

    const avatar = wrapper.createDiv({ cls: "copilot-msg-avatar" });
    setIcon(avatar, role === "user" ? "user" : "bot");

    const bubble = wrapper.createDiv({ cls: "copilot-msg-bubble" });
    bubble.createDiv({ text, cls: "copilot-msg-content" });

    if (role === "assistant" && text === "") {
      // Typing-Indikator
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
    this.updateStatus("Bereit");
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
    return text.slice(0, maxChars) + "\n\n[… Dokument wurde gekürzt]";
  }
}
