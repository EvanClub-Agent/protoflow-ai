// Axure RP 9 and 11 fields verified against native projects, Axure's published
// tutorial files and zee-rp's rp-read.mjs (see public/licenses/zee-rp.txt).
import { field, Graph, list, RpArchive, type RpObject, type Value } from './binary';
import { PageClickTargets, readClick } from './interactions';
import { part, documentDefaults, diagramStyles, vectorPath, cellEdges } from './style';
import type { DesignerPage } from '../store/usePageStore';
import type { DesignerFolder } from '../sitemap';
import { printPageSource } from '../dsl/printer';
import type { ProtoNode } from '../types';

interface PageInfo { guid: string; pageId: string; title: string; folderId: string }
export interface AxureImport {
  version: RpArchive['version'];
  designerFolders: DesignerFolder[];
  designerPages: DesignerPage[];
  pageSources: Record<string, string>;
  report: { title: string; widgets: number; links: number; clicks: number; warnings: string[] }[];
}

const pageId = (guid: string) => `rp-page-${guid}`;

function readSitemap(graph: Graph) {
  const folders: DesignerFolder[] = [{ id: 'rp-root', title: 'Axure 页面', parentFolderId: null }];
  const pages: PageInfo[] = [];
  const titles = new Map<string, string>();
  for (const ref of list(field(graph.root.body, 'PackageInfos'))) {
    const info = graph.object(ref);
    const packageId = field(info.body, 'package-id');
    if (packageId?.tag !== 19 || !packageId.pair) throw new Error('工程包标识格式无效');
    const pair = packageId.pair;
    if (graph.string(pair[0]) !== 'Axure:Page') continue;
    const guid = graph.guid(pair[1]);
    const title = field(info.body, 'package-name')?.text;
    if (!title?.trim() || titles.has(guid)) throw new Error('页面名称缺失或 GUID 重复');
    titles.set(guid, title);
  }
  const sitemap = graph.object(field(graph.root.body, 'sitemap'));
  const table = field(sitemap.body, 'node-table');
  const tree = graph.object(field(sitemap.body, 'tree'));
  const visited = new Set<number>();
  const pageGuids = new Set<string>();
  function visit(parent: RpObject, folderId: string, depth: number) {
    if (depth > 38) throw new Error('页面目录层级过深');
    for (const ref of list(field(parent.body, 'children'))) {
      const child = graph.object(ref);
      if (visited.has(child.id) || visited.size >= 2000) throw new Error('页面目录过大或节点重复');
      visited.add(child.id);
      const entry = field(table, child.id);
      let title: string;
      if (entry?.tag === 19 && entry.pair && graph.string(entry.pair[0]) === 'Axure:PackageInfo') {
        const guid = graph.guid(entry.pair[1]);
        const label = titles.get(guid);
        if (label === undefined || pageGuids.has(guid)) throw new Error('页面目录引用缺失或重复');
        pageGuids.add(guid);
        title = label;
        pages.push({ guid, title, pageId: pageId(guid), folderId });
        if (!list(field(child.body, 'children')).length) continue;
      } else {
        const name = field(graph.object(entry).body, 'name')?.text;
        if (!name?.trim()) throw new Error('无法读取 Axure 文件夹名称');
        title = name;
      }
      // A page may itself have children in Axure. Alex holds the editable page
      // in its original parent and groups its descendants in a sibling folder.
      const id = `rp-folder-${graph.guid(child.id)}`;
      folders.push({ id, title, parentFolderId: folderId });
      visit(child, id, depth + 1);
    }
  }
  visit(tree, 'rp-root', 0);
  if (!pages.length || pages.length !== titles.size) throw new Error('Axure 页面目录为空或有未关联的页面');
  return { pages, folders };
}

const isOff = (o: RpObject) => part(o, 'Disabled')?.n === 1;

