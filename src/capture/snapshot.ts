import type { Locale } from '../i18n/runtime';
import type { MobileDevicePreset, PagePlatform } from '../proto/mobile/types';
import type { ProtoDoc } from '../proto/types';
import type { PflowProjectMetadata, ProjectStateSnapshot } from '../utils/pflowBinaryCodec';
import type { CaptureOptions } from '../mcp/capturePreview';

export interface PreviewSnapshot {
  pageId: string; revision: string; platform: PagePlatform; doc: ProtoDoc;
  scope: CaptureOptions['scope']; fullPage: boolean; waitMs: number;
  locale: Locale; theme: 'light' | 'dark'; device: MobileDevicePreset;
  width: number; height: number; meta: PflowProjectMetadata;
  state: Pick<ProjectStateSnapshot, 'dbTables' | 'tableRows' | 'suppliers' | 'purchaseOrderItems' | 'acceptanceOrders' | 'draftAcceptanceHeader' | 'draftAcceptanceLines' | 'widgets'>;
}
