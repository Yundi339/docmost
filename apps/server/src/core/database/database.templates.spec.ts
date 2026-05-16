import {
  buildDefaultFieldsForTemplate,
  getDefaultViewsForTemplate,
  normalizeApitableRecord,
} from './database.templates';

describe('database templates', () => {
  it('builds a Notion-like tasks schema with status assignee and due date fields', () => {
    const fields = buildDefaultFieldsForTemplate('tasks');

    expect(fields.map((field) => field.name)).toEqual([
      'Title',
      'Status',
      'Assignee',
      'Due date',
      'Priority',
      'Tags',
      'Description',
    ]);
    expect(fields.find((field) => field.name === 'Status')).toMatchObject({
      type: 'singleSelect',
      options: ['Todo', 'In progress', 'Done'],
    });
    expect(fields.find((field) => field.name === 'Assignee')).toMatchObject({
      type: 'user',
    });
  });

  it('creates table and kanban views for the generic database template', () => {
    expect(getDefaultViewsForTemplate('database')).toEqual([
      { id: 'table', name: 'Table', type: 'table' },
      { id: 'kanban', name: 'Board', type: 'kanban', groupBy: 'Status' },
    ]);
  });

  it('normalizes APITable record fields into a Docmost task card shape', () => {
    const record = normalizeApitableRecord({
      recordId: 'rec_1',
      fields: {
        Title: 'Write launch plan',
        Status: 'In progress',
        Assignee: ['usr_1'],
        'Due date': '2026-06-01',
        Priority: 'High',
        Tags: ['Launch', 'Docs'],
        Description: 'Prepare rollout notes',
      },
    });

    expect(record).toEqual({
      id: 'rec_1',
      title: 'Write launch plan',
      status: 'In progress',
      assigneeIds: ['usr_1'],
      dueDate: '2026-06-01',
      priority: 'High',
      tags: ['Launch', 'Docs'],
      description: 'Prepare rollout notes',
      fields: {
        Title: 'Write launch plan',
        Status: 'In progress',
        Assignee: ['usr_1'],
        'Due date': '2026-06-01',
        Priority: 'High',
        Tags: ['Launch', 'Docs'],
        Description: 'Prepare rollout notes',
      },
    });
  });
});
