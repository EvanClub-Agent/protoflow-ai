import type { DesktopRelease, DesktopReleaseAsset, ReleaseInput, ReleaseOS } from '../services/releaseClient';

export const RELEASE_PLATFORMS: ReleaseOS[] = ['windows', 'macos', 'linux'];
export const releaseHeading = (release: Pick<DesktopRelease, 'version'>) => `Alex v${release.version}`;
// Older forms stored the generated product/version heading as an independent title.
const legacyHeading = /^(?:Alex|ProtoFlow AI)\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(?=\s|$)/i;
export function releaseTitleIssue(version: string, title: string): string | null {
  const embedded = legacyHeading.exec(title.trim())?.[1];
  return embedded && embedded !== version
    ? `标题中的版本号 ${embedded} 与实际版本 ${version} 不一致。请修正标题，或留空使用实际版本号。` : null;
}
export function releaseSubtitle(release: Pick<DesktopRelease, 'title' | 'version'>): string {
  if (releaseTitleIssue(release.version, release.title)) return '';
  if (legacyHeading.test(release.title.trim())) return release.title.trim().replace(legacyHeading, '').trim().replace(/^(正式版|测试版)$/, '');
  return release.title;
}
export function releaseInput(form: ReleaseInput): ReleaseInput {
  const version = form.version.trim();
  const title = form.title.trim();
  const issue = releaseTitleIssue(version, title);
  if (issue) throw new Error(issue);
  // A blank optional theme explicitly means use the canonical product/version title.
  return {...form, version, title: title || releaseHeading({version}), notes: form.notes.trim()};
}
export function assetReady(asset: DesktopReleaseAsset): boolean {
  return asset.approved === true && Boolean(asset.signature) && asset.sizeBytes > 0 && Boolean(asset.downloadUrl);
}
export function platformStatus(release: DesktopRelease, os: ReleaseOS) {
  const assets = release.assets.filter(asset => asset.os === os);
  const ready = assets.filter(assetReady).length;
  return {assets, ready, label: !assets.length ? '暂未提供' : !ready ? '待确认' : release.published ? '可下载' : '已就绪'};
}
export function assetVersionIssue(fileName: string, version: string): string | null {
  // Only the documented Alex / ProtoFlow artifact naming convention establishes
  // a version here. Arbitrary filenames are not treated as package metadata.
  const named = /^(?:Alex|ProtoFlow-AI)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?:linux|win|mac|darwin)-/i.exec(fileName)?.[1];
  return named && named !== version ? `文件名中的版本号 ${named} 与当前版本 ${version} 不一致，请选择对应版本的安装包。` : null;
}
