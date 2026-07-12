import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ShareRepo,
  SharePasswordState,
} from '@docmost/db/repos/share/share.repo';
import { comparePasswordHash } from '../../common/helpers';
import { TokenService } from '../auth/services/token.service';
import {
  JwtAttachmentPayload,
  JwtShareAccessPayload,
  JwtType,
} from '../auth/dto/jwt-payload';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { ShareService } from './share.service';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';

export const SHARE_PASSWORD_REQUIRED = 'SHARE_PASSWORD_REQUIRED';
export const SHARE_PASSWORD_INVALID = 'SHARE_PASSWORD_INVALID';
const SHARE_ACCESS_COOKIE_PREFIX = 'share_access_';
const SHARE_ACCESS_MAX_AGE_SECONDS = 12 * 60 * 60;
const FAILED_UNLOCK_AUDIT_WINDOW_MS = 5 * 60 * 1000;
const FAILED_UNLOCK_AUDIT_MAX_KEYS = 5_000;

export type ShareAccessInput = {
  shareId?: string;
  pageId?: string;
};

@Injectable()
export class ShareAccessService {
  private readonly failedUnlockAudit = new Map<string, number>();
  private lastFailedUnlockPruneAt = 0;

  constructor(
    private readonly shareRepo: ShareRepo,
    private readonly shareService: ShareService,
    private readonly tokenService: TokenService,
    private readonly environmentService: EnvironmentService,
    private readonly pageRepo: PageRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async assertRequestAccess(
    request: FastifyRequest,
    input: ShareAccessInput,
  ): Promise<SharePasswordState> {
    const workspaceId = this.getWorkspaceId(request);
    const state = await this.resolvePasswordState(input, workspaceId);
    if (!state.passwordHash) {
      return state;
    }

    const token = request.cookies?.[this.getCookieName(state.id)];
    if (!(await this.isValidCapability(token, state))) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Share password required',
        code: SHARE_PASSWORD_REQUIRED,
      });
    }
    return state;
  }

  async unlock(
    request: FastifyRequest,
    reply: FastifyReply,
    input: ShareAccessInput & { password: string },
  ): Promise<{ passwordProtected: boolean }> {
    const workspaceId = this.getWorkspaceId(request);
    const state = await this.resolvePasswordState(input, workspaceId);
    if (!state.passwordHash) {
      return { passwordProtected: false };
    }

    if (!(await comparePasswordHash(input.password, state.passwordHash))) {
      this.auditFailedUnlock(request, state);
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Unable to unlock shared page',
        code: SHARE_PASSWORD_INVALID,
      });
    }

    const token = await this.tokenService.generateShareAccessToken({
      shareId: state.id,
      workspaceId: state.workspaceId,
      passwordVersion: state.passwordVersion,
    });
    reply.setCookie(this.getCookieName(state.id), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.environmentService.isHttps(),
      path: '/',
      maxAge: SHARE_ACCESS_MAX_AGE_SECONDS,
    });

    return { passwordProtected: true };
  }

  async hasRequestAccess(
    request: FastifyRequest,
    shareId: string,
    workspaceId: string,
  ): Promise<boolean> {
    let state: SharePasswordState;
    try {
      state = await this.resolvePasswordState({ shareId }, workspaceId);
    } catch {
      return false;
    }
    if (!state.passwordHash) {
      return true;
    }
    return this.isValidCapability(
      request.cookies?.[this.getCookieName(state.id)],
      state,
    );
  }

  async validateAttachmentCapability(
    payload: JwtAttachmentPayload,
  ): Promise<boolean> {
    if (!payload.shareId || !Number.isInteger(payload.sharePasswordVersion)) {
      return false;
    }
    const state = await this.shareRepo.findPasswordStateById(payload.shareId);
    if (
      !state ||
      state.workspaceId !== payload.workspaceId ||
      !state.pageId ||
      state.passwordVersion !== payload.sharePasswordVersion
    ) {
      return false;
    }
    try {
      await this.assertShareIsPublic(state, payload.pageId);
      return true;
    } catch {
      return false;
    }
  }

  getCookieName(shareId: string): string {
    return `${SHARE_ACCESS_COOKIE_PREFIX}${shareId}`;
  }

  private async resolvePasswordState(
    input: ShareAccessInput,
    workspaceId: string,
  ): Promise<SharePasswordState> {
    if (!input.shareId && !input.pageId) {
      throw new BadRequestException('shareId or pageId is required');
    }

    const resolvedShareId = input.shareId
      ? (await this.shareRepo.findById(input.shareId))?.id
      : (await this.shareService.getShareForPage(input.pageId, workspaceId))
          ?.id;
    if (!resolvedShareId) {
      throw new NotFoundException('Share not found');
    }

    const state = await this.shareRepo.findPasswordStateById(resolvedShareId);
    if (!state || state.workspaceId !== workspaceId) {
      throw new NotFoundException('Share not found');
    }
    await this.assertShareIsPublic(state, input.pageId);
    return state;
  }

  private async assertShareIsPublic(
    state: SharePasswordState,
    requestedPageId?: string,
  ): Promise<void> {
    if (
      !(await this.shareService.isSharingAllowed(
        state.workspaceId,
        state.spaceId,
      ))
    ) {
      throw new NotFoundException('Share not found');
    }

    const page = await this.pageRepo.findById(requestedPageId || state.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== state.workspaceId ||
      page.spaceId !== state.spaceId ||
      (await this.pagePermissionRepo.hasRestrictedAncestor(page.id))
    ) {
      throw new NotFoundException('Share not found');
    }
  }

  private async isValidCapability(
    token: string | undefined,
    state: SharePasswordState,
  ): Promise<boolean> {
    if (!token) return false;
    try {
      const payload = (await this.tokenService.verifyJwt(
        token,
        JwtType.SHARE_ACCESS,
      )) as JwtShareAccessPayload;
      return (
        payload.shareId === state.id &&
        payload.workspaceId === state.workspaceId &&
        payload.passwordVersion === state.passwordVersion
      );
    } catch {
      return false;
    }
  }

  private getWorkspaceId(request: FastifyRequest): string {
    const workspaceId = (request.raw as any)?.workspace?.id;
    if (!workspaceId) {
      throw new NotFoundException('Share not found');
    }
    return workspaceId;
  }

  private auditFailedUnlock(
    request: FastifyRequest,
    state: SharePasswordState,
  ): void {
    const ipAddress = request.ip || request.socket?.remoteAddress || undefined;
    const key = `${state.workspaceId}:${state.id}:${ipAddress ?? 'unknown'}`;
    const now = Date.now();
    const lastAuditAt = this.failedUnlockAudit.get(key);
    if (lastAuditAt && now - lastAuditAt < FAILED_UNLOCK_AUDIT_WINDOW_MS) {
      return;
    }

    this.pruneFailedUnlockAudit(now);
    this.failedUnlockAudit.set(key, now);
    this.auditService.logWithContext(
      {
        event: AuditEvent.SHARE_PASSWORD_UNLOCK_FAILED,
        resourceType: AuditResource.SHARE,
        resourceId: state.id,
        spaceId: state.spaceId,
        metadata: { pageId: state.pageId, sampled: true },
      },
      {
        workspaceId: state.workspaceId,
        actorType: 'system',
        ipAddress,
        userAgent: request.headers['user-agent'],
      },
    );
  }

  private pruneFailedUnlockAudit(now: number): void {
    if (
      this.failedUnlockAudit.size >= FAILED_UNLOCK_AUDIT_MAX_KEYS ||
      now - this.lastFailedUnlockPruneAt >= FAILED_UNLOCK_AUDIT_WINDOW_MS
    ) {
      for (const [key, timestamp] of this.failedUnlockAudit) {
        if (now - timestamp >= FAILED_UNLOCK_AUDIT_WINDOW_MS) {
          this.failedUnlockAudit.delete(key);
        }
      }
      this.lastFailedUnlockPruneAt = now;
    }
    while (this.failedUnlockAudit.size >= FAILED_UNLOCK_AUDIT_MAX_KEYS) {
      const oldestKey = this.failedUnlockAudit.keys().next().value;
      if (!oldestKey) break;
      this.failedUnlockAudit.delete(oldestKey);
    }
  }
}
