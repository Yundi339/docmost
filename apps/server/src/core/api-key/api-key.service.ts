import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiKeyRepo } from '@docmost/db/repos/api-key/api-key.repo';
import { TokenService } from '../auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { JwtApiKeyPayload } from '../auth/dto/jwt-payload';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { UserRole } from '../../common/helpers/types/permission';
import { isUserDisabled } from '../../common/helpers';
import {
  DEFAULT_API_KEY_SCOPES,
  LEGACY_API_KEY_SCOPES,
  normalizeApiKeyScopes,
} from './api-key-scopes';

export type ApiKeyAuthMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async findApiKeys(
    workspace: Workspace,
    pagination: PaginationOptions,
    user: User,
  ) {
    if (pagination.adminView) {
      if (!this.canManageWorkspaceApiKeys(user)) {
        throw new ForbiddenException();
      }
      return this.apiKeyRepo.findApiKeys(workspace.id, pagination);
    }

    return this.apiKeyRepo.findApiKeys(workspace.id, pagination, user.id);
  }

  async create(dto: CreateApiKeyDto, user: User, workspace: Workspace) {
    if (
      (workspace.settings as any)?.api?.restrictToAdmins === true &&
      !isWorkspaceAdmin(user)
    ) {
      throw new ForbiddenException('API key creation is restricted to admins');
    }

    const scopes = normalizeApiKeyScopes(dto.scopes, DEFAULT_API_KEY_SCOPES);
    const expiresAt = this.parseExpirationDate(dto.expiresAt);

    const apiKey = await this.apiKeyRepo.insertApiKey({
      name: dto.name,
      creatorId: user.id,
      workspaceId: workspace.id,
      expiresAt,
      scopes,
    });

    const expiresInSec = Math.max(
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      60,
    );

    const token = await this.tokenService.generateApiToken({
      apiKeyId: apiKey.id,
      user,
      workspaceId: workspace.id,
      expiresIn: expiresInSec,
      scopes,
    });

    this.auditService.log({
      event: AuditEvent.API_KEY_CREATED,
      resourceType: AuditResource.API_KEY,
      resourceId: apiKey.id,
      metadata: { scopes },
    });

    const result = await this.apiKeyRepo.findById(apiKey.id, workspace.id);

    return { ...result, token };
  }

  async update(dto: UpdateApiKeyDto, workspace: Workspace, user: User) {
    const apiKey = await this.apiKeyRepo.findById(dto.apiKeyId, workspace.id);
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    if (apiKey.creatorId !== user.id && !this.canManageWorkspaceApiKeys(user)) {
      throw new ForbiddenException();
    }

    await this.apiKeyRepo.updateApiKey(
      { name: dto.name },
      dto.apiKeyId,
      workspace.id,
    );

    this.auditService.log({
      event: AuditEvent.API_KEY_UPDATED,
      resourceType: AuditResource.API_KEY,
      resourceId: apiKey.id,
      metadata: {
        creatorId: apiKey.creatorId,
        renamedByAdmin: apiKey.creatorId !== user.id,
      },
    });

    return this.apiKeyRepo.findById(dto.apiKeyId, workspace.id);
  }

  async revoke(apiKeyId: string, workspace: Workspace, user: User) {
    const apiKey = await this.apiKeyRepo.findById(apiKeyId, workspace.id);
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    if (apiKey.creatorId !== user.id && !this.canManageWorkspaceApiKeys(user)) {
      throw new ForbiddenException();
    }

    await this.apiKeyRepo.softDelete(apiKeyId, workspace.id);

    this.auditService.log({
      event: AuditEvent.API_KEY_DELETED,
      resourceType: AuditResource.API_KEY,
      resourceId: apiKey.id,
      metadata: {
        creatorId: apiKey.creatorId,
        revokedByAdmin: apiKey.creatorId !== user.id,
      },
    });
  }

  async validateApiKey(
    payload: JwtApiKeyPayload,
    metadata?: ApiKeyAuthMetadata,
  ) {
    const apiKey = await this.apiKeyRepo.findById(
      payload.apiKeyId,
      payload.workspaceId,
    );

    if (!apiKey) {
      throw new ForbiddenException('Invalid API key');
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      throw new ForbiddenException('API key expired');
    }

    const workspace = await this.workspaceRepo.findById(payload.workspaceId);
    if (!workspace) {
      throw new ForbiddenException('Workspace not found');
    }

    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);
    if (!user || isUserDisabled(user)) {
      throw new ForbiddenException('User not found');
    }

    const scopes = normalizeApiKeyScopes(apiKey.scopes, LEGACY_API_KEY_SCOPES);

    this.apiKeyRepo.updateLastUsed(apiKey.id, metadata).catch(() => {});

    return {
      user,
      workspace,
      apiKey: {
        id: apiKey.id,
        creatorId: apiKey.creatorId,
        scopes,
      },
    };
  }

  private canManageWorkspaceApiKeys(user: User) {
    return isWorkspaceOwner(user);
  }

  private parseExpirationDate(expiresAt: string | undefined) {
    if (!expiresAt) {
      throw new BadRequestException('API key expiration is required');
    }

    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('API key expiration is invalid');
    }

    if (date <= new Date()) {
      throw new BadRequestException('API key expiration must be in the future');
    }

    return date;
  }
}

function isWorkspaceAdmin(user: User) {
  return user.role === UserRole.ADMIN || user.role === UserRole.OWNER;
}

function isWorkspaceOwner(user: User) {
  return user.role === UserRole.OWNER;
}
