import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  confirmDatabaseBlockDeletion,
  DATABASE_BLOCK_DELETE_CONFIRMED_META,
  getDatabaseBlockRanges,
  getRemovedDatabaseBlocks,
  isDatabaseBlockOwnerContext,
} from "./database-block-delete-guard";

const schema = new Schema({
  nodes: {
    doc: { content: "block*" },
    paragraph: { group: "block", content: "text*" },
    text: { group: "inline" },
    databaseBlock: {
      group: "block",
      atom: true,
      attrs: {
        databaseId: { default: null },
        blockId: { default: null },
        title: { default: null },
      },
    },
  },
});

function databaseBlock(databaseId: string, blockId = `block_${databaseId}`) {
  return schema.node("databaseBlock", {
    databaseId,
    blockId,
    title: `Board ${databaseId}`,
  });
}

describe("database block delete guard", () => {
  it("detects a removed database block", () => {
    const previous = schema.node("doc", null, [
      databaseBlock("database_1"),
      schema.node("paragraph"),
    ]);
    const next = schema.node("doc", null, [schema.node("paragraph")]);

    expect(getRemovedDatabaseBlocks(previous, next)).toEqual([
      {
        databaseId: "database_1",
        blockId: "block_database_1",
        title: "Board database_1",
        position: 0,
      },
    ]);
  });

  it("allows moving a database block without treating it as deletion", () => {
    const previous = schema.node("doc", null, [
      databaseBlock("database_1"),
      schema.node("paragraph"),
    ]);
    const next = schema.node("doc", null, [
      schema.node("paragraph"),
      databaseBlock("database_1"),
    ]);

    expect(getRemovedDatabaseBlocks(previous, next)).toEqual([]);
  });

  it("does not delete the resource while another reference remains", () => {
    const previous = schema.node("doc", null, [
      databaseBlock("database_1"),
      databaseBlock("database_1"),
    ]);
    const next = schema.node("doc", null, [databaseBlock("database_1")]);

    expect(getRemovedDatabaseBlocks(previous, next)).toEqual([]);
  });

  it("detects removal of the owner block when a forged reference remains", () => {
    const previous = schema.node("doc", null, [
      databaseBlock("database_1", "owner_block"),
      databaseBlock("database_1", "forged_block"),
    ]);
    const next = schema.node("doc", null, [
      databaseBlock("database_1", "forged_block"),
    ]);

    expect(getRemovedDatabaseBlocks(previous, next)).toEqual([
      {
        databaseId: "database_1",
        blockId: "owner_block",
        title: "Board database_1",
        position: 0,
      },
    ]);
  });

  it("returns every remaining reference when explicitly deleting a board", () => {
    const document = schema.node("doc", null, [
      databaseBlock("database_1"),
      schema.node("paragraph"),
      databaseBlock("database_1"),
    ]);

    expect(getDatabaseBlockRanges(document, "database_1")).toEqual([
      { from: 0, to: 1 },
      { from: 3, to: 4 },
    ]);
  });

  it("can target only references with the same owner block id", () => {
    const document = schema.node("doc", null, [
      databaseBlock("database_1", "owner_block"),
      databaseBlock("database_1", "forged_block"),
      databaseBlock("database_1", "owner_block"),
    ]);

    expect(
      getDatabaseBlockRanges(document, "database_1", "owner_block"),
    ).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
  });

  it("marks irreversible deletion outside editor undo history", () => {
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [databaseBlock("database_1")]),
    });
    const transaction = confirmDatabaseBlockDeletion(state.tr.delete(0, 1));

    expect(transaction.getMeta(DATABASE_BLOCK_DELETE_CONFIRMED_META)).toBe(
      true,
    );
    expect(transaction.getMeta("addToHistory")).toBe(false);
  });

  it("requires both the owning page and block id", () => {
    const database = { pageId: "page_1", blockId: "block_1" };

    expect(isDatabaseBlockOwnerContext(database, "page_1", "block_1")).toBe(
      true,
    );
    expect(
      isDatabaseBlockOwnerContext(database, "copied_page", "block_1"),
    ).toBe(false);
    expect(
      isDatabaseBlockOwnerContext(database, "page_1", "forged_block"),
    ).toBe(false);
  });
});
