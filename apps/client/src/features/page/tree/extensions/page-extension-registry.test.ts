import { describe, expect, it } from "vitest";
import { getVisiblePageExtensions } from "./page-extension-registry";

describe("getVisiblePageExtensions", () => {
  it("keeps relationship metadata but shows one indicator per provider role", () => {
    const extensions = [
      { provider: "database", role: "host", resourceId: "database-1" },
      { provider: "database", role: "host", resourceId: "database-2" },
      { provider: "database", role: "record", resourceId: "record-1" },
      { provider: "approval", role: "host", resourceId: "approval-1" },
    ];

    expect(getVisiblePageExtensions(extensions)).toEqual([
      extensions[0],
      extensions[2],
      extensions[3],
    ]);
    expect(extensions).toHaveLength(4);
  });
});
