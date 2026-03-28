import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { LayoutGrid, PieChart, Clock, Settings, Search } from 'lucide-react-native';
import { supabase } from './src/lib/supabase';

import DashboardScreen from './src/screens/DashboardScreen';
import SearchScreen from './src/screens/SearchScreen';
import TrendsScreen from './src/screens/TrendsScreen';
import RecordsScreen from './src/screens/RecordsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AuthScreen from './src/screens/AuthScreen';
import AssetDetailScreen from './src/screens/AssetDetailScreen';
import AddAssetScreen from './src/screens/AddAssetScreen';

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator();

function DashboardStackScreen() {
  return (
    <DashboardStack.Navigator>
      <DashboardStack.Screen
        name="DashboardMain"
        component={DashboardScreen}
        options={{ headerShown: false }}
      />
      <DashboardStack.Screen
        name="AssetDetail"
        component={AssetDetailScreen}
        options={{ title: '資產詳情' }}
      />
      <DashboardStack.Screen
        name="AddAsset"
        component={AddAssetScreen}
        options={{ headerShown: false }}
      />
    </DashboardStack.Navigator>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        supabase.auth.signOut();
      } else {
        setSession(session);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && !session) {
        supabase.auth.signOut();
      } else {
        setSession(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return null;
  if (!session) return <AuthScreen />;

  return (
    <>
      <StatusBar style="auto" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: ({ color, size }) => {
              if (route.name === 'Dashboard') return <LayoutGrid size={size} color={color} />;
              if (route.name === 'Search')    return <Search size={size} color={color} />;
              if (route.name === 'Charts')    return <PieChart size={size} color={color} />;
              if (route.name === 'Records')   return <Clock size={size} color={color} />;
              if (route.name === 'Settings')  return <Settings size={size} color={color} />;
              return null;
            },
            tabBarActiveTintColor: '#16a34a',
            tabBarInactiveTintColor: '#94a3b8',
            headerStyle: { backgroundColor: '#f8fafc' },
            headerTitleStyle: { fontWeight: 'bold' },
          })}
        >
          <Tab.Screen
            name="Dashboard"
            component={DashboardStackScreen}
            options={{ title: '總覽', headerShown: false }}
          />
          <Tab.Screen
            name="Search"
            component={SearchScreen}
            options={{ title: '搜尋資產' }}
          />
          <Tab.Screen
            name="Charts"
            component={TrendsScreen}
            options={{ title: '圖表' }}
          />
          <Tab.Screen
            name="Records"
            component={RecordsScreen}
            options={{ title: '紀錄' }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: '設定' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}
