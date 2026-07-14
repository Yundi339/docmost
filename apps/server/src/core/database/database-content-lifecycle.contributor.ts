import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  PageContentLifecycleContributor,
  PageContentLifecycleInput,
  PageContentLifecycleService,
} from '../../collaboration/services/page-content-lifecycle.service';
import { DatabaseService } from './database.service';

export type DatabaseBlockReference = {
  databaseId: string;
  blockId?: string;
};

function referenceKey(reference: DatabaseBlockReference): string {
  return `${reference.databaseId}\u0000${reference.blockId ?? ''}`;
}

function collectDatabaseBlocks(
  content: unknown,
): Map<string, DatabaseBlockReference> {
  const databaseBlocks = new Map<string, DatabaseBlockReference>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    const attrs = node.attrs;
    if (
      node.type === 'databaseBlock' &&
      attrs &&
      typeof attrs === 'object' &&
      !Array.isArray(attrs)
    ) {
      const databaseId = (attrs as Record<string, unknown>).databaseId;
      if (typeof databaseId === 'string' && databaseId) {
        const rawBlockId = (attrs as Record<string, unknown>).blockId;
        const reference = {
          databaseId,
          blockId:
            typeof rawBlockId === 'string' && rawBlockId
              ? rawBlockId
              : undefined,
        };
        databaseBlocks.set(referenceKey(reference), reference);
      }
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(visit);
    }
  };

  visit(content);
  return databaseBlocks;
}

export function getRemovedDatabaseBlocks(
  previousContent: unknown,
  nextContent: unknown,
): DatabaseBlockReference[] {
  const previous = collectDatabaseBlocks(previousContent);
  const next = collectDatabaseBlocks(nextContent);
  return [...previous.entries()]
    .filter(([key]) => !next.has(key))
    .map(([, reference]) => reference);
}

@Injectable()
export class DatabaseContentLifecycleContributor
  implements PageContentLifecycleContributor, OnModuleInit, OnModuleDestroy
{
  readonly key = 'database';

  constructor(
    private readonly pageContentLifecycle: PageContentLifecycleService,
    private readonly databaseService: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.pageContentLifecycle.register(this);
  }

  onModuleDestroy(): void {
    this.pageContentLifecycle.unregister(this.key, this);
  }

  async validateBeforeSave(input: PageContentLifecycleInput): Promise<void> {
    if (input.origin !== 'direct') return;

    for (const databaseBlock of getRemovedDatabaseBlocks(
      input.previousContent,
      input.nextContent,
    )) {
      await this.databaseService.deleteDatabaseFromPageContent(
        databaseBlock.databaseId,
        input.page.id,
        databaseBlock.blockId,
        input.actor,
        input.trx,
        true,
      );
    }
  }

  async beforeSave(input: PageContentLifecycleInput) {
    if (input.origin === 'direct') return undefined;

    const effects = [];
    for (const databaseBlock of getRemovedDatabaseBlocks(
      input.previousContent,
      input.nextContent,
    )) {
      const effect = await this.databaseService.deleteDatabaseFromPageContent(
        databaseBlock.databaseId,
        input.page.id,
        databaseBlock.blockId,
        input.actor,
        input.trx,
      );
      if (effect) effects.push(effect);
    }

    if (effects.length === 0) return undefined;
    return async () => {
      for (const effect of effects) await effect();
    };
  }
}
