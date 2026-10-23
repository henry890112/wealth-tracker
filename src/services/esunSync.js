import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { findOverlappingInitialPositionIds } from '../lib/transactionReconciliation';

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

export async function fetchEsunTransactions(duration = '3m') {
  if (!bridgeUrl) {
    throw new Error('尚未設定玉山同步服務網址（EXPO_PUBLIC_ESUN_BRIDGE_URL）');
  }
  const token = await getBridgeToken();
  const response = await fetch(`${bridgeUrl}/v1/transactions?duration=${encodeURIComponent(duration)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '無法讀取玉山成交明細');
  return Array.isArray(body.transactions) ? body.transactions : [];
}

export function mergeEsunTransactions(transactions = []) {
  const byExternalId = new Map();
  for (const transaction of transactions || []) {
    if (!transaction?.externalId || !transaction?.symbol || !['BUY', 'SELL'].includes(transaction?.side)) continue;
    byExternalId.set(transaction.externalId, transaction);
  }
  return [...byExternalId.values()].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

export function mergeEsunHoldings(holdings = []) {
  const groups = new Map();

  holdings.forEach((holding, index) => {
    const symbol = String(holding.symbol || '').trim().toUpperCase();
    const key = symbol ? `TW:${symbol}` : `row:${index}`;
    const quantity = Number(holding.quantity) || 0;
    const marketValue = Number(holding.marketValue) || 0;
    const costBasisValue = Math.abs(Number(holding.costBasis)) || (Number(holding.averageCost) || 0) * quantity;
    const current = groups.get(key);

    if (!current) {
      groups.set(key, {
        ...holding,
        symbol: symbol || holding.symbol,
        quantity,
        marketValue,
        costBasis: costBasisValue,
        averageCost: quantity > 0 ? costBasisValue / quantity : Number(holding.averageCost) || 0,
      });
      return;
    }

    const totalQuantity = current.quantity + quantity;
    const totalCost = current.costBasis + costBasisValue;
    groups.set(key, {
      ...current,
      quantity: totalQuantity,
      marketValue: current.marketValue + marketValue,
      costBasis: totalCost,
      averageCost: totalQuantity > 0 ? totalCost / totalQuantity : current.averageCost,
    });
  });

  return Array.from(groups.values());
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

export async function syncEsunDataToSupabase({ userId, holdings = [], accountBalance = null, transactions = [], holdingsLoaded = false }) {
  const { data: existingAssets, error: assetsError } = await supabase
    .from('assets')
    .select('id, name, symbol, category, currency, market_type, average_cost, external_source')
    .eq('user_id', userId);
  if (assetsError) throw assetsError;

  const assetRows = existingAssets || [];
  const mergedHoldings = mergeEsunHoldings(holdings);
  const holdingSymbols = new Set(mergedHoldings.map(item => String(item.symbol).toUpperCase()));
  let added = 0;
  let updated = 0;
  let closed = 0;

  if (holdingsLoaded) {
    for (const item of compareEsunHoldings(mergedHoldings, assetRows)) {
      const payload = {
        name: item.name,
        symbol: item.symbol,
        category: 'investment',
        currency: item.currency || 'TWD',
        market_type: 'TW',
        external_source: 'esun',
        current_shares: item.quantity,
        average_cost: Number(item.averageCost) > 0 ? item.averageCost : (item.existingAsset?.average_cost || 0),
        current_amount: item.marketValue,
        updated_at: new Date().toISOString(),
      };
      const result = item.existingAsset
        ? await supabase.from('assets').update(payload).eq('id', item.existingAsset.id).eq('user_id', userId)
        : await supabase.from('assets').insert({ ...payload, user_id: userId });
      if (result.error) throw result.error;
      item.existingAsset ? updated++ : added++;
    }

    const staleIds = assetRows
      .filter(asset => asset.external_source === 'esun'
        && asset.category === 'investment'
        && asset.market_type === 'TW'
        && !holdingSymbols.has(String(asset.symbol || '').toUpperCase()))
      .map(asset => asset.id);
    if (staleIds.length) {
      const { error } = await supabase.from('assets').update({
        current_shares: 0,
        current_amount: 0,
        average_cost: 0,
        updated_at: new Date().toISOString(),
      }).in('id', staleIds).eq('user_id', userId);
      if (error) throw error;
      closed = staleIds.length;
    }
  }

  const { data: refreshedAssets, error: refreshedError } = await supabase
    .from('assets')
    .select('id, name, symbol, category, currency, market_type')
    .eq('user_id', userId);
  if (refreshedError) throw refreshedError;
  const assetBySymbol = new Map((refreshedAssets || [])
    .filter(asset => asset.market_type === 'TW' || /^\d{4,6}$/.test(asset.symbol || ''))
    .map(asset => [String(asset.symbol || '').toUpperCase(), asset]));

  for (const transaction of mergeEsunTransactions(transactions)) {
    const symbol = String(transaction.symbol).toUpperCase();
    if (assetBySymbol.has(symbol)) continue;
    const { data: created, error } = await supabase.from('assets').insert({
      user_id: userId,
      name: transaction.name || symbol,
      symbol,
      category: 'investment',
      currency: 'TWD',
      market_type: 'TW',
      external_source: 'esun',
      current_shares: 0,
      current_amount: 0,
      average_cost: 0,
    }).select('id, name, symbol, category, currency, market_type').single();
    if (error) throw error;
    assetBySymbol.set(symbol, created);
    added++;
  }

  const transactionRows = mergeEsunTransactions(transactions).map(transaction => ({
    asset_id: assetBySymbol.get(String(transaction.symbol).toUpperCase())?.id,
    type: transaction.side,
    shares: Number(transaction.quantity) || 0,
    price: Number(transaction.price) || 0,
    total_amount: Math.abs(Number(transaction.grossAmount) || 0),
    fee: Math.abs(Number(transaction.fee) || 0),
    tax: Math.abs(Number(transaction.tax) || 0),
    trans_date: transaction.occurredAt,
    external_source: 'esun',
    external_id: transaction.externalId,
    affects_position: false,
    external_payload: transaction.raw || transaction,
  })).filter(row => row.asset_id && row.shares > 0 && row.price > 0 && row.total_amount > 0);

  let importedTransactions = 0;
  for (let offset = 0; offset < transactionRows.length; offset += 200) {
    const { data, error } = await supabase
      .from('transactions')
      .upsert(transactionRows.slice(offset, offset + 200), {
        onConflict: 'asset_id,external_source,external_id',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw error;
    importedTransactions += (data || []).length;
  }

  const importedAssetIds = [...new Set(transactionRows.map(row => row.asset_id))];
  if (importedAssetIds.length) {
    const { data: initialTransactions, error: initialTransactionsError } = await supabase
      .from('transactions')
      .select('id, asset_id, type, shares, price, trans_date, external_source, ignored_from_performance')
      .in('asset_id', importedAssetIds)
      .eq('external_source', 'initial_position')
      .eq('ignored_from_performance', false);
    if (initialTransactionsError) throw initialTransactionsError;

    const overlappingIds = findOverlappingInitialPositionIds(initialTransactions || [], transactionRows);
    if (overlappingIds.length) {
      const { error } = await supabase
        .from('transactions')
        .update({ ignored_from_performance: true, affects_position: false })
        .in('id', overlappingIds);
      if (error) throw error;
    }
  }

  let cashSynced = false;
  if (accountBalance) {
    const cashAsset = assetRows.find(asset =>
      asset.symbol === 'ESUN-CASH-TWD' && asset.category === 'liquid' && asset.currency === 'TWD'
    );
    const cashPayload = {
      name: '玉山證券可用餘額',
      symbol: 'ESUN-CASH-TWD',
      category: 'liquid',
      currency: 'TWD',
      current_amount: Number(accountBalance.availableBalance) || 0,
      current_shares: 0,
      average_cost: 0,
      updated_at: new Date().toISOString(),
    };
    const result = cashAsset
      ? await supabase.from('assets').update(cashPayload).eq('id', cashAsset.id).eq('user_id', userId)
      : await supabase.from('assets').insert({ ...cashPayload, user_id: userId });
    if (result.error) throw result.error;
    cashSynced = true;
  }

  await supabase.rpc('create_daily_snapshot', { p_user_id: userId });
  return { added, updated, closed, importedTransactions, availableTransactions: transactionRows.length, cashSynced };
}
