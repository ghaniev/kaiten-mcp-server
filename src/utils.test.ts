import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAsMarkdown, formatInline, truncateResponse } from './utils.js';

test('a list of objects renders as a list, not as [object Object]', () => {
  // kaiten_get_board prints columns and lanes through this path.
  const markdown = formatAsMarkdown({
    title: 'Flutter WiP',
    columns: [
      { id: 1, title: 'To do', type: 1 },
      { id: 2, title: 'Done', type: 3 },
    ],
    tags: ['a', 'b'],
    empty: [],
  });

  assert.equal(markdown.includes('[object Object]'), false);
  assert.match(markdown, /- id: 1, title: To do, type: 1/);
  assert.match(markdown, /\*\*Tags:\*\* a, b/);
  assert.match(markdown, /\*\*Empty:\*\* —/);
});

test('inline rendering skips empty values and flattens nesting', () => {
  assert.equal(formatInline({ id: 1, title: 'x', gone: null }), 'id: 1, title: x');
  assert.equal(formatInline([1, 2]), '1, 2');
  assert.equal(formatInline(null), '—');
  assert.equal(formatInline('plain'), 'plain');
});

test('truncation says how much was cut instead of trailing off', () => {
  const long = 'x'.repeat(120);
  const cut = truncateResponse(long, 100);
  assert.match(cut, /RESPONSE TRUNCATED/);
  assert.match(cut, /Original length: 120/);
  assert.equal(truncateResponse('short', 100), 'short');
});
