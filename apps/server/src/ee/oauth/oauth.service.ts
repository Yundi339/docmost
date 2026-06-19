import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHash, randomBytes } from 'crypto';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { DomainService } from '../../integrations/environment/domain.service';
import { TokenService } from '../../core/auth/services/token.service';
import { JwtMcpOAuthPayload } from '../../core/auth/dto/jwt-payload';
import { isUserDisabled } from '../../common/helpers';
import { UserRole } from '../../common/helpers/types/permission';
import {
  CHATGPT_TRUSTED_CLIENT_ID_HOST,
  DEFAULT_OAUTH_SCOPES,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_PROVIDER_CHATGPT,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  OAuthScope,
  OAuthScopeValue,
  SUPPORTED_OAUTH_SCOPES,
} from './oauth.constants';
import {
  OAuthAuthorizeQuery,
  OAuthClientMetadata,
  OAuthRequestError,
  OAuthTokenRequest,
  OAuthTokenResponse,
} from './oauth.types';

type OAuthClientRow = {
  id: string;
  workspaceId: string;
  creatorId: string | null;
  provider: string;
  name: string;
  clientId: string | null;
  trustedClientIdHost: string;
  allowClientIdMetadataDocuments: boolean;
  allowedScopes: string[];
  isEnabled: boolean;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type ResolvedAuthorizeRequest = {
  oauthClient: OAuthClientRow;
  clientId: string;
  clientName: string;
  clientUri?: string;
  redirectUri: string;
  resource: string;
  scopes: OAuthScopeValue[];
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
};

export type OAuthClientView = {
  id: string;
  provider: string;
  name: string;
  isEnabled: boolean;
  allowedScopes: string[];
  trustedClientIdHost: string;
  allowClientIdMetadataDocuments: boolean;
  mcpServerUrl: string;
  issuer: string;
  resourceMetadataUrl: string;
  authorizationServerMetadataUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
};

@Injectable()
export class OAuthService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly domainService: DomainService,
  ) {}

  getMcpResourceUrl(workspace: Workspace): string {
    return normalizeResourceUrl(`${this.getIssuer(workspace)}/mcp`);
  }

  getIssuer(workspace: Workspace): string {
    return trimTrailingSlash(this.domainService.getUrl(workspace.hostname));
  }

  getProtectedResourceMetadata(workspace: Workspace) {
    const issuer = this.getIssuer(workspace);

    return {
      resource: this.getMcpResourceUrl(workspace),
      authorization_servers: [issuer],
      scopes_supported: SUPPORTED_OAUTH_SCOPES,
      bearer_methods_supported: ['header'],
      resource_documentation: `${issuer}/settings/account/oauth`,
    };
  }

  getAuthorizationServerMetadata(workspace: Workspace) {
    const issuer = this.getIssuer(workspace);

    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: SUPPORTED_OAUTH_SCOPES,
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
      resource_documentation: `${issuer}/settings/account/oauth`,
    };
  }

  getWwwAuthenticateHeader(workspace: Workspace, scopes?: string[]) {
    const issuer = this.getIssuer(workspace);
    const resourceMetadataUrl = `${issuer}/.well-known/oauth-protected-resource/mcp`;
    const scope = scopes?.length ? scopes.join(' ') : OAuthScope.MCP_READ;

    return `Bearer resource_metadata="${resourceMetadataUrl}", scope="${scope}"`;
  }

  async listClients(workspace: Workspace, user: User) {
    this.assertOwner(user);
    await this.ensureDefaultChatGptClient(workspace.id, user.id);
    const rows = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();

    return rows.map((row) => this.toClientView(row, workspace));
  }

  async listAvailableClients(workspace: Workspace) {
    const rows = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .where('isEnabled', '=', true)
      .orderBy('createdAt', 'asc')
      .execute();

    return rows.map((row) => this.toClientView(row, workspace));
  }

  async updateClient(
    input: {
      clientId: string;
      name?: string;
      isEnabled?: boolean;
      allowedScopes?: string[];
    },
    workspace: Workspace,
    user: User,
  ) {
    this.assertOwner(user);
    const allowedScopes = input.allowedScopes
      ? normalizeScopes(input.allowedScopes, DEFAULT_OAUTH_SCOPES)
      : undefined;

    const client = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('id', '=', input.clientId)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!client) {
      throw new NotFoundException('OAuth client not found');
    }

    const row = await this.db
      .updateTable('oauthClients')
      .set({
        name: input.name?.trim() || client.name,
        isEnabled: input.isEnabled ?? client.isEnabled,
        allowedScopes: allowedScopes ?? client.allowedScopes,
        updatedAt: new Date(),
      })
      .where('id', '=', client.id)
      .where('workspaceId', '=', workspace.id)
      .returningAll()
      .executeTakeFirst();

    return this.toClientView(row, workspace);
  }

  async listAuthorizations(
    workspace: Workspace,
    user: User,
    opts?: { adminView?: boolean },
  ) {
    if (opts?.adminView) {
      this.assertOwner(user);
    }

    let query = this.db
      .selectFrom('oauthAuthorizations as oa')
      .innerJoin('users as u', 'u.id', 'oa.userId')
      .select([
        'oa.id',
        'oa.provider',
        'oa.clientId',
        'oa.clientName',
        'oa.clientUri',
        'oa.redirectUri',
        'oa.resource',
        'oa.scopes',
        'oa.lastUsedAt',
        'oa.revokedAt',
        'oa.createdAt',
        'oa.updatedAt',
        'oa.userId',
        'u.name as userName',
        'u.email as userEmail',
        'u.avatarUrl as userAvatarUrl',
      ])
      .where('oa.workspaceId', '=', workspace.id)
      .where('oa.revokedAt', 'is', null)
      .orderBy('oa.createdAt', 'desc');

    if (!opts?.adminView) {
      query = query.where('oa.userId', '=', user.id);
    }

    return query.execute();
  }

  async revokeAuthorization(
    authorizationId: string,
    workspace: Workspace,
    user: User,
  ) {
    const authorization = await this.db
      .selectFrom('oauthAuthorizations')
      .selectAll()
      .where('id', '=', authorizationId)
      .where('workspaceId', '=', workspace.id)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();

    if (!authorization) {
      throw new NotFoundException('OAuth authorization not found');
    }

    if (authorization.userId !== user.id && user.role !== UserRole.OWNER) {
      throw new ForbiddenException();
    }

    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('oauthAuthorizations')
        .set({ revokedAt: now, updatedAt: now })
        .where('id', '=', authorization.id)
        .where('workspaceId', '=', workspace.id)
        .execute();

      await trx
        .updateTable('oauthRefreshTokens')
        .set({ revokedAt: now })
        .where('authorizationId', '=', authorization.id)
        .where('workspaceId', '=', workspace.id)
        .where('revokedAt', 'is', null)
        .execute();
    });
  }

  async previewAuthorization(
    query: OAuthAuthorizeQuery,
    user: User,
    workspace: Workspace,
  ) {
    const resolved = await this.resolveAuthorizeRequest(query, workspace);
    return {
      provider: resolved.oauthClient.provider,
      clientName: resolved.clientName,
      clientUri: resolved.clientUri,
      redirectUri: resolved.redirectUri,
      redirectHost: new URL(resolved.redirectUri).hostname,
      resource: resolved.resource,
      scopes: resolved.scopes,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    };
  }

  async approveAuthorization(
    query: OAuthAuthorizeQuery,
    user: User,
    workspace: Workspace,
  ) {
    const resolved = await this.resolveAuthorizeRequest(query, workspace);
    const authorization = await this.upsertAuthorization(
      resolved,
      user,
      workspace,
    );
    const code = this.generateOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000,
    );

    await this.db
      .insertInto('oauthAuthorizationCodes')
      .values({
        codeHash: hashToken(code),
        workspaceId: workspace.id,
        userId: user.id,
        oauthClientId: resolved.oauthClient.id,
        authorizationId: authorization.id,
        clientId: resolved.clientId,
        redirectUri: resolved.redirectUri,
        resource: resolved.resource,
        scopes: resolved.scopes,
        codeChallenge: resolved.codeChallenge,
        codeChallengeMethod: resolved.codeChallengeMethod,
        expiresAt,
      })
      .execute();

    return {
      redirectUri: appendRedirectParams(resolved.redirectUri, {
        code,
        state: resolved.state,
      }),
    };
  }

  async denyAuthorization(query: OAuthAuthorizeQuery, workspace: Workspace) {
    const redirectUri = requireString(query.redirect_uri, 'redirect_uri');
    this.assertSafeChatGptRedirectUri(redirectUri);

    return {
      redirectUri: appendRedirectParams(redirectUri, {
        error: 'access_denied',
        error_description: 'The user denied the authorization request.',
        state: query.state,
      }),
    };
  }

  async exchangeToken(
    body: OAuthTokenRequest,
    workspace: Workspace,
  ): Promise<OAuthTokenResponse> {
    if (body.grant_type === 'authorization_code') {
      return this.exchangeAuthorizationCode(body, workspace);
    }

    if (body.grant_type === 'refresh_token') {
      return this.exchangeRefreshToken(body, workspace);
    }

    throw new OAuthRequestError(
      'unsupported_grant_type',
      'Only authorization_code and refresh_token grants are supported.',
    );
  }

  async validateAccessToken(
    payload: JwtMcpOAuthPayload,
    workspaceHint?: Workspace,
  ) {
    const workspace =
      workspaceHint ?? (await this.workspaceRepo.findById(payload.workspaceId));
    if (!workspace) {
      throw new ForbiddenException('Workspace not found');
    }

    const expectedResource = this.getMcpResourceUrl(workspace);
    if (normalizeResourceUrl(payload.resource) !== expectedResource) {
      throw new ForbiddenException(
        'OAuth token audience does not match MCP resource',
      );
    }

    const authorization = await this.db
      .selectFrom('oauthAuthorizations as oa')
      .leftJoin('oauthClients as oc', 'oc.id', 'oa.oauthClientId')
      .select([
        'oa.id',
        'oa.userId',
        'oa.workspaceId',
        'oa.clientId',
        'oa.oauthClientId',
        'oa.resource',
        'oa.scopes',
        'oa.revokedAt',
        'oc.isEnabled as oauthClientEnabled',
        'oc.deletedAt as oauthClientDeletedAt',
      ])
      .where('oa.id', '=', payload.authorizationId)
      .where('oa.workspaceId', '=', payload.workspaceId)
      .where('oa.revokedAt', 'is', null)
      .executeTakeFirst();

    if (!authorization) {
      throw new ForbiddenException('OAuth authorization not found');
    }

    if (
      authorization.clientId !== payload.clientId ||
      normalizeResourceUrl(authorization.resource) !== expectedResource ||
      authorization.oauthClientEnabled !== true ||
      authorization.oauthClientDeletedAt !== null
    ) {
      throw new ForbiddenException('OAuth authorization is no longer valid');
    }

    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);
    if (!user || isUserDisabled(user)) {
      throw new ForbiddenException('User not found');
    }

    const scopes = normalizeScopes(payload.scopes, DEFAULT_OAUTH_SCOPES);
    if (!isSubset(scopes, authorization.scopes)) {
      throw new ForbiddenException('OAuth token scopes are no longer valid');
    }

    this.db
      .updateTable('oauthAuthorizations')
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', authorization.id)
      .execute()
      .catch(() => {});

    return {
      user,
      workspace,
      oauth: {
        authorizationId: authorization.id,
        oauthClientId: authorization.oauthClientId ?? undefined,
        clientId: authorization.clientId,
        scopes,
      },
    };
  }

  async ensureDefaultChatGptClient(workspaceId: string, creatorId?: string) {
    const existing = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('provider', '=', OAUTH_PROVIDER_CHATGPT)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (existing) {
      return existing;
    }

    return this.db
      .insertInto('oauthClients')
      .values({
        workspaceId,
        creatorId,
        provider: OAUTH_PROVIDER_CHATGPT,
        name: 'ChatGPT',
        trustedClientIdHost: CHATGPT_TRUSTED_CLIENT_ID_HOST,
        allowClientIdMetadataDocuments: true,
        allowedScopes: DEFAULT_OAUTH_SCOPES,
        isEnabled: false,
        settings: {},
      })
      .returningAll()
      .executeTakeFirst();
  }

  private async exchangeAuthorizationCode(
    body: OAuthTokenRequest,
    workspace: Workspace,
  ): Promise<OAuthTokenResponse> {
    const code = requireString(body.code, 'code');
    const clientId = requireString(body.client_id, 'client_id');
    const redirectUri = requireString(body.redirect_uri, 'redirect_uri');
    const codeVerifier = requireString(body.code_verifier, 'code_verifier');
    const resource = requireOAuthResource(body.resource);
    const expectedResource = this.getMcpResourceUrl(workspace);

    if (resource !== expectedResource) {
      throw new OAuthRequestError('invalid_target', 'Invalid OAuth resource.');
    }

    const now = new Date();
    const codeRow = await this.db
      .selectFrom('oauthAuthorizationCodes')
      .selectAll()
      .where('codeHash', '=', hashToken(code))
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    if (
      !codeRow ||
      codeRow.consumedAt ||
      codeRow.expiresAt < now ||
      codeRow.clientId !== clientId ||
      codeRow.redirectUri !== redirectUri ||
      normalizeResourceUrl(codeRow.resource) !== resource
    ) {
      throw new OAuthRequestError(
        'invalid_grant',
        'Invalid authorization code.',
      );
    }

    if (!verifyPkceS256(codeVerifier, codeRow.codeChallenge)) {
      throw new OAuthRequestError('invalid_grant', 'PKCE verification failed.');
    }

    const authorization = await this.getValidAuthorization(
      codeRow.authorizationId,
      workspace.id,
      clientId,
      resource,
    );
    const user = await this.userRepo.findById(codeRow.userId, workspace.id);
    if (!user || isUserDisabled(user)) {
      throw new OAuthRequestError('invalid_grant', 'User not found.');
    }

    const refreshToken = this.generateOpaqueToken();
    const refreshTokenExpiresAt = new Date(
      now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    await this.db.transaction().execute(async (trx) => {
      const consumedCode = await trx
        .updateTable('oauthAuthorizationCodes')
        .set({ consumedAt: now })
        .where('id', '=', codeRow.id)
        .where('consumedAt', 'is', null)
        .returning('id')
        .executeTakeFirst();

      if (!consumedCode) {
        throw new OAuthRequestError(
          'invalid_grant',
          'Invalid authorization code.',
        );
      }

      await trx
        .insertInto('oauthRefreshTokens')
        .values({
          tokenHash: hashToken(refreshToken),
          workspaceId: workspace.id,
          userId: user.id,
          oauthClientId: codeRow.oauthClientId,
          authorizationId: authorization.id,
          clientId,
          resource,
          scopes: codeRow.scopes,
          expiresAt: refreshTokenExpiresAt,
        })
        .execute();
    });

    return this.createTokenResponse({
      user,
      workspace,
      authorizationId: authorization.id,
      oauthClientId: authorization.oauthClientId ?? undefined,
      clientId,
      resource,
      scopes: normalizeScopes(codeRow.scopes, DEFAULT_OAUTH_SCOPES),
      refreshToken,
    });
  }

  private async exchangeRefreshToken(
    body: OAuthTokenRequest,
    workspace: Workspace,
  ): Promise<OAuthTokenResponse> {
    const token = requireString(body.refresh_token, 'refresh_token');
    const clientId = requireString(body.client_id, 'client_id');
    const resource = requireOAuthResource(body.resource);
    const expectedResource = this.getMcpResourceUrl(workspace);

    if (resource !== expectedResource) {
      throw new OAuthRequestError('invalid_target', 'Invalid OAuth resource.');
    }

    const now = new Date();
    const refreshRow = await this.db
      .selectFrom('oauthRefreshTokens')
      .selectAll()
      .where('tokenHash', '=', hashToken(token))
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    if (
      !refreshRow ||
      refreshRow.revokedAt ||
      refreshRow.expiresAt < now ||
      refreshRow.clientId !== clientId ||
      normalizeResourceUrl(refreshRow.resource) !== resource
    ) {
      throw new OAuthRequestError('invalid_grant', 'Invalid refresh token.');
    }

    let requestedScopes: OAuthScopeValue[];
    try {
      requestedScopes = body.scope
        ? normalizeScopes(parseScopes(body.scope), DEFAULT_OAUTH_SCOPES)
        : normalizeScopes(refreshRow.scopes, DEFAULT_OAUTH_SCOPES);
    } catch {
      throw new OAuthRequestError(
        'invalid_scope',
        'Requested scope is invalid.',
      );
    }
    if (!isSubset(requestedScopes, refreshRow.scopes)) {
      throw new OAuthRequestError(
        'invalid_scope',
        'Requested scope is not allowed.',
      );
    }

    const authorization = await this.getValidAuthorization(
      refreshRow.authorizationId,
      workspace.id,
      clientId,
      resource,
    );
    const user = await this.userRepo.findById(refreshRow.userId, workspace.id);
    if (!user || isUserDisabled(user)) {
      throw new OAuthRequestError('invalid_grant', 'User not found.');
    }

    const replacement = this.generateOpaqueToken();
    const replacementExpiresAt = new Date(
      now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    await this.db.transaction().execute(async (trx) => {
      const revokedToken = await trx
        .updateTable('oauthRefreshTokens')
        .set({
          revokedAt: now,
          lastUsedAt: now,
        })
        .where('id', '=', refreshRow.id)
        .where('revokedAt', 'is', null)
        .returning('id')
        .executeTakeFirst();

      if (!revokedToken) {
        throw new OAuthRequestError('invalid_grant', 'Invalid refresh token.');
      }

      const replacementRow = await trx
        .insertInto('oauthRefreshTokens')
        .values({
          tokenHash: hashToken(replacement),
          workspaceId: workspace.id,
          userId: user.id,
          oauthClientId: refreshRow.oauthClientId,
          authorizationId: authorization.id,
          clientId,
          resource,
          scopes: requestedScopes,
          expiresAt: replacementExpiresAt,
        })
        .returningAll()
        .executeTakeFirst();

      await trx
        .updateTable('oauthRefreshTokens')
        .set({ replacedById: replacementRow.id })
        .where('id', '=', refreshRow.id)
        .execute();
    });

    return this.createTokenResponse({
      user,
      workspace,
      authorizationId: authorization.id,
      oauthClientId: authorization.oauthClientId ?? undefined,
      clientId,
      resource,
      scopes: requestedScopes,
      refreshToken: replacement,
    });
  }

  private async createTokenResponse(input: {
    user: User;
    workspace: Workspace;
    authorizationId: string;
    oauthClientId?: string;
    clientId: string;
    resource: string;
    scopes: OAuthScopeValue[];
    refreshToken: string;
  }): Promise<OAuthTokenResponse> {
    const accessToken = await this.tokenService.generateMcpOAuthAccessToken({
      user: input.user,
      workspaceId: input.workspace.id,
      authorizationId: input.authorizationId,
      oauthClientId: input.oauthClientId,
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      expiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      scope: input.scopes.join(' '),
      refresh_token: input.refreshToken,
    };
  }

  private async getValidAuthorization(
    authorizationId: string,
    workspaceId: string,
    clientId: string,
    resource: string,
  ) {
    const row = await this.db
      .selectFrom('oauthAuthorizations as oa')
      .leftJoin('oauthClients as oc', 'oc.id', 'oa.oauthClientId')
      .select([
        'oa.id',
        'oa.oauthClientId',
        'oa.clientId',
        'oa.resource',
        'oa.revokedAt',
        'oc.isEnabled as oauthClientEnabled',
        'oc.deletedAt as oauthClientDeletedAt',
      ])
      .where('oa.id', '=', authorizationId)
      .where('oa.workspaceId', '=', workspaceId)
      .where('oa.revokedAt', 'is', null)
      .executeTakeFirst();

    if (
      !row ||
      row.clientId !== clientId ||
      normalizeResourceUrl(row.resource) !== resource ||
      row.oauthClientEnabled !== true ||
      row.oauthClientDeletedAt !== null
    ) {
      throw new OAuthRequestError(
        'invalid_grant',
        'OAuth authorization is invalid.',
      );
    }

    return row;
  }

  private async resolveAuthorizeRequest(
    query: OAuthAuthorizeQuery,
    workspace: Workspace,
  ): Promise<ResolvedAuthorizeRequest> {
    if (query.response_type !== 'code') {
      throw new BadRequestException('Only response_type=code is supported');
    }

    const codeChallenge = requireString(query.code_challenge, 'code_challenge');
    if (query.code_challenge_method !== 'S256') {
      throw new BadRequestException('Only PKCE S256 is supported');
    }

    const resource = requireAuthorizeResource(query.resource);
    const expectedResource = this.getMcpResourceUrl(workspace);
    if (resource !== expectedResource) {
      throw new BadRequestException('Invalid OAuth resource');
    }

    const mode = resolveMcpMode((workspace.settings as any)?.ai);
    if (mode === 'off') {
      throw new ForbiddenException('MCP is not enabled for this workspace');
    }

    const oauthClient = await this.getEnabledChatGptClient(workspace.id);
    const clientId = requireString(query.client_id, 'client_id');
    const redirectUri = requireString(query.redirect_uri, 'redirect_uri');
    this.assertSafeChatGptRedirectUri(redirectUri);

    const clientMetadata = await this.resolveClientMetadata(
      oauthClient,
      clientId,
    );
    if (clientMetadata) {
      if (clientMetadata.client_id !== clientId) {
        throw new BadRequestException(
          'OAuth client metadata client_id mismatch',
        );
      }
      if (!clientMetadata.redirect_uris?.includes(redirectUri)) {
        throw new BadRequestException('OAuth redirect_uri is not registered');
      }
    } else if (oauthClient.clientId !== clientId) {
      throw new BadRequestException('OAuth client is not registered');
    }

    const requestedScopes = normalizeScopes(
      parseScopes(query.scope),
      DEFAULT_OAUTH_SCOPES,
    );
    if (
      mode === 'read-only' &&
      requestedScopes.includes(OAuthScope.MCP_WRITE)
    ) {
      throw new ForbiddenException('MCP is enabled in read-only mode');
    }
    if (!isSubset(requestedScopes, oauthClient.allowedScopes)) {
      throw new ForbiddenException('Requested OAuth scope is not allowed');
    }

    return {
      oauthClient,
      clientId,
      clientName: truncate(
        clientMetadata?.client_name?.trim() || oauthClient.name || 'ChatGPT',
        255,
      ),
      clientUri: sanitizeOptionalUrl(clientMetadata?.client_uri),
      redirectUri,
      resource,
      scopes: requestedScopes,
      state: query.state,
      codeChallenge,
      codeChallengeMethod: 'S256',
    };
  }

  private async resolveClientMetadata(
    oauthClient: OAuthClientRow,
    clientId: string,
  ): Promise<OAuthClientMetadata | undefined> {
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      return undefined;
    }

    if (!oauthClient.allowClientIdMetadataDocuments) {
      throw new BadRequestException(
        'OAuth client metadata documents are disabled',
      );
    }

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname !== oauthClient.trustedClientIdHost
    ) {
      throw new BadRequestException(
        'OAuth client metadata host is not trusted',
      );
    }

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/json',
      },
    }).catch(() => {
      throw new BadRequestException(
        'OAuth client metadata could not be fetched',
      );
    });

    if (!response.ok) {
      throw new BadRequestException(
        'OAuth client metadata could not be fetched',
      );
    }

    const text = await response.text();
    if (text.length > 64 * 1024) {
      throw new BadRequestException('OAuth client metadata is too large');
    }

    let metadata: OAuthClientMetadata;
    try {
      metadata = JSON.parse(text);
    } catch {
      throw new BadRequestException('OAuth client metadata is invalid JSON');
    }

    return metadata;
  }

  private async getEnabledChatGptClient(workspaceId: string) {
    const client = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('provider', '=', OAUTH_PROVIDER_CHATGPT)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!client || !client.isEnabled) {
      throw new ForbiddenException('ChatGPT OAuth is not enabled');
    }

    return client;
  }

  private async upsertAuthorization(
    resolved: ResolvedAuthorizeRequest,
    user: User,
    workspace: Workspace,
  ) {
    const existing = await this.db
      .selectFrom('oauthAuthorizations')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .where('userId', '=', user.id)
      .where('clientId', '=', resolved.clientId)
      .where('resource', '=', resolved.resource)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();

    if (existing) {
      return this.db
        .updateTable('oauthAuthorizations')
        .set({
          oauthClientId: resolved.oauthClient.id,
          provider: resolved.oauthClient.provider,
          clientName: resolved.clientName,
          clientUri: resolved.clientUri ?? null,
          redirectUri: resolved.redirectUri,
          scopes: resolved.scopes,
          updatedAt: new Date(),
        })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirst();
    }

    return this.db
      .insertInto('oauthAuthorizations')
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        oauthClientId: resolved.oauthClient.id,
        provider: resolved.oauthClient.provider,
        clientId: resolved.clientId,
        clientName: resolved.clientName,
        clientUri: resolved.clientUri ?? null,
        redirectUri: resolved.redirectUri,
        resource: resolved.resource,
        scopes: resolved.scopes,
      })
      .returningAll()
      .executeTakeFirst();
  }

  private toClientView(
    row: OAuthClientRow,
    workspace: Workspace,
  ): OAuthClientView {
    const issuer = this.getIssuer(workspace);

    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      isEnabled: row.isEnabled,
      allowedScopes: row.allowedScopes,
      trustedClientIdHost: row.trustedClientIdHost,
      allowClientIdMetadataDocuments: row.allowClientIdMetadataDocuments,
      mcpServerUrl: this.getMcpResourceUrl(workspace),
      issuer,
      resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
      authorizationServerMetadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
      authorizationEndpoint: `${issuer}/oauth/authorize`,
      tokenEndpoint: `${issuer}/api/oauth/token`,
    };
  }

  private assertOwner(user: User) {
    if (user.role !== UserRole.OWNER) {
      throw new ForbiddenException();
    }
  }

  private assertSafeChatGptRedirectUri(redirectUri: string) {
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      throw new BadRequestException('Invalid redirect_uri');
    }

    const allowedPath =
      url.pathname.startsWith('/connector/oauth/') ||
      url.pathname === '/connector_platform_oauth_redirect';
    if (
      url.protocol !== 'https:' ||
      url.hostname !== CHATGPT_TRUSTED_CLIENT_ID_HOST ||
      url.username ||
      url.password ||
      url.port ||
      !allowedPath
    ) {
      throw new BadRequestException('OAuth redirect_uri is not trusted');
    }
  }

  private generateOpaqueToken(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
  }
}

