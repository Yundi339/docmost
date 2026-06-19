import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { v7 as uuid7 } from 'uuid';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Json } from '@docmost/db/types/db';
import {
  DatabaseBlock,
  DatabaseRecord,
  Page,
  User,
} from '@docmost/db/types/entity.types';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { createYdocFromJson } from '../../common/helpers/prosemirror/utils';
import { generateSlugId } from '../../common/helpers';
import { jsonToText } from '../../collaboration/collaboration.util';
import { PageAccessService } from '../page/page-access/page-access.service';
import { PageService } from '../page/services/page.service';
import { DatabaseRepo } from './database.repo';
import { ApitableClient } from './apitable.client';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import {
  buildDefaultFieldsForTemplate,
  createEmptyRecordFields,
  DatabaseFieldDefinition,
  DatabaseFieldType,
  DatabaseViewDefinition,
  getDefaultViewsForTemplate,
  normalizeApitableRecord,
  normalizeTemplate,
} from './database.templates';
import {
  AttachDatabasePageDto,
  CreateDatabaseDto,
  CreateDatabaseFieldDto,
  CreateDatabaseRecordDto,
  CreateDatabaseViewDto,
  DetachDatabaseRecordDto,
  ListDatabaseTargetsDto,
  ReorderDatabaseRecordDto,
  TrashDatabaseRecordPageDto,
  UpdateDatabaseFieldDto,
  UpdateDatabaseRecordDto,
  UpdateDatabaseTitleDto,
} from './dto/database.dto';

interface DatabaseMetadata {
  provider?: string;
  records?: Record<string, unknown>[];
  apitable?: Record<string, unknown>;
}

@Injectable()
export class DatabaseService {
  constructor(
    private readonly databaseRepo: DatabaseRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly pageService: PageService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly apitableClient: ApitableClient,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async createDatabase(dto: CreateDatabaseDto, user: User) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.databaseRepo.findByPageAndBlock(
      page.id,
      dto.blockId,
    );
    if (existing) return this.toResponse(existing);

    const template = normalizeTemplate(dto.template);
    const fields = buildDefaultFieldsForTemplate(template);
    const views = getDefaultViewsForTemplate(template);
    const activeView =
      views.find((view) => view.type === dto.viewType) || views[0];
    const title = dto.title?.trim() || this.defaultTitle(template);
    const apitable = await this.apitableClient.createDatasheet({
      title,
      fields,
    });

    const metadata: DatabaseMetadata = {
      provider: apitable.provider,
    };

    const database = await this.databaseRepo.insertDatabaseBlock({
      blockId: dto.blockId,
      pageId: page.id,
      spaceId: page.spaceId,
      workspaceId: page.workspaceId,
      createdById: user.id,
      updatedById: user.id,
      title,
      template,
      activeViewId: activeView.id,
      apitableDatasheetId: apitable.datasheetId,
      apitableViewId: activeView.id,
      fields: fields as unknown as Json,
      views: views as unknown as Json,
      metadata: metadata as unknown as Json,
    });

    if (this.isNativeDatabase(database)) {
      const seedRecords = this.seedRecordFields(template);
      const seedPages = await Promise.all(
        seedRecords.map((recordFields) =>
          this.createRecordPage(database, recordFields, user),
        ),
      );
      let previousSortOrder: string | null = null;

      await this.databaseRepo.insertDatabaseRecords(
        seedRecords.map((recordFields, index) => {
          previousSortOrder = generateJitteredKeyBetween(
            previousSortOrder,
            null,
          );

          return {
            databaseId: database.id,
            pageId: seedPages[index].id,
            spaceId: database.spaceId,
            workspaceId: database.workspaceId,
            createdById: user.id,
            updatedById: user.id,
            fields: recordFields as unknown as Json,
            sortOrder: previousSortOrder,
          };
        }),
      );
    }

    return this.toResponse(database);
  }

  async getDatabase(databaseId: string, user: User) {
    const database = await this.getAuthorizedDatabase(databaseId, user, 'view');
    return this.toResponse(database);
  }

