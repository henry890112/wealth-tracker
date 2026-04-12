import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LayoutGrid, PieChart, Clock, Settings, Search, CreditCard } from 'lucide-react-native';
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

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator();

const PRIMARY = '#16a34a';

const TAB_CONFIG = [
  { name: 'Dashboard',      label: '總覽',   Icon: LayoutGrid },
  { name: 'Search',         label: '搜尋',   Icon: Search     },
  { name: 'Charts',         label: '圖表',   Icon: PieChart   },
  { name: 'Records',        label: '紀錄',   Icon: Clock      },
  { name: 'FixedExpenses',  label: '固定支出', Icon: CreditCard },
  { name: 'Settings',       label: '設定',   Icon: Settings   },
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
  const { isDark, colors } = useTheme();
  const t = toTheme(colors);

  return (
    <View style={[styles.tabBarWrapper, { paddingBottom: insets.bottom || 16 }]}>
      <View style={[styles.tabBarContainer, { borderColor: t.border, shadowColor: t.shadow }]}>
        <BlurView intensity={60} tint={t.blurTint} style={StyleSheet.absoluteFill} />
        <View style={[styles.tabBarOverlay, { backgroundColor: t.overlay }]} />

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
                    backgroundColor: t.activePillBg,
                    borderColor: t.activePillBorder,
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

function DashboardStackScreen() {
  return (
    <DashboardStack.Navigator>
      <DashboardStack.Screen name="DashboardMain" component={DashboardScreen} options={{ headerShown: false }} />
      <DashboardStack.Screen name="AssetDetail"   component={AssetDetailScreen} options={{ title: '資產詳情', headerBackTitle: '返回' }} />
      <DashboardStack.Screen name="AddAsset"      component={AddAssetScreen} options={{ headerShown: false }} />
    </DashboardStack.Navigator>
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
      if (event === 'TOKEN_REFRESHED' && !session) supabase.auth.signOut();
      else setSession(session);
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
        <Tab.Navigator
          tabBar={(props) => <GlassTabBar {...props} />}
          screenOptions={{
            headerStyle: { backgroundColor: t.headerBg },
            headerTitleStyle: { fontWeight: 'bold', color: t.headerText },
          }}
        >
          <Tab.Screen name="Dashboard" component={DashboardStackScreen} options={{ title: '總覽', headerShown: false }} />
          <Tab.Screen name="Search"    component={SearchScreen}         options={{ title: '搜尋資產' }} />
          <Tab.Screen name="Charts"    component={TrendsScreen}         options={{ title: '圖表' }} />
          <Tab.Screen name="Records"       component={RecordsScreen}        options={{ title: '紀錄' }} />
          <Tab.Screen name="FixedExpenses" component={FixedExpensesScreen}  options={{ title: '固定支出' }} />
          <Tab.Screen name="Settings"      component={SettingsScreen}       options={{ title: '設定' }} />
        </Tab.Navigator>
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
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  tabBarContainer: {
    width: '100%',
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
  tabBarOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  tabBarInner: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 3,
    borderRadius: 18,
  },
  activePill: {
    position: 'absolute',
    top: 0, bottom: 0, left: 4, right: 4,
    borderRadius: 16,
    borderWidth: 1,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  tabLabelActive: {
    fontWeight: '700',
  },
});
