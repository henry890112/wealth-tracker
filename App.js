import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LayoutGrid, BarChart3, Bot, ClipboardList, MoreHorizontal, Search } from 'lucide-react-native';
import { supabase } from './src/lib/supabase';
import { ThemeProvider, useTheme, COLORS } from './src/lib/ThemeContext';

import DashboardScreen from './src/screens/DashboardScreen';
import SearchScreen from './src/screens/SearchScreen';
import TrendsScreen from './src/screens/TrendsScreen';
import RecordsScreen from './src/screens/RecordsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AuthScreen from './src/screens/AuthScreen';
import AssetDetailScreen from './src/screens/AssetDetailScreen';
import AddAssetScreen from './src/screens/AddAssetScreen';
import FixedExpensesScreen from './src/screens/FixedExpensesScreen';
import AIAnalysisScreen from './src/screens/AIAnalysisScreen';
import MoreScreen from './src/screens/MoreScreen';
import EsunSyncScreen from './src/screens/EsunSyncScreen';
import InvestmentSignalsScreen from './src/screens/InvestmentSignalsScreen';

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();
const MainStack = createNativeStackNavigator();

const TAB_CONFIG = [
  { name: 'Dashboard', label: '總覽', Icon: LayoutGrid },
  { name: 'Search',    label: '搜尋', Icon: Search     },
  { name: 'Charts',    label: '圖表', Icon: BarChart3  },
  { name: 'Records',   label: '紀錄', Icon: ClipboardList },
  { name: 'More',      label: '更多', Icon: MoreHorizontal },
];

// Map shared COLORS to tab bar tokens
const toTheme = (c) => ({
  blurTint:         c.blurTint,
  overlay:          c.tabBg,
  border:           c.tabBorder,
  shadow:           '#000',
  inactiveIcon:     c.textMuted,
  inactiveLabel:    c.textMuted,
  activePillBg:     c.activePillBg,
  activePillBorder: c.activePillBorder,
  accent:           c.accent,
  headerBg:         c.header,
  headerText:       c.headerText,
});

function GlassTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const t = toTheme(colors);
  const accent = t.accent;

  return (
    <View
      style={[
        styles.tabBarWrapper,
        {
          paddingBottom: insets.bottom || 16,
          backgroundColor: t.overlay,
        },
      ]}
    >
      <AIOrbButton accent={accent} contrast={colors.accentContrast} surface={colors.cardAlt} onPress={() => navigation.getParent()?.navigate('AI')} />
      <View
        style={[
          styles.tabBarContainer,
          {
            backgroundColor: t.overlay,
            borderColor: t.border,
            shadowColor: t.shadow,
          },
        ]}
      >
        <View style={styles.tabBarInner}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const cfg = TAB_CONFIG.find(c => c.name === route.name);
            if (!cfg) return null;
            const { label, Icon } = cfg;

            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };

            return (
              <TouchableOpacity
                key={route.key}
                style={styles.tabItem}
                onPress={onPress}
                activeOpacity={0.7}
              >
                {focused && (
                  <View style={[styles.activePill, {
                    backgroundColor: accent,
                  }]} />
                )}
                <Icon
                  size={22}
                  color={focused ? accent : t.inactiveIcon}
                  strokeWidth={focused ? 2.2 : 1.8}
                />
                <Text style={[styles.tabLabel, { color: focused ? accent : t.inactiveLabel },
                  focused && styles.tabLabelActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// A restrained, continuously available AI affordance. The animation is kept
// intentionally subtle so it adds polish without competing with financial data.
function AIOrbButton({ accent, contrast, surface, onPress }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const haloStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.46] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }],
  };

  return (
    <View style={styles.aiOrbDock} pointerEvents="box-none">
      <Animated.View pointerEvents="none" style={[styles.aiOrbHalo, haloStyle, { backgroundColor: accent }]} />
      <TouchableOpacity
        style={[styles.aiDockButton, { backgroundColor: surface, borderColor: accent, shadowColor: accent }]}
        onPress={onPress}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel="開啟 AI 財務分析"
      >
        <View style={[styles.aiOrbInner, { backgroundColor: accent }]}>
          <View style={styles.aiOrbGlint} />
          <Bot size={22} color={contrast} strokeWidth={2.35} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

function AIHeaderButton({ onPress }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.aiHeaderButton, { backgroundColor: colors.accent }]}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel="開啟 AI 財務分析"
    >
      <Bot size={17} color={colors.accentContrast} strokeWidth={2.4} />
      <Text style={[styles.aiHeaderLabel, { color: colors.accentContrast }]}>問 AI</Text>
    </TouchableOpacity>
  );
}

