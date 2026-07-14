import { treeModel } from "@/features/page/tree/model/tree-model";
import type { DropOp } from "@/features/page/tree/model/tree-model.types";
import type { SpaceTreeNode } from "@/features/page/tree/types";

export function canApplyPageTreeDrop(
  tree: SpaceTreeNode[],
  sourceId: string,
  operation: DropOp,
): boolean {
  const source = treeModel.find(tree, sourceId);
  if (!source || source.capabilities?.move === false) return false;

  const { result } = treeModel.move(tree, sourceId, operation);
  const changesParent = result.parentId !== source.parentPageId;
  if (changesParent && source.capabilities?.reparent === false) {
    return false;
  }
  if (!changesParent) return true;
  if (!result.parentId) return true;

  const parent = treeModel.find(tree, result.parentId);
  return parent?.capabilities?.createChild !== false;
}
