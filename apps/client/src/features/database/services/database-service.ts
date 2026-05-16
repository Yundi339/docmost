import api from '@/lib/api-client';
import {
  CreateDatabaseInput,
  DatabaseBlockInfo,
  DatabaseFieldDefinition,
  DatabaseRecord,
  DatabaseViewDefinition,
} from '@/features/database/types/database.types';

export async function createDatabase(
  data: CreateDatabaseInput,
): Promise<DatabaseBlockInfo> {
  const req = await api.post<DatabaseBlockInfo>('/databases/create', data);
  return req.data;
}

export async function getDatabaseInfo(databaseId: string): Promise<DatabaseBlockInfo> {
  const req = await api.post<DatabaseBlockInfo>('/databases/info', { databaseId });
  return req.data;
}

export async function listDatabaseRecords(databaseId: string): Promise<DatabaseRecord[]> {
  const req = await api.post<{ items: DatabaseRecord[] }>('/databases/records/list', {
    databaseId,
  });
  return req.data.items;
}

export async function createDatabaseRecord(input: {
  databaseId: string;
  fields: Record<string, unknown>;
}): Promise<DatabaseRecord> {
  const req = await api.post<DatabaseRecord>('/databases/records/create', input);
  return req.data;
}

export async function updateDatabaseRecord(input: {
  databaseId: string;
  recordId: string;
  fields: Record<string, unknown>;
}): Promise<DatabaseRecord> {
  const req = await api.post<DatabaseRecord>('/databases/records/update', input);
  return req.data;
}

export async function reorderDatabaseRecord(input: {
  databaseId: string;
  recordId: string;
  beforeRecordId?: string;
  afterRecordId?: string;
}): Promise<DatabaseRecord> {
  const req = await api.post<DatabaseRecord>('/databases/records/reorder', input);
  return req.data;
}

export async function attachDatabasePage(input: {
  databaseId: string;
  pageId: string;
  fields?: Record<string, unknown>;
  sourceDatabaseId?: string;
  sourceRecordId?: string;
}): Promise<DatabaseRecord> {
  const req = await api.post<DatabaseRecord>('/databases/records/attach-page', input);
  return req.data;
}

export async function detachDatabaseRecord(input: {
  databaseId: string;
  recordId: string;
  targetPageId?: string;
}): Promise<{
  pageId: string;
  pageSlugId: string;
  pageTitle: string;
  pageIcon?: string | null;
  targetPageId?: string | null;
}> {
  const req = await api.post('/databases/records/detach', input);
  return req.data;
}

export async function createDatabaseView(input: {
  databaseId: string;
  name: string;
  type: DatabaseViewDefinition['type'];
  groupBy?: string;
}): Promise<DatabaseBlockInfo> {
  const req = await api.post<DatabaseBlockInfo>('/databases/views/create', input);
  return req.data;
}

export async function updateDatabaseTitle(input: {
  databaseId: string;
  title: string;
}): Promise<DatabaseBlockInfo> {
  const req = await api.post<DatabaseBlockInfo>('/databases/title/update', input);
  return req.data;
}

export async function createDatabaseField(input: {
  databaseId: string;
  name?: string;
  type: DatabaseFieldDefinition['type'];
  options?: string[];
  position?: 'left' | 'right' | 'end';
  anchorFieldName?: string;
}): Promise<DatabaseBlockInfo> {
  const req = await api.post<DatabaseBlockInfo>('/databases/fields/create', input);
  return req.data;
}

export async function updateDatabaseField(input: {
  databaseId: string;
  fieldName: string;
  name?: string;
  type?: DatabaseFieldDefinition['type'];
  options?: string[];
}): Promise<DatabaseBlockInfo> {
  const req = await api.post<DatabaseBlockInfo>('/databases/fields/update', input);
  return req.data;
}
