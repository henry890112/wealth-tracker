import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { normalizeTtmSqueezePreset } from './strategyEngines.js';

export const STRATEGY_SETTINGS_STORAGE_KEY = 'wealthtracker.technical-analysis.strategy-settings.v1';

const localSettings = async () => {
  try {
    const raw = await AsyncStorage.getItem(STRATEGY_SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
};

const presetFromSettings = settings => normalizeTtmSqueezePreset(
  settings?.['indicator-bollinger-squeeze']
    || settings?.bollingerSqueeze
    || settings?.ttmSqueeze,
);

export async function loadTtmSqueezePreset() {
  const local = await localSettings();
  let remote = {};
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('investment_signal_preferences')
        .select('strategy_settings')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      remote = data?.strategy_settings || {};
    }
  } catch (error) {
    // Local settings remain usable when a user is offline or the migration has
    // not reached the current project yet.
    console.warn('Unable to load cloud strategy settings:', error?.message || error);
  }
  const remoteConfig = remote?.['indicator-bollinger-squeeze'] || remote?.bollingerSqueeze || remote?.ttmSqueeze;
  return remoteConfig ? normalizeTtmSqueezePreset(remoteConfig) : presetFromSettings(local);
}

export async function saveTtmSqueezePreset(preset) {
  const normalized = normalizeTtmSqueezePreset(preset);
  const local = await localSettings();
  const next = {
    ...local,
    'indicator-bollinger-squeeze': { preset: normalized },
  };
  await AsyncStorage.setItem(STRATEGY_SETTINGS_STORAGE_KEY, JSON.stringify(next));

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return normalized;
    const { data: existing, error: readError } = await supabase
      .from('investment_signal_preferences')
      .select('strategy_settings')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) throw readError;
    const strategySettings = {
      ...(existing?.strategy_settings || {}),
      'indicator-bollinger-squeeze': { preset: normalized },
    };
    if (existing) {
      const { error } = await supabase
        .from('investment_signal_preferences')
        .update({ strategy_settings: strategySettings, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('investment_signal_preferences')
        .insert({ user_id: user.id, enabled: false, push_enabled: false, strategy_settings: strategySettings });
      if (error) throw error;
    }
  } catch (error) {
    console.warn('Unable to save cloud strategy settings:', error?.message || error);
  }
  return normalized;
}
