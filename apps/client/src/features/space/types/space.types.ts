import { SpaceRole } from "@/lib/types.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import { ExportFormat } from "@/features/page/types/page.types.ts";

export interface ISpaceSharingSettings {
  disabled?: boolean;
}

export interface ISpaceCommentsSettings {
  allowViewerComments?: boolean;
}

export interface ISpaceSettings {
  sharing?: ISpaceSharingSettings;
  comments?: ISpaceCommentsSettings;
}

export interface ISpace {
  id: string;
  name: string;
  description: string;
  logo?: string;
  slug: string;
  hostname: string;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
  memberCount?: number;
  spaceId?: string;
  membership?: IMembership;
  settings?: ISpaceSettings;
  // for updates
  disablePublicSharing?: boolean;
  allowViewerComments?: boolean;
}

interface IMembership {
  userId: string;
  role: SpaceRole;
  permissions?: Permissions;
}

interface Permission {
  action: SpaceCaslAction;
  subject: SpaceCaslSubject;
}

type Permissions = Permission[];

export interface IAddSpaceMember {
  spaceId: string;
  userIds?: string[];
  groupIds?: string[];
}

export interface IRemoveSpaceMember {
  spaceId: string;
  userId?: string;
  groupId?: string;
}

export interface IChangeSpaceMemberRole {
  spaceId: string;
  userId?: string;
  groupId?: string;
}

// space member
export interface SpaceUserInfo {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  type: "user";
}

export interface SpaceGroupInfo {
  id: string;
  name: string;
  isDefault: boolean;
  memberCount: number;
  type: "group";
}

export type ISpaceMember = { role: string } & (SpaceUserInfo | SpaceGroupInfo);

export interface IExportSpaceParams {
  spaceId: string;
  format: ExportFormat;
  includeAttachments?: boolean;
}

export type SpaceGraphNode = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  parentPageId: string | null;
  updatedAt: string;
  distance: number | null;
};

export type SpaceGraphEdge = {
  id: string;
  sourcePageId: string;
  targetPageId: string;
};

export type SpaceGraphParams = {
  spaceId: string;
  centerPageId?: string;
  depth?: number;
  query?: string;
  limit?: number;
};

export type SpaceGraphResponse = {
  nodes: SpaceGraphNode[];
  edges: SpaceGraphEdge[];
  meta: {
    limit: number;
    truncated: boolean;
    centerPageId: string | null;
    depth: number | null;
    queryApplied: boolean;
  };
};
