import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { ApiKeyRepo } from '@docmost/db/repos/api-key/api-key.repo';
import { TokenService } from '../auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
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

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
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

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    const apiKey = await this.apiKeyRepo.insertApiKey({
      name: dto.name,
      creatorId: user.id,
      workspaceId: workspace.id,
      expiresAt,
    });

    const expiresInSec = expiresAt
      ? Math.max(Math.floor((expiresAt.getTime() - Date.now()) / 1000), 60)
      : undefined;

    const token = await this.tokenService.generateApiToken({
      apiKeyId: apiKey.id,
      user,
      workspaceId: workspace.id,
      expiresIn: expiresInSec,
    });

    this.auditService.log({
      event: AuditEvent.API_KEY_CREATED,
      resourceType: AuditResource.API_KEY,
      resourceId: apiKey.id,
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
    });
  }

  async validateApiKey(payload: JwtApiKeyPayload) {
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

    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);
    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const workspace = { id: payload.workspaceId } as any;

    // Update last used timestamp in background
    this.apiKeyRepo.updateLastUsed(apiKey.id).catch(() => {});

    return { user, workspace };
  }

  private canManageWorkspaceApiKeys(user: User) {
    return user.role === UserRole.OWNER;
  }
}

function isWorkspaceAdmin(user: User) {
  return user.role === UserRole.ADMIN || user.role === UserRole.OWNER;
}
