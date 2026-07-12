import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  getPasskeyStatus,
  listPasskeys,
} from "@/ee/passkey/services/passkey-service";
import { PasskeyItem, PasskeyStatus } from "@/ee/passkey/types/passkey.types";

export const PASSKEY_LIST_QUERY_KEY = ["passkeys"] as const;

export function usePasskeyStatusQuery(options?: {
  enabled?: boolean;
}): UseQueryResult<PasskeyStatus, Error> {
  return useQuery({
    queryKey: ["passkey-status"],
    queryFn: getPasskeyStatus,
    enabled: options?.enabled,
    retry: false,
  });
}

export function usePasskeysQuery(): UseQueryResult<PasskeyItem[], Error> {
  return useQuery({
    queryKey: PASSKEY_LIST_QUERY_KEY,
    queryFn: listPasskeys,
  });
}
