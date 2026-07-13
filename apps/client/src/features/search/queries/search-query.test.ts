import { describe, expect, it } from "vitest";
import { getSearchSuggestionsQueryKey } from "./search-query";

describe("getSearchSuggestionsQueryKey", () => {
  const base = {
    query: "design",
    includeUsers: true,
    includeGroups: false,
    includePages: false,
    spaceId: "space-a",
    pageId: "page-a",
    context: "mention" as const,
    limit: 10,
  };

  it.each([
    ["user context", { includeUsers: false }],
    ["group context", { includeGroups: true }],
    ["page context", { includePages: true }],
    ["space context", { spaceId: "space-b" }],
    ["page context id", { pageId: "page-b" }],
    ["directory context", { context: "permission-picker" as const }],
    ["result limit", { limit: 20 }],
  ])("separates the %s", (_label, override) => {
    expect(getSearchSuggestionsQueryKey(base)).not.toEqual(
      getSearchSuggestionsQueryKey({ ...base, ...override }),
    );
  });

  it("uses the complete request parameters as the cache context", () => {
    expect(getSearchSuggestionsQueryKey(base)).toEqual([
      "search-suggestion",
      base,
    ]);
  });
});
