import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { ImportService } from '../../integrations/import/services/import.service';
import { ImportAttachmentService } from '../../integrations/import/services/import-attachment.service';
import { BacklinkRepo } from '@docmost/db/repos/backlink/backlink.repo';
import { PageService } from '../../core/page/services/page.service';
import { formatImportHtml } from '../../integrations/import/utils/import-formatter';
import {
  buildAttachmentCandidates,
} from '../../integrations/import/utils/import.utils';
import { getProsemirrorContent } from '../../common/helpers/prosemirror/utils';
import { jsonToText } from '../../collaboration/collaboration.util';
import { generateSlugId } from '../../common/helpers';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { v7 } from 'uuid';
import { FileTask, InsertablePage } from '@docmost/db/types/entity.types';
import { executeTx } from '@docmost/db/utils';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';
import * as path from 'path';
import { promises as fs } from 'fs';
import { Cheerio, load as cheerioLoad } from 'cheerio';

interface ConfluencePageNode {
  id: string;
  slugId: string;
  name: string;
  content: string;
  parentPageId: string | null;
  filePath: string;
  position?: string;
}

@Injectable()
export class ConfluenceImportService {
  private readonly logger = new Logger(ConfluenceImportService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly importService: ImportService,
    private readonly importAttachmentService: ImportAttachmentService,
    private readonly backlinkRepo: BacklinkRepo,
    private readonly pageService: PageService,
    private eventEmitter: EventEmitter2,
  ) {}

