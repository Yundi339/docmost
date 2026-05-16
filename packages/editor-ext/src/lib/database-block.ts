import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

export interface DatabaseBlockOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}

export interface DatabaseBlockAttributes {
  databaseId?: string;
  blockId?: string;
  title?: string;
  viewType?: string;
  template?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    databaseBlock: {
      insertDatabaseBlock: (attributes: DatabaseBlockAttributes) => ReturnType;
    };
  }
}

export const DatabaseBlock = Node.create<DatabaseBlockOptions>({
  name: 'databaseBlock',
  group: 'block',
  atom: true,
  draggable: true,
  isolating: true,
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
    };
  },

  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-database-id'),
        renderHTML: (attributes) => ({
          'data-database-id': attributes.databaseId,
        }),
      },
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => ({ 'data-block-id': attributes.blockId }),
      },
      title: {
        default: 'Database',
        parseHTML: (element) => element.getAttribute('data-title') || 'Database',
        renderHTML: (attributes) => ({ 'data-title': attributes.title }),
      },
      viewType: {
        default: 'table',
        parseHTML: (element) => element.getAttribute('data-view-type') || 'table',
        renderHTML: (attributes) => ({ 'data-view-type': attributes.viewType }),
      },
      template: {
        default: 'database',
        parseHTML: (element) => element.getAttribute('data-template') || 'database',
        renderHTML: (attributes) => ({ 'data-template': attributes.template }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[data-type="${this.name}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
    ];
  },

  addCommands() {
    return {
      insertDatabaseBlock:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },

  addNodeView() {
    this.editor.isInitialized = true;
    return ReactNodeViewRenderer(this.options.view);
  },
});
