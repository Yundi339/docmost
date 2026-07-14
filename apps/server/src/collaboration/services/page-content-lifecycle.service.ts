import { Injectable } from '@nestjs/common';
import { Page, User } from '@docmost/db/types/entity.types';
import { KyselyTransaction } from '@docmost/db/types/kysely.types';

export type PageContentLifecycleEffect = () => void | Promise<void>;

export type PageContentLifecycleInput = {
  page: Page;
  previousContent: unknown;
  nextContent: unknown;
  actor: User;
  trx: KyselyTransaction;
  origin: 'collaboration' | 'direct';
};

export interface PageContentLifecycleContributor {
  readonly key: string;
  validateBeforeSave?(input: PageContentLifecycleInput): void | Promise<void>;
  beforeSave(
    input: PageContentLifecycleInput,
  ):
    | void
    | PageContentLifecycleEffect
    | Promise<void | PageContentLifecycleEffect>;
}

@Injectable()
export class PageContentLifecycleService {
  private readonly contributors = new Map<
    string,
    PageContentLifecycleContributor
  >();

  register(contributor: PageContentLifecycleContributor): void {
    this.contributors.set(contributor.key, contributor);
  }

  unregister(key: string, contributor: PageContentLifecycleContributor): void {
    if (this.contributors.get(key) === contributor) {
      this.contributors.delete(key);
    }
  }

  async beforeSave(
    input: PageContentLifecycleInput,
  ): Promise<PageContentLifecycleEffect[]> {
    await this.validateBeforeSave(input);
    const effects: PageContentLifecycleEffect[] = [];
    for (const contributor of this.contributors.values()) {
      const effect = await contributor.beforeSave(input);
      if (effect) effects.push(effect);
    }
    return effects;
  }

  async validateBeforeSave(input: PageContentLifecycleInput): Promise<void> {
    for (const contributor of this.contributors.values()) {
      await contributor.validateBeforeSave?.(input);
    }
  }
}
