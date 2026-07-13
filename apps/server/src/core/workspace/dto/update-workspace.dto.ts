import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkspaceDto } from './create-workspace.dto';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import {
  DIRECTORY_VISIBILITIES,
  DirectoryVisibility,
} from '../../directory/directory.types';

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto) {
  @IsOptional()
  @IsArray()
  emailDomains: string[];

  @IsOptional()
  @IsBoolean()
  enforceSso: boolean;

  @IsOptional()
  @IsBoolean()
  enforceMfa: boolean;

  @IsOptional()
  @IsBoolean()
  restrictApiToAdmins: boolean;

  @IsOptional()
  @IsBoolean()
  allowMemberApiManagement: boolean;

  @IsOptional()
  @IsBoolean()
  aiSearch: boolean;

  @IsOptional()
  @IsBoolean()
  allowMemberAiSettings: boolean;

  @IsOptional()
  @IsBoolean()
  generativeAi: boolean;

  @IsOptional()
  @IsBoolean()
  disablePublicSharing: boolean;

  @IsOptional()
  @IsBoolean()
  mcpEnabled: boolean;

  @IsOptional()
  @IsIn(['off', 'read-only', 'read-write'])
  mcpMode: 'off' | 'read-only' | 'read-write';

  @IsOptional()
  @IsBoolean()
  aiChat: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  trashRetentionDays: number;

  @IsOptional()
  @IsBoolean()
  allowMemberTemplates: boolean;

  @IsOptional()
  @IsIn(DIRECTORY_VISIBILITIES)
  directoryVisibility: DirectoryVisibility;
}
