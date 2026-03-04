import * as vscode from "vscode";
import { ModuleType } from "../utils/constants.js";

/**
 * The type of node in the Spica tree.
 */
export enum NodeType {
  /** Top-level module (Buckets, Functions, …) */
  Module = "module",
  /** A resource that can also have children (e.g., Bucket → documents, Function → source/deps) */
  Resource = "resource",
  /** A sub-module container within a resource (e.g., Dependencies under a Function) */
  SubModule = "submodule",
  /** A leaf node (document, policy, dependency entry, source code) */
  Leaf = "leaf",
}

export interface SpicaTreeItemData {
  nodeType: NodeType;
  moduleType: ModuleType;
  /** Resource ID (bucket id, function id, etc.) */
  resourceId?: string;
  /** Parent resource ID (e.g., bucketId for a document) */
  parentId?: string;
  /** Additional label for sub-items (e.g., "source", "dependencies") */
  subKind?: string;
  /** Raw label for display */
  label: string;
  /** Extra metadata (e.g., function language) */
  extra?: Record<string, unknown>;
}

export class SpicaTreeItem extends vscode.TreeItem {
  public readonly data: SpicaTreeItemData;

  constructor(data: SpicaTreeItemData) {
    const collapsible =
      data.nodeType === NodeType.Module ||
      data.nodeType === NodeType.Resource ||
      data.nodeType === NodeType.SubModule
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    super(data.label, collapsible);
    this.data = data;

    // Assign contextValue for menu visibility
    this.contextValue = this.buildContextValue();

    // Assign icons
    this.iconPath = this.buildIcon();

    // Leaf nodes get a click-to-open command (except dependencies and env vars)
    if (
      data.nodeType === NodeType.Leaf &&
      data.subKind !== "dependency" &&
      data.subKind !== "env-var"
    ) {
      this.command = {
        command: "spica.openResource",
        title: "Open Resource",
        arguments: [this],
      };
    }

    // Env var leaves get a click-to-edit-value command
    if (data.nodeType === NodeType.Leaf && data.subKind === "env-var") {
      this.command = {
        command: "spica.editEnvVar",
        title: "Edit Environment Variable",
        arguments: [this],
      };
    }

    // Tooltip
    this.tooltip = data.label;
  }

  private buildContextValue(): string {
    const parts: string[] = [];

    switch (this.data.nodeType) {
      case NodeType.Module:
        parts.push("module", "refreshable", "addable");
        if (this.data.moduleType === ModuleType.Functions) {
          parts.push("all-loggable");
        }
        break;
      case NodeType.Resource:
        parts.push("resource", "refreshable", "editable", "deletable");
        if (this.data.moduleType === ModuleType.Functions) {
          parts.push("loggable");
        }
        if (
          this.data.moduleType === ModuleType.Buckets ||
          this.data.moduleType === ModuleType.Functions
        ) {
          parts.push("json-editable");
        }
        if (this.data.moduleType === ModuleType.Buckets) {
          parts.push("addable");
        }
        break;
      case NodeType.SubModule:
        parts.push("submodule", "refreshable");
        if (
          this.data.subKind === "dependencies" ||
          this.data.subKind === "environment"
        ) {
          parts.push("addable");
        }
        break;
      case NodeType.Leaf:
        parts.push("leaf");
        // Dependency entries, bucket documents and env vars are deletable
        if (
          this.data.subKind === "dependency" ||
          this.data.subKind === "document" ||
          this.data.subKind === "env-var"
        ) {
          parts.push("deletable");
        }
        // Simple resources (policies) are deletable
        if (this.data.moduleType === ModuleType.Policies) {
          parts.push("deletable");
        }
        // Policies are also editable via the structured form
        if (this.data.moduleType === ModuleType.Policies) {
          parts.push("editable");
        }
        break;
    }

    return parts.join(".");
  }

  private buildIcon(): vscode.ThemeIcon | undefined {
    switch (this.data.nodeType) {
      case NodeType.Module:
        return new vscode.ThemeIcon(this.getModuleIcon(this.data.moduleType));
      case NodeType.Resource:
        return new vscode.ThemeIcon(this.getResourceIcon());
      case NodeType.SubModule:
        if (this.data.subKind === "dependencies") {
          return new vscode.ThemeIcon("package");
        }
        if (this.data.subKind === "environment") {
          return new vscode.ThemeIcon("symbol-constant");
        }
        if (this.data.subKind === "source") {
          return new vscode.ThemeIcon("file-code");
        }
        return new vscode.ThemeIcon("folder");
      case NodeType.Leaf:
        if (this.data.subKind === "source") {
          return new vscode.ThemeIcon("file-code");
        }
        if (this.data.subKind === "dependency") {
          return new vscode.ThemeIcon("package");
        }
        if (this.data.subKind === "env-var") {
          return new vscode.ThemeIcon("symbol-variable");
        }
        if (this.data.subKind === "document") {
          return new vscode.ThemeIcon("file");
        }
        return new vscode.ThemeIcon("symbol-property");
      default:
        return undefined;
    }
  }

  private getModuleIcon(mod: ModuleType): string {
    const map: Record<ModuleType, string> = {
      [ModuleType.Buckets]: "database",
      [ModuleType.Functions]: "symbol-function",
      [ModuleType.Policies]: "shield",
    };
    return map[mod] || "folder";
  }

  private getResourceIcon(): string {
    switch (this.data.moduleType) {
      case ModuleType.Buckets:
        return "table";
      case ModuleType.Functions:
        return "zap";
      case ModuleType.Policies:
        return "law";
      default:
        return "file";
    }
  }
}
