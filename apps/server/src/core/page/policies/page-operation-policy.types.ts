import { Page } from '@docmost/db/types/entity.types';
import { KyselyTransaction } from '@docmost/db/types/kysely.types';

export type PageExtension = {
  provider: string;
  role: string;
  resourceId: string;
};

export type PageCapabilities = {
  move?: boolean;
  reparent?: boolean;
  moveToSpace?: boolean;
  createChild?: boolean;
  duplicate?: boolean;
};

export type PagePolicyMetadata = {
  extensions?: PageExtension[];
  capabilities?: PageCapabilities;
};

type PageOperationPolicyContext = {
  actorId: string;
  trx?: KyselyTransaction;
};

export type CreateChildPagePolicyInput = PageOperationPolicyContext & {
  operation: 'createChild';
  parentPage: Page;
};

export type MovePagePolicyInput = PageOperationPolicyContext & {
  operation: 'move';
  page: Page;
  targetParentPageId: string | null;
  targetSpaceId: string;
  affectedPageIds: string[];
};

export type DuplicatePagePolicyInput = PageOperationPolicyContext & {
  operation: 'duplicate';
  page: Page;
  targetParentPageId: string | null;
  targetSpaceId: string;
  affectedPageIds: string[];
};

export type RestorePagePolicyInput = PageOperationPolicyContext & {
  operation: 'restore';
  page: Page;
};

export type PageOperationPolicyInput =
  | CreateChildPagePolicyInput
  | MovePagePolicyInput
  | DuplicatePagePolicyInput
  | RestorePagePolicyInput;

export interface PageOperationPolicyContributor {
  readonly key: string;
  assertOperation?(input: PageOperationPolicyInput): Promise<void>;
  getPageMetadata?(pageIds: string[]): Promise<Map<string, PagePolicyMetadata>>;
}
