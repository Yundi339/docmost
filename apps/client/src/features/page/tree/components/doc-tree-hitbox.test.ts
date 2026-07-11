import { describe, expect, it } from 'vitest';
import {
  attachInstruction,
  extractInstruction,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';

import {
  getBlockedTreeInstructions,
  getTreeItemMode,
} from './doc-tree-hitbox';

type TestRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

function element(rect: TestRect): Element {
  return {
    getBoundingClientRect: () => ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }),
  } as Element;
}

describe('DocTree hitbox mode', () => {
  it('keeps expanded non-last items in expanded mode', () => {
    expect(
      getTreeItemMode({
        isLastSibling: false,
        isOpen: true,
        hasChildren: true,
      }),
    ).toBe('expanded');
  });

  it('uses last-in-group for expanded last siblings', () => {
    expect(
      getTreeItemMode({
        isLastSibling: true,
        isOpen: true,
        hasChildren: true,
      }),
    ).toBe('last-in-group');
  });

  it('does not block reparent when reorder-below is blocked', () => {
    const mode = getTreeItemMode({
      isLastSibling: true,
      isOpen: true,
      hasChildren: true,
    });
    const data = attachInstruction(
      { id: 'target' },
      {
        block: getBlockedTreeInstructions({
          isLastSibling: true,
          isOpen: true,
          hasChildren: true,
        }),
        currentLevel: 1,
        element: element({
          left: 0,
          right: 200,
          top: 0,
          bottom: 40,
          width: 200,
          height: 40,
        }),
        indentPerLevel: 16,
        input: {
          clientX: 8,
          clientY: 24,
        } as Parameters<typeof attachInstruction>[1]['input'],
        mode,
      },
    );

    expect(extractInstruction(data)).toMatchObject({
      type: 'reparent',
      desiredLevel: 0,
    });
  });

  it('allows placing a node after the expanded final sibling', () => {
    const mode = getTreeItemMode({
      isLastSibling: true,
      isOpen: true,
      hasChildren: true,
    });
    const data = attachInstruction(
      { id: 'target' },
      {
        block: getBlockedTreeInstructions({
          isLastSibling: true,
          isOpen: true,
          hasChildren: true,
        }),
        currentLevel: 0,
        element: element({
          left: 0,
          right: 200,
          top: 0,
          bottom: 40,
          width: 200,
          height: 40,
        }),
        indentPerLevel: 16,
        input: {
          clientX: 100,
          clientY: 36,
        } as Parameters<typeof attachInstruction>[1]['input'],
        mode,
      },
    );

    expect(extractInstruction(data)).toMatchObject({
      type: 'reorder-below',
    });
  });
});
