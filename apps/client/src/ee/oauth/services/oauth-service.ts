import api from "@/lib/api-client";
import {
  IOAuthAuthorization,
  IOAuthApprovalRequest,
  IOAuthAuthorizeInfo,
  IOAuthClient,
  IOAuthRedirectResponse,
  OAuthScope,
  IUpdateOAuthAuthorizationRequest,
} from "@/ee/oauth/types/oauth.types";

export async function getOAuthClients(): Promise<IOAuthClient[]> {
  const req = await api.post("/oauth/clients", {});
  return req.data;
}

export async function getAvailableOAuthClients(): Promise<IOAuthClient[]> {
  const req = await api.post("/oauth/clients/available", {});
  return req.data;
}

export async function updateOAuthClient(data: {
  clientId: string;
  name?: string;
  isEnabled?: boolean;
  allowedScopes?: OAuthScope[];
}): Promise<IOAuthClient> {
  const req = await api.post("/oauth/clients/update", data);
  return req.data;
}

export async function getOAuthAuthorizations(params?: {
  adminView?: boolean;
}): Promise<IOAuthAuthorization[]> {
  const req = await api.post("/oauth/authorizations", params || {});
  return req.data;
}

export async function revokeOAuthAuthorization(data: {
  authorizationId: string;
}): Promise<void> {
  await api.post("/oauth/authorizations/revoke", data);
}

export async function updateOAuthAuthorization(
  data: IUpdateOAuthAuthorizationRequest,
): Promise<IOAuthAuthorization> {
  const req = await api.post<IOAuthAuthorization>(
    "/oauth/authorizations/update",
    data,
  );
  return req.data;
}

export async function getOAuthAuthorizeInfo(
  query: Record<string, string>,
): Promise<IOAuthAuthorizeInfo> {
  const req = await api.post("/oauth/authorize/info", query);
  return req.data;
}

export async function approveOAuthAuthorization(
  query: IOAuthApprovalRequest,
): Promise<IOAuthRedirectResponse> {
  const req = await api.post("/oauth/authorize/approve", query);
  return req.data;
}

export async function denyOAuthAuthorization(
  query: Record<string, string>,
): Promise<IOAuthRedirectResponse> {
  const req = await api.post("/oauth/authorize/deny", query);
  return req.data;
}
