import type {
  IPageCapabilities,
  IPageExtension,
} from "@/features/page/types/page.types";

export type SpaceTreeNode = {
  id: string;
  slugId: string;
  name: string;
  icon?: string;
  position: string;
  spaceId: string;
  parentPageId: string | null;
  hasChildren: boolean;
  canEdit?: boolean;
  extensions?: IPageExtension[];
  capabilities?: IPageCapabilities;
  children: SpaceTreeNode[];
};
