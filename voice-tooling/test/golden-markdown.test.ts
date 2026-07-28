// Golden fixtures for deferred markdown constructs (T024).
//
// These fixtures document the ACTUAL behavior of deriveUnits on markdown
// constructs not explicitly exercised by the current corpus: setext headings,
// MDX-style constructs (import/export, JSX), HTML blocks, and list items
// separated by blank lines.
//
// Each test pins the exact unit set D6 produces for each construct. This is
// documenting current behavior, NOT changing the algorithm. If a construct
// splits in a way a human might find surprising (e.g. a loose list splitting
// per item, or a `---` setext underline being treated as separator-like
// content), the test asserts the ACTUAL D6 behavior and explains the outcome
// via comments.

import test from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveUnits } from '@/units/derive.ts';
import type { SourceUnit } from '@/units/derive.ts';
import { readFixture } from './support.ts';

function sha256Hex(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}

test('deriveUnits: setext heading (overline-style with ===) is treated as two regular content lines in the same unit', () => {
  const text = readFixture('sources', 'setext-heading.md');
  const units = deriveUnits(text, 'src-setext-eq');

  // The setext heading line and its === underline have no separator between them,
  // so they form a single unit along with any adjacent non-separator lines.
  // D6 does not recognize setext markup syntax; the === line is just content.
  assert.equal(units.length, 2);
  const [heading, content] = units;
  assert.ok(heading);
  assert.ok(content);

  assert.equal(heading.content, 'Setext Heading\n==============\n');
  assert.equal(content.content, 'Some content after.\n');

  // Verify content_hash with independent oracle
  assert.equal(heading.contentHash, sha256Hex(heading.content));
  assert.equal(content.contentHash, sha256Hex(content.content));
  assert.equal(heading.occurrenceIndex, 0);
  assert.equal(content.occurrenceIndex, 0);
});

test('deriveUnits: setext heading (underline-style with ---) is treated as two regular content lines, NOT as a separator or frontmatter (D6.2)', () => {
  const text = readFixture('sources', 'setext-with-hyphens.md');
  const units = deriveUnits(text, 'src-setext-hyphen');

  // The --- line is NOT a frontmatter delimiter (because there is content before
  // it that isn't at the document start), and it is NOT a separator line (because
  // it contains non-whitespace, the actual hyphens). It is just content.
  // So the setext heading ("Setext Heading\n---\n") is one unit, separated from
  // the "Content before setext" by the blank line, and from "Content after."
  // by another blank line.
  assert.equal(units.length, 3);
  const [before, heading, after] = units;
  assert.ok(before);
  assert.ok(heading);
  assert.ok(after);

  assert.equal(before.content, 'Content before setext\n');
  assert.equal(heading.content, 'Setext Heading\n---\n');
  assert.equal(after.content, 'Content after.\n');

  // Verify content_hash with independent oracle
  assert.equal(before.contentHash, sha256Hex(before.content));
  assert.equal(heading.contentHash, sha256Hex(heading.content));
  assert.equal(after.contentHash, sha256Hex(after.content));
  assert.equal(before.occurrenceIndex, 0);
  assert.equal(heading.occurrenceIndex, 0);
  assert.equal(after.occurrenceIndex, 0);
});

test('deriveUnits: MDX import statement is treated as regular content, not specially recognized', () => {
  const text = readFixture('sources', 'mdx-import.md');
  const units = deriveUnits(text, 'src-mdx-import');

  // The import line has non-whitespace content, so it is not a separator.
  // It is grouped with adjacent non-separator lines before the blank line.
  assert.equal(units.length, 2);
  const [importUnit, content] = units;
  assert.ok(importUnit);
  assert.ok(content);

  assert.equal(importUnit.content, "import { Component } from '@/components';\n");
  assert.equal(content.content, 'Regular markdown text here.\n');

  // Verify content_hash with independent oracle
  assert.equal(importUnit.contentHash, sha256Hex(importUnit.content));
  assert.equal(content.contentHash, sha256Hex(content.content));
  assert.equal(importUnit.occurrenceIndex, 0);
  assert.equal(content.occurrenceIndex, 0);
});

test('deriveUnits: MDX export statement is treated as regular content, not specially recognized', () => {
  const text = readFixture('sources', 'mdx-export.md');
  const units = deriveUnits(text, 'src-mdx-export');

  // The export line has non-whitespace content, so it is not a separator.
  // It is grouped with adjacent non-separator lines before the blank line.
  assert.equal(units.length, 2);
  const [exportUnit, content] = units;
  assert.ok(exportUnit);
  assert.ok(content);

  assert.equal(exportUnit.content, "export const metadata = { title: 'Page' };\n");
  assert.equal(content.content, 'Some content follows.\n');

  // Verify content_hash with independent oracle
  assert.equal(exportUnit.contentHash, sha256Hex(exportUnit.content));
  assert.equal(content.contentHash, sha256Hex(content.content));
  assert.equal(exportUnit.occurrenceIndex, 0);
  assert.equal(content.occurrenceIndex, 0);
});

