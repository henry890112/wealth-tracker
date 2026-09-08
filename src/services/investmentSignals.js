import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';

const WATCHLIST_KEY = 'watchlist';
const DEFAULT_PREFERENCES = {
  enabled: true,
  push_enabled: true,
  strategy: 'value_trend_v1',
  max_symbols: 50,
};

async function currentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('請先登入後再使用研究訊號');
  return user;
}

export async function getSignalPreferences() {
  const user = await currentUser();
  const { data, error } = await supabase
    .from('investment_signal_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: createError } = await supabase
    .from('investment_signal_preferences')
    .insert({ user_id: user.id, ...DEFAULT_PREFERENCES })
    .select()
    .single();
  if (createError) throw createError;
  return created;
}

export async function saveSignalPreferences(changes) {
  const user = await currentUser();
  const payload = { user_id: user.id, ...DEFAULT_PREFERENCES, ...changes, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from('investment_signal_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listInvestmentSignals(limit = 60) {
  const user = await currentUser();
  const { data, error } = await supabase
    .from('investment_signal_events')
    .select('*')
    .eq('user_id', user.id)
    .order('signal_date', { ascending: false })
    .order('is_candidate', { ascending: false })
    .order('score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Run a private, on-demand analysis for the signed-in user. It never sends a push notification. */
export async function runInvestmentSignalNow() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error('登入已失效，請重新登入後再分析。');
  const { data, error } = await supabase.functions.invoke('daily-investment-signals', {
    body: { mode: 'on_demand' },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let message = error.message;
    try {
      const details = await error.context?.json?.();
      if (details?.error) message = details.error;
    } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function markSignalRead(id) {
  const { error } = await supabase
    .from('investment_signal_events')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Upload a physical device's Expo token. No broker or market-data secrets leave the server. */
export async function registerSignalPushDevice() {
  if (Platform.OS === 'web') return { registered: false, reason: 'web' };
  const permission = await Notifications.getPermissionsAsync();
  let status = permission.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return { registered: false, reason: 'permission' };

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('找不到 Expo 專案設定，無法註冊推播裝置。');
  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  const user = await currentUser();
  const { error } = await supabase
    .from('push_devices')
    .upsert({
      user_id: user.id,
      expo_push_token: tokenResult.data,
      platform: Platform.OS,
      is_active: true,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'expo_push_token' });
  if (error) throw error;
  return { registered: true };
}

/** Migrates existing on-device self-selected symbols to the authenticated user's cloud watchlist. */
export async function syncLocalWatchlistToCloud(listOverride) {
  const user = await currentUser();
  let list = listOverride;
  if (!list) {
    const raw = await AsyncStorage.getItem(WATCHLIST_KEY);
    list = raw ? JSON.parse(raw) : [];
  }
  const rows = (Array.isArray(list) ? list : [])
    .filter(item => item?.symbol && item.market_type)
    .slice(0, 50)
    .map(item => ({ user_id: user.id, symbol: String(item.symbol).toUpperCase(), market_type: item.market_type }));
  if (!rows.length) return { synced: 0 };
  const { error } = await supabase
    .from('watchlist')
    .upsert(rows, { onConflict: 'user_id,symbol,market_type', ignoreDuplicates: true });
  if (error) throw error;
  return { synced: rows.length };
}
