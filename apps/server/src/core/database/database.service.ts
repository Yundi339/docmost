import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
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
  DeleteDatabaseDto,
  DetachDatabaseRecordDto,
  ListDatabaseTargetsDto,
  ReorderDatabaseRecordDto,
  TrashDatabaseRecordPageDto,
  UpdateDatabaseFieldDto,
  UpdateDatabaseFieldOptionDto,
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

type DatabaseDeletionResult = {
  database: DatabaseBlock;
  alreadyDeleted: boolean;
  workItemPageIds: string[];
  trashedPageIds: string[];
  archivedDatabaseIds: string[];
  archivedRecordCount: number;
};

type DatabaseDeletionContext = {
  expectedHostPageId: string;
  expectedBlockId: string;
  allowMissing?: boolean;
  includeDeleted?: boolean;
  rejectImplicitDeletion?: boolean;
};

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

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
    const blockId = dto.blockId.trim();
    if (!blockId || blockId !== dto.blockId) {
      throw new BadRequestException('Invalid database block ID');
    }
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.deletedAt || page.workspaceId !== user.workspaceId) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.databaseRepo.findByPageAndBlock(
      page.id,
      blockId,
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

    const { database, createdPages, created } = await executeTx(
      this.db,
      async (trx) => {
        const lockedPage = await this.pageRepo.findById(page.id, {
          trx,
          withLock: true,
        });
        if (
          !lockedPage ||
          lockedPage.deletedAt ||
          lockedPage.workspaceId !== user.workspaceId
        ) {
          throw new NotFoundException('Page not found');
        }
        await this.pageAccessService.validateCanEdit(lockedPage, user);

        const concurrentDatabase = await this.databaseRepo.findByPageAndBlock(
          lockedPage.id,
          blockId,
          trx,
        );
        if (concurrentDatabase) {
          return {
            database: concurrentDatabase,
            createdPages: [] as Page[],
            created: false,
          };
        }

        const database = await this.databaseRepo.insertDatabaseBlock(
          {
            blockId,
            pageId: lockedPage.id,
            spaceId: lockedPage.spaceId,
            workspaceId: lockedPage.workspaceId,
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
                lockedPage,
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

          return { database, createdPages, created: true };
        }

        return { database, createdPages: [], created: true };
      },
    );

    if (!created) return this.toResponse(database);

    if (createdPages.length > 0) {
      try {
        this.eventEmitter.emit(EventName.PAGE_CREATED, {
          pageIds: createdPages.map((createdPage) => createdPage.id),
          workspaceId: database.workspaceId,
        });
      } catch (error) {
        this.logger.error('Failed to emit seeded database pages', error);
      }
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
    const databaseSnapshot = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const viewName = dto.name.trim();
    if (!viewName) throw new BadRequestException('View name is required');
    const viewId = uuid7();

    const { updated, view } = await executeTx(this.db, async (trx) => {
      const { database } = await this.lockAuthorizedDatabaseForEdit(
        databaseSnapshot,
        user,
        trx,
      );
      const view: DatabaseViewDefinition = {
        id: viewId,
        name: viewName,
        type: dto.type as DatabaseViewDefinition['type'],
        groupBy: this.resolveViewGroupBy(database, dto.type, dto.groupBy),
      };
      const updated = await this.databaseRepo.updateViews(
        database.id,
        [...this.getViews(database.views), view] as unknown as Json,
        view.id,
        user.id,
        trx,
      );
      return { updated, view };
    });

    this.auditService.log({
      event: AuditEvent.DATABASE_VIEW_CREATED,
      resourceType: AuditResource.PAGE,
      resourceId: updated.pageId,
      spaceId: updated.spaceId,
      metadata: {
        databaseId: updated.id,
        viewId: view.id,
        viewType: view.type,
      },
    });
    await this.notifyDatabaseChanged(updated, { info: true });

    return this.toResponse(updated);
  }

  async updateTitle(dto: UpdateDatabaseTitleDto, user: User) {
    const databaseSnapshot = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const title = dto.title.trim();
    const { previousTitle, updated } = await executeTx(this.db, async (trx) => {
      const { database } = await this.lockAuthorizedDatabaseForEdit(
        databaseSnapshot,
        user,
        trx,
      );
      return {
        previousTitle: database.title,
        updated: await this.databaseRepo.updateTitle(
          database.id,
          title,
          user.id,
          trx,
        ),
      };
    });

    this.auditService.log({
      event: AuditEvent.DATABASE_TITLE_UPDATED,
      resourceType: AuditResource.PAGE,
      resourceId: updated.pageId,
      spaceId: updated.spaceId,
      changes: {
        before: { title: previousTitle },
        after: { title: updated.title },
      },
      metadata: { databaseId: updated.id },
    });
    await this.notifyDatabaseChanged(updated, { info: true });

    return this.toResponse(updated);
  }

  async createField(dto: CreateDatabaseFieldDto, user: User) {
    const databaseSnapshot = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const requestedName = dto.name?.trim() || this.defaultFieldName(dto.type);
    validateDatabaseFieldName(requestedName);
    const type = this.normalizeFieldType(dto.type);
    const requestedOptions = dto.options
      ? this.normalizeFieldOptions(dto.options)
      : undefined;
    this.assertFieldOptionsSupported(type, requestedOptions);
    const { field, updated } = await executeTx(this.db, async (trx) => {
      const { database } = await this.lockAuthorizedDatabaseForEdit(
        databaseSnapshot,
        user,
        trx,
      );
      this.assertNativeSchemaMutation(database);
      const fields = this.getFields(database.fields);
      const field: DatabaseFieldDefinition = {
        name: this.makeUniqueFieldName(requestedName, fields),
        type,
        options: requestedOptions?.length
          ? requestedOptions
          : this.defaultOptionsForField(type),
      };
      if (!field.options?.length) delete field.options;

      let updated = await this.databaseRepo.updateFields(
        database.id,
        this.insertField(
          fields,
          field,
          dto.position,
          dto.anchorFieldName,
        ) as unknown as Json,
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
        const legacyUpdate = this.transformLegacyMetadataRecordFields(
          database,
          (recordFields) =>
            Object.prototype.hasOwnProperty.call(recordFields, field.name)
              ? recordFields
              : {
                  ...recordFields,
                  [field.name]: this.defaultValueForField(field),
                },
        );
        if (legacyUpdate.changedRecordCount > 0) {
          updated = await this.databaseRepo.updateMetadata(
            database.id,
            legacyUpdate.metadata as unknown as Json,
            user.id,
            trx,
          );
        }
      }

      return { field, updated };
    });

    this.auditService.log({
      event: AuditEvent.DATABASE_FIELD_CREATED,
      resourceType: AuditResource.PAGE,
      resourceId: updated.pageId,
      spaceId: updated.spaceId,
      metadata: {
        databaseId: updated.id,
        fieldName: field.name,
        fieldType: field.type,
      },
    });
    await this.notifyDatabaseChanged(updated, { info: true, records: true });

    return this.toResponse(updated);
  }

  async updateField(dto: UpdateDatabaseFieldDto, user: User) {
    const databaseSnapshot = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const requestedName = dto.name?.trim();
    if (dto.name !== undefined && !requestedName) {
      throw new BadRequestException('Field name is required');
    }
    if (requestedName) validateDatabaseFieldName(requestedName);
    const requestedOptions = dto.options
      ? this.normalizeFieldOptions(dto.options)
      : undefined;
    const { currentField, nextField, updated } = await executeTx(
      this.db,
      async (trx) => {
        const { database } = await this.lockAuthorizedDatabaseForEdit(
          databaseSnapshot,
          user,
          trx,
        );
        this.assertNativeSchemaMutation(database);
        const fields = this.getFields(database.fields);
        const fieldIndex = fields.findIndex(
          (field) => field.name === dto.fieldName,
        );
        if (fieldIndex === -1) throw new NotFoundException('Field not found');

        const currentField = fields[fieldIndex];
        if (
          currentField.isPrimary &&
          requestedName &&
          requestedName !== currentField.name
        ) {
          throw new BadRequestException({
            code: 'DATABASE_PRIMARY_FIELD_RENAME_UNSUPPORTED',
            message: 'The primary title field cannot be renamed',
          });
        }
        const nextType = dto.type
          ? this.normalizeFieldType(dto.type)
          : currentField.type;
        if (nextType !== currentField.type) {
          throw new ConflictException({
            code: 'DATABASE_FIELD_TYPE_CHANGE_UNSUPPORTED',
            message: 'Changing a database field type is not supported yet',
          });
        }
        this.assertFieldOptionsSupported(nextType, requestedOptions);
        const nextName = requestedName
          ? this.makeUniqueFieldName(requestedName, fields, currentField.name)
          : currentField.name;
        const nextField: DatabaseFieldDefinition = {
          ...currentField,
          name: nextName,
          type: nextType,
          options:
            requestedOptions ??
            currentField.options ??
            this.defaultOptionsForField(nextType),
        };
        if (!nextField.options?.length) delete nextField.options;

        if (requestedOptions) {
          const removedOptions = (currentField.options ?? []).filter(
            (option) => !requestedOptions.includes(option),
          );
          if (removedOptions.length > 0) {
            throw new ConflictException({
              code: 'DATABASE_FIELD_OPTION_OPERATION_REQUIRED',
              message:
                'Rename or delete field options with the dedicated option operation',
            });
          }
        }

        const nextFields = fields.map((field, index) =>
          index === fieldIndex ? nextField : field,
        );
        let updated = await this.databaseRepo.updateFields(
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

          const views = this.getViews(database.views);
          const nextViews = views.map((view) =>
            view.groupBy === currentField.name
              ? { ...view, groupBy: nextName }
              : view,
          );
          if (nextViews.some((view, index) => view !== views[index])) {
            updated = await this.databaseRepo.updateViews(
              database.id,
              nextViews as unknown as Json,
              database.activeViewId,
              user.id,
              trx,
            );
          }

          const legacyUpdate = this.transformLegacyMetadataRecordFields(
            database,
            (recordFields) => {
              if (
                !Object.prototype.hasOwnProperty.call(
                  recordFields,
                  currentField.name,
                )
              ) {
                return recordFields;
              }
              const nextRecordFields = {
                ...recordFields,
                [nextName]: recordFields[currentField.name],
              };
              delete nextRecordFields[currentField.name];
              return nextRecordFields;
            },
          );
          if (legacyUpdate.changedRecordCount > 0) {
            updated = await this.databaseRepo.updateMetadata(
              database.id,
              legacyUpdate.metadata as unknown as Json,
              user.id,
              trx,
            );
          }
        }

        return { currentField, nextField, updated };
      },
    );

    this.auditService.log({
      event: AuditEvent.DATABASE_FIELD_UPDATED,
      resourceType: AuditResource.PAGE,
      resourceId: updated.pageId,
      spaceId: updated.spaceId,
      changes: {
        before: {
          fieldName: currentField.name,
          fieldType: currentField.type,
        },
        after: { fieldName: nextField.name, fieldType: nextField.type },
      },
      metadata: { databaseId: updated.id },
    });
    await this.notifyDatabaseChanged(updated, { info: true, records: true });

    return this.toResponse(updated);
  }

  async updateFieldOption(dto: UpdateDatabaseFieldOptionDto, user: User) {
    const databaseSnapshot = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const option = dto.option.trim();
    if (!option) throw new BadRequestException('Field option is required');
    const snapshotHadOption = Boolean(
      this.getFields(databaseSnapshot.fields)
        .find((field) => field.name === dto.fieldName)
        ?.options?.includes(option),
    );

    const result = await executeTx(this.db, async (trx) => {
      const { database } = await this.lockAuthorizedDatabaseForEdit(
        databaseSnapshot,
        user,
        trx,
      );
      if (!this.isNativeDatabase(database)) {
        throw new ConflictException({
          code: 'DATABASE_EXTERNAL_OPTION_OPERATION_UNSUPPORTED',
          message:
            'External database options must be changed in the source provider',
        });
      }

      const fields = this.getFields(database.fields);
      const fieldIndex = fields.findIndex(
        (field) => field.name === dto.fieldName,
      );
      if (fieldIndex === -1) throw new NotFoundException('Field not found');

      const field = fields[fieldIndex];
      if (!['status', 'singleSelect'].includes(field.type)) {
        throw new BadRequestException({
          code: 'DATABASE_FIELD_OPTION_OPERATION_UNSUPPORTED',
          message: 'This field does not support single-value options',
        });
      }

      const options = this.normalizeFieldOptions(field.options ?? []);
      const requestedNextOption =
        dto.operation === 'rename'
          ? (dto.name?.trim() ?? '')
          : (dto.replacementOption?.trim() ?? '');
      if (!options.includes(option)) {
        if (snapshotHadOption) {
          throw new ConflictException({
            code: 'DATABASE_FIELD_OPTION_CHANGED_RETRY',
            message: 'The field options changed concurrently; retry',
          });
        }
        if (requestedNextOption && options.includes(requestedNextOption)) {
          return {
            database,
            field,
            nextOption: requestedNextOption,
            affectedRecordCount: 0,
            changed: false,
          };
        }
        throw new NotFoundException('Field option not found');
      }

      let nextOption: string;
      let nextOptions: string[];
      if (dto.operation === 'rename') {
        nextOption = requestedNextOption;
        if (!nextOption) {
          throw new BadRequestException('New field option name is required');
        }
        if (nextOption !== option && options.includes(nextOption)) {
          throw new ConflictException({
            code: 'DATABASE_FIELD_OPTION_EXISTS',
            message: 'A field option with this name already exists',
          });
        }
        nextOptions = options.map((value) =>
          value === option ? nextOption : value,
        );
      } else {
        nextOption = requestedNextOption;
        if (
          !nextOption ||
          nextOption === option ||
          !options.includes(nextOption)
        ) {
          throw new BadRequestException({
            code: 'DATABASE_FIELD_OPTION_REPLACEMENT_REQUIRED',
            message: 'A remaining field option is required as the replacement',
          });
        }
        nextOptions = options.filter((value) => value !== option);
      }

      if (nextOption === option) {
        return {
          database,
          field,
          nextOption,
          affectedRecordCount: 0,
          changed: false,
        };
      }

      const tableRecordCount =
        await this.databaseRepo.replaceDatabaseRecordFieldValue(
          database.id,
          field.name,
          option,
          nextOption,
          user.id,
          trx,
        );
      const legacyUpdate = this.transformLegacyMetadataRecordFields(
        database,
        (recordFields) =>
          recordFields[field.name] === option
            ? { ...recordFields, [field.name]: nextOption }
            : recordFields,
      );
      const nextFields = fields.map((value, index) =>
        index === fieldIndex ? { ...field, options: nextOptions } : value,
      );
      let updated = await this.databaseRepo.updateFields(
        database.id,
        nextFields as unknown as Json,
        user.id,
        trx,
      );
      if (legacyUpdate.changedRecordCount > 0) {
        updated = await this.databaseRepo.updateMetadata(
          database.id,
          legacyUpdate.metadata as unknown as Json,
          user.id,
          trx,
        );
      }

      return {
        database: updated,
        field,
        nextOption,
        affectedRecordCount: tableRecordCount + legacyUpdate.changedRecordCount,
        changed: true,
      };
    });

    if (result.changed) {
      try {
        await this.auditService.log({
          event: AuditEvent.DATABASE_FIELD_UPDATED,
          resourceType: AuditResource.PAGE,
          resourceId: result.database.pageId,
          spaceId: result.database.spaceId,
          changes: {
            before: { fieldName: result.field.name, option },
            after: {
              fieldName: result.field.name,
              option:
                dto.operation === 'rename' ? result.nextOption : undefined,
            },
          },
          metadata: {
            databaseId: result.database.id,
            optionOperation: dto.operation,
            affectedRecordCount: result.affectedRecordCount,
          },
        });
      } catch (error) {
        this.logger.error(
          'Failed to audit database field option update',
          error,
        );
      }
      try {
        await this.notifyDatabaseChanged(result.database, {
          info: true,
          records: true,
        });
      } catch (error) {
        this.logger.error(
          'Failed to publish database field option update',
          error,
        );
      }
    }

    return this.toResponse(result.database);
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
        normalizeApitableRecord(
          record,
          getPrimaryDatabaseFieldName(database.fields),
          this.getDatabaseStatusFieldName(database),
        ),
      ),
    };
  }

  async createRecord(dto: CreateDatabaseRecordDto, user: User) {
    let database = await this.getAuthorizedDatabase(
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

    const result = await executeTx(this.db, async (trx) => {
      const hostPage = await this.pageRepo.findById(database.pageId, {
        trx,
        withLock: true,
      });
      if (
        !hostPage ||
        hostPage.deletedAt ||
        hostPage.id !== database.pageId ||
        hostPage.workspaceId !== database.workspaceId ||
        hostPage.spaceId !== database.spaceId
      ) {
        throw new NotFoundException('Page not found');
      }
      await this.pageAccessService.validateCanEdit(hostPage, user);

      const currentDatabase = await this.databaseRepo.findById(
        database.id,
        trx,
        true,
      );
      if (!currentDatabase) throw new NotFoundException('Database not found');
      if (
        currentDatabase.pageId !== hostPage.id ||
        currentDatabase.workspaceId !== hostPage.workspaceId ||
        currentDatabase.spaceId !== hostPage.spaceId
      ) {
        throw new NotFoundException('Database not found');
      }

      validateDatabaseRecordFields(currentDatabase.fields, dto.fields);
      await this.validateRecordUserReferences(currentDatabase, dto.fields, trx);
      const fields = this.buildNewRecordFields(currentDatabase, dto.fields);

      const recordPage = await this.createRecordPage(
        currentDatabase,
        fields,
        user,
        trx,
        false,
        hostPage,
      );
      const lastSortOrder =
        await this.databaseRepo.getLastDatabaseRecordSortOrder(
          currentDatabase.id,
          trx,
        );

      const record = await this.databaseRepo.insertDatabaseRecord(
        {
          databaseId: currentDatabase.id,
          pageId: recordPage.id,
          spaceId: currentDatabase.spaceId,
          workspaceId: currentDatabase.workspaceId,
          createdById: user.id,
          updatedById: user.id,
          fields: fields as unknown as Json,
          sortOrder: generateJitteredKeyBetween(lastSortOrder, null),
        },
        trx,
      );

      return { database: currentDatabase, recordPage, record };
    });
    database = result.database;
    const { recordPage, record } = result;

    try {
      this.eventEmitter.emit(EventName.PAGE_CREATED, {
        pageIds: [recordPage.id],
        workspaceId: database.workspaceId,
      });
    } catch (error) {
      this.logger.error('Failed to emit database record page creation', error);
    }

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

    return this.normalizeNativeRecordForList(
      database,
      record,
      recordPage,
      true,
    );
  }

  async updateRecord(dto: UpdateDatabaseRecordDto, user: User) {
    const databaseSnapshot = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const datasheetId = databaseSnapshot.apitableDatasheetId;

    if (datasheetId && !this.isNativeDatabase(databaseSnapshot)) {
      const updatedRecord = await this.apitableClient.updateRecord(
        datasheetId,
        dto.recordId,
        dto.fields,
      );
      this.auditService.log({
        event: AuditEvent.DATABASE_RECORD_UPDATED,
        resourceType: AuditResource.PAGE,
        resourceId: databaseSnapshot.pageId,
        spaceId: databaseSnapshot.spaceId,
        metadata: {
          databaseId: databaseSnapshot.id,
          recordId: dto.recordId,
          changedFields: Object.keys(dto.fields),
          provider: 'apitable',
        },
      });
      await this.notifyDatabaseChanged(databaseSnapshot, { records: true });
      return updatedRecord;
    }

    const recordSnapshot = await this.databaseRepo.findDatabaseRecord(
      databaseSnapshot.id,
      dto.recordId,
    );

    if (!recordSnapshot) {
      const { database, updatedRecord } = await executeTx(
        this.db,
        async (trx) => {
          const { database } = await this.lockAuthorizedDatabaseForEdit(
            databaseSnapshot,
            user,
            trx,
          );
          validateDatabaseRecordFields(database.fields, dto.fields);
          await this.validateRecordUserReferences(database, dto.fields, trx);
          return {
            database,
            updatedRecord: await this.updateLegacyMetadataRecord(
              database,
              dto.recordId,
              dto.fields,
              user.id,
              trx,
            ),
          };
        },
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

    if (!recordSnapshot.pageId) {
      throw new ConflictException({
        code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
        message: 'The work item relationship must be repaired',
      });
    }

    const { database, recordPage, updatedRecord, pageTitleChanged } =
      await executeTx(this.db, async (trx) => {
        const hostPage = await this.pageRepo.findById(databaseSnapshot.pageId, {
          trx,
          withLock: true,
        });
        if (
          !hostPage ||
          hostPage.deletedAt ||
          hostPage.id !== databaseSnapshot.pageId ||
          hostPage.workspaceId !== user.workspaceId ||
          hostPage.workspaceId !== databaseSnapshot.workspaceId ||
          hostPage.spaceId !== databaseSnapshot.spaceId
        ) {
          throw new NotFoundException('Page not found');
        }
        await this.pageAccessService.validateCanEdit(hostPage, user);

        const recordPage = await this.pageRepo.findById(
          recordSnapshot.pageId!,
          {
            trx,
            withLock: true,
          },
        );
        if (!recordPage || recordPage.deletedAt) {
          throw new NotFoundException('Record page not found');
        }
        if (
          recordPage.workspaceId !== databaseSnapshot.workspaceId ||
          recordPage.spaceId !== databaseSnapshot.spaceId ||
          recordPage.id === databaseSnapshot.pageId ||
          recordPage.parentPageId !== databaseSnapshot.pageId
        ) {
          throw new ConflictException({
            code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
            message: 'The work item relationship must be repaired',
          });
        }
        await this.pageAccessService.validateCanEdit(recordPage, user);

        const database = await this.databaseRepo.findById(
          databaseSnapshot.id,
          trx,
          true,
        );
        if (
          !database ||
          database.pageId !== hostPage.id ||
          database.workspaceId !== hostPage.workspaceId ||
          database.spaceId !== hostPage.spaceId
        ) {
          throw new NotFoundException('Database not found');
        }
        const currentRecord = await this.databaseRepo.findDatabaseRecord(
          database.id,
          dto.recordId,
          trx,
          true,
        );
        if (!currentRecord) throw new NotFoundException('Record not found');
        if (currentRecord.pageId !== recordPage.id) {
          throw new ConflictException({
            code: 'DATABASE_RECORD_CHANGED_RETRY',
            message: 'The work item changed while it was being updated; retry',
          });
        }

        validateDatabaseRecordFields(database.fields, dto.fields);
        await this.validateRecordUserReferences(database, dto.fields, trx);
        const nextFields = {
          ...((currentRecord.fields as Record<string, unknown>) ?? {}),
          ...dto.fields,
        };
        const updatedRecord =
          await this.databaseRepo.updateDatabaseRecordFields(
            database.id,
            dto.recordId,
            nextFields as unknown as Json,
            user.id,
            trx,
          );

        return {
          database,
          recordPage,
          updatedRecord,
          pageTitleChanged: await this.syncRecordPage(
            database,
            updatedRecord,
            nextFields,
            user,
            trx,
          ),
        };
      });

    let responseRecordPage = recordPage;
    if (pageTitleChanged && updatedRecord.pageId) {
      try {
        const updatedPage = await this.pageRepo.findById(updatedRecord.pageId);
        if (updatedPage) {
          responseRecordPage = updatedPage;
          this.eventEmitter.emit(EventName.PAGE_UPDATED, {
            pageIds: [updatedPage.id],
            workspaceId: updatedPage.workspaceId,
          });
          await this.wsTreeService.notifyPageUpdated(updatedPage);
        }
      } catch (error) {
        this.logger.error(
          'Failed to publish database record page update',
          error,
        );
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

    return this.normalizeNativeRecordForList(
      database,
      updatedRecord,
      responseRecordPage,
      true,
    );
  }

  async reorderRecord(dto: ReorderDatabaseRecordDto, user: User) {
    const databaseSnapshot = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const recordSnapshot = await this.databaseRepo.findDatabaseRecord(
      databaseSnapshot.id,
      dto.recordId,
    );
    if (!recordSnapshot) throw new NotFoundException('Record not found');
    if (!recordSnapshot.pageId) {
      throw new ConflictException({
        code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
        message: 'The work item relationship must be repaired',
      });
    }
    if (
      dto.beforeRecordId === recordSnapshot.id ||
      dto.afterRecordId === recordSnapshot.id ||
      (dto.beforeRecordId && dto.beforeRecordId === dto.afterRecordId)
    ) {
      throw new BadRequestException('Invalid record ordering anchors');
    }

    const { database, record, recordPage, updatedRecord } = await executeTx(
      this.db,
      async (trx) => {
        const hostPage = await this.pageRepo.findById(databaseSnapshot.pageId, {
          trx,
          withLock: true,
        });
        const recordPage = await this.pageRepo.findById(
          recordSnapshot.pageId!,
          {
            trx,
            withLock: true,
          },
        );
        if (
          !hostPage ||
          hostPage.deletedAt ||
          hostPage.id !== databaseSnapshot.pageId ||
          hostPage.workspaceId !== user.workspaceId ||
          hostPage.workspaceId !== databaseSnapshot.workspaceId ||
          hostPage.spaceId !== databaseSnapshot.spaceId
        ) {
          throw new NotFoundException('Page not found');
        }
        if (!recordPage || recordPage.deletedAt) {
          throw new NotFoundException('Record page not found');
        }
        if (
          recordPage.workspaceId !== hostPage.workspaceId ||
          recordPage.spaceId !== hostPage.spaceId ||
          recordPage.id === hostPage.id ||
          recordPage.parentPageId !== hostPage.id
        ) {
          throw new ConflictException({
            code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
            message: 'The work item relationship must be repaired',
          });
        }
        await this.pageAccessService.validateCanEdit(hostPage, user);
        await this.pageAccessService.validateCanEdit(recordPage, user);

        const database = await this.databaseRepo.findById(
          databaseSnapshot.id,
          trx,
          true,
        );
        if (
          !database ||
          database.pageId !== hostPage.id ||
          database.workspaceId !== hostPage.workspaceId ||
          database.spaceId !== hostPage.spaceId
        ) {
          throw new NotFoundException('Database not found');
        }
        const record = await this.databaseRepo.findDatabaseRecord(
          database.id,
          recordSnapshot.id,
          trx,
          true,
        );
        if (!record) throw new NotFoundException('Record not found');
        if (record.pageId !== recordPage.id) {
          throw new ConflictException({
            code: 'DATABASE_RECORD_CHANGED_RETRY',
            message: 'The work item changed while it was reordered; retry',
          });
        }

        const beforeRecord = dto.beforeRecordId
          ? await this.databaseRepo.findDatabaseRecord(
              database.id,
              dto.beforeRecordId,
              trx,
              true,
            )
          : undefined;
        const afterRecord = dto.afterRecordId
          ? await this.databaseRepo.findDatabaseRecord(
              database.id,
              dto.afterRecordId,
              trx,
              true,
            )
          : undefined;
        if (
          (dto.beforeRecordId && !beforeRecord) ||
          (dto.afterRecordId && !afterRecord)
        ) {
          throw new ConflictException({
            code: 'DATABASE_REORDER_TARGET_CHANGED_RETRY',
            message: 'The board order changed while it was reordered; retry',
          });
        }
        const sortOrder = generateJitteredKeyBetween(
          afterRecord?.sortOrder ?? null,
          beforeRecord?.sortOrder ?? null,
        );
        return {
          database,
          record,
          recordPage,
          updatedRecord: await this.databaseRepo.updateDatabaseRecordSort(
            database.id,
            record.id,
            sortOrder,
            user.id,
            trx,
          ),
        };
      },
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

    return this.normalizeNativeRecordForList(
      database,
      updatedRecord,
      recordPage,
      true,
    );
  }

  async attachPage(dto: AttachDatabasePageDto, user: User) {
    let database = await this.getAuthorizedDatabase(
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
    let page = await this.pageRepo.findById(dto.pageId, {
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
        await this.pageService.lockPageTreeSpacesForUpdate(
          [
            ...new Set(
              [page.spaceId, database.spaceId, sourceDatabase?.spaceId].filter(
                (spaceId): spaceId is string => Boolean(spaceId),
              ),
            ),
          ],
          trx,
        );

        const lockedPages = new Map<string, Page>();
        const hostPageIdsToLock = [database.pageId, sourceDatabase?.pageId]
          .filter((pageId): pageId is string => Boolean(pageId))
          .filter((pageId, index, pageIds) => pageIds.indexOf(pageId) === index)
          .sort();
        const pageIdsToLock = [
          ...hostPageIdsToLock,
          ...(hostPageIdsToLock.includes(page.id) ? [] : [page.id]),
        ];
        for (const pageId of pageIdsToLock) {
          const lockedPage = await this.pageRepo.findById(pageId, {
            includeTextContent: pageId === page.id,
            trx,
            withLock: true,
          });
          if (!lockedPage || lockedPage.deletedAt) {
            throw new NotFoundException('Page not found');
          }
          lockedPages.set(pageId, lockedPage);
        }

        const lockedPage = lockedPages.get(page.id);
        const targetHostPage = lockedPages.get(database.pageId);
        if (
          !lockedPage ||
          !targetHostPage ||
          lockedPage.workspaceId !== database.workspaceId ||
          lockedPage.spaceId !== page.spaceId ||
          targetHostPage.workspaceId !== database.workspaceId ||
          targetHostPage.spaceId !== database.spaceId
        ) {
          throw new ConflictException({
            code: 'DATABASE_PAGE_CHANGED_RETRY',
            message: 'The page changed while it was being moved; retry',
          });
        }
        await this.pageAccessService.validateCanEdit(lockedPage, user);
        if (targetHostPage.id !== lockedPage.id) {
          await this.pageAccessService.validateCanEdit(targetHostPage, user);
        }
        page = lockedPage;

        const lockedDatabaseIds = [database.id, sourceDatabase?.id]
          .filter((id): id is string => Boolean(id))
          .sort();
        const lockedDatabases = new Map<string, DatabaseBlock>();
        for (const lockedDatabaseId of lockedDatabaseIds) {
          const lockedDatabase = await this.databaseRepo.findById(
            lockedDatabaseId,
            trx,
            true,
          );
          if (!lockedDatabase) {
            throw new NotFoundException('Database not found');
          }
          lockedDatabases.set(lockedDatabase.id, lockedDatabase);
        }

        const lockedTargetDatabase = lockedDatabases.get(database.id);
        if (
          !lockedTargetDatabase ||
          lockedTargetDatabase.pageId !== targetHostPage.id ||
          lockedTargetDatabase.spaceId !== targetHostPage.spaceId ||
          lockedTargetDatabase.workspaceId !== targetHostPage.workspaceId
        ) {
          throw new NotFoundException('Database not found');
        }
        database = lockedTargetDatabase;

        if (sourceDatabase) {
          const sourceHostPage = lockedPages.get(sourceDatabase.pageId);
          const lockedSourceDatabase = lockedDatabases.get(sourceDatabase.id);
          if (
            !sourceHostPage ||
            !lockedSourceDatabase ||
            lockedSourceDatabase.pageId !== sourceHostPage.id ||
            lockedSourceDatabase.spaceId !== sourceHostPage.spaceId ||
            lockedSourceDatabase.workspaceId !== sourceHostPage.workspaceId
          ) {
            throw new NotFoundException('Source database not found');
          }
          if (
            sourceHostPage.id !== lockedPage.id &&
            sourceHostPage.id !== targetHostPage.id
          ) {
            await this.pageAccessService.validateCanEdit(sourceHostPage, user);
          }
          sourceDatabase = lockedSourceDatabase;
        }

        const memberships =
          await this.databaseRepo.listActiveDatabaseRecordsByPage(
            page.id,
            trx,
            true,
          );
        if (memberships.length > 1) {
          throw new ConflictException({
            code: 'DATABASE_PAGE_MEMBERSHIP_CONFLICT',
            message: 'The page has conflicting board memberships',
          });
        }

        const currentMembership = memberships[0];
        const sourceFields =
          currentMembership && sourceDatabase
            ? this.projectCompatibleRecordFields(
                sourceDatabase,
                database,
                currentMembership.fields as Record<string, unknown>,
              )
            : {};
        const requestedFields = sourceDatabase
          ? this.getMoveFieldOverrides(database, dto.fields)
          : (dto.fields ?? {});
        const attachmentFields = { ...sourceFields, ...requestedFields };
        validateDatabaseRecordFields(database.fields, attachmentFields);
        await this.validateRecordUserReferences(
          database,
          attachmentFields,
          trx,
        );

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
            attachmentFields,
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

    try {
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
    } catch (error) {
      this.logger.error('Failed to publish database page relocation', error);
    }

    try {
      await this.auditService.log({
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
    } catch (error) {
      this.logger.error('Failed to audit database page attachment', error);
    }
    try {
      await this.notifyDatabaseChanged(database, { records: true });
    } catch (error) {
      this.logger.error('Failed to publish target database update', error);
    }
    if (sourceDatabase && sourceDatabase.id !== database.id) {
      try {
        await this.notifyDatabaseChanged(sourceDatabase, { records: true });
      } catch (error) {
        this.logger.error('Failed to publish source database update', error);
      }
    }

    return this.normalizeNativeRecordForList(
      database,
      attachedRecord,
      page,
      true,
    );
  }

  async detachRecord(dto: DetachDatabaseRecordDto, user: User) {
    await this.getAuthorizedDatabase(dto.databaseId, user, 'edit');
    throw new ConflictException({
      code: 'DATABASE_WORK_ITEM_DETACH_DISABLED',
      message: 'Move the work item to another board or to trash',
    });
  }

  async deleteDatabase(dto: DeleteDatabaseDto, user: User) {
    const result = await executeTx(this.db, (trx) =>
      this.deleteDatabaseInTransaction(dto.databaseId, user, trx, {
        expectedHostPageId: dto.pageId,
        expectedBlockId: dto.blockId,
        includeDeleted: true,
      }),
    );
    if (!result) throw new NotFoundException('Database not found');
    if (!result.alreadyDeleted) {
      await this.finalizeDatabaseDeletion(result);
    }

    return {
      databaseId: result.database.id,
      alreadyDeleted: result.alreadyDeleted,
      workItemCount: result.workItemPageIds.length,
      trashedPageCount: result.trashedPageIds.length,
    };
  }

  async deleteDatabaseFromPageContent(
    databaseId: string,
    sourcePageId: string,
    sourceBlockId: string | undefined,
    user: User,
    trx: KyselyTransaction,
    rejectImplicitDeletion = false,
  ): Promise<(() => Promise<void>) | undefined> {
    if (!sourceBlockId) return undefined;
    const result = await this.deleteDatabaseInTransaction(
      databaseId,
      user,
      trx,
      {
        allowMissing: true,
        expectedHostPageId: sourcePageId,
        expectedBlockId: sourceBlockId,
        rejectImplicitDeletion,
      },
    );
    if (!result) return undefined;

    return () => this.finalizeDatabaseDeletion(result, user);
  }

  private async deleteDatabaseInTransaction(
    databaseId: string,
    user: User,
    trx: KyselyTransaction,
    context: DatabaseDeletionContext,
  ): Promise<DatabaseDeletionResult | undefined> {
    const {
      allowMissing = false,
      expectedHostPageId,
      expectedBlockId,
      includeDeleted = false,
      rejectImplicitDeletion = false,
    } = context;
    const databaseSnapshot = includeDeleted
      ? await this.databaseRepo.findByIdIncludingDeleted(databaseId, trx)
      : await this.databaseRepo.findById(databaseId, trx);
    if (
      !databaseSnapshot ||
      databaseSnapshot.workspaceId !== user.workspaceId
    ) {
      if (allowMissing) return undefined;
      throw new NotFoundException('Database not found');
    }
    if (
      databaseSnapshot.pageId !== expectedHostPageId ||
      databaseSnapshot.blockId !== expectedBlockId
    ) {
      return undefined;
    }
    if (rejectImplicitDeletion) {
      throw new ConflictException({
        code: 'DATABASE_EXPLICIT_DELETE_REQUIRED',
        message: 'Delete the board before removing its content block',
      });
    }

    const hostPage = await this.pageRepo.findById(databaseSnapshot.pageId, {
      trx,
      withLock: true,
    });
    if (
      !hostPage ||
      hostPage.deletedAt ||
      hostPage.workspaceId !== databaseSnapshot.workspaceId ||
      hostPage.spaceId !== databaseSnapshot.spaceId
    ) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(hostPage, user);

    const database = includeDeleted
      ? await this.databaseRepo.findByIdIncludingDeleted(databaseId, trx, true)
      : await this.databaseRepo.findById(databaseId, trx, true);
    if (!database || database.workspaceId !== user.workspaceId) {
      if (allowMissing) return undefined;
      throw new NotFoundException('Database not found');
    }
    if (
      database.pageId !== expectedHostPageId ||
      database.blockId !== expectedBlockId ||
      database.spaceId !== hostPage.spaceId
    ) {
      if (allowMissing) return undefined;
      throw new NotFoundException('Database not found');
    }

    if (database.deletedAt) {
      return {
        database,
        alreadyDeleted: true,
        workItemPageIds: [],
        trashedPageIds: [],
        archivedDatabaseIds: [],
        archivedRecordCount: 0,
      };
    }

    const records = await this.databaseRepo.listDatabaseRecords(
      database.id,
      trx,
      true,
    );
    const workItemPages: Page[] = [];
    for (const record of records) {
      if (!record.pageId || record.pageId === database.pageId) {
        if (this.isNativeDatabase(database)) {
          throw new ConflictException({
            code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
            message: 'The work item relationship must be repaired',
          });
        }
        continue;
      }
      const page = await this.pageRepo.findById(record.pageId, {
        trx,
        withLock: true,
      });
      if (!page || page.deletedAt) continue;
      if (
        page.workspaceId !== database.workspaceId ||
        page.spaceId !== database.spaceId ||
        page.parentPageId !== database.pageId
      ) {
        throw new ConflictException({
          code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
          message: 'The work item relationship must be repaired',
        });
      }
      await this.pageAccessService.validateCanEdit(page, user);
      workItemPages.push(page);
    }

    const trashedPageIds = new Set<string>();
    for (const page of workItemPages) {
      const removedIds = await this.pageRepo.removePage(
        page.id,
        user.id,
        database.workspaceId,
        trx,
        false,
      );
      removedIds.forEach((pageId) => trashedPageIds.add(pageId));
    }

    const archived = await this.databaseRepo.archiveDatabases(
      [database.id],
      user.id,
      trx,
    );

    return {
      database,
      alreadyDeleted: false,
      workItemPageIds: workItemPages.map((page) => page.id),
      trashedPageIds: [...trashedPageIds],
      archivedDatabaseIds: archived.databaseIds,
      archivedRecordCount: archived.recordCount,
    };
  }

  private async finalizeDatabaseDeletion(
    result: DatabaseDeletionResult,
    actor?: User,
  ): Promise<void> {
    try {
      if (result.trashedPageIds.length > 0) {
        this.eventEmitter.emit(EventName.PAGE_SOFT_DELETED, {
          pageIds: result.trashedPageIds,
          workspaceId: result.database.workspaceId,
          databaseInvalidationHandled: true,
        });
      }
    } catch (error) {
      this.logger.error('Failed to emit database deletion events', error);
    }

    const auditPayload = {
      event: AuditEvent.DATABASE_DELETED,
      resourceType: AuditResource.PAGE,
      resourceId: result.database.pageId,
      spaceId: result.database.spaceId,
      changes: {
        before: {
          databaseId: result.database.id,
          title: result.database.title,
          template: result.database.template,
        },
      },
      metadata: {
        databaseId: result.database.id,
        databasePageId: result.database.pageId,
        workItemCount: result.workItemPageIds.length,
        trashedPageCount: result.trashedPageIds.length,
        archivedDatabaseCount: result.archivedDatabaseIds.length,
        archivedRecordCount: result.archivedRecordCount,
        provider: this.getMetadata(result.database.metadata).provider,
        externalDataPreserved: !this.isNativeDatabase(result.database),
      },
    };
    try {
      if (actor) {
        await this.auditService.logWithContext(auditPayload, {
          workspaceId: result.database.workspaceId,
          actorId: actor.id,
          actorType: 'user',
        });
      } else {
        await this.auditService.log(auditPayload);
      }
    } catch (error) {
      this.logger.error('Failed to audit database deletion', error);
    }

    try {
      await this.notifyDatabaseChanged(result.database, {
        info: true,
        records: true,
        treeMetadata: true,
      });
    } catch (error) {
      this.logger.error('Failed to publish database deletion', error);
    }
  }

  async trashRecordPage(dto: TrashDatabaseRecordPageDto, user: User) {
    const databaseSnapshot = await this.getAuthorizedDatabase(
      dto.databaseId,
      user,
      'edit',
    );
    const recordSnapshot = await this.databaseRepo.findDatabaseRecord(
      databaseSnapshot.id,
      dto.recordId,
    );
    if (!recordSnapshot) throw new NotFoundException('Record not found');
    if (!recordSnapshot.pageId) {
      throw new ConflictException({
        code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
        message: 'The work item relationship must be repaired',
      });
    }

    const result = await executeTx(this.db, async (trx) => {
      const hostPage = await this.pageRepo.findById(databaseSnapshot.pageId, {
        trx,
        withLock: true,
      });
      if (
        !hostPage ||
        hostPage.deletedAt ||
        hostPage.id !== databaseSnapshot.pageId ||
        hostPage.workspaceId !== user.workspaceId ||
        hostPage.workspaceId !== databaseSnapshot.workspaceId ||
        hostPage.spaceId !== databaseSnapshot.spaceId
      ) {
        throw new NotFoundException('Page not found');
      }
      await this.pageAccessService.validateCanEdit(hostPage, user);

      const recordPage = await this.pageRepo.findById(recordSnapshot.pageId!, {
        trx,
        withLock: true,
      });
      if (!recordPage) {
        throw new ConflictException({
          code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
          message: 'The work item relationship must be repaired',
        });
      }
      if (
        recordPage.workspaceId !== hostPage.workspaceId ||
        recordPage.spaceId !== hostPage.spaceId ||
        recordPage.id === hostPage.id ||
        recordPage.parentPageId !== hostPage.id
      ) {
        throw new ConflictException({
          code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
          message: 'The work item relationship must be repaired',
        });
      }

      const database = await this.databaseRepo.findById(
        databaseSnapshot.id,
        trx,
        true,
      );
      if (
        !database ||
        database.pageId !== hostPage.id ||
        database.workspaceId !== hostPage.workspaceId ||
        database.spaceId !== hostPage.spaceId
      ) {
        throw new NotFoundException('Database not found');
      }
      const record = await this.databaseRepo.findDatabaseRecord(
        database.id,
        recordSnapshot.id,
        trx,
        true,
      );
      if (!record) throw new NotFoundException('Record not found');
      if (record.pageId !== recordPage.id) {
        throw new ConflictException({
          code: 'DATABASE_RECORD_CHANGED_RETRY',
          message: 'The work item changed while it was moved to trash; retry',
        });
      }

      const alreadyTrashed = Boolean(recordPage.deletedAt);
      if (!alreadyTrashed) {
        await this.pageAccessService.validateCanEdit(recordPage, user);
      }
      const trashedPageIds = alreadyTrashed
        ? []
        : await this.pageRepo.removePage(
            recordPage.id,
            user.id,
            database.workspaceId,
            trx,
            false,
          );

      return { database, record, recordPage, alreadyTrashed, trashedPageIds };
    });
    const { database, record, recordPage, alreadyTrashed, trashedPageIds } =
      result;

    if (trashedPageIds.length > 0) {
      try {
        this.eventEmitter.emit(EventName.PAGE_SOFT_DELETED, {
          pageIds: trashedPageIds,
          workspaceId: database.workspaceId,
          databaseInvalidationHandled: true,
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit database record page deletion',
          error,
        );
      }
    }

    if (!alreadyTrashed) {
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
    }

    return {
      recordId: record.id,
      pageId: record.pageId,
      trashedPageId: alreadyTrashed ? null : recordPage.id,
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

  private async lockAuthorizedDatabaseForEdit(
    database: DatabaseBlock,
    user: User,
    trx: KyselyTransaction,
  ): Promise<{ database: DatabaseBlock; hostPage: Page }> {
    const hostPage = await this.pageRepo.findById(database.pageId, {
      trx,
      withLock: true,
    });
    if (
      !hostPage ||
      hostPage.deletedAt ||
      hostPage.id !== database.pageId ||
      hostPage.workspaceId !== user.workspaceId ||
      hostPage.workspaceId !== database.workspaceId ||
      hostPage.spaceId !== database.spaceId
    ) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(hostPage, user);

    const lockedDatabase = await this.databaseRepo.findById(
      database.id,
      trx,
      true,
    );
    if (
      !lockedDatabase ||
      lockedDatabase.workspaceId !== hostPage.workspaceId ||
      lockedDatabase.spaceId !== hostPage.spaceId ||
      lockedDatabase.pageId !== hostPage.id
    ) {
      throw new NotFoundException('Database not found');
    }

    return { database: lockedDatabase, hostPage };
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

  private resolveViewGroupBy(
    database: Pick<DatabaseBlock, 'fields'>,
    viewType: string,
    requestedGroupBy?: string,
  ): string | undefined {
    const fields = this.getFields(database.fields);
    const requestedName = requestedGroupBy?.trim();
    const defaultField =
      viewType === 'kanban'
        ? fields.find((field) =>
            ['status', 'singleSelect'].includes(field.type),
          )
        : undefined;
    const field = requestedName
      ? fields.find((candidate) => candidate.name === requestedName)
      : defaultField;

    if (!field) {
      if (viewType === 'kanban' || requestedName) {
        throw new BadRequestException({
          code: 'DATABASE_VIEW_GROUP_FIELD_INVALID',
          message: 'The view group field does not exist',
        });
      }
      return undefined;
    }

    if (
      viewType === 'kanban' &&
      !['status', 'singleSelect'].includes(field.type)
    ) {
      throw new BadRequestException({
        code: 'DATABASE_VIEW_GROUP_FIELD_INVALID',
        message: 'A board must be grouped by a single-select field',
      });
    }
    if (['calendar', 'timeline'].includes(viewType) && field.type !== 'date') {
      throw new BadRequestException({
        code: 'DATABASE_VIEW_GROUP_FIELD_INVALID',
        message: 'This view must use a date field',
      });
    }

    return field.name;
  }

  private normalizeFieldOptions(options: string[]): string[] {
    const normalized = options.map((option) => option.trim());
    if (normalized.some((option) => !option)) {
      throw new BadRequestException({
        code: 'DATABASE_FIELD_OPTION_INVALID',
        message: 'Field options cannot be empty',
      });
    }
    if (new Set(normalized).size !== normalized.length) {
      throw new BadRequestException({
        code: 'DATABASE_FIELD_OPTION_DUPLICATE',
        message: 'Field options must be unique',
      });
    }
    return normalized;
  }

  private assertFieldOptionsSupported(
    fieldType: DatabaseFieldType,
    options?: string[],
  ) {
    if (
      options === undefined ||
      ['status', 'singleSelect', 'multiSelect'].includes(fieldType)
    ) {
      return;
    }
    throw new BadRequestException({
      code: 'DATABASE_FIELD_OPTIONS_UNSUPPORTED',
      message: 'This database field type does not support options',
    });
  }

  private getLegacyMetadataRecords(database: { metadata: unknown }) {
    const metadata = this.getMetadata(database.metadata);
    return Array.isArray(metadata.records) ? metadata.records : [];
  }

  private async updateLegacyMetadataRecord(
    database: Pick<
      DatabaseBlock,
      'id' | 'metadata' | 'fields' | 'views' | 'activeViewId'
    >,
    recordId: string,
    fields: Record<string, unknown>,
    userId: string,
    trx?: KyselyTransaction,
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
      trx,
    );

    return normalizeApitableRecord(
      nextRecords[index],
      getPrimaryDatabaseFieldName(database.fields),
      this.getDatabaseStatusFieldName(database),
    );
  }

  private getMetadata(metadata: unknown): DatabaseMetadata {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as DatabaseMetadata;
    }
    return {};
  }

  private transformLegacyMetadataRecordFields(
    database: { metadata: unknown },
    transform: (fields: Record<string, unknown>) => Record<string, unknown>,
  ) {
    const metadata = this.getMetadata(database.metadata);
    const records = Array.isArray(metadata.records) ? metadata.records : [];
    let changedRecordCount = 0;
    const nextRecords = records.map((record) => {
      const fields =
        record.fields &&
        typeof record.fields === 'object' &&
        !Array.isArray(record.fields)
          ? (record.fields as Record<string, unknown>)
          : {};
      const nextFields = transform(fields);
      if (nextFields === fields) return record;
      changedRecordCount += 1;
      return { ...record, fields: nextFields };
    });

    return {
      changedRecordCount,
      metadata:
        changedRecordCount > 0
          ? { ...metadata, records: nextRecords }
          : metadata,
    };
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

  private assertNativeSchemaMutation(
    database: Pick<DatabaseBlock, 'metadata' | 'apitableDatasheetId'>,
  ) {
    if (this.isNativeDatabase(database)) return;
    throw new ConflictException({
      code: 'DATABASE_EXTERNAL_SCHEMA_MANAGED_BY_PROVIDER',
      message:
        'External database fields must be changed in the source provider',
    });
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
      this.getDatabaseStatusFieldName(database),
    );
  }

  private getDatabaseStatusFieldName(
    database: Pick<DatabaseBlock, 'views' | 'activeViewId'>,
  ) {
    const views = this.getViews(database.views);
    const activeView = views.find((view) => view.id === database.activeViewId);
    return (
      (activeView?.type === 'kanban' ? activeView.groupBy : undefined) ??
      views.find((view) => view.type === 'kanban')?.groupBy ??
      'Status'
    );
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
    lockedParentPage?: Page,
  ): Promise<Page> {
    const parentPageId = database.pageId;
    const parentPage =
      lockedParentPage ??
      (await this.pageRepo.findById(parentPageId, {
        trx,
        withLock: Boolean(trx),
      }));
    if (
      !parentPage ||
      parentPage.deletedAt ||
      parentPage.id !== parentPageId ||
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

  private projectCompatibleRecordFields(
    sourceDatabase: Pick<DatabaseBlock, 'fields'>,
    targetDatabase: Pick<DatabaseBlock, 'fields'>,
    sourceValues: Record<string, unknown>,
  ) {
    const sourceFields = new Map(
      this.getFields(sourceDatabase.fields).map((field) => [field.name, field]),
    );
    const projected: Record<string, unknown> = {};

    for (const targetField of this.getFields(targetDatabase.fields)) {
      if (targetField.isPrimary) continue;
      const sourceField = sourceFields.get(targetField.name);
      if (!sourceField || sourceField.type !== targetField.type) continue;
      if (
        !Object.prototype.hasOwnProperty.call(sourceValues, targetField.name)
      ) {
        continue;
      }

      const value = sourceValues[targetField.name];
      try {
        validateDatabaseRecordFields(targetDatabase.fields, {
          [targetField.name]: value,
        });
        projected[targetField.name] = value;
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
      }
    }

    return projected;
  }

  private getMoveFieldOverrides(
    database: Pick<DatabaseBlock, 'views'>,
    requestedFields?: Record<string, unknown>,
  ) {
    if (!requestedFields) return {};
    const allowedFields = new Set(
      this.getViews(database.views)
        .filter((view) => view.type === 'kanban' && view.groupBy)
        .map((view) => view.groupBy as string),
    );
    const unsupportedField = Object.keys(requestedFields).find(
      (fieldName) => !allowedFields.has(fieldName),
    );
    if (unsupportedField) {
      throw new ConflictException({
        code: 'DATABASE_MOVE_FIELD_OVERRIDE_UNSUPPORTED',
        message:
          'Only target board group fields can be overridden while moving a work item',
        field: unsupportedField,
      });
    }
    return requestedFields;
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

    try {
      await this.wsTreeService.notifyPageQueriesInvalidated(
        { id: database.pageId, spaceId: database.spaceId },
        invalidations,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish database invalidation for ${database.id}`,
        error,
      );
    }
  }

  private async validateRecordUserReferences(
    database: Pick<DatabaseBlock, 'fields' | 'workspaceId'>,
    fields: Record<string, unknown>,
    trx?: KyselyTransaction,
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
        trx,
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
      'checkbox',
      'url',
      'email',
      'phone',
      'id',
    ];

    if (!supportedTypes.includes(type as DatabaseFieldType)) {
      throw new BadRequestException({
        code: 'DATABASE_FIELD_TYPE_UNSUPPORTED',
        message: 'This database field type is not supported yet',
      });
    }
    return type as DatabaseFieldType;
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
