import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@theme_preference';

export const COLORS = {
  light: {
    bg:           '#f1f5f9',
    card:         '#ffffff',
    cardAlt:      '#f8fafc',
    text:         '#1e293b',
    textSub:      '#64748b',
    textMuted:    '#94a3b8',
    border:       '#e2e8f0',
    borderLight:  '#f1f5f9',
    input:        '#f8fafc',
    inputBorder:  '#e2e8f0',
    header:       '#f8fafc',
    headerText:   '#1e293b',
    hotBg:        '#fffbeb',
    hotBorder:    '#fde68a',
    tabBg:        'rgba(248,250,252,0.55)',
    tabBorder:    'rgba(255,255,255,0.7)',
    blurTint:     'light',
    activePillBg: 'rgba(22,163,74,0.10)',
    activePillBorder: 'rgba(22,163,74,0.22)',
  },
  dark: {
    bg:           '#151B2C',
    card:         '#1E2436',
    cardAlt:      '#252D3D',
    text:         '#FFFFFF',
    textSub:      '#848E9C',
    textMuted:    '#4D5566',
    border:       '#2B3347',
    borderLight:  '#1E2436',
    input:        '#151B2C',
    inputBorder:  '#2B3347',
    header:       '#151B2C',
    headerText:   '#FFFFFF',
    hotBg:        '#1C1500',
    hotBorder:    '#3A2900',
    tabBg:        'rgba(21,27,44,0.75)',
    tabBorder:    'rgba(255,255,255,0.10)',
    blurTint:     'dark',
    activePillBg: 'rgba(247,166,0,0.15)',
    activePillBorder: 'rgba(247,166,0,0.35)',
  },
  sage: {
    bg:           '#F2EFE9',
    card:         '#FFFFFF',
    cardAlt:      '#6B7C5C',
    text:         '#2C2C2C',
    textSub:      '#7A7A6E',
    textMuted:    '#A89F94',
    border:       '#E0D9CE',
    borderLight:  '#EDE8E0',
    input:        '#FFFFFFCC',
    inputBorder:  '#E0D9CE',
    header:       '#F2EFE9',
    headerText:   '#2C2C2C',
    hotBg:        '#F5F0E8',
    hotBorder:    '#D9CEBE',
    tabBg:        'rgba(242,239,233,0.55)',
    tabBorder:    'rgba(255,255,255,0.7)',
    blurTint:     'light',
    activePillBg: 'rgba(90,122,74,0.10)',
    activePillBorder: 'rgba(90,122,74,0.22)',
  },
};

const ThemeContext = createContext({
  preference: 'system',
  setPreference: () => {},
  isDark: false,
  theme: 'light',
  colors: COLORS.light,
});

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val === 'light' || val === 'dark' || val === 'system' || val === 'sage') {
        setPreferenceState(val);
      }
    });
  }, []);

  const setPreference = async (val) => {
    setPreferenceState(val);
    await AsyncStorage.setItem(STORAGE_KEY, val);
  };

  const isDark = preference === 'dark' || (preference === 'system' && systemScheme === 'dark');
  const theme = preference === 'sage' ? 'sage' : (isDark ? 'dark' : 'light');
  const colors = COLORS[theme];

  return (
    <ThemeContext.Provider value={{ preference, setPreference, isDark, theme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
