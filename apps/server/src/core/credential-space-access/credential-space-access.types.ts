export const CREDENTIAL_SPACE_ACCESS_MODES = ['all', 'selected'] as const;

export type CredentialSpaceAccessMode =
  (typeof CREDENTIAL_SPACE_ACCESS_MODES)[number];

export type CredentialSpaceAccessInput =
  | { mode: 'all'; spaceIds?: never }
  | { mode: 'selected'; spaceIds: string[] };

export type CredentialSpace = {
  id: string;
  name: string | null;
  slug: string;
};

export type CredentialSpaceAccessContext = {
  mode: CredentialSpaceAccessMode;
  selectedSpaceIds: string[];
  effectiveSpaceIds: string[];
  revision: string;
};

export type CredentialSpaceAccessView = {
  mode: CredentialSpaceAccessMode;
  spaces: CredentialSpace[];
  selectedCount: number;
  effectiveCount: number;
  status: 'active' | 'no_effective_spaces';
};
