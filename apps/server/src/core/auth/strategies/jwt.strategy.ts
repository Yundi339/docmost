import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { JwtApiKeyPayload, JwtPayload, JwtType } from '../dto/jwt-payload';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { SessionActivityService } from '../../session/session-activity.service';
import { FastifyRequest } from 'fastify';
import {
  extractBearerTokenFromHeader,
  isUserDisabled,
} from '../../../common/helpers';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private logger = new Logger('JwtStrategy');

  constructor(
    private userRepo: UserRepo,
    private workspaceRepo: WorkspaceRepo,
    private userSessionRepo: UserSessionRepo,
    private sessionActivityService: SessionActivityService,
    private readonly environmentService: EnvironmentService,
    private moduleRef: ModuleRef,
  ) {
    super({
      jwtFromRequest: (req: FastifyRequest) => {
        return extractBearerTokenFromHeader(req) || req.cookies?.authToken;
      },
      ignoreExpiration: false,
      secretOrKey: environmentService.getAppSecret(),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload | JwtApiKeyPayload) {
    req.raw.authType = payload.type;

    if (!payload.workspaceId) {
      throw new UnauthorizedException();
    }

    if (req.raw.workspaceId && req.raw.workspaceId !== payload.workspaceId) {
      throw new UnauthorizedException('Workspace does not match');
    }

    if (payload.type === JwtType.API_KEY) {
      return this.validateApiKey(req, payload as JwtApiKeyPayload);
    }

    if (payload.type !== JwtType.ACCESS) {
      throw new UnauthorizedException();
    }
    if (!payload.sessionId) {
      throw new UnauthorizedException('Active session is required');
    }

    const workspace = await this.workspaceRepo.findActiveById(
      payload.workspaceId,
    );

    if (!workspace) {
      throw new UnauthorizedException();
    }
    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);

    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException();
    }

    const session = await this.userSessionRepo.findActiveById(
      payload.sessionId,
    );
    if (
      !session ||
      session.userId !== payload.sub ||
      session.workspaceId !== payload.workspaceId
    ) {
      throw new UnauthorizedException();
    }
    req.raw.sessionId = payload.sessionId;
    this.sessionActivityService.trackActivity(
      payload.sessionId,
      payload.sub,
      payload.workspaceId,
    );

    return {
      user: {
        ...user,
        sessionId: payload.sessionId,
      },
      workspace,
    };
  }

  private async validateApiKey(req: any, payload: JwtApiKeyPayload) {
    // Try EE module first, then fall back to OSS ApiKeyService
    let ApiKeyModule: any;
    let isApiKeyModuleReady = false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ApiKeyModule = require('./../../../ee/api-key/api-key.service');
      isApiKeyModuleReady = true;
    } catch (err) {
      isApiKeyModuleReady = false;
    }

    if (isApiKeyModuleReady) {
      const ApiKeyService = this.moduleRef.get(ApiKeyModule.ApiKeyService, {
        strict: false,
      });

      const authContext = await ApiKeyService.validateApiKey(
        payload,
        this.getApiKeyMetadata(req),
      );
      req.raw.apiKey = authContext.apiKey;
      return authContext;
    }

    // Fallback to OSS ApiKeyService
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ApiKeyService } = require('../../api-key/api-key.service');
      const apiKeyService = this.moduleRef.get(ApiKeyService, {
        strict: false,
      });
      const authContext = await apiKeyService.validateApiKey(
        payload,
        this.getApiKeyMetadata(req),
      );
      req.raw.apiKey = authContext.apiKey;
      return authContext;
    } catch (err) {
      throw new UnauthorizedException('API Key module not available');
    }
  }

  private getApiKeyMetadata(req: any) {
    const forwardedFor = req.headers?.['x-forwarded-for'];
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(',')[0]?.trim() || req.ip;

    return {
      ipAddress,
      userAgent: req.headers?.['user-agent'],
    };
  }
}
