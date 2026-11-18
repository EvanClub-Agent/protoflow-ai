import type {DesktopRelease, DesktopReleaseAsset, ReleaseOS} from '../../src/services/releaseClient';
export function releaseAsset(releaseId: string, os: ReleaseOS, version: string): DesktopReleaseAsset {
  const packageType = os === 'linux' ? 'deb' : os === 'macos' ? 'dmg' : 'exe';
  return {id:`asset-${releaseId}-${os}`,releaseId,os,arch:'x64',packageType,fileName:`Alex-${version}-${os==='macos'?'mac':os==='windows'?'win':os}-x64.${packageType}`,
    sizeBytes:106426812,sha256:'a'.repeat(64),hosted:true,downloadUrl:`/downloads/${releaseId}/${os}`,approved:true,signature:'fixture-signature',createdAt:'2026-11-13T09:00:00+08:00',updatedAt:'2026-11-13T09:00:00+08:00'};
}
export function releaseFixture(): DesktopRelease[] {
  return [
    {id:'release-006',version:'0.0.6',title:'Alex v0.2.0 正式版',notes:'### 修复\n- 支持移动审批中心按单据查看费用明细。',channel:'stable',mandatory:false,published:true,publishedAt:'2026-11-13T09:44:00+08:00',createdAt:'2026-11-13T09:44:00+08:00',updatedAt:'2026-11-13T09:44:00+08:00',assets:[releaseAsset('release-006','linux','0.0.6')]},
    {id:'release-005',version:'0.0.5',title:'跨平台预览与交互改进',notes:'改进多平台原型预览。',channel:'stable',mandatory:false,published:true,publishedAt:'2026-11-12T10:00:00+08:00',createdAt:'2026-11-12T10:00:00+08:00',updatedAt:'2026-11-12T10:00:00+08:00',assets:[releaseAsset('release-005','macos','0.0.5')]},
  ];
}
