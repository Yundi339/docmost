import {
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';

export class MovePageDto {
  @IsUUID()
  pageId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(12)
  position: string;

  @IsOptional()
  @IsUUID()
  parentPageId?: string | null;
}

export class MovePageToSpaceDto {
  @IsNotEmpty()
  @IsUUID()
  pageId: string;

  @IsNotEmpty()
  @IsUUID()
  spaceId: string;
}

export class MovePageUnderDto {
  @IsNotEmpty()
  @IsUUID()
  pageId: string;

  @IsOptional()
  @IsUUID()
  targetPageId?: string;

  @IsOptional()
  @IsUUID()
  targetSpaceId?: string;
}
