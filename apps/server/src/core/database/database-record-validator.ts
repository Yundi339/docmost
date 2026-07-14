import { BadRequestException } from '@nestjs/common';
import {
  DatabaseFieldDefinition,
  getPrimaryDatabaseFieldName,
  normalizeDatabaseFields,
} from './database.templates';

const MAX_RECORD_FIELDS_BYTES = 256 * 1024;
const MAX_PRIMARY_TEXT_LENGTH = 500;
const MAX_TEXT_LENGTH = 10_000;
const MAX_LONG_TEXT_LENGTH = 100_000;
const MAX_ARRAY_LENGTH = 100;
const UNSAFE_FIELD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export function validateDatabaseFieldName(name: string): void {
  if (UNSAFE_FIELD_NAMES.has(name.toLowerCase())) {
    reject('Database field name is reserved', name);
  }
}

export function validateDatabaseRecordFields(
  schema: unknown,
  fields: Record<string, unknown>,
): void {
  const serialized = JSON.stringify(fields) ?? '';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_FIELDS_BYTES) {
    reject('Record fields exceed the maximum size');
  }

  const definitions = normalizeDatabaseFields(schema);
  const definitionsByName = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );
  const primaryFieldName = getPrimaryDatabaseFieldName(definitions);

  for (const [name, value] of Object.entries(fields)) {
    validateDatabaseFieldName(name);
    const definition = definitionsByName.get(name);
    if (!definition) reject('Unknown database field', name);
    validateFieldValue(definition, value, name === primaryFieldName);
  }
}

function validateFieldValue(
  field: DatabaseFieldDefinition,
  value: unknown,
  isPrimary: boolean,
): void {
  if (value === null || value === undefined) return;

  switch (field.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'id':
    case 'place':
      assertString(
        value,
        field.name,
        isPrimary ? MAX_PRIMARY_TEXT_LENGTH : MAX_TEXT_LENGTH,
      );
      return;
    case 'longText':
      assertString(value, field.name, MAX_LONG_TEXT_LENGTH);
      return;
    case 'singleSelect':
    case 'select':
    case 'status':
      assertString(value, field.name, MAX_TEXT_LENGTH);
      if (field.options?.length && !field.options.includes(value)) {
        reject('Value is not a configured option', field.name);
      }
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        reject('Expected a finite number', field.name);
      }
      return;
    case 'checkbox':
      if (typeof value !== 'boolean') {
        reject('Expected a boolean', field.name);
      }
      return;
    case 'date':
      assertString(value, field.name, 100);
      if (Number.isNaN(Date.parse(value))) {
        reject('Expected a valid date', field.name);
      }
      return;
    case 'multiSelect':
      assertStringArray(value, field.name);
      if (
        field.options?.length &&
        value.some((item) => !field.options?.includes(item))
      ) {
        reject('Value is not a configured option', field.name);
      }
      return;
    case 'user':
    case 'person':
      assertStringArray(value, field.name);
      return;
    case 'attachment':
      if (!Array.isArray(value) || value.length > MAX_ARRAY_LENGTH) {
        reject('Expected an attachment array', field.name);
      }
      return;
    default:
      return;
  }
}

function assertString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): asserts value is string {
  if (typeof value !== 'string') reject('Expected a string', fieldName);
  if (value.length > maxLength) reject('Field value is too long', fieldName);
}

function assertStringArray(
  value: unknown,
  fieldName: string,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_ARRAY_LENGTH ||
    value.some(
      (item) => typeof item !== 'string' || item.length > MAX_TEXT_LENGTH,
    )
  ) {
    reject('Expected an array of strings', fieldName);
  }
}

function reject(message: string, field?: string): never {
  throw new BadRequestException({
    code: 'DATABASE_RECORD_VALIDATION_FAILED',
    message,
    ...(field ? { field } : {}),
  });
}
