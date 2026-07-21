import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { FastifyRequest } from 'fastify';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  OauthAuthorization,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import {
  DEFAULT_OAUTH_SCOPES,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
} from './oauth.constants';
import { OAuthClientService } from './oauth-client.service';
import { OAuthMetadataService } from './oauth-metadata.service';
import { ResolvedAuthorizeRequest } from './oauth.models';
import {
  appendRedirectParams,
  assertMcpScopesAllowed,
  buildAuthorizationKey,
  generateOpaqueToken,
  getRequestUserAgent,
  getUrlHost,
  hashToken,
  isSubset,
  normalizeScopes,
  parseScopes,
  requireAuthorizeResource,
  requireString,
  sanitizeOptionalUrl,
  truncate,
} from './oauth-protocol.utils';
import { OAuthAuthorizeQuery } from './oauth.types';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';
import { CredentialSpaceAccessService } from '../../core/credential-space-access/credential-space-access.service';
import {
  CredentialSpaceAccessInput,
  CredentialSpaceAccessView,
} from '../../core/credential-space-access/credential-space-access.types';
import { KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import { CredentialRevocationService } from '../../core/credential-space-access/credential-revocation.service';

@Injectable()
export class OAuthAuthorizationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly clientService: OAuthClientService,
    private readonly metadataService: OAuthMetadataService,
    private readonly providerRegistry: OAuthProviderRegistry,
    private readonly credentialSpaceAccess: CredentialSpaceAccessService,
    private readonly credentialRevocation: CredentialRevocationService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async listAuthorizations(
    workspace: Workspace,
    user: User,
    opts?: { adminView?: boolean },
  ) {
    if (opts?.adminView) this.assertOwner(user);

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
        'oa.spaceAccessMode',
        'oa.lastUsedAt',
        'oa.revokedAt',
        'oa.createdAt',
        'oa.updatedAt',
        'oa.userId',
        'oa.workspaceId',
        'u.name as userName',
        'u.email as userEmail',
        'u.avatarUrl as userAvatarUrl',
      ])
      .where('oa.workspaceId', '=', workspace.id)
      .where('oa.revokedAt', 'is', null)
      .orderBy('oa.createdAt', 'desc');

    if (!opts?.adminView) query = query.where('oa.userId', '=', user.id);
    const authorizations = await query.execute();
    return this.credentialSpaceAccess.addOAuthViews(authorizations);
  }

  async updateAuthorizationAccess(
    authorizationId: string,
    spaceAccess: CredentialSpaceAccessInput,
    workspace: Workspace,
    user: User,
    req?: FastifyRequest,
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
    if (authorization.userId !== user.id) {
      throw new ForbiddenException(
        'Only the authorization owner can change its space access',
      );
    }

    const selection = await this.credentialSpaceAccess.normalizeSelection(
      spaceAccess,
      user.id,
      workspace.id,
    );
    await this.db
      .transaction()
      .execute((trx) =>
        this.credentialSpaceAccess.replaceOAuthAuthorizationAccess(
          authorization.id,
          selection,
          trx,
        ),
      );

    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_OAUTH_AUTHORIZED,
        resourceType: AuditResource.MCP_OAUTH_AUTHORIZATION,
        resourceId: authorization.id,
        metadata: {
          action: 'space_access_updated',
          provider: authorization.provider,
          clientId: truncate(authorization.clientId, 255),
          clientName: authorization.clientName,
          authorizationUserId: authorization.userId,
          spaceAccessMode: selection.mode,
          selectedSpaceCount: selection.spaceIds.length,
          userAgent: getRequestUserAgent(req),
        },
      },
      {
        workspaceId: workspace.id,
        actorId: user.id,
        actorType: 'user',
        ipAddress: req?.ip,
      },
    );

    const updated = await this.db
      .selectFrom('oauthAuthorizations')
      .selectAll()
      .where('id', '=', authorization.id)
      .executeTakeFirstOrThrow();
    const [view] = await this.credentialSpaceAccess.addOAuthViews([updated]);
    return view;
  }

  async revokeAuthorization(
    authorizationId: string,
    workspace: Workspace,
    user: User,
    req?: FastifyRequest,
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

    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_OAUTH_REVOKED,
        resourceType: AuditResource.MCP_OAUTH_AUTHORIZATION,
        resourceId: authorization.id,
        metadata: {
          provider: authorization.provider,
          clientId: truncate(authorization.clientId, 255),
          clientName: authorization.clientName,
          redirectHost: getUrlHost(authorization.redirectUri),
          scopes: authorization.scopes,
          authorizationUserId: authorization.userId,
          revokedByAdmin: authorization.userId !== user.id,
          userAgent: getRequestUserAgent(req),
        },
      },
      {
        workspaceId: workspace.id,
        actorId: user.id,
        actorType: 'user',
        ipAddress: req?.ip,
      },
    );
  }

  async previewAuthorization(
    query: OAuthAuthorizeQuery,
    user: User,
    workspace: Workspace,
    req?: FastifyRequest,
  ) {
    const resolved = await this.resolveAuthorizeRequest(query, workspace, req);
    const availableSpaces =
      await this.credentialSpaceAccess.listSelectableSpaces(
        user.id,
        workspace.id,
      );
    const existing = await this.findActiveAuthorization(
      resolved,
      user.id,
      workspace.id,
    );
    const spaceAccess = existing
      ? (await this.credentialSpaceAccess.addOAuthViews([existing]))[0]
          .spaceAccess
      : defaultSpaceAccessView(availableSpaces.length);
    return {
      provider: resolved.oauthClient.provider,
      clientName: resolved.clientName,
      clientUri: resolved.clientUri,
      redirectUri: resolved.redirectUri,
      redirectHost: new URL(resolved.redirectUri).hostname,
      resource: resolved.resource,
      scopes: resolved.scopes,
      user: { id: user.id, name: user.name, email: user.email },
      availableSpaces,
      spaceAccess,
    };
  }

  async approveAuthorization(
    query: OAuthAuthorizeQuery,
    user: User,
    workspace: Workspace,
    req?: FastifyRequest,
  ) {
    const resolved = await this.resolveAuthorizeRequest(query, workspace, req);
    const existing = await this.findActiveAuthorization(
      resolved,
      user.id,
      workspace.id,
    );
    const selection = await this.resolveApprovalSelection(
      query.spaceAccess,
      existing,
      user,
      workspace,
    );
    const code = generateOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000,
    );

    const authorization = await this.db.transaction().execute(async (trx) => {
      const activeUser =
        await this.credentialRevocation.lockActiveUserForIssuance(
          user.id,
          workspace.id,
          trx,
        );
      if (!activeUser) {
        throw new ForbiddenException('User is no longer active');
      }
      const row = await this.upsertAuthorization(
        resolved,
        user,
        workspace,
        trx,
      );
      await this.credentialSpaceAccess.replaceOAuthAuthorizationAccess(
        row.id,
        selection,
        trx,
      );
      await trx
        .insertInto('oauthAuthorizationCodes')
        .values({
          codeHash: hashToken(code),
          workspaceId: workspace.id,
          userId: user.id,
          oauthClientId: resolved.oauthClient.id,
          authorizationId: row.id,
          clientId: resolved.clientId,
          redirectUri: resolved.redirectUri,
          resource: resolved.resource,
          scopes: resolved.scopes,
          codeChallenge: resolved.codeChallenge,
          codeChallengeMethod: resolved.codeChallengeMethod,
          expiresAt,
        })
        .execute();
      return row;
    });

    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_OAUTH_AUTHORIZED,
        resourceType: AuditResource.MCP_OAUTH_AUTHORIZATION,
        resourceId: authorization.id,
        metadata: {
          provider: resolved.oauthClient.provider,
          clientId: truncate(resolved.clientId, 255),
          clientName: resolved.clientName,
          redirectHost: getUrlHost(resolved.redirectUri),
          scopes: resolved.scopes,
          authorizationUserId: user.id,
          spaceAccessMode: selection.mode,
          selectedSpaceCount: selection.spaceIds.length,
          userAgent: getRequestUserAgent(req),
        },
      },
      {
        workspaceId: workspace.id,
        actorId: user.id,
        actorType: 'user',
        ipAddress: req?.ip,
      },
    );

    return {
      redirectUri: appendRedirectParams(resolved.redirectUri, {
        code,
        state: resolved.state,
      }),
    };
  }

  async denyAuthorization(query: OAuthAuthorizeQuery, _workspace: Workspace) {
    const redirectUri = requireString(query.redirect_uri, 'redirect_uri');
    this.providerRegistry.getDefault().assertRedirectUri(redirectUri);

    return {
      redirectUri: appendRedirectParams(redirectUri, {
        error: 'access_denied',
        error_description: 'The user denied the authorization request.',
        state: query.state,
      }),
    };
  }

  private async resolveAuthorizeRequest(
    query: OAuthAuthorizeQuery,
    workspace: Workspace,
    req?: FastifyRequest,
  ): Promise<ResolvedAuthorizeRequest> {
    if (query.response_type !== 'code') {
      throw new BadRequestException('Only response_type=code is supported');
    }

    const codeChallenge = requireString(query.code_challenge, 'code_challenge');
    if (query.code_challenge_method !== 'S256') {
      throw new BadRequestException('Only PKCE S256 is supported');
    }

    const resource = requireAuthorizeResource(query.resource);
    const expectedResource = this.metadataService.getMcpResourceUrl(
      workspace,
      req,
    );
    if (resource !== expectedResource) {
      throw new BadRequestException('Invalid OAuth resource');
    }

    const requestedScopes = normalizeScopes(
      parseScopes(query.scope),
      DEFAULT_OAUTH_SCOPES,
    );
    assertMcpScopesAllowed(workspace, requestedScopes);

    const oauthClient = await this.clientService.getEnabledDefaultClient(
      workspace.id,
    );
    const clientId = requireString(query.client_id, 'client_id');
    const redirectUri = requireString(query.redirect_uri, 'redirect_uri');
    this.clientService.assertRedirectUri(oauthClient, redirectUri);

    const clientMetadata = await this.clientService.resolveClientMetadata(
      oauthClient,
      clientId,
    );
    const registeredClient = clientMetadata
      ? undefined
      : await this.clientService.getRegisteredDcrClient(
          oauthClient.id,
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
    } else if (registeredClient) {
      if (!registeredClient.redirectUris.includes(redirectUri)) {
        throw new BadRequestException('OAuth redirect_uri is not registered');
      }
    } else if (oauthClient.clientId !== clientId) {
      throw new BadRequestException('OAuth client is not registered');
    }

    const clientAllowedScopes =
      registeredClient?.scopes ?? oauthClient.allowedScopes;
    if (
      !isSubset(requestedScopes, oauthClient.allowedScopes) ||
      !isSubset(requestedScopes, clientAllowedScopes)
    ) {
      throw new ForbiddenException('Requested OAuth scope is not allowed');
    }

    return {
      oauthClient,
      clientId,
      clientName: truncate(
        clientMetadata?.client_name?.trim() ||
          registeredClient?.clientName ||
          oauthClient.name ||
          'ChatGPT',
        255,
      ),
      clientUri:
        sanitizeOptionalUrl(clientMetadata?.client_uri) ||
        registeredClient?.clientUri,
      redirectUri,
      resource,
      scopes: requestedScopes,
      state: query.state,
      codeChallenge,
      codeChallengeMethod: 'S256',
    };
  }

  private async upsertAuthorization(
    resolved: ResolvedAuthorizeRequest,
    user: User,
    workspace: Workspace,
    trx?: KyselyTransaction,
  ) {
    const authorizationKey = buildAuthorizationKey(
      resolved.clientId,
      resolved.resource,
    );

    return dbOrTx(this.db, trx)
      .insertInto('oauthAuthorizations')
      .values({
        authorizationKey,
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
      .onConflict((conflict) =>
        conflict
          .columns(['workspaceId', 'userId', 'authorizationKey'])
          .where('revokedAt', 'is', null)
          .doUpdateSet({
            oauthClientId: resolved.oauthClient.id,
            provider: resolved.oauthClient.provider,
            clientName: resolved.clientName,
            clientUri: resolved.clientUri ?? null,
            redirectUri: resolved.redirectUri,
            scopes: resolved.scopes,
            updatedAt: new Date(),
          }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private findActiveAuthorization(
    resolved: ResolvedAuthorizeRequest,
    userId: string,
    workspaceId: string,
  ) {
    return this.db
      .selectFrom('oauthAuthorizations')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('userId', '=', userId)
      .where(
        'authorizationKey',
        '=',
        buildAuthorizationKey(resolved.clientId, resolved.resource),
      )
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
  }

  private async resolveApprovalSelection(
    input: CredentialSpaceAccessInput | undefined,
    existing: OauthAuthorization | undefined,
    user: User,
    workspace: Workspace,
  ) {
    if (input) {
      return this.credentialSpaceAccess.normalizeSelection(
        input,
        user.id,
        workspace.id,
      );
    }

    if (existing) {
      const [view] = await this.credentialSpaceAccess.addOAuthViews([existing]);
      return this.credentialSpaceAccess.normalizeSelection(
        view.spaceAccess.mode === 'selected'
          ? {
              mode: 'selected',
              spaceIds: view.spaceAccess.spaces.map((space) => space.id),
            }
          : { mode: 'all' },
        user.id,
        workspace.id,
      );
    }

    return this.credentialSpaceAccess.normalizeSelection(
      { mode: 'all' },
      user.id,
      workspace.id,
    );
  }

  private assertOwner(user: User) {
    if (user.role !== UserRole.OWNER) throw new ForbiddenException();
  }
}

function defaultSpaceAccessView(
  effectiveCount: number,
): CredentialSpaceAccessView {
  return {
    mode: 'all',
    spaces: [],
    selectedCount: 0,
    effectiveCount,
    status: effectiveCount > 0 ? 'active' : 'no_effective_spaces',
  };
}
