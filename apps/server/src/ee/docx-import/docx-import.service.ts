import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { StorageService } from '../../integrations/storage/storage.service';
import { v4 as uuid4, v7 as uuid7 } from 'uuid';
import {
  AttachmentType,
} from '../../core/attachment/attachment.constants';
import {
  getAttachmentFolderPath,
} from '../../core/attachment/attachment.utils';

@Injectable()
export class DocxImportService {
  private readonly logger = new Logger(DocxImportService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
  ) {}

  async convertDocxToHtml(
    fileBuffer: Buffer,
    workspaceId: string,
    spaceId: string,
    pageId: string,
    userId: string,
  ): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth');

    const result = await mammoth.convertToHtml(
      { buffer: fileBuffer },
      {
        // Security: disable external file access
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(
          async (image: any) => {
            try {
              const imageBuffer: Buffer = await image.readAsBuffer();
              const contentType: string = image.contentType || 'image/png';
              const ext = this.getExtensionFromMimeType(contentType);

              const attachmentId = uuid7();
              const fileName = `${uuid4()}${ext}`;
              const storagePath = `${getAttachmentFolderPath(AttachmentType.File, workspaceId)}/${attachmentId}/${fileName}`;

              await this.storageService.upload(storagePath, imageBuffer);

              await this.db
                .insertInto('attachments')
                .values({
                  id: attachmentId,
                  filePath: storagePath,
                  fileName: fileName,
                  fileSize: imageBuffer.length,
                  mimeType: contentType,
                  type: AttachmentType.File,
                  fileExt: ext,
                  creatorId: userId,
                  workspaceId: workspaceId,
                  pageId: pageId,
                  spaceId: spaceId,
                })
                .execute();

              return {
                src: `/api/attachments/${attachmentId}/${fileName}`,
              };
            } catch (err: any) {
              this.logger.warn(
                `Failed to process embedded image: ${err?.message}`,
              );
              // Return empty image rather than crashing the whole import
              return { src: '' };
            }
          },
        ),
      },
    );

    if (result.messages && result.messages.length > 0) {
      for (const msg of result.messages) {
        if (msg.type === 'error') {
          this.logger.error(`DOCX conversion error: ${msg.message}`);
        } else {
          this.logger.warn(`DOCX conversion warning: ${msg.message}`);
        }
      }
    }

    return result.value;
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp',
      'image/tiff': '.tiff',
    };
    return map[mimeType] || '.png';
  }
}
