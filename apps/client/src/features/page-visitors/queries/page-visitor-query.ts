import {
  InfiniteData,
  useInfiniteQuery,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { getPageVisitorList } from "@/features/page-visitors/services/page-visitor-service";
import { IPageVisitor } from "@/features/page-visitors/types/page-visitor.types";
import { IPagination } from "@/lib/types.ts";

export function usePageVisitorListQuery(
  pageId: string,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<IPagination<IPageVisitor>, unknown>> {
  return useInfiniteQuery({
    queryKey: ["page-visitor-list", pageId],
    queryFn: ({ pageParam }) => getPageVisitorList(pageId, pageParam),
    enabled: !!pageId && enabled,
    gcTime: 0,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.nextCursor ?? undefined,
  });
}
