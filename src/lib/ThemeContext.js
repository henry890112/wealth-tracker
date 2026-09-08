import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@theme_preference';

const THEME_CHART_PALETTES = {
  light:   ['#8B8CF6', '#38BDF8', '#2DD4BF', '#B8A7FF', '#8092AE', '#CBD5E1'],
  dark:    ['#8B8CF6', '#38BDF8', '#2DD4BF', '#B8A7FF', '#8092AE', '#536177'],
  ocean:   ['#2DD4BF', '#67E8F9', '#5EEAD4', '#A7F3D0', '#64868D', '#94A3B8'],
  plum:    ['#D8A7FF', '#F0ABFC', '#C4B5FD', '#FDA4AF', '#987DAA', '#D1B9DF'],
  amber:   ['#F7B43A', '#55C5A5', '#E7C46A', '#D99355', '#68748A', '#A0AABC'],
  trading: ['#F7A600', '#16C784', '#D1D4DC', '#FF7A45', '#6D7480', '#536177'],
  sage:    ['#6B7C5C', '#9BAF88', '#B7A07D', '#7F9C94', '#A89F94', '#D8D1C7'],
  matisse2:['#3456D1', '#5B57D9', '#32C85A', '#65A2FF', '#8A82EE', '#83D995'],
  matisse: ['#D6A0EE', '#FF7C5C', '#14C9C7', '#F6B6FF', '#FFAA8F', '#70E4DF'],
  pissarro:['#A9C96D', '#75C400', '#B5E23A', '#D0E88E', '#8BAC36', '#DDF48D'],
  miro:    ['#408FE5', '#38CFCA', '#FFE15C', '#75B5F4', '#78E3DF', '#FFF09A'],
  mondrian:['#FF971A', '#F4463D', '#4178D8', '#FFBD63', '#FA7771', '#79A1EA'],
  macke:   ['#FFD081', '#FF5B61', '#5860F2', '#FFE0A8', '#FF9296', '#8990FF'],
};

const ACCENT_CONTRAST = {
  light: '#0B1020', dark: '#0B1020', ocean: '#071B24', plum: '#171022',
  amber: '#0F1117', trading: '#0B0E11', sage: '#FFFFFF',
  matisse2: '#FFFFFF', matisse: '#171719', pissarro: '#172009',
  miro: '#101820', mondrian: '#161616', macke: '#171719',
};

