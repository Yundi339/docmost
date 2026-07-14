import {
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const DATABASE_TEMPLATES = [
  'database',
  'table',
  'kanban',
  'board',
  'tasks',
  'calendar',
  'gallery',
  'list',
  'timeline',
  'chart',
  'dashboard',
  'feed',
  'map',
  'form',
] as const;

export const DATABASE_VIEW_TYPES = [
  'table',
  'kanban',
  'calendar',
  'gallery',
  'list',
  'timeline',
  'chart',
  'dashboard',
  'feed',
  'map',
  'form',
] as const;

export const DATABASE_FIELD_TYPES = [
  'text',
  'longText',
  'number',
  'select',
  'singleSelect',
  'multiSelect',
  'status',
  'date',
  'user',
  'person',
  'attachment',
  'checkbox',
  'url',
  'email',
  'phone',
  'relation',
  'rollup',
  'formula',
  'button',
  'id',
  'place',
] as const;

export const DATABASE_FIELD_POSITIONS = ['left', 'right', 'end'] as const;

export class CreateDatabaseDto {
  @IsUUID()
  pageId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  blockId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsIn(DATABASE_TEMPLATES)
  template?: string;

  @IsOptional()
  @IsIn(DATABASE_VIEW_TYPES)
  viewType?: string;
}

export class DatabaseInfoDto {
  @IsUUID()
  databaseId: string;
}

export class CreateDatabaseViewDto extends DatabaseInfoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsIn(DATABASE_VIEW_TYPES)
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  groupBy?: string;
}

export class UpdateDatabaseTitleDto extends DatabaseInfoDto {
  @IsString()
  @MaxLength(120)
  title: string;
}

export class CreateDatabaseFieldDto extends DatabaseInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsIn(DATABASE_FIELD_TYPES)
  type: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];

  @IsOptional()
  @IsIn(DATABASE_FIELD_POSITIONS)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  anchorFieldName?: string;
}

export class UpdateDatabaseFieldDto extends DatabaseInfoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  fieldName: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(DATABASE_FIELD_TYPES)
  type?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];
}

export class ListDatabaseRecordsDto extends DatabaseInfoDto {}

export class ListDatabaseTargetsDto {
  @IsOptional()
  @IsUUID()
  excludeDatabaseId?: string;
}

export class CreateDatabaseRecordDto extends DatabaseInfoDto {
  @IsObject()
  fields: Record<string, unknown>;
}

export class UpdateDatabaseRecordDto extends DatabaseInfoDto {
  @IsString()
  @IsNotEmpty()
  recordId: string;

  @IsObject()
  fields: Record<string, unknown>;
}

export class AttachDatabasePageDto extends DatabaseInfoDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  sourceDatabaseId?: string;

  @IsOptional()
  @IsString()
  sourceRecordId?: string;
}

export class DetachDatabaseRecordDto extends DatabaseInfoDto {
  @IsString()
  @IsNotEmpty()
  recordId: string;

  @IsOptional()
  @IsUUID()
  targetPageId?: string;

  @IsOptional()
  @IsUUID()
  targetSpaceId?: string;
}

export class TrashDatabaseRecordPageDto extends DatabaseInfoDto {
  @IsString()
  @IsNotEmpty()
  recordId: string;
}

export class ReorderDatabaseRecordDto extends DatabaseInfoDto {
  @IsString()
  @IsNotEmpty()
  recordId: string;

  @IsOptional()
  @IsString()
  beforeRecordId?: string;

  @IsOptional()
  @IsString()
  afterRecordId?: string;
}

export class DatabaseEmbedUrlDto extends DatabaseInfoDto {
  @IsOptional()
  @IsString()
  viewId?: string;
}
