import React, {useEffect, useId, useState} from 'react';
import {Apple, Monitor, Terminal, Download, Plus, Search, ArrowUpRight, Check, AlertCircle, Upload, MoreHorizontal} from 'lucide-react';
import {formatBytes, PLATFORM_LABELS, type DesktopRelease, type DesktopReleaseAsset, type ReleaseChannel, type ReleaseOS} from '../services/releaseClient';
import {assetReady, platformStatus, RELEASE_PLATFORMS, releaseHeading, releaseSubtitle, releaseTitleIssue} from './releasePresentation';

interface Props {
  releases: DesktopRelease[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  admin: boolean;
  loading: boolean;
  channel: 'all' | ReleaseChannel;
  onChannel: (channel: 'all' | ReleaseChannel) => void;
  visitorOS: ReleaseOS;
  busy: boolean;
  error: string;
  onCreate: () => void;
  onEdit: (release: DesktopRelease) => void;
  onVisibility: (release: DesktopRelease) => void;
  onDelete: (release: DesktopRelease) => void;
  onUpload: (release: DesktopRelease, os: ReleaseOS) => void;
  onApprove: (release: DesktopRelease, asset: DesktopReleaseAsset) => void;
  onRemove: (release: DesktopRelease, asset: DesktopReleaseAsset) => void;
}
function PlatformIcon({os}: {os: ReleaseOS}) {
  const Icon = os === 'windows' ? Monitor : os === 'macos' ? Apple : Terminal;
  return <Icon size={17} aria-hidden="true"/>;
}
function date(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat('zh-CN', {year:'numeric', month:'2-digit', day:'2-digit'}).format(time) : value;
}
function Notes({text}: {text: string}) {
  if (!text.trim()) return <p className="rw-muted">尚未填写更新说明。</p>;
  // Changelog supports simple headings/lists as plain text, never arbitrary HTML.
  return <div className="rw-notes">{text.split('\n').map((line, index) =>
    /^#{1,6}\s/.test(line) ? <h3 key={index}>{line.replace(/^#{1,6}\s+/, '')}</h3>
      : /^[-*]\s/.test(line) ? <p className="rw-note-item" key={index}>{line.replace(/^[-*]\s+/, '')}</p>
      : line.trim() ? <p key={index}>{line}</p> : <div className="rw-note-space" key={index}/> )}</div>;
}

export function ReleaseWorkspace(props: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  useEffect(() => {
    // A newly created release must remain reachable even after a prior search or
    // published-only filter. Ordinary filtering does not change selectedId.
    const selected = props.releases.find(release => release.id === props.selectedId);
    if (!selected) return;
    if (!`${selected.version} ${selected.title}`.toLowerCase().includes(query.trim().toLowerCase())) setQuery('');
    if (status !== 'all' && selected.published !== (status === 'published')) setStatus('all');
  }, [props.selectedId]);
  const filtered = props.releases.filter(release =>
    (props.channel === 'all' || release.channel === props.channel) &&
    (!props.admin || status === 'all' || release.published === (status === 'published')) &&
    `${release.version} ${release.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const active = filtered.find(release => release.id === props.selectedId) ?? filtered[0];
  return <section className="release-workspace" aria-label={props.admin ? '版本管理工作区' : '版本下载工作区'}>
    <div className="rw-page-heading">
      <div><h1>{props.admin ? '版本管理' : '下载 Alex'}</h1><p>{props.admin ? '按版本维护，按平台逐步发布。' : '选择版本和平台，下载适合你的安装包。'}</p></div>
      {props.admin && <button className="rw-button rw-primary" onClick={props.onCreate}><Plus size={16}/>新建版本</button>}
    </div>
    <div className="rw-layout">
      <aside className="rw-sidebar" aria-label="版本列表">
        <div className="rw-list-title"><h2>全部版本</h2><span>{filtered.length}</span></div>
        <label className="rw-search"><Search size={15}/><input aria-label="搜索版本" placeholder="搜索版本号或主题" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="rw-filters">
          <select aria-label="版本通道" value={props.channel} onChange={e=>props.onChannel(e.target.value as Props['channel'])}><option value="all">全部通道</option><option value="stable">正式版</option><option value="beta">测试版</option></select>
          {props.admin && <select aria-label="发布状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="published">已公开</option><option value="draft">草稿</option></select>}
        </div>
        <nav className="rw-version-list" aria-label="选择版本" aria-busy={props.loading}>
          {props.loading && !props.releases.length ? <p className="rw-empty" role="status">正在读取版本…</p> : filtered.map(release => <button key={release.id} aria-current={active?.id === release.id ? 'true' : undefined} className="rw-version" onClick={()=>props.onSelect(release.id)}>
            <span className="rw-version-top"><strong>v{release.version}</strong><span className={`rw-state ${release.published?'rw-state-live':''}`}>{release.published?'已公开':'草稿'}</span></span>
            <span className="rw-version-meta">{release.channel==='beta'?'测试版':'正式版'} · {date(release.published ? release.publishedAt : release.updatedAt)}</span>
            <span className="rw-version-platforms">{RELEASE_PLATFORMS.map(os => <span key={os} className={platformStatus(release,os).ready ? 'rw-available' : ''} title={`${PLATFORM_LABELS[os].shortName}：${platformStatus(release,os).label}`}><i/>{PLATFORM_LABELS[os].shortName}</span>)}</span>
          </button>)}
          {!props.loading && !filtered.length && <p className="rw-empty">{props.releases.length ? '没有匹配的版本。' : props.admin ? '还没有版本，先创建一个草稿。' : '暂时没有公开版本。'}</p>}
        </nav>
      </aside>
      {active ? <ReleaseDetails key={active.id} {...props} release={active}/> : <div className="rw-detail rw-empty-detail"><Upload size={30}/><h2>{props.admin ? '从一个平台开始' : '安装包准备中'}</h2><p>{props.admin ? '创建版本草稿，上传任意一个平台的安装包即可发布。其余平台之后补充。' : '发布后，你可以在这里选择版本并下载安装包。'}</p></div>}
    </div>
  </section>;
}

function ReleaseDetails(props: Props & {release: DesktopRelease}) {
  const {release, admin} = props;
  const [platform, setPlatform] = useState<ReleaseOS>(() => admin
    ? RELEASE_PLATFORMS.find(os => release.assets.some(asset=>asset.os===os)) ?? props.visitorOS : props.visitorOS);
  const [copied, setCopied] = useState<string | null>(null);
  const tabId = useId();
  const current = platformStatus(release, platform);
  const ready = release.assets.filter(assetReady);
  const readyPlatforms = RELEASE_PLATFORMS.filter(os => platformStatus(release, os).ready);
  const titleIssue = releaseTitleIssue(release.version, release.title);
  const theme = releaseSubtitle(release);
  const older = !admin && !current.ready ? props.releases.find(other => other.id !== release.id && other.published && other.channel === release.channel && other.assets.some(a=>a.os===platform && assetReady(a))) : undefined;
  return <article className="rw-detail" aria-label={`版本 ${release.version} 详情`}>
    <header className="rw-detail-header">
      <div className="rw-detail-top"><div><div className="rw-eyebrow">{release.channel==='beta'?'测试版 · Beta':'正式版 · Stable'}<span className={`rw-state ${release.published?'rw-state-live':''}`}>{release.published?'已公开':'草稿'}</span>{release.mandatory && <span className="rw-state">重要更新</span>}</div><h2>{releaseHeading(release)}</h2>{theme && <p className="rw-theme">{theme}</p>}<p className="rw-muted rw-date">{release.published?'发布于':'草稿更新于'} {date(release.published?release.publishedAt:release.updatedAt)}</p></div>
        {admin && <div className="rw-detail-actions"><button className="rw-button" disabled={props.busy} onClick={()=>props.onEdit(release)}>编辑信息</button>{!release.published && <button className="rw-button rw-primary" disabled={props.busy || !ready.length || Boolean(titleIssue)} onClick={()=>props.onVisibility(release)}>发布版本</button>}<details className="rw-more"><summary aria-label="更多版本操作"><MoreHorizontal size={20}/></summary><div><button disabled={props.busy || (!release.published && (!ready.length || Boolean(titleIssue)))} onClick={()=>props.onVisibility(release)}>{release.published?'撤回为草稿':'发布版本'}</button><button className="rw-danger" disabled={props.busy} onClick={()=>props.onDelete(release)}>删除版本</button></div></details></div>}
      </div>
      <div className="rw-release-summary"><span className="rw-status-icon">{ready.length?<Check size={16}/>:<Upload size={16}/>}</span><p>{release.published ? readyPlatforms.length ? `当前可下载：${readyPlatforms.map(os=>PLATFORM_LABELS[os].shortName).join('、')}` : '当前没有可下载的安装包' : ready.length ? `${readyPlatforms.map(os=>PLATFORM_LABELS[os].shortName).join('、')} 安装包已就绪，可以发布。` : '上传任意平台的安装包后，即可发布。'}{admin && <small>{release.published ? '可继续补充其他平台，无需新建版本或撤回发布。' : '草稿仅管理员可见，无需等齐所有平台。'}</small>}</p></div>
      {admin && titleIssue && <p className="rw-warning" role="alert"><AlertCircle size={15}/><span>{titleIssue}<small>原始标题：{release.title}</small></span></p>}
      {props.error && <p role="alert" className="rw-warning">{props.error}</p>}
    </header>
    <section className="rw-packages" aria-label="平台安装包">
      <div className="rw-section-heading"><h3>平台安装包</h3><span>{readyPlatforms.length} / 3 个平台{release.published?'可下载':'已就绪'}</span></div>
      <div className="rw-platform-tabs" role="tablist" aria-label="安装包平台">{RELEASE_PLATFORMS.map(os => {
        const state = platformStatus(release,os);
        return <button key={os} role="tab" id={`${tabId}-${os}`} aria-controls={`${tabId}-panel`} aria-selected={os===platform} tabIndex={os===platform?0:-1} onClick={()=>setPlatform(os)} onKeyDown={e=>{const move=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(move){e.preventDefault();const next=RELEASE_PLATFORMS[(RELEASE_PLATFORMS.indexOf(os)+move+3)%3];setPlatform(next);document.getElementById(`${tabId}-${next}`)?.focus();}}}><PlatformIcon os={os}/><span>{PLATFORM_LABELS[os].shortName}<small>{state.label}{state.assets.length ? ` · ${state.assets.length} 个包` : ''}</small></span>{os===platform&&<i/>}</button>;
      })}</div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${platform}`} className="rw-platform-panel">
        <div className="rw-platform-heading"><div><h4>{PLATFORM_LABELS[platform].name}</h4><p>{PLATFORM_LABELS[platform].badge}</p></div>{admin && <button className="rw-button" disabled={props.busy} onClick={()=>props.onUpload(release,platform)}><Plus size={14}/>{current.assets.length?'补充安装包':'上传安装包'}</button>}</div>
        {!current.assets.length ? <div className="rw-platform-empty"><p>此版本暂未提供 {PLATFORM_LABELS[platform].shortName} 安装包</p><small>{admin ? '可以稍后补充，不影响其他平台的发布与下载。' : '其他平台的安装包不适用于此系统，请等待对应平台发布。'}</small>{older && <button className="rw-text-button" onClick={()=>props.onSelect(older.id)}>查看提供 {PLATFORM_LABELS[platform].shortName} 的 v{older.version}<ArrowUpRight size={14}/></button>}</div> : <div className="rw-assets">{current.assets.map(asset => <div className="rw-asset" key={asset.id}>
          <div className="rw-asset-main"><div className="rw-asset-info"><strong>{asset.arch==='arm64' ? platform==='macos'?'Apple Silicon · arm64':'ARM64' : asset.arch==='universal'?'通用架构':'Intel / AMD · x64'}<span>.{asset.packageType}</span></strong><p className="rw-file-name">{asset.fileName}</p><small>{formatBytes(asset.sizeBytes)} · {asset.hosted?'服务端托管':'外部下载'}{admin && ` · ${assetReady(asset)?'已就绪':'待确认签名'}`}</small></div><div className="rw-asset-actions">{assetReady(asset) && release.published && <a className="rw-button rw-primary" href={asset.downloadUrl} download={asset.fileName} aria-label={`下载 ${asset.fileName}`}><Download size={14}/>下载</a>}{admin&&!assetReady(asset)&&<button className="rw-button" disabled={props.busy} onClick={()=>props.onApprove(release,asset)}>确认并签名</button>}{admin&&<button className="rw-text-button rw-danger" disabled={props.busy} onClick={()=>props.onRemove(release,asset)} aria-label={`移除 ${asset.fileName}`}>移除</button>}</div></div>
          <details className="rw-file-details"><summary>文件校验信息</summary><div><code>SHA-256: {asset.sha256}</code><button className="rw-text-button" onClick={async()=>{try{await navigator.clipboard.writeText(asset.sha256);setCopied(asset.id);}catch{setCopied('failed');}}}>{copied===asset.id?'已复制':'复制摘要'}</button>{copied==='failed'&&<span role="status">复制失败，请选中摘要手动复制。</span>}</div></details>
        </div>)}</div>}
        {!!current.ready && <details className="rw-install-guide"><summary>{PLATFORM_LABELS[platform].shortName} 安装说明</summary><p>{PLATFORM_LABELS[platform].installSummary}</p><p>已有较高版本时，请手动下载安装包；自动更新不会执行版本号降低。</p></details>}
      </div>
    </section>
    <section className="rw-changelog"><h3>更新说明</h3><Notes text={release.notes}/></section>
  </article>;
}