export const COLORS = {
  light: {
    bg:           '#F6F7FF',
    card:         '#ffffff',
    cardAlt:      '#EEF1FF',
    text:         '#17214A',
    textSub:      '#5E6B91',
    textMuted:    '#94A0BD',
    border:       '#DDE2F5',
    borderLight:  '#EAEDFA',
    input:        '#FFFFFF',
    inputBorder:  '#D8DDE6',
    header:       '#F6F7FF',
    headerText:   '#17214A',
    hotBg:        '#F0F2FF',
    hotBorder:    '#CACDF7',
    tabBg:        '#FFFFFF',
    tabBorder:    '#E4E7EC',
    blurTint:     'light',
    activePillBg: '#8B8CF6',
    activePillBorder: '#8B8CF6',
    accent:       '#8B8CF6',
  },
  dark: {
    bg:           '#0B1020',
    card:         '#161D35',
    cardAlt:      '#1B2542',
    text:         '#F4F7FF',
    textSub:      '#ABB8D4',
    textMuted:    '#667393',
    border:       '#2A3A61',
    borderLight:  '#1B2542',
    input:        '#11182D',
    inputBorder:  '#2A3A61',
    header:       '#0B1020',
    headerText:   '#F4F7FF',
    hotBg:        '#151F3B',
    hotBorder:    '#344B79',
    tabBg:        '#0B1020',
    tabBorder:    'rgba(184,196,255,0.16)',
    blurTint:     'dark',
    activePillBg: 'rgba(139,140,246,0.18)',
    activePillBorder: 'rgba(169,170,255,0.42)',
    accent:       '#8B8CF6',
  },
  ocean: {
    bg:           '#071B24',
    card:         '#0D2A35',
    cardAlt:      '#123642',
    text:         '#EFFBFB',
    textSub:      '#A9C8CD',
    textMuted:    '#64868D',
    border:       '#24505B',
    borderLight:  '#123642',
    input:        '#0A222C',
    inputBorder:  '#24505B',
    header:       '#071B24',
    headerText:   '#EFFBFB',
    hotBg:        '#0D3039',
    hotBorder:    '#27626A',
    tabBg:        '#071B24',
    tabBorder:    'rgba(149,221,218,0.16)',
    blurTint:     'dark',
    activePillBg: 'rgba(45,212,191,0.16)',
    activePillBorder: 'rgba(94,234,212,0.42)',
    accent:       '#2DD4BF',
  },
  plum: {
    bg:           '#171022',
    card:         '#261936',
    cardAlt:      '#302044',
    text:         '#FBF5FF',
    textSub:      '#D1B9DF',
    textMuted:    '#987DAA',
    border:       '#4A3263',
    borderLight:  '#302044',
    input:        '#1D132A',
    inputBorder:  '#4A3263',
    header:       '#171022',
    headerText:   '#FBF5FF',
    hotBg:        '#322044',
    hotBorder:    '#65457E',
    tabBg:        '#171022',
    tabBorder:    'rgba(224,188,255,0.16)',
    blurTint:     'dark',
    activePillBg: 'rgba(216,167,255,0.16)',
    activePillBorder: 'rgba(231,200,255,0.42)',
    accent:       '#D8A7FF',
  },
  amber: {
    bg:           '#0F1117',
    card:         '#1E2436',
    cardAlt:      '#252D3D',
    text:         '#F8FAFC',
    textSub:      '#A0AABC',
    textMuted:    '#68748A',
    border:       '#30394D',
    borderLight:  '#252D3D',
    input:        '#161C2B',
    inputBorder:  '#30394D',
    header:       '#0F1117',
    headerText:   '#F8FAFC',
    hotBg:        '#241F16',
    hotBorder:    '#5A4722',
    tabBg:        '#0F1117',
    tabBorder:    'rgba(255,255,255,0.10)',
    blurTint:     'dark',
    activePillBg: 'rgba(247,180,58,0.15)',
    activePillBorder: 'rgba(255,204,105,0.40)',
    accent:       '#F7B43A',
  },
  trading: {
    bg:           '#0B0E11',
    card:         '#15191F',
    cardAlt:      '#1A1F26',
    text:         '#F7F8FA',
    textSub:      '#A4A9B4',
    textMuted:    '#6D7480',
    border:       '#2B3139',
    borderLight:  '#1A1F26',
    input:        '#11151A',
    inputBorder:  '#2B3139',
    header:       '#0B0E11',
    headerText:   '#F7F8FA',
    hotBg:        '#201B12',
    hotBorder:    '#5A461B',
    tabBg:        '#0B0E11',
    tabBorder:    'rgba(255,255,255,0.10)',
    blurTint:     'dark',
    activePillBg: 'rgba(247,166,0,0.15)',
    activePillBorder: 'rgba(255,197,83,0.42)',
    accent:       '#F7A600',
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
    tabBg:        '#F2EFE9',
    tabBorder:    'rgba(255,255,255,0.7)',
    blurTint:     'light',
    activePillBg: 'rgba(90,122,74,0.10)',
    activePillBorder: 'rgba(90,122,74,0.22)',
    accent:       '#6B7C5C',
  },
  matisse2: {
    bg: '#121315', card: '#1D1E21', cardAlt: '#292B2F', text: '#F7F7F8', textSub: '#B9BBC2', textMuted: '#777A84',
    border: '#36383E', borderLight: '#292B2F', input: '#18191C', inputBorder: '#36383E', header: '#121315', headerText: '#F7F7F8',
    hotBg: '#1B2442', hotBorder: '#3456D1', tabBg: '#121315', tabBorder: 'rgba(91,87,217,0.24)', blurTint: 'dark',
    activePillBg: 'rgba(52,86,209,0.20)', activePillBorder: 'rgba(101,162,255,0.55)', accent: '#3456D1',
  },
  matisse: {
    bg: '#151416', card: '#222124', cardAlt: '#302D32', text: '#FFF9FD', textSub: '#C9BEC8', textMuted: '#857A84',
    border: '#403A41', borderLight: '#302D32', input: '#1B191C', inputBorder: '#403A41', header: '#151416', headerText: '#FFF9FD',
    hotBg: '#33282F', hotBorder: '#FF7C5C', tabBg: '#151416', tabBorder: 'rgba(214,160,238,0.22)', blurTint: 'dark',
    activePillBg: 'rgba(214,160,238,0.18)', activePillBorder: 'rgba(246,182,255,0.52)', accent: '#D6A0EE',
  },
  pissarro: {
    bg: '#141612', card: '#20231D', cardAlt: '#2C3126', text: '#F8FAF2', textSub: '#BEC5B2', textMuted: '#7F8971',
    border: '#3B4232', borderLight: '#2C3126', input: '#191C16', inputBorder: '#3B4232', header: '#141612', headerText: '#F8FAF2',
    hotBg: '#29331A', hotBorder: '#75C400', tabBg: '#141612', tabBorder: 'rgba(169,201,109,0.22)', blurTint: 'dark',
    activePillBg: 'rgba(169,201,109,0.18)', activePillBorder: 'rgba(181,226,58,0.48)', accent: '#A9C96D',
  },
  miro: {
    bg: '#121517', card: '#1D2225', cardAlt: '#293034', text: '#F7FAFB', textSub: '#B7C2C7', textMuted: '#748188',
    border: '#354147', borderLight: '#293034', input: '#181C1F', inputBorder: '#354147', header: '#121517', headerText: '#F7FAFB',
    hotBg: '#1D3037', hotBorder: '#38CFCA', tabBg: '#121517', tabBorder: 'rgba(64,143,229,0.22)', blurTint: 'dark',
    activePillBg: 'rgba(64,143,229,0.20)', activePillBorder: 'rgba(117,181,244,0.52)', accent: '#408FE5',
  },
  mondrian: {
    bg: '#141414', card: '#212121', cardAlt: '#2D2D2D', text: '#FAFAFA', textSub: '#C2C2C2', textMuted: '#7D7D7D',
    border: '#3C3C3C', borderLight: '#2D2D2D', input: '#191919', inputBorder: '#3C3C3C', header: '#141414', headerText: '#FAFAFA',
    hotBg: '#352515', hotBorder: '#FF971A', tabBg: '#141414', tabBorder: 'rgba(255,151,26,0.22)', blurTint: 'dark',
    activePillBg: 'rgba(255,151,26,0.18)', activePillBorder: 'rgba(255,189,99,0.52)', accent: '#FF971A',
  },
  macke: {
    bg: '#151416', card: '#222124', cardAlt: '#302E32', text: '#FFF9F5', textSub: '#C9C0BC', textMuted: '#877D79',
    border: '#413B3D', borderLight: '#302E32', input: '#1B191B', inputBorder: '#413B3D', header: '#151416', headerText: '#FFF9F5',
    hotBg: '#372C20', hotBorder: '#FFD081', tabBg: '#151416', tabBorder: 'rgba(255,208,129,0.22)', blurTint: 'dark',
    activePillBg: 'rgba(255,208,129,0.18)', activePillBorder: 'rgba(255,224,168,0.52)', accent: '#FFD081',
  },
};