  async processConfluenceImport(opts: {
    extractDir: string;
    fileTask: FileTask;
  }): Promise<void> {
    const { extractDir, fileTask } = opts;

    // 1. Collect all HTML files
    const allHtmlFiles = await this.collectHtmlFiles(extractDir);
    if (allHtmlFiles.length === 0) {
      this.logger.warn('No HTML files found in Confluence export');
      return;
    }

    // 2. Build attachment candidates
    const attachmentCandidates = await buildAttachmentCandidates(extractDir);

    // 3. Parse page tree from index.html
    const pageTree = await this.parsePageTree(extractDir, allHtmlFiles);

    // 4. Build pagesMap
    const pagesMap = new Map<string, ConfluencePageNode>();
    for (const node of pageTree) {
      pagesMap.set(node.filePath, node);
    }

    if (pagesMap.size === 0) {
      this.logger.warn('No pages extracted from Confluence export');
      return;
    }

    // 5. Get space info
    const space = await this.db
      .selectFrom('spaces')
      .select(['slug'])
      .where('id', '=', fileTask.spaceId)
      .executeTakeFirst();

    // 6. Generate positions
    const siblingsMap = new Map<string | null, ConfluencePageNode[]>();
    pagesMap.forEach((page) => {
      const group = siblingsMap.get(page.parentPageId) ?? [];
      group.push(page);
      siblingsMap.set(page.parentPageId, group);
    });

    // Sort siblings alphabetically
    siblingsMap.forEach((sibs) => {
      sibs.sort((a, b) => a.name.localeCompare(b.name));
    });

    // Root pages
    const rootSibs = siblingsMap.get(null);
    if (rootSibs?.length) {
      const nextPosition = await this.pageService.nextPagePosition(
        fileTask.spaceId,
      );
      let prevPos: string | null = null;
      rootSibs.forEach((page, idx) => {
        if (idx === 0) {
          page.position = nextPosition;
        } else {
          page.position = generateJitteredKeyBetween(prevPos, null);
        }
        prevPos = page.position;
      });
    }

    // Non-root
    siblingsMap.forEach((sibs, parentId) => {
      if (parentId === null) return;
      let prevPos: string | null = null;
      for (const page of sibs) {
        page.position = generateJitteredKeyBetween(prevPos, null);
        prevPos = page.position;
      }
    });

    // 7. Build filePathToPageMetaMap for internal link rewriting
    const filePathToPageMetaMap = new Map<
      string,
      { id: string; title: string; slugId: string }
    >();
    pagesMap.forEach((page) => {
      filePathToPageMetaMap.set(page.filePath, {
        id: page.id,
        title: page.name,
        slugId: page.slugId,
      });
    });

    // 8. BFS level ordering for inserts
    const pagesByLevel = new Map<number, Array<[string, ConfluencePageNode]>>();
    const pageLevel = new Map<string, number>();

    // Calculate levels
    const queue: Array<{ filePath: string; level: number }> = [];
    for (const [filePath, page] of pagesMap.entries()) {
      if (!page.parentPageId) {
        queue.push({ filePath, level: 0 });
        pageLevel.set(filePath, 0);
      }
    }
    while (queue.length > 0) {
      const { filePath, level } = queue.shift()!;
      const currentPage = pagesMap.get(filePath)!;
      for (const [childPath, childPage] of pagesMap.entries()) {
        if (
          childPage.parentPageId === currentPage.id &&
          !pageLevel.has(childPath)
        ) {
          pageLevel.set(childPath, level + 1);
          queue.push({ filePath: childPath, level: level + 1 });
        }
      }
    }
    for (const [filePath] of pagesMap.entries()) {
      const level = pageLevel.get(filePath) || 0;
      if (!pagesByLevel.has(level)) {
        pagesByLevel.set(level, []);
      }
      pagesByLevel.get(level)!.push([filePath, pagesMap.get(filePath)!]);
    }

    // 9. Process pages level by level
    const allBacklinks: any[] = [];
    const validPageIds = new Set<string>();
    const pageTitles = new Map<string, string>();
    let totalPagesProcessed = 0;

    const sortedLevels = Array.from(pagesByLevel.keys()).sort((a, b) => a - b);

    try {
      await executeTx(this.db, async (trx) => {
        for (const level of sortedLevels) {
          const levelPages = pagesByLevel.get(level)!;

          for (const [filePath, page] of levelPages) {
            const absPath = path.join(extractDir, filePath);
            let rawHtml = '';

            try {
              rawHtml = await fs.readFile(absPath, 'utf-8');
            } catch (err: any) {
              if (err?.code === 'ENOENT') {
                rawHtml = '';
              } else {
                throw err;
              }
            }

            // Extract content from Confluence HTML
            const contentHtml = this.extractConfluenceContent(rawHtml);

            // Process attachments (with Confluence-specific handling)
            const htmlWithAttachments =
              await this.importAttachmentService.processAttachments({
                html: contentHtml,
                pageRelativePath: filePath,
                extractDir,
                pageId: page.id,
                fileTask,
                attachmentCandidates,
                isConfluenceImport: true,
              });

            // Format and rewrite internal links
            const { html, backlinks } = await formatImportHtml({
              html: htmlWithAttachments,
              currentFilePath: filePath,
              filePathToPageMetaMap,
              creatorId: fileTask.creatorId,
              sourcePageId: page.id,
              workspaceId: fileTask.workspaceId,
              spaceSlug: space?.slug,
            });

            const pmState = getProsemirrorContent(
              await this.importService.processHTML(html),
            );

            const { title, prosemirrorJson } =
              this.importService.extractTitleAndRemoveHeading(pmState);

            const insertablePage: InsertablePage = {
              id: page.id,
              slugId: page.slugId,
              title: title || page.name,
              icon: null,
              content: prosemirrorJson,
              textContent: jsonToText(prosemirrorJson),
              ydoc: await this.importService.createYdoc(prosemirrorJson),
              position: page.position!,
              spaceId: fileTask.spaceId,
              workspaceId: fileTask.workspaceId,
              creatorId: fileTask.creatorId,
              lastUpdatedById: fileTask.creatorId,
              parentPageId: page.parentPageId,
            };

            await trx.insertInto('pages').values(insertablePage).execute();

            validPageIds.add(insertablePage.id);
            pageTitles.set(insertablePage.id, insertablePage.title);
            allBacklinks.push(...backlinks);
            totalPagesProcessed++;

            if (totalPagesProcessed % 50 === 0) {
              this.logger.debug(
                `Confluence import: processed ${totalPagesProcessed} pages...`,
              );
            }
          }
        }

        // Insert backlinks
        const filteredBacklinks = allBacklinks.filter(
          ({ sourcePageId, targetPageId }) =>
            validPageIds.has(sourcePageId) && validPageIds.has(targetPageId),
        );

        if (filteredBacklinks.length > 0) {
          const BATCH_SIZE = 100;
          for (let i = 0; i < filteredBacklinks.length; i += BATCH_SIZE) {
            const chunk = filteredBacklinks.slice(
              i,
              Math.min(i + BATCH_SIZE, filteredBacklinks.length),
            );
            await this.backlinkRepo.insertBacklink(chunk, trx);
          }
        }

        if (validPageIds.size > 0) {
          this.eventEmitter.emit(EventName.PAGE_CREATED, {
            pageIds: Array.from(validPageIds),
            workspaceId: fileTask.workspaceId,
          });
        }

        this.logger.log(
          `Confluence import complete: ${totalPagesProcessed} pages, ${filteredBacklinks.length} backlinks`,
        );
      });
    } catch (err) {
      this.logger.error(`Confluence import failed: ${(err as any)?.message}`, (err as any)?.stack);
      throw err;
    }
  }

