import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import {
  JwtApiKeyPayload,
  JwtAttachmentPayload,
  JwtCollabPayload,
  JwtExchangePayload,
  JwtMcpOAuthPayload,
  JwtMfaTokenPayload,
  JwtPayload,
  JwtShareAccessPayload,
  JwtType,
} from '../dto/jwt-payload';
import { User } from '@docmost/db/types/entity.types';
import { isUserDisabled } from '../../../common/helpers';
import { LoginFlowContext } from './login-flow.service';
import { randomUUID } from 'node:crypto';

@Injectable()
export class TokenService {
  constructor(private jwtService: JwtService) {}

  async generateAccessToken(user: User, sessionId: string): Promise<string> {
    if (isUserDisabled(user)) {
      throw new ForbiddenException();
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      workspaceId: user.workspaceId,
      type: JwtType.ACCESS,
      sessionId,
    };
    return this.jwtService.sign(payload);
  }

  async generateCollabToken(user: User, workspaceId: string): Promise<string> {
    if (isUserDisabled(user)) {
      throw new ForbiddenException();
    }

    const payload: JwtCollabPayload = {
      sub: user.id,
      workspaceId,
      type: JwtType.COLLAB,
    };
    const expiresIn = '24h';
    return this.jwtService.sign(payload, { expiresIn });
  }

  async generateExchangeToken(
    userId: string,
    workspaceId: string,
  ): Promise<string> {
    const payload: JwtExchangePayload = {
      sub: userId,
      workspaceId: workspaceId,
      type: JwtType.EXCHANGE,
    };
    return this.jwtService.sign(payload, { expiresIn: '10s' });
  }

  async generateAttachmentToken(opts: {
    attachmentId: string;
    pageId: string;
    workspaceId: string;
    shareId: string;
    sharePasswordVersion: number;
  }): Promise<string> {
    const { attachmentId, pageId, workspaceId, shareId, sharePasswordVersion } =
      opts;
    const payload: JwtAttachmentPayload = {
      attachmentId,
      pageId,
      workspaceId,
      shareId,
      sharePasswordVersion,
      type: JwtType.ATTACHMENT,
    };
    return this.jwtService.sign(payload, { expiresIn: '1h' });
  }

  async generateShareAccessToken(opts: {
    shareId: string;
    workspaceId: string;
    passwordVersion: number;
  }): Promise<string> {
    const payload: JwtShareAccessPayload = {
      ...opts,
      type: JwtType.SHARE_ACCESS,
    };
    return this.jwtService.sign(payload, { expiresIn: '12h' });
  }

  async generateMfaToken(
    user: User,
    workspaceId: string,
    context: LoginFlowContext,
  ): Promise<string> {
    if (isUserDisabled(user)) {
      throw new ForbiddenException();
    }

    const payload: JwtMfaTokenPayload = {
      sub: user.id,
      workspaceId,
      type: JwtType.MFA_TOKEN,
      jti: randomUUID(),
      primaryAuth: context.primaryAuth,
      passkeyId: context.passkeyId,
      authTime: context.authTime ?? new Date().toISOString(),
    };
    return this.jwtService.sign(payload, { expiresIn: '5m' });
  }

  async generateApiToken(opts: {
    apiKeyId: string;
    user: User;
    workspaceId: string;
    scopes?: string[];
    expiresIn: StringValue | number;
  }): Promise<string> {
    const { apiKeyId, user, workspaceId, scopes, expiresIn } = opts;
    if (isUserDisabled(user)) {
      throw new ForbiddenException();
    }

    const payload: JwtApiKeyPayload = {
      sub: user.id,
      apiKeyId: apiKeyId,
      workspaceId,
      scopes,
      type: JwtType.API_KEY,
    };

    return this.jwtService.sign(payload, { expiresIn });
  }

  async generateMcpOAuthAccessToken(opts: {
    user: User;
    workspaceId: string;
    authorizationId: string;
    oauthClientId?: string;
    clientId: string;
    resource: string;
    scopes?: string[];
    expiresIn: StringValue | number;
  }): Promise<string> {
    const {
      user,
      workspaceId,
      authorizationId,
      oauthClientId,
      clientId,
      resource,
      scopes,
      expiresIn,
    } = opts;
    if (isUserDisabled(user)) {
      throw new ForbiddenException();
    }

    const payload: JwtMcpOAuthPayload = {
      sub: user.id,
      workspaceId,
      authorizationId,
      oauthClientId,
      clientId,
      resource,
      scopes,
      type: JwtType.MCP_OAUTH,
    };

    return this.jwtService.sign(payload, {
      expiresIn,
      audience: resource,
    });
  }

  async verifyJwt(token: string, tokenType: string) {
    const payload = await this.jwtService.verifyAsync(token);

    if (payload.type !== tokenType) {
      throw new UnauthorizedException(
        'Invalid JWT token. Token type does not match.',
      );
    }

    return payload;
  }

  async verifyAnyJwt(token: string) {
    return this.jwtService.verifyAsync(token);
  }
}