test('deriveUnits: JSX component tag is treated as regular content, not specially recognized', () => {
  const text = readFixture('sources', 'jsx-component.md');
  const units = deriveUnits(text, 'src-jsx');

  // The <MyComponent /> line has non-whitespace content, so it is not a separator.
  // It is grouped with adjacent non-separator lines before the blank line.
  assert.equal(units.length, 2);
  const [jsxUnit, content] = units;
  assert.ok(jsxUnit);
  assert.ok(content);

  assert.equal(jsxUnit.content, '<MyComponent prop="value" />\n');
  assert.equal(content.content, 'Text following the component.\n');

  // Verify content_hash with independent oracle
  assert.equal(jsxUnit.contentHash, sha256Hex(jsxUnit.content));
  assert.equal(content.contentHash, sha256Hex(content.content));
  assert.equal(jsxUnit.occurrenceIndex, 0);
  assert.equal(content.occurrenceIndex, 0);
});

test('deriveUnits: HTML block tags are treated as regular content lines, not as special markup delimiters', () => {
  const text = readFixture('sources', 'html-block.md');
  const units = deriveUnits(text, 'src-html-block');

  // The <div> and </div> lines have non-whitespace content, so they are not
  // separators. The <p> line inside also has non-whitespace content. All three
  // lines, having no separator between them, form one unit (the HTML block).
  // The blank line after </div> is a separator, so "Regular text after." is
  // a second unit.
  assert.equal(units.length, 2);
  const [htmlUnit, textUnit] = units;
  assert.ok(htmlUnit);
  assert.ok(textUnit);

  assert.equal(
    htmlUnit.content,
    '<div class="container">\n<p>HTML content inside</p>\n</div>\n',
  );
  assert.equal(textUnit.content, 'Regular text after.\n');

  // Verify content_hash with independent oracle
  assert.equal(htmlUnit.contentHash, sha256Hex(htmlUnit.content));
  assert.equal(textUnit.contentHash, sha256Hex(textUnit.content));
  assert.equal(htmlUnit.occurrenceIndex, 0);
  assert.equal(textUnit.occurrenceIndex, 0);
});

test('deriveUnits: HTML block containing blank lines internally splits into separate units (D6.5)', () => {
  const text = readFixture('sources', 'html-with-blank-lines.md');
  const units = deriveUnits(text, 'src-html-blank');

  // Under D6.5, blank lines are separators even inside HTML blocks (there is no
  // "HTML block" exception like there is for fenced code). So the blank lines
  // WITHIN the <div>...</div> cause splits.
  // Line 1: <div class="container">  → unit 1
  // Line 2: (blank) → separator
  // Line 3: <p>HTML with blank line inside</p> → unit 2
  // Line 4: (blank) → separator
  // Line 5: </div> → unit 3
  // Line 6: (blank) → separator
  // Line 7: Regular text. → unit 4
  assert.equal(units.length, 4);
  const [openDiv, pTag, closeDiv, textUnit] = units;
  assert.ok(openDiv);
  assert.ok(pTag);
  assert.ok(closeDiv);
  assert.ok(textUnit);

  assert.equal(openDiv.content, '<div class="container">\n');
  assert.equal(pTag.content, '<p>HTML with blank line inside</p>\n');
  assert.equal(closeDiv.content, '</div>\n');
  assert.equal(textUnit.content, 'Regular text.\n');

  // Verify content_hash with independent oracle
  assert.equal(openDiv.contentHash, sha256Hex(openDiv.content));
  assert.equal(pTag.contentHash, sha256Hex(pTag.content));
  assert.equal(closeDiv.contentHash, sha256Hex(closeDiv.content));
  assert.equal(textUnit.contentHash, sha256Hex(textUnit.content));
  assert.equal(openDiv.occurrenceIndex, 0);
  assert.equal(pTag.occurrenceIndex, 0);
  assert.equal(closeDiv.occurrenceIndex, 0);
  assert.equal(textUnit.occurrenceIndex, 0);
});

test('deriveUnits: list items separated by blank lines (loose list) split into separate units per item (D6.5)', () => {
  const text = readFixture('sources', 'loose-list.md');
  const units = deriveUnits(text, 'src-loose-list');

  // Under D6.5, blank lines are separators. A loose list (with blank lines
  // between items) splits at those separators, yielding one unit per item.
  // This is the D6-defined behavior: markdown semantic grouping (loose vs tight
  // lists) is not recognized; only separator lines matter. A human might expect
  // the three list items to be grouped, but D6 treats each item as a separate
  // unit because blank lines separate them.
  assert.equal(units.length, 3);
  const [item1, item2, item3] = units;
  assert.ok(item1);
  assert.ok(item2);
  assert.ok(item3);

  assert.equal(item1.content, '- Item one\n');
  assert.equal(item2.content, '- Item two\n');
  assert.equal(item3.content, '- Item three\n');

  // Verify content_hash with independent oracle
  assert.equal(item1.contentHash, sha256Hex(item1.content));
  assert.equal(item2.contentHash, sha256Hex(item2.content));
  assert.equal(item3.contentHash, sha256Hex(item3.content));
  assert.equal(item1.occurrenceIndex, 0);
  assert.equal(item2.occurrenceIndex, 0);
  assert.equal(item3.occurrenceIndex, 0);
});
