import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { supabase } from '../lib/supabase';

const screenWidth = Dimensions.get('window').width;

export default function TrendsScreen() {
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState([]);
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState({
    currentNetWorth: 0,
    change: 0,
    changePercent: 0,
    highestNetWorth: 0,
    lowestNetWorth: 0,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      setProfile(profileData);

      // Get snapshots for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: snapshotsData, error } = await supabase
        .from('daily_snapshots')
        .select('*')
        .eq('user_id', user.id)
        .gte('snapshot_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: true });

      if (error) throw error;

      setSnapshots(snapshotsData || []);

      // Calculate statistics
      if (snapshotsData && snapshotsData.length > 0) {
        const current = parseFloat(snapshotsData[snapshotsData.length - 1].net_worth_base);
        const first = parseFloat(snapshotsData[0].net_worth_base);
        const change = current - first;
        const changePercent = first !== 0 ? (change / first) * 100 : 0;

        const netWorths = snapshotsData.map(s => parseFloat(s.net_worth_base));
        const highest = Math.max(...netWorths);
        const lowest = Math.min(...netWorths);

        setStats({
          currentNetWorth: current,
          change,
          changePercent,
          highestNetWorth: highest,
          lowestNetWorth: lowest,
        });
      }
    } catch (error) {
      console.error('Error loading trends:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    const currency = profile?.base_currency || 'TWD';
    return `${currency} ${amount.toLocaleString('zh-TW', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  };

  const getChartData = () => {
    if (snapshots.length === 0) {
      return {
        labels: [''],
        datasets: [{ data: [0] }],
      };
    }

    // Show max 7 labels to avoid crowding
    const step = Math.ceil(snapshots.length / 7);
    const labels = snapshots
      .filter((_, index) => index % step === 0)
      .map(s => {
        const date = new Date(s.snapshot_date);
        return `${date.getMonth() + 1}/${date.getDate()}`;
      });

    const data = snapshots.map(s => parseFloat(s.net_worth_base));

    return {
      labels,
      datasets: [
        {
          data,
          color: (opacity = 1) => `rgba(37, 99, 235, ${opacity})`,
          strokeWidth: 2,
        },
      ],
    };
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const chartData = getChartData();
  const hasData = snapshots.length > 0;

  return (
    <ScrollView style={styles.container}>
      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>當前淨資產</Text>
          <Text style={styles.statValue}>
            {formatCurrency(stats.currentNetWorth)}
          </Text>
          {stats.change !== 0 && (
            <Text
              style={[
                styles.statChange,
                stats.change >= 0 ? styles.statChangePositive : styles.statChangeNegative,
              ]}
            >
              {stats.change >= 0 ? '+' : ''}
              {formatCurrency(stats.change)} ({stats.changePercent.toFixed(2)}%)
            </Text>
          )}
        </View>
      </View>

      {/* Chart */}
      {hasData ? (
        <View style={styles.chartContainer}>
          <Text style={styles.chartTitle}>30 天淨資產趨勢</Text>
          <LineChart
            data={chartData}
            width={screenWidth - 32}
            height={220}
            chartConfig={{
              backgroundColor: '#ffffff',
              backgroundGradientFrom: '#ffffff',
              backgroundGradientTo: '#ffffff',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(37, 99, 235, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(100, 116, 139, ${opacity})`,
              style: {
                borderRadius: 16,
              },
              propsForDots: {
                r: '4',
                strokeWidth: '2',
                stroke: '#2563eb',
              },
            }}
            bezier
            style={styles.chart}
          />
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>尚無趨勢數據</Text>
          <Text style={styles.emptyStateSubtext}>
            系統會每日自動記錄您的資產狀況
          </Text>
        </View>
      )}

      {/* Additional Stats */}
      {hasData && (
        <View style={styles.additionalStats}>
          <View style={styles.additionalStatCard}>
            <Text style={styles.additionalStatLabel}>最高淨資產</Text>
            <Text style={styles.additionalStatValue}>
              {formatCurrency(stats.highestNetWorth)}
            </Text>
          </View>

          <View style={styles.additionalStatCard}>
            <Text style={styles.additionalStatLabel}>最低淨資產</Text>
            <Text style={styles.additionalStatValue}>
              {formatCurrency(stats.lowestNetWorth)}
            </Text>
          </View>
        </View>
      )}

      {/* Recent Snapshots */}
      {hasData && (
        <View style={styles.snapshotsContainer}>
          <Text style={styles.snapshotsTitle}>最近記錄</Text>
          {snapshots.slice(-10).reverse().map((snapshot) => (
            <View key={snapshot.id} style={styles.snapshotCard}>
              <View style={styles.snapshotDate}>
                <Text style={styles.snapshotDateText}>
                  {new Date(snapshot.snapshot_date).toLocaleDateString('zh-TW')}
                </Text>
              </View>
              <View style={styles.snapshotValues}>
                <Text style={styles.snapshotNetWorth}>
                  {formatCurrency(parseFloat(snapshot.net_worth_base))}
                </Text>
                <View style={styles.snapshotDetails}>
                  <Text style={styles.snapshotDetailText}>
                    資產: {formatCurrency(parseFloat(snapshot.total_assets))}
                  </Text>
                  <Text style={styles.snapshotDetailText}>
                    負債: {formatCurrency(parseFloat(snapshot.total_liabilities))}
                  </Text>
                </View>
              </View>
            </View>
          ))}
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
  statsContainer: {
    padding: 16,
  },
  statCard: {
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statLabel: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 8,
  },
  statChange: {
    fontSize: 14,
    fontWeight: '600',
  },
  statChangePositive: {
    color: '#10b981',
  },
  statChangeNegative: {
    color: '#ef4444',
  },
  chartContainer: {
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 16,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
    backgroundColor: 'white',
    marginHorizontal: 16,
    borderRadius: 12,
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
  additionalStats: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  additionalStatCard: {
    flex: 1,
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  additionalStatLabel: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 8,
  },
  additionalStatValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
  },
  snapshotsContainer: {
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  snapshotsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 16,
  },
  snapshotCard: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  snapshotDate: {
    width: 100,
    justifyContent: 'center',
  },
  snapshotDateText: {
    fontSize: 12,
    color: '#64748b',
  },
  snapshotValues: {
    flex: 1,
  },
  snapshotNetWorth: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  snapshotDetails: {
    flexDirection: 'row',
    gap: 16,
  },
  snapshotDetailText: {
    fontSize: 11,
    color: '#94a3b8',
  },
});
