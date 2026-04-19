import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTemplateDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  content?: any;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}

export class UpdateTemplateDto {
  @IsUUID()
  templateId: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  content?: any;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}

export class TemplateIdDto {
  @IsUUID()
  templateId: string;
}

export class UseTemplateDto {
  @IsUUID()
  templateId: string;

  @IsUUID()
  spaceId: string;

  @IsOptional()
  @IsUUID()
  parentPageId?: string;
}
