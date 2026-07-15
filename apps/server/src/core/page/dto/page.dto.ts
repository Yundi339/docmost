import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { validate as isValidUUID } from 'uuid';

import { ContentFormat } from './create-page.dto';

const PAGE_SLUG_ID_PATTERN = /^[0-9A-Za-z]{10}$/;

function IsPageIdentifier(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPageIdentifier',
      target: object.constructor,
      propertyName,
      options: {
        message: '$property must be a UUID or page slug ID',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' &&
            (isValidUUID(value) || PAGE_SLUG_ID_PATTERN.test(value))
          );
        },
      },
    });
  };
}

export class PageIdDto {
  @IsNotEmpty()
  @IsUUID()
  pageId: string;
}

export class SpaceIdDto {
  @IsUUID()
  spaceId: string;
}

export class PageHistoryIdDto {
  @IsUUID()
  historyId: string;
}

export class PageInfoDto {
  @IsNotEmpty()
  @IsPageIdentifier()
  pageId: string;

  @IsOptional()
  @IsBoolean()
  includeSpace: boolean;

  @IsOptional()
  @IsBoolean()
  includeContent: boolean;

  @IsOptional()
  @Transform(({ value }) => value?.toLowerCase())
  @IsIn(['json', 'markdown', 'html'])
  format?: ContentFormat;
}

export class DeletePageDto extends PageIdDto {
  @IsOptional()
  @IsBoolean()
  permanentlyDelete?: boolean;
}

export class BatchPageIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  pageIds: string[];
}

export class BatchDeletePagesDto extends BatchPageIdsDto {
  @IsBoolean()
  @Equals(true, { message: 'confirm must be true' })
  confirm: boolean;
}
