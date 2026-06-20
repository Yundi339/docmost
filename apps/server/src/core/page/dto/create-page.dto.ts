import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export type ContentFormat = 'json' | 'markdown' | 'html';
export const PAGE_CONTENT_MAX_LENGTH = 500_000;

export class CreatePageDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsUUID()
  parentPageId?: string;

  @IsUUID()
  spaceId: string;

  @IsOptional()
  @ValidateIf((o) => typeof o.content === 'string')
  @IsString()
  @MaxLength(PAGE_CONTENT_MAX_LENGTH)
  content?: string | object;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase() ?? 'json')
  @IsIn(['json', 'markdown', 'html'])
  format?: ContentFormat;
}
