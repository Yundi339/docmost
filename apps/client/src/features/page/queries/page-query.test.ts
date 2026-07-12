import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { invalidateRemovedPageCache } from "./removed-page-cache";
import type { IPage } from "../types/page.types";

describe("invalidateRemovedPageCache", () => {
  it("keeps the active page unchanged while marking both cache keys stale", async () => {
    const client = new QueryClient();
    const page = {
      id: "page-id",
      slugId: "page-slug",
      deletedAt: null,
    } as IPage;
    const refetch = vi.fn();

    client.setQueryDefaults(["pages"], { queryFn: refetch });
    client.setQueryData(["pages", page.id], page);
    client.setQueryData(["pages", page.slugId], page);

    invalidateRemovedPageCache(client, page.id);
    await Promise.resolve();

    expect(client.getQueryData(["pages", page.id])).toBe(page);
    expect(client.getQueryData(["pages", page.slugId])).toBe(page);
    expect(
      client.getQueryState(["pages", page.id])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["pages", page.slugId])?.isInvalidated,
    ).toBe(true);
    expect(refetch).not.toHaveBeenCalled();
  });
});