  async listTargets(dto: ListDatabaseTargetsDto, user: User) {
    if (!user.workspaceId) return { items: [] };

    const databases = await this.databaseRepo.listByWorkspace(
      user.workspaceId,
    );
    const items = [];

    for (const database of databases) {
      if (database.id === dto.excludeDatabaseId) continue;
      if (!this.isNativeDatabase(database)) continue;

      const views = this.getViews(database.views);
      if (!views.some((view) => view.type === 'kanban')) continue;

      const page = await this.pageRepo.findById(database.pageId);
      if (!page || page.deletedAt) continue;

      try {
        await this.pageAccessService.validateCanEdit(page, user);
      } catch {
        continue;
      }

      items.push({
        ...this.toResponse(database),
        pageTitle: page.title,
        pageIcon: page.icon,
      });
    }

    return { items };
  }

  async createView(dto: CreateDatabaseViewDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const views = this.getViews(database.views);
    const view: DatabaseViewDefinition = {
      id: uuid7(),
      name: dto.name.trim(),
      type: dto.type as DatabaseViewDefinition['type'],
      groupBy: dto.groupBy,
    };

    const updated = await this.databaseRepo.updateViews(
      database.id,
      [...views, view] as unknown as Json,
      view.id,
      user.id,
    );

    return this.toResponse(updated);
  }

  async updateTitle(dto: UpdateDatabaseTitleDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const title = dto.title.trim();
    const updated = await this.databaseRepo.updateTitle(
      database.id,
      title,
      user.id,
    );

    return this.toResponse(updated);
  }

  async createField(dto: CreateDatabaseFieldDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const fields = this.getFields(database.fields);
    const name = this.makeUniqueFieldName(
      dto.name?.trim() || this.defaultFieldName(dto.type),
      fields,
    );
    const type = this.normalizeFieldType(dto.type);
    const field: DatabaseFieldDefinition = {
      name,
      type,
      options: dto.options?.length
        ? dto.options
        : this.defaultOptionsForField(type),
    };

    if (!field.options?.length) delete field.options;

    const nextFields = this.insertField(
      fields,
      field,
      dto.position,
      dto.anchorFieldName,
    );

    const updated = await this.databaseRepo.updateFields(
      database.id,
      nextFields as unknown as Json,
      user.id,
    );

    if (this.isNativeDatabase(database)) {
      await this.backfillNativeField(database.id, field, user.id);
    }

    return this.toResponse(updated);
  }

  async updateField(dto: UpdateDatabaseFieldDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const fields = this.getFields(database.fields);
    const fieldIndex = fields.findIndex(
      (field) => field.name === dto.fieldName,
    );
    if (fieldIndex === -1) throw new NotFoundException('Field not found');

    const currentField = fields[fieldIndex];
    const nextType = dto.type
      ? this.normalizeFieldType(dto.type)
      : currentField.type;
    const nextName = dto.name?.trim()
      ? this.makeUniqueFieldName(dto.name.trim(), fields, currentField.name)
      : currentField.name;
    const nextField: DatabaseFieldDefinition = {
      ...currentField,
      name: nextName,
      type: nextType,
      options:
        dto.options ??
        currentField.options ??
        this.defaultOptionsForField(nextType),
    };

    if (!nextField.options?.length) delete nextField.options;

    const nextFields = fields.map((field, index) =>
      index === fieldIndex ? nextField : field,
    );
    const updated = await this.databaseRepo.updateFields(
      database.id,
      nextFields as unknown as Json,
      user.id,
    );

    if (this.isNativeDatabase(database) && nextName !== currentField.name) {
      await this.renameNativeRecordField(
        database.id,
        currentField.name,
        nextName,
        user.id,
      );
    }

    return this.toResponse(updated);
  }

