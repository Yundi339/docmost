import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
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
import {
  buildDefaultFieldsForTemplate,
  DatabaseFieldDefinition,
  DatabaseFieldType,
  DatabaseViewDefinition,
  getDefaultViewsForTemplate,
  getPrimaryDatabaseFieldName,
  normalizeApitableRecord,
  normalizeDatabaseFields,
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
import { WsTreeService } from '../../ws/ws-tree.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  validateDatabaseFieldName,
  validateDatabaseRecordFields,
} from './database-record-validator';
import { PageOperationPolicyService } from '../page/policies/page-operation-policy.service';

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
    private readonly pageOperationPolicy: PageOperationPolicyService,
    private readonly apitableClient: ApitableClient,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly wsTreeService: WsTreeService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async createDatabase(dto: CreateDatabaseDto, user: User) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.deletedAt || page.workspaceId !== user.workspaceId) {
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

    const { database, createdPages } = await executeTx(this.db, async (trx) => {
      const database = await this.databaseRepo.insertDatabaseBlock(
        {
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
        },
        trx,
      );

      if (this.isNativeDatabase(database)) {
        const seedRecords = this.seedRecordFields(template);
        const createdPages: Page[] = [];
        for (const recordFields of seedRecords) {
          createdPages.push(
            await this.createRecordPage(
              database,
              recordFields,
              user,
              trx,
              false,
            ),
          );
        }
        let previousSortOrder: string | null = null;

        await this.databaseRepo.insertDatabaseRecords(
          seedRecords.map((recordFields, index) => {
            previousSortOrder = generateJitteredKeyBetween(
              previousSortOrder,
              null,
            );

            return {
              databaseId: database.id,
              pageId: createdPages[index].id,
              spaceId: database.spaceId,
              workspaceId: database.workspaceId,
              createdById: user.id,
              updatedById: user.id,
              fields: recordFields as unknown as Json,
              sortOrder: previousSortOrder,
            };
          }),
          trx,
        );

        return { database, createdPages };
      }

      return { database, createdPages: [] };
    });

    if (createdPages.length > 0) {
      this.eventEmitter.emit(EventName.PAGE_CREATED, {
        pageIds: createdPages.map((createdPage) => createdPage.id),
        workspaceId: database.workspaceId,
      });
    }

    this.auditService.log({
      event: AuditEvent.DATABASE_CREATED,
      resourceType: AuditResource.PAGE,
      resourceId: database.pageId,
      spaceId: database.spaceId,
      metadata: {
        databaseId: database.id,
        template: database.template,
        viewType: activeView.type,
        seededRecordCount: createdPages.length,
      },
    });
    await this.notifyDatabaseChanged(database, {
      info: true,
      records: true,
      treeMetadata: true,
    });

    return this.toResponse(database);
  }

  async getDatabase(databaseId: string, user: User) {
    const database = await this.getAuthorizedDatabase(databaseId, user, 'view');
    return this.toResponse(database);
  }

  async listTargets(dto: ListDatabaseTargetsDto, user: User) {
    if (!user.workspaceId) return { items: [] };

    const databases = await this.databaseRepo.listByWorkspace(user.workspaceId);
    const candidates = databases.filter(
      (database) =>
        database.id !== dto.excludeDatabaseId &&
        this.isNativeDatabase(database) &&
        this.getViews(database.views).some((view) => view.type === 'kanban'),
    );
    const pageById = new Map(
      (
        await this.pageAccessService.filterViewablePagesWithPermissions(
          (
            await this.pageRepo.findByIds(
              candidates.map((database) => database.pageId),
            )
          ).filter(
            (page) => !page.deletedAt && page.workspaceId === user.workspaceId,
          ),
          user,
        )
      )
        .filter(({ canEdit }) => canEdit)
        .map(({ page }) => [page.id, page]),
    );
    const items = candidates.flatMap((database) => {
      const page = pageById.get(database.pageId);
      if (
        !page ||
        page.spaceId !== database.spaceId ||
        page.workspaceId !== database.workspaceId
      ) {
        return [];
      }

      return [
        {
          ...this.toResponse(database),
          pageTitle: page.title,
          pageIcon: page.icon,
        },
      ];
    });

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

    this.auditService.log({
      event: AuditEvent.DATABASE_VIEW_CREATED,
      resourceType: AuditResource.PAGE,
      resourceId: database.pageId,
      spaceId: database.spaceId,
      metadata: {
        databaseId: database.id,
        viewId: view.id,
        viewType: view.type,
      },
    });
    await this.notifyDatabaseChanged(updated, { info: true });

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

    this.auditService.log({
      event: AuditEvent.DATABASE_TITLE_UPDATED,
      resourceType: AuditResource.PAGE,
      resourceId: database.pageId,
      spaceId: database.spaceId,
      changes: {
        before: { title: database.title },
        after: { title: updated.title },
      },
      metadata: { databaseId: database.id },
    });
    await this.notifyDatabaseChanged(updated, { info: true });

    return this.toResponse(updated);
  }

  async createField(dto: CreateDatabaseFieldDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const fields = this.getFields(database.fields);
    const requestedName = dto.name?.trim() || this.defaultFieldName(dto.type);
    validateDatabaseFieldName(requestedName);
    const name = this.makeUniqueFieldName(requestedName, fields);
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

    const updated = await executeTx(this.db, async (trx) => {
      const updated = await this.databaseRepo.updateFields(
        database.id,
        nextFields as unknown as Json,
        user.id,
        trx,
      );

      if (this.isNativeDatabase(database)) {
        await this.databaseRepo.backfillDatabaseRecordField(
          database.id,
          field.name,
          this.defaultValueForField(field) as Json,
          user.id,
          trx,
        );
      }

      return updated;
    });

    this.auditService.log({
      event: AuditEvent.DATABASE_FIELD_CREATED,
      resourceType: AuditResource.PAGE,
      resourceId: database.pageId,
      spaceId: database.spaceId,
      metadata: {
        databaseId: database.id,
        fieldName: field.name,
        fieldType: field.type,
      },
    });
    await this.notifyDatabaseChanged(updated, { info: true, records: true });

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
    if (
      currentField.isPrimary &&
      nextType !== 'text' &&
      nextType !== 'longText'
    ) {
      throw new BadRequestException(
        'The primary title field must remain a text field',
      );
    }
    const requestedName = dto.name?.trim();
    if (requestedName) validateDatabaseFieldName(requestedName);
    const nextName = requestedName
      ? this.makeUniqueFieldName(requestedName, fields, currentField.name)
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
    const updated = await executeTx(this.db, async (trx) => {
      const updated = await this.databaseRepo.updateFields(
        database.id,
        nextFields as unknown as Json,
        user.id,
        trx,
      );

      if (this.isNativeDatabase(database) && nextName !== currentField.name) {
        await this.databaseRepo.renameDatabaseRecordField(
          database.id,
          currentField.name,
          nextName,
          user.id,
          trx,
        );
      }

      return updated;
    });

    this.auditService.log({
      event: AuditEvent.DATABASE_FIELD_UPDATED,
      resourceType: AuditResource.PAGE,
      resourceId: database.pageId,
      spaceId: database.spaceId,
      changes: {
        before: {
          fieldName: currentField.name,
          fieldType: currentField.type,
        },
        after: { fieldName: nextField.name, fieldType: nextField.type },
      },
      metadata: { databaseId: database.id },
    });
    await this.notifyDatabaseChanged(updated, { info: true, records: true });

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
      const pages = (
        await this.pageRepo.findByIds(
          nativeRecords
            .map((record) => record.pageId)
            .filter((pageId): pageId is string => Boolean(pageId)),
        )
      ).filter(
        (page) =>
          !page.deletedAt &&
          page.workspaceId === database.workspaceId &&
          page.spaceId === database.spaceId &&
          page.parentPageId === database.pageId,
      );
      const pagePermissions =
        await this.pageAccessService.filterViewablePagesWithPermissions(
          pages,
          user,
        );
      const pageById = new Map(
        pagePermissions.map(({ page, canEdit }) => [
          page.id,
          { page, canEdit },
        ]),
      );

      return {
        items: nativeRecords.flatMap((record) => {
          const pageAccess = record.pageId
            ? pageById.get(record.pageId)
            : undefined;
          return pageAccess
            ? [
                this.normalizeNativeRecordForList(
                  database,
                  record,
                  pageAccess.page,
                  pageAccess.canEdit,
                ),
              ]
            : [];
        }),
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
      const createdRecord = await this.apitableClient.createRecord(
        datasheetId,
        dto.fields,
      );
      this.auditService.log({
        event: AuditEvent.DATABASE_RECORD_CREATED,
        resourceType: AuditResource.PAGE,
        resourceId: database.pageId,
        spaceId: database.spaceId,
        metadata: { databaseId: database.id, provider: 'apitable' },
      });
      await this.notifyDatabaseChanged(database, { records: true });
      return createdRecord;
    }

    validateDatabaseRecordFields(database.fields, dto.fields);
    await this.validateRecordUserReferences(database, dto.fields);

    const fields = this.buildNewRecordFields(database, dto.fields);
    const { recordPage, record } = await executeTx(this.db, async (trx) => {
      const recordPage = await this.createRecordPage(
        database,
        fields,
        user,
        trx,
        false,
      );
      const lastSortOrder =
        await this.databaseRepo.getLastDatabaseRecordSortOrder(
          database.id,
          trx,
        );

      const record = await this.databaseRepo.insertDatabaseRecord(
        {
          databaseId: database.id,
          pageId: recordPage.id,
          spaceId: database.spaceId,
          workspaceId: database.workspaceId,
          createdById: user.id,
          updatedById: user.id,
          fields: fields as unknown as Json,
          sortOrder: generateJitteredKeyBetween(lastSortOrder, null),
        },
        trx,
      );

      return { recordPage, record };
    });

    this.eventEmitter.emit(EventName.PAGE_CREATED, {
      pageIds: [recordPage.id],
      workspaceId: database.workspaceId,
    });

    this.auditService.log({
      event: AuditEvent.DATABASE_RECORD_CREATED,
      resourceType: AuditResource.PAGE,
      resourceId: recordPage.id,
      spaceId: database.spaceId,
      metadata: {
        databaseId: database.id,
        recordId: record.id,
        databasePageId: database.pageId,
      },
    });
    await this.notifyDatabaseChanged(database, { records: true });

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
      const updatedRecord = await this.apitableClient.updateRecord(
        datasheetId,
        dto.recordId,
        dto.fields,
      );
      this.auditService.log({
        event: AuditEvent.DATABASE_RECORD_UPDATED,
        resourceType: AuditResource.PAGE,
        resourceId: database.pageId,
        spaceId: database.spaceId,
        metadata: {
          databaseId: database.id,
          recordId: dto.recordId,
          changedFields: Object.keys(dto.fields),
          provider: 'apitable',
        },
      });
      await this.notifyDatabaseChanged(database, { records: true });
      return updatedRecord;
    }

    validateDatabaseRecordFields(database.fields, dto.fields);
    await this.validateRecordUserReferences(database, dto.fields);

    const record = await this.databaseRepo.findDatabaseRecord(
      database.id,
      dto.recordId,
    );

    if (!record) {
      const updatedRecord = await this.updateLegacyMetadataRecord(
        database,
        dto.recordId,
        dto.fields,
        user.id,
      );
      this.auditService.log({
        event: AuditEvent.DATABASE_RECORD_UPDATED,
        resourceType: AuditResource.PAGE,
        resourceId: database.pageId,
        spaceId: database.spaceId,
        metadata: {
          databaseId: database.id,
          recordId: dto.recordId,
          changedFields: Object.keys(dto.fields),
          provider: 'legacy',
        },
      });
      await this.notifyDatabaseChanged(database, { records: true });
      return updatedRecord;
    }

    const recordPage = await this.getActiveRecordPage(database, record);
    if (!recordPage) throw new NotFoundException('Record page not found');
    await this.pageAccessService.validateCanEdit(recordPage, user);

    const nextFields = {
      ...((record.fields as Record<string, unknown>) ?? {}),
      ...dto.fields,
    };
    const { updatedRecord, pageTitleChanged } = await executeTx(
      this.db,
      async (trx) => {
        const updatedRecord =
          await this.databaseRepo.updateDatabaseRecordFields(
            database.id,
            dto.recordId,
            nextFields as unknown as Json,
            user.id,
            trx,
          );

        return {
          updatedRecord,
          pageTitleChanged: await this.syncRecordPage(
            database,
            updatedRecord,
            nextFields,
            user,
            trx,
          ),
        };
      },
    );

    if (pageTitleChanged && updatedRecord.pageId) {
      const updatedPage = await this.pageRepo.findById(updatedRecord.pageId);
      if (updatedPage) {
        this.eventEmitter.emit(EventName.PAGE_UPDATED, {
          pageIds: [updatedPage.id],
          workspaceId: updatedPage.workspaceId,
        });
        await this.wsTreeService.notifyPageUpdated(updatedPage);
      }
    }

    this.auditService.log({
      event: AuditEvent.DATABASE_RECORD_UPDATED,
      resourceType: AuditResource.PAGE,
      resourceId: recordPage.id,
      spaceId: database.spaceId,
      metadata: {
        databaseId: database.id,
        recordId: updatedRecord.id,
        databasePageId: database.pageId,
        changedFields: Object.keys(dto.fields),
      },
    });
    await this.notifyDatabaseChanged(database, { records: true });

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

    const recordPage = await this.getActiveRecordPage(database, record);
    if (!recordPage) throw new NotFoundException('Record page not found');
    await this.pageAccessService.validateCanEdit(recordPage, user);

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

    this.auditService.log({
      event: AuditEvent.DATABASE_RECORD_REORDERED,
      resourceType: AuditResource.PAGE,
      resourceId: recordPage.id,
      spaceId: database.spaceId,
      metadata: {
        databaseId: database.id,
        recordId: record.id,
        databasePageId: database.pageId,
        beforeRecordId: dto.beforeRecordId,
        afterRecordId: dto.afterRecordId,
      },
    });
    await this.notifyDatabaseChanged(database, { records: true });

    return this.normalizeNativeRecordWithPage(database, updatedRecord, user);
  }

  async attachPage(dto: AttachDatabasePageDto, user: User) {
    const database = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    if (!this.isNativeDatabase(database)) {
      throw new ConflictException({
        code: 'DATABASE_NATIVE_PAGE_RELATION_REQUIRED',
        message: 'Only native databases can manage Docmost pages',
      });
    }
    const page = await this.pageRepo.findById(dto.pageId, {
      includeTextContent: true,
    });
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== database.workspaceId ||
      page.id === database.pageId
    ) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, user);
    if (dto.fields) {
      validateDatabaseRecordFields(database.fields, dto.fields);
      await this.validateRecordUserReferences(database, dto.fields);
    }

    if (Boolean(dto.sourceDatabaseId) !== Boolean(dto.sourceRecordId)) {
      throw new BadRequestException(
        'Provide both source database and source record',
      );
    }

    let sourceDatabase: DatabaseBlock | undefined;
    if (dto.sourceDatabaseId && dto.sourceRecordId) {
      sourceDatabase = await this.getAuthorizedDatabase(
        dto.sourceDatabaseId,
        user,
        'edit',
      );
      const sourceRecord = await this.databaseRepo.findDatabaseRecord(
        sourceDatabase.id,
        dto.sourceRecordId,
      );
      if (!sourceRecord || sourceRecord.pageId !== page.id) {
        throw new NotFoundException('Source work item not found');
      }
    }

    let attachedRecord: DatabaseRecord | undefined;
    const previousAudience = await this.wsTreeService.capturePageAudience(page);
    try {
      await executeTx(this.db, async (trx) => {
        const memberships =
          await this.databaseRepo.listActiveDatabaseRecordsByPage(page.id, trx);
        if (memberships.length > 1) {
          throw new ConflictException({
            code: 'DATABASE_PAGE_MEMBERSHIP_CONFLICT',
            message: 'The page has conflicting board memberships',
          });
        }

        const currentMembership = memberships[0];
        if (currentMembership && currentMembership.databaseId !== database.id) {
          if (
            currentMembership.databaseId !== dto.sourceDatabaseId ||
            currentMembership.id !== dto.sourceRecordId
          ) {
            throw new ConflictException({
              code: 'DATABASE_PAGE_ALREADY_MANAGED',
              message: 'Move this work item from its current board',
            });
          }

          await this.databaseRepo.detachDatabaseRecord(
            currentMembership.databaseId,
            currentMembership.id,
            user.id,
            trx,
          );
        }

        const existingRecord =
          currentMembership?.databaseId === database.id
            ? currentMembership
            : undefined;
        if (existingRecord) {
          attachedRecord = existingRecord;
        } else {
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
        }

        await this.moveRecordPageToDestination(
          page,
          database.pageId,
          database.spaceId,
          user,
          trx,
        );
      });
    } catch (error) {
      if (isActivePageMembershipUniqueViolation(error)) {
        throw new ConflictException({
          code: 'DATABASE_PAGE_ALREADY_MANAGED',
          message: 'The page is already managed by a board',
        });
      }
      throw error;
    }

    if (!attachedRecord) {
      throw new BadRequestException('Failed to attach page');
    }

    const relocatedPage = await this.pageRepo.findById(page.id, {
      includeHasChildren: true,
    });
    if (relocatedPage) {
      await this.wsTreeService.notifyPageRelocated(
        page,
        relocatedPage,
        Boolean(
          (relocatedPage as Page & { hasChildren?: boolean }).hasChildren,
        ),
        previousAudience,
      );
    }

    this.auditService.log({
      event: sourceDatabase
        ? AuditEvent.DATABASE_RECORD_MOVED
        : AuditEvent.DATABASE_RECORD_ATTACHED,
      resourceType: AuditResource.PAGE,
      resourceId: page.id,
      spaceId: database.spaceId,
      metadata: {
        databaseId: database.id,
        recordId: attachedRecord.id,
        databasePageId: database.pageId,
        sourceDatabaseId: sourceDatabase?.id,
      },
    });
    await this.notifyDatabaseChanged(database, { records: true });
    if (sourceDatabase && sourceDatabase.id !== database.id) {
      await this.notifyDatabaseChanged(sourceDatabase, { records: true });
    }

    return this.normalizeNativeRecordWithPage(database, attachedRecord, user);
  }

  async detachRecord(dto: DetachDatabaseRecordDto, user: User) {
    await this.getAuthorizedDatabase(dto.databaseId, user, 'edit');
    throw new ConflictException({
      code: 'DATABASE_WORK_ITEM_DETACH_DISABLED',
      message: 'Move the work item to another board or to trash',
    });
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

    const recordPage = await this.getActiveRecordPage(database, record);
    if (recordPage) {
      await this.pageAccessService.validateCanEdit(recordPage, user);
    }

    const trashedPageIds = await executeTx(this.db, async (trx) => {
      if (recordPage) {
        return this.pageRepo.removePage(
          recordPage.id,
          user.id,
          database.workspaceId,
          trx,
          false,
        );
      }
      return [];
    });

    if (trashedPageIds.length > 0) {
      this.eventEmitter.emit(EventName.PAGE_SOFT_DELETED, {
        pageIds: trashedPageIds,
        workspaceId: database.workspaceId,
        databaseInvalidationHandled: true,
      });
    }

    this.auditService.log({
      event: AuditEvent.DATABASE_RECORD_TRASHED,
      resourceType: AuditResource.PAGE,
      resourceId: record.pageId,
      spaceId: database.spaceId,
      metadata: {
        databaseId: database.id,
        recordId: record.id,
        databasePageId: database.pageId,
      },
    });
    await this.notifyDatabaseChanged(database, { records: true });

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
    if (!database || database.workspaceId !== user.workspaceId) {
      throw new NotFoundException('Database not found');
    }

    const page = await this.pageRepo.findById(database.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== database.workspaceId ||
      page.spaceId !== database.spaceId
    ) {
      throw new NotFoundException('Page not found');
    }

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
    return normalizeDatabaseFields(fields);
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
    const permissions =
      await this.pageAccessService.validateCanViewWithPermissions(
        recordPage,
        user,
      );

    return normalizeApitableRecord(
      {
        id: record.id,
        fields: record.fields as Record<string, unknown>,
        pageId: recordPage.id,
        pageSlugId: recordPage.slugId,
        pageTitle: recordPage.title,
        pageIcon: recordPage.icon === '📄' ? null : recordPage.icon,
        sortOrder: record.sortOrder,
        canEdit: permissions.canEdit,
      },
      getPrimaryDatabaseFieldName(database.fields),
    );
  }

  private normalizeNativeRecordForList(
    database: DatabaseBlock,
    record: DatabaseRecord,
    recordPage: Page,
    canEdit: boolean,
  ) {
    return normalizeApitableRecord(
      {
        id: record.id,
        fields: record.fields as Record<string, unknown>,
        pageId: recordPage.id,
        pageSlugId: recordPage.slugId,
        pageTitle: recordPage.title,
        pageIcon: recordPage.icon === '📄' ? null : recordPage.icon,
        sortOrder: record.sortOrder,
        canEdit,
      },
      getPrimaryDatabaseFieldName(database.fields),
    );
  }

  private async getActiveRecordPage(
    database: DatabaseBlock,
    record: DatabaseRecord,
  ) {
    if (!record.pageId) return null;

    const page = await this.pageRepo.findById(record.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== database.workspaceId ||
      page.spaceId !== database.spaceId ||
      page.parentPageId !== database.pageId
    ) {
      return null;
    }

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
      if (
        page &&
        !page.deletedAt &&
        page.workspaceId === database.workspaceId &&
        page.spaceId === database.spaceId &&
        page.parentPageId === database.pageId
      ) {
        return page;
      }
      if (page?.deletedAt) {
        throw new NotFoundException('Record page is in trash');
      }
      if (page) {
        throw new ConflictException({
          code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
          message: 'The work item relationship must be repaired',
        });
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
      await this.pageService.movePageToParent(
        recordPage,
        targetPageId,
        user.id,
        trx,
        false,
      );
      return;
    }

    await this.pageService.movePageToSpace(
      recordPage,
      nextSpaceId,
      user.id,
      targetPageId,
      trx,
      false,
    );
  }

  private async createRecordPage(
    database: DatabaseBlock,
    fields: Record<string, unknown>,
    user: User,
    trx?: KyselyTransaction,
    emitLifecycleEvent = true,
  ): Promise<Page> {
    const parentPageId = database.pageId;
    const parentPage = await this.pageRepo.findById(parentPageId, {
      trx,
      withLock: Boolean(trx),
    });
    if (
      !parentPage ||
      parentPage.deletedAt ||
      parentPage.spaceId !== database.spaceId ||
      parentPage.workspaceId !== database.workspaceId
    ) {
      throw new NotFoundException('Page not found');
    }
    await this.pageOperationPolicy.assertOperation({
      operation: 'createChild',
      parentPage,
      actorId: user.id,
      trx,
    });

    const title = this.recordTitle(fields, database);
    const description = this.recordDescription(fields);
    const content = description
      ? this.recordDescriptionToDoc(description)
      : undefined;
    const lastPosition = await this.databaseRepo.getLastChildPagePosition(
      database.spaceId,
      parentPageId,
      trx,
    );

    return this.pageRepo.insertPage(
      {
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
      },
      trx,
      emitLifecycleEvent,
    );
  }

  private buildFieldsForAttachedPage(
    database: DatabaseBlock,
    page: Page,
    incomingFields?: Record<string, unknown>,
  ) {
    const nextFields = this.buildNewRecordFields(database, incomingFields);
    const primaryFieldName =
      getPrimaryDatabaseFieldName(database.fields) ?? 'Title';

    return {
      ...nextFields,
      [primaryFieldName]:
        incomingFields?.[primaryFieldName] ??
        incomingFields?.Title ??
        page.title ??
        'Untitled',
      ...(Object.prototype.hasOwnProperty.call(nextFields, 'Description')
        ? {
            Description: incomingFields?.Description ?? page.textContent ?? '',
          }
        : {}),
    };
  }

  private buildNewRecordFields(
    database: Pick<DatabaseBlock, 'fields'>,
    incomingFields: Record<string, unknown> = {},
  ) {
    const nextFields = this.getFields(database.fields).reduce<
      Record<string, unknown>
    >(
      (result, field) => {
        validateDatabaseFieldName(field.name);
        result[field.name] = this.defaultValueForField(field);
        return result;
      },
      Object.create(null) as Record<string, unknown>,
    );
    Object.assign(nextFields, incomingFields);

    const primaryFieldName = getPrimaryDatabaseFieldName(database.fields);
    if (
      primaryFieldName &&
      (typeof nextFields[primaryFieldName] !== 'string' ||
        !(nextFields[primaryFieldName] as string).trim())
    ) {
      nextFields[primaryFieldName] = 'Untitled';
    }

    return nextFields;
  }

  private async syncRecordPage(
    database: DatabaseBlock,
    record: DatabaseRecord,
    fields: Record<string, unknown>,
    user: User,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    if (!record.pageId) return false;

    const page = await this.pageRepo.findById(record.pageId, {
      trx,
      withLock: Boolean(trx),
    });
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== database.workspaceId ||
      page.spaceId !== database.spaceId ||
      page.parentPageId !== database.pageId
    ) {
      return false;
    }

    const title = this.recordTitle(fields, database);
    if (page.title === title) return false;

    await this.pageRepo.updatePage(
      {
        title,
        lastUpdatedById: user.id,
        workspaceId: record.workspaceId,
      },
      record.pageId,
      trx,
      false,
    );

    return true;
  }

  private async notifyDatabaseChanged(
    database: Pick<DatabaseBlock, 'id' | 'pageId' | 'spaceId'>,
    changes: { info?: boolean; records?: boolean; treeMetadata?: boolean },
  ) {
    const invalidations = [];
    if (changes.info) {
      invalidations.push({ entity: 'database', id: database.id });
    }
    if (changes.records) {
      invalidations.push({ entity: 'database-records', id: database.id });
    }
    if (changes.treeMetadata) {
      invalidations.push({
        entity: 'sidebar-full-tree',
        id: database.spaceId,
      });
    }
    if (invalidations.length === 0) return;

    await this.wsTreeService.notifyPageQueriesInvalidated(
      { id: database.pageId, spaceId: database.spaceId },
      invalidations,
    );
  }

  private async validateRecordUserReferences(
    database: Pick<DatabaseBlock, 'fields' | 'workspaceId'>,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const userFields = this.getFields(database.fields).filter(
      (field) => field.type === 'user' || field.type === 'person',
    );
    const references = userFields.flatMap((field) => {
      const value = fields[field.name];
      return Array.isArray(value)
        ? value
            .filter((userId): userId is string => typeof userId === 'string')
            .map((userId) => ({ field: field.name, userId }))
        : [];
    });
    if (references.length === 0) return;

    const validUserIds = new Set(
      await this.databaseRepo.listActiveWorkspaceUserIds(
        database.workspaceId,
        references.map(({ userId }) => userId),
      ),
    );
    const invalidReference = references.find(
      ({ userId }) => !validUserIds.has(userId),
    );
    if (invalidReference) {
      throw new BadRequestException({
        code: 'DATABASE_RECORD_VALIDATION_FAILED',
        message: 'User is not an active workspace member',
        field: invalidReference.field,
      });
    }
  }

  private recordTitle(
    fields: Record<string, unknown>,
    database?: Pick<DatabaseBlock, 'fields'>,
  ) {
    const primaryFieldName = database
      ? getPrimaryDatabaseFieldName(database.fields)
      : undefined;
    const title = primaryFieldName
      ? fields[primaryFieldName]
      : fields.Title || fields.Name;
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
    if (field.type === 'singleSelect') return field.options?.[0] ?? null;
    if (field.type === 'number') return null;
    if (field.type === 'date') return null;
    return '';
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

function isActivePageMembershipUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const databaseError = error as { code?: string; constraint?: string };
  return (
    databaseError.code === '23505' &&
    databaseError.constraint === 'idx_database_records_active_page_unique'
  );
}
