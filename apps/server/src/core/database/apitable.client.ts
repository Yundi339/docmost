import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import {
  DatabaseFieldDefinition,
  normalizeApitableRecord,
  DocmostDatabaseRecord,
} from './database.templates';
import { v7 as uuid7 } from 'uuid';

interface ApitableResponse<T> {
  success?: boolean;
  code?: number;
  message?: string;
  data?: T;
}

export interface CreatedApitableDatasheet {
  datasheetId: string;
  provider: 'apitable' | 'docmost-native';
}

@Injectable()
export class ApitableClient {
  private readonly logger = new Logger(ApitableClient.name);

  constructor(private readonly environmentService: EnvironmentService) {}

  isConfigured(): boolean {
    return (
      this.environmentService.isApitableEnabled() &&
      Boolean(this.environmentService.getApitableInternalUrl()) &&
      Boolean(this.environmentService.getApitableApiToken())
    );
  }

  async createDatasheet(input: {
    title: string;
    fields: DatabaseFieldDefinition[];
  }): Promise<CreatedApitableDatasheet> {
    if (!this.isConfigured()) {
      return {
        datasheetId: `native_${uuid7()}`,
        provider: 'docmost-native',
      };
    }

    const spaceId = this.environmentService.getApitableSpaceId();
    if (!spaceId) {
      throw new BadRequestException(
        'APITABLE_SPACE_ID is required to create APITable-backed databases',
      );
    }

    const data = await this.request<Record<string, any>>(
      `/fusion/v1/spaces/${encodeURIComponent(spaceId)}/datasheets`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: input.title,
          fields: input.fields.map((field) => this.toApitableField(field)),
        }),
      },
    );

    const datasheetId =
      data?.datasheetId || data?.dstId || data?.nodeId || data?.id;

    if (!datasheetId) {
      this.logger.warn('APITable create datasheet response had no id');
      throw new BadGatewayException('APITable did not return a datasheet id');
    }

    return { datasheetId, provider: 'apitable' };
  }

  async listRecords(datasheetId: string): Promise<DocmostDatabaseRecord[]> {
    if (
      !this.isConfigured() ||
      datasheetId.startsWith('local_') ||
      datasheetId.startsWith('native_')
    ) {
      return [];
    }

    const data = await this.request<Record<string, any>>(
      `/fusion/v1/datasheets/${encodeURIComponent(datasheetId)}/records?pageSize=100`,
      { method: 'GET' },
    );

    const records = data?.records || data?.items || [];
    return records.map((record: Record<string, any>) =>
      normalizeApitableRecord(record),
    );
  }

  async createRecord(
    datasheetId: string,
    fields: Record<string, unknown>,
  ): Promise<DocmostDatabaseRecord> {
    const data = await this.request<Record<string, any>>(
      `/fusion/v1/datasheets/${encodeURIComponent(datasheetId)}/records`,
      {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields }] }),
      },
    );

    const record = data?.records?.[0] || data?.record || data;
    return normalizeApitableRecord(record);
  }

  async updateRecord(
    datasheetId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<DocmostDatabaseRecord> {
    const data = await this.request<Record<string, any>>(
      `/fusion/v1/datasheets/${encodeURIComponent(datasheetId)}/records`,
      {
        method: 'PATCH',
        body: JSON.stringify({ records: [{ recordId, fields }] }),
      },
    );

    const record = data?.records?.[0] || data?.record || { recordId, fields };
    return normalizeApitableRecord(record);
  }

  buildPublicEmbedUrl(datasheetId: string, viewId?: string): string | null {
    const publicUrl = this.environmentService.getApitablePublicUrl();
    if (
      !publicUrl ||
      datasheetId.startsWith('local_') ||
      datasheetId.startsWith('native_')
    ) {
      return null;
    }

    const url = new URL(`/workbench/${datasheetId}`, publicUrl);
    if (viewId) url.searchParams.set('view', viewId);
    return url.toString();
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const baseUrl = this.environmentService.getApitableInternalUrl();
    const token = this.environmentService.getApitableApiToken();
    const url = new URL(path, baseUrl);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      this.logger.warn(`APITable request failed: ${String(error)}`);
      throw new BadGatewayException('APITable is not reachable');
    }

    let payload: ApitableResponse<T> | T | undefined;
    try {
      payload = (await response.json()) as ApitableResponse<T> | T;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      throw new BadGatewayException(`APITable request failed with ${response.status}`);
    }

    if (
      payload &&
      typeof payload === 'object' &&
      'success' in payload &&
      payload.success === false
    ) {
      throw new BadGatewayException('APITable rejected the request');
    }

    if (payload && typeof payload === 'object' && 'data' in payload) {
      return (payload as ApitableResponse<T>).data as T;
    }

    return payload as T;
  }

  private toApitableField(field: DatabaseFieldDefinition) {
    switch (field.type) {
      case 'select':
      case 'singleSelect':
      case 'status':
        return {
          name: field.name,
          type: 'SingleSelect',
          property: { options: (field.options ?? []).map((name) => ({ name })) },
        };
      case 'multiSelect':
        return {
          name: field.name,
          type: 'MultiSelect',
          property: { options: (field.options ?? []).map((name) => ({ name })) },
        };
      case 'date':
        return {
          name: field.name,
          type: 'DateTime',
          property: { includeTime: false },
        };
      case 'number':
        return { name: field.name, type: 'Number' };
      case 'checkbox':
        return { name: field.name, type: 'Checkbox' };
      case 'url':
        return { name: field.name, type: 'URL' };
      case 'email':
        return { name: field.name, type: 'Email' };
      case 'phone':
        return { name: field.name, type: 'Phone' };
      case 'attachment':
        return { name: field.name, type: 'Attachment' };
      case 'formula':
        return { name: field.name, type: 'Formula' };
      case 'id':
        return { name: field.name, type: 'AutoNumber' };
      case 'relation':
      case 'rollup':
      case 'button':
      case 'place':
      case 'longText':
        return { name: field.name, type: 'Text' };
      case 'person':
      case 'user':
        // Docmost owns user identity in the first fusion layer. Store user ids as
        // text unless a later APITable unit mapping is configured.
        return { name: field.name, type: 'Text' };
      case 'text':
      default:
        return { name: field.name, type: 'SingleText' };
    }
  }
}
