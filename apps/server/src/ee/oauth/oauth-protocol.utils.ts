import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { FastifyRequest } from 'fastify';
import { Workspace } from '@docmost/db/types/entity.types';
import {
  DEFAULT_OAUTH_SCOPES,
  OAuthScope,
  OAuthScopeValue,
  SUPPORTED_OAUTH_SCOPES,
} from './oauth.constants';
import { RegisteredDcrClient, RegisteredClientRow } from './oauth.models';
import {
  OAuthClientRegistrationResponse,
  OAuthRequestError,
} from './oauth.types';

const MAX_DCR_REDIRECT_URIS = 10;
const MAX_DCR_REDIRECT_URI_LENGTH = 2048;

export function normalizeScopes(
  input: string[] | undefined,
  defaults: readonly string[],
) {
  const scopes = input?.length ? input : defaults;
  const unique = [...new Set(scopes.filter(Boolean))];

  for (const scope of unique) {
    if (!SUPPORTED_OAUTH_SCOPES.includes(scope as OAuthScopeValue)) {
      throw new BadRequestException(`Unsupported OAuth scope: ${scope}`);
    }
  }

  if (
    unique.includes(OAuthScope.MCP_WRITE) &&
    !unique.includes(OAuthScope.MCP_READ)
  ) {
    unique.unshift(OAuthScope.MCP_READ);
  }
  if (unique.includes(OAuthScope.MCP_DESTRUCTIVE)) {
    if (!unique.includes(OAuthScope.MCP_WRITE)) {
      unique.unshift(OAuthScope.MCP_WRITE);
    }
    if (!unique.includes(OAuthScope.MCP_READ)) {
      unique.unshift(OAuthScope.MCP_READ);
    }
  }

  return unique as OAuthScopeValue[];
}

export function parseScopes(scope?: string) {
  return scope?.split(/[\s,]+/).filter(Boolean) ?? [];
}

export function normalizeRedirectUris(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException('redirect_uris is required');
  }
  if (value.length > MAX_DCR_REDIRECT_URIS) {
    throw new BadRequestException(
      `redirect_uris cannot contain more than ${MAX_DCR_REDIRECT_URIS} entries`,
    );
  }

  const redirectUris = [...new Set(value)]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!redirectUris.length || redirectUris.length !== value.length) {
    throw new BadRequestException('redirect_uris is invalid');
  }
  if (redirectUris.some((uri) => uri.length > MAX_DCR_REDIRECT_URI_LENGTH)) {
    throw new BadRequestException('redirect_uri is too long');
  }

  return redirectUris;
}

export function isSubset(left: readonly string[], right: readonly string[]) {
  const rightSet = new Set(right);
  return left.every((scope) => rightSet.has(scope));
}

export function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}

export function requireOAuthResource(value: unknown) {
  try {
    return normalizeResourceUrl(requireString(value, 'resource'));
  } catch {
    throw new OAuthRequestError('invalid_target', 'Invalid OAuth resource.');
  }
}

export function requireAuthorizeResource(value: unknown) {
  try {
    return normalizeResourceUrl(requireString(value, 'resource'));
  } catch (err) {
    if (err instanceof BadRequestException) {
      throw err;
    }
    throw new BadRequestException('Invalid OAuth resource');
  }
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function buildAuthorizationKey(clientId: string, resource: string) {
  return createHash('sha256')
    .update(`${clientId.length}:${clientId}${resource}`)
    .digest('hex');
}

export function verifyPkceS256(verifier: string, challenge: string) {
  const digest = createHash('sha256').update(verifier).digest();
  return base64Url(digest) === challenge;
}

function base64Url(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function normalizeResourceUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = trimTrailingSlash(url.pathname);
  return url.toString();
}

export function getRequestHost(req?: FastifyRequest) {
  if (!req) return undefined;

  const host = req.hostname || getFirstHeaderValue(req.headers.host);
  return host?.split(':')[0]?.trim().toLowerCase();
}

export function getRequestValue<T>(
  req: FastifyRequest | undefined,
  key: string,
): T | undefined {
  if (!req) return undefined;

  return ((req.raw as any)?.[key] ?? (req as any)?.[key]) as T | undefined;
}

function getFirstHeaderValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0]?.trim();
}

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function appendRedirectParams(
  redirectUri: string,
  params: Record<string, string | undefined>,
) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function sameStringSet(
  left: readonly string[],
  right: readonly string[],
) {
  if (left.length !== right.length) return false;

  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

export function toRegistrationResponse(
  client: RegisteredDcrClient,
): OAuthClientRegistrationResponse {
  return {
    client_id: client.clientId,
    client_name: client.clientName,
    client_uri: client.clientUri,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    scope: client.scopes.join(' '),
    client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
  };
}

export function toRegisteredDcrClient(
  row: RegisteredClientRow,
): RegisteredDcrClient {
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    clientUri: row.clientUri ?? undefined,
    redirectUris: row.redirectUris,
    grantTypes: row.grantTypes,
    responseTypes: row.responseTypes,
    tokenEndpointAuthMethod: 'none',
    scopes: normalizeScopes(row.scopes, DEFAULT_OAUTH_SCOPES),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function sanitizeOptionalUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function getUrlHost(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

export function getRequestUserAgent(req?: FastifyRequest) {
  return truncate(
    getFirstHeaderValue(req?.headers?.['user-agent']) ?? '',
    1000,
  );
}

export function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export function generateOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

type McpMode = 'off' | 'read-only' | 'read-write';

export function resolveMcpMode(aiSettings: any): McpMode {
  if (
    aiSettings?.mcpMode === 'read-only' ||
    aiSettings?.mcpMode === 'read-write'
  ) {
    return aiSettings.mcpMode;
  }
  if (aiSettings?.mcpMode === 'off') return 'off';

  return aiSettings?.mcp === true ? 'read-write' : 'off';
}

export function assertMcpScopesAllowed(
  workspace: Workspace,
  scopes: readonly string[],
) {
  const mode = resolveMcpMode((workspace.settings as any)?.ai);
  if (mode === 'off') {
    throw new ForbiddenException('MCP is not enabled for this workspace');
  }
  if (
    mode === 'read-only' &&
    (scopes.includes(OAuthScope.MCP_WRITE) ||
      scopes.includes(OAuthScope.MCP_DESTRUCTIVE))
  ) {
    throw new ForbiddenException('MCP is enabled in read-only mode');
  }
}