  /**
   * Extract main content from a Confluence HTML export page.
   * Strips navigation, breadcrumbs, headers, footers.
   */
  private extractConfluenceContent(html: string): string {
    if (!html || html.trim().length === 0) return '';

    const $ = cheerioLoad(html);

    // Remove known non-content elements
    $(
      'script, style, link, meta, .page-metadata, ' +
        '#header, #footer, .breadcrumb-section, .breadcrumbs, ' +
        '#likes-and-labels-container, .pageSection.group, ' +
        '#comments-section, .plugin_pagetree, ' +
        '.page-metadata-modification-info',
    ).remove();

    // Try multiple selectors for Confluence content area
    const selectors = [
      '#main-content .wiki-content',
      '#main-content',
      '.wiki-content',
      '#content .page-content',
      '.page-content',
      '#content-body',
      'article',
    ];

    for (const selector of selectors) {
      const content = $(selector).html();
      if (content && content.trim().length > 0) {
        return content;
      }
    }

    // Fallback: return body or entire HTML
    const body = $('body').html();
    return body || html;
  }

  /**
   * Parse the page hierarchy from a Confluence export.
   * Strategy 1: Parse index.html nested <ul> list
   * Strategy 2: Fall back to flat list of all HTML files
   */
  private async parsePageTree(
    extractDir: string,
    allHtmlFiles: string[],
  ): Promise<ConfluencePageNode[]> {
    const pages: ConfluencePageNode[] = [];
    const indexPath = path.join(extractDir, 'index.html');

    let indexExists = false;
    try {
      await fs.access(indexPath);
      indexExists = true;
    } catch {
      indexExists = false;
    }

    if (indexExists) {
      try {
        const indexHtml = await fs.readFile(indexPath, 'utf-8');
        const treePages = this.parseIndexHtml(
          indexHtml,
          extractDir,
          allHtmlFiles,
        );
        if (treePages.length > 0) {
          return treePages;
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to parse index.html, falling back to flat import: ${err?.message}`,
        );
      }
    }

    // Flat fallback: all HTML files as root pages
    for (const absPath of allHtmlFiles) {
      const relPath = path
        .relative(extractDir, absPath)
        .split(path.sep)
        .join('/');

      // Skip index.html itself
      if (relPath === 'index.html') continue;

      const name = this.extractPageNameFromFile(relPath);
      pages.push({
        id: v7(),
        slugId: generateSlugId(),
        name,
        content: '',
        parentPageId: null,
        filePath: relPath,
      });
    }

    return pages;
  }

  /**
   * Parse a Confluence index.html to extract page hierarchy from nested <ul>/<li> lists.
   */
  private parseIndexHtml(
    indexHtml: string,
    extractDir: string,
    allHtmlFiles: string[],
  ): ConfluencePageNode[] {
    const $ = cheerioLoad(indexHtml);
    const pages: ConfluencePageNode[] = [];

    // Build a set of available HTML files for validation
    const availableFiles = new Set(
      allHtmlFiles.map((f) =>
        path.relative(extractDir, f).split(path.sep).join('/'),
      ),
    );

    // Find the main page tree list
    // Confluence exports typically have a nested <ul> inside #content or the page body
    const rootLists = $('ul').first();

    if (rootLists.length === 0) {
      return [];
    }

    // Parse <ul>/<li> recursively
    const parseList = (
      $ul: Cheerio<any>,
      parentId: string | null,
    ) => {
      $ul.children('li').each((_, li) => {
        const $li = $(li);
        const $a = $li.children('a').first();

        if ($a.length === 0) return;

        let href = $a.attr('href') || '';
        // Decode and normalize
        try {
          href = decodeURIComponent(href);
        } catch {
          // Keep as is
        }
        href = href.replace(/^\.\//, '');

        // Validate that this file exists
        if (!availableFiles.has(href)) return;

        const linkText = $a.text().trim();
        const name =
          linkText || this.extractPageNameFromFile(href);

        const node: ConfluencePageNode = {
          id: v7(),
          slugId: generateSlugId(),
          name,
          content: '',
          parentPageId: parentId,
          filePath: href,
        };

        pages.push(node);

        // Parse nested <ul> for children
        const $childUl = $li.children('ul');
        if ($childUl.length > 0) {
          parseList($childUl, node.id);
        }
      });
    };

    parseList(rootLists, null);
    return pages;
  }

  /**
   * Extract a clean page name from a Confluence file path.
   * E.g., "My-Page_123456.html" → "My Page"
   */
  private extractPageNameFromFile(filePath: string): string {
    let name = path.basename(filePath, '.html');

    // Remove Confluence page ID suffix: "Page-Title_12345678"
    name = name.replace(/_\d+$/, '');

    // Replace hyphens and underscores with spaces
    name = name.replace(/[-_]+/g, ' ').trim();

    return name || 'Untitled';
  }

  /**
   * Collect all .html files from the extract directory.
   */
  private async collectHtmlFiles(dir: string): Promise<string[]> {
    const results: string[] = [];

    const walk = async (current: string) => {
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const fullPath = path.join(current, ent.name);
        if (ent.isDirectory()) {
          // Skip styles/css directories
          if (ent.name === 'styles' || ent.name === 'css') continue;
          await walk(fullPath);
        } else if (ent.name.toLowerCase().endsWith('.html')) {
          results.push(fullPath);
        }
      }
    };

    await walk(dir);
    return results;
  }
}