type Props = ProtoNode['props'];
function layout(n: ProtoNode): Props {
  return (n.props.layoutFrame ?? n.props) as Props;
}
function bounds(nodes: ProtoNode[]) {
  const visible = nodes.filter(n => layout(n).hidden !== true);
  const frames = (visible.length ? visible : nodes).map(layout);
  if (!frames.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...frames.map(p => Number(p.x ?? 0))), y = Math.min(...frames.map(p => Number(p.y ?? 0)));
  return { x, y, width: Math.max(...frames.map(p => Number(p.x ?? 0) + Number(p.width ?? 0))) - x,
    height: Math.max(...frames.map(p => Number(p.y ?? 0) + Number(p.height ?? 0))) - y };
}
function moveOrigin(nodes: ProtoNode[], x: number, y: number) {
  for (const child of nodes) {
    const frame = layout(child);
    if (x) frame.x = Number(frame.x ?? 0) - x;
    if (y) frame.y = Number(frame.y ?? 0) - y;
  }
}
async function readPage(archive: RpArchive, page: PageInfo, pages: Set<string>, defaults: Map<number, Value>, masters: Map<string, Graph>) {
  const issues = new Map<string, number>();
  let converted = 0, contentSize = 0;
  const clicks = new PageClickTargets();
  const seen = new Set<string>();
  const warn = (msg: string) => issues.set(msg, (issues.get(msg) ?? 0) + 1);
  const account = (size: number) => {
    contentSize += size;
    if (contentSize > 12 * 1024 * 1024) throw new Error('「' + page.title + '」展开后的页面内容超过 12 MiB');
  };
  async function diagram(graph: Graph, path: string, prefix: string, ancestry: string[], depth: number, radioScope: string, masterScope: string): Promise<ProtoNode[]> {
    const drawing = graph.object(part(graph.root, 'diagram'), graph.root.type === 'Axure:PanelState' ? 'Axure:PanelDiagram' : 'Axure:Diagram');
    const ordered = list(part(drawing, 'diagram-objects')).map(ref => graph.object(ref));
    const styleOf = diagramStyles(graph, defaults, account);
    const eventMap = part(graph.root, 'interactionmap');
    if (eventMap && !graph.isNull(eventMap) && part(graph.object(eventMap), 'node-table')?.fields?.size) warn('页面或状态级交互未转换');
    const owned = new Set<number>();
    const groups = new Map<number, RpObject[]>();
    for (const w of ordered) {
      if (w.type !== 'Axure:DiagramObject:Layer') continue;
      const members = list(part(w, 'DiagramObjects')).map(r => graph.object(r));
      groups.set(w.id, members);
      for (const child of members) {
        if (owned.has(child.id)) throw new Error('分组重复引用子控件');
        owned.add(child.id);
      }
    }
    const visited = new Set<number>();
    async function widget(w: RpObject, level: number): Promise<ProtoNode> {
      if (level > 48 || seen.size >= 10000) throw new Error('「' + page.title + '」元件数量或嵌套超过上限');
      const id = prefix + graph.guid(w.id);
      if (seen.has(id)) throw new Error('「' + page.title + '」控件 GUID 重复或循环引用');
      seen.add(id); visited.add(w.id);
      const type = w.type.replace(/^Axure:DiagramObject:/, '');
      const { frame, visual, text, runs, prop } = styleOf(w);
      account(String(frame.label ?? '').length + 1);
      const n: ProtoNode = { kind: 'node', type: '', pfId: 'rp-widget-' + id, props: frame, children: [] };
      const treeLabel = type === 'TreeNodeObject' ? part(w, 'buttonshape') : undefined;
      const labelShape = treeLabel && !graph.isNull(treeLabel) ? graph.object(treeLabel, 'Axure:DiagramObject:VectorShape') : undefined;
      const map = part(w,'InteractionMap');
      const onClick = readClick(graph, (!map || graph.isNull(map)) && labelShape ? labelShape : w, pages, warn);
      const disabled = isOff(w);
      if (part(w, 'AdaptiveStyles')?.items?.length) warn('仅导入基础自适应视图');
      const unsupported = (message: string) => {
        n.type = 'AxureWidget'; n.props = { ...frame, kind: 'placeholder', text: frame.label ?? type }; warn(message);
      };
      if (type === 'Layer') {
        n.type = 'PositionedGroup';
        const children: ProtoNode[] = [];
        for (const member of groups.get(w.id) ?? []) children.push(await widget(member, level + 1));
        // Membership is hierarchical, but Axure stores member locations in diagram coordinates.
        const box = bounds(children);
        moveOrigin(children, box.x, box.y);
        Object.assign(n.props, box); n.children = children;
      } else if (type === 'ReferenceDiagramObject') {
        const ref = part(w, 'ReferredMaster');
        if (ref?.tag !== 16 || !ref.pair || graph.string(ref.pair[0]) !== 'Axure:Master' || graph.isNullGuid(ref.pair[1])) {
          unsupported('母版引用为空');
        } else {
          const guid = graph.guid(ref.pair[1]);
          if (!archive.hasDiagram(guid)) { unsupported('母版引用的源文件包缺失'); return n; }
          if (ancestry.includes(guid)) throw new Error('母版循环引用');
          const inner = masters.get(guid) ?? await archive.diagram(guid, 'Axure:Master');
          masters.set(guid, inner);
          n.type = 'PositionedGroup';
          const children = await diagram(inner, guid, id + '-', [...ancestry, guid], level + 1, part(w, 'IsolateRadioGroups')?.n === 1 ? id : radioScope, id);
          const box = bounds(children);
          if (part(w, 'IsBackground')?.n === 1) {
            frame.x = 0;
            frame.y = 0;
            frame.width = Math.max(0, box.x + box.width);
            frame.height = Math.max(0, box.y + box.height);
          } else {
            moveOrigin(children, box.x, box.y);
            if (frame.width === undefined) frame.width = box.width;
            if (frame.height === undefined) frame.height = box.height;
          }
          n.children = children;
          if (part(w, 'ObjectOverrides')?.items?.length) warn('母版实例的独立覆盖未转换');
        }
      } else if (type === 'DynamicPanel') {
        const states = part(w, 'panel-diagrams')?.items;
        if (!states?.length) unsupported('DynamicPanel 缺少状态记录');
        else {
          n.type = 'DynamicPanel'; frame.activeState = 1;
          frame.clip = part(w, 'fit-to-content')?.n !== 1;
          if (!frame.clip) frame.fitContent = true;
          if (part(w,'is-fixed')?.n === 1) {
            const x = part(w,'horizontal-pin-alignment')?.n;
            const y = part(w,'vertical-pin-alignment')?.n;
            const marginX = part(w,'horizontal-pin-margin')?.n;
            const marginY = part(w,'vertical-pin-margin')?.n;
            if (x !== undefined && ['left','center','right'][x] && y !== undefined && ['top','middle','bottom'][y] &&
                typeof marginX === 'number' && Number.isFinite(marginX) && typeof marginY === 'number' && Number.isFinite(marginY)) {
              Object.assign(frame, { pinX:['left','center','right'][x], pinY:['top','middle','bottom'][y],
                pinMarginX: marginX, pinMarginY: marginY, pinInFront: part(w,'keep-pinned-in-front')?.n === 1 });
            } else warn('动态面板固定位置的对齐方式或边距无法识别');
          }
          for (const ref of states) {
            if (ref.tag !== 19 || !ref.pair || graph.string(ref.pair[0]) !== 'Axure:PanelState') throw new Error('动态面板的状态引用类型无效');
            const guid = graph.guid(ref.pair[1]);
            // Even nested panel states belong to the enclosing page/master package.
            const statePath = path.split('/')[0] + '/' + guid;
            if (ancestry.includes(statePath)) throw new Error('动态面板状态循环引用');
            const stateId = id + '-' + guid;
            if (seen.has(stateId) || seen.size >= 10000 || level >= 48) throw new Error('动态面板状态重复或嵌套超过上限');
            seen.add(stateId);
            const state: ProtoNode = { kind: 'node', type: 'PanelState', pfId: 'rp-state-' + stateId, props: {}, children: [] };
            if (archive.hasDiagram(statePath)) {
              const inner = await archive.diagram(statePath, 'Axure:PanelState');
              const d = inner.object(part(inner.root,'diagram'), 'Axure:PanelDiagram');
              const name = part(d,'Name')?.text;
              if (name) state.props.label = name;
              const children = await diagram(inner, statePath, stateId + '-', [...ancestry,statePath], level+2, radioScope, masterScope);
              state.children = children;
              if (!n.children.length) {
                const box = bounds(children);
                if (frame.width === undefined) frame.width = box.x + box.width;
                if (frame.height === undefined) frame.height = box.y + box.height;
              }
            } else warn('动态面板引用的状态包缺失');
            n.children.push(state);
          }
        }
      } else if (type === 'Table') {
        const widths = list(part(w,'column-widths')).map(v => v.n);
        const heights = list(part(w,'row-heights')).map(v => v.n);
        const refs = list(part(w,'cells'));
        if (widths.length !== part(w,'columns')?.n || heights.length !== part(w,'rows')?.n ||
            widths.length * heights.length !== refs.length || ![...widths,...heights].every(v => v !== undefined && Number.isFinite(v) && v >= 0)) throw new Error('表格尺寸与单元格数量不一致');
        n.type = 'StaticTable'; frame.columnWidths = widths as number[]; frame.rowHeights = heights as number[];
        // Cells are stored row-major in "cells". The nested diagram uses a different order.
        const children: ProtoNode[] = [];
        for (const r of refs) children.push(await widget(graph.object(r, 'Axure:DiagramObject:TableCell'), level + 1));
        if (children.length) {
          const common: Props = {};
          for (const [k,v] of Object.entries(children[0].props)) {
            if (!['text','runs','onClick','disabled'].includes(k) && children.every(c => c.props[k] === v)) {
              common[k] = v; children.forEach(c => { delete c.props[k]; });
            }
          }
          if (Object.keys(common).length) frame.cellStyle = common;
        }
        n.children = children;
      } else if (type === 'TableCell') {
        n.type = 'StaticTableCell'; cellEdges(w, visual);
        n.props = { ...visual, text: text ?? '', ...(runs && { runs }) };
      } else if (type === 'VectorShape') {
        const d = vectorPath(w);
        if (d) account(d.length);
        if (text && !d && !runs && (onClick || (visual.borderWidth === 0 && /^#[0-9a-f]{6}00$/i.test(String(visual.background))))) {
          n.type = onClick ? 'Button' : 'Text'; n.props = { layoutFrame: { ...frame, ...visual } };
          n.children = [{ kind: 'text', value: text }];
        } else {
          n.type = 'VectorShape'; n.props = { ...frame, ...visual, ...(text && { text }), ...(runs && { runs }), ...(d && { path: d }) };
        }
      } else if (type === 'TextArea' || (type === 'TextBox' && part(w, 'Type')?.n === 0)) {
        n.type = type === 'TextArea' ? 'Textarea' : 'Input';
        const hint = part(w,'PlaceholderText')?.text ?? '';
        account(hint.length);
        n.props = { layoutFrame: { ...frame, ...visual }, placeholder: hint, ...(text && { initialValue: text }),
          ...(part(w,'ReadOnly')?.n === 1 && { readOnly: true }) };
      } else if (type === 'ComboBox' || type === 'ListBox') {
        const options = list(part(w,'list-options')).map(r => graph.object(r,'Axure:SelectObject'));
        const choices = options.map(o => {
          const title = part(o,'object')?.text;
          if (title === undefined) throw new Error('Axure 选项缺少显示文本');
          account(title.length); return title;
        });
        const selected = options.flatMap((o,i) => part(o,'selected')?.n === 1 ? [i] : []);
        const multiple = part(w,'multiple')?.n === 1;
        if (type === 'ComboBox' && !multiple && !onClick && selected.length <= 1 && choices.every(Boolean) && new Set(choices).size === choices.length) {
          n.type = 'Select'; n.props = { layoutFrame: { ...frame, ...visual }, options: choices, placeholder: '',
            ...(selected.length && { initialValue: choices[selected[0]] }) };
        } else {
          n.type = type === 'ComboBox' ? 'ListSelect' : 'ListBox';
          n.props = { ...frame, ...visual, choices, selectedOptions: selected, multiple };
        }
      } else if (type === 'Checkbox' || type === 'RadioButton') {
        n.type = type === 'Checkbox' ? 'CheckControl' : 'RadioControl';
        n.props = { ...frame, ...visual, text: text ?? '', checked: part(w,'Selected')?.n === 1 };
        const group = part(w, 'radio-group')?.text;
        if (type === 'RadioButton' && group) n.props.radioGroup = radioScope + '/' + group;
      } else if (type === 'TreeNodeObject') {
        // The root owns the tree frame. Each real item stores its caption on its button shape.
        const root = graph.isNull(part(w, 'parentnode'));
        n.type = root ? 'OutlineTree' : 'TreeItem';
        if (!root) {
          const caption = labelShape && styleOf(labelShape);
          n.props = { ...caption?.visual, text: caption?.text ?? '', ...(caption?.runs && { runs: caption.runs }),
            expanded: part(w,'isexpanded')?.n === 1, ...(frame.height !== undefined && { height: frame.height }),
            ...(frame.x !== undefined && { indent: frame.x }), ...(frame.hidden && { hidden: true }) };
        }
        for (const ref of list(part(w, 'childnodes'))) n.children.push(await widget(graph.object(ref, 'Axure:DiagramObject:TreeNodeObject'), level+1));
        if (root && part(w, 'rootshowicon')?.n === 1) warn('树节点自定义图标未转换');
      } else if (type === 'InlineFrame') {
        const ref = part(w, 'DefaultTarget');
        const target = ref && !graph.isNull(ref) ? graph.object(ref, 'Axure:InteractionTarget') : undefined;
        const expr = target && part(target, 'target-literal');
        const literal = expr && !graph.isNull(expr) ? graph.object(expr) : undefined;
        if (target && part(target,'target-type')?.n === 0 && literal?.type === 'Axure:Expr:StringLiteral' && part(literal,'value')?.text === '') {
          n.type = 'VectorShape'; n.props = { ...frame, background: 'transparent', borderWidth: part(w,'ShowBorder')?.n === 1 ? 1 : 0 };
        } else unsupported('内联框架的目标内容未转换');
      } else if (type === 'ImageMapRegion') {
        n.type = 'Hotspot';
      } else if (type === 'ImageBox') {
        const bytes = field(prop(27), 'Stream')?.bytes;
        const mime = bytes?.[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes?.[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : undefined;
        if (mime && bytes && bytes.length <= 4 * 1024 * 1024) {
          account(Math.ceil(bytes.length / 3) * 4);
          const chunks: string[] = [];
          for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
          n.type = 'EmbeddedPicture'; n.props.image = 'data:' + mime + ';base64,' + btoa(chunks.join(''));
        } else unsupported('图片缺少可读取的内嵌 PNG/JPEG 或超过 4 MiB');
      } else unsupported(type + ' 尚未转换');
      if (n.type !== 'AxureWidget') {
        converted++;
        clicks.register(masterScope, graph.guid(w.id), n, onClick);
        if (disabled && n.type !== 'Text') n.props.disabled = true;
      }
      return n;
    }
    const nodes: ProtoNode[] = [];
    for (const w of ordered) if (!owned.has(w.id)) nodes.push(await widget(w, depth));
    if (ordered.some(w => !visited.has(w.id))) throw new Error('存在无法展开的分组循环');
    return nodes;
  }
  const widgets = await diagram(await archive.diagram(page.guid, 'Axure:Page'), page.guid, '', [page.guid], 0, page.guid, page.guid);
  const interactionCounts = clicks.finish(warn);
  const warnings = Array.from(issues, ([msg, count]) => msg + '（' + count + '）');
  const canvas: ProtoNode = { kind: 'node', type: 'AxureCanvas', pfId: 'rp-canvas-' + page.guid, props: {}, children: widgets };
  const source = printPageSource({ header: [], root: { kind: 'node', type: 'Page', pfId: 'rp-root-' + page.guid,
    props: { title: page.title, bg: 'white', ...(warnings.length ? { description: warnings.join('；') } : {}) }, children: [canvas] } });
  return { source, report: { title: page.title, widgets: converted, ...interactionCounts, warnings } };
}

export async function importAxureRp(bytes: Uint8Array): Promise<AxureImport> {
  const archive = new RpArchive(bytes);
  const doc = await archive.document();
  const { pages, folders } = readSitemap(doc);
  const defaults = documentDefaults(doc);
  const masters = new Map<string, Graph>();
  const pageGuids = new Set(pages.map(p => p.guid));
  const result: AxureImport = { version: archive.version, designerFolders: folders, designerPages: [], pageSources: {}, report: [] };
  let sourceSize = 0;
  for (const p of pages) {
    const { source, report } = await readPage(archive, p, pageGuids, defaults, masters);
    sourceSize += source.length;
    if (sourceSize > 48 * 1024 * 1024) throw new Error('转换后的页面源码总量超过 48 MiB');
    result.pageSources[p.pageId] = source;
    result.designerPages.push({ pageId: p.pageId, title: p.title, folderId: p.folderId, platform: 'desktop' });
    result.report.push(report);
  }
  return result;
}
