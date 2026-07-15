import {
  useInfiniteQuery,
  useQuery,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  getSystemDiagnosticDataSources,
  getSystemStatus,
} from "@/features/system-status/services/system-status-service";
import { ISystemStatus } from "@/features/system-status/types/system-status.types";

export function useSystemStatusQuery(options?: {
  refetchIntervalMs?: number;
}): UseQueryResult<ISystemStatus, Error> {
  return useQuery({
    queryKey: ["system-status"],
    queryFn: () => getSystemStatus(),
    refetchInterval: options?.refetchIntervalMs ?? 5000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export function useSystemDiagnosticDataSourcesQuery(
  filter: "issues" | "all",
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["system-status", "diagnostic-data-sources", filter],
    queryFn: ({ pageParam }) =>
      getSystemDiagnosticDataSources({
        filter,
        limit: 50,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime: 30_000,
  });
}
