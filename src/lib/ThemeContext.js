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
    bg:           '#0f172a',
    card:         '#1e293b',
    cardAlt:      '#162032',
    text:         '#f1f5f9',
    textSub:      '#94a3b8',
    textMuted:    '#64748b',
    border:       '#334155',
    borderLight:  '#1e293b',
    input:        '#0f172a',
    inputBorder:  '#334155',
    header:       '#0f172a',
    headerText:   '#f1f5f9',
    hotBg:        '#1c1a0f',
    hotBorder:    '#3d3000',
    tabBg:        'rgba(15,23,42,0.65)',
    tabBorder:    'rgba(255,255,255,0.12)',
    blurTint:     'dark',
    activePillBg: 'rgba(22,163,74,0.18)',
    activePillBorder: 'rgba(22,163,74,0.35)',
  },
};

const ThemeContext = createContext({
  preference: 'system',
  setPreference: () => {},
  isDark: false,
  colors: COLORS.light,
});

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val === 'light' || val === 'dark' || val === 'system') {
        setPreferenceState(val);
      }
    });
  }, []);

  const setPreference = async (val) => {
    setPreferenceState(val);
    await AsyncStorage.setItem(STORAGE_KEY, val);
  };

  const isDark = preference === 'dark' || (preference === 'system' && systemScheme === 'dark');
  const colors = COLORS[isDark ? 'dark' : 'light'];

  return (
    <ThemeContext.Provider value={{ preference, setPreference, isDark, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