  async listRecords(databaseId: string, user: User) {
    const database = await this.getAuthorizedDatabase(databaseId, user, 'view');
    const datasheetId = database.apitableDatasheetId;

    if (datasheetId && !this.isNativeDatabase(database)) {
      return { items: await this.apitableClient.listRecords(datasheetId) };
    }

    const nativeRecords = await this.databaseRepo.listDatabaseRecords(
      database.id,
    );
    if (nativeRecords.length > 0) {
      const items = await Promise.all(
        nativeRecords.map((record) =>
          this.normalizeNativeRecordForList(database, record, user),
        ),
      );

      return {
        items: items.filter(Boolean),
      };
    }

    return {
      items: this.getLegacyMetadataRecords(database).map((record) =>
        normalizeApitableRecord(record),
      ),
    };
  }

  async createRecord(dto: CreateDatabaseRecordDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const datasheetId = database.apitableDatasheetId;

    if (datasheetId && !this.isNativeDatabase(database)) {
      return this.apitableClient.createRecord(datasheetId, dto.fields);
    }

    const fields = {
      ...createEmptyRecordFields(),
      ...dto.fields,
    };
    const recordPage = await this.createRecordPage(database, fields, user);
    const lastSortOrder =
      await this.databaseRepo.getLastDatabaseRecordSortOrder(database.id);

    const record = await this.databaseRepo.insertDatabaseRecord({
      databaseId: database.id,
      pageId: recordPage.id,
      spaceId: database.spaceId,
      workspaceId: database.workspaceId,
      createdById: user.id,
      updatedById: user.id,
      fields: fields as unknown as Json,
      sortOrder: generateJitteredKeyBetween(lastSortOrder, null),
    });

    return this.normalizeNativeRecordWithPage(database, record, user);
  }

  async updateRecord(dto: UpdateDatabaseRecordDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const datasheetId = database.apitableDatasheetId;

    if (datasheetId && !this.isNativeDatabase(database)) {
      return this.apitableClient.updateRecord(
        datasheetId,
        dto.recordId,
        dto.fields,
      );
    }

    const record = await this.databaseRepo.findDatabaseRecord(
      database.id,
      dto.recordId,
    );

    if (!record) {
      return this.updateLegacyMetadataRecord(
        database,
        dto.recordId,
        dto.fields,
        user.id,
      );
    }

    const nextFields = {
      ...((record.fields as Record<string, unknown>) ?? {}),
      ...dto.fields,
    };
    const updatedRecord = await this.databaseRepo.updateDatabaseRecordFields(
      database.id,
      dto.recordId,
      nextFields as unknown as Json,
      user.id,
    );

    await this.syncRecordPage(updatedRecord, nextFields, user);

    return this.normalizeNativeRecordWithPage(database, updatedRecord, user);
  }

  async reorderRecord(dto: ReorderDatabaseRecordDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const record = await this.databaseRepo.findDatabaseRecord(
      database.id,
      dto.recordId,
    );

    if (!record) throw new NotFoundException('Record not found');

    const beforeRecord = dto.beforeRecordId
      ? await this.databaseRepo.findDatabaseRecord(
          database.id,
          dto.beforeRecordId,
        )
      : undefined;
    const afterRecord = dto.afterRecordId
      ? await this.databaseRepo.findDatabaseRecord(
          database.id,
          dto.afterRecordId,
        )
      : undefined;
    const sortOrder = generateJitteredKeyBetween(
      afterRecord?.sortOrder ?? null,
      beforeRecord?.sortOrder ?? null,
    );
    const updatedRecord = await this.databaseRepo.updateDatabaseRecordSort(
      database.id,
      record.id,
      sortOrder,
      user.id,
    );

    return this.normalizeNativeRecordWithPage(database, updatedRecord, user);
  }

