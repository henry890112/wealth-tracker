import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const ACCOUNT_INDEX_KEY = '@wt_saved_auth_accounts:v1';
const WEB_SESSION_PREFIX = '@wt_saved_auth_session:';
const NATIVE_SESSION_PREFIX = 'wt_saved_auth_session_';
const MAX_SAVED_ACCOUNTS = 5;

const nativeSessionKey = userId => `${NATIVE_SESSION_PREFIX}${String(userId).replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
const webSessionKey = userId => `${WEB_SESSION_PREFIX}${userId}`;

async function readAccountIndex() {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_INDEX_KEY);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter(account => account?.id && account?.email) : [];
  } catch (error) {
    console.warn('Unable to read saved accounts:', error);
    return [];
  }
}

async function writeAccountIndex(accounts) {
  await AsyncStorage.setItem(ACCOUNT_INDEX_KEY, JSON.stringify(accounts));
}

async function writeSession(userId, value) {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(webSessionKey(userId), value);
    return;
  }
  await SecureStore.setItemAsync(nativeSessionKey(userId), value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function readSession(userId) {
  if (Platform.OS === 'web') return AsyncStorage.getItem(webSessionKey(userId));
  return SecureStore.getItemAsync(nativeSessionKey(userId));
}

async function deleteSession(userId) {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(webSessionKey(userId));
    return;
  }
  await SecureStore.deleteItemAsync(nativeSessionKey(userId));
}

export async function rememberAccountSession(session) {
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email || !session?.access_token || !session?.refresh_token) return;

  const now = new Date().toISOString();
  const existing = await readAccountIndex();
  const next = [
    { id: String(userId), email: String(email), lastUsedAt: now },
    ...existing.filter(account => account.id !== String(userId)),
  ].slice(0, MAX_SAVED_ACCOUNTS);

  await writeSession(
    userId,
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  );
  await writeAccountIndex(next);

  const retainedIds = new Set(next.map(account => account.id));
  await Promise.all(
    existing
      .filter(account => !retainedIds.has(account.id))
      .map(account => deleteSession(account.id).catch(() => undefined)),
  );
}

export async function listSavedAccounts() {
  return readAccountIndex();
}

export async function getSavedAccountSession(userId) {
  const raw = await readSession(userId);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value?.access_token || !value?.refresh_token) return null;
    return value;
  } catch (error) {
    console.warn('Unable to read saved account session:', error);
    return null;
  }
}

export async function forgetSavedAccount(userId) {
  if (!userId) return;
  const normalizedId = String(userId);
  const existing = await readAccountIndex();
  await writeAccountIndex(existing.filter(account => account.id !== normalizedId));
  await deleteSession(normalizedId);
}