function DashboardStackScreen() {
  return (
    <DashboardStack.Navigator>
      <DashboardStack.Screen name="DashboardMain" component={DashboardScreen} options={{ headerShown: false }} />
      <DashboardStack.Screen name="AssetDetail"   component={AssetDetailScreen} options={{ title: '資產詳情', headerBackTitle: '返回' }} />
      <DashboardStack.Screen name="AddAsset"      component={AddAssetScreen} options={{ headerShown: false }} />
    </DashboardStack.Navigator>
  );
}

function MainTabs() {
  const { isDark, colors } = useTheme();
  const t = toTheme(colors);

  return (
    <Tab.Navigator
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: t.headerBg },
        headerTitleStyle: { fontWeight: 'bold', color: t.headerText },
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardStackScreen} options={{ title: '總覽', headerShown: false }} />
      <Tab.Screen name="Search"    component={SearchScreen}         options={{ title: '搜尋資產' }} />
      <Tab.Screen name="Charts"    component={TrendsScreen}         options={{ title: '資產趨勢' }} />
      <Tab.Screen name="Records"   component={RecordsScreen}        options={{ title: '交易紀錄' }} />
      <Tab.Screen name="More"      component={MoreScreen}           options={{ title: '更多', headerShown: false }} />
    </Tab.Navigator>
  );
}

function MainStackScreen() {
  const { colors } = useTheme();
  const withAI = ({ navigation }) => ({
    headerShown: true,
    headerRight: () => <AIHeaderButton onPress={() => navigation.navigate('AI')} />,
  });
  return (
    <MainStack.Navigator screenOptions={{
      headerShown: false,
      headerStyle: { backgroundColor: colors.header },
      headerTintColor: colors.text,
      headerTitleStyle: { fontWeight: '700' },
      contentStyle: { backgroundColor: colors.bg },
    }}>
      <MainStack.Screen name="Tabs" component={MainTabs} />
      <MainStack.Screen
        name="AI"
        component={AIAnalysisScreen}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
      <MainStack.Screen name="FixedExpenses" component={FixedExpensesScreen} options={({ navigation }) => ({ ...withAI({ navigation }), title: '固定支出' })} />
      <MainStack.Screen name="EsunSync" component={EsunSyncScreen} options={{ presentation: 'card', animation: 'slide_from_right' }} />
      <MainStack.Screen name="InvestmentSignals" component={InvestmentSignalsScreen} options={({ navigation }) => ({ ...withAI({ navigation }), title: '研究訊號' })} />
      <MainStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={({ navigation, route }) => {
          const titles = { account: '帳號資訊', theme: '外觀與主題', currency: '基準貨幣', sync: '同步狀態', data: '匯出與備份' };
          return { ...withAI({ navigation }), title: titles[route.params?.section] || '設定' };
        }}
      />
    </MainStack.Navigator>
  );
}

function AppInner() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const { isDark, colors } = useTheme();
  const t = toTheme(colors);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) supabase.auth.signOut();
      else setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === 'SIGNED_OUT' ||
        event === 'USER_DELETED' ||
        (event === 'TOKEN_REFRESHED' && !session)
      ) {
        supabase.auth.signOut();
        setSession(null);
      } else {
        setSession(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return null;
  if (!session) return <AuthScreen />;

  const navTheme = isDark
    ? { ...DarkTheme,  colors: { ...DarkTheme.colors,  background: colors.bg, card: t.headerBg, primary: colors.accent, border: colors.border, text: colors.text } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, card: t.headerBg, primary: colors.accent, border: colors.border, text: colors.text } };

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationContainer theme={navTheme}>
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="Main" component={MainStackScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  tabBarWrapper: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    alignItems: 'center',
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    zIndex: 20,
  },
  aiOrbDock: {
    position: 'absolute',
    top: -67,
    right: 16,
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiOrbHalo: {
    position: 'absolute',
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  aiDockButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15233A',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 8,
  },
  aiOrbInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D8D5FF',
    overflow: 'hidden',
  },
  aiOrbGlint: {
    position: 'absolute',
    top: 6,
    left: 9,
    width: 13,
    height: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.5)',
    transform: [{ rotate: '-20deg' }],
  },
  aiHeaderButton: {
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0B1F3A',
  },
  aiHeaderLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  tabBarContainer: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    borderTopWidth: 1,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  tabBarInner: {
    flexDirection: 'row',
    paddingTop: 7,
    paddingHorizontal: 12,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 58,
    paddingVertical: 7,
    gap: 3,
    borderRadius: 18,
  },
  activePill: {
    position: 'absolute',
    top: 0, left: 18, right: 18,
    height: 3,
    borderRadius: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  tabLabelActive: {
    fontWeight: '700',
  },
});
