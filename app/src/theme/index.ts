import type { ViewStyle } from 'react-native';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  onPrimary: string;
  accent: string;
  onAccent: string;
  accentSurface: string;
  danger: string;
  dangerSurface: string;
  success: string;
  warning: string;
  recording: string;
  overlay: string;
}

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  // Fill and edge for a panel: frosted glass in dark, a flat grey block in light.
  glass: ViewStyle;
}

// Neutral black, white and grey. Red is the only colour and belongs to the microphone.
const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F4F4F4',
  surfaceMuted: '#E8E8E8',
  border: '#E5E5E5',
  text: '#0D0D0D',
  textMuted: '#5D5D5D',
  textFaint: '#9B9B9B',
  primary: '#0D0D0D',
  onPrimary: '#FFFFFF',
  accent: '#0D0D0D',
  onAccent: '#FFFFFF',
  accentSurface: '#F4F4F4',
  danger: '#D92D20',
  dangerSurface: '#FDECEA',
  success: '#12A150',
  warning: '#C27803',
  recording: '#EF4444',
  overlay: 'rgba(0,0,0,0.4)',
};

// Dark glass: frosted translucent panels over a near-black backdrop with faint cool light.
const darkColors: ThemeColors = {
  background: '#07080A',
  surface: 'rgba(255,255,255,0.07)',
  surfaceMuted: 'rgba(255,255,255,0.14)',
  border: 'rgba(255,255,255,0.14)',
  text: '#F5F6FA',
  textMuted: 'rgba(232,236,255,0.68)',
  textFaint: 'rgba(232,236,255,0.42)',
  primary: '#FFFFFF',
  onPrimary: '#0A0B12',
  accent: '#DDE3F2',
  onAccent: '#0A0B12',
  accentSurface: 'rgba(255,255,255,0.12)',
  danger: '#FF7B72',
  dangerSurface: 'rgba(255,90,82,0.16)',
  success: '#3DD68C',
  warning: '#F2B544',
  recording: '#FF5A52',
  overlay: 'rgba(0,0,0,0.6)',
};

function glassFor(colors: ThemeColors): ViewStyle {
  return { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border };
}

export const lightTheme: Theme = {
  dark: false,
  colors: lightColors,
  glass: { backgroundColor: lightColors.surface },
};
export const darkTheme: Theme = { dark: true, colors: darkColors, glass: glassFor(darkColors) };

// The emblem's dark green, used for the launch screen and sign-in. `green` must stay equal to
// the splash backgroundColor in app.json so the native splash hands over without a flash.
export const brand = {
  green: '#011A1A',
  greenTop: '#022322',
  greenBottom: '#060A0A',
  // Cool mint light, the colour the chrome reflects.
  glow: '150,225,210',
} as const;

// The floating tab bar; tab screens reserve this much room at the bottom.
export const tabBar = { height: 66, inset: 16, gap: 12 } as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

// System sans only (San Francisco on iOS, Roboto on Android); hierarchy comes from size and weight.
export const typography = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.6,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  overline: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  mono: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
    fontVariant: ['tabular-nums' as const],
  },
};

// The glass look only works on a dark backdrop, so the app is dark regardless of system setting.
export function useTheme(): Theme {
  return darkTheme;
}
