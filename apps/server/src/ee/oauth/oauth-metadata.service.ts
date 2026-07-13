import { Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Workspace } from '@docmost/db/types/entity.types';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { DomainService } from '../../integrations/environment/domain.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { OAuthScope, SUPPORTED_OAUTH_SCOPES } from './oauth.constants';
import {
  getRequestHost,
  getRequestValue,
  normalizeResourceUrl,
  trimTrailingSlash,
} from './oauth-protocol.utils';

@Injectable()
export class OAuthMetadataService {
  constructor(
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly domainService: DomainService,
    private readonly environmentService: EnvironmentService,
  ) {}

  getMcpResourceUrl(workspace: Workspace, req?: FastifyRequest): string {
    return normalizeResourceUrl(`${this.getIssuer(workspace, req)}/mcp`);
  }

  async resolveWorkspaceFromRequest(
    req?: FastifyRequest,
  ): Promise<Workspace | undefined> {
    const workspace = getRequestValue<Workspace>(req, 'workspace');
    if (workspace) return workspace;

    if (this.environmentService.isSelfHosted()) {
      return this.workspaceRepo.findFirst();
    }

    if (this.environmentService.isCloud()) {
      const subdomain = getRequestHost(req)?.split('.')[0];
      if (subdomain) return this.workspaceRepo.findByHostname(subdomain);
    }

    return undefined;
  }

  getIssuer(workspace: Workspace, _req?: FastifyRequest): string {
    return trimTrailingSlash(this.domainService.getUrl(workspace.hostname));
  }

  getProtectedResourceMetadata(workspace: Workspace, req?: FastifyRequest) {
    const issuer = this.getIssuer(workspace, req);

    return {
      resource: this.getMcpResourceUrl(workspace, req),
      authorization_servers: [issuer],
      scopes_supported: SUPPORTED_OAUTH_SCOPES,
      bearer_methods_supported: ['header'],
      resource_documentation: `${issuer}/settings/account/oauth`,
    };
  }

  getAuthorizationServerMetadata(workspace: Workspace, req?: FastifyRequest) {
    const issuer = this.getIssuer(workspace, req);

    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: SUPPORTED_OAUTH_SCOPES,
      registration_endpoint: `${issuer}/api/oauth/register`,
      token_endpoint_auth_methods_supported: ['none'],
      resource_documentation: `${issuer}/settings/account/oauth`,
    };
  }

  getWwwAuthenticateHeader(
    workspace: Workspace,
    scopes?: string[],
    req?: FastifyRequest,
  ) {
    const issuer = this.getIssuer(workspace, req);
    const resourceMetadataUrl = `${issuer}/.well-known/oauth-protected-resource/mcp`;
    const scope = scopes?.length ? scopes.join(' ') : OAuthScope.MCP_READ;

    return `Bearer resource_metadata="${resourceMetadataUrl}", scope="${scope}"`;
  }
}
