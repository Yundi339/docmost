import {
  approveOAuthAuthorization,
  denyOAuthAuthorization,
  getAvailableOAuthClients,
  getOAuthAuthorizations,
  getOAuthAuthorizeInfo,
  getOAuthClients,
  IOAuthAuthorization,
  IOAuthApprovalRequest,
  IOAuthAuthorizeInfo,
  IOAuthClient,
  IOAuthRedirectResponse,
  revokeOAuthAuthorization,
  updateOAuthAuthorization,
  updateOAuthClient,
} from "@/ee/oauth";
import { OAuthScope } from "@/ee/oauth/types/oauth.types";
import { IUpdateOAuthAuthorizationRequest } from "@/ee/oauth/types/oauth.types";
import { notifications } from "@mantine/notifications";
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

export function useOAuthClientsQuery(options?: {
  enabled?: boolean;
}): UseQueryResult<IOAuthClient[], Error> {
  return useQuery({
    queryKey: ["oauth-clients"],
    queryFn: getOAuthClients,
    enabled: options?.enabled,
  });
}

export function useAvailableOAuthClientsQuery(): UseQueryResult<
  IOAuthClient[],
  Error
> {
  return useQuery({
    queryKey: ["oauth-clients", "available"],
    queryFn: getAvailableOAuthClients,
  });
}

export function useOAuthAuthorizationsQuery(
  params?: { adminView?: boolean },
  options?: { enabled?: boolean },
): UseQueryResult<IOAuthAuthorization[], Error> {
  return useQuery({
    queryKey: ["oauth-authorizations", params || {}],
    queryFn: () => getOAuthAuthorizations(params),
    enabled: options?.enabled,
  });
}

export function useOAuthAuthorizeInfoQuery(
  query: Record<string, string>,
  options?: { enabled?: boolean },
): UseQueryResult<IOAuthAuthorizeInfo, Error> {
  return useQuery({
    queryKey: ["oauth-authorize-info", query],
    queryFn: () => getOAuthAuthorizeInfo(query),
    enabled: options?.enabled,
    retry: false,
  });
}

export function useUpdateOAuthClientMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<
    IOAuthClient,
    Error,
    {
      clientId: string;
      name?: string;
      isEnabled?: boolean;
      allowedScopes?: OAuthScope[];
    }
  >({
    mutationFn: updateOAuthClient,
    onSuccess: () => {
      notifications.show({ message: t("Updated successfully") });
      queryClient.invalidateQueries({
        predicate: (item) => item.queryKey[0] === "oauth-clients",
      });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
    },
  });
}

export function useRevokeOAuthAuthorizationMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<void, Error, { authorizationId: string }>({
    mutationFn: revokeOAuthAuthorization,
    onSuccess: () => {
      notifications.show({ message: t("Revoked successfully") });
      queryClient.invalidateQueries({
        predicate: (item) => item.queryKey[0] === "oauth-authorizations",
      });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
    },
  });
}

export function useUpdateOAuthAuthorizationMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<
    IOAuthAuthorization,
    Error,
    IUpdateOAuthAuthorizationRequest
  >({
    mutationFn: updateOAuthAuthorization,
    onSuccess: () => {
      notifications.show({ message: t("Updated successfully") });
      queryClient.invalidateQueries({
        predicate: (item) => item.queryKey[0] === "oauth-authorizations",
      });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
    },
  });
}

export function useApproveOAuthAuthorizationMutation() {
  return useMutation<IOAuthRedirectResponse, Error, IOAuthApprovalRequest>({
    mutationFn: approveOAuthAuthorization,
  });
}

export function useDenyOAuthAuthorizationMutation() {
  return useMutation<IOAuthRedirectResponse, Error, Record<string, string>>({
    mutationFn: denyOAuthAuthorization,
  });
}
