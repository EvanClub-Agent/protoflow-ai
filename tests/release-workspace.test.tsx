import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {ReleaseWorkspace} from '../src/viewer/ReleaseWorkspace';
import {assetReady,assetVersionIssue,platformStatus,releaseHeading,releaseInput,releaseSubtitle,releaseTitleIssue} from '../src/viewer/releasePresentation';
import {releaseAsset,releaseFixture} from './fixtures/releases';
const text=(node:TestRenderer.ReactTestInstance):string=>node.children.map(child=>typeof child==='object'?text(child):String(child)).join('');

test('release headings use version identity, reject stale generated titles, and never invent changelog content',()=>{
  const release=releaseFixture()[0];
  assert.equal(releaseHeading(release),'Alex v0.0.6');
  assert.equal(releaseSubtitle(release),'');
  assert.match(releaseTitleIssue(release.version,release.title)!,/0.2.0.*0.0.6/);
  assert.throws(()=>releaseInput(release),/版本号/);
  const draft=releaseInput({...release,title:'',notes:'',published:false});
  assert.equal(draft.title,'Alex v0.0.6');assert.equal(draft.notes,'');assert.equal(draft.published,false);
  assert.equal(releaseSubtitle({...release,title:'移动审批明细修复'}),'移动审批明细修复');
  assert.equal(assetVersionIssue('Alex-0.0.5-linux-amd64.deb','0.0.6')?.includes('不一致'),true);
  assert.equal(assetVersionIssue('Alex-0.0.6-linux-amd64.deb','0.0.6'),null);
  assert.equal(assetVersionIssue('Alex-0.0.6-beta.1-mac-arm64.dmg','0.0.6-beta.1'),null);
  assert.equal(assetVersionIssue('manual-installer.deb','0.0.6'),null);
  assert.ok(assetVersionIssue('ProtoFlow_AI-0.0.7-x86_64.AppImage', '0.0.8'));
  assert.equal(assetVersionIssue('ProtoFlow_AI-0.0.8-beta.1-aarch64.AppImage', '0.0.8-beta.1'), null);
});

test('platform readiness supports partial releases and distinguishes draft, missing and unapproved packages',()=>{
  const release=releaseFixture()[0];
  assert.equal(platformStatus(release,'linux').label,'可下载');assert.equal(platformStatus(release,'macos').label,'暂未提供');
  assert.equal(platformStatus({...release,published:false},'linux').label,'已就绪');
  assert.equal(assetReady({...release.assets[0],approved:false}),false);
  assert.equal(platformStatus({...release,assets:[{...release.assets[0],signature:''}]},'linux').label,'待确认');
  const supplemented={...release,assets:[...release.assets,releaseAsset(release.id,'macos',release.version)]};
  assert.equal(platformStatus(supplemented,'macos').label,'可下载');assert.equal(supplemented.published,true);
});

test('release workspace switches versions and binds supplement actions to the exact selected release and platform',async()=>{
  const calls:string[]=[];let ui!:TestRenderer.ReactTestRenderer;
  const releases=releaseFixture().map(r=>({...r,title:''}));
  function Harness(){const [id,setId]=React.useState(releases[0].id);return <ReleaseWorkspace releases={releases} selectedId={id} onSelect={setId} admin loading={false} channel="all" onChannel={()=>{}} visitorOS="macos" busy={false} error="" onCreate={()=>{}} onEdit={()=>{}} onVisibility={()=>{}} onDelete={()=>{}} onApprove={()=>{}} onRemove={()=>{}} onUpload={(release,os)=>calls.push(`${release.id}:${os}`)}/>;}
  try{
    await act(async()=>{ui=TestRenderer.create(<Harness/>);});
    const tab=(name:string)=>ui.root.findAllByProps({role:'tab'}).find(n=>text(n).includes(name))!;
    await act(async()=>tab('macOS').props.onClick());
    assert.ok(text(ui.root).includes('不影响其他平台的发布与下载'));
    await act(async()=>ui.root.findAllByType('button').find(b=>text(b)==='上传安装包')!.props.onClick());
    assert.deepEqual(calls,['release-006:macos']);
    await act(async()=>ui.root.findAllByType('button').find(b=>b.props.className==='rw-version'&&text(b).includes('v0.0.5'))!.props.onClick());
    await act(async()=>ui.root.findAllByType('button').find(b=>text(b)==='补充安装包')!.props.onClick());
    assert.deepEqual(calls,['release-006:macos','release-005:macos']);
    assert.equal(ui.root.findByProps({'aria-label':'版本 0.0.5 详情'}).type,'article');
  }finally{await act(async()=>ui?.unmount());}
});
