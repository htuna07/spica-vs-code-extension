import * as vscode from "vscode";
import { SpicaTreeItem, NodeType } from "../models/tree-node.js";
import { SpicaFileSystemProvider } from "../providers/file-system.js";
import { ModuleType } from "../utils/constants.js";
import { showApiError, showSuccess } from "../utils/errors.js";
import { SpicaTreeProvider } from "../providers/tree-provider.js";

// API imports for delete operations
import { deleteBucket } from "../api/buckets.js";
import { deleteBucketDocument } from "../api/bucket-data.js";
import { deleteFunction, removeFunctionDependency } from "../api/functions.js";
import { deletePolicy } from "../api/policies.js";
import { deleteEnvVar } from "../api/env-vars.js";
import { deleteSecret } from "../api/secrets.js";

/**
 * Open a resource in the editor via the spica: file system.
 */
export async function openResourceCommand(item: SpicaTreeItem): Promise<void> {
  if (!item?.data?.resourceId) {
    return;
  }

  const { moduleType, resourceId, subKind, parentId } = item.data;

  let uri: vscode.Uri;

  if (subKind === "source") {
    uri = SpicaFileSystemProvider.buildUri(moduleType, resourceId!, "source");
  } else if (subKind === "document" && parentId) {
    uri = SpicaFileSystemProvider.buildUri(
      moduleType,
      parentId,
      "document",
      resourceId,
    );
  } else {
    uri = SpicaFileSystemProvider.buildUri(moduleType, resourceId!);
  }

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    // Set language for better editing experience
    let language = "json";
    if (subKind === "source") {
      language = "typescript";
    }
    await vscode.languages.setTextDocumentLanguage(doc, language);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    showApiError(err, "Failed to open resource");
  }
}

/**
 * Edit a resource node that has children (e.g., Bucket schema, Function metadata).
 * Opens the resource itself in the editor.
 */
export async function editResourceCommand(item: SpicaTreeItem): Promise<void> {
  if (!item?.data?.resourceId) {
    return;
  }

  const { moduleType, resourceId } = item.data;
  const uri = SpicaFileSystemProvider.buildUri(moduleType, resourceId!);

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, "json");
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    showApiError(err, "Failed to open resource for editing");
  }
}

/**
 * Open a Bucket or Function resource as raw JSON in the VS Code editor.
 * Saving the document triggers an update via the spica: file system provider.
 */
export async function openJsonEditorCommand(
  item: SpicaTreeItem,
): Promise<void> {
  if (!item?.data?.resourceId) {
    return;
  }

  const { moduleType, resourceId } = item.data;
  const uri = SpicaFileSystemProvider.buildUri(moduleType, resourceId!);

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, "json");
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    showApiError(err, "Failed to open JSON editor");
  }
}

/**
 * Delete a resource with confirmation.
 */
export async function deleteResourceCommand(
  item: SpicaTreeItem,
  treeProvider: SpicaTreeProvider,
): Promise<void> {
  if (!item?.data?.resourceId) {
    return;
  }

  const { moduleType, resourceId, subKind, parentId, label } = item.data;

  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to delete "${label}"?`,
    { modal: true },
    "Delete",
  );

  if (confirm !== "Delete") {
    return;
  }

  try {
    await performDelete(moduleType, resourceId!, subKind, parentId);
    showSuccess(`"${label}" deleted successfully`);
    treeProvider.refresh();
  } catch (err) {
    showApiError(err, `Failed to delete "${label}"`);
  }
}

async function performDelete(
  moduleType: ModuleType,
  resourceId: string,
  subKind?: string,
  parentId?: string,
): Promise<void> {
  // Dependency deletion
  if (subKind === "dependency" && parentId) {
    // resourceId holds the package name (e.g., "axios" from "axios@1.0.0")
    const pkgName = resourceId.split("@")[0] || resourceId;
    await removeFunctionDependency(parentId, pkgName);
    return;
  }

  // Document deletion
  if (subKind === "document" && parentId) {
    await deleteBucketDocument(parentId, resourceId);
    return;
  }

  // Top-level resource deletion
  switch (moduleType) {
    case ModuleType.Buckets:
      await deleteBucket(resourceId);
      return;
    case ModuleType.Functions:
      await deleteFunction(resourceId);
      return;
    case ModuleType.Policies:
      await deletePolicy(resourceId);
      return;
    case ModuleType.EnvVars:
      await deleteEnvVar(resourceId);
      return;
    case ModuleType.Secrets:
      await deleteSecret(resourceId);
      return;
  }
}
