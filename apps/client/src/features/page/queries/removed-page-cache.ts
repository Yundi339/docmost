import type { QueryClient, QueryKey } from "@tanstack/react-query";

import type { IPage } from "../types/page.types";

export function invalidateRemovedPageCache(
  client: QueryClient,
  pageId: string,
) {
  const cached = client.getQueryData<IPage>(["pages", pageId]);
  const keys: QueryKey[] = [["pages", pageId]];

  if (cached?.slugId) {
    keys.push(["pages", cached.slugId]);
  }

  for (const queryKey of keys) {
    void client.invalidateQueries({
      queryKey,
      exact: true,
      refetchType: "none",
    });
  }
}