const THEME_SEMANTICS = {
  matisse2: { positive: '#32C85A', negative: '#8A82EE', warning: '#65A2FF' },
  matisse:  { positive: '#14C9C7', negative: '#FF7C5C', warning: '#D6A0EE' },
  pissarro: { positive: '#75C400', negative: '#A9C96D', warning: '#B5E23A' },
  miro:     { positive: '#38CFCA', negative: '#408FE5', warning: '#FFE15C' },
  mondrian: { positive: '#4178D8', negative: '#F4463D', warning: '#FF971A' },
  macke:    { positive: '#5860F2', negative: '#FF5B61', warning: '#FFD081' },
};

const REQUIRED_THEME_TOKENS = [
  'bg', 'card', 'cardAlt', 'text', 'textSub', 'textMuted', 'border', 'borderLight',
  'input', 'inputBorder', 'header', 'headerText', 'hotBg', 'hotBorder', 'tabBg',
  'tabBorder', 'activePillBg', 'activePillBorder', 'accent',
];

Object.entries(COLORS).forEach(([name, palette]) => {
  const missing = REQUIRED_THEME_TOKENS.filter(token => palette[token] == null);
  if (missing.length) throw new Error(`Theme "${name}" is missing tokens: ${missing.join(', ')}`);
  if (!THEME_CHART_PALETTES[name]?.length) throw new Error(`Theme "${name}" is missing a chart palette`);
  if (!ACCENT_CONTRAST[name]) throw new Error(`Theme "${name}" is missing accent contrast`);
});

const buildThemeColors = (theme) => {
  const baseColors = COLORS[theme];
  const semantic = THEME_SEMANTICS[theme] || {};
  return {
    ...baseColors,
    accentSoft: baseColors.activePillBg,
    accentContrast: ACCENT_CONTRAST[theme],
    chartPalette: THEME_CHART_PALETTES[theme],
    positive: semantic.positive || '#0DBD8B',
    positiveSoft: `${semantic.positive || '#0DBD8B'}20`,
    negative: semantic.negative || '#F03030',
    negativeSoft: `${semantic.negative || '#F03030'}20`,
    warning: semantic.warning || (theme === 'trading' ? '#F7A600' : baseColors.accent),
  };
};

const ThemeContext = createContext({
  preference: 'system',
  setPreference: () => {},
  isDark: false,
  theme: 'light',
  colors: buildThemeColors('light'),
});

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val === 'system' || Object.prototype.hasOwnProperty.call(COLORS, val)) {
        setPreferenceState(val);
      }
    });
  }, []);

  const setPreference = async (val) => {
    setPreferenceState(val);
    await AsyncStorage.setItem(STORAGE_KEY, val);
  };

  const isDark = ['dark', 'ocean', 'plum', 'amber', 'trading', 'matisse2', 'matisse', 'pissarro', 'miro', 'mondrian', 'macke'].includes(preference)
    || (preference === 'system' && systemScheme === 'dark');
  const theme = preference === 'system'
    ? (systemScheme === 'dark' ? 'dark' : 'light')
    : preference;
  const colors = buildThemeColors(theme);

  return (
    <ThemeContext.Provider value={{ preference, setPreference, isDark, theme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
