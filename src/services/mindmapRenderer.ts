// Mermaid is loaded only when a non-empty diagram is opened. Keep initialization
// and rendering in the same queue because Mermaid's configuration is global.
let renderQueue: Promise<unknown> = Promise.resolve();
let sequence = 0;
let zenUmlRegistered = false;

export type MindmapThemeId = 'redux' | 'ocean' | 'forest' | 'sunset' | 'slate';

export interface MindmapThemeMeta {
  id: MindmapThemeId;
  label: string;
  swatch: string[];
  lightBranches: string[];
  darkBranches: string[];
  primaryBorder: string;
  git0: string;
}

export const MINDMAP_THEMES: MindmapThemeMeta[] = [
  {
    id: 'redux',
    label: 'Redux Color theme',
    swatch: ['#ff3670', '#6366f1', '#06b6d4', '#f59e0b'],
    lightBranches: ['#dbeafe', '#fce7f3', '#ede9fe', '#fef3c7', '#d1fae5', '#e0f2fe'],
    darkBranches: ['#243d60', '#4b3045', '#38345b', '#4b3c28', '#21473f', '#1e3a5f'],
    primaryBorder: '#6366f1',
    git0: '#4f46e5',
  },
  {
    id: 'ocean',
    label: 'Ocean Breeze',
    swatch: ['#0284c7', '#06b6d4', '#3b82f6', '#14b8a6'],
    lightBranches: ['#e0f2fe', '#cffafe', '#dbeafe', '#ccfbf1', '#e0e7ff', '#f0f9ff'],
    darkBranches: ['#0c4a6e', '#164e63', '#1e3a8a', '#134e4a', '#312e81', '#1e293b'],
    primaryBorder: '#0284c7',
    git0: '#0369a1',
  },
  {
    id: 'forest',
    label: 'Emerald Forest',
    swatch: ['#10b981', '#84cc16', '#14b8a6', '#eab308'],
    lightBranches: ['#d1fae5', '#ecfccb', '#ccfbf1', '#fef9c3', '#dcfce7', '#e0f2fe'],
    darkBranches: ['#064e3b', '#365314', '#134e4a', '#422006', '#14532d', '#1e3a5f'],
    primaryBorder: '#10b981',
    git0: '#059669',
  },
  {
    id: 'sunset',
    label: 'Warm Sunset',
    swatch: ['#f43f5e', '#f97316', '#eab308', '#a855f7'],
    lightBranches: ['#ffe4e6', '#ffedd5', '#fef3c7', '#f3e8ff', '#fce7f3', '#fee2e2'],
    darkBranches: ['#4c0519', '#431407', '#451a03', '#3b0764', '#500724', '#450a0a'],
    primaryBorder: '#f43f5e',
    git0: '#e11d48',
  },
  {
    id: 'slate',
    label: 'Minimal Slate',
    swatch: ['#334155', '#64748b', '#94a3b8', '#475569'],
    lightBranches: ['#f1f5f9', '#e2e8f0', '#f8fafc', '#ede9fe', '#e0f2fe', '#f1f5f9'],
    darkBranches: ['#1e293b', '#334155', '#0f172a', '#312e81', '#1e3a5f', '#1e293b'],
    primaryBorder: '#64748b',
    git0: '#334155',
  },
];

export interface MermaidDiagramResult { source: string; diagramType: string; svg: string }

export function validateMermaidSource(source: string): Promise<MermaidDiagramResult> {
  return processDiagram(source, false, false, 'redux');
}

// Retain the existing document API: stored "mindmap" nodes now accept all Mermaid diagrams.
export async function validateMindmapSource(source: string): Promise<string> {
  return (await validateMermaidSource(source)).source;
}
export async function renderMindmap(source: string, dark: boolean, themeId: MindmapThemeId = 'redux'): Promise<string> {
  return (await renderMermaidDiagram(source, dark, themeId)).svg;
}
export function renderMermaidDiagram(source: string, dark: boolean, themeId: MindmapThemeId = 'redux'): Promise<MermaidDiagramResult> {
  return processDiagram(source, dark, true, themeId);
}

function processDiagram(source: string, dark: boolean, render: boolean, themeId: MindmapThemeId): Promise<MermaidDiagramResult> {
  const job = renderQueue.then(async () => {
    const { default: mermaid } = await import('mermaid');
    // ZenUML is the official optional diagram package; load it only for its syntax.
    if (!zenUmlRegistered && /(?:^|\n)\s*zenuml\b/.test(source)) {
      const { default: zenUml } = await import('@mermaid-js/mermaid-zenuml');
      await mermaid.registerExternalDiagrams([zenUml]);
      zenUmlRegistered = true;
    }
    const preset = MINDMAP_THEMES.find(t => t.id === themeId) ?? MINDMAP_THEMES[0];
    const branchColors = dark ? preset.darkBranches : preset.lightBranches;
    const branchTheme = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
      [`cScale${index}`, branchColors[index % branchColors.length]],
      [`cScaleLabel${index}`, dark ? '#e2e8f0' : '#1e293b'],
      [`cScaleInv${index}`, dark ? '#64748b' : '#94a3b8'],
    ]).flat());
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: {
        darkMode: dark,
        primaryColor: branchColors[0],
        primaryTextColor: dark ? '#e2e8f0' : '#1e293b',
        primaryBorderColor: preset.primaryBorder,
        lineColor: dark ? '#64748b' : '#94a3b8',
        git0: preset.git0,
        gitBranchLabel0: '#ffffff',
        ...branchTheme,
      },
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      // Readable defaults for task-heavy charts. Mermaid's source-level config
      // still takes precedence over these host defaults.
      gantt: {
        fontSize: 16,
        sectionFontSize: 16,
        barHeight: 28,
        barGap: 12,
        topPadding: 64,
        leftPadding: 180,
        rightPadding: 80,
      },
      maxTextSize: 50_000,
    });
    if (source.length > 50_000) throw new Error('图表源码超过 50,000 字符，请精简后预览。');
    const parsed = await mermaid.parse(source);
    if (!parsed) throw new Error('未能识别 Mermaid 图表，请检查语法。');
    // ZenUML's Mermaid adapter has a no-op parser; its native SVG renderer validates the syntax.
    if (!render && parsed.diagramType !== 'zenuml') return { source, diagramType: parsed.diagramType, svg: '' };
    const staging = document.createElement('div');
    // Width-dependent diagrams (notably Gantt) measure this container during
    // layout. An auto-sized offscreen div shrinks to SVG's 300px default width;
    // stretching the finished SVG later cannot repair its overlapping labels.
    staging.style.cssText = 'position:absolute;left:-100000px;top:0;width:1200px;pointer-events:none';
    staging.setAttribute('aria-hidden', 'true');
    document.body.appendChild(staging);
    try {
      await document.fonts.ready;
      const { svg } = await mermaid.render(`project-mindmap-${++sequence}`, source, staging);
      return { source, diagramType: parsed.diagramType, svg };
    } finally {
      staging.remove();
    }
  });
  // A syntax error must not prevent later edits from rendering.
  renderQueue = job.catch(() => {});
  return job;
}
