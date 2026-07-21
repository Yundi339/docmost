import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { API_KEY_SCOPES, API_KEY_TYPES, ApiKeyType } from '../api-key-scopes';
import { CredentialSpaceAccessDto } from '../../credential-space-access/dto/credential-space-access.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';

export class FindApiKeysDto extends PaginationOptions {
  @IsOptional()
  @IsIn(API_KEY_TYPES)
  keyType?: ApiKeyType;
}

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsDateString()
  expiresAt: string;

  @IsIn(API_KEY_TYPES)
  keyType: ApiKeyType;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CredentialSpaceAccessDto)
  spaceAccess?: CredentialSpaceAccessDto;
}

export class UpdateApiKeyDto {
  @IsUUID()
  apiKeyId: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsIn(API_KEY_TYPES)
  keyType?: ApiKeyType;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CredentialSpaceAccessDto)
  spaceAccess?: CredentialSpaceAccessDto;
}

export class ApiKeyIdDto {
  @IsUUID()
  apiKeyId: string;
}
