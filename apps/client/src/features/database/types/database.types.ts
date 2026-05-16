import { IUser } from '@/features/user/types/user.types';

export type DatabaseTemplate =
  | 'database'
  | 'table'
  | 'kanban'
  | 'board'
  | 'tasks'
  | 'calendar'
  | 'gallery'
  | 'list'
  | 'timeline'
  | 'chart'
  | 'dashboard'
  | 'feed'
  | 'map'
  | 'form';

export type DatabaseViewType =
  | 'table'
  | 'kanban'
  | 'calendar'
  | 'gallery'
  | 'list'
  | 'timeline'
  | 'chart'
  | 'dashboard'
  | 'feed'
  | 'map'
  | 'form';

export interface DatabaseFieldDefinition {
  name: string;
  type:
    | 'text'
    | 'longText'
    | 'number'
    | 'select'
    | 'singleSelect'
    | 'multiSelect'
    | 'status'
    | 'date'
    | 'user'
    | 'person'
    | 'attachment'
    | 'checkbox'
    | 'url'
    | 'email'
    | 'phone'
    | 'relation'
    | 'rollup'
    | 'formula'
    | 'button'
    | 'id'
    | 'place';
  options?: string[];
}

export interface DatabaseViewDefinition {
  id: string;
  name: string;
  type: DatabaseViewType;
  groupBy?: string;
}

export interface DatabaseBlockInfo {
  id: string;
  blockId: string;
  pageId: string;
  title: string;
  template: string;
  activeViewId: string;
  apitableDatasheetId?: string | null;
  apitableViewId?: string | null;
  fields: DatabaseFieldDefinition[];
  views: DatabaseViewDefinition[];
  metadata?: Record<string, unknown>;
}

export interface DatabaseRecord {
  id: string;
  title: string;
  status: string;
  assigneeIds: string[];
  dueDate: string | null;
  priority: string | null;
  tags: string[];
  description: string | null;
  fields: Record<string, unknown>;
  pageId?: string | null;
  pageSlugId?: string | null;
  pageTitle?: string | null;
  pageIcon?: string | null;
  sortOrder?: string | null;
}

export interface CreateDatabaseInput {
  pageId: string;
  blockId: string;
  title?: string;
  template?: DatabaseTemplate;
  viewType?: DatabaseViewType;
}

export interface DatabaseUser extends Pick<IUser, 'id' | 'name' | 'email' | 'avatarUrl'> {}