  async attachPage(dto: AttachDatabasePageDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const page = await this.pageRepo.findById(dto.pageId, {
      includeTextContent: true,
    });
    if (!page || page.deletedAt) throw new NotFoundException('Page not found');
    await this.pageAccessService.validateCanEdit(page, user);

    let attachedRecord: DatabaseRecord | undefined;
    await executeTx(this.db, async (trx) => {
      const existingRecord = await this.databaseRepo.findDatabaseRecordByPage(
        database.id,
        page.id,
        trx,
      );
      if (existingRecord) {
        attachedRecord = existingRecord;
        if (dto.sourceDatabaseId && dto.sourceRecordId) {
          await this.detachSourceRecordIfDifferent(
            dto.sourceDatabaseId,
            dto.sourceRecordId,
            database.id,
            existingRecord.id,
            user,
            trx,
          );
        }
        return;
      }

      const fields = this.buildFieldsForAttachedPage(
        database,
        page,
        dto.fields,
      );
      const lastSortOrder =
        await this.databaseRepo.getLastDatabaseRecordSortOrder(
          database.id,
          trx,
        );
      attachedRecord = await this.databaseRepo.insertDatabaseRecord(
        {
          databaseId: database.id,
          pageId: page.id,
          spaceId: database.spaceId,
          workspaceId: database.workspaceId,
          createdById: user.id,
          updatedById: user.id,
          fields: fields as unknown as Json,
          sortOrder: generateJitteredKeyBetween(lastSortOrder, null),
        },
        trx,
      );

      await this.movePageUnder(
        page.id,
        database.pageId,
        database.spaceId,
        database.workspaceId,
        user,
        trx,
      );

      if (dto.sourceDatabaseId && dto.sourceRecordId) {
        await this.detachSourceRecordIfDifferent(
          dto.sourceDatabaseId,
          dto.sourceRecordId,
          database.id,
          attachedRecord.id,
          user,
          trx,
        );
      }
    });

    if (!attachedRecord) {
      throw new BadRequestException('Failed to attach page');
    }

    return this.normalizeNativeRecordWithPage(database, attachedRecord, user);
  }

  async detachRecord(dto: DetachDatabaseRecordDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    if (dto.targetPageId && dto.targetSpaceId) {
      throw new BadRequestException(
        'Provide only one target page or target space',
      );
    }

    const record = await this.databaseRepo.findDatabaseRecord(
      database.id,
      dto.recordId,
    );
    if (!record) throw new NotFoundException('Record not found');

    const recordPage = await this.getActiveRecordPage(record);
    if (!recordPage) {
      await this.databaseRepo.detachDatabaseRecord(
        database.id,
        record.id,
        user.id,
      );
      return {
        pageId: record.pageId,
        pageSlugId: null,
        pageTitle: null,
        pageIcon: null,
        targetPageId: dto.targetPageId ?? null,
        targetSpaceId: dto.targetSpaceId ?? null,
      };
    }

    await this.pageAccessService.validateCanEdit(recordPage, user);
    let targetPage: Page | undefined;
    let targetSpaceId = dto.targetSpaceId ?? null;
    const pageIcon = recordPage.icon === '📄' ? null : recordPage.icon;

    if (dto.targetPageId) {
      if (dto.targetPageId === recordPage.id) {
        throw new BadRequestException(
          'Cannot move a page under itself or its descendants',
        );
      }
      targetPage = await this.pageRepo.findById(dto.targetPageId);
      if (!targetPage || targetPage.deletedAt) {
        throw new NotFoundException('Target page not found');
      }
      await this.pageAccessService.validateCanEdit(targetPage, user);
      targetSpaceId = targetPage.spaceId;
    }

    if (targetSpaceId) {
      const ability = await this.spaceAbility.createForUser(
        user,
        targetSpaceId,
      );
      if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }

    await executeTx(this.db, async (trx) => {
      if (recordPage.icon === '📄') {
        await this.pageRepo.updatePage(
          {
            icon: null,
            lastUpdatedById: user.id,
            workspaceId: recordPage.workspaceId,
          },
          recordPage.id,
          trx,
        );
      }

      await this.moveRecordPageToDestination(
        recordPage,
        targetPage?.id ?? null,
        targetSpaceId,
        user,
        trx,
      );

      await this.databaseRepo.detachDatabaseRecord(
        database.id,
        record.id,
        user.id,
        trx,
      );
    });

    return {
      pageId: recordPage.id,
      pageSlugId: recordPage.slugId,
      pageTitle: recordPage.title,
      pageIcon,
      targetPageId: targetPage?.id ?? null,
      targetSpaceId,
    };
  }

