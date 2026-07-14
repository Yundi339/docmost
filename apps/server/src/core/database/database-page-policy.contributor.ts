import {
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseRepo } from './database.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageOperationPolicyService } from '../page/policies/page-operation-policy.service';
import {
  PageCapabilities,
  PageOperationPolicyContributor,
  PageOperationPolicyInput,
  PagePolicyMetadata,
} from '../page/policies/page-operation-policy.types';

@Injectable()
export class DatabasePagePolicyContributor
  implements PageOperationPolicyContributor, OnModuleInit, OnModuleDestroy
{
  readonly key = 'database';

  constructor(
    private readonly databaseRepo: DatabaseRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageOperationPolicy: PageOperationPolicyService,
  ) {}

  onModuleInit(): void {
    this.pageOperationPolicy.register(this);
  }

  onModuleDestroy(): void {
    this.pageOperationPolicy.unregister(this.key, this);
  }

  async getPageMetadata(
    pageIds: string[],
  ): Promise<Map<string, PagePolicyMetadata>> {
    const bindings = await this.databaseRepo.listPagePolicyBindings(pageIds);
    const metadata = new Map<string, PagePolicyMetadata>();

    for (const binding of bindings) {
      const current = metadata.get(binding.pageId) ?? {};
      const capabilities: PageCapabilities = {
        ...current.capabilities,
        ...(binding.role === 'host'
          ? { moveToSpace: false, duplicate: false }
          : { reparent: false, moveToSpace: false, duplicate: false }),
      };
      metadata.set(binding.pageId, {
        extensions: [
          ...(current.extensions ?? []),
          {
            provider: this.key,
            role: binding.role,
            resourceId: binding.resourceId,
          },
        ],
        capabilities,
      });
    }

    return metadata;
  }

  async assertOperation(input: PageOperationPolicyInput): Promise<void> {
    if (input.operation === 'restore') {
      const bindings = await this.databaseRepo.listPagePolicyBindings(
        [input.page.id],
        input.trx,
      );
      const records = bindings.filter((binding) => binding.role === 'record');
      if (records.length > 1) {
        this.reject(
          'DATABASE_PAGE_MEMBERSHIP_CONFLICT',
          'The page has conflicting board memberships',
        );
      }

      const record = records[0];
      if (!record) return;

      const boardPage = await this.pageRepo.findById(record.databasePageId, {
        trx: input.trx,
        withLock: Boolean(input.trx),
      });
      if (!boardPage || boardPage.deletedAt) {
        this.reject(
          'DATABASE_RESTORE_BOARD_REQUIRED',
          'Restore the board before restoring this work item',
        );
      }
      if (
        input.page.parentPageId !== boardPage.id ||
        input.page.spaceId !== boardPage.spaceId ||
        input.page.workspaceId !== boardPage.workspaceId
      ) {
        this.reject(
          'DATABASE_PAGE_MEMBERSHIP_INVALID',
          'The work item relationship must be repaired before restoration',
        );
      }
      return;
    }

    if (input.operation === 'createChild') {
      return;
    }

    const affectedPageIds = [
      ...new Set([
        input.page.id,
        ...input.affectedPageIds,
        ...(input.targetParentPageId ? [input.targetParentPageId] : []),
      ]),
    ];
    const bindings = await this.databaseRepo.listPagePolicyBindings(
      affectedPageIds,
      input.trx,
    );

    if (input.operation === 'duplicate') {
      if (
        bindings.some((binding) =>
          input.affectedPageIds.includes(binding.pageId),
        )
      ) {
        this.reject(
          'DATABASE_PAGE_DUPLICATE_RESTRICTED',
          'Duplicate boards and work items from the board',
        );
      }

      return;
    }

    const sourceRecords = bindings.filter(
      (binding) =>
        binding.role === 'record' && binding.pageId === input.page.id,
    );

    if (sourceRecords.length > 1) {
      this.reject(
        'DATABASE_PAGE_MEMBERSHIP_CONFLICT',
        'The page has conflicting board memberships',
      );
    }

    const sourceRecord = sourceRecords[0];
    if (
      sourceRecord &&
      (sourceRecord.databasePageId !== input.targetParentPageId ||
        sourceRecord.spaceId !== input.targetSpaceId)
    ) {
      this.reject(
        'DATABASE_WORK_ITEM_MOVE_RESTRICTED',
        'Move this work item from the board',
      );
    }

    if (input.page.spaceId === input.targetSpaceId) return;

    const affectedBindings = bindings.filter((binding) =>
      input.affectedPageIds.includes(binding.pageId),
    );
    const allowedTransferredRecord =
      sourceRecord &&
      sourceRecord.databasePageId === input.targetParentPageId &&
      sourceRecord.spaceId === input.targetSpaceId
        ? sourceRecord
        : undefined;
    const hasOtherManagedPage = affectedBindings.some(
      (binding) => binding !== allowedTransferredRecord,
    );

    if (hasOtherManagedPage) {
      this.reject(
        'DATABASE_SUBTREE_MOVE_RESTRICTED',
        'Move boards and their work items within their current space',
      );
    }
  }

  private reject(code: string, message: string): never {
    throw new ConflictException({ code, message });
  }
}
