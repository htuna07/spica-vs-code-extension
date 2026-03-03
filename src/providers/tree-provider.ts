import * as vscode from "vscode";
import {
  SpicaTreeItem,
  NodeType,
  type SpicaTreeItemData,
} from "../models/tree-node.js";
import { ModuleType, MODULE_LABELS } from "../utils/constants.js";
import { SpicaClient } from "../api/client.js";

// API imports
import { listBuckets } from "../api/buckets.js";
import { getBucket } from "../api/buckets.js";
import { listBucketData } from "../api/bucket-data.js";
import { listFunctions } from "../api/functions.js";
import { getFunctionDependencies } from "../api/functions.js";
import { listPolicies } from "../api/policies.js";

/**
 * TreeDataProvider that renders the Spica resource hierarchy.
 */
export class SpicaTreeProvider implements vscode.TreeDataProvider<SpicaTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SpicaTreeItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: SpicaTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SpicaTreeItem): Promise<SpicaTreeItem[]> {
    if (!element) {
      return this.getRootModules();
    }
    return this.getChildNodes(element);
  }

  /**
   * Refresh the entire tree or a specific subtree.
   */
  refresh(element?: SpicaTreeItem): void {
    this._onDidChangeTreeData.fire(element ?? null);
  }

  // ── Root level ──────────────────────────────────────────────────────

  private static readonly MODULE_PATHS: Record<ModuleType, string> = {
    [ModuleType.Buckets]: "/bucket?limit=0",
    [ModuleType.Functions]: "/function?limit=0",
    [ModuleType.Policies]: "/passport/policy?limit=0",
  };

  private async getRootModules(): Promise<SpicaTreeItem[]> {
    const modules: ModuleType[] = [
      ModuleType.Buckets,
      ModuleType.Functions,
      ModuleType.Policies,
    ];

    const client = SpicaClient.instance;
    const available = await Promise.all(
      modules.map(async (mod) => {
        try {
          await client.get(SpicaTreeProvider.MODULE_PATHS[mod]);
          return mod;
        } catch {
          return null;
        }
      }),
    );

    return available
      .filter((mod): mod is ModuleType => mod !== null)
      .map(
        (mod) =>
          new SpicaTreeItem({
            nodeType: NodeType.Module,
            moduleType: mod,
            label: MODULE_LABELS[mod],
          }),
      );
  }

  // ── Children ────────────────────────────────────────────────────────

  private async getChildNodes(parent: SpicaTreeItem): Promise<SpicaTreeItem[]> {
    try {
      switch (parent.data.nodeType) {
        case NodeType.Module:
          return this.getModuleChildren(parent.data.moduleType);
        case NodeType.Resource:
          return this.getResourceChildren(parent.data);
        case NodeType.SubModule:
          return this.getSubModuleChildren(parent.data);
        default:
          return [];
      }
    } catch {
      // Silently return empty — module may be disabled or unavailable
      return [];
    }
  }

  private async getModuleChildren(mod: ModuleType): Promise<SpicaTreeItem[]> {
    switch (mod) {
      case ModuleType.Buckets: {
        const buckets = await listBuckets();
        return buckets.map(
          (b) =>
            new SpicaTreeItem({
              nodeType: NodeType.Resource,
              moduleType: ModuleType.Buckets,
              resourceId: b._id,
              label: b.title || b._id,
            }),
        );
      }
      case ModuleType.Functions: {
        const funcs = await listFunctions();
        return funcs.map(
          (f) =>
            new SpicaTreeItem({
              nodeType: NodeType.Resource,
              moduleType: ModuleType.Functions,
              resourceId: f._id,
              label: f.name || f._id,
            }),
        );
      }
      case ModuleType.Policies: {
        const policies = await listPolicies();
        return policies.map(
          (p) =>
            new SpicaTreeItem({
              nodeType: NodeType.Leaf,
              moduleType: ModuleType.Policies,
              resourceId: p._id,
              label: p.name || p._id,
            }),
        );
      }
      default:
        return [];
    }
  }

  private async getResourceChildren(
    data: SpicaTreeItemData,
  ): Promise<SpicaTreeItem[]> {
    switch (data.moduleType) {
      case ModuleType.Buckets: {
        // Bucket resource → list its documents, use primary field for label
        const [docs, bucket] = await Promise.all([
          listBucketData(data.resourceId!, { limit: 100 }),
          getBucket(data.resourceId!),
        ]);
        const primaryField = bucket.primary;
        return docs.map((d) => {
          let label = d._id;
          if (primaryField && d[primaryField] !== undefined) {
            label = String(d[primaryField]);
          }
          return new SpicaTreeItem({
            nodeType: NodeType.Leaf,
            moduleType: ModuleType.Buckets,
            resourceId: d._id,
            parentId: data.resourceId,
            subKind: "document",
            label,
          });
        });
      }
      case ModuleType.Functions: {
        // Function resource → show sub-modules: Source Code, Dependencies
        return [
          new SpicaTreeItem({
            nodeType: NodeType.Leaf,
            moduleType: ModuleType.Functions,
            resourceId: data.resourceId,
            subKind: "source",
            label: "Source Code",
          }),
          new SpicaTreeItem({
            nodeType: NodeType.SubModule,
            moduleType: ModuleType.Functions,
            resourceId: data.resourceId,
            subKind: "dependencies",
            label: "Dependencies",
          }),
        ];
      }
      default:
        return [];
    }
  }

  private async getSubModuleChildren(
    data: SpicaTreeItemData,
  ): Promise<SpicaTreeItem[]> {
    if (
      data.moduleType === ModuleType.Functions &&
      data.subKind === "dependencies"
    ) {
      const raw = await getFunctionDependencies(data.resourceId!);
      // Response can be Record<string, string> or an array — normalise.
      const entries: [string, string][] = Array.isArray(raw)
        ? raw.map((d: Record<string, unknown>) => [
            String(d.name ?? d.package ?? ""),
            String(d.version ?? ""),
          ])
        : Object.entries(raw as Record<string, string>);
      return entries.map(
        ([name, version]) =>
          new SpicaTreeItem({
            nodeType: NodeType.Leaf,
            moduleType: ModuleType.Functions,
            resourceId: name,
            parentId: data.resourceId,
            subKind: "dependency",
            label: `${name}@${version}`,
          }),
      );
    }
    return [];
  }
}
