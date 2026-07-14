import { Extension } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

export const DATABASE_BLOCK_DELETE_CONFIRMED_META =
  "docmostDatabaseBlockDeleteConfirmed";
export const DATABASE_BLOCK_DELETE_REQUEST_EVENT =
  "docmost:database-block-delete-request";

export type DatabaseBlockDeleteRequest = {
  databaseId: string;
  blockId?: string;
  title?: string;
  position?: number;
};

export function confirmDatabaseBlockDeletion(
  transaction: Transaction,
): Transaction {
  return transaction
    .setMeta(DATABASE_BLOCK_DELETE_CONFIRMED_META, true)
    .setMeta("addToHistory", false);
}

export function isDatabaseBlockOwnerContext(
  database: { pageId: string; blockId: string } | undefined,
  pageId: string | undefined,
  blockId: string | undefined,
): boolean {
  return Boolean(
    database &&
    pageId &&
    blockId &&
    database.pageId === pageId &&
    database.blockId === blockId,
  );
}

function referenceKey(reference: DatabaseBlockDeleteRequest): string {
  return `${reference.databaseId}\u0000${reference.blockId ?? ""}`;
}

function databaseBlocks(doc: ProseMirrorNode) {
  const blocks = new Map<string, DatabaseBlockDeleteRequest>();

  doc.descendants((node, position) => {
    if (node.type.name !== "databaseBlock") return;
    const databaseId = node.attrs.databaseId;
    if (typeof databaseId !== "string" || !databaseId) return;

    const reference = {
      databaseId,
      blockId:
        typeof node.attrs.blockId === "string" ? node.attrs.blockId : undefined,
      title:
        typeof node.attrs.title === "string" ? node.attrs.title : undefined,
      position,
    };
    const key = referenceKey(reference);
    if (!blocks.has(key)) blocks.set(key, reference);
  });

  return blocks;
}

export function getDatabaseBlockRanges(
  doc: ProseMirrorNode,
  databaseId: string,
  blockId?: string,
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  doc.descendants((node, position) => {
    if (
      node.type.name === "databaseBlock" &&
      node.attrs.databaseId === databaseId &&
      (blockId === undefined || node.attrs.blockId === blockId)
    ) {
      ranges.push({ from: position, to: position + node.nodeSize });
    }
  });
  return ranges;
}

export function getRemovedDatabaseBlocks(
  previousDoc: ProseMirrorNode,
  nextDoc: ProseMirrorNode,
): DatabaseBlockDeleteRequest[] {
  const previous = databaseBlocks(previousDoc);
  const next = databaseBlocks(nextDoc);

  return [...previous.values()].filter(
    (reference) => !next.has(referenceKey(reference)),
  );
}

export const DatabaseBlockDeleteGuard = Extension.create({
  name: "databaseBlockDeleteGuard",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("databaseBlockDeleteGuard"),
        filterTransaction: (transaction, state) => {
          if (
            !transaction.docChanged ||
            transaction.getMeta(DATABASE_BLOCK_DELETE_CONFIRMED_META) ||
            isChangeOrigin(transaction)
          ) {
            return true;
          }

          const removed = getRemovedDatabaseBlocks(state.doc, transaction.doc);
          if (removed.length === 0) return true;

          queueMicrotask(() => {
            document.dispatchEvent(
              new CustomEvent<DatabaseBlockDeleteRequest>(
                DATABASE_BLOCK_DELETE_REQUEST_EVENT,
                { detail: removed[0] },
              ),
            );
          });
          return false;
        },
      }),
    ];
  },
});
