import { useColorScheme } from 'react-native';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
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
}

const lightColors: ThemeColors = {
  background: '#F7F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#EFEFF2',
  border: '#E2E2E8',
  text: '#17171C',
  textMuted: '#6E6E7A',
  primary: '#5B5BD6',
  onPrimary: '#FFFFFF',
  danger: '#D64545',
  dangerSurface: '#FBECEC',
  success: '#2E9E6B',
  warning: '#C98A12',
  recording: '#E23E3E',
  overlay: 'rgba(0,0,0,0.45)',
};

const darkColors: ThemeColors = {
  background: '#0F0F13',
  surface: '#1A1A21',
  surfaceMuted: '#26262F',
  border: '#33333E',
  text: '#F2F2F5',
  textMuted: '#9A9AA6',
  primary: '#8A8AF0',
  onPrimary: '#12121A',
  danger: '#F06A6A',
  dangerSurface: '#3A1F1F',
  success: '#4CC38A',
  warning: '#E5B94E',
  recording: '#FF5C5C',
  overlay: 'rgba(0,0,0,0.6)',
};

export const lightTheme: Theme = { dark: false, colors: lightColors };
export const darkTheme: Theme = { dark: true, colors: darkColors };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const },
  heading: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
