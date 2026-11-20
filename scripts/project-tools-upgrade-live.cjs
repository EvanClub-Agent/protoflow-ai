// Real ACP migration of a disposable session whose gateway still holds the old
// stdio server. Exercises only a test workspace; no real project is opened.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { hermesTestEnvironment } = require('./hermes-test-environment.cjs');
const { HermesRuntime } = require('../electron/hermes-runtime.cjs');
const { atomicWrite, tools } = require('../electron/protoflow-mcp.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pflow-old-tools-'));
const runtime = new HermesRuntime({dataDir:dir,emit(e) {
  if (e.type==='session-update' && e.update.sessionUpdate==='tool_call') console.log('Tool:',e.update.title);
  if (e.type==='permission') runtime.respondPermission({id:e.id,optionId:null});
  if (e.type==='question') runtime.respondQuestion({id:e.id,answer:null});
}});
(async () => {
  try {
    await runtime.connect(hermesTestEnvironment());
    const scope = { projectId:'tool-upgrade-smoke',kind:'project' }, cwd = runtime.conversationWorkspace(scope);
    const old = tools.filter(t=>!['protoflow_revise_project_page','protoflow_ask_questions','protoflow_move_sitemap_item'].includes(t.name));
    const legacy = path.join(dir,'legacy.cjs');
    fs.writeFileSync(legacy,`const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line', line=>{
      const m=JSON.parse(line); if(m.id===undefined)return;
      if(m.method==='tools/list')fs.writeFileSync(process.argv[2],'listed');
      const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'protoflow',version:'old'}}:
        m.method==='tools/list'?{tools:${JSON.stringify(old)}}:{};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
    });`);
    const marker=path.join(dir,'listed');
    const oldSession=await runtime.client.request('session/new',{cwd,mcpServers:[{name:'protoflow',command:process.execPath,args:[legacy,marker],env:[{name:'ELECTRON_RUN_AS_NODE',value:'1'}]}]},120000);
    assert.ok(fs.existsSync(marker));
    atomicWrite(path.join(cwd,'session.json'),{...scope,sessionId:oldSession.sessionId});
    const upgraded=await runtime.session(scope);
    assert.equal(upgraded.sessionId,oldSession.sessionId);
    assert.deepEqual([...upgraded.projectTools].sort(),tools.map(t=>t.name).sort());
    // Forced refresh must also work without changing either session ID or model.
    const refreshed=await runtime.session({...scope,refresh:true});
    assert.equal(refreshed.sessionId,upgraded.sessionId);
    assert.equal(refreshed.models.currentModelId,upgraded.models.currentModelId);
    const snapshot={projectId:scope.projectId,projectPlan:null,designerFolders:[],designerPages:[],sitemapBase:[],sitemapOverrides:{folderParents:{},pageFolders:{}},pageSources:{},dbTables:[],tableRows:{},stickyNotes:[],contracts:{}};
    const result=await runtime.execute({...scope,snapshot,workflowPhase:'conversation',
      prompt:'本轮为隔离冒烟验证。请用 tool_search 发现当前会话的 protoflow_upsert_folder 和 protoflow_move_sitemap_item（带有 MCP 前缀），然后调用工具创建顶层目录 archive（档案）和顶层目录 lists（清单），然后调用移动工具将 lists 移到 archive 下。请实际暂存这些操作，供宿主确认；不需要规划、创建页面或访问其他工具。'});
    assert.equal(result.sessionId,upgraded.sessionId);
    if (!result.operations.length) console.error('No operations:',result.text.slice(0,1200));
    assert.ok(result.operations.some(op=>op.tool==='protoflow_upsert_folder' && op.args.folder.id==='archive'));
    assert.ok(result.operations.some(op=>op.tool==='protoflow_move_sitemap_item' && op.args.target.id==='lists' && op.args.parentFolderId==='archive'), 'expected actual move in the upgraded session; received '+result.operations.map(o=>o.tool));
    console.log(JSON.stringify({ok:true,sameSession:true,oldTools:old.length,currentTools:upgraded.projectTools.length,operations:result.operations.map(o=>o.tool)}));
  } finally { runtime.close();fs.rmSync(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
