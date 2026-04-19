import { IsOptional, IsString, IsUUID, IsDateString, MaxLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsUUID()
  apiKeyId: string;

  @IsString()
  @MaxLength(100)
  name: string;
}

export class ApiKeyIdDto {
  @IsUUID()
  apiKeyId: string;
}
