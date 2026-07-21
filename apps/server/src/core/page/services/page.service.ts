import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePageDto, ContentFormat } from '../dto/create-page.dto';
import { ContentOperation, UpdatePageDto } from '../dto/update-page.dto';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { InsertablePage, Page, User } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  CursorPaginationResult,
  executeWithCursorPagination,
} from '@docmost/db/pagination/cursor-pagination';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { MovePageDto } from '../dto/move-page.dto';
import { generateSlugId } from '../../../common/helpers';
import { getPageTitle } from '../../../common/helpers';
import { executeTx } from '@docmost/db/utils';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { v7 as uuid7 } from 'uuid';
import {
  createYdocFromJson,
  getAttachmentIds,
  getProsemirrorContent,
  isAttachmentNode,
  removeMarkTypeFromDoc,
} from '../../../common/helpers/prosemirror/utils';
import {
  htmlToJson,
  jsonToNode,
  jsonToText,
} from 'src/collaboration/collaboration.util';
import {
  CopyPageMapEntry,
  ICopyPageAttachment,
} from '../dto/duplicate-page.dto';
import { Node as PMNode } from '@tiptap/pm/model';
import { StorageService } from '../../../integrations/storage/storage.service';
import { getAttachmentFolderPath } from '../../attachment/attachment.utils';
import { AttachmentType } from '../../attachment/attachment.constants';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { EventName } from '../../../common/events/event.contants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import {
  INTERNAL_LINK_REGEX,
  extractPageSlugId,
} from '../../../integrations/export/utils';
import { markdownToHtml } from '@docmost/editor-ext';
import { WatcherService } from '../../watcher/watcher.service';
import { sql } from 'kysely';
import { WsTreeService } from '../../../ws/ws-tree.service';
import { PageOperationPolicyService } from '../policies/page-operation-policy.service';
import { PageContentLifecycleService } from '../../../collaboration/services/page-content-lifecycle.service';
import { PageAccessService } from '../page-access/page-access.service';

export type DeletedPageListItem = Page & {
  trashCapabilities: {
    canRestore: boolean;
    canPermanentlyDelete: boolean;
  };
};

@Injectable()
export class PageService {
  private readonly logger = new Logger(PageService.name);

  constructor(
    private pageRepo: PageRepo,
    private pagePermissionRepo: PagePermissionRepo,
    private attachmentRepo: AttachmentRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storageService: StorageService,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
    @InjectQueue(QueueName.GENERAL_QUEUE) private generalQueue: Queue,
    private eventEmitter: EventEmitter2,
    private collaborationGateway: CollaborationGateway,
    private readonly watcherService: WatcherService,
    private readonly wsTreeService: WsTreeService,
    private readonly pageOperationPolicy: PageOperationPolicyService,
    private readonly pageContentLifecycle: PageContentLifecycleService,
    private readonly pageAccessService: PageAccessService,
  ) {}

  async findById(
    pageId: string,
    includeContent?: boolean,
    includeYdoc?: boolean,
    includeSpace?: boolean,
  ): Promise<Page> {
    return this.pageRepo.findById(pageId, {
      includeContent,
      includeYdoc,
      includeSpace,
    });
  }

  async create(
    userId: string,
    workspaceId: string,
    createPageDto: CreatePageDto,
  ): Promise<Page> {
    let content = undefined;
    let textContent = undefined;
    let ydoc = undefined;

    if (createPageDto?.content && createPageDto?.format) {
      const prosemirrorJson = await this.parseProsemirrorContent(
        createPageDto.content,
        createPageDto.format,
      );

      content = prosemirrorJson;
      textContent = jsonToText(prosemirrorJson);
      ydoc = createYdocFromJson(prosemirrorJson);
    }

    const page = await executeTx(this.db, async (trx) => {
      let parentPageId: string | undefined;
      if (createPageDto.parentPageId) {
        const parentPage = await this.pageRepo.findById(
          createPageDto.parentPageId,
          { trx, withLock: true },
        );
        if (
          !parentPage ||
          parentPage.deletedAt ||
          parentPage.spaceId !== createPageDto.spaceId ||
          parentPage.workspaceId !== workspaceId
        ) {
          throw new NotFoundException('Parent page not found');
        }

        await this.pageOperationPolicy.assertOperation({
          operation: 'createChild',
          parentPage,
          actorId: userId,
          trx,
        });
        parentPageId = parentPage.id;
      }

      return this.pageRepo.insertPage(
        {
          slugId: generateSlugId(),
          title: createPageDto.title,
          position: await this.nextPagePositionIn(
            trx,
            createPageDto.spaceId,
            parentPageId,
          ),
          icon: createPageDto.icon,
          parentPageId,
          spaceId: createPageDto.spaceId,
          creatorId: userId,
          workspaceId,
          lastUpdatedById: userId,
          content,
          textContent,
          ydoc,
        },
        trx,
        false,
      );
    });

    this.eventEmitter.emit(EventName.PAGE_CREATED, {
      pageIds: [page.id],
      workspaceId: page.workspaceId,
    });

    this.generalQueue
      .add(QueueJob.ADD_PAGE_WATCHERS, {
        userIds: [userId],
        pageId: page.id,
        spaceId: createPageDto.spaceId,
        workspaceId,
      })
      .catch((err) =>
        this.logger.warn(`Failed to queue add-page-watchers: ${err.message}`),
      );

    return page;
  }

