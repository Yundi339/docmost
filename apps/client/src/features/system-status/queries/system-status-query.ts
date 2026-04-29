import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getSystemStatus } from "@/features/system-status/services/system-status-service";
import { ISystemStatus } from "@/features/system-status/types/system-status.types";

export function useSystemStatusQuery(
  options?: { refetchIntervalMs?: number },
): UseQueryResult<ISystemStatus, Error> {
  return useQuery({
    queryKey: ["system-status"],
    queryFn: () => getSystemStatus(),
    refetchInterval: options?.refetchIntervalMs ?? 5000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
