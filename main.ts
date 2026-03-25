// main.ts
// Obsidian plugin entry point

import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { CopilotChatView, VIEW_TYPE_COPILOT_CHAT } from "./src/views/ChatView";
import { CopilotSettingTab } from "./src/settings/SettingsTab";
import { GitHubAuth } from "./src/auth/GitHubAuth";
import { CopilotClient } from "./src/api/CopilotClient";

export interface SavedConversation {
  id: string;
  name: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  createdAt: number;
}

export interface CopilotPluginSettings {
  githubToken: string;
  githubLogin: string;
  model: string;
  includeActiveDocument: boolean;
  maxContextChars: number;
  enterpriseDomain: string;
  availableModels: { id: string; name: string }[];
  customSystemPrompt: string;
  savedConversations: SavedConversation[];
  activeConversationId: string;
}

const DEFAULT_SETTINGS: CopilotPluginSettings = {
  githubToken: "",
  githubLogin: "",
  model: "gpt-4o",
  includeActiveDocument: true,
  maxContextChars: 20000,
  enterpriseDomain: "",
  availableModels: [],
  customSystemPrompt: "",
  savedConversations: [],
  activeConversationId: "",
};

export default class CopilotChatPlugin extends Plugin {
  settings: CopilotPluginSettings;
  auth: GitHubAuth;
  private client: CopilotClient;

  async onload() {
    await this.loadSettings();

    this.auth = new GitHubAuth(this.settings.enterpriseDomain);

    this.client = new CopilotClient(
      () => this.getCopilotToken(),
      () => this.auth.copilotApiBase,
      this.settings.model
    );

    // Register view
    this.registerView(VIEW_TYPE_COPILOT_CHAT, (leaf) => {
      return new CopilotChatView(leaf, this, this.client);
    });

    // Settings tab
    this.addSettingTab(new CopilotSettingTab(this.app, this));

    // Ribbon icon
    this.addRibbonIcon("bot", "Open Copilot Chat", () => {
      this.activateChatView();
    });

    // Commands
    this.addCommand({
      id: "open-copilot-chat",
      name: "Open Copilot Chat",
      callback: () => this.activateChatView(),
    });

    this.addCommand({
      id: "copilot-explain-selection",
      name: "Explain selection",
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("Please select some text first.");
          return;
        }
        this.activateChatView().then(() => {
          // Short delay to ensure the view is loaded
          setTimeout(() => {
            const view = this.getChatView();
            if (view) {
              view["inputEl"].value = `Explain the following text:\n\n${selection}`;
              view["autoResize"]();
            }
          }, 100);
        });
      },
    });

    this.addCommand({
      id: "copilot-improve-selection",
      name: "Improve selection",
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("Please select some text first.");
          return;
        }
        this.activateChatView().then(() => {
          setTimeout(() => {
            const view = this.getChatView();
            if (view) {
              view["inputEl"].value = `Improve the following text stylistically and content-wise:\n\n${selection}`;
              view["autoResize"]();
            }
          }, 100);
        });
      },
    });

    this.addCommand({
      id: "copilot-summarize-document",
      name: "Summarize current document",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("No active document.");
          return;
        }
        await this.activateChatView();
        setTimeout(() => {
          const view = this.getChatView();
          if (view) {
            view["inputEl"].value = `Summarize the current document "${file.basename}" concisely.`;
            view["autoResize"]();
          }
        }, 100);
      },
    });

    console.log("GitHub Copilot Chat plugin loaded.");
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

  async fetchAndSaveModels(): Promise<void> {
    const models = await this.client.fetchModels();
    if (models.length > 0) {
      this.settings.availableModels = models;
      await this.saveSettings();
    }
  }

  private async getCopilotToken(): Promise<string> {
    if (!this.settings.githubToken) {
      throw new Error("Not signed in. Please sign in via Settings first.");
    }
    return this.auth.getCopilotToken(this.settings.githubToken);
  }

  async activateChatView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_COPILOT_CHAT);

    if (leaves.length > 0) {
      leaf = leaves[0] ?? null;
    } else {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_COPILOT_CHAT, active: true });
    }

    if (leaf) workspace.revealLeaf(leaf);
  }

  private getChatView(): CopilotChatView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COPILOT_CHAT);
    if (leaves.length === 0) return null;
    const view = leaves[0]?.view;
    if (view instanceof CopilotChatView) return view;
    return null;
  }
}