  async nextPagePosition(spaceId: string, parentPageId?: string | null) {
    return this.nextPagePositionIn(this.db, spaceId, parentPageId);
  }

  async lockPageTreeSpacesForUpdate(
    spaceIds: string[],
    trx: KyselyTransaction,
  ): Promise<void> {
    for (const spaceId of [...new Set(spaceIds)].sort()) {
      await this.lockSpaceTreeForMove(spaceId, trx);
    }
  }

  private async nextPagePositionIn(
    db: KyselyDB | KyselyTransaction,
    spaceId: string,
    parentPageId?: string | null,
  ) {
    let pagePosition: string;

    const lastPageQuery = db
      .selectFrom('pages')
      .select(['position'])
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .orderBy('position', (ob) => ob.collate('C').desc())
      .limit(1);

    if (parentPageId) {
      // check for children of this page
      const lastPage = await lastPageQuery
        .where('parentPageId', '=', parentPageId)
        .executeTakeFirst();

      if (!lastPage) {
        pagePosition = generateJitteredKeyBetween(null, null);
      } else {
        // if there is an existing page, we should get a position below it
        pagePosition = generateJitteredKeyBetween(lastPage.position, null);
      }
    } else {
      // for root page
      const lastPage = await lastPageQuery
        .where('parentPageId', 'is', null)
        .executeTakeFirst();

      // if no existing page, make this the first
      if (!lastPage) {
        pagePosition = generateJitteredKeyBetween(null, null); // we expect "a0"
      } else {
        // if there is an existing page, we should get a position below it
        pagePosition = generateJitteredKeyBetween(lastPage.position, null);
      }
    }

    return pagePosition;
  }

