import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installTestDom } from './dom';
import { validateMermaidSource } from '../src/services/mindmapRenderer';
import { MERMAID_DIAGRAM_TEMPLATES } from '../src/services/mermaidCatalog';
import { extractMindmapSource } from '../src/services/hermesMindmap';

test('every selectable Mermaid template parses through the official engine', async () => {
  const cleanup = installTestDom();
  try {
    // ZenUML's optional renderer needs a real browser and is covered in the Chromium suite.
    const failures: string[] = [];
    for (const template of MERMAID_DIAGRAM_TEMPLATES.filter(item => item.id !== 'zenuml')) {
      try {
        const parsed = await validateMermaidSource(template.code);
        assert.ok(template.diagramTypes.includes(parsed.diagramType), `${template.id}: ${parsed.diagramType}`);
      } catch (error) { failures.push(`${template.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    assert.deepEqual(failures, []);
  } finally { cleanup(); }
});

test('full procurement flow with YAML, subgraphs, labelled edges and classes is preserved; invalid input does not break later parsing', async () => {
  const cleanup = installTestDom();
  try {
    const source = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/purchase-flowchart.mmd'), 'utf8');
    assert.equal(extractMindmapSource('```mermaid\n' + source + '```'), source.trim());
    assert.equal((await validateMermaidSource(source)).diagramType, 'flowchart-v2');
    assert.equal((await validateMermaidSource(source)).source, source);
    await assert.rejects(validateMermaidSource('flowchart TB\n broken['));
    assert.equal((await validateMermaidSource('graph LR\n A-->B')).diagramType, 'flowchart-v2');
    assert.equal((await validateMermaidSource('sequenceDiagram\n A->>B: Request')).diagramType, 'sequence');
    assert.throws(() => extractMindmapSource('```mermaid\nflowchart LR\n A-->B\n```\n```mermaid\npie\n "X":1\n```'));
  } finally { cleanup(); }
});
