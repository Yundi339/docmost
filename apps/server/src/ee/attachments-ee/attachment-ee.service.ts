import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { StorageService } from '../../integrations/storage/storage.service';

const MAX_TEXT_LENGTH = 1_000_000;

@Injectable()
export class AttachmentEeService {
  private readonly logger = new Logger(AttachmentEeService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Extract text from a single attachment and update its tsvector.
   */
  async indexAttachment(attachmentId: string): Promise<void> {
    const attachment = await this.db
      .selectFrom('attachments')
      .select(['id', 'filePath', 'fileExt', 'fileName'])
      .where('id', '=', attachmentId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!attachment) {
      this.logger.debug(`Attachment ${attachmentId} not found, skipping`);
      return;
    }

    let text: string;
    try {
      const ext = attachment.fileExt?.toLowerCase();
      if (ext === '.pdf') {
        text = await this.extractPdfText(attachment.filePath);
      } else if (ext === '.docx') {
        text = await this.extractDocxText(attachment.filePath);
      } else {
        this.logger.debug(
          `Unsupported file type ${ext} for indexing, skipping`,
        );
        return;
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to extract text from attachment ${attachmentId} (${attachment.fileName}): ${err?.message}`,
      );
      return;
    }

    if (!text || text.trim().length === 0) {
      this.logger.debug(
        `No text extracted from attachment ${attachmentId}, skipping`,
      );
      return;
    }

    // Truncate to limit
    const truncatedText = text.substring(0, MAX_TEXT_LENGTH);

    try {
      await this.db
        .updateTable('attachments')
        .set({
          textContent: truncatedText,
          tsv: sql`to_tsvector('english', f_unaccent(${truncatedText}))`,
        })
        .where('id', '=', attachmentId)
        .execute();

      this.logger.debug(
        `Indexed attachment ${attachmentId} (${truncatedText.length} chars)`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to update tsvector for attachment ${attachmentId}: ${err?.message}`,
      );
    }
  }

  /**
   * Bulk-index all unindexed PDF/DOCX attachments in a workspace.
   */
  async indexAttachments(workspaceId: string): Promise<void> {
    const attachments = await this.db
      .selectFrom('attachments')
      .select(['id'])
      .where('workspaceId', '=', workspaceId)
      .where('textContent', 'is', null)
      .where('deletedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb('fileExt', 'ilike', '.pdf'),
          eb('fileExt', 'ilike', '.docx'),
        ]),
      )
      .execute();

    this.logger.log(
      `Bulk indexing ${attachments.length} attachments for workspace ${workspaceId}`,
    );

    let processed = 0;
    let failed = 0;

    for (const att of attachments) {
      try {
        await this.indexAttachment(att.id);
        processed++;
      } catch (err: any) {
        failed++;
        this.logger.warn(
          `Failed to index attachment ${att.id}: ${err?.message}`,
        );
      }

      // Log progress every 50 attachments
      if ((processed + failed) % 50 === 0) {
        this.logger.log(
          `Bulk indexing progress: ${processed + failed}/${attachments.length} (${failed} failed)`,
        );
      }
    }

    this.logger.log(
      `Bulk indexing complete: ${processed} indexed, ${failed} failed out of ${attachments.length}`,
    );
  }

  private async extractPdfText(filePath: string): Promise<string> {
    const fileBuffer = await this.storageService.read(filePath);

    // pdfjs-dist is ESM, use dynamic import
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(fileBuffer),
      useSystemFonts: true,
    }).promise;

    const textParts: string[] = [];

    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .filter((item: any) => 'str' in item)
          .map((item: any) => item.str)
          .join(' ');
        if (pageText.trim()) {
          textParts.push(pageText);
        }

        // Early exit if we have enough text
        const currentLength = textParts.join('\n').length;
        if (currentLength >= MAX_TEXT_LENGTH) {
          break;
        }
      }
    } finally {
      await doc.destroy();
    }

    return textParts.join('\n');
  }

  private async extractDocxText(filePath: string): Promise<string> {
    const fileBuffer = await this.storageService.read(filePath);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return result.value;
  }
}
