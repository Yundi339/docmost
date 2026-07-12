import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { CreateUserDto } from '../../auth/dto/create-user.dto';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'email'] as const),
) {
  @IsOptional()
  @IsBoolean()
  fullPageWidth: boolean;

  @IsOptional()
  @IsBoolean()
  spellcheck: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['read', 'edit'])
  pageEditMode: string;

  @IsOptional()
  @IsBoolean()
  editorToolbar: boolean;

  @IsOptional()
  @IsString()
  locale: string;

  @IsOptional()
  @IsBoolean()
  notificationPageUpdates: boolean;

  @IsOptional()
  @IsBoolean()
  notificationPageUserMention: boolean;

  @IsOptional()
  @IsBoolean()
  notificationCommentUserMention: boolean;

  @IsOptional()
  @IsBoolean()
  notificationCommentCreated: boolean;

  @IsOptional()
  @IsBoolean()
  notificationCommentResolved: boolean;
}
