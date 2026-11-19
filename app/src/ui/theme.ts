import { useColorScheme } from 'react-native';

import type { SupplyIcon } from '../core/domain/catalog';

/**
 * High-contrast palette tuned for outdoor use in daylight (light) and for
 * night outreach (dark). Teal is the brand colour; rose is reserved for
 * naloxone and other life-saving supplies so it always stands out.
 */
const light = {
  scheme: 'light' as 'light' | 'dark',
  bg: '#F3F7F6',
  surface: '#FFFFFF',
  surfaceAlt: '#E8F0EE',
  text: '#0E211D',
  textMuted: '#55706A',
  border: '#D3E1DD',
  primary: '#0F766E',
  primaryPressed: '#0B5E58',
  primaryText: '#FFFFFF',
  primarySoft: '#D2EEE9',
  danger: '#C81E3A',
  dangerSoft: '#FDE3E7',
  warning: '#A85A00',
  warningSoft: '#FFF1D6',
  success: '#157A3C',
  successSoft: '#DDF7E6',
  info: '#1D5FAF',
  infoSoft: '#E1ECFB',
  overlay: 'rgba(8, 22, 19, 0.55)',
};

const dark: typeof light = {
  scheme: 'dark',
  bg: '#0A1513',
  surface: '#12211E',
  surfaceAlt: '#1A2E2A',
  text: '#E9F3F1',
  textMuted: '#93AFA8',
  border: '#24403A',
  primary: '#2BB5A6',
  primaryPressed: '#22968A',
  primaryText: '#04201C',
  primarySoft: '#123B36',
  danger: '#FF5C77',
  dangerSoft: '#3A1520',
  warning: '#FFB347',
  warningSoft: '#3A2A10',
  success: '#4ADE80',
  successSoft: '#0F3020',
  info: '#7FB2FF',
  infoSoft: '#132845',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 };
export const font = {
  tiny: 12,
  small: 14,
  body: 16,
  title: 20,
  heading: 26,
  display: 34,
};

/** Tile accent per supply family (light, dark). */
const SUPPLY_TINTS: Record<SupplyIcon, [string, string]> = {
  needle: ['#0F766E', '#2BB5A6'],
  naloxone: ['#C81E3A', '#FF5C77'],
  strip: ['#6D28D9', '#B79CFF'],
  cooker: ['#0369A1', '#6CC4F5'],
  cotton: ['#0369A1', '#6CC4F5'],
  water: ['#0369A1', '#6CC4F5'],
  pad: ['#0369A1', '#6CC4F5'],
  tourniquet: ['#475569', '#A8B8CC'],
  sharps: ['#B45309', '#FFB347'],
  wound: ['#C2410C', '#FF9A62'],
  pipe: ['#92400E', '#E9B872'],
  condom: ['#BE185D', '#FF8CC6'],
  hygiene: ['#15803D', '#4ADE80'],
  food: ['#15803D', '#4ADE80'],
  box: ['#475569', '#A8B8CC'],
};

export function supplyTint(icon: SupplyIcon, theme: Theme): string {
  const [l, d] = SUPPLY_TINTS[icon] ?? SUPPLY_TINTS.box;
  return theme === dark ? d : l;
}

export const isDark = (t: Theme) => t === dark;
