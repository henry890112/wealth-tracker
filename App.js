import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Home, Search, TrendingUp, Settings } from 'lucide-react-native';
import { supabase } from './src/lib/supabase';

// Import screens
import DashboardScreen from './src/screens/DashboardScreen';
import SearchScreen from './src/screens/SearchScreen';
import TrendsScreen from './src/screens/TrendsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AuthScreen from './src/screens/AuthScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return null; // Or a loading screen
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <>
      <StatusBar style="auto" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: ({ focused, color, size }) => {
              let IconComponent;

              if (route.name === 'Dashboard') {
                IconComponent = Home;
              } else if (route.name === 'Search') {
                IconComponent = Search;
              } else if (route.name === 'Trends') {
                IconComponent = TrendingUp;
              } else if (route.name === 'Settings') {
                IconComponent = Settings;
              }

              return <IconComponent size={size} color={color} />;
            },
            tabBarActiveTintColor: '#2563eb',
            tabBarInactiveTintColor: 'gray',
            headerStyle: {
              backgroundColor: '#f8fafc',
            },
            headerTitleStyle: {
              fontWeight: 'bold',
            },
          })}
        >
          <Tab.Screen 
            name="Dashboard" 
            component={DashboardScreen}
            options={{ title: '資產總覽' }}
          />
          <Tab.Screen 
            name="Search" 
            component={SearchScreen}
            options={{ title: '搜尋資產' }}
          />
          <Tab.Screen 
            name="Trends" 
            component={TrendsScreen}
            options={{ title: '趨勢分析' }}
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
