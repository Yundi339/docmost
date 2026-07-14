import { validateDatabaseRecordFields } from './database-record-validator';

const schema = [
  { name: 'Task', type: 'text', isPrimary: true },
  { name: 'Status', type: 'singleSelect', options: ['Todo', 'Done'] },
  { name: 'Estimate', type: 'number' },
  { name: 'Tags', type: 'multiSelect', options: ['security', 'performance'] },
];

describe('validateDatabaseRecordFields', () => {
  it('accepts values matching the database schema', () => {
    expect(() =>
      validateDatabaseRecordFields(schema, {
        Task: 'Ship board ownership',
        Status: 'Todo',
        Estimate: 3,
        Tags: ['security'],
      }),
    ).not.toThrow();
  });

  it('rejects unknown fields and invalid option values', () => {
    expect(() =>
      validateDatabaseRecordFields(schema, { Unknown: true }),
    ).toThrow('Unknown database field');
    expect(() =>
      validateDatabaseRecordFields(schema, { Status: 'Invalid' }),
    ).toThrow('Value is not a configured option');
    expect(() =>
      validateDatabaseRecordFields(schema, { Tags: ['unknown'] }),
    ).toThrow('Value is not a configured option');
  });

  it('rejects oversized primary titles', () => {
    expect(() =>
      validateDatabaseRecordFields(schema, { Task: 'x'.repeat(501) }),
    ).toThrow('Field value is too long');
  });

  it('rejects JavaScript prototype field names', () => {
    expect(() =>
      validateDatabaseRecordFields(
        [{ name: '__proto__', type: 'text' }],
        JSON.parse('{"__proto__":"unsafe"}'),
      ),
    ).toThrow('Database field name is reserved');
  });
});
