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
  isLastSibling,
  isOpen,
  hasChildren,
}: TreeHitboxState): Instruction['type'][] {
  // `last-in-group` reserves its bottom edge for placing a sibling after the
  // final node. Blocking it leaves no way to move an item to the end of an
  // expanded group.
  return isOpen && hasChildren && !isLastSibling ? ['reorder-below'] : [];
}
