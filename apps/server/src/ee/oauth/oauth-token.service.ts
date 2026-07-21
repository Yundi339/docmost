import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { FastifyRequest } from 'fastify';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { isUserDisabled } from '../../common/helpers';
import { TokenService as CoreTokenService } from '../../core/auth/services/token.service';
import { JwtMcpOAuthPayload } from '../../core/auth/dto/jwt-payload';
import {
  DEFAULT_OAUTH_SCOPES,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from './oauth.constants';
import { OAuthMetadataService } from './oauth-metadata.service';
import {
  assertMcpScopesAllowed,
  generateOpaqueToken,
  hashToken,
  isSubset,
  normalizeResourceUrl,
  normalizeScopes,
  parseScopes,
  requireOAuthResource,
  requireString,
  verifyPkceS256,
} from './oauth-protocol.utils';
import {
  OAuthRequestError,
  OAuthTokenRequest,
  OAuthTokenResponse,
} from './oauth.types';
import { CredentialSpaceAccessService } from '../../core/credential-space-access/credential-space-access.service';
import { CredentialRevocationService } from '../../core/credential-space-access/credential-revocation.service';

@Injectable()
export class OAuthTokenService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: CoreTokenService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly metadataService: OAuthMetadataService,
    private readonly credentialSpaceAccess: CredentialSpaceAccessService,
    private readonly credentialRevocation: CredentialRevocationService,
  ) {}

  async exchangeToken(
    body: OAuthTokenRequest,
    workspace: Workspace,
    req?: FastifyRequest,
  ): Promise<OAuthTokenResponse> {
    if (body.grant_type === 'authorization_code') {
      return this.exchangeAuthorizationCode(body, workspace, req);
    }
    if (body.grant_type === 'refresh_token') {
      return this.exchangeRefreshToken(body, workspace, req);
    }

    throw new OAuthRequestError(
      'unsupported_grant_type',
      'Only authorization_code and refresh_token grants are supported.',
    );
  }

  async validateAccessToken(
    payload: JwtMcpOAuthPayload,
    workspaceHint?: Workspace,
    req?: FastifyRequest,
  ) {
    const workspace =
      workspaceHint ?? (await this.workspaceRepo.findById(payload.workspaceId));
    if (!workspace) throw new ForbiddenException('Workspace not found');
    if (workspace.id !== payload.workspaceId) {
      throw new ForbiddenException('OAuth token workspace does not match');
    }

    const expectedResource = this.metadataService.getMcpResourceUrl(
      workspace,
      req,
    );
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
        'oa.spaceAccessMode',
        'oa.revokedAt',
        'oc.isEnabled as oauthClientEnabled',
        'oc.deletedAt as oauthClientDeletedAt',
        'oc.allowedScopes as oauthClientAllowedScopes',
      ])
      .where('oa.id', '=', payload.authorizationId)
      .where('oa.workspaceId', '=', payload.workspaceId)
      .where('oa.revokedAt', 'is', null)
      .executeTakeFirst();
    if (!authorization) {
      throw new ForbiddenException('OAuth authorization not found');
    }
    if (
      authorization.userId !== payload.sub ||
      authorization.clientId !== payload.clientId ||
      (authorization.oauthClientId ?? undefined) !== payload.oauthClientId ||
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
    assertMcpScopesAllowed(workspace, scopes);
    if (!isSubset(scopes, authorization.scopes)) {
      throw new ForbiddenException('OAuth token scopes are no longer valid');
    }
    if (!isSubset(scopes, authorization.oauthClientAllowedScopes ?? [])) {
      throw new ForbiddenException('OAuth client scopes are no longer valid');
    }
    const spaceAccess =
      await this.credentialSpaceAccess.resolveOAuthAuthorizationAccess({
        id: authorization.id,
        userId: authorization.userId,
        workspaceId: authorization.workspaceId,
        spaceAccessMode: authorization.spaceAccessMode,
      });

    const lastUsedBefore = new Date(Date.now() - 5 * 60 * 1000);
    this.db
      .updateTable('oauthAuthorizations')
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', authorization.id)
      .where((eb) =>
        eb.or([
          eb('lastUsedAt', 'is', null),
          eb('lastUsedAt', '<', lastUsedBefore),
        ]),
      )
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
        spaceAccess,
      },
    };
  }

  private async exchangeAuthorizationCode(
    body: OAuthTokenRequest,
    workspace: Workspace,
    req?: FastifyRequest,
  ): Promise<OAuthTokenResponse> {
    const code = requireString(body.code, 'code');
    const clientId = requireString(body.client_id, 'client_id');
    const redirectUri = requireString(body.redirect_uri, 'redirect_uri');
    const codeVerifier = requireString(body.code_verifier, 'code_verifier');
    const resource = requireOAuthResource(body.resource);
    const expectedResource = this.metadataService.getMcpResourceUrl(
      workspace,
      req,
    );
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
      codeRow.userId,
      codeRow.oauthClientId,
      clientId,
      resource,
    );
    const user = await this.userRepo.findById(codeRow.userId, workspace.id);
    if (!user || isUserDisabled(user)) {
      throw new OAuthRequestError('invalid_grant', 'User not found.');
    }
    const scopes = normalizeScopes(codeRow.scopes, DEFAULT_OAUTH_SCOPES);
    assertMcpScopesAllowed(workspace, scopes);
    if (!isSubset(scopes, authorization.scopes)) {
      throw new OAuthRequestError(
        'invalid_grant',
        'OAuth authorization scopes are no longer valid.',
      );
    }
    await this.assertAuthorizationSpaceAccess({
      id: authorization.id,
      userId: authorization.userId,
      workspaceId: workspace.id,
      spaceAccessMode: authorization.spaceAccessMode,
    });

    const refreshToken = generateOpaqueToken();
    const refreshTokenExpiresAt = new Date(
      now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    await this.db.transaction().execute(async (trx) => {
      const activeUser =
        await this.credentialRevocation.lockActiveUserForIssuance(
          user.id,
          workspace.id,
          trx,
        );
      if (!activeUser) {
        throw new OAuthRequestError('invalid_grant', 'User not found.');
      }
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
      scopes,
      refreshToken,
    });
  }

  private async exchangeRefreshToken(
    body: OAuthTokenRequest,
    workspace: Workspace,
    req?: FastifyRequest,
  ): Promise<OAuthTokenResponse> {
    const token = requireString(body.refresh_token, 'refresh_token');
    const clientId = requireString(body.client_id, 'client_id');
    const resource = requireOAuthResource(body.resource);
    const expectedResource = this.metadataService.getMcpResourceUrl(
      workspace,
      req,
    );
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

    let requestedScopes;
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
    assertMcpScopesAllowed(workspace, requestedScopes);

    const authorization = await this.getValidAuthorization(
      refreshRow.authorizationId,
      workspace.id,
      refreshRow.userId,
      refreshRow.oauthClientId,
      clientId,
      resource,
    );
    const user = await this.userRepo.findById(refreshRow.userId, workspace.id);
    if (!user || isUserDisabled(user)) {
      throw new OAuthRequestError('invalid_grant', 'User not found.');
    }
    if (!isSubset(requestedScopes, authorization.scopes)) {
      throw new OAuthRequestError(
        'invalid_scope',
        'Requested scope is no longer authorized.',
      );
    }
    await this.assertAuthorizationSpaceAccess({
      id: authorization.id,
      userId: authorization.userId,
      workspaceId: workspace.id,
      spaceAccessMode: authorization.spaceAccessMode,
    });

    const replacement = generateOpaqueToken();
    const replacementExpiresAt = new Date(
      now.getTime() + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
    );
    await this.db.transaction().execute(async (trx) => {
      const activeUser =
        await this.credentialRevocation.lockActiveUserForIssuance(
          user.id,
          workspace.id,
          trx,
        );
      if (!activeUser) {
        throw new OAuthRequestError('invalid_grant', 'User not found.');
      }
      const revokedToken = await trx
        .updateTable('oauthRefreshTokens')
        .set({ revokedAt: now, lastUsedAt: now })
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
        .executeTakeFirstOrThrow();
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
    scopes: string[];
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
    userId: string,
    oauthClientId: string | null,
    clientId: string,
    resource: string,
  ) {
    const row = await this.db
      .selectFrom('oauthAuthorizations as oa')
      .leftJoin('oauthClients as oc', 'oc.id', 'oa.oauthClientId')
      .select([
        'oa.id',
        'oa.oauthClientId',
        'oa.userId',
        'oa.clientId',
        'oa.resource',
        'oa.scopes',
        'oa.spaceAccessMode',
        'oa.revokedAt',
        'oc.isEnabled as oauthClientEnabled',
        'oc.deletedAt as oauthClientDeletedAt',
        'oc.allowedScopes as oauthClientAllowedScopes',
      ])
      .where('oa.id', '=', authorizationId)
      .where('oa.workspaceId', '=', workspaceId)
      .where('oa.revokedAt', 'is', null)
      .executeTakeFirst();
    if (
      !row ||
      row.userId !== userId ||
      row.oauthClientId !== oauthClientId ||
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
    if (!isSubset(row.scopes, row.oauthClientAllowedScopes ?? [])) {
      throw new OAuthRequestError(
        'invalid_grant',
        'OAuth client scopes are no longer valid.',
      );
    }
    return row;
  }

  private async assertAuthorizationSpaceAccess(input: {
    id: string;
    userId: string;
    workspaceId: string;
    spaceAccessMode: string;
  }) {
    try {
      await this.credentialSpaceAccess.resolveOAuthAuthorizationAccess(input);
    } catch {
      throw new OAuthRequestError(
        'invalid_grant',
        'OAuth authorization has no accessible spaces.',
      );
    }
  }
}
