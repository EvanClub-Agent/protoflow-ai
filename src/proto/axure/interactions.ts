import { field, list, type Graph, type RpObject } from './binary';
import { part } from './style';
import { isNode, type ActionCall, type ProtoNode } from '../types';

type SourceAction = { kind: 'navigate' | 'show' | 'hide'; guid: string } |
  { kind: 'state'; guid: string; stateGuid: string; show: boolean };
type Warn = (message: string) => void;
const off = (o: RpObject) => part(o, 'Disabled')?.n === 1;

function actions(graph: Graph, action: RpObject, pages: Set<string>, warn: Warn): SourceAction[] | undefined {
  if (action.type === 'Axure:InteractionLinkWindowAction' && part(action,'link-type')?.n === 1) {
    const target = graph.object(part(action,'target'), 'Axure:InteractionTarget');
    const pair = part(target, 'target-page-id');
    if (part(target,'target-type')?.n !== 1 || pair?.tag !== 19 || !pair.pair || graph.string(pair.pair[0]) !== 'Axure:Page') return;
    if (graph.isNullGuid(pair.pair[1])) { warn('跳转目标未设置'); return; }
    const guid = graph.guid(pair.pair[1]);
    if (!pages.has(guid)) { warn('跳转目标不在页面目录中'); return; }
    return [{kind:'navigate', guid}];
  }
  const panel = action.type === 'Axure:InteractionSetPanelStateAction';
  if (!panel && action.type !== 'Axure:InteractionFadeWidgetAction') return;
  const paths = part(action, panel ? 'PanelPaths' : 'WidgetPaths')?.items;
  const infos = part(action, panel ? 'SetStateInfos' : 'FadeInfos')?.items;
  if (!paths?.length || !infos || paths.length !== infos.length) return;
  const result: SourceAction[] = [];
  for (const [i,ref] of paths.entries()) {
    const path = graph.object(ref, 'Axure:DiagramObjectPath');
    const objectId = part(path, 'object-id');
    // Paths through repeaters/other master instances have different addressing semantics.
    if (objectId?.tag !== 22 || graph.isNullGuid(objectId.n!) || part(path,'is-dummy')?.n ||
        part(path, 'rdo-path')?.items?.length !== 0 || part(path, 'repeater-path')?.items?.length !== 0) return;
    const guid = graph.guid(objectId.n);
    const info = graph.object(infos[i], panel ? 'Axure:SetPanelStateInfo' : 'Axure:FadeWidgetInfo');
    if (panel) {
      const state = part(info,'diagram-id');
      if (part(info,'set-state-type')?.n !== 0 || state?.tag !== 22 || graph.isNullGuid(state.n!) ||
          ['repeat','compress','animation-enter','animation-exit'].some(k => part(info,k)?.n)) return;
      result.push({ kind:'state', guid, stateGuid:graph.guid(state.n), show:part(info,'show-when-set')?.n === 1 });
    } else {
      const mode = part(info,'fade-action-type')?.n;
      if ((mode !== 0 && mode !== 1) || part(info,'show-type')?.n !== 0 || part(info,'BringToFront')?.n ||
          part(info,mode === 0 ? 'animation-hide' : 'animation-show')?.n ||
          part(info,mode === 0 ? 'EasingHide' : 'easing')?.n) return;
      result.push({ kind:mode === 0 ? 'hide' : 'show', guid });
    }
  }
  return result;
}

// Execute a case only if the entire enabled action sequence can be represented.
// Never run the first supported action from an otherwise unsupported case.
export function readClick(graph: Graph, widget: RpObject, pages: Set<string>, warn: Warn) {
  const ref = part(widget, 'InteractionMap');
  if (!ref || graph.isNull(ref)) return;
  const map = graph.object(ref);
  const table = part(map, 'node-table');
  const children = (o: RpObject) => list(part(o, 'children')).map(r => graph.object(r));
  const target = (o: RpObject, type?: string) => graph.object(field(table,o.id),type);
  const events = children(graph.object(part(map,'tree'))).filter(n => {
    const e = target(n,'Axure:InteractionEvent');
    if (off(e)) return false;
    if (part(e,'event-type')?.n === 16) return true;
    warn('其他控件事件未转换');
    return false;
  });
  if (!events.length) return;
  const cases = events.flatMap(children).filter(n => !off(target(n,'Axure:InteractionCase')));
  if (!cases.length) return;
  if (events.length !== 1 || cases.length !== 1 || !graph.isNull(part(target(cases[0]),'Condition'))) {
    warn('条件或多分支点击未转换'); return;
  }
  const sequence: SourceAction[] = [];
  for (const node of children(cases[0])) {
    const action = target(node);
    if (off(action)) continue;
    const decoded = actions(graph,action,pages,warn);
    if (!decoded) { warn('点击动作链未转换 · ' + action.type.replace('Axure:Interaction','')); return; }
    sequence.push(...decoded);
  }
  return sequence.length ? sequence : undefined;
}

export class PageClickTargets {
  private targets = new Map<string, ProtoNode | null>();
  private pending: { owner: ProtoNode; scope: string; sequence: SourceAction[] }[] = [];
  register(scope: string, guid: string, node: ProtoNode, sequence?: SourceAction[]) {
    const key = scope + '/' + guid;
    this.targets.set(key,this.targets.has(key) ? null : node);
    if (sequence) this.pending.push({owner:node, scope, sequence});
  }
  finish(warn: Warn) {
    let links = 0;
    let clicks = 0;
    for (const {owner,scope,sequence} of this.pending) {
      const calls: ActionCall[] = [];
      for (const a of sequence) {
        if (a.kind === 'navigate') { calls.push({name:'navigate',args:['rp-page-' + a.guid]}); continue; }
        const node = this.targets.get(scope + '/' + a.guid);
        if (!node) { calls.length = 0; break; }
        if (a.kind === 'state') {
          const index = node.children.filter(isNode).findIndex(s => s.pfId === 'rp-state-' + node.pfId.slice('rp-widget-'.length) + '-' + a.stateGuid);
          if (node.type !== 'DynamicPanel' || index < 0) { calls.length = 0; break; }
          calls.push({name:'switchTab',args:[node.pfId,index]});
          if (a.show) calls.push({name:'show',args:[node.pfId]});
        } else calls.push({name:a.kind,args:[node.pfId]});
      }
      if (!calls.length) { warn('点击目标或面板状态无法唯一定位'); continue; }
      owner.props.onClick = { $kind:'actions', calls };
      clicks++;
      links += calls.filter(c => c.name === 'navigate').length;
    }
    return { links, clicks };
  }
}
