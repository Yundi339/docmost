import { useQuery } from "@tanstack/react-query";
import { getSelectableSpaceOptions } from "@/ee/space-access/services/space-access-service";

export function useSelectableSpaceOptionsQuery(options?: {
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["credential-space-options"],
    queryFn: getSelectableSpaceOptions,
    enabled: options?.enabled,
    staleTime: 0,
    gcTime: 0,
  });
}
