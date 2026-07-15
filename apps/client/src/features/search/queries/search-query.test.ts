import { AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import {
  getSearchSuggestionsQueryKey,
  shouldRetrySearchSuggestions,
} from "./search-query";

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

describe("shouldRetrySearchSuggestions", () => {
  it.each([400, 401, 403, 404, 429])(
    "does not retry an HTTP %s response",
    (status) => {
      const error = new AxiosError(
        "request failed",
        undefined,
        undefined,
        undefined,
        { status } as never,
      );

      expect(shouldRetrySearchSuggestions(0, error)).toBe(false);
    },
  );

  it("retries a transient failure only once", () => {
    expect(shouldRetrySearchSuggestions(0, new Error("network error"))).toBe(
      true,
    );
    expect(shouldRetrySearchSuggestions(1, new Error("network error"))).toBe(
      false,
    );
  });
});
