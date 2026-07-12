import { Injectable } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

@Injectable()
export class AuthCookieService {
  constructor(private readonly environmentService: EnvironmentService) {}

  setAuthCookie(reply: FastifyReply, token: string): void {
    reply.setCookie('authToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });
  }

  setMfaCookie(reply: FastifyReply, token: string): void {
    reply.setCookie('mfaToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
      secure: this.environmentService.isHttps(),
    });
  }

  clearMfaCookie(reply: FastifyReply): void {
    reply.clearCookie('mfaToken', { path: '/' });
  }
}
