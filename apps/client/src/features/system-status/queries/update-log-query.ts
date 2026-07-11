import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getUpdateLog } from "@/features/system-status/services/update-log-service";
import { IUpdateLog } from "@/features/system-status/types/update-log.types";

export function useUpdateLogQuery(): UseQueryResult<IUpdateLog, Error> {
  return useQuery({
    queryKey: ["system-status", "update-log"],
    queryFn: getUpdateLog,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}
