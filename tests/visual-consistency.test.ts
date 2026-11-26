import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectPayload } from '../src/services/projectStorage';
import { analyzeVisualConsistency } from '../src/proto/theme/visualConsistency';
import { projectExecutionBrief } from '../src/services/projectKnowledge';
import { MATERIAL_GENERATION_RULES } from '../src/proto/ai/materialInstructions';
import { getImplementationGuide } from '../src/proto/ai/implementationGuide';
import { createLocalAuthoringWorkspace } from '../src/mcp/authoringWorkspace';
import { handleSpecMcpPayload } from '../src/mcp/protocol';

function makeHybridSnapshot(sources: Record<string, { title: string; tsx: string }>) {
  const payload = createProjectPayload({
    projectId: 'proj-visual-test',
    projectName: '同源视觉测试工程',
    projectMode: 'hybrid',
    templateId: 'blank_project',
    storageDir: '/tmp',
    fileName: 'visual.pflow',
    createdAt: '2026-11-26',
    updatedAt: '2026-11-26',
    pageCount: 0,
    tableCount: 0,
    stickyCount: 0,
  });
  const s = payload.stateSnapshot;
  s.designerFolders = [{ id: 'f_main', title: '主目录', parentFolderId: null }];
  s.designerPages = Object.entries(sources).map(([pageId, item]) => ({
    pageId,
    title: item.title,
    folderId: 'f_main',
  }));
  s.pageSources = Object.fromEntries(
    Object.entries(sources).map(([pageId, item]) => [pageId, item.tsx]),
  );
  return payload;
}

test('analyzeVisualConsistency produces zero warnings for unstyled default desktop + mobile pages', () => {
  const payload = makeHybridSnapshot({
    p_pc: {
      title: '桌面列表',
      tsx: 'export default function Page() { return (<Page pfId="r1" title="桌面列表"><Text pfId="t1">A</Text></Page>); }',
    },
    p_mob: {
      title: '移动首页',
      tsx: 'export default function Page() { return (<MobilePage pfId="r2" title="移动首页"><MTopBar pfId="tb1" title="首页" /></MobilePage>); }',
    },
  });
  const res = analyzeVisualConsistency(payload.stateSnapshot);
  assert.equal(res.established, false);
  assert.equal(res.pages.length, 2);
  assert.deepEqual(res.warnings, []);
});

test('analyzeVisualConsistency recognizes cohesive Mist + Obsidian across PC & Mobile and cross-platform Indigo/Gemini pairs', () => {
  const obsidianSuite = makeHybridSnapshot({
    p_dash: {
      title: '运营看板',
      tsx: 'export default function Page() { return (<Page pfId="r1" title="运营看板" appearance="light" surfaceBg="mist" accent="obsidian" motion="smooth"><AiCopilotCard pfId="ai1" tone="indigo" /></Page>); }',
    },
    p_wb: {
      title: '工单工作台',
      tsx: 'export default function Page() { return (<Page pfId="r2" title="工单工作台" appearance="light" surfaceBg="mist" accent="obsidian" motion="smooth"><Text pfId="t2">B</Text></Page>); }',
    },
    p_mob_wallet: {
      title: '随车备件库',
      tsx: 'export default function Page() { return (<MobilePage pfId="r3" title="随车备件库" appearance="light" surfaceBg="mist" accent="obsidian" motion="smooth"><MAiInsightCard pfId="mai1" tone="glow" /></MobilePage>); }',
    },
  });
  const res = analyzeVisualConsistency(obsidianSuite.stateSnapshot);
  assert.equal(res.established, true);
  assert.deepEqual(res.dominant, {
    appearance: 'light',
    desktopSurfaceBg: 'mist',
    mobileSurfaceBg: 'mist',
    desktopAccent: 'obsidian',
    mobileAccent: 'obsidian',
    motion: 'smooth',
  });
  assert.deepEqual(res.warnings, []);

  // Cross-platform equivalent pair: Desktop aurora + indigo paired with Mobile mist + gemini
  const auroraIndigoPair = makeHybridSnapshot({
    p_pc: {
      title: 'AI 工作台',
      tsx: 'export default function Page() { return (<Page pfId="r1" title="AI 工作台" appearance="light" surfaceBg="aurora" accent="indigo"><Text pfId="t1">PC</Text></Page>); }',
    },
    p_mob: {
      title: 'AI 随行端',
      tsx: 'export default function Page() { return (<MobilePage pfId="r2" title="AI 随行端" appearance="light" surfaceBg="mist" accent="gemini"><MTopBar pfId="tb1" title="AI" /></MobilePage>); }',
    },
  });
  assert.deepEqual(analyzeVisualConsistency(auroraIndigoPair.stateSnapshot).warnings, []);
});

