// main.ts
// Obsidian Plugin Entry Point

import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { CopilotChatView, VIEW_TYPE_COPILOT_CHAT } from "./src/views/ChatView";
import { CopilotSettingTab } from "./src/settings/SettingsTab";
import { GitHubAuth } from "./src/auth/GitHubAuth";
import { CopilotClient } from "./src/api/CopilotClient";

export interface CopilotPluginSettings {
  githubToken: string;
  githubLogin: string;
  model: string;
  includeActiveDocument: boolean;
  maxContextChars: number;
}

const DEFAULT_SETTINGS: CopilotPluginSettings = {
  githubToken: "",
  githubLogin: "",
  model: "gpt-4o",
  includeActiveDocument: true,
  maxContextChars: 20000,
};

export default class CopilotChatPlugin extends Plugin {
  settings: CopilotPluginSettings;
  auth: GitHubAuth;
  private client: CopilotClient;

  async onload() {
    await this.loadSettings();

    this.auth = new GitHubAuth();

    this.client = new CopilotClient(
      () => this.getCopilotToken(),
      this.settings.model
    );

    // View registrieren
    this.registerView(VIEW_TYPE_COPILOT_CHAT, (leaf) => {
      return new CopilotChatView(leaf, this, this.client);
    });

    // Settings Tab
    this.addSettingTab(new CopilotSettingTab(this.app, this));

    // Ribbon Icon
    this.addRibbonIcon("bot", "Copilot Chat öffnen", () => {
      this.activateChatView();
    });

    // Commands
    this.addCommand({
      id: "open-copilot-chat",
      name: "Copilot Chat öffnen",
      callback: () => this.activateChatView(),
    });

    this.addCommand({
      id: "copilot-explain-selection",
      name: "Auswahl erklären lassen",
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("Bitte zuerst Text auswählen.");
          return;
        }
        this.activateChatView().then(() => {
          // Kurze Verzögerung damit die View geladen ist
          setTimeout(() => {
            const view = this.getChatView();
            if (view) {
              view["inputEl"].value = `Erkläre mir folgenden Text:\n\n${selection}`;
              view["autoResize"]();
            }
          }, 100);
        });
      },
    });

    this.addCommand({
      id: "copilot-improve-selection",
      name: "Auswahl verbessern lassen",
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("Bitte zuerst Text auswählen.");
          return;
        }
        this.activateChatView().then(() => {
          setTimeout(() => {
            const view = this.getChatView();
            if (view) {
              view["inputEl"].value = `Verbessere folgenden Text stilistisch und inhaltlich:\n\n${selection}`;
              view["autoResize"]();
            }
          }, 100);
        });
      },
    });

    this.addCommand({
      id: "copilot-summarize-document",
      name: "Aktuelles Dokument zusammenfassen",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("Kein aktives Dokument.");
          return;
        }
        await this.activateChatView();
        setTimeout(() => {
          const view = this.getChatView();
          if (view) {
            view["inputEl"].value = `Fasse das aktuelle Dokument "${file.basename}" prägnant zusammen.`;
            view["autoResize"]();
          }
        }, 100);
      },
    });

    console.log("GitHub Copilot Chat Plugin geladen.");
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_COPILOT_CHAT);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async getCopilotToken(): Promise<string> {
    if (!this.settings.githubToken) {
      throw new Error("Nicht angemeldet. Bitte zuerst in den Einstellungen anmelden.");
    }
    return this.auth.getCopilotToken(this.settings.githubToken);
  }

  async activateChatView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_COPILOT_CHAT);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_COPILOT_CHAT, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  private getChatView(): CopilotChatView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COPILOT_CHAT);
    if (leaves.length === 0) return null;
    const view = leaves[0].view;
    if (view instanceof CopilotChatView) return view;
    return null;
  }
}
