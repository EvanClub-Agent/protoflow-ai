import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useProtoStore, type DBTableSchema } from '../src/store/useProtoStore';
import { DatabaseDesignerView } from '../src/components/DatabaseDesignerView';
import { CARD_WIDTH, cardHeight, columnAnchor, diagramRelations, domainBounds, layoutTables, resolvePositions, visibleColumns } from '../src/components/databaseDiagram';
import { captureProjectPayload, loadProjectFromBinaryPayload } from '../src/services/projectStorage';
import { validateProjectPayload } from '../src/services/projectValidation';
import { encodePflowBinary, decodePflowBinary, generateUnpackedGitFiles } from '../src/utils/pflowBinaryCodec';

function table(id: string, count: number, domain: DBTableSchema['domain'] = '采购管理域 (SRM)'): DBTableSchema {
  return { id, tableName:`physical_${id}`, cnName:id, domain, description:'', sharedByMenus:[], columns:Array.from({length:count}, (_,i)=>({id:`${id}-col-${i}`, name:i===0?'id':`field_${i}`,dataType:'VARCHAR(32)',nullable:i!==0,isPrimaryKey:i===0,comment:''})) };
}
function fixture() {
  const tables = [table('a',20,'基础资料域 (MDM)'),...['b','c','d','e','f','g'].map((id,i)=>table(id,11+i*5))];
  tables[1].columns[1] = {...tables[1].columns[1],isForeignKey:true,references:'physical_a(id)'};
  return tables;
}
function checkNoOverlap(tables: DBTableSchema[], positions: ReturnType<typeof layoutTables>, level: 'all'|'keys_only'|'header_only') {
  const {relations}=diagramRelations(tables);
  tables.forEach((t,i)=>tables.slice(i+1).forEach(other=>{
    const a=positions[t.id], b=positions[other.id];
    assert.ok(a.x+CARD_WIDTH<=b.x || b.x+CARD_WIDTH<=a.x || a.y+cardHeight(t,level,relations)<=b.y || b.y+cardHeight(other,level,relations)<=a.y,`${t.id} overlaps ${other.id}`);
  }));
}

test('arbitrary project tables never share demo coordinates; all field densities and growing cards have room',()=>{
  const tables=fixture();
  for(const level of ['all','keys_only','header_only'] as const){
    const {relations}=diagramRelations(tables), positions=layoutTables(tables,level,relations);
    assert.equal(Object.keys(positions).length,7);
    checkNoOverlap(tables,positions,level);
    const areas=domainBounds(tables,positions,level,relations);
    assert.equal(areas.length,2);
    for(const t of tables){const area=areas.find(a=>a.domain===t.domain)!;const p=positions[t.id];assert.ok(p.x>=area.x && p.y>=area.y && p.x+CARD_WIDTH<=area.x+area.width && p.y+cardHeight(t,level,relations)<=area.y+area.height);}
  }
  const {relations}=diagramRelations(tables);
  const automatic=layoutTables(tables,'all',relations);
  const moved={a:{x:automatic.b.x,y:automatic.b.y}};
  const positions=resolvePositions(tables,'all',relations,automatic,moved);
  assert.deepEqual(positions.a,moved.a);
  checkNoOverlap(tables,positions,'all');
});

test('relationships resolve exact physical names and fields, report missing and ambiguous references, invent no policies',()=>{
  const tables=fixture(); let result=diagramRelations(tables);
  assert.equal(result.relations.length,1);
  assert.equal(result.relations[0].fromTableId,'a');
  assert.equal(result.relations[0].cardinality,undefined);
  assert.equal(result.relations[0].onDelete,undefined);
  tables[1].columns[1].references='a(id)';
  result=diagramRelations(tables);assert.equal(result.relations.length,0);assert.equal(result.issues.length,1);
  tables[1].columns[1].references='physical_a(missing)';assert.equal(diagramRelations(tables).relations.length,0);
  tables[1].columns[1].references='physical_a(id)';tables.push({...tables[0],id:'duplicate'});
  assert.equal(diagramRelations(tables).relations.length,0);
  assert.deepEqual(diagramRelations([]),{relations:[],issues:[]});
});

test('field anchors use actual rows, keep referenced non-PK fields visible, and refuse dangling endpoints',()=>{
  const tables=fixture(); tables[1].columns[1].references='physical_a(field_3)';
  const {relations}=diagramRelations(tables); const pos={x:48,y:72};
  assert.ok(visibleColumns(tables[0],'keys_only',relations).some(c=>c.name==='field_3'));
  assert.deepEqual(columnAnchor(tables[0],'field_3','right',pos,'all',relations),{x:364,y:72+1+76+3*26+13});
  assert.equal(columnAnchor(tables[0],'absent','left',pos,'all',relations),null);
  assert.deepEqual(columnAnchor(tables[0],'id','left',pos,'header_only',relations),{x:48,y:110});
});

test('empty and custom project modelers contain no demo relations, notes or indexes',()=>{
  useProtoStore.setState({dbTables:[],selectedTableId:''});
  let renderer: TestRenderer.ReactTestRenderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(DatabaseDesignerView));});
  try {
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('还没有数据表'));
    act(()=>useProtoStore.setState({dbTables:fixture(),selectedTableId:'b'}));
    assert.equal(renderer!.root.findAll(n=>n.props['data-db-table']).length,7);
    assert.equal(renderer!.root.findAll(n=>n.props['data-db-relation']).length,1);
    assert.ok(!JSON.stringify(renderer!.toJSON()).includes('多菜单共表架构说明'));
    const relation=renderer!.root.find(n=>n.props['data-db-relation']);
    act(()=>relation.props.onClick({stopPropagation(){}}));
    const remove=renderer!.root.findAllByType('button').find(b=>b.children.includes('删除连线'))!;
    act(()=>remove.props.onClick());
    assert.equal(renderer!.root.findAll(n=>n.props['data-db-relation']).length,0);
    assert.equal(useProtoStore.getState().dbTables[1].columns[1].references,undefined);
    act(()=>useProtoStore.setState({dbTables:[],selectedTableId:''}));
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('还没有数据表'));
  } finally {act(()=>renderer!.unmount());}
});

