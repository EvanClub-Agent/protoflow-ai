import type { ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import { reviewPageDependencies } from './projectDependencies';
import { parsePageSource } from '../proto/dsl/parser';
import { walk } from '../proto/dsl/tree';
import type { DiagnosticContext } from './runtimeDiagnostics';

/** Structural evidence only: no requirements, scenario prose, TSX or table rows. */
export function projectDiagnosticContext(snapshot:ProjectStateSnapshot, targetPageId:string):DiagnosticContext {
  const review=reviewPageDependencies(snapshot);
  const fields=['kind','status','pageId','sourcePageId','sourceTableId','sourceColumnId','tableId','foreignKeyColumnId','actionPfId','actionEvent','actionKind','targetId'];
  const checks=[...review.links.filter(item=>item.pageId===targetPageId),...review.cases.filter(item=>item.pageId===targetPageId)].map((item,index)=>{
    const check:Record<string,string>={index:String(index)};
    for(const key of fields){const value=(item as unknown as Record<string,unknown>)[key];if(typeof value==='string')check[key]=value;}
    return check;
  }).slice(0,100);
  const tables=new Set<string>();
  const source=snapshot.pageSources[targetPageId];
  const doc=source?parsePageSource(source).doc:undefined;
  if(doc)walk(doc.root,node=>{if(typeof node.props.table==='string')tables.add(node.props.table);});
  return {targetPageId,checks,boundTableIds:[...tables].slice(0,100)};
}
