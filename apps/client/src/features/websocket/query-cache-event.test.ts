import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { applyQueryCacheEvent } from "./query-cache-event";

describe("applyQueryCacheEvent", () => {
  it("invalidates an updated query", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    applyQueryCacheEvent(queryClient, {
      operation: "invalidate",
      spaceId: "space-id",
      entity: ["database"],
      id: "database-id",
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["database", "database-id"],
    });
  });

  it("removes only the deleted resource query", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["database", "database-id"], { id: "deleted" });
    queryClient.setQueryData(["database", "other-id"], { id: "other" });

    applyQueryCacheEvent(queryClient, {
      operation: "removeQuery",
      spaceId: "space-id",
      entity: ["database"],
      id: "database-id",
    });

    expect(
      queryClient.getQueryData(["database", "database-id"]),
    ).toBeUndefined();
    expect(queryClient.getQueryData(["database", "other-id"])).toEqual({
      id: "other",
    });
  });
});
