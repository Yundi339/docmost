import { Injectable } from '@nestjs/common';
import {
  PageCapabilities,
  PageExtension,
  PageOperationPolicyContributor,
  PageOperationPolicyInput,
  PagePolicyMetadata,
} from './page-operation-policy.types';

@Injectable()
export class PageOperationPolicyService {
  private readonly contributors = new Map<
    string,
    PageOperationPolicyContributor
  >();

  register(contributor: PageOperationPolicyContributor): void {
    const key = contributor.key.trim();
    if (!key) {
      throw new Error('Page operation policy contributor requires a key');
    }

    const existing = this.contributors.get(key);
    if (existing && existing !== contributor) {
      throw new Error(
        `Page operation policy contributor already registered: ${key}`,
      );
    }

    this.contributors.set(key, contributor);
  }

  unregister(key: string, contributor: PageOperationPolicyContributor): void {
    if (this.contributors.get(key) === contributor) {
      this.contributors.delete(key);
    }
  }

  async assertOperation(input: PageOperationPolicyInput): Promise<void> {
    for (const contributor of this.contributors.values()) {
      await contributor.assertOperation?.(input);
    }
  }

  async addMetadata<T extends { id: string }>(
    pages: T[],
  ): Promise<
    Array<
      T & {
        extensions?: PageExtension[];
        capabilities?: PageCapabilities;
      }
    >
  > {
    if (pages.length === 0 || this.contributors.size === 0) return pages;

    const pageIds = [...new Set(pages.map((page) => page.id))];
    const metadataByPageId = new Map<string, PagePolicyMetadata>();

    for (const contributor of this.contributors.values()) {
      if (!contributor.getPageMetadata) continue;

      const contributorMetadata = await contributor.getPageMetadata(pageIds);
      for (const [pageId, metadata] of contributorMetadata) {
        const current = metadataByPageId.get(pageId) ?? {};
        metadataByPageId.set(pageId, {
          extensions: this.mergeExtensions(
            current.extensions,
            metadata.extensions,
          ),
          capabilities: this.mergeCapabilities(
            current.capabilities,
            metadata.capabilities,
          ),
        });
      }
    }

    return pages.map((page) => {
      const metadata = metadataByPageId.get(page.id);
      return metadata ? { ...page, ...metadata } : page;
    });
  }

  private mergeExtensions(
    current: PageExtension[] = [],
    incoming: PageExtension[] = [],
  ): PageExtension[] | undefined {
    if (current.length === 0 && incoming.length === 0) return undefined;

    const extensions = new Map<string, PageExtension>();
    for (const extension of [...current, ...incoming]) {
      const key = `${extension.provider}:${extension.role}:${extension.resourceId}`;
      extensions.set(key, extension);
    }

    return [...extensions.values()];
  }

  private mergeCapabilities(
    current: PageCapabilities = {},
    incoming: PageCapabilities = {},
  ): PageCapabilities | undefined {
    const keys: Array<keyof PageCapabilities> = [
      'move',
      'reparent',
      'moveToSpace',
      'createChild',
      'duplicate',
    ];
    const merged: PageCapabilities = {};

    for (const key of keys) {
      const values = [current[key], incoming[key]].filter(
        (value): value is boolean => value !== undefined,
      );
      if (values.length > 0) {
        merged[key] = values.every(Boolean);
      }
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
  }
}
