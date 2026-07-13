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
import { User, Workspace } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { DEFAULT_OAUTH_SCOPES } from './oauth.constants';
import { OAuthClientRow, OAuthClientView } from './oauth.models';
import { OAuthMetadataService } from './oauth-metadata.service';
import {
  assertMcpScopesAllowed,
  generateOpaqueToken,
  getRequestUserAgent,
  getUrlHost,
  isSubset,
  normalizeRedirectUris,
  normalizeScopes,
  parseScopes,
  sameStringSet,
  sanitizeOptionalUrl,
  toRegisteredDcrClient,
  toRegistrationResponse,
  truncate,
} from './oauth-protocol.utils';
import {
  OAuthClientMetadata,
  OAuthClientRegistrationRequest,
  OAuthClientRegistrationResponse,
} from './oauth.types';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';

@Injectable()
export class OAuthClientService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly metadataService: OAuthMetadataService,
    private readonly providerRegistry: OAuthProviderRegistry,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async listClients(workspace: Workspace, user: User, req?: FastifyRequest) {
    this.assertOwner(user);
    await this.ensureDefaultChatGptClient(workspace.id, user.id);
    const rows = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();

    return rows.map((row) => this.toClientView(row, workspace, req));
  }

  async listAvailableClients(workspace: Workspace, req?: FastifyRequest) {
    const rows = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .where('isEnabled', '=', true)
      .orderBy('createdAt', 'asc')
      .execute();

    return rows.map((row) => this.toClientView(row, workspace, req));
  }

  async registerClient(
    input: OAuthClientRegistrationRequest,
    workspace: Workspace,
    req?: FastifyRequest,
  ): Promise<OAuthClientRegistrationResponse> {
    const provider = this.providerRegistry.getDefault();
    const redirectUris = normalizeRedirectUris(input.redirect_uris);
    redirectUris.forEach((redirectUri) =>
      provider.assertRedirectUri(redirectUri),
    );

    const requestedTokenEndpointAuthMethod =
      input.token_endpoint_auth_method?.trim() || 'none';
    if (requestedTokenEndpointAuthMethod !== 'none') {
      throw new BadRequestException(
        'Only token_endpoint_auth_method "none" is supported',
      );
    }
    const tokenEndpointAuthMethod = 'none' as const;

    const grantTypes = input.grant_types?.length
      ? input.grant_types
      : ['authorization_code', 'refresh_token'];
    if (
      grantTypes.some(
        (grantType) =>
          grantType !== 'authorization_code' && grantType !== 'refresh_token',
      )
    ) {
      throw new BadRequestException('Unsupported OAuth grant type');
    }

    const responseTypes = input.response_types?.length
      ? input.response_types
      : ['code'];
    if (responseTypes.some((responseType) => responseType !== 'code')) {
      throw new BadRequestException('Unsupported OAuth response type');
    }

    const scopes = normalizeScopes(
      parseScopes(input.scope),
      DEFAULT_OAUTH_SCOPES,
    );
    assertMcpScopesAllowed(workspace, scopes);

    const result = await this.db.transaction().execute(async (trx) => {
      const oauthClient = await trx
        .selectFrom('oauthClients')
        .selectAll()
        .where('workspaceId', '=', workspace.id)
        .where('provider', '=', provider.id)
        .where('deletedAt', 'is', null)
        .forUpdate()
        .executeTakeFirst();

      if (!oauthClient || !oauthClient.isEnabled) {
        throw new ForbiddenException('ChatGPT OAuth is not enabled');
      }
      if (!isSubset(scopes, oauthClient.allowedScopes)) {
        throw new ForbiddenException('Requested OAuth scope is not allowed');
      }

      const registrations = await trx
        .selectFrom('oauthRegisteredClients')
        .selectAll()
        .where('oauthClientId', '=', oauthClient.id)
        .orderBy('createdAt', 'desc')
        .execute();
      const existing = registrations.find((client) =>
        sameStringSet(client.redirectUris, redirectUris),
      );

      if (!existing && registrations.length >= 50) {
        throw new BadRequestException(
          'OAuth client registration limit has been reached',
        );
      }

      const now = new Date();
      const values = {
        clientName: truncate(
          input.client_name?.trim() || provider.defaults.name,
          255,
        ),
        clientUri: sanitizeOptionalUrl(input.client_uri) ?? null,
        redirectUris,
        grantTypes,
        responseTypes,
        tokenEndpointAuthMethod,
        scopes,
        updatedAt: now,
      };
      const row = existing
        ? await trx
            .updateTable('oauthRegisteredClients')
            .set(values)
            .where('id', '=', existing.id)
            .where('oauthClientId', '=', oauthClient.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('oauthRegisteredClients')
            .values({
              ...values,
              oauthClientId: oauthClient.id,
              clientId: `docmost-${generateOpaqueToken(24)}`,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

      return {
        oauthClient,
        registeredClient: toRegisteredDcrClient(row),
        existingRegistration: Boolean(existing),
      };
    });

    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_OAUTH_CLIENT_REGISTERED,
        resourceType: AuditResource.MCP_OAUTH_CLIENT,
        resourceId: result.oauthClient.id,
        metadata: {
          provider: result.oauthClient.provider,
          clientId: truncate(result.registeredClient.clientId, 255),
          clientName: result.registeredClient.clientName,
          redirectHosts: result.registeredClient.redirectUris
            .map(getUrlHost)
            .filter(Boolean),
          scopes: result.registeredClient.scopes,
          existingRegistration: result.existingRegistration,
          userAgent: getRequestUserAgent(req),
        },
      },
      {
        workspaceId: workspace.id,
        actorType: 'system',
        ipAddress: req?.ip,
      },
    );

    return toRegistrationResponse(result.registeredClient);
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
    req?: FastifyRequest,
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
    if (!client) throw new NotFoundException('OAuth client not found');

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
      .executeTakeFirstOrThrow();

    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_OAUTH_CLIENT_UPDATED,
        resourceType: AuditResource.MCP_OAUTH_CLIENT,
        resourceId: client.id,
        changes: {
          before: {
            name: client.name,
            isEnabled: client.isEnabled,
            allowedScopes: client.allowedScopes,
          },
          after: {
            name: row.name,
            isEnabled: row.isEnabled,
            allowedScopes: row.allowedScopes,
          },
        },
        metadata: {
          provider: row.provider,
          clientName: row.name,
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

    return this.toClientView(row, workspace, req);
  }

  async ensureDefaultChatGptClient(workspaceId: string, creatorId?: string) {
    const provider = this.providerRegistry.getDefault();
    const existing = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('provider', '=', provider.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (existing) return existing;

    return this.db
      .insertInto('oauthClients')
      .values({
        workspaceId,
        creatorId,
        provider: provider.id,
        name: provider.defaults.name,
        trustedClientIdHost: provider.defaults.trustedClientIdHost,
        allowClientIdMetadataDocuments:
          provider.defaults.allowClientIdMetadataDocuments,
        allowedScopes: DEFAULT_OAUTH_SCOPES,
        isEnabled: false,
        settings: {},
      })
      .onConflict((conflict) =>
        conflict
          .columns(['workspaceId', 'provider'])
          .where('deletedAt', 'is', null)
          .doNothing(),
      )
      .returningAll()
      .executeTakeFirst();
  }

  async getEnabledDefaultClient(workspaceId: string) {
    const provider = this.providerRegistry.getDefault();
    const client = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('provider', '=', provider.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!client || !client.isEnabled) {
      throw new ForbiddenException('ChatGPT OAuth is not enabled');
    }
    return client;
  }

  async getRegisteredDcrClient(oauthClientId: string, clientId: string) {
    const row = await this.db
      .selectFrom('oauthRegisteredClients')
      .selectAll()
      .where('oauthClientId', '=', oauthClientId)
      .where('clientId', '=', clientId)
      .executeTakeFirst();

    return row ? toRegisteredDcrClient(row) : undefined;
  }

  async resolveClientMetadata(
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
      headers: { Accept: 'application/json' },
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

    try {
      return JSON.parse(text) as OAuthClientMetadata;
    } catch {
      throw new BadRequestException('OAuth client metadata is invalid JSON');
    }
  }

  assertRedirectUri(oauthClient: OAuthClientRow, redirectUri: string) {
    this.providerRegistry
      .get(oauthClient.provider)
      .assertRedirectUri(redirectUri);
  }

  private toClientView(
    row: OAuthClientRow,
    workspace: Workspace,
    req?: FastifyRequest,
  ): OAuthClientView {
    const issuer = this.metadataService.getIssuer(workspace, req);

    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      isEnabled: row.isEnabled,
      allowedScopes: row.allowedScopes,
      trustedClientIdHost: row.trustedClientIdHost,
      allowClientIdMetadataDocuments: row.allowClientIdMetadataDocuments,
      mcpServerUrl: this.metadataService.getMcpResourceUrl(workspace, req),
      issuer,
      resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
      authorizationServerMetadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
      authorizationEndpoint: `${issuer}/oauth/authorize`,
      tokenEndpoint: `${issuer}/api/oauth/token`,
      registrationEndpoint: `${issuer}/api/oauth/register`,
    };
  }

  private assertOwner(user: User) {
    if (user.role !== UserRole.OWNER) throw new ForbiddenException();
  }
}
