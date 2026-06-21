import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User } from '@docmost/db/types/entity.types';
import { OAuthService } from './oauth.service';
import {
  OAuthAuthorizeQuery,
  OAuthClientRegistrationRequest,
  OAuthRequestError,
  OAuthTokenRequest,
} from './oauth.types';

@Controller('.well-known')
export class OAuthMetadataController {
  constructor(private readonly oauthService: OAuthService) {}

  @SkipTransform()
  @Get('oauth-protected-resource/mcp')
  async protectedResourceForMcp(@Req() req: FastifyRequest) {
    return this.oauthService.getProtectedResourceMetadata(
      await getWorkspaceFromRequest(this.oauthService, req),
      req,
    );
  }

  @SkipTransform()
  @Get('oauth-protected-resource')
  async protectedResource(@Req() req: FastifyRequest) {
    return this.oauthService.getProtectedResourceMetadata(
      await getWorkspaceFromRequest(this.oauthService, req),
      req,
    );
  }

  @SkipTransform()
  @Get('oauth-authorization-server')
  async authorizationServer(@Req() req: FastifyRequest) {
    return this.oauthService.getAuthorizationServerMetadata(
      await getWorkspaceFromRequest(this.oauthService, req),
      req,
    );
  }

  @SkipTransform()
  @Get('oauth-authorization-server/mcp')
  async authorizationServerForMcp(@Req() req: FastifyRequest) {
    return this.oauthService.getAuthorizationServerMetadata(
      await getWorkspaceFromRequest(this.oauthService, req),
      req,
    );
  }

  @SkipTransform()
  @Get('openid-configuration')
  async openIdConfiguration(@Req() req: FastifyRequest) {
    return this.oauthService.getAuthorizationServerMetadata(
      await getWorkspaceFromRequest(this.oauthService, req),
      req,
    );
  }

  @SkipTransform()
  @Get('openid-configuration/mcp')
  async openIdConfigurationForMcp(@Req() req: FastifyRequest) {
    return this.oauthService.getAuthorizationServerMetadata(
      await getWorkspaceFromRequest(this.oauthService, req),
      req,
    );
  }
}

@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @SkipTransform()
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  async register(
    @Body() body: OAuthClientRegistrationRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');

    return this.oauthService.registerClient(
      body || {},
      await getWorkspaceFromRequest(this.oauthService, req),
    );
  }

  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post('token')
  async token(
    @Body() body: OAuthTokenRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');

    try {
      return await this.oauthService.exchangeToken(
        normalizeBody(body) as OAuthTokenRequest,
        await getWorkspaceFromRequest(this.oauthService, req),
        req,
      );
    } catch (err) {
      if (err instanceof OAuthRequestError) {
        reply.status(err.statusCode);
        return {
          error: err.errorCode,
          error_description: err.errorDescription,
        };
      }
      if (err instanceof BadRequestException) {
        reply.status(HttpStatus.BAD_REQUEST);
        return {
          error: 'invalid_request',
          error_description: extractErrorMessage(err),
        };
      }
      throw err;
    }
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('clients')
  async listClients(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    return this.oauthService.listClients(workspace, user, req);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('clients/available')
  async listAvailableClients(
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    return this.oauthService.listAvailableClients(workspace, req);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('clients/update')
  async updateClient(
    @Body()
    input: {
      clientId: string;
      name?: string;
      isEnabled?: boolean;
      allowedScopes?: string[];
    },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    return this.oauthService.updateClient(input, workspace, user, req);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('authorizations')
  async listAuthorizations(
    @Body() input: { adminView?: boolean },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.oauthService.listAuthorizations(workspace, user, {
      adminView: input?.adminView === true,
    });
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('authorizations/revoke')
  async revokeAuthorization(
    @Body() input: { authorizationId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.oauthService.revokeAuthorization(
      input.authorizationId,
      workspace,
      user,
    );
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('authorize/info')
  async authorizeInfo(
    @Body() query: OAuthAuthorizeQuery,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    return this.oauthService.previewAuthorization(query, user, workspace, req);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('authorize/approve')
  async approveAuthorization(
    @Body() query: OAuthAuthorizeQuery,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    return this.oauthService.approveAuthorization(query, user, workspace, req);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('authorize/deny')
  async denyAuthorization(
    @Body() query: OAuthAuthorizeQuery,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.oauthService.denyAuthorization(query, workspace);
  }
}

async function getWorkspaceFromRequest(
  oauthService: OAuthService,
  req: FastifyRequest,
): Promise<Workspace> {
  const workspace = await oauthService.resolveWorkspaceFromRequest(req);
  if (!workspace) {
    throw new NotFoundException('Workspace not found');
  }
  return workspace;
}

function normalizeBody(body: unknown) {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    normalized[key] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}

function extractErrorMessage(err: BadRequestException) {
  const response = err.getResponse();
  if (typeof response === 'string') return response;
  if (
    response &&
    typeof response === 'object' &&
    'message' in response &&
    typeof response.message === 'string'
  ) {
    return response.message;
  }
  return err.message || 'Invalid OAuth token request.';
}
