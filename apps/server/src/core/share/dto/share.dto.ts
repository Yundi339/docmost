import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateShareDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsBoolean()
  @IsOptional()
  includeSubPages: boolean;

  @IsOptional()
  @IsBoolean()
  searchIndexing: boolean;
}

export class UpdateShareDto extends CreateShareDto {
  @IsString()
  @IsNotEmpty()
  shareId: string;

  @IsString()
  @IsOptional()
  pageId: string;
}

export class ShareIdDto {
  @IsString()
  @IsNotEmpty()
  shareId: string;
}

export class SpaceIdDto {
  @IsUUID()
  spaceId: string;
}

export class ShareInfoDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class SharePageIdDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class SetSharePasswordDto extends ShareIdDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class UnlockShareDto {
  @IsString()
  @IsOptional()
  shareId?: string;

  @IsString()
  @IsOptional()
  pageId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
