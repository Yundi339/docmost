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
import {
  CreateApiKeyDto,
  FindApiKeysDto,
  UpdateApiKeyDto,
} from './dto/api-key.dto';
import { User, Workspace } from '@docmost/db/types/entity.types';
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
  ApiKeyType,
  isApiKeyType,
  normalizeApiKeyScopesForType,
} from './api-key-scopes';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { CredentialSpaceAccessService } from '../credential-space-access/credential-space-access.service';
import { CredentialSpaceAccessMode } from '../credential-space-access/credential-space-access.types';
import { CredentialRevocationService } from '../credential-space-access/credential-revocation.service';
import { resolveMcpMode } from '../../common/helpers/mcp-mode';

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
    pagination: FindApiKeysDto,
    user: User,
  ) {
    if (pagination.adminView) {
      if (!this.canManageWorkspaceApiKeys(user)) {
        throw new ForbiddenException();
      }
      const result = await this.apiKeyRepo.findApiKeys(
        workspace.id,
        pagination,
        { keyType: pagination.keyType },
      );
      result.items = await this.credentialSpaceAccess.addApiKeyViews(
        result.items,
      );
      return result;
    }

    const result = await this.apiKeyRepo.findApiKeys(workspace.id, pagination, {
      creatorId: user.id,
      keyType: pagination.keyType,
    });
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

    const scopes = this.prepareScopes(dto.keyType, dto.scopes);
    this.assertMcpIssuanceAllowed(workspace, dto.keyType, scopes);
    const expiresAt = this.parseExpirationDate(dto.expiresAt);
    const selection = await this.credentialSpaceAccess.normalizeSelection(
      dto.spaceAccess as any,
      user.id,
      workspace.id,
    );
    this.assertConfiguration(dto.keyType, selection.mode);

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
          keyType: dto.keyType,
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
        keyType: dto.keyType,
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
    if (dto.keyType !== undefined && dto.keyType !== apiKey.keyType) {
      throw new BadRequestException('API key type cannot be changed');
    }
    if (
      apiKey.creatorId !== user.id &&
      (dto.keyType !== undefined ||
        dto.scopes !== undefined ||
        dto.spaceAccess !== undefined)
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
    const scopes = this.prepareScopes(
      apiKey.keyType,
      dto.scopes ?? apiKey.scopes,
    );
    if (dto.scopes !== undefined) {
      this.assertMcpIssuanceAllowed(workspace, apiKey.keyType, scopes);
    }
    const selection = dto.spaceAccess
      ? await this.credentialSpaceAccess.normalizeSelection(
          dto.spaceAccess as any,
          creator.id,
          workspace.id,
        )
      : undefined;
    const mode = (selection?.mode ??
      apiKey.spaceAccessMode) as CredentialSpaceAccessMode;
    this.assertConfiguration(apiKey.keyType, mode);

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
        keyType: apiKey.keyType,
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
        keyType: apiKey.keyType,
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

    const workspace = await this.workspaceRepo.findActiveById(
      payload.workspaceId,
    );
    if (!workspace) {
      throw new ForbiddenException('Workspace not found');
    }

    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);
    if (!user || isUserDisabled(user)) {
      throw new ForbiddenException('User not found');
    }

    if (!isApiKeyType(apiKey.keyType)) {
      throw new ForbiddenException('Invalid API key type configuration');
    }
    const scopes = normalizeApiKeyScopesForType(apiKey.keyType, apiKey.scopes);
    const mode = apiKey.spaceAccessMode as CredentialSpaceAccessMode;
    if (!scopes || !this.hasCompatibleConfiguration(apiKey.keyType, mode)) {
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
        keyType: apiKey.keyType,
        scopes,
        spaceAccess,
      },
    };
  }

  private canManageWorkspaceApiKeys(user: User) {
    return isWorkspaceOwner(user);
  }

  private prepareScopes(keyType: unknown, scopes?: string[] | null) {
    if (!isApiKeyType(keyType)) {
      throw new BadRequestException('Invalid API key type');
    }

    const normalized = normalizeApiKeyScopesForType(keyType, scopes);
    if (!normalized) {
      throw new BadRequestException(
        'API key scopes must match the selected key type',
      );
    }

    return normalized;
  }

  private assertConfiguration(
    keyType: ApiKeyType,
    mode: CredentialSpaceAccessMode,
  ) {
    if (!this.hasCompatibleConfiguration(keyType, mode)) {
      throw new BadRequestException(
        'REST API keys require all-space access; MCP API keys require a valid space mode',
      );
    }
  }

  private hasCompatibleConfiguration(
    keyType: ApiKeyType,
    mode: CredentialSpaceAccessMode,
  ) {
    if (mode !== 'all' && mode !== 'selected') {
      return false;
    }

    return keyType === ApiKeyType.MCP || mode === 'all';
  }

  private assertMcpIssuanceAllowed(
    workspace: Workspace,
    keyType: ApiKeyType,
    scopes: readonly ApiKeyScope[],
  ) {
    if (keyType !== ApiKeyType.MCP) return;

    const mode = resolveMcpMode((workspace.settings as any)?.ai);
    if (mode === 'off') {
      throw new ForbiddenException('MCP is not enabled for this workspace');
    }
    if (
      mode === 'read-only' &&
      (scopes.includes(ApiKeyScope.MCP_WRITE) ||
        scopes.includes(ApiKeyScope.MCP_DESTRUCTIVE))
    ) {
      throw new ForbiddenException('MCP is enabled in read-only mode');
    }
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
