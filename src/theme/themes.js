import { Platform } from 'react-native';

export const THEME_IDS = {
  MATERIAL_YOU: 'material_you',
};

export const DEFAULT_THEME_ID = THEME_IDS.MATERIAL_YOU;

export function getContrastingTextColor(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return '#FFFFFF';
  const clean = hexColor.replace('#', '').trim();
  const normalized =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean;
  if (normalized.length !== 6) return '#FFFFFF';
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0F172A' : '#FFFFFF';
}

const cardShadow =
  Platform.OS === 'android'
    ? { elevation: 3 }
    : {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      };

export const MATERIAL_YOU_THEME = Object.freeze({
  id: THEME_IDS.MATERIAL_YOU,
  name: 'Material You',
  description: 'Visual moderno com superfícies elevadas e botões em pílula',
  isDark: false,
  shape: Object.freeze({
    radiusCard: 18,
    radiusButton: 24,
    radiusInput: 24,
    borderWidth: 1,
  }),
  cardShadow,
  typography: Object.freeze({
    headingWeight: '600',
    labelWeight: '600',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  }),
  colors: Object.freeze({
    primary: '#1A73E8',
    principal: '#1A73E8',
    primaryText: '#FFFFFF',
    textoPrincipal: '#FFFFFF',
    accent: '#1A73E8',
    accentSoft: 'rgba(26, 115, 232, 0.12)',

    background: '#F1F3F4',
    card: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceMuted: '#E8EAED',
    inputBackground: '#F8F9FA',
    dividerColor: '#E8EAED',

    text: '#202124',
    textoEscuro: '#202124',
    textSecondary: '#5F6368',
    textMuted: '#70757A',
    border: '#DADCE0',
    borderColor: '#DADCE0',
    disabledBackground: '#E2E8F0',

    success: '#1E8E3E',
    successSoft: 'rgba(30, 142, 62, 0.12)',
    verdeSuave: 'rgba(30, 142, 62, 0.14)',
    badgeBg: 'rgba(26, 115, 232, 0.12)',
    badgeText: '#1A73E8',

    warning: '#F29900',
    warningSoft: 'rgba(242, 153, 0, 0.14)',
    warningText: '#92400E',

    danger: '#D93025',
    logoutRed: '#D93025',
    dangerSoft: 'rgba(217, 48, 37, 0.12)',
    dangerText: '#991B1B',

    overlay: 'rgba(15, 23, 42, 0.48)',
  }),
});

export function getThemeById() {
  return MATERIAL_YOU_THEME;
}
