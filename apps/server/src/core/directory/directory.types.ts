export const DIRECTORY_VISIBILITIES = [
  'workspace',
  'context',
  'admins-only',
] as const;

export type DirectoryVisibility = (typeof DIRECTORY_VISIBILITIES)[number];

export const DIRECTORY_CONTEXTS = [
  'generic',
  'mention',
  'permission-picker',
  'space-member',
  'verification',
  'database-person',
] as const;

export type DirectoryContext = (typeof DIRECTORY_CONTEXTS)[number];

export type DirectoryUser = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type DirectoryGroup = {
  id: string;
  name: string;
};

export type DirectorySearchInput = {
  query: string;
  limit: number;
  includeUsers: boolean;
  includeGroups: boolean;
  context: DirectoryContext;
  pageId?: string;
  spaceId?: string;
};

export type DirectoryScope =
  | 'workspace'
  | 'target-space'
  | 'target-page'
  | 'exact'
  | 'self';

export type DirectorySearchPlan = {
  scope: DirectoryScope;
  targetPageId?: string;
  targetSpaceId?: string;
};
