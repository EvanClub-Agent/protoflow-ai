/**
 * Mobile & Multi-Platform Architecture Types for Alex (ProtoFlow AI).
 */

export type PagePlatform = 'desktop' | 'mobile';
export type ProjectMode = 'desktop' | 'mobile' | 'hybrid';
export type MobileDevicePreset = 'iphone' | 'iphone-pro' | 'iphone-promax';

export interface MobileDeviceSpec {
  id: MobileDevicePreset;
  label: string;
  shortLabel: string;
  subtitle: string;
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
}

export const MOBILE_DEVICE_SPECS: Record<MobileDevicePreset, MobileDeviceSpec> = {
  iphone: {
    id: 'iphone',
    label: 'iPhone 标准屏',
    shortLabel: 'iPhone',
    subtitle: '393 × 852 pt',
    width: 393,
    height: 852,
    safeTop: 50,
    safeBottom: 28,
  },
  'iphone-pro': {
    id: 'iphone-pro',
    label: 'iPhone Pro',
    shortLabel: 'Pro',
    subtitle: '402 × 874 pt',
    width: 402,
    height: 874,
    safeTop: 52,
    safeBottom: 28,
  },
  'iphone-promax': {
    id: 'iphone-promax',
    label: 'iPhone Pro Max',
    shortLabel: 'Pro Max',
    subtitle: '440 × 956 pt',
    width: 440,
    height: 956,
    safeTop: 54,
    safeBottom: 30,
  },
};

export const MOBILE_DEVICE_LIST: MobileDeviceSpec[] = [
  MOBILE_DEVICE_SPECS.iphone,
  MOBILE_DEVICE_SPECS['iphone-pro'],
  MOBILE_DEVICE_SPECS['iphone-promax'],
];

export function isPageRootType(type: string | undefined | null): boolean {
  return type === 'Page' || type === 'MobilePage';
}

export function isMobileComponentType(type: string | undefined | null): boolean {
  if (!type) return false;
  return type === 'MobilePage' || /^M[A-Z]/.test(type);
}

export function inferSourcePlatform(source?: string | null): PagePlatform {
  if (!source) return 'desktop';
  if (/\/\/\s*@protoflow\s+platform:\s*mobile\b/i.test(source)) return 'mobile';
  if (/<MobilePage[\s>]/.test(source)) return 'mobile';
  return 'desktop';
}

export function resolvePagePlatform(
  page?: { platform?: PagePlatform } | null,
  source?: string | null,
): PagePlatform {
  if (page?.platform === 'mobile' || page?.platform === 'desktop') {
    // If source explicitly switched root to <MobilePage> or <Page>, honor the code truth when present
    if (source && source.trim()) {
      if (/<MobilePage[\s>]/.test(source)) return 'mobile';
      if (/<Page[\s>]/.test(source) && !/\/\/\s*@protoflow\s+platform:\s*mobile\b/i.test(source)) return 'desktop';
    }
    return page.platform;
  }
  return inferSourcePlatform(source);
}
