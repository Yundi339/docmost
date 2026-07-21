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
  ApiKeyScope,
  DEFAULT_API_KEY_SCOPES,
  LEGACY_API_KEY_SCOPES,
  normalizeApiKeyScopes,
} from './api-key-scopes';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { CredentialSpaceAccessService } from '../credential-space-access/credential-space-access.service';
import { CredentialSpaceAccessMode } from '../credential-space-access/credential-space-access.types';
import { CredentialRevocationService } from '../credential-space-access/credential-revocation.service';

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
    @InjectKysely() private readonly db: KyselyDB,
    private readonly credentialSpaceAccess: CredentialSpaceAccessService,
    private readonly credentialRevocation: CredentialRevocationService,
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
      const result = await this.apiKeyRepo.findApiKeys(
        workspace.id,
        pagination,
      );
      result.items = await this.credentialSpaceAccess.addApiKeyViews(
        result.items,
      );
      return result;
    }

    const result = await this.apiKeyRepo.findApiKeys(
      workspace.id,
      pagination,
      user.id,
    );
    result.items = await this.credentialSpaceAccess.addApiKeyViews(
      result.items,
    );
    return result;
  }

  listSelectableSpaces(user: User, workspace: Workspace) {
    return this.credentialSpaceAccess.listSelectableSpaces(
      user.id,
      workspace.id,
    );
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
    const selection = await this.credentialSpaceAccess.normalizeSelection(
      dto.spaceAccess as any,
      user.id,
      workspace.id,
    );
    this.assertScopeCompatibility(selection.mode, scopes);

    const apiKey = await this.db.transaction().execute(async (trx) => {
      const activeUser =
        await this.credentialRevocation.lockActiveUserForIssuance(
          user.id,
          workspace.id,
          trx,
        );
      if (!activeUser) {
        throw new ForbiddenException('User is no longer active');
      }
      const created = await this.apiKeyRepo.insertApiKey(
        {
          name: dto.name,
          creatorId: user.id,
          workspaceId: workspace.id,
          expiresAt,
          scopes,
          spaceAccessMode: selection.mode,
        },
        trx,
      );
      await this.credentialSpaceAccess.replaceApiKeyAccess(
        created.id,
        selection,
        trx,
      );
      return created;
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
      metadata: {
        scopes,
        spaceAccessMode: selection.mode,
        selectedSpaceCount: selection.spaceIds.length,
      },
    });

    const result = await this.apiKeyRepo.findById(apiKey.id, workspace.id);

    const [view] = await this.credentialSpaceAccess.addApiKeyViews([result]);
    return { ...view, token };
  }

  async update(dto: UpdateApiKeyDto, workspace: Workspace, user: User) {
    const apiKey = await this.apiKeyRepo.findById(dto.apiKeyId, workspace.id);
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    if (apiKey.creatorId !== user.id && !this.canManageWorkspaceApiKeys(user)) {
      throw new ForbiddenException();
    }
    if (
      apiKey.creatorId !== user.id &&
      (dto.scopes !== undefined || dto.spaceAccess !== undefined)
    ) {
      throw new ForbiddenException(
        'Only the API key owner can change scopes or space access',
      );
    }

    const creator = await this.userRepo.findById(
      apiKey.creatorId,
      workspace.id,
    );
    if (!creator || isUserDisabled(creator)) {
      throw new BadRequestException('API key owner is no longer active');
    }
    const scopes = dto.scopes
      ? normalizeApiKeyScopes(dto.scopes, DEFAULT_API_KEY_SCOPES)
      : normalizeApiKeyScopes(apiKey.scopes, LEGACY_API_KEY_SCOPES);
    const selection = dto.spaceAccess
      ? await this.credentialSpaceAccess.normalizeSelection(
          dto.spaceAccess as any,
          creator.id,
          workspace.id,
        )
      : undefined;
    const mode = (selection?.mode ??
      (apiKey.spaceAccessMode === 'selected'
        ? 'selected'
        : 'all')) as CredentialSpaceAccessMode;
    this.assertScopeCompatibility(mode, scopes);

    await this.db.transaction().execute(async (trx) => {
      await this.apiKeyRepo.updateApiKey(
        { name: dto.name, scopes },
        dto.apiKeyId,
        workspace.id,
        trx,
      );
      if (selection) {
        await this.credentialSpaceAccess.replaceApiKeyAccess(
          dto.apiKeyId,
          selection,
          trx,
        );
      }
    });

    this.auditService.log({
      event: AuditEvent.API_KEY_UPDATED,
      resourceType: AuditResource.API_KEY,
      resourceId: apiKey.id,
      metadata: {
        creatorId: apiKey.creatorId,
        renamedByAdmin: apiKey.creatorId !== user.id,
        scopes,
        spaceAccessMode: mode,
        selectedSpaceCount: selection?.spaceIds.length,
      },
    });

    const updated = await this.apiKeyRepo.findById(dto.apiKeyId, workspace.id);
    const [view] = await this.credentialSpaceAccess.addApiKeyViews([updated]);
    return view;
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

    if (apiKey.creatorId !== payload.sub) {
      throw new ForbiddenException('Invalid API key owner');
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
    const mode =
      apiKey.spaceAccessMode === 'selected' ? 'selected' : ('all' as const);
    if (!this.hasCompatibleScopes(mode, scopes)) {
      throw new ForbiddenException('Invalid API key scope configuration');
    }
    const spaceAccess =
      await this.credentialSpaceAccess.resolveApiKeyAccess(apiKey);

    this.apiKeyRepo.updateLastUsed(apiKey.id, metadata).catch(() => {});

    return {
      user,
      workspace,
      apiKey: {
        id: apiKey.id,
        creatorId: apiKey.creatorId,
        scopes,
        spaceAccess,
      },
    };
  }

  private canManageWorkspaceApiKeys(user: User) {
    return isWorkspaceOwner(user);
  }

  private assertScopeCompatibility(
    mode: CredentialSpaceAccessMode,
    scopes: string[],
  ) {
    if (!this.hasCompatibleScopes(mode, scopes)) {
      throw new BadRequestException(
        'Selected-space API keys can only use MCP scopes',
      );
    }
  }

  private hasCompatibleScopes(
    mode: CredentialSpaceAccessMode,
    scopes: string[],
  ) {
    return !(
      mode === 'selected' &&
      (scopes.includes(ApiKeyScope.REST_READ) ||
        scopes.includes(ApiKeyScope.REST_WRITE))
    );
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
