import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { CredentialSpaceAccessDto } from '../../../core/credential-space-access/dto/credential-space-access.dto';

export class UpdateOAuthAuthorizationDto {
  @IsUUID()
  authorizationId: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => CredentialSpaceAccessDto)
  spaceAccess: CredentialSpaceAccessDto;
}
