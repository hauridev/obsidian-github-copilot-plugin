// src/settings/SettingsTab.ts
// Plugin-Einstellungen inkl. GitHub OAuth Login/Logout.

import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type CopilotChatPlugin from "../../main";

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotChatPlugin;
  private loginContainer: HTMLElement | null = null;
  private deviceCodeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(app: App, plugin: CopilotChatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "GitHub Copilot Chat" });

    // ── Auth Section ──────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Authentifizierung" });

    if (this.plugin.settings.githubToken) {
      this.renderLoggedIn(containerEl);
    } else {
      this.renderLoggedOut(containerEl);
    }

    // ── Model ──────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Modell" });

    new Setting(containerEl)
      .setName("Copilot-Modell")
      .setDesc("Welches Modell soll für den Chat verwendet werden?")
      .addDropdown((drop) =>
        drop
          .addOption("gpt-4o", "GPT-4o (empfohlen)")
          .addOption("gpt-4o-mini", "GPT-4o Mini (schneller)")
          .addOption("gpt-4", "GPT-4")
          .addOption("claude-3.5-sonnet", "Claude 3.5 Sonnet")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Context ────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Kontext" });

    new Setting(containerEl)
      .setName("Aktives Dokument einbeziehen")
      .setDesc("Inhalt des aktuell geöffneten Dokuments automatisch als Kontext mitsenden.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeActiveDocument)
          .onChange(async (value) => {
            this.plugin.settings.includeActiveDocument = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Maximale Kontext-Länge")
      .setDesc("Maximale Zeichenanzahl des Dokumentinhalts, der als Kontext gesendet wird.")
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

  private renderLoggedIn(containerEl: HTMLElement) {
    const login = this.plugin.settings.githubLogin;
    const infoEl = containerEl.createDiv({ cls: "copilot-settings-auth-info" });

    const iconEl = infoEl.createSpan({ cls: "copilot-settings-auth-icon" });
    setIcon(iconEl, "check-circle");
    infoEl.createSpan({
      text: `Angemeldet als @${login || "GitHub User"}`,
      cls: "copilot-settings-auth-text",
    });

    new Setting(containerEl)
      .setName("GitHub Konto")
      .setDesc(`Eingeloggt als: ${login || "GitHub User"}`)
      .addButton((btn) =>
        btn
          .setButtonText("Abmelden")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.githubToken = "";
            this.plugin.settings.githubLogin = "";
            await this.plugin.saveSettings();
            this.plugin.auth.clearCache();
            new Notice("Erfolgreich abgemeldet.");
            this.display();
          })
      );
  }

  private renderLoggedOut(containerEl: HTMLElement) {
    const desc = containerEl.createEl("p", { cls: "copilot-settings-desc" });
    desc.setText(
      "Melde dich mit deinem GitHub-Konto an. Du benötigst ein aktives GitHub Copilot Abonnement."
    );

    new Setting(containerEl)
      .setName("Mit GitHub anmelden")
      .setDesc("Startet den sicheren Device-Flow (kein Browser-Redirect nötig).")
      .addButton((btn) =>
        btn
          .setButtonText("Anmelden")
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
    loadingEl.createSpan({ text: " Device Code wird angefordert…" });

    try {
      const deviceCode = await this.plugin.auth.requestDeviceCode();

      this.loginContainer.empty();

      // Code-Anzeige
      const codeBox = this.loginContainer.createDiv({ cls: "copilot-login-box" });

      codeBox.createEl("p", {
        text: "1. Öffne diese URL in deinem Browser:",
        cls: "copilot-login-step",
      });

      const urlRow = codeBox.createDiv({ cls: "copilot-login-url-row" });
      urlRow.createEl("code", { text: deviceCode.verification_uri });
      const copyUrlBtn = urlRow.createEl("button", { cls: "copilot-btn-icon", title: "Kopieren" });
      setIcon(copyUrlBtn, "copy");
      copyUrlBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(deviceCode.verification_uri);
        new Notice("URL kopiert!");
      });

      codeBox.createEl("p", {
        text: "2. Gib diesen Code ein:",
        cls: "copilot-login-step",
      });

      const codeRow = codeBox.createDiv({ cls: "copilot-login-code-row" });
      codeRow.createEl("span", {
        text: deviceCode.user_code,
        cls: "copilot-login-code",
      });
      const copyCodeBtn = codeRow.createEl("button", { cls: "copilot-btn-icon", title: "Kopieren" });
      setIcon(copyCodeBtn, "copy");
      copyCodeBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(deviceCode.user_code);
        new Notice("Code kopiert!");
      });

      const statusEl = codeBox.createEl("p", {
        text: "⏳ Warte auf Bestätigung…",
        cls: "copilot-login-status",
      });

      // Pollt im Hintergrund
      this.plugin.auth
        .pollForToken(
          deviceCode.device_code,
          deviceCode.interval,
          deviceCode.expires_in,
          () => {
            statusEl.setText("⏳ Noch warten…");
          }
        )
        .then(async (token) => {
          // Token validieren und Login speichern
          const { valid, login } = await this.plugin.auth.validateGitHubToken(token);
          if (!valid) {
            statusEl.setText("❌ Token ungültig. Bitte erneut versuchen.");
            return;
          }
          this.plugin.settings.githubToken = token;
          this.plugin.settings.githubLogin = login ?? "";
          await this.plugin.saveSettings();
          new Notice(`✓ Angemeldet als @${login}`);
          this.display();
        })
        .catch((err: Error) => {
          statusEl.setText(`❌ Fehler: ${err.message}`);
        });
    } catch (err) {
      this.loginContainer.empty();
      this.loginContainer.createEl("p", {
        text: `Fehler: ${err.message}`,
        cls: "copilot-login-error",
      });
    }
  }
}
