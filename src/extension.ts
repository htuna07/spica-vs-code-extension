import * as vscode from "vscode";
import {
  SPICA_SCHEME,
  VIEW_EXPLORER,
  CONTEXT_CONNECTED,
} from "./utils/constants.js";
import { StateManager } from "./storage/state-manager.js";
import { SpicaTreeProvider } from "./providers/tree-provider.js";
import { SpicaFileSystemProvider } from "./providers/file-system.js";
import {
  connectCommand,
  disconnectCommand,
  tryAutoReconnect,
} from "./commands/connect.js";
import {
  openResourceCommand,
  editResourceCommand,
  deleteResourceCommand,
} from "./commands/resource.js";
import { refreshCommand } from "./commands/refresh.js";
import { viewLogsCommand, disposeLogChannels } from "./commands/logs.js";
import { addResourceCommand } from "./views/form-panel.js";
import { SpicaTreeItem } from "./models/tree-node.js";

let treeProvider: SpicaTreeProvider;
let stateManager: StateManager;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // ── State & providers ─────────────────────────────────────────────
  stateManager = new StateManager(context.globalState, context.secrets);
  treeProvider = new SpicaTreeProvider();

  // Register file system provider
  const fsProvider = new SpicaFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SPICA_SCHEME, fsProvider, {
      isCaseSensitive: true,
    }),
  );

  // Register tree view
  const treeView = vscode.window.createTreeView(VIEW_EXPLORER, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Commands ──────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("spica.connect", () =>
      connectCommand(stateManager, () => treeProvider.refresh()),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("spica.disconnect", () =>
      disconnectCommand(stateManager, () => treeProvider.refresh()),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("spica.refresh", (item?: SpicaTreeItem) =>
      refreshCommand(treeProvider, item),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "spica.openResource",
      (item: SpicaTreeItem) => openResourceCommand(item),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "spica.editResource",
      (item: SpicaTreeItem) => editResourceCommand(item),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "spica.deleteResource",
      (item: SpicaTreeItem) => deleteResourceCommand(item, treeProvider),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "spica.addResource",
      (item: SpicaTreeItem) =>
        addResourceCommand(item, treeProvider, context.extensionUri),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("spica.viewLogs", (item: SpicaTreeItem) =>
      viewLogsCommand(item),
    ),
  );

  // ── Auto-reconnect ───────────────────────────────────────────────

  const reconnected = await tryAutoReconnect(stateManager);
  if (reconnected) {
    treeProvider.refresh();
  } else {
    // Ensure context is set to not-connected to show welcome view
    await vscode.commands.executeCommand(
      "setContext",
      CONTEXT_CONNECTED,
      false,
    );
  }
}

export function deactivate(): void {
  disposeLogChannels();
}
