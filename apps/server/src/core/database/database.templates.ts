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

export type DatabaseFieldType =
  | 'text'
  | 'singleSelect'
  | 'select'
  | 'multiSelect'
  | 'status'
  | 'number'
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
  | 'place'
  | 'longText';

export interface DatabaseFieldDefinition {
  name: string;
  type: DatabaseFieldType;
  options?: string[];
  isPrimary?: boolean;
}

export interface DatabaseViewDefinition {
  id: string;
  name: string;
  type: DatabaseViewType;
  groupBy?: string;
}

export interface ApitableRecordInput {
  recordId?: string;
  id?: string;
  fields?: Record<string, unknown>;
  pageId?: string | null;
  pageSlugId?: string | null;
  pageTitle?: string | null;
  pageIcon?: string | null;
  sortOrder?: string | null;
  canEdit?: boolean;
}

export interface DocmostDatabaseRecord {
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
  canEdit?: boolean;
}

const TASK_FIELDS: DatabaseFieldDefinition[] = [
  { name: 'Title', type: 'text', isPrimary: true },
  {
    name: 'Status',
    type: 'singleSelect',
    options: ['Todo', 'In progress', 'Done'],
  },
  { name: 'Assignee', type: 'user' },
  { name: 'Due date', type: 'date' },
  {
    name: 'Priority',
    type: 'singleSelect',
    options: ['Low', 'Medium', 'High'],
  },
  { name: 'Tags', type: 'multiSelect', options: [] },
  { name: 'Description', type: 'longText' },
];

const GENERIC_FIELDS: DatabaseFieldDefinition[] = [
  { name: 'Title', type: 'text', isPrimary: true },
  {
    name: 'Status',
    type: 'singleSelect',
    options: ['Todo', 'In progress', 'Done'],
  },
  { name: 'Assignee', type: 'user' },
  { name: 'Due date', type: 'date' },
  { name: 'Tags', type: 'multiSelect', options: [] },
];

export function normalizeTemplate(template?: string): DatabaseTemplate {
  if (template === 'board') return 'kanban';
  if (
    template === 'database' ||
    template === 'table' ||
    template === 'kanban' ||
    template === 'tasks' ||
    template === 'calendar' ||
    template === 'gallery' ||
    template === 'list' ||
    template === 'timeline' ||
    template === 'chart' ||
    template === 'dashboard' ||
    template === 'feed' ||
    template === 'map' ||
    template === 'form'
  ) {
    return template;
  }
  return 'database';
}

export function buildDefaultFieldsForTemplate(
  template?: string,
): DatabaseFieldDefinition[] {
  const normalizedTemplate = normalizeTemplate(template);
  if (normalizedTemplate === 'tasks' || normalizedTemplate === 'kanban') {
    return TASK_FIELDS.map((field) => ({
      ...field,
      options: field.options ? [...field.options] : undefined,
    }));
  }

  return GENERIC_FIELDS.map((field) => ({
    ...field,
    options: field.options ? [...field.options] : undefined,
  }));
}

export function getDefaultViewsForTemplate(
  template?: string,
): DatabaseViewDefinition[] {
  const normalizedTemplate = normalizeTemplate(template);

  if (normalizedTemplate === 'table') {
    return [{ id: 'table', name: 'Table', type: 'table' }];
  }

  if (normalizedTemplate === 'kanban' || normalizedTemplate === 'tasks') {
    return [
      { id: 'kanban', name: 'Board', type: 'kanban', groupBy: 'Status' },
      { id: 'table', name: 'Table', type: 'table' },
    ];
  }

  if (normalizedTemplate === 'calendar') {
    return [
      {
        id: 'calendar',
        name: 'Calendar',
        type: 'calendar',
        groupBy: 'Due date',
      },
      { id: 'table', name: 'Table', type: 'table' },
    ];
  }

  if (normalizedTemplate === 'gallery') {
    return [
      { id: 'gallery', name: 'Gallery', type: 'gallery' },
      { id: 'table', name: 'Table', type: 'table' },
    ];
  }

  if (normalizedTemplate === 'timeline') {
    return [
      {
        id: 'timeline',
        name: 'Timeline',
        type: 'timeline',
        groupBy: 'Due date',
      },
      { id: 'table', name: 'Table', type: 'table' },
      { id: 'kanban', name: 'Board', type: 'kanban', groupBy: 'Status' },
    ];
  }

  if (normalizedTemplate === 'list') {
    return [
      { id: 'list', name: 'List', type: 'list' },
      { id: 'table', name: 'Table', type: 'table' },
    ];
  }

  if (
    normalizedTemplate === 'chart' ||
    normalizedTemplate === 'dashboard' ||
    normalizedTemplate === 'feed' ||
    normalizedTemplate === 'map' ||
    normalizedTemplate === 'form'
  ) {
    return [
      {
        id: normalizedTemplate,
        name: normalizedTemplate[0].toUpperCase() + normalizedTemplate.slice(1),
        type: normalizedTemplate,
      },
      { id: 'table', name: 'Table', type: 'table' },
    ];
  }

  return [
    { id: 'table', name: 'Table', type: 'table' },
    { id: 'kanban', name: 'Board', type: 'kanban', groupBy: 'Status' },
  ];
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item))
      .filter((item) => item.length > 0);
  }

  const stringValue = asString(value);
  return stringValue ? [stringValue] : [];
}

export function normalizeApitableRecord(
  record: ApitableRecordInput,
  primaryFieldName?: string,
): DocmostDatabaseRecord {
  const fields = record.fields ?? {};
  const title = asString(
    primaryFieldName ? fields[primaryFieldName] : fields.Title || fields.Name,
    'Untitled',
  );

  return {
    id: record.recordId || record.id || '',
    title,
    status: asString(fields.Status, 'Todo'),
    assigneeIds: asStringArray(fields.Assignee),
    dueDate: asString(fields['Due date']) || null,
    priority: asString(fields.Priority) || null,
    tags: asStringArray(fields.Tags),
    description: asString(fields.Description) || null,
    fields,
    pageId: record.pageId ?? null,
    pageSlugId: record.pageSlugId ?? null,
    pageTitle: record.pageTitle ?? null,
    pageIcon: record.pageIcon ?? null,
    sortOrder: record.sortOrder ?? null,
    canEdit: record.canEdit,
  };
}

export function normalizeDatabaseFields(
  fields: unknown,
): DatabaseFieldDefinition[] {
  if (!Array.isArray(fields)) return [];
  const normalized = fields.filter((field): field is DatabaseFieldDefinition =>
    Boolean(
      field &&
      typeof field === 'object' &&
      typeof (field as DatabaseFieldDefinition).name === 'string' &&
      typeof (field as DatabaseFieldDefinition).type === 'string',
    ),
  );
  if (normalized.some((field) => field.isPrimary)) return normalized;

  const primary =
    normalized.find((field) => field.name === 'Title') ??
    normalized.find((field) => field.name === 'Name') ??
    normalized.find((field) => field.type === 'text') ??
    normalized[0];
  if (!primary) return normalized;

  return normalized.map((field) =>
    field === primary ? { ...field, isPrimary: true } : field,
  );
}

export function getPrimaryDatabaseFieldName(
  fields: unknown,
): string | undefined {
  return normalizeDatabaseFields(fields).find((field) => field.isPrimary)?.name;
}

export function createEmptyRecordFields(
  status = 'Todo',
): Record<string, unknown> {
  return {
    Title: 'Untitled',
    Status: status,
    Assignee: [],
    'Due date': null,
    Priority: null,
    Tags: [],
    Description: '',
  };
}