  async update(
    page: Page,
    updatePageDto: UpdatePageDto,
    user: User,
  ): Promise<Page> {
    const updatesContent = Boolean(
      updatePageDto.content !== undefined &&
      updatePageDto.operation &&
      updatePageDto.format,
    );
    if (updatesContent) {
      await this.updatePageContent(
        page.id,
        updatePageDto.content,
        updatePageDto.operation,
        updatePageDto.format,
        user,
      );
    }

    const latestPage = updatesContent
      ? await this.pageRepo.findById(page.id)
      : page;
    if (!latestPage || latestPage.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    const contributors = new Set<string>(latestPage.contributorIds);
    contributors.add(user.id);

    await this.pageRepo.updatePage(
      {
        title: updatePageDto.title,
        icon: updatePageDto.icon,
        lastUpdatedById: user.id,
        updatedAt: new Date(),
        contributorIds: Array.from(contributors),
      },
      page.id,
    );

    this.generalQueue
      .add(QueueJob.ADD_PAGE_WATCHERS, {
        userIds: [user.id],
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
      })
      .catch((err) =>
        this.logger.warn(`Failed to queue add-page-watchers: ${err.message}`),
      );

    const updatedPage = await this.pageRepo.findById(page.id, {
      includeSpace: true,
      includeContent: true,
      includeCreator: true,
      includeLastUpdatedBy: true,
      includeContributors: true,
    });

    if (updatePageDto.title !== undefined || updatePageDto.icon !== undefined) {
      await this.wsTreeService.notifyPageUpdated(updatedPage);
    }

    return updatedPage;
  }

  async updatePageContent(
    pageId: string,
    content: string | object,
    operation: ContentOperation,
    format: ContentFormat,
    user: User,
  ): Promise<void> {
    const prosemirrorJson = await this.parseProsemirrorContent(content, format);

    await executeTx(this.db, async (trx) => {
      const currentPage = await this.pageRepo.findById(pageId, {
        includeContent: operation === 'replace',
        trx,
        withLock: true,
      });
      if (
        !currentPage ||
        currentPage.deletedAt ||
        currentPage.workspaceId !== user.workspaceId
      ) {
        throw new NotFoundException('Page not found');
      }
      await this.pageAccessService.validateCanEdit(currentPage, user);

      if (operation === 'replace') {
        await this.pageContentLifecycle.validateBeforeSave({
          page: currentPage,
          previousContent: currentPage.content,
          nextContent: prosemirrorJson,
          actor: user,
          trx,
          origin: 'direct',
        });
      }
    });

    const documentName = `page.${pageId}`;
    await this.collaborationGateway.handleYjsEvent(
      'updatePageContent',
      documentName,
      { operation, prosemirrorJson, user },
    );
  }

  async getSidebarPages(
    spaceId: string,
    pagination: PaginationOptions,
    pageId?: string,
    userId?: string,
    spaceCanEdit?: boolean,
    all?: boolean,
  ): Promise<CursorPaginationResult<Partial<Page> & { hasChildren: boolean }>> {
    let query = this.db
      .selectFrom('pages')
      .select([
        'id',
        'slugId',
        'title',
        'icon',
        'position',
        'parentPageId',
        'spaceId',
        'creatorId',
        'deletedAt',
      ])
      .select((eb) => this.pageRepo.withHasChildren(eb))
      .where('deletedAt', 'is', null)
      .where('spaceId', '=', spaceId);

    if (!all) {
      if (pageId) {
        query = query.where('parentPageId', '=', pageId);
      } else {
        query = query.where('parentPageId', 'is', null);
      }
    }

    const result = await executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        {
          expression: 'position',
          direction: 'asc',
          orderModifier: (ob) => ob.collate('C').asc(),
          cursorExpression: sql`position collate "C"`,
        },
        { expression: 'id', direction: 'asc' },
      ],
      parseCursor: (cursor) => ({
        position: cursor.position,
        id: cursor.id,
      }),
    });

    if (userId && result.items.length > 0) {
      const hasRestrictions =
        await this.pagePermissionRepo.hasRestrictedPagesInSpace(spaceId);

      if (!hasRestrictions) {
        result.items = result.items.map((p: any) => ({
          ...p,
          canEdit: spaceCanEdit ?? true,
        }));
      } else {
        const pageIds = result.items.map((p: any) => p.id);

        const accessiblePages =
          await this.pagePermissionRepo.filterAccessiblePageIdsWithPermissions(
            pageIds,
            userId,
          );

        const permissionMap = new Map(
          accessiblePages.map((p) => [p.id, p.canEdit]),
        );

        result.items = result.items
          .filter((p: any) => permissionMap.has(p.id))
          .map((p: any) => ({
            ...p,
            canEdit: permissionMap.get(p.id) && (spaceCanEdit ?? true),
          }));

        const pagesWithChildren = result.items.filter(
          (p: any) => p.hasChildren,
        );
        if (pagesWithChildren.length > 0) {
          const parentIds = pagesWithChildren.map((p: any) => p.id);
          const parentsWithAccessibleChildren =
            await this.pagePermissionRepo.getParentIdsWithAccessibleChildren(
              parentIds,
              userId,
            );
          const hasAccessibleChildrenSet = new Set(
            parentsWithAccessibleChildren,
          );

          result.items = result.items.map((p: any) => ({
            ...p,
            hasChildren: p.hasChildren && hasAccessibleChildrenSet.has(p.id),
          }));
        }
      }
    }

    result.items = await this.pageOperationPolicy.addMetadata(result.items);

    return result;
  }

  async movePageToSpace(
    rootPage: Page,
    spaceId: string,
    userId: string,
    parentPageId: string | null = null,
    existingTrx?: KyselyTransaction,
    notify = true,
  ) {
    if (rootPage.spaceId === spaceId) {
      await this.movePageToParent(
        rootPage,
        parentPageId,
        userId,
        existingTrx,
        notify,
      );
      return { childPageIds: [] };
    }

    let childPageIds: string[] = [];

    const allPages = await this.pageRepo.getPageAndDescendants(rootPage.id, {
      includeContent: false,
    });

    // Filter to only accessible pages while maintaining tree integrity
    const accessiblePages = await this.filterAccessibleTreePages(
      allPages,
      rootPage.id,
      userId,
      rootPage.spaceId,
    );
    const accessibleIds = new Set(accessiblePages.map((p) => p.id));

    // Find inaccessible pages whose parent is being moved - these need to be orphaned
    const pagesToOrphan = allPages.filter(
      (p) =>
        !accessibleIds.has(p.id) &&
        p.parentPageId &&
        accessibleIds.has(p.parentPageId),
    );
    const pagesToSynchronize = [rootPage, ...pagesToOrphan];
    const pageAudiences = notify
      ? new Map(
          await Promise.all(
            pagesToSynchronize.map(
              async (page) =>
                [
                  page.id,
                  await this.wsTreeService.capturePageAudience(page),
                ] as const,
            ),
          ),
        )
      : new Map();

    await executeTx(
      this.db,
      async (trx) => {
        for (const lockedSpaceId of [
          ...new Set([rootPage.spaceId, spaceId]),
        ].sort()) {
          await this.lockSpaceTreeForMove(lockedSpaceId, trx);
        }

        if (parentPageId) {
          const targetParent = await this.pageRepo.findById(parentPageId, {
            withLock: true,
            trx,
          });
          if (
            !targetParent ||
            targetParent.deletedAt ||
            targetParent.spaceId !== spaceId ||
            targetParent.workspaceId !== rootPage.workspaceId
          ) {
            throw new NotFoundException('Parent page not found');
          }
        }

        await this.pageOperationPolicy.assertOperation({
          operation: 'move',
          page: rootPage,
          targetParentPageId: parentPageId,
          targetSpaceId: spaceId,
          affectedPageIds: allPages.map((page) => page.id),
          actorId: userId,
          trx,
        });

        // Orphan inaccessible child pages (make them root pages in original space)
        for (const page of pagesToOrphan) {
          const orphanPosition = await this.nextPagePositionIn(
            trx,
            rootPage.spaceId,
            null,
          );
          await this.pageRepo.updatePage(
            { parentPageId: null, position: orphanPosition },
            page.id,
            trx,
          );
        }

        // Update root page
        const nextPosition = await this.nextPagePositionIn(
          trx,
          spaceId,
          parentPageId,
        );
        await this.pageRepo.updatePage(
          { spaceId, parentPageId, position: nextPosition },
          rootPage.id,
          trx,
        );

        const pageIdsToMove = accessiblePages.map((p) => p.id);

        childPageIds = pageIdsToMove.filter((id) => id !== rootPage.id);

        if (pageIdsToMove.length > 1) {
          // Update sub pages (all accessible pages except root)
          await this.pageRepo.updatePages({ spaceId }, childPageIds, trx);
        }

        if (pageIdsToMove.length > 0) {
          // Clear page-level permissions - moved pages inherit destination space permissions
          // (page_permissions cascade deletes via foreign key)
          await trx
            .deleteFrom('pageAccess')
            .where('pageId', 'in', pageIdsToMove)
            .execute();

          // update spaceId in shares
          await trx
            .updateTable('shares')
            .set({ spaceId: spaceId })
            .where('pageId', 'in', pageIdsToMove)
            .execute();

          // Update comments
          await trx
            .updateTable('comments')
            .set({ spaceId: spaceId })
            .where('pageId', 'in', pageIdsToMove)
            .execute();

          // Update page verifications
          await trx
            .updateTable('pageVerifications')
            .set({ spaceId: spaceId })
            .where('pageId', 'in', pageIdsToMove)
            .execute();

          // Update notifications — access follows the page after a move
          await trx
            .updateTable('notifications')
            .set({ spaceId: spaceId })
            .where('pageId', 'in', pageIdsToMove)
            .execute();

          // Update attachments
          await this.attachmentRepo.updateAttachmentsByPageId(
            { spaceId },
            pageIdsToMove,
            trx,
          );

          // Update watchers and remove those without access to new space
          await this.watcherService.movePageWatchersToSpace(
            pageIdsToMove,
            spaceId,
            {
              trx,
            },
          );

          await this.aiQueue.add(QueueJob.PAGE_MOVED_TO_SPACE, {
            pageIds: pageIdsToMove,
            workspaceId: rootPage.workspaceId,
          });
        }
      },
      existingTrx,
    );

    for (const page of notify ? pagesToSynchronize : []) {
      const relocatedPage = await this.pageRepo.findById(page.id, {
        includeHasChildren: true,
      });
      const audience = pageAudiences.get(page.id);
      if (!relocatedPage || !audience) continue;

      await this.wsTreeService.notifyPageRelocated(
        page,
        relocatedPage,
        Boolean(
          (relocatedPage as Page & { hasChildren?: boolean }).hasChildren,
        ),
        audience,
      );
    }

    return { childPageIds };
  }

  async movePageToParent(
    movedPage: Page,
    parentPageId: string | null,
    actorId: string,
    existingTrx?: KyselyTransaction,
    notify = true,
  ) {
    const previousAudience = notify
      ? await this.wsTreeService.capturePageAudience(movedPage)
      : null;

    await executeTx(
      this.db,
      async (trx) => {
        await this.lockSpaceTreeForMove(movedPage.spaceId, trx);

        const currentMovedPage = await this.pageRepo.findById(movedPage.id, {
          withLock: true,
          trx,
        });
        if (!currentMovedPage || currentMovedPage.deletedAt) {
          throw new NotFoundException('Moved page not found');
        }

        if (parentPageId) {
          const parentPage = await this.pageRepo.findById(parentPageId, {
            withLock: true,
            trx,
          });
          if (
            !parentPage ||
            parentPage.deletedAt ||
            parentPage.spaceId !== currentMovedPage.spaceId ||
            parentPage.workspaceId !== currentMovedPage.workspaceId
          ) {
            throw new NotFoundException('Parent page not found');
          }

          const wouldCreateCycle = await this.isPageInSubtree(
            currentMovedPage.id,
            parentPage.id,
            trx,
          );
          if (wouldCreateCycle) {
            throw new BadRequestException(
              'Cannot move a page under itself or its descendants',
            );
          }
        }

        await this.pageOperationPolicy.assertOperation({
          operation: 'move',
          page: currentMovedPage,
          targetParentPageId: parentPageId,
          targetSpaceId: currentMovedPage.spaceId,
          affectedPageIds: [currentMovedPage.id],
          actorId,
          trx,
        });

        const position = await this.nextPagePositionIn(
          trx,
          currentMovedPage.spaceId,
          parentPageId,
        );

        await this.pageRepo.updatePage(
          {
            parentPageId,
            position,
          },
          currentMovedPage.id,
          trx,
        );
      },
      existingTrx,
    );

    const relocatedPage = notify
      ? await this.pageRepo.findById(movedPage.id, {
          includeHasChildren: true,
        })
      : null;
    if (relocatedPage && previousAudience) {
      await this.wsTreeService.notifyPageRelocated(
        movedPage,
        relocatedPage,
        Boolean(
          (relocatedPage as Page & { hasChildren?: boolean }).hasChildren,
        ),
        previousAudience,
      );
    }
  }

  async duplicatePage(
    rootPage: Page,
    targetSpaceId: string | undefined,
    authUser: User,
  ) {
    const spaceId = targetSpaceId || rootPage.spaceId;
    const isDuplicateInSameSpace =
      !targetSpaceId || targetSpaceId === rootPage.spaceId;

    let nextPosition: string;

    if (isDuplicateInSameSpace) {
      // For duplicate in same space, position right after the original page
      nextPosition = generateJitteredKeyBetween(rootPage.position, null);
    } else {
      // For copy to different space, position at the end
      nextPosition = await this.nextPagePosition(spaceId);
    }

    const allPages = await this.pageRepo.getPageAndDescendants(rootPage.id, {
      includeContent: true,
    });

    // Filter to only accessible pages while maintaining tree integrity
    const pages = await this.filterAccessibleTreePages(
      allPages,
      rootPage.id,
      authUser.id,
      rootPage.spaceId,
    );

    await this.pageOperationPolicy.assertOperation({
      operation: 'duplicate',
      page: rootPage,
      targetParentPageId: isDuplicateInSameSpace ? rootPage.parentPageId : null,
      targetSpaceId: spaceId,
      affectedPageIds: allPages.map((page) => page.id),
      actorId: authUser.id,
    });

    const pageMap = new Map<string, CopyPageMapEntry>();
    pages.forEach((page) => {
      pageMap.set(page.id, {
        newPageId: uuid7(),
        newSlugId: generateSlugId(),
        oldSlugId: page.slugId,
      });
    });

    const slugIdMap = new Map<string, CopyPageMapEntry>();
    for (const [, entry] of pageMap) {
      slugIdMap.set(entry.oldSlugId, entry);
    }

    const attachmentMap = new Map<string, ICopyPageAttachment>();

    const insertablePages: InsertablePage[] = await Promise.all(
      pages.map(async (page) => {
        const pageContent = getProsemirrorContent(page.content);
        const pageFromMap = pageMap.get(page.id);

        const doc = jsonToNode(pageContent);
        const prosemirrorDoc = removeMarkTypeFromDoc(doc, 'comment');

        const attachmentIds = getAttachmentIds(prosemirrorDoc.toJSON());

        if (attachmentIds.length > 0) {
          attachmentIds.forEach((attachmentId: string) => {
            const newPageId = pageFromMap.newPageId;
            const newAttachmentId = uuid7();
            attachmentMap.set(attachmentId, {
              newPageId: newPageId,
              oldPageId: page.id,
              oldAttachmentId: attachmentId,
              newAttachmentId: newAttachmentId,
            });

            prosemirrorDoc.descendants((node: PMNode) => {
              if (isAttachmentNode(node.type.name)) {
                if (node.attrs.attachmentId === attachmentId) {
                  //@ts-ignore
                  node.attrs.attachmentId = newAttachmentId;

                  if (node.attrs.src) {
                    //@ts-ignore
                    node.attrs.src = node.attrs.src.replace(
                      attachmentId,
                      newAttachmentId,
                    );
                  }
                  if (node.attrs.src) {
                    //@ts-ignore
                    node.attrs.src = node.attrs.src.replace(
                      attachmentId,
                      newAttachmentId,
                    );
                  }
                }
              }
            });
          });
        }

        // Update internal page links in mention nodes
        prosemirrorDoc.descendants((node: PMNode) => {
          if (
            node.type.name === 'mention' &&
            node.attrs.entityType === 'page'
          ) {
            const referencedPageId = node.attrs.entityId;

            // Check if the referenced page is within the pages being copied
            if (referencedPageId && pageMap.has(referencedPageId)) {
              const mappedPage = pageMap.get(referencedPageId);
              //@ts-ignore
              node.attrs.entityId = mappedPage.newPageId;
              //@ts-ignore
              node.attrs.slugId = mappedPage.newSlugId;
            }
          }

          // Update internal page links in link marks
          for (const mark of node.marks) {
            if (
              mark.type.name === 'link' &&
              mark.attrs.internal &&
              mark.attrs.href
            ) {
              const match = mark.attrs.href.match(INTERNAL_LINK_REGEX);
              if (match) {
                const slugId = extractPageSlugId(match[5]);
                if (slugId && slugIdMap.has(slugId)) {
                  const mappedPage = slugIdMap.get(slugId);
                  //@ts-ignore
                  mark.attrs.href = mark.attrs.href.replace(
                    slugId,
                    mappedPage.newSlugId,
                  );
                }
              }
            }
          }
        });

        const prosemirrorJson = prosemirrorDoc.toJSON();

        // Add "Copy of " prefix to the root page title only for duplicates in same space
        let title = page.title;
        if (isDuplicateInSameSpace && page.id === rootPage.id) {
          const originalTitle = getPageTitle(page.title);
          title = `Copy of ${originalTitle}`;
        }

        return {
          id: pageFromMap.newPageId,
          slugId: pageFromMap.newSlugId,
          title: title,
          icon: page.icon,
          content: prosemirrorJson,
          textContent: jsonToText(prosemirrorJson),
          ydoc: createYdocFromJson(prosemirrorJson),
          position: page.id === rootPage.id ? nextPosition : page.position,
          spaceId: spaceId,
          workspaceId: page.workspaceId,
          creatorId: authUser.id,
          lastUpdatedById: authUser.id,
          parentPageId:
            page.id === rootPage.id
              ? isDuplicateInSameSpace
                ? rootPage.parentPageId
                : null
              : page.parentPageId
                ? pageMap.get(page.parentPageId)?.newPageId
                : null,
        };
      }),
    );

    await this.db.insertInto('pages').values(insertablePages).execute();

    const insertedPageIds = insertablePages.map((page) => page.id);
    this.eventEmitter.emit(EventName.PAGE_CREATED, {
      pageIds: insertedPageIds,
      workspaceId: authUser.workspaceId,
    });

    //TODO: best to handle this in a queue
    const attachmentsIds = Array.from(attachmentMap.keys());
    if (attachmentsIds.length > 0) {
      const attachments = await this.db
        .selectFrom('attachments')
        .selectAll()
        .where('id', 'in', attachmentsIds)
        .where('workspaceId', '=', rootPage.workspaceId)
        .execute();

      for (const attachment of attachments) {
        try {
          const pageAttachment = attachmentMap.get(attachment.id);

          // make sure the copied attachment belongs to the page it was copied from
          if (attachment.pageId !== pageAttachment.oldPageId) {
            continue;
          }

          const newAttachmentId = pageAttachment.newAttachmentId;

          const newPageId = pageAttachment.newPageId;

          // Rebuild the path from components instead of string-replacing the
          // attachment id, because non-ASCII filenames are stored raw and a
          // naive replace can break when ids are substrings or collide.
          const newPathFile = `${getAttachmentFolderPath(
            AttachmentType.File,
            attachment.workspaceId,
          )}/${newAttachmentId}/${attachment.fileName}`;

          try {
            await this.storageService.copy(attachment.filePath, newPathFile);

            await this.db
              .insertInto('attachments')
              .values({
                id: newAttachmentId,
                type: attachment.type,
                filePath: newPathFile,
                fileName: attachment.fileName,
                fileSize: attachment.fileSize,
                mimeType: attachment.mimeType,
                fileExt: attachment.fileExt,
                creatorId: attachment.creatorId,
                workspaceId: attachment.workspaceId,
                pageId: newPageId,
                spaceId: spaceId,
              })
              .execute();
          } catch (err) {
            this.logger.error(
              `Duplicate page: failed to copy attachment ${attachment.id}`,
              err,
            );
            // Continue with other attachments even if one fails
          }
        } catch (err) {
          this.logger.error(err);
        }
      }
    }

    const newPageId = pageMap.get(rootPage.id).newPageId;
    const duplicatedPage = await this.pageRepo.findById(newPageId, {
      includeSpace: true,
    });

    const hasChildren = pages.length > 1;
    const childPageIds = insertedPageIds.filter((id) => id !== newPageId);

    return {
      ...duplicatedPage,
      hasChildren,
      childPageIds,
    };
  }

  async movePage(dto: MovePageDto, movedPage: Page, actorId: string) {
    const previousAudience =
      await this.wsTreeService.capturePageAudience(movedPage);

    // validate position value by attempting to generate a key
    try {
      generateJitteredKeyBetween(dto.position, null);
    } catch (err) {
      throw new BadRequestException('Invalid move position');
    }

    await this.db.transaction().execute(async (trx) => {
      await this.lockSpaceTreeForMove(movedPage.spaceId, trx);

      const currentMovedPage = await this.pageRepo.findById(dto.pageId, {
        withLock: true,
        trx,
      });
      if (!currentMovedPage || currentMovedPage.deletedAt) {
        throw new NotFoundException('Moved page not found');
      }

      let parentPageId = null;
      if (currentMovedPage.parentPageId === dto.parentPageId) {
        parentPageId = undefined;
      } else {
        // changing the page's parent
        if (dto.parentPageId) {
          const parentPage = await this.pageRepo.findById(dto.parentPageId, {
            withLock: true,
            trx,
          });
          if (
            !parentPage ||
            parentPage.deletedAt ||
            parentPage.spaceId !== currentMovedPage.spaceId ||
            parentPage.workspaceId !== currentMovedPage.workspaceId
          ) {
            throw new NotFoundException('Parent page not found');
          }

          const wouldCreateCycle = await this.isPageInSubtree(
            currentMovedPage.id,
            parentPage.id,
            trx,
          );
          if (wouldCreateCycle) {
            throw new BadRequestException(
              'Cannot move a page under itself or its descendants',
            );
          }

          parentPageId = parentPage.id;
        }
      }

      const targetParentPageId =
        parentPageId === undefined
          ? currentMovedPage.parentPageId
          : parentPageId;
      await this.pageOperationPolicy.assertOperation({
        operation: 'move',
        page: currentMovedPage,
        targetParentPageId,
        targetSpaceId: currentMovedPage.spaceId,
        affectedPageIds: [currentMovedPage.id],
        actorId,
        trx,
      });

      await this.pageRepo.updatePage(
        {
          position: dto.position,
          parentPageId: parentPageId,
        },
        dto.pageId,
        trx,
      );
    });

    const relocatedPage = await this.pageRepo.findById(movedPage.id, {
      includeHasChildren: true,
    });
    if (relocatedPage) {
      await this.wsTreeService.notifyPageRelocated(
        movedPage,
        relocatedPage,
        Boolean(
          (relocatedPage as Page & { hasChildren?: boolean }).hasChildren,
        ),
        previousAudience,
      );
    }
  }

  private async lockSpaceTreeForMove(spaceId: string, trx: KyselyTransaction) {
    await sql`select pg_advisory_xact_lock(hashtext(${spaceId})::bigint)`.execute(
      trx,
    );
  }

  private async isPageInSubtree(
    rootPageId: string,
    pageId: string,
    trx: KyselyTransaction,
  ): Promise<boolean> {
    const page = await trx
      .withRecursive('page_descendants', (db) =>
        db
          .selectFrom('pages')
          .select(['id'])
          .where('id', '=', rootPageId)
          .where('deletedAt', 'is', null)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select(['p.id'])
              .innerJoin('page_descendants as pd', 'pd.id', 'p.parentPageId')
              .where('p.deletedAt', 'is', null),
          ),
      )
      .selectFrom('page_descendants')
      .select('id')
      .where('id', '=', pageId)
      .executeTakeFirst();

    return !!page;
  }

  async getPageBreadCrumbs(childPageId: string) {
    const ancestors = await this.db
      .withRecursive('page_ancestors', (db) =>
        db
          .selectFrom('pages')
          .select([
            'id',
            'slugId',
            'title',
            'icon',
            'position',
            'parentPageId',
            'spaceId',
            'deletedAt',
          ])
          .where('id', '=', childPageId)
          .where('deletedAt', 'is', null)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .select([
                'p.id',
                'p.slugId',
                'p.title',
                'p.icon',
                'p.position',
                'p.parentPageId',
                'p.spaceId',
                'p.deletedAt',
              ])
              .innerJoin('page_ancestors as pa', 'pa.parentPageId', 'p.id')
              .where('p.deletedAt', 'is', null),
          ),
      )
      .selectFrom('page_ancestors')
      .selectAll('page_ancestors')
      .select((eb) =>
        eb
          .exists(
            eb
              .selectFrom('pages as child')
              .select(sql`1`.as('one'))
              .whereRef('child.parentPageId', '=', 'page_ancestors.id')
              .where('child.deletedAt', 'is', null),
          )
          .as('hasChildren'),
      )
      .execute();

    return ancestors.reverse();
  }

  async getRecentSpacePages(
    spaceId: string,
    userId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Page>> {
    const result = await this.pageRepo.getRecentPagesInSpace(
      spaceId,
      pagination,
    );

    if (result.items.length > 0) {
      const pageIds = result.items.map((p) => p.id);
      const accessibleIds =
        await this.pagePermissionRepo.filterAccessiblePageIds({
          pageIds,
          userId,
          spaceId,
        });
      const accessibleSet = new Set(accessibleIds);
      result.items = result.items.filter((p) => accessibleSet.has(p.id));
    }

    return result;
  }

  async getRecentPages(
    userId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Page>> {
    const result = await this.pageRepo.getRecentPages(userId, pagination);

    if (result.items.length > 0) {
      const pageIds = result.items.map((p) => p.id);
      const accessibleIds =
        await this.pagePermissionRepo.filterAccessiblePageIds({
          pageIds,
          userId,
        });
      const accessibleSet = new Set(accessibleIds);
      result.items = result.items.filter((p) => accessibleSet.has(p.id));
    }

    return result;
  }

  async getCreatedByPages(
    creatorId: string,
    requestingUserId: string,
    pagination: PaginationOptions,
    spaceId?: string,
  ): Promise<CursorPaginationResult<Page>> {
    const result = await this.pageRepo.getCreatedByPages(
      creatorId,
      requestingUserId,
      pagination,
      spaceId,
    );

    if (result.items.length > 0) {
      const pageIds = result.items.map((p) => p.id);
      const accessibleIds =
        await this.pagePermissionRepo.filterAccessiblePageIds({
          pageIds,
          userId: requestingUserId,
        });
      const accessibleSet = new Set(accessibleIds);
      result.items = result.items.filter((p) => accessibleSet.has(p.id));
    }

    return result;
  }

  async getDeletedSpacePages(
    spaceId: string,
    userId: string,
    pagination: PaginationOptions,
    canPermanentlyDelete: boolean,
  ): Promise<CursorPaginationResult<DeletedPageListItem>> {
    const result = await this.pageRepo.getDeletedPagesInSpace(
      spaceId,
      pagination,
    );

    if (result.items.length === 0) {
      return { ...result, items: [] };
    }

    const pagePermissions =
      await this.pagePermissionRepo.filterAccessiblePageIdsWithPermissions(
        result.items.map((page) => page.id),
        userId,
      );
    const permissionByPageId = new Map(
      pagePermissions.map((permission) => [permission.id, permission.canEdit]),
    );

    const items = result.items.flatMap((page) => {
      const canRestore = permissionByPageId.get(page.id);
      if (canRestore === undefined) return [];

      return [
        {
          ...page,
          trashCapabilities: { canRestore, canPermanentlyDelete },
        },
      ];
    });

    return { ...result, items };
  }

  async forceDelete(pageId: string, workspaceId: string): Promise<string[]> {
    let pageIds: string[] = [];

    await executeTx(this.db, async (trx) => {
      const rootPage = await trx
        .selectFrom('pages')
        .select('id')
        .where('id', '=', pageId)
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is not', null)
        .forUpdate()
        .executeTakeFirst();

      if (!rootPage) return;

      const descendants = await trx
        .withRecursive('page_descendants', (db) =>
          db
            .selectFrom('pages')
            .select(['id'])
            .where('id', '=', rootPage.id)
            .where('workspaceId', '=', workspaceId)
            .unionAll((exp) =>
              exp
                .selectFrom('pages as p')
                .select(['p.id'])
                .innerJoin('page_descendants as pd', 'pd.id', 'p.parentPageId')
                .where('p.workspaceId', '=', workspaceId),
            ),
        )
        .selectFrom('page_descendants')
        .selectAll()
        .execute();

      pageIds = descendants.map((descendant) => descendant.id);

      for (const id of pageIds) {
        await this.attachmentQueue.add(
          QueueJob.DELETE_PAGE_ATTACHMENTS,
          { pageId: id },
          {
            jobId: `delete-page-attachments-${id}`,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
          },
        );
      }

      if (pageIds.length > 0) {
        await trx
          .deleteFrom('pages')
          .where('id', 'in', pageIds)
          .where('workspaceId', '=', workspaceId)
          .execute();
      }
    });

    if (pageIds.length > 0) {
      this.eventEmitter.emit(EventName.PAGE_DELETED, {
        pageIds,
        workspaceId,
      });
    }

    return pageIds;
  }

  async removePage(
    pageId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.pageRepo.removePage(pageId, userId, workspaceId);
  }

  private async parseProsemirrorContent(
    content: string | object,
    format: ContentFormat,
  ): Promise<any> {
    let prosemirrorJson: any;

    switch (format) {
      case 'markdown': {
        const html = await markdownToHtml(content as string);
        prosemirrorJson = htmlToJson(html as string);
        break;
      }
      case 'html': {
        prosemirrorJson = htmlToJson(content as string);
        break;
      }
      case 'json':
      default: {
        if (typeof content === 'string') {
          try {
            prosemirrorJson = JSON.parse(content);
          } catch {
            throw new BadRequestException('Invalid content format');
          }
        } else {
          prosemirrorJson = content;
        }
        break;
      }
    }

    try {
      jsonToNode(prosemirrorJson);
    } catch (err) {
      throw new BadRequestException('Invalid content format');
    }

    return prosemirrorJson;
  }

  /**
   * Filters a list of pages to only those accessible to the user while maintaining tree integrity.
   * A page is included only if:
   * 1. The user has access to it
   * 2. Its parent is also included (or it's the root page)
   * This ensures that if a middle page is inaccessible, its entire subtree is excluded.
   */
  private async filterAccessibleTreePages<
    T extends { id: string; parentPageId: string | null },
  >(
    pages: T[],
    rootPageId: string,
    userId: string,
    spaceId?: string,
  ): Promise<T[]> {
    if (pages.length === 0) return [];

    const pageIds = pages.map((p) => p.id);
    const accessibleIds = await this.pagePermissionRepo.filterAccessiblePageIds(
      {
        pageIds,
        userId,
        spaceId,
      },
    );
    const accessibleSet = new Set(accessibleIds);

    // Prune: include a page only if it's accessible AND its parent chain to root is included
    const includedIds = new Set<string>();

    // Process pages in a way that ensures parents are processed before children
    // We do this by iterating until no more pages can be added
    let changed = true;
    while (changed) {
      changed = false;
      for (const page of pages) {
        if (includedIds.has(page.id)) continue;
        if (!accessibleSet.has(page.id)) continue;

        // Root page: include if accessible
        if (page.id === rootPageId) {
          includedIds.add(page.id);
          changed = true;
          continue;
        }

        // Non-root: include if parent is already included
        if (page.parentPageId && includedIds.has(page.parentPageId)) {
          includedIds.add(page.id);
          changed = true;
        }
      }
    }

    return pages.filter((p) => includedIds.has(p.id));
  }
}
