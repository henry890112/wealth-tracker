import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency } from '../services/api';

const CATEGORY_LABELS = {
  liquid: '流動資產',
  investment: '投資資產',
  fixed: '固定資產',
  receivable: '應收帳款',
  liability: '負債',
};

const CATEGORY_COLORS = {
  liquid: '#10b981',
  investment: '#3b82f6',
  fixed: '#8b5cf6',
  receivable: '#f59e0b',
  liability: '#ef4444',
};

const MARKET_TYPE_LABELS = {
  TW: '台股',
  US: '美股',
  Crypto: '加密貨幣',
  other: '其他',
};

const MARKET_TYPE_COLORS = {
  TW: '#dc2626',
  US: '#2563eb',
  Crypto: '#f59e0b',
  other: '#64748b',
};

import { useNavigation } from '@react-navigation/native';

export default function DashboardScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [assets, setAssets] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [netWorth, setNetWorth] = useState(0);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalLiabilities, setTotalLiabilities] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Get user profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      setProfile(profileData);

      // Get assets
      const { data: assetsData, error } = await supabase
        .from('assets')
        .select('*')
        .eq('user_id', user.id)
        .order('category', { ascending: true });

      if (error) throw error;

      // Convert all amounts to base currency
      const baseCurrency = profileData?.base_currency || 'TWD';
      const convertedAssets = await Promise.all(
        assetsData.map(async (asset) => {
          const convertedAmount = await convertToBaseCurrency(
            parseFloat(asset.current_amount),
            asset.currency,
            baseCurrency
          );
          return {
            ...asset,
            converted_amount: convertedAmount,
          };
        })
      );

      setAssets(convertedAssets);

      // Calculate totals
      const assetsTotal = convertedAssets
        .filter(a => a.category !== 'liability')
        .reduce((sum, a) => sum + a.converted_amount, 0);

      const liabilitiesTotal = convertedAssets
        .filter(a => a.category === 'liability')
        .reduce((sum, a) => sum + a.converted_amount, 0);

      setTotalAssets(assetsTotal);
      setTotalLiabilities(liabilitiesTotal);
      setNetWorth(assetsTotal - liabilitiesTotal);

      // Create daily snapshot
      await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, []);

  const groupAssetsByCategory = () => {
    const grouped = {};
    assets.forEach(asset => {
      if (!grouped[asset.category]) {
        grouped[asset.category] = [];
      }
      grouped[asset.category].push(asset);
    });
    return grouped;
  };

  // 將投資資產依 market_type 再分群
  const groupInvestmentByMarket = (investmentAssets) => {
    const grouped = {};
    investmentAssets.forEach(asset => {
      const key = asset.market_type || 'other';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(asset);
    });
    return grouped;
  };

  const formatCurrency = (amount) => {
    const currency = profile?.base_currency || 'TWD';
    return `${currency} ${amount.toLocaleString('zh-TW', { 
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const groupedAssets = groupAssetsByCategory();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Net Worth Card */}
      <View style={styles.netWorthCard}>
        <Text style={styles.netWorthLabel}>淨資產</Text>
        <Text style={styles.netWorthAmount}>{formatCurrency(netWorth)}</Text>
        <View style={styles.netWorthDetails}>
          <View style={styles.netWorthDetailItem}>
            <TrendingUp size={16} color="#10b981" />
            <Text style={styles.netWorthDetailText}>
              資產: {formatCurrency(totalAssets)}
            </Text>
          </View>
          <View style={styles.netWorthDetailItem}>
            <TrendingDown size={16} color="#ef4444" />
            <Text style={styles.netWorthDetailText}>
              負債: {formatCurrency(totalLiabilities)}
            </Text>
          </View>
        </View>
      </View>

      {/* Sync Button */}
      <TouchableOpacity style={styles.syncButton} onPress={onRefresh}>
        <RefreshCw size={20} color="#2563eb" />
        <Text style={styles.syncButtonText}>立即同步</Text>
      </TouchableOpacity>

      {/* Asset Categories */}
      {Object.entries(groupedAssets).map(([category, categoryAssets]) => (
        <View key={category} style={styles.categorySection}>
          {/* Category Header */}
          <View style={styles.categoryHeader}>
            <View style={[styles.categoryIndicator, { backgroundColor: CATEGORY_COLORS[category] }]} />
            <Text style={styles.categoryTitle}>{CATEGORY_LABELS[category]}</Text>
            <Text style={styles.categoryTotal}>
              {formatCurrency(categoryAssets.reduce((sum, a) => sum + a.converted_amount, 0))}
            </Text>
          </View>

          {category === 'investment'
            ? /* 投資資產：依 market_type 分群顯示 */
              Object.entries(groupInvestmentByMarket(categoryAssets)).map(([marketKey, marketAssets]) => (
                <View key={marketKey}>
                  {/* Market Sub-header */}
                  <View style={styles.marketHeader}>
                    <View style={[styles.marketDot, { backgroundColor: MARKET_TYPE_COLORS[marketKey] }]} />
                    <Text style={styles.marketTitle}>{MARKET_TYPE_LABELS[marketKey]}</Text>
                    <Text style={styles.marketTotal}>
                      {formatCurrency(marketAssets.reduce((sum, a) => sum + a.converted_amount, 0))}
                    </Text>
                  </View>
                  {marketAssets.map(asset => (
                    <TouchableOpacity key={asset.id} style={[styles.assetCard, styles.assetCardIndented]} onPress={() => navigation.navigate('AssetDetail', { assetId: asset.id })}>
                      <View style={styles.assetHeader}>
                        <Text style={styles.assetName}>{asset.name}</Text>
                        {asset.symbol && <Text style={styles.assetSymbol}>{asset.symbol}</Text>}
                      </View>
                      <View style={styles.assetDetails}>
                        <Text style={styles.assetAmount}>{formatCurrency(asset.converted_amount)}</Text>
                        {asset.current_shares > 0 && (
                          <Text style={styles.assetShares}>{asset.current_shares.toLocaleString()} 股</Text>
                        )}
                      </View>
                      {asset.average_cost > 0 && (
                        <Text style={styles.assetCost}>平均成本: {asset.currency} {asset.average_cost.toFixed(2)}</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            : /* 其他類別：直接列出 */
              categoryAssets.map(asset => (
                <TouchableOpacity key={asset.id} style={styles.assetCard} onPress={() => navigation.navigate('AssetDetail', { assetId: asset.id })}>
                  <View style={styles.assetHeader}>
                    <Text style={styles.assetName}>{asset.name}</Text>
                    {asset.symbol && <Text style={styles.assetSymbol}>{asset.symbol}</Text>}
                  </View>
                  <View style={styles.assetDetails}>
                    <Text style={styles.assetAmount}>{formatCurrency(asset.converted_amount)}</Text>
                    {asset.current_shares > 0 && (
                      <Text style={styles.assetShares}>{asset.current_shares.toLocaleString()} 股</Text>
                    )}
                  </View>
                  {asset.average_cost > 0 && (
                    <Text style={styles.assetCost}>平均成本: {asset.currency} {asset.average_cost.toFixed(2)}</Text>
                  )}
                </TouchableOpacity>
              ))
          }
        </View>
      ))}

      {assets.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>尚無資產</Text>
          <Text style={styles.emptyStateSubtext}>
            點擊「搜尋資產」開始新增您的資產
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  netWorthCard: {
    backgroundColor: 'white',
    margin: 16,
    padding: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  netWorthLabel: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  netWorthAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 16,
  },
  netWorthDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  netWorthDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  netWorthDetailText: {
    fontSize: 12,
    color: '#64748b',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  syncButtonText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
  },
  categorySection: {
    marginBottom: 16,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  categoryIndicator: {
    width: 4,
    height: 20,
    borderRadius: 2,
    marginRight: 12,
  },
  categoryTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
  categoryTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  marketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  marketDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  marketTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  marketTotal: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
  },
  assetCard: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  assetCardIndented: {
    paddingLeft: 24,
  },
  assetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  assetName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1e293b',
    flex: 1,
  },
  assetSymbol: {
    fontSize: 12,
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  assetDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assetAmount: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  assetShares: {
    fontSize: 12,
    color: '#64748b',
  },
  assetCost: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
  },
});
