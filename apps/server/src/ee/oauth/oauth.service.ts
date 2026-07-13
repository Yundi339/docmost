import { Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtMcpOAuthPayload } from '../../core/auth/dto/jwt-payload';
import { OAuthAuthorizationService } from './oauth-authorization.service';
import { OAuthClientService } from './oauth-client.service';
import { OAuthMetadataService } from './oauth-metadata.service';
import { OAuthTokenService } from './oauth-token.service';
import {
  OAuthAuthorizeQuery,
  OAuthClientRegistrationRequest,
  OAuthTokenRequest,
} from './oauth.types';

export type { OAuthClientView } from './oauth.models';

@Injectable()
export class OAuthService {
  constructor(
    private readonly metadataService: OAuthMetadataService,
    private readonly clientService: OAuthClientService,
    private readonly authorizationService: OAuthAuthorizationService,
    private readonly tokenService: OAuthTokenService,
  ) {}

  getMcpResourceUrl(workspace: Workspace, req?: FastifyRequest) {
    return this.metadataService.getMcpResourceUrl(workspace, req);
  }

  resolveWorkspaceFromRequest(req?: FastifyRequest) {
    return this.metadataService.resolveWorkspaceFromRequest(req);
  }

  getIssuer(workspace: Workspace, req?: FastifyRequest) {
    return this.metadataService.getIssuer(workspace, req);
  }

  getProtectedResourceMetadata(workspace: Workspace, req?: FastifyRequest) {
    return this.metadataService.getProtectedResourceMetadata(workspace, req);
  }

  getAuthorizationServerMetadata(workspace: Workspace, req?: FastifyRequest) {
    return this.metadataService.getAuthorizationServerMetadata(workspace, req);
  }

  getWwwAuthenticateHeader(
    workspace: Workspace,
    scopes?: string[],
    req?: FastifyRequest,
  ) {
    return this.metadataService.getWwwAuthenticateHeader(
      workspace,
      scopes,
      req,
    );
  }

  listClients(workspace: Workspace, user: User, req?: FastifyRequest) {
    return this.clientService.listClients(workspace, user, req);
  }

  listAvailableClients(workspace: Workspace, req?: FastifyRequest) {
    return this.clientService.listAvailableClients(workspace, req);
  }

  registerClient(
    input: OAuthClientRegistrationRequest,
    workspace: Workspace,
    req?: FastifyRequest,
  ) {
    return this.clientService.registerClient(input, workspace, req);
  }

  updateClient(
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
    return this.clientService.updateClient(input, workspace, user, req);
  }

  listAuthorizations(
    workspace: Workspace,
    user: User,
    opts?: { adminView?: boolean },
  ) {
    return this.authorizationService.listAuthorizations(workspace, user, opts);
  }

  revokeAuthorization(
    authorizationId: string,
    workspace: Workspace,
    user: User,
    req?: FastifyRequest,
  ) {
    return this.authorizationService.revokeAuthorization(
      authorizationId,
      workspace,
      user,
      req,
    );
  }

  previewAuthorization(
    query: OAuthAuthorizeQuery,
    user: User,
    workspace: Workspace,
    req?: FastifyRequest,
  ) {
    return this.authorizationService.previewAuthorization(
      query,
      user,
      workspace,
      req,
    );
  }

  approveAuthorization(
    query: OAuthAuthorizeQuery,
    user: User,
    workspace: Workspace,
    req?: FastifyRequest,
  ) {
    return this.authorizationService.approveAuthorization(
      query,
      user,
      workspace,
      req,
    );
  }

  denyAuthorization(query: OAuthAuthorizeQuery, workspace: Workspace) {
    return this.authorizationService.denyAuthorization(query, workspace);
  }

  exchangeToken(
    body: OAuthTokenRequest,
    workspace: Workspace,
    req?: FastifyRequest,
  ) {
    return this.tokenService.exchangeToken(body, workspace, req);
  }

  validateAccessToken(
    payload: JwtMcpOAuthPayload,
    workspaceHint?: Workspace,
    req?: FastifyRequest,
  ) {
    return this.tokenService.validateAccessToken(payload, workspaceHint, req);
  }

  ensureDefaultChatGptClient(workspaceId: string, creatorId?: string) {
    return this.clientService.ensureDefaultChatGptClient(
      workspaceId,
      creatorId,
    );
  }
}
