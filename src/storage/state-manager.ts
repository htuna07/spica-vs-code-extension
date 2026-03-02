import * as vscode from "vscode";
import {
  STATE_KEY_SERVER_URL,
  STATE_KEY_AUTH_SCHEME,
  SECRET_KEY_TOKEN,
  SECRET_KEY_APIKEY,
  SECRET_KEY_IDENTIFIER,
  SECRET_KEY_PASSWORD,
  type AuthScheme,
} from "../utils/constants.js";

/**
 * Manages persistence of connection state using VS Code globalState
 * and SecretStorage (for sensitive data).
 */
export class StateManager {
  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secrets: vscode.SecretStorage,
  ) {}

  // ── Server URL ──────────────────────────────────────────────────────

  getServerUrl(): string | undefined {
    return this.globalState.get<string>(STATE_KEY_SERVER_URL);
  }

  async setServerUrl(url: string): Promise<void> {
    await this.globalState.update(STATE_KEY_SERVER_URL, url);
  }

  // ── Auth scheme ─────────────────────────────────────────────────────

  getAuthScheme(): AuthScheme | undefined {
    return this.globalState.get<AuthScheme>(STATE_KEY_AUTH_SCHEME);
  }

  async setAuthScheme(scheme: AuthScheme): Promise<void> {
    await this.globalState.update(STATE_KEY_AUTH_SCHEME, scheme);
  }

  // ── Token (JWT) ─────────────────────────────────────────────────────

  async getToken(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY_TOKEN);
  }

  async setToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_TOKEN, token);
  }

  // ── API Key ─────────────────────────────────────────────────────────

  async getApiKey(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY_APIKEY);
  }

  async setApiKey(key: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_APIKEY, key);
  }

  // ── Identity credentials (for refresh) ──────────────────────────────

  async getIdentifier(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY_IDENTIFIER);
  }

  async setIdentifier(id: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_IDENTIFIER, id);
  }

  async getPassword(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY_PASSWORD);
  }

  async setPassword(pw: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_PASSWORD, pw);
  }

  // ── Clear everything ────────────────────────────────────────────────

  async clearAll(): Promise<void> {
    await this.globalState.update(STATE_KEY_SERVER_URL, undefined);
    await this.globalState.update(STATE_KEY_AUTH_SCHEME, undefined);
    await this.secrets.delete(SECRET_KEY_TOKEN);
    await this.secrets.delete(SECRET_KEY_APIKEY);
    await this.secrets.delete(SECRET_KEY_IDENTIFIER);
    await this.secrets.delete(SECRET_KEY_PASSWORD);
  }

  // ── Check if we have saved credentials ──────────────────────────────

  async hasSavedCredentials(): Promise<boolean> {
    const serverUrl = this.getServerUrl();
    if (!serverUrl) {
      return false;
    }
    const scheme = this.getAuthScheme();
    if (!scheme) {
      return false;
    }
    if (scheme === "APIKEY") {
      const key = await this.getApiKey();
      return !!key;
    }
    const token = await this.getToken();
    return !!token;
  }
}