test('analyzeVisualConsistency catches patchwork accent, surface, light/dark split, and dark_brief chromatic clash', () => {
  const patchwork = makeHybridSnapshot({
    p1: {
      title: '看板页',
      tsx: 'export default function Page() { return (<Page pfId="r1" title="看板页" appearance="light" surfaceBg="mist" accent="obsidian"><AiCopilotCard pfId="ai1" tone="dark_brief" /></Page>); }',
    },
    p2: {
      title: '工作台',
      tsx: 'export default function Page() { return (<Page pfId="r2" title="工作台" appearance="light" surfaceBg="sage_field" accent="lime_forest"><Text pfId="t2">B</Text></Page>); }',
    },
    p3: {
      title: '排期雷达',
      tsx: 'export default function Page() { return (<MobilePage pfId="r3" title="排期雷达" appearance="dark" surfaceBg="oled_carbon" accent="emerald"><MTopBar pfId="tb3" title="雷达" /></MobilePage>); }',
    },
  });

  const res = analyzeVisualConsistency(patchwork.stateSnapshot);
  const codes = res.warnings.map((w) => w.code);
  assert.ok(codes.includes('dark-brief-clash'), 'must flag forest-lime dark_brief on cool obsidian+mist page');
  assert.ok(codes.includes('accent-drift'), 'must flag multi-brand accent patchwork');
  assert.ok(codes.includes('surface-drift'), 'must flag multi-surface patchwork');
  assert.ok(codes.includes('appearance-drift'), 'must flag light vs dark split across sibling pages');

  const brief = projectExecutionBrief(patchwork.stateSnapshot);
  assert.equal(brief.visualBaseline.established, true);
  assert.equal(brief.visualBaseline.warnings.length, res.warnings.length);
  assert.ok(!JSON.stringify(brief).includes('export default'));
});

test('MCP overview, audit, and generation instructions surface visualBaseline and visualConsistencyWarnings', async () => {
  assert.ok(MATERIAL_GENERATION_RULES.includes('全工程同源视觉铁律'));
  const guide = getImplementationGuide(['layout', 'mobile']);
  assert.ok(JSON.stringify(guide).includes('全工程同源视觉铁律'));
  assert.ok(JSON.stringify(guide).includes('visualBaseline.dominant'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoflow-visual-mcp-'));
  try {
    const loader = createLocalAuthoringWorkspace({ workspaceDir: tmpDir });
    const call = async (name: string, args: Record<string, unknown>) => {
      const rpc = await handleSpecMcpPayload(loader, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      assert.ok(rpc && !Array.isArray(rpc) && !rpc.error, `RPC failed for ${name}`);
      const res = rpc.result as { isError?: boolean; content: { text: string }[] };
      assert.notEqual(res.isError, true, `Tool ${name} error: ${res.content?.[0]?.text}`);
      return JSON.parse(res.content[0].text);
    };

    await call('protoflow_workspace', {
      action: 'create_project',
      filePath: 'visual-suite.pflow',
      projectName: '同源视觉闭环套件',
      projectMode: 'hybrid',
    });
    await call('protoflow_manage_sitemap', {
      action: 'upsert_folder',
      folder: { id: 'f_ops', title: '运营中心', parentFolderId: null },
    });
    await call('protoflow_write_page', {
      pageId: 'p_one',
      title: '总览看板',
      folderId: 'f_ops',
      platform: 'desktop',
      source: 'export default function Page() { return (<Page pfId="r1" title="总览看板" appearance="light" surfaceBg="mist" accent="obsidian"><Text pfId="t1">总览</Text></Page>); }',
    });

    const overview1 = await call('protoflow_get_project_overview', {});
    assert.equal(overview1.visualBaseline.established, true);
    assert.equal(overview1.visualBaseline.dominant.desktopAccent, 'obsidian');
    assert.equal(overview1.visualBaseline.dominant.mobileAccent, 'obsidian');

    // Introduce a diverging mobile page
    await call('protoflow_write_page', {
      pageId: 'p_two',
      title: '移动排期',
      folderId: 'f_ops',
      platform: 'mobile',
      source: 'export default function Page() { return (<MobilePage pfId="r2" title="移动排期" appearance="dark" surfaceBg="oled_carbon" accent="emerald"><MTopBar pfId="tb2" title="排期" /></MobilePage>); }',
    });

    const auditDrift = await call('protoflow_audit_project', {});
    assert.equal(auditDrift.healthy, true, 'visual drift warnings stay advisory and do not block healthy');
    assert.ok(auditDrift.summary.visualConsistencyWarnings >= 3);
    assert.ok(auditDrift.visualConsistencyWarnings.some((w: { code: string }) => w.code === 'accent-drift'));

    // Align the mobile page with visualBaseline.dominant
    await call('protoflow_write_page', {
      pageId: 'p_two',
      title: '移动排期',
      folderId: 'f_ops',
      platform: 'mobile',
      source: 'export default function Page() { return (<MobilePage pfId="r2" title="移动排期" appearance="light" surfaceBg="mist" accent="obsidian"><MTopBar pfId="tb2" title="排期" /></MobilePage>); }',
    });

    const auditClean = await call('protoflow_audit_project', {});
    assert.equal(auditClean.healthy, true);
    assert.equal(auditClean.summary.visualConsistencyWarnings, 0);
    assert.deepEqual(auditClean.visualConsistencyWarnings, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
