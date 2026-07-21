import { describe, expect, it } from "vitest";
import {
  isSpaceAccessSelectionValid,
  mergeSpaceAccessOptions,
  toSpaceAccessInput,
} from "./space-access";

describe("space access", () => {
  it("preserves selected mode when no selected spaces remain", () => {
    expect(
      toSpaceAccessInput({
        mode: "selected",
        spaces: [],
        selectedCount: 0,
        effectiveCount: 0,
        status: "no_effective_spaces",
      }),
    ).toEqual({ mode: "selected", spaceIds: [] });
  });

  it("maps selected response spaces without expanding access", () => {
    expect(
      toSpaceAccessInput({
        mode: "selected",
        spaces: [
          { id: "space-2", name: "Product", slug: "product" },
          { id: "space-1", name: "Engineering", slug: "engineering" },
        ],
        selectedCount: 2,
        effectiveCount: 2,
        status: "active",
      }),
    ).toEqual({ mode: "selected", spaceIds: ["space-2", "space-1"] });
  });

  it("validates that selected access contains at least one space", () => {
    expect(isSpaceAccessSelectionValid({ mode: "all" })).toBe(true);
    expect(
      isSpaceAccessSelectionValid({ mode: "selected", spaceIds: [] }),
    ).toBe(false);
    expect(
      isSpaceAccessSelectionValid({
        mode: "selected",
        spaceIds: ["space-1"],
      }),
    ).toBe(true);
  });

  it("merges available and previously selected spaces by id", () => {
    expect(
      mergeSpaceAccessOptions(
        [{ id: "space-1", name: "Current", slug: "current" }],
        [
          { id: "space-1", name: "Stale label", slug: "stale" },
          { id: "space-2", name: "Previous", slug: "previous" },
        ],
      ),
    ).toEqual([
      { id: "space-1", name: "Current", slug: "current" },
      { id: "space-2", name: "Previous", slug: "previous" },
    ]);
  });
});
