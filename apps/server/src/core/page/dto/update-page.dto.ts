import { PartialType } from '@nestjs/mapped-types';
import {
  CreatePageDto,
  ContentFormat,
  PAGE_CONTENT_MAX_LENGTH,
} from './create-page.dto';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export type ContentOperation = 'append' | 'prepend' | 'replace';

export class UpdatePageDto extends PartialType(CreatePageDto) {
  @IsUUID()
  pageId: string;

  @IsOptional()
  @ValidateIf((o) => typeof o.content === 'string')
  @IsString()
  @MaxLength(PAGE_CONTENT_MAX_LENGTH)
  content?: string | object;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase())
  @IsIn(['append', 'prepend', 'replace'])
  operation?: ContentOperation;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase() ?? 'json')
  @IsIn(['json', 'markdown', 'html'])
  format?: ContentFormat;
}
