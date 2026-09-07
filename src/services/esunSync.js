import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const bridgeUrl = (process.env.EXPO_PUBLIC_ESUN_BRIDGE_URL || '').replace(/\/$/, '');
const ESUN_BRIDGE_TOKEN_KEY = 'wt_esun_bridge_token';

const isWeb = Platform.OS === 'web';

async function getBridgeToken() {
  if (isWeb) return globalThis.localStorage?.getItem(ESUN_BRIDGE_TOKEN_KEY) || null;
  return SecureStore.getItemAsync(ESUN_BRIDGE_TOKEN_KEY);
}

export async function saveEsunBridgeToken(token) {
  const normalized = token.trim();
  if (isWeb) {
    if (normalized) globalThis.localStorage?.setItem(ESUN_BRIDGE_TOKEN_KEY, normalized);
    else globalThis.localStorage?.removeItem(ESUN_BRIDGE_TOKEN_KEY);
    return;
  }
  if (!normalized) {
    await SecureStore.deleteItemAsync(ESUN_BRIDGE_TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(ESUN_BRIDGE_TOKEN_KEY, normalized);
}

export async function fetchEsunHoldings() {
  if (!bridgeUrl) {
    throw new Error('尚未設定玉山同步服務網址（EXPO_PUBLIC_ESUN_BRIDGE_URL）');
  }
  const token = await getBridgeToken();
  const response = await fetch(`${bridgeUrl}/v1/holdings`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '無法讀取玉山持倉');
  return Array.isArray(body.holdings) ? body.holdings : [];
}

export async function fetchEsunBalance() {
  if (!bridgeUrl) {
    throw new Error('尚未設定玉山同步服務網址（EXPO_PUBLIC_ESUN_BRIDGE_URL）');
  }
  const token = await getBridgeToken();
  const response = await fetch(`${bridgeUrl}/v1/balance`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '無法讀取玉山帳務餘額');
  return body.balance || null;
}

export function compareEsunHoldings(holdings, localAssets) {
  const localBySymbol = new Map(
    (localAssets || []).filter((asset) => asset.market_type === 'TW' || /^\d{4,6}$/.test(asset.symbol || ''))
      .map((asset) => [String(asset.symbol || '').toUpperCase(), asset])
  );
  return holdings.map((holding) => ({
    ...holding,
    existingAsset: localBySymbol.get(String(holding.symbol).toUpperCase()) || null,
  }));
}
