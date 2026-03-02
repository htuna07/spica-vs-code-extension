import * as vscode from "vscode";
import { SpicaClient } from "../api/client.js";
import { login, validateApiKey } from "../api/auth.js";
import { StateManager } from "../storage/state-manager.js";
import { CONTEXT_CONNECTED, type AuthScheme } from "../utils/constants.js";
import { showApiError, showSuccess } from "../utils/errors.js";

/**
 * Run the interactive connection flow:
 * 1. Enter server URL → health check
 * 2. Choose auth strategy
 * 3. Enter credentials → validate
 * 4. Store & configure client
 */
export async function connectCommand(
  stateManager: StateManager,
  onConnected: () => void,
): Promise<void> {
  // 1. Server URL
  const serverUrl = await vscode.window.showInputBox({
    title: "Spica — Server URL",
    prompt: "Enter the base URL of your Spica server",
    placeHolder: "https://my-spica.example.com",
    ignoreFocusOut: true,
    validateInput: (val) => {
      try {
        new URL(val);
        return null;
      } catch {
        return "Please enter a valid URL";
      }
    },
  });

  if (!serverUrl) {
    return; // cancelled
  }

  // Health check
  const alive = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Checking server connectivity…",
    },
    () => SpicaClient.instance.healthCheck(serverUrl),
  );

  if (!alive) {
    vscode.window.showErrorMessage(
      `Cannot reach server at ${serverUrl}. Please check the URL and try again.`,
    );
    return;
  }

  // 2. Auth strategy
  const strategyPick = await vscode.window.showQuickPick(
    [
      {
        label: "API Key",
        description: "Authenticate with an API key",
        value: "APIKEY" as AuthScheme,
      },
      {
        label: "Identity (Username & Password)",
        description: "Login with credentials",
        value: "IDENTITY" as AuthScheme,
      },
    ],
    {
      title: "Spica — Authentication Method",
      placeHolder: "Choose how to authenticate",
      ignoreFocusOut: true,
    },
  );

  if (!strategyPick) {
    return;
  }

  const authScheme = strategyPick.value;
  let token: string;

  if (authScheme === "APIKEY") {
    // 3a. API Key
    const apiKey = await vscode.window.showInputBox({
      title: "Spica — API Key",
      prompt: "Enter your API key",
      password: true,
      ignoreFocusOut: true,
    });

    if (!apiKey) {
      return;
    }

    // Validate
    const valid = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Validating API key…",
      },
      () => validateApiKey(serverUrl, apiKey),
    );

    if (!valid) {
      vscode.window.showErrorMessage("Invalid API key. Authentication failed.");
      return;
    }

    token = apiKey;
    await stateManager.setApiKey(apiKey);
  } else {
    // 3b. Identity
    const identifier = await vscode.window.showInputBox({
      title: "Spica — Username",
      prompt: "Enter your username / identifier",
      ignoreFocusOut: true,
    });

    if (!identifier) {
      return;
    }

    const password = await vscode.window.showInputBox({
      title: "Spica — Password",
      prompt: "Enter your password",
      password: true,
      ignoreFocusOut: true,
    });

    if (!password) {
      return;
    }

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Logging in…",
        },
        () => login(serverUrl, identifier, password),
      );
      token = result.token;
      await stateManager.setToken(token);
      await stateManager.setIdentifier(identifier);
      await stateManager.setPassword(password);
    } catch (err) {
      showApiError(err, "Login failed");
      return;
    }
  }

  // 4. Persist & configure
  await stateManager.setServerUrl(serverUrl);
  await stateManager.setAuthScheme(authScheme);

  SpicaClient.instance.configure(serverUrl, authScheme, token);
  await vscode.commands.executeCommand("setContext", CONTEXT_CONNECTED, true);

  showSuccess(`Connected to ${serverUrl}`);
  onConnected();
}

/**
 * Disconnect and clear stored credentials.
 */
export async function disconnectCommand(
  stateManager: StateManager,
  onDisconnected: () => void,
): Promise<void> {
  await stateManager.clearAll();
  SpicaClient.instance.reset();
  await vscode.commands.executeCommand("setContext", CONTEXT_CONNECTED, false);
  showSuccess("Disconnected from Spica");
  onDisconnected();
}

/**
 * Attempt silent reconnect from saved credentials.
 * Returns true if reconnected.
 */
export async function tryAutoReconnect(
  stateManager: StateManager,
): Promise<boolean> {
  const hasCreds = await stateManager.hasSavedCredentials();
  if (!hasCreds) {
    return false;
  }

  const serverUrl = stateManager.getServerUrl()!;
  const authScheme = stateManager.getAuthScheme()!;

  // Quick health check
  const alive = await SpicaClient.instance.healthCheck(serverUrl);
  if (!alive) {
    return false;
  }

  let token: string;
  if (authScheme === "APIKEY") {
    token = (await stateManager.getApiKey())!;
  } else {
    // Re-login to get a fresh JWT
    const identifier = await stateManager.getIdentifier();
    const password = await stateManager.getPassword();
    if (!identifier || !password) {
      return false;
    }
    try {
      const result = await login(serverUrl, identifier, password);
      token = result.token;
      await stateManager.setToken(token);
    } catch {
      return false;
    }
  }

  SpicaClient.instance.configure(serverUrl, authScheme, token);
  await vscode.commands.executeCommand("setContext", CONTEXT_CONNECTED, true);
  return true;
}
