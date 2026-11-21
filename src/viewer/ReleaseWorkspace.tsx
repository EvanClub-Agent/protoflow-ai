import React, {useEffect, useId, useState} from 'react';
import {Apple, Monitor, Terminal, Download, Plus, Search, ArrowUpRight, Check, AlertCircle, Upload, MoreHorizontal} from 'lucide-react';
import {formatBytes, PLATFORM_LABELS, type DesktopRelease, type DesktopReleaseAsset, type ReleaseChannel, type ReleaseOS} from '../services/releaseClient';
import {assetReady, platformStatus, RELEASE_PLATFORMS, releaseHeading, releaseSubtitle, releaseTitleIssue} from './releasePresentation';
import {useI18n, type Locale} from '../i18n';

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
function date(value: string, locale: Locale) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat(locale === 'en-US' ? 'en-US' : 'zh-CN', {year:'numeric', month:'2-digit', day:'2-digit'}).format(time) : value;
}
function Notes({text}: {text: string}) {
  const {tr} = useI18n();
  if (!text.trim()) return <p className="rw-muted">{tr('尚未填写更新说明。', 'No release notes provided yet.')}</p>;
  // Changelog supports simple headings/lists as plain text, never arbitrary HTML.
  return <div className="rw-notes">{text.split('\n').map((line, index) =>
    /^#{1,6}\s/.test(line) ? <h3 key={index}>{line.replace(/^#{1,6}\s+/, '')}</h3>
      : /^[-*]\s/.test(line) ? <p className="rw-note-item" key={index}>{line.replace(/^[-*]\s+/, '')}</p>
      : line.trim() ? <p key={index}>{line}</p> : <div className="rw-note-space" key={index}/> )}</div>;
}

export function ReleaseWorkspace(props: Props) {
  const {locale, tr} = useI18n();
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
  return <section className="release-workspace" aria-label={props.admin ? tr('版本管理工作区', 'Release admin workspace') : tr('版本下载工作区', 'Release download workspace')}>
    <div className="rw-page-heading">
      <div><h1>{props.admin ? tr('版本管理', 'Release Management') : tr('下载 Alex', 'Download Alex')}</h1><p>{props.admin ? tr('按版本维护，按平台逐步发布。', 'Maintain by version and roll out installers per platform.') : tr('选择版本和平台，下载适合你的安装包。', 'Choose your version and platform to download the installer.')}</p></div>
      {props.admin && <button className="rw-button rw-primary" onClick={props.onCreate}><Plus size={16}/>{tr('新建版本', 'New Release')}</button>}
    </div>
    <div className="rw-layout">
      <aside className="rw-sidebar" aria-label={tr('版本列表', 'Release list')}>
        <div className="rw-list-title"><h2>{tr('全部版本', 'All Releases')}</h2><span>{filtered.length}</span></div>
        <label className="rw-search"><Search size={15}/><input aria-label={tr('搜索版本', 'Search releases')} placeholder={tr('搜索版本号或主题', 'Search version or title')} value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="rw-filters">
          <select aria-label={tr('版本通道', 'Release channel')} value={props.channel} onChange={e=>props.onChannel(e.target.value as Props['channel'])}><option value="all">{tr('全部通道', 'All Channels')}</option><option value="stable">{tr('正式版', 'Stable')}</option><option value="beta">{tr('测试版', 'Beta')}</option></select>
          {props.admin && <select aria-label={tr('发布状态', 'Publish status')} value={status} onChange={e=>setStatus(e.target.value)}><option value="all">{tr('全部状态', 'All Statuses')}</option><option value="published">{tr('已公开', 'Published')}</option><option value="draft">{tr('草稿', 'Draft')}</option></select>}
        </div>
        <nav className="rw-version-list" aria-label={tr('选择版本', 'Select version')} aria-busy={props.loading}>
          {props.loading && !props.releases.length ? <p className="rw-empty" role="status">{tr('正在读取版本…', 'Loading releases…')}</p> : filtered.map(release => <button key={release.id} aria-current={active?.id === release.id ? 'true' : undefined} className="rw-version" onClick={()=>props.onSelect(release.id)}>
            <span className="rw-version-top"><strong>v{release.version}</strong><span className={`rw-state ${release.published?'rw-state-live':''}`}>{release.published ? tr('已公开', 'Published') : tr('草稿', 'Draft')}</span></span>
            <span className="rw-version-meta">{release.channel==='beta' ? tr('测试版', 'Beta') : tr('正式版', 'Stable')} · {date(release.published ? release.publishedAt : release.updatedAt, locale)}</span>
            <span className="rw-version-platforms">{RELEASE_PLATFORMS.map(os => <span key={os} className={platformStatus(release,os).ready ? 'rw-available' : ''} title={`${PLATFORM_LABELS[os].shortName}${tr('：', ': ')}${platformStatus(release,os).label}`}><i/>{PLATFORM_LABELS[os].shortName}</span>)}</span>
          </button>)}
          {!props.loading && !filtered.length && <p className="rw-empty">{props.releases.length ? tr('没有匹配的版本。', 'No matching releases.') : props.admin ? tr('还没有版本，先创建一个草稿。', 'No releases yet. Create a draft first.') : tr('暂时没有公开版本。', 'No public releases available yet.')}</p>}
        </nav>
      </aside>
      {active ? <ReleaseDetails key={active.id} {...props} release={active}/> : <div className="rw-detail rw-empty-detail"><Upload size={30}/><h2>{props.admin ? tr('从一个平台开始', 'Start with Any Platform') : tr('安装包准备中', 'Installers Coming Soon')}</h2><p>{props.admin ? tr('创建版本草稿，上传任意一个平台的安装包即可发布。其余平台之后补充。', 'Create a release draft and upload an installer for any platform to publish. Other platforms can be added later.') : tr('发布后，你可以在这里选择版本并下载安装包。', 'Once published, you can select a version and download installers here.')}</p></div>}
    </div>
  </section>;
}

