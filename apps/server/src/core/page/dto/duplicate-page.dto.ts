import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class DuplicatePageDto {
  @IsNotEmpty()
  @IsUUID()
  pageId: string;

  @IsOptional()
  @IsUUID()
  spaceId?: string;
}

export type CopyPageMapEntry = {
  newPageId: string;
  newSlugId: string;
  oldSlugId: string;
};

export type ICopyPageAttachment = {
  newPageId: string,
  oldPageId: string,
  oldAttachmentId: string,
  newAttachmentId: string,
};
