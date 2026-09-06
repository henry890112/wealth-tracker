import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
import ReceivablesScreen from './src/screens/ReceivablesScreen';
import MoreScreen from './src/screens/MoreScreen';

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();
const MainStack = createNativeStackNavigator();

const PRIMARY = '#F59E0B';

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
  headerBg:         c.header,
  headerText:       c.headerText,
});

function GlassTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const t = toTheme(colors);

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
      <TouchableOpacity
        style={styles.aiDockButton}
        onPress={() => navigation.getParent()?.navigate('AI')}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel="開啟 AI 財務分析"
      >
        <Bot size={22} color="#FFFFFF" strokeWidth={2.3} />
      </TouchableOpacity>
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
                    backgroundColor: PRIMARY,
                  }]} />
                )}
                <Icon
                  size={22}
                  color={focused ? PRIMARY : t.inactiveIcon}
                  strokeWidth={focused ? 2.2 : 1.8}
                />
                <Text style={[styles.tabLabel, { color: focused ? PRIMARY : t.inactiveLabel },
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

function AIHeaderButton({ onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.aiHeaderButton}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel="開啟 AI 財務分析"
    >
      <Bot size={17} color="#FFFFFF" strokeWidth={2.4} />
      <Text style={styles.aiHeaderLabel}>問 AI</Text>
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
      <MainStack.Screen name="Receivables" component={ReceivablesScreen} options={({ navigation }) => ({ ...withAI({ navigation }), title: '應收款項' })} />
      <MainStack.Screen name="Settings" component={SettingsScreen} options={({ navigation }) => ({ ...withAI({ navigation }), title: '設定' })} />
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
    ? { ...DarkTheme,  colors: { ...DarkTheme.colors,  background: '#0f172a', card: t.headerBg } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#f1f5f9', card: t.headerBg } };

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
  aiDockButton: {
    position: 'absolute',
    top: -60,
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1F3A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#0B1F3A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
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
