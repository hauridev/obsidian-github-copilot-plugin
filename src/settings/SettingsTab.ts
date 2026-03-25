// src/settings/SettingsTab.ts
// Plugin settings including GitHub OAuth login/logout and model selection.

import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type CopilotChatPlugin from "../../main";

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotChatPlugin;
  private loginContainer: HTMLElement | null = null;
  private domainDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App, plugin: CopilotChatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "GitHub Copilot Chat" });

    // ── Enterprise ─────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "GitHub Enterprise" });

    new Setting(containerEl)
      .setName("Enterprise domain")
      .setDesc(
        "Leave empty for github.com. For GitHub Enterprise enter your domain, e.g. mycompany.ghe.com"
      )
      .addText((text) =>
        text
          .setPlaceholder("mycompany.ghe.com")
          .setValue(this.plugin.settings.enterpriseDomain)
          .onChange((value) => {
            if (this.domainDebounceTimer !== null) {
              clearTimeout(this.domainDebounceTimer);
            }
            this.domainDebounceTimer = setTimeout(async () => {
              this.domainDebounceTimer = null;
              const domain = value.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
              const prev = this.plugin.settings.enterpriseDomain;
              this.plugin.settings.enterpriseDomain = domain;
              this.plugin.auth.enterpriseDomain = domain;
              if (domain !== prev) {
                // Clear token when switching provider
                this.plugin.settings.githubToken = "";
                this.plugin.settings.githubLogin = "";
                this.plugin.settings.availableModels = [];
                this.plugin.auth.clearCache();
              }
              await this.plugin.saveSettings();
              this.display();
            }, 600);
          })
      );

    // ── Authentication ────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Authentication" });

    if (this.plugin.settings.githubToken) {
      this.renderLoggedIn(containerEl);
    } else {
      this.renderLoggedOut(containerEl);
    }

    // ── Model ──────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Model" });

    this.renderModelSection(containerEl);

    // ── Context ────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Context" });

    new Setting(containerEl)
      .setName("Include active document")
      .setDesc("Automatically send the content of the currently open document as context.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeActiveDocument)
          .onChange(async (value) => {
            this.plugin.settings.includeActiveDocument = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Maximum context length")
      .setDesc("Maximum number of characters of document content sent as context.")
      .addSlider((slider) =>
        slider
          .setLimits(1000, 50000, 1000)
          .setValue(this.plugin.settings.maxContextChars)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxContextChars = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderModelSection(containerEl: HTMLElement) {
    const models = this.plugin.settings.availableModels;
    const isLoggedIn = !!this.plugin.settings.githubToken;

    const fallbackModels = [
      { id: "gpt-4o", name: "GPT-4o (default)" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini (faster)" },
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    ];

    const displayModels = models.length > 0 ? models : fallbackModels;

    const modelSetting = new Setting(containerEl)
      .setName("Copilot model")
      .setDesc(
        models.length > 0
          ? "Models available for your Copilot subscription."
          : "Default models. Sign in and click 'Load models' to fetch the models available for your subscription."
      )
      .addDropdown((drop) => {
        for (const m of displayModels) {
          drop.addOption(m.id, m.name);
        }
        // Set current model; fall back to first if no longer available
        const current = this.plugin.settings.model;
        const available = displayModels.find((m) => m.id === current);
        drop.setValue(available ? current : (displayModels[0]?.id ?? "gpt-4o"));
        drop.onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        });
        return drop;
      });

    if (isLoggedIn) {
      modelSetting.addButton((btn) =>
        btn
          .setButtonText("Load models")
          .setTooltip("Fetch available models from the Copilot API")
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("Loading…");
            try {
              await this.plugin.fetchAndSaveModels();
              new Notice("Models loaded successfully.");
            } catch (e) {
              new Notice(`Error loading models: ${e instanceof Error ? e.message : e}`);
            }
            this.display();
          })
      );
    }
  }

  private renderLoggedIn(containerEl: HTMLElement) {
    const login = this.plugin.settings.githubLogin;
    const infoEl = containerEl.createDiv({ cls: "copilot-settings-auth-info" });

    const iconEl = infoEl.createSpan({ cls: "copilot-settings-auth-icon" });
    setIcon(iconEl, "check-circle");
    infoEl.createSpan({
      text: `Signed in as @${login || "GitHub User"}`,
      cls: "copilot-settings-auth-text",
    });

    new Setting(containerEl)
      .setName("GitHub account")
      .setDesc(`Signed in as: ${login || "GitHub User"}`)
      .addButton((btn) =>
        btn
          .setButtonText("Sign out")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.githubToken = "";
            this.plugin.settings.githubLogin = "";
            await this.plugin.saveSettings();
            this.plugin.auth.clearCache();
            new Notice("Signed out successfully.");
            this.display();
          })
      );
  }

  private renderLoggedOut(containerEl: HTMLElement) {
    const desc = containerEl.createEl("p", { cls: "copilot-settings-desc" });
    desc.setText(
      "Sign in with your GitHub account. You need an active GitHub Copilot subscription."
    );

    new Setting(containerEl)
      .setName("Sign in with GitHub")
      .setDesc("Starts the secure device flow (no browser redirect required).")
      .addButton((btn) =>
        btn
          .setButtonText("Sign in")
          .setCta()
          .onClick(() => this.startLoginFlow(containerEl))
      );

    this.loginContainer = containerEl.createDiv({ cls: "copilot-login-container" });
  }

  private async startLoginFlow(containerEl: HTMLElement) {
    if (!this.loginContainer) return;
    this.loginContainer.empty();

    const loadingEl = this.loginContainer.createDiv({ cls: "copilot-login-loading" });
    setIcon(loadingEl.createSpan(), "loader");
    loadingEl.createSpan({ text: " Requesting device code…" });

    try {
      const deviceCode = await this.plugin.auth.requestDeviceCode();

      this.loginContainer.empty();

      const codeBox = this.loginContainer.createDiv({ cls: "copilot-login-box" });

      codeBox.createEl("p", {
        text: "1. Open this URL in your browser:",
        cls: "copilot-login-step",
      });

      const urlRow = codeBox.createDiv({ cls: "copilot-login-url-row" });
      urlRow.createEl("code", { text: deviceCode.verification_uri });
      const copyUrlBtn = urlRow.createEl("button", { cls: "copilot-btn-icon", title: "Copy" });
      setIcon(copyUrlBtn, "copy");
      copyUrlBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(deviceCode.verification_uri);
        new Notice("URL copied!");
      });

      codeBox.createEl("p", {
        text: "2. Enter this code:",
        cls: "copilot-login-step",
      });

      const codeRow = codeBox.createDiv({ cls: "copilot-login-code-row" });
      codeRow.createEl("span", {
        text: deviceCode.user_code,
        cls: "copilot-login-code",
      });
      const copyCodeBtn = codeRow.createEl("button", { cls: "copilot-btn-icon", title: "Copy" });
      setIcon(copyCodeBtn, "copy");
      copyCodeBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(deviceCode.user_code);
        new Notice("Code copied!");
      });

      const statusEl = codeBox.createEl("p", {
        text: "⏳ Waiting for confirmation…",
        cls: "copilot-login-status",
      });

      // Poll in the background
      this.plugin.auth
        .pollForToken(
          deviceCode.device_code,
          deviceCode.interval,
          deviceCode.expires_in,
          () => {
            statusEl.setText("⏳ Still waiting…");
          }
        )
        .then(async (token) => {
          // Validate token and save login
          const { valid, login } = await this.plugin.auth.validateGitHubToken(token);
          if (!valid) {
            statusEl.setText("❌ Token invalid. Please try again.");
            return;
          }
          this.plugin.settings.githubToken = token;
          this.plugin.settings.githubLogin = login ?? "";
          await this.plugin.saveSettings();
          new Notice(`✓ Signed in as @${login}`);
          // Fetch available models right after login
          try {
            await this.plugin.fetchAndSaveModels();
          } catch { /* ignore, models can be loaded manually */ }
          this.display();
        })
        .catch((err: Error) => {
          statusEl.setText(`❌ Error: ${err.message}`);
        });
    } catch (err) {
      this.loginContainer.empty();
      this.loginContainer.createEl("p", {
        text: `Error: ${err instanceof Error ? err.message : err}`,
        cls: "copilot-login-error",
      });
    }
  }
}
