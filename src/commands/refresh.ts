import { SpicaTreeItem } from "../models/tree-node.js";
import { SpicaTreeProvider } from "../providers/tree-provider.js";

/**
 * Refresh a specific tree node or the entire tree.
 */
export function refreshCommand(
  treeProvider: SpicaTreeProvider,
  item?: SpicaTreeItem,
): void {
  treeProvider.refresh(item);
}
