import { ISpace } from "@/features/space/types/space.types.ts";
import { IPage } from "@/features/page/types/page.types.ts";

export type DirectoryContext =
  | "generic"
  | "mention"
  | "permission-picker"
  | "space-member"
  | "verification"
  | "database-person";

export interface IDirectoryUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface IDirectoryGroup {
  id: string;
  name: string;
}

export interface IPageSearch {
  id: string;
  title: string;
  icon: string;
  parentPageId: string;
  slugId: string;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
  rank: string;
  highlight: string;
  space: Partial<ISpace>;
}

export interface SearchSuggestionParams {
  query: string;
  includeUsers?: boolean;
  includeGroups?: boolean;
  includePages?: boolean;
  spaceId?: string;
  pageId?: string;
  context?: DirectoryContext;
  limit?: number;
}

export interface ISuggestionResult {
  users?: IDirectoryUser[];
  groups?: IDirectoryGroup[];
  pages?: Partial<IPage[]>;
}

export interface IPageSearchParams {
  query: string;
  spaceId?: string;
  shareId?: string;
}

export interface IAttachmentSearch {
  id: string;
  fileName: string;
  pageId: string;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
  rank: string;
  highlight: string;
  space: {
    id: string;
    name: string;
    slug: string;
    icon: string;
  };
  page: {
    id: string;
    title: string;
    slugId: string;
  };
}
