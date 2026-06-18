import type {
  Instruction,
  ItemMode,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';

type TreeHitboxState = {
  isLastSibling: boolean;
  isOpen: boolean;
  hasChildren: boolean;
};

export function getTreeItemMode({
  isLastSibling,
  isOpen,
  hasChildren,
}: TreeHitboxState): ItemMode {
  // Last siblings need `last-in-group` even when expanded so the hitbox can
  // emit `reparent` for drops that outdent an item after the final sibling.
  if (isLastSibling) return 'last-in-group';
  if (isOpen && hasChildren) return 'expanded';
  return 'standard';
}

export function getBlockedTreeInstructions({
  isOpen,
  hasChildren,
}: Pick<TreeHitboxState, 'isOpen' | 'hasChildren'>): Instruction['type'][] {
  return isOpen && hasChildren ? ['reorder-below'] : [];
}