  async trashRecordPage(dto: TrashDatabaseRecordPageDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const record = await this.databaseRepo.findDatabaseRecord(
      database.id,
      dto.recordId,
    );
    if (!record) throw new NotFoundException('Record not found');

    const recordPage = await this.getActiveRecordPage(record);
    if (recordPage) {
      await this.pageAccessService.validateCanEdit(recordPage, user);
    }

    await executeTx(this.db, async (trx) => {
      await this.databaseRepo.detachDatabaseRecord(
        database.id,
        record.id,
        user.id,
        trx,
      );

      if (recordPage) {
        await this.pageRepo.removePage(
          recordPage.id,
          user.id,
          database.workspaceId,
          trx,
        );
      }
    });

    return {
      recordId: record.id,
      pageId: record.pageId,
      trashedPageId: recordPage?.id ?? null,
    };
  }

  async getEmbedUrl(
    databaseId: string,
    viewId: string | undefined,
    user: User,
  ) {
    const database = await this.getAuthorizedDatabase(databaseId, user, 'view');
    return {
      embedUrl: database.apitableDatasheetId
        ? this.apitableClient.buildPublicEmbedUrl(
            database.apitableDatasheetId,
            viewId || database.apitableViewId,
          )
        : null,
    };
  }

  private async getAuthorizedDatabase(
    databaseId: string,
    user: User,
    access: 'view' | 'edit',
  ) {
    const database = await this.databaseRepo.findById(databaseId);
    if (!database) throw new NotFoundException('Database not found');

    const page = await this.pageRepo.findById(database.pageId);
    if (!page || page.deletedAt) throw new NotFoundException('Page not found');

    if (access === 'edit') {
      await this.pageAccessService.validateCanEdit(page, user);
    } else {
      await this.pageAccessService.validateCanView(page, user);
    }

    return database;
  }

  private toResponse(database: Awaited<ReturnType<DatabaseRepo['findById']>>) {
    if (!database) throw new BadRequestException('Database is empty');
    return {
      id: database.id,
      blockId: database.blockId,
      pageId: database.pageId,
      spaceId: database.spaceId,
      workspaceId: database.workspaceId,
      title: database.title,
      template: database.template,
      activeViewId: database.activeViewId,
      apitableDatasheetId: database.apitableDatasheetId,
      apitableViewId: database.apitableViewId,
      fields: database.fields,
      views: database.views,
      metadata: database.metadata,
      createdAt: database.createdAt,
      updatedAt: database.updatedAt,
    };
  }

  private getViews(views: unknown): DatabaseViewDefinition[] {
    return Array.isArray(views) ? (views as DatabaseViewDefinition[]) : [];
  }

  private getFields(fields: unknown): DatabaseFieldDefinition[] {
    return Array.isArray(fields) ? (fields as DatabaseFieldDefinition[]) : [];
  }

  private getLegacyMetadataRecords(database: { metadata: unknown }) {
    const metadata = this.getMetadata(database.metadata);
    return Array.isArray(metadata.records) ? metadata.records : [];
  }

  private async updateLegacyMetadataRecord(
    database: { id: string; metadata: unknown },
    recordId: string,
    fields: Record<string, unknown>,
    userId: string,
  ) {
    const records = this.getLegacyMetadataRecords(database);
    const index = records.findIndex((record) => record.recordId === recordId);
    if (index === -1) throw new NotFoundException('Record not found');

    const nextRecords = [...records];
    nextRecords[index] = {
      ...records[index],
      fields: {
        ...((records[index].fields as Record<string, unknown>) ?? {}),
        ...fields,
      },
    };

    const metadata = {
      ...this.getMetadata(database.metadata),
      records: nextRecords,
    };
    await this.databaseRepo.updateMetadata(
      database.id,
      metadata as unknown as Json,
      userId,
    );

    return normalizeApitableRecord(nextRecords[index]);
  }

