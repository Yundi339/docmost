import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CREDENTIAL_SPACE_ACCESS_MODES } from '../credential-space-access.types';

export class CredentialSpaceAccessDto {
  @IsIn(CREDENTIAL_SPACE_ACCESS_MODES)
  mode: 'all' | 'selected';

  @ValidateIf((value: CredentialSpaceAccessDto) => value.mode === 'selected')
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  spaceIds?: string[];
}

export class OptionalCredentialSpaceAccessDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CredentialSpaceAccessDto)
  spaceAccess?: CredentialSpaceAccessDto;
}