test('foreign keys follow physical table and column renames and survive archive and Git export',()=>{
  const tables=fixture();tables[1].columns[1].foreignKeyOptions={name:'fk_b_a',cardinality:'1:N',onDelete:'CASCADE'};
  useProtoStore.setState({dbTables:tables});
  useProtoStore.getState().updateTableMeta('a',{tableName:'renamed_a'});
  useProtoStore.getState().updateColumnInTable('a','a-col-0',{name:'entity_id'});
  assert.equal(useProtoStore.getState().dbTables[1].columns[1].references,'renamed_a(entity_id)');
  assert.equal(useProtoStore.getState().dbTables[0].id,'a');
  const payload=decodePflowBinary(encodePflowBinary(captureProjectPayload()));
  loadProjectFromBinaryPayload(payload);
  const result=diagramRelations(useProtoStore.getState().dbTables);
  assert.equal(result.relations[0].onDelete,'CASCADE');assert.equal(result.issues.length,0);
  assert.ok(generateUnpackedGitFiles(payload).some(f=>f.content.includes('"onDelete": "CASCADE"')));
  useProtoStore.getState().deleteColumnFromTable('a','a-col-0');
  assert.equal(diagramRelations(useProtoStore.getState().dbTables).issues.length,1);
  assert.equal(diagramRelations(useProtoStore.getState().dbTables).relations.length,0);
});


test('FK settings validate at archive and AI boundaries and keep the existing export boolean',()=>{
  const tables=fixture();useProtoStore.setState({dbTables:tables});
  const base=captureProjectPayload();
  for(const options of ['invalid',{cardinality:'N:N'},{onDelete:'DROP'},{name:'bad`name'}]) {
    const payload=structuredClone(base);(payload.stateSnapshot.dbTables[1].columns[1] as any).foreignKeyOptions=options;
    assert.throws(()=>validateProjectPayload(payload),/foreignKeyOptions/);
  }
  tables[1].columns[1].foreignKeyOptions={onDelete:'CASCADE'};
  useProtoStore.setState({dbTables:tables});
  const payload=captureProjectPayload();validateProjectPayload(payload);
  const exported=generateUnpackedGitFiles(payload).find(f=>f.content.includes('"foreignKeyOptions"'))!;
  assert.ok(exported.content.includes('"foreignKey": true'));
  assert.ok(exported.content.includes('"onDelete": "CASCADE"'));
});

test('named business keys can be edited in the designer and follow column renames and table copies', () => {
  const original=table('quote',4);
  useProtoStore.setState({dbTables:[original],selectedTableId:'quote'});
  let renderer!:TestRenderer.ReactTestRenderer;
  act(()=>{renderer=TestRenderer.create(React.createElement(DatabaseDesignerView));});
  const click=(label:string)=> {
    const buttons=renderer.root.findAllByType('button');
    const button=buttons.find(b=>b.children.includes(label)) ?? buttons.find(b=>b.children.some(c=>typeof c==='string' && c.includes(label)));
    assert.ok(button,label); act(()=>button.props.onClick());
  };
  const fill=(label:string,value:string)=>act(()=>renderer.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
  const state=()=>useProtoStore.getState();
  const cols='索引列，按顺序用英文逗号分隔';
  try {
    click('编辑表结构'); click('3. 索引');
    fill('索引类型','UNIQUE'); fill('索引名','uq_quote'); fill(cols,'field_2, invalid'); click('+ 保存索引');
    assert.equal(state().dbTables[0].uniqueConstraints,undefined);
    fill(cols,'field_2, field_1'); click('+ 保存索引');
    assert.deepEqual(state().dbTables[0].uniqueConstraints,[{name:'uq_quote',columnIds:['quote-col-2','quote-col-1']}]);
    click('编辑'); fill('索引名','uq_pair'); fill(cols,'field_1, field_2'); click('保存约束修改');
    act(()=>state().updateColumnInTable('quote','quote-col-1',{name:'renamed'}));
    assert.throws(()=>state().deleteColumnFromTable('quote','quote-col-1'),/uq_pair/);
    const archive=decodePflowBinary(encodePflowBinary(captureProjectPayload()));
    assert.deepEqual(archive.stateSnapshot.dbTables[0].uniqueConstraints,[{name:'uq_pair',columnIds:['quote-col-1','quote-col-2']}]);
    let copyId=''; act(()=>{copyId=state().duplicateTable('quote');});
    const copy=state().dbTables.find(t=>t.id===copyId)!;
    assert.deepEqual(copy.uniqueConstraints![0].columnIds,copy.columns.slice(1,3).map(c=>c.id));
    assert.ok(copy.uniqueConstraints![0].columnIds.every(id=>!original.columns.some(c=>c.id===id)));
    assert.equal(copy.columns[1].name,'renamed');
    const keyRow=renderer.root.findAllByType('tr').find(r=>r.findAllByType('td').some(td=>td.children.includes('uq_pair')))!;
    const remove=keyRow.findAllByType('button').find(b=>b.children.includes('删除'))!;
    act(()=>remove.props.onClick());
    assert.deepEqual(state().dbTables.find(t=>t.id===copyId)!.uniqueConstraints,[]);
    assert.equal(state().dbTables[0].uniqueConstraints!.length,1);
  } finally {act(()=>renderer.unmount());}
});
