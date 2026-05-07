import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

const ALERTS_KEY = '@wt_price_alerts';

// Configure how notifications are displayed when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Returns all saved alerts as a map: { [symbol]: AlertObject }
 * Alert shape: { symbol, name, targetPrice, direction: 'above'|'below', triggered: boolean }
 */
export async function getAlerts() {
  try {
    const val = await AsyncStorage.getItem(ALERTS_KEY);
    return val ? JSON.parse(val) : {};
  } catch {
    return {};
  }
}

/**
 * Save (create or overwrite) an alert for the given symbol.
 */
export async function saveAlert(alert) {
  try {
    const alerts = await getAlerts();
    alerts[alert.symbol] = { ...alert, triggered: false };
    await AsyncStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  } catch (e) {
    console.warn('saveAlert error:', e);
  }
}

/**
 * Re-enable an alert for the given symbol by clearing its triggered state.
 */
export async function resetAlert(symbol) {
  try {
    const alerts = await getAlerts();
    if (alerts[symbol]) {
      alerts[symbol].triggered = false;
      await AsyncStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
    }
  } catch (e) {
    console.warn('resetAlert error:', e);
  }
}

/**
 * Delete the alert for a given symbol.
 */
export async function deleteAlert(symbol) {
  try {
    const alerts = await getAlerts();
    delete alerts[symbol];
    await AsyncStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  } catch (e) {
    console.warn('deleteAlert error:', e);
  }
}

/**
 * Request push notification permission from the user.
 * Returns true if granted, false otherwise.
 */
export async function requestNotificationPermission() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('requestNotificationPermission error:', e);
    return false;
  }
}

/**
 * Check all saved alerts against a fresh price map and fire notifications
 * for any that have crossed their threshold.
 *
 * @param {Object} priceMap  e.g. { AAPL: { price: 185.3, ... }, BTC: { price: 62000, ... } }
 */
export async function checkAndFireAlerts(priceMap) {
  try {
    const alerts = await getAlerts();
    const symbols = Object.keys(alerts);
    if (symbols.length === 0) return;

    let changed = false;

    for (const symbol of symbols) {
      const alert = alerts[symbol];
      if (alert.triggered) continue;

      const currentPrice = priceMap[symbol]?.price;
      if (currentPrice == null) continue;

      const shouldFire =
        (alert.direction === 'above' && currentPrice >= alert.targetPrice) ||
        (alert.direction === 'below' && currentPrice <= alert.targetPrice);

      if (shouldFire) {
        const dirLabel = alert.direction === 'above' ? '高於' : '低於';
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `📊 價格提醒：${alert.name}`,
            body: `${alert.name}（${symbol}）現價 ${currentPrice.toFixed(2)}，已${dirLabel}目標價 ${alert.targetPrice}`,
          },
          trigger: null, // immediate
        });
        alerts[symbol] = { ...alert, triggered: true };
        changed = true;
      }
    }

    if (changed) {
      await AsyncStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
    }
  } catch (e) {
    console.warn('checkAndFireAlerts error:', e);
  }
}

// ── Background price alert task ────────────────────────────────────────────

const PRICE_ALERT_TASK = 'PRICE_ALERT_CHECK';

// Must be defined at module level, outside any component
TaskManager.defineTask(PRICE_ALERT_TASK, async () => {
  try {
    // Dynamic import to avoid circular dependency
    const { fetchPricesForSymbols } = await import('./backgroundPriceFetch');
    const priceMap = await fetchPricesForSymbols();
    await checkAndFireAlerts(priceMap);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.warn('PRICE_ALERT_TASK error:', e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register the background price-alert task (call once on app start).
 * Runs every 15 minutes in the background.
 */
export async function registerBackgroundPriceAlerts() {
  try {
    await BackgroundFetch.registerTaskAsync(PRICE_ALERT_TASK, {
      minimumInterval: 15 * 60, // 15 minutes
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch (e) {
    console.log('Background fetch already registered or unavailable:', e);
  }
}
