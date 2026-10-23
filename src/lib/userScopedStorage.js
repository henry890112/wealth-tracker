import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_USER_KEY = '@wt_active_user_id';
const USER_STORAGE_PREFIX = '@wt_user_storage:';

// Device-only data that must never leak from one signed-in account to another.
// Theme preference intentionally remains device-wide.
const USER_SCOPED_KEYS = [
  'watchlist',
  'recent_searches',
  '@wt_price_alerts',
  '@wt_dashboard_cache',
  '@wt_needs_refresh',
  'lastSnapshotDate',
  'lastCategorySnapshotDate',
  'lastCategorySnapshotNW',
];

const storageKeyForUser = userId => `${USER_STORAGE_PREFIX}${userId}`;

async function saveCurrentStorage(userId) {
  if (!userId) return;
  const pairs = await AsyncStorage.multiGet(USER_SCOPED_KEYS);
  const values = Object.fromEntries(pairs.filter(([, value]) => value !== null));
  await AsyncStorage.setItem(storageKeyForUser(userId), JSON.stringify(values));
}

async function clearCurrentStorage() {
  await AsyncStorage.multiRemove(USER_SCOPED_KEYS);
}

async function restoreStorage(userId) {
  const raw = await AsyncStorage.getItem(storageKeyForUser(userId));
  if (!raw) return;
  try {
    const values = JSON.parse(raw);
    const pairs = USER_SCOPED_KEYS
      .filter(key => typeof values?.[key] === 'string')
      .map(key => [key, values[key]]);
    if (pairs.length) await AsyncStorage.multiSet(pairs);
  } catch (error) {
    console.warn('Unable to restore user-scoped storage:', error);
  }
}

/** Make the shared AsyncStorage keys belong to the specified signed-in user. */
export async function activateUserStorage(userId) {
  if (!userId) return;
  const normalizedId = String(userId);
  const activeUserId = await AsyncStorage.getItem(ACTIVE_USER_KEY);
  if (activeUserId === normalizedId) return;

  if (activeUserId) await saveCurrentStorage(activeUserId);
  await clearCurrentStorage();
  await restoreStorage(normalizedId);
  await AsyncStorage.setItem(ACTIVE_USER_KEY, normalizedId);
}

/** Save the departing user's device data, then clear the shared working keys. */
export async function deactivateUserStorage(userId) {
  const activeUserId = await AsyncStorage.getItem(ACTIVE_USER_KEY);
  const normalizedId = userId ? String(userId) : activeUserId;
  if (activeUserId && normalizedId === activeUserId) await saveCurrentStorage(activeUserId);
  await clearCurrentStorage();
  await AsyncStorage.removeItem(ACTIVE_USER_KEY);
}