function normalizeScopes(input: string[] | undefined, defaults: string[]) {
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

  return unique as OAuthScopeValue[];
}

function parseScopes(scope?: string) {
  return scope?.split(/\s+/).filter(Boolean) ?? [];
}

function isSubset(left: readonly string[], right: readonly string[]) {
  const rightSet = new Set(right);
  return left.every((scope) => rightSet.has(scope));
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}

function requireOAuthResource(value: unknown) {
  try {
    return normalizeResourceUrl(requireString(value, 'resource'));
  } catch {
    throw new OAuthRequestError('invalid_target', 'Invalid OAuth resource.');
  }
}

function requireAuthorizeResource(value: unknown) {
  try {
    return normalizeResourceUrl(requireString(value, 'resource'));
  } catch (err) {
    if (err instanceof BadRequestException) {
      throw err;
    }
    throw new BadRequestException('Invalid OAuth resource');
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function verifyPkceS256(verifier: string, challenge: string) {
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

function normalizeResourceUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = trimTrailingSlash(url.pathname);
  return url.toString();
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function appendRedirectParams(
  redirectUri: string,
  params: Record<string, string | undefined>,
) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function sanitizeOptionalUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

type McpMode = 'off' | 'read-only' | 'read-write';

function resolveMcpMode(aiSettings: any): McpMode {
  if (
    aiSettings?.mcpMode === 'read-only' ||
    aiSettings?.mcpMode === 'read-write'
  ) {
    return aiSettings.mcpMode;
  }
  if (aiSettings?.mcpMode === 'off') {
    return 'off';
  }

  return aiSettings?.mcp === true ? 'read-write' : 'off';
}
