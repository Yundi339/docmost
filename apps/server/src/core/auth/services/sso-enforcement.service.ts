import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { SsoLoginCapabilityService } from './sso-login-capability.service';
import { UserRole } from '../../../common/helpers/types/permission';

type DatabaseExecutor = KyselyDB | KyselyTransaction;
type WorkspaceSsoState = Pick<Workspace, 'id' | 'enforceSso'>;

@Injectable()
export class SsoEnforcementService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly capabilityService: SsoLoginCapabilityService,
  ) {}

  isProviderLoginAvailable(providerType: string): boolean {
    return this.capabilityService.isLoginAvailable(providerType);
  }

  filterAvailableProviders<T extends { type: string }>(providers: T[]): T[] {
    return providers.filter((provider) =>
      this.isProviderLoginAvailable(provider.type),
    );
  }

  async isEnforced(workspace: WorkspaceSsoState): Promise<boolean> {
    if (!workspace.enforceSso) {
      return false;
    }

    return this.hasAvailableProvider(workspace.id, this.db);
  }

  async assertLocalAuthAllowed(workspace: WorkspaceSsoState): Promise<void> {
    if (await this.isEnforced(workspace)) {
      throw new BadRequestException('This workspace has enforced SSO login.');
    }
  }

  async assertPrimaryAuthAllowed(
    workspace: WorkspaceSsoState,
    user: Pick<User, 'role'>,
    ownerRecovery: boolean,
  ): Promise<boolean> {
    if (!(await this.isEnforced(workspace))) {
      return false;
    }

    if (ownerRecovery && user.role === UserRole.OWNER) {
      return true;
    }

    throw new BadRequestException('This workspace has enforced SSO login.');
  }

  async lockWorkspace(
    workspaceId: string,
    executor: KyselyTransaction,
  ): Promise<void> {
    const workspace = await executor
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', workspaceId)
      .forUpdate()
      .executeTakeFirst();

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
  }

  async assertCanEnforce(
    workspaceId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<void> {
    if (!(await this.hasAvailableProvider(workspaceId, executor))) {
      throw new BadRequestException({
        message:
          'There must be at least one active SSO provider with an available login handler to enforce SSO.',
        code: 'SSO_PROVIDER_REQUIRED',
      });
    }

    if (!(await this.hasRecoveryOwner(workspaceId, executor))) {
      throw new BadRequestException({
        message:
          'The workspace owner must have a local password before enforcing SSO.',
        code: 'SSO_OWNER_RECOVERY_UNAVAILABLE',
      });
    }
  }

  async canEnforce(workspaceId: string): Promise<boolean> {
    return (
      (await this.hasAvailableProvider(workspaceId, this.db)) &&
      (await this.hasRecoveryOwner(workspaceId, this.db))
    );
  }

  private async hasRecoveryOwner(
    workspaceId: string,
    executor: DatabaseExecutor,
  ): Promise<boolean> {
    const recoveryOwner = await executor
      .selectFrom('users')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('role', '=', UserRole.OWNER)
      .where('password', 'is not', null)
      .where('deactivatedAt', 'is', null)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    return Boolean(recoveryOwner);
  }

  async assertCanDeactivateProvider(
    workspaceId: string,
    providerId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<void> {
    const workspace = await executor
      .selectFrom('workspaces')
      .select('enforceSso')
      .where('id', '=', workspaceId)
      .executeTakeFirst();

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    if (!workspace.enforceSso) {
      return;
    }

    if (!(await this.hasAvailableProvider(workspaceId, executor, providerId))) {
      throw new BadRequestException({
        message:
          'Disable SSO enforcement before disabling the last available SSO provider.',
        code: 'SSO_PROVIDER_REQUIRED',
      });
    }
  }

  private async hasAvailableProvider(
    workspaceId: string,
    executor: DatabaseExecutor,
    excludedProviderId?: string,
  ): Promise<boolean> {
    const availableTypes = this.capabilityService.getAvailableProviderTypes();
    if (availableTypes.length === 0) {
      return false;
    }

    let query = executor
      .selectFrom('authProviders')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .where('type', 'in', availableTypes);

    if (excludedProviderId) {
      query = query.where('id', '!=', excludedProviderId);
    }

    return Boolean(await query.executeTakeFirst());
  }
}
