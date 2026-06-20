import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SEARCH_QUERY_MAX_LENGTH = 256;
export const SEARCH_MAX_LIMIT = 200;
export const SEARCH_MAX_OFFSET = 10000;

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class SearchDTO {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  query: string;

  @IsOptional()
  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsUUID()
  shareId?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SEARCH_MAX_OFFSET)
  offset?: number;
}

export class SearchShareDTO extends SearchDTO {
  @IsUUID()
  shareId: string;

  @IsOptional()
  @IsUUID()
  spaceId: string;
}

export class SearchSuggestionDTO {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  query: string;

  @IsOptional()
  @IsBoolean()
  includeUsers?: boolean;

  @IsOptional()
  @IsBoolean()
  includeGroups?: boolean;

  @IsOptional()
  @IsBoolean()
  includePages?: boolean;

  @IsOptional()
  @IsUUID()
  spaceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit?: number;
}