function ReleaseDetails(props: Props & {release: DesktopRelease}) {
  const {locale, tr} = useI18n();
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
  const readyPlatformText = readyPlatforms.map(os => PLATFORM_LABELS[os].shortName).join(tr('、', ', '));
  return <article className="rw-detail" aria-label={tr(`版本 ${release.version} 详情`, `Version ${release.version} details`)}>
    <header className="rw-detail-header">
      <div className="rw-detail-top"><div><div className="rw-eyebrow">{release.channel==='beta' ? tr('测试版 · Beta', 'Beta Channel') : tr('正式版 · Stable', 'Stable Channel')}<span className={`rw-state ${release.published?'rw-state-live':''}`}>{release.published ? tr('已公开', 'Published') : tr('草稿', 'Draft')}</span>{release.mandatory && <span className="rw-state">{tr('重要更新', 'Mandatory Update')}</span>}</div><h2>{releaseHeading(release)}</h2>{theme && <p className="rw-theme">{theme}</p>}<p className="rw-muted rw-date">{release.published ? tr('发布于', 'Published on') : tr('草稿更新于', 'Draft updated on')} {date(release.published?release.publishedAt:release.updatedAt, locale)}</p></div>
        {admin && <div className="rw-detail-actions"><button className="rw-button" disabled={props.busy} onClick={()=>props.onEdit(release)}>{tr('编辑信息', 'Edit Info')}</button>{!release.published && <button className="rw-button rw-primary" disabled={props.busy || !ready.length || Boolean(titleIssue)} onClick={()=>props.onVisibility(release)}>{tr('发布版本', 'Publish Release')}</button>}<details className="rw-more"><summary aria-label={tr('更多版本操作', 'More release actions')}><MoreHorizontal size={20}/></summary><div><button disabled={props.busy || (!release.published && (!ready.length || Boolean(titleIssue)))} onClick={()=>props.onVisibility(release)}>{release.published ? tr('撤回为草稿', 'Unpublish to Draft') : tr('发布版本', 'Publish Release')}</button><button className="rw-danger" disabled={props.busy} onClick={()=>props.onDelete(release)}>{tr('删除版本', 'Delete Release')}</button></div></details></div>}
      </div>
      <div className="rw-release-summary"><span className="rw-status-icon">{ready.length?<Check size={16}/>:<Upload size={16}/>}</span><p>{release.published ? readyPlatforms.length ? tr(`当前可下载：${readyPlatformText}`, `Available now: ${readyPlatformText}`) : tr('当前没有可下载的安装包', 'No installers available for download yet') : ready.length ? tr(`${readyPlatformText} 安装包已就绪，可以发布。`, `${readyPlatformText} installer(s) ready to publish.`) : tr('上传任意平台的安装包后，即可发布。', 'Upload an installer for any platform to publish.')}{admin && <small>{release.published ? tr('可继续补充其他平台，无需新建版本或撤回发布。', 'You can add installers for other platforms without creating a new version or unpublishing.') : tr('草稿仅管理员可见，无需等齐所有平台。', 'Drafts are visible only to admins; no need to wait for all platforms.')}</small>}</p></div>
      {admin && titleIssue && <p className="rw-warning" role="alert"><AlertCircle size={15}/><span>{titleIssue}<small>{tr(`原始标题：${release.title}`, `Original title: ${release.title}`)}</small></span></p>}
      {props.error && <p role="alert" className="rw-warning">{props.error}</p>}
    </header>
    <section className="rw-packages" aria-label={tr('平台安装包', 'Platform installers')}>
      <div className="rw-section-heading"><h3>{tr('平台安装包', 'Platform Installers')}</h3><span>{tr(`${readyPlatforms.length} / 3 个平台${release.published?'可下载':'已就绪'}`, `${readyPlatforms.length} / 3 platforms ${release.published ? 'available' : 'ready'}`)}</span></div>
      <div className="rw-platform-tabs" role="tablist" aria-label={tr('安装包平台', 'Installer platforms')}>{RELEASE_PLATFORMS.map(os => {
        const state = platformStatus(release,os);
        return <button key={os} role="tab" id={`${tabId}-${os}`} aria-controls={`${tabId}-panel`} aria-selected={os===platform} tabIndex={os===platform?0:-1} onClick={()=>setPlatform(os)} onKeyDown={e=>{const move=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(move){e.preventDefault();const next=RELEASE_PLATFORMS[(RELEASE_PLATFORMS.indexOf(os)+move+3)%3];setPlatform(next);document.getElementById(`${tabId}-${next}`)?.focus();}}}><PlatformIcon os={os}/><span>{PLATFORM_LABELS[os].shortName}<small>{state.label}{state.assets.length ? tr(` · ${state.assets.length} 个包`, ` · ${state.assets.length} ${state.assets.length === 1 ? 'pkg' : 'pkgs'}`) : ''}</small></span>{os===platform&&<i/>}</button>;
      })}</div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${platform}`} className="rw-platform-panel">
        <div className="rw-platform-heading"><div><h4>{PLATFORM_LABELS[platform].name}</h4><p>{PLATFORM_LABELS[platform].badge}</p></div>{admin && <button className="rw-button" disabled={props.busy} onClick={()=>props.onUpload(release,platform)}><Plus size={14}/>{current.assets.length ? tr('补充安装包', 'Add Installer') : tr('上传安装包', 'Upload Installer')}</button>}</div>
        {!current.assets.length ? <div className="rw-platform-empty"><p>{tr(`此版本暂未提供 ${PLATFORM_LABELS[platform].shortName} 安装包`, `No ${PLATFORM_LABELS[platform].shortName} installer available for this version yet`)}</p><small>{admin ? tr('可以稍后补充，不影响其他平台的发布与下载。', 'You can add it later without affecting other platforms.') : tr('其他平台的安装包不适用于此系统，请等待对应平台发布。', 'Installers for other platforms are not compatible with this OS. Please wait for this platform release.')}</small>{older && <button className="rw-text-button" onClick={()=>props.onSelect(older.id)}>{tr(`查看提供 ${PLATFORM_LABELS[platform].shortName} 的 v${older.version}`, `View v${older.version} with ${PLATFORM_LABELS[platform].shortName} installer`)}<ArrowUpRight size={14}/></button>}</div> : <div className="rw-assets">{current.assets.map(asset => <div className="rw-asset" key={asset.id}>
          <div className="rw-asset-main"><div className="rw-asset-info"><strong>{asset.arch==='arm64' ? platform==='macos'?'Apple Silicon · arm64':'ARM64' : asset.arch==='universal' ? tr('通用架构', 'Universal') : 'Intel / AMD · x64'}<span>.{asset.packageType}</span></strong><p className="rw-file-name">{asset.fileName}</p><small>{formatBytes(asset.sizeBytes)} · {asset.hosted ? tr('服务端托管', 'Server Hosted') : tr('外部下载', 'External Link')}{admin && ` · ${assetReady(asset) ? tr('已就绪', 'Ready') : tr('待确认签名', 'Pending signature')}`}</small></div><div className="rw-asset-actions">{assetReady(asset) && release.published && <a className="rw-button rw-primary" href={asset.downloadUrl} download={asset.fileName} aria-label={tr(`下载 ${asset.fileName}`, `Download ${asset.fileName}`)}><Download size={14}/>{tr('下载', 'Download')}</a>}{admin&&!assetReady(asset)&&<button className="rw-button" disabled={props.busy} onClick={()=>props.onApprove(release,asset)}>{tr('确认并签名', 'Approve & Sign')}</button>}{admin&&<button className="rw-text-button rw-danger" disabled={props.busy} onClick={()=>props.onRemove(release,asset)} aria-label={tr(`移除 ${asset.fileName}`, `Remove ${asset.fileName}`)}>{tr('移除', 'Remove')}</button>}</div></div>
          <details className="rw-file-details"><summary>{tr('文件校验信息', 'File Checksum')}</summary><div><code>SHA-256: {asset.sha256}</code><button className="rw-text-button" onClick={async()=>{try{await navigator.clipboard.writeText(asset.sha256);setCopied(asset.id);}catch{setCopied('failed');}}}>{copied===asset.id ? tr('已复制', 'Copied') : tr('复制摘要', 'Copy Hash')}</button>{copied==='failed'&&<span role="status">{tr('复制失败，请选中摘要手动复制。', 'Copy failed. Please select and copy manually.')}</span>}</div></details>
        </div>)}</div>}
        {!!current.ready && <details className="rw-install-guide"><summary>{tr(`${PLATFORM_LABELS[platform].shortName} 安装说明`, `${PLATFORM_LABELS[platform].shortName} Installation Guide`)}</summary><p>{PLATFORM_LABELS[platform].installSummary}</p><p>{tr('已有较高版本时，请手动下载安装包；自动更新不会执行版本号降低。', 'If a newer version is already installed, download the installer manually; auto-update never downgrades.')}</p></details>}
      </div>
    </section>
    <section className="rw-changelog"><h3>{tr('更新说明', 'Release Notes')}</h3><Notes text={release.notes}/></section>
  </article>;
}
