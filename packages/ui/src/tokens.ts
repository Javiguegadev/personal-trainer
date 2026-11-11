/** Semantic colors for one color scheme. Text/background pairs meet WCAG AA (4.5:1) for body text. */
export interface Palette {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  border: string;
  /** Primary actions (filled buttons, links, focus). `onPrimary` is the text on top of it. */
  primary: string;
  onPrimary: string;
  danger: string;
  dangerSurface: string;
  warning: string;
  warningSurface: string;
  info: string;
  infoSurface: string;
  success: string;
  successSurface: string;
}

const light: Palette = {
  background: '#f6f8f6',
  surface: '#ffffff',
  surfaceMuted: '#eef2ef',
  text: '#111827',
  textMuted: '#4b5650',
  border: '#cfd8d2',
  primary: '#15803d',
  onPrimary: '#ffffff',
  danger: '#b91c1c',
  dangerSurface: '#fdecec',
  warning: '#92400e',
  warningSurface: '#fef3c7',
  info: '#1d4ed8',
  infoSurface: '#e8effd',
  success: '#166534',
  successSurface: '#e7f6ec',
};

const dark: Palette = {
  background: '#0b0f0d',
  surface: '#141a17',
  surfaceMuted: '#1b2420',
  text: '#f4f6f4',
  textMuted: '#a3ada7',
  border: '#2f3a34',
  primary: '#22c55e',
  onPrimary: '#052e16',
  danger: '#f87171',
  dangerSurface: '#2a1515',
  warning: '#fbbf24',
  warningSurface: '#2a2210',
  info: '#93c5fd',
  infoSurface: '#121c2b',
  success: '#4ade80',
  successSurface: '#10231a',
};

export const tokens = {
  color: {
    brand: '#16a34a',
    brandForeground: '#ffffff',
    protein: '#2563eb',
    carbs: '#f59e0b',
    fat: '#e11d48',
    calories: '#16a34a',
  },
  palette: { light, dark },
  radius: { sm: 6, md: 10, lg: 16, full: 999 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  fontSize: { caption: 13, body: 16, label: 15, subtitle: 18, title: 28, display: 34 },
  layout: {
    /** Content width cap on web and tablets (mobile-first: phones use the full width). */
    maxContentWidth: 560,
    /** Minimum touch target (WCAG 2.5.5 / platform guidelines). */
    minTouchTarget: 48,
  },
} as const;

export type Tokens = typeof tokens;
export type ColorScheme = keyof Tokens['palette'];
