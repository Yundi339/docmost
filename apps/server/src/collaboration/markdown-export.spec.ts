import { htmlToMarkdown } from '@docmost/editor-ext';

describe('Markdown export', () => {
  it('preserves inline formatting inside checked task items', () => {
    const markdown = htmlToMarkdown(`
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="true">
          <label><input type="checkbox" checked=""></label>
          <div>
            <p>Use <code>format</code> and <a href="https://example.com">docs</a></p>
          </div>
        </li>
      </ul>
    `);

    expect(markdown.trim()).toBe(
      '- [x] Use `format` and [docs](https://example.com)',
    );
  });
});