  private getMetadata(metadata: unknown): DatabaseMetadata {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as DatabaseMetadata;
    }
    return {};
  }

  private isNativeDatabase(database: {
    metadata: unknown;
    apitableDatasheetId: string | null;
  }) {
    const metadata = this.getMetadata(database.metadata);
    return (
      metadata.provider === 'docmost-native' ||
      metadata.provider === 'docmost-local' ||
      !database.apitableDatasheetId ||
      database.apitableDatasheetId.startsWith('native_') ||
      database.apitableDatasheetId.startsWith('local_')
    );
  }

  private async normalizeNativeRecordWithPage(
    database: DatabaseBlock,
    record: DatabaseRecord,
    user: User,
  ) {
    const recordPage = await this.ensureRecordPage(database, record, user);

    return normalizeApitableRecord({
      id: record.id,
      fields: record.fields as Record<string, unknown>,
      pageId: recordPage.id,
      pageSlugId: recordPage.slugId,
      pageTitle: recordPage.title,
      pageIcon: recordPage.icon === '📄' ? null : recordPage.icon,
      sortOrder: record.sortOrder,
    });
  }

  private async normalizeNativeRecordForList(
    database: DatabaseBlock,
    record: DatabaseRecord,
    user: User,
  ) {
    try {
      return await this.normalizeNativeRecordWithPage(database, record, user);
    } catch (err) {
      if (
        err instanceof NotFoundException &&
        err.message === 'Record page is in trash'
      ) {
        return null;
      }

      throw err;
    }
  }

  private async getActiveRecordPage(record: DatabaseRecord) {
    if (!record.pageId) return null;

    const page = await this.pageRepo.findById(record.pageId);
    if (!page || page.deletedAt) return null;

    return page;
  }

  private async ensureRecordPage(
    database: DatabaseBlock,
    record: DatabaseRecord,
    user: User,
  ): Promise<Page> {
    const fields = (record.fields as Record<string, unknown>) ?? {};

    if (record.pageId && record.pageId !== database.pageId) {
      const page = await this.pageRepo.findById(record.pageId);
      if (page && !page.deletedAt) return page;
      if (page?.deletedAt) {
        throw new NotFoundException('Record page is in trash');
      }
    }

    const recordPage = await this.createRecordPage(database, fields, user);
    await this.databaseRepo.updateDatabaseRecordPageId(
      database.id,
      record.id,
      recordPage.id,
      user.id,
    );

    return recordPage;
  }

  private async moveRecordPageToDestination(
    recordPage: Page,
    targetPageId: string | null,
    targetSpaceId: string | null,
    user: User,
    trx: KyselyTransaction,
  ) {
    if (!targetPageId && !targetSpaceId) return;

    const nextSpaceId = targetSpaceId ?? recordPage.spaceId;
    if (nextSpaceId === recordPage.spaceId) {
      await this.pageService.movePageToParent(recordPage, targetPageId, trx);
      return;
    }

    await this.pageService.movePageToSpace(
      recordPage,
      nextSpaceId,
      user.id,
      targetPageId,
      trx,
    );
  }

  private async createRecordPage(
    database: DatabaseBlock,
    fields: Record<string, unknown>,
    user: User,
  ): Promise<Page> {
    const parentPageId = database.pageId;
    const title = this.recordTitle(fields);
    const description = this.recordDescription(fields);
    const content = description
      ? this.recordDescriptionToDoc(description)
      : undefined;
    const lastPosition = await this.databaseRepo.getLastChildPagePosition(
      database.spaceId,
      parentPageId,
    );

    return this.pageRepo.insertPage({
      slugId: generateSlugId(),
      title,
      icon: null,
      position: generateJitteredKeyBetween(lastPosition, null),
      parentPageId,
      spaceId: database.spaceId,
      workspaceId: database.workspaceId,
      creatorId: user.id,
      lastUpdatedById: user.id,
      content: content as unknown as Json,
      textContent: content ? jsonToText(content) : undefined,
      ydoc: content ? createYdocFromJson(content) : undefined,
    });
  }

  private async movePageUnder(
    pageId: string,
    parentPageId: string,
    spaceId: string,
    workspaceId: string,
    user: User,
    trx?: KyselyTransaction,
  ) {
    const lastPosition = await this.databaseRepo.getLastChildPagePosition(
      spaceId,
      parentPageId,
      trx,
    );

    await this.pageRepo.updatePage(
      {
        parentPageId,
        position: generateJitteredKeyBetween(lastPosition, null),
        lastUpdatedById: user.id,
        workspaceId,
      },
      pageId,
      trx,
    );
  }

  private buildFieldsForAttachedPage(
    database: DatabaseBlock,
    page: Page,
    incomingFields?: Record<string, unknown>,
  ) {
    const fields = this.getFields(database.fields);
    const nextFields = fields.reduce<Record<string, unknown>>(
      (result, field) => {
        result[field.name] = this.defaultValueForField(field);
        return result;
      },
      {},
    );

    return {
      ...nextFields,
      ...incomingFields,
      Title: incomingFields?.Title ?? page.title ?? 'Untitled',
      Description: incomingFields?.Description ?? page.textContent ?? '',
    };
  }

  private async detachSourceRecordIfDifferent(
    sourceDatabaseId: string,
    sourceRecordId: string,
    targetDatabaseId: string,
    targetRecordId: string,
    user: User,
    trx?: KyselyTransaction,
  ) {
    if (
      sourceDatabaseId === targetDatabaseId &&
      sourceRecordId === targetRecordId
    ) {
      return;
    }

    const sourceDatabase = await this.getAuthorizedDatabase(
      sourceDatabaseId,
      user,
      'edit',
    );
    const sourceRecord = await this.databaseRepo.findDatabaseRecord(
      sourceDatabase.id,
      sourceRecordId,
      trx,
    );

    if (!sourceRecord) return;
    await this.databaseRepo.detachDatabaseRecord(
      sourceDatabase.id,
      sourceRecord.id,
      user.id,
      trx,
    );
  }

  private async syncRecordPage(
    record: DatabaseRecord,
    fields: Record<string, unknown>,
    user: User,
  ) {
    if (!record.pageId) return;

    const page = await this.pageRepo.findById(record.pageId);
    if (!page || page.deletedAt) return;

    await this.pageRepo.updatePage(
      {
        title: this.recordTitle(fields),
        lastUpdatedById: user.id,
        workspaceId: record.workspaceId,
      },
      record.pageId,
    );
  }

  private recordTitle(fields: Record<string, unknown>) {
    const title = fields.Title || fields.Name;
    if (typeof title === 'string' && title.trim()) return title.trim();
    return 'Untitled';
  }

  private recordDescription(fields: Record<string, unknown>) {
    const description = fields.Description;
    if (typeof description === 'string') return description;
    return '';
  }

  private recordDescriptionToDoc(description: string) {
    return {
      type: 'doc',
      content: description
        ? [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: description }],
            },
          ]
        : [{ type: 'paragraph' }],
    };
  }

  private normalizeFieldType(type?: string): DatabaseFieldType {
    if (type === 'person') return 'user';
    if (type === 'select') return 'singleSelect';

    const supportedTypes: DatabaseFieldType[] = [
      'text',
      'longText',
      'number',
      'singleSelect',
      'multiSelect',
      'status',
      'date',
      'user',
      'attachment',
      'checkbox',
      'url',
      'email',
      'phone',
      'relation',
      'rollup',
      'formula',
      'button',
      'id',
      'place',
    ];

    return supportedTypes.includes(type as DatabaseFieldType)
      ? (type as DatabaseFieldType)
      : 'text';
  }

  private defaultFieldName(type?: string) {
    const normalizedType = this.normalizeFieldType(type);
    const labels: Record<string, string> = {
      text: 'Text',
      longText: 'Text',
      number: 'Number',
      singleSelect: 'Select',
      multiSelect: 'Multi-select',
      status: 'Status',
      date: 'Date',
      user: 'Person',
      attachment: 'Files & media',
      checkbox: 'Checkbox',
      url: 'URL',
      email: 'Email',
      phone: 'Phone',
      relation: 'Relation',
      rollup: 'Rollup',
      formula: 'Formula',
      button: 'Button',
      id: 'ID',
      place: 'Place',
    };

    return labels[normalizedType] ?? 'Property';
  }

  private defaultOptionsForField(type: DatabaseFieldType) {
    if (type === 'status') return ['Not started', 'In progress', 'Done'];
    if (type === 'singleSelect') return [];
    if (type === 'multiSelect') return [];
    return undefined;
  }

  private makeUniqueFieldName(
    rawName: string,
    fields: DatabaseFieldDefinition[],
    currentName?: string,
  ) {
    const baseName = rawName.trim() || 'Property';
    const existingNames = new Set(
      fields.map((field) => field.name).filter((name) => name !== currentName),
    );

    if (!existingNames.has(baseName)) return baseName;

    let suffix = 2;
    while (existingNames.has(`${baseName} ${suffix}`)) suffix += 1;
    return `${baseName} ${suffix}`;
  }

  private insertField(
    fields: DatabaseFieldDefinition[],
    field: DatabaseFieldDefinition,
    position?: string,
    anchorFieldName?: string,
  ) {
    if (!anchorFieldName || !position || position === 'end') {
      return [...fields, field];
    }

    const anchorIndex = fields.findIndex(
      (item) => item.name === anchorFieldName,
    );
    if (anchorIndex === -1) return [...fields, field];

    const insertionIndex = position === 'left' ? anchorIndex : anchorIndex + 1;
    const nextFields = [...fields];
    nextFields.splice(insertionIndex, 0, field);
    return nextFields;
  }

  private defaultValueForField(field: DatabaseFieldDefinition) {
    if (field.type === 'multiSelect' || field.type === 'attachment') return [];
    if (field.type === 'user') return [];
    if (field.type === 'checkbox') return false;
    if (field.type === 'status') return field.options?.[0] || 'Not started';
    if (field.type === 'singleSelect') return null;
    if (field.type === 'number') return null;
    if (field.type === 'date') return null;
    return '';
  }

  private async backfillNativeField(
    databaseId: string,
    field: DatabaseFieldDefinition,
    userId: string,
  ) {
    const records = await this.databaseRepo.listDatabaseRecords(databaseId);
    await Promise.all(
      records.map((record) => {
        const fields = (record.fields as Record<string, unknown>) ?? {};
        if (Object.prototype.hasOwnProperty.call(fields, field.name)) {
          return Promise.resolve();
        }

        return this.databaseRepo.updateDatabaseRecordFields(
          databaseId,
          record.id,
          {
            ...fields,
            [field.name]: this.defaultValueForField(field),
          } as unknown as Json,
          userId,
        );
      }),
    );
  }

  private async renameNativeRecordField(
    databaseId: string,
    oldName: string,
    newName: string,
    userId: string,
  ) {
    const records = await this.databaseRepo.listDatabaseRecords(databaseId);
    await Promise.all(
      records.map((record) => {
        const fields = (record.fields as Record<string, unknown>) ?? {};
        if (!Object.prototype.hasOwnProperty.call(fields, oldName)) {
          return Promise.resolve();
        }

        const nextFields = { ...fields, [newName]: fields[oldName] };
        delete nextFields[oldName];

        return this.databaseRepo.updateDatabaseRecordFields(
          databaseId,
          record.id,
          nextFields as unknown as Json,
          userId,
        );
      }),
    );
  }

  private defaultTitle(template: string) {
    if (template === 'tasks') return 'Tasks';
    return 'New database';
  }

  private seedRecordFields(template: string): Record<string, unknown>[] {
    if (template !== 'tasks' && template !== 'kanban') return [];
    return [
      {
        Title: 'Draft project brief',
        Status: 'Todo',
        Priority: 'Medium',
        Tags: ['Planning'],
        Assignee: [],
        'Due date': null,
        Description: 'Capture scope, owners, and launch criteria.',
      },
      {
        Title: 'Build first board view',
        Status: 'In progress',
        Priority: 'High',
        Tags: ['Kanban'],
        Assignee: [],
        'Due date': null,
        Description: 'Validate the Notion-like task workflow inside Docmost.',
      },
    ];
  }
}
