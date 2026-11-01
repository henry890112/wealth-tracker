import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Check, CircleAlert, Search, X } from 'lucide-react-native';
import { switchAssetKey } from '../assetSelection';

export default function AssetSwitcherModal({ visible, onClose, assets, query, setQuery, market, setMarket, source = 'ALL', setSource, loading, error, currentKey, onSelect, onRefresh, colors, multiSelect = false, selectedKeys = [], onToggle, maxSelected = 3, title = '切換個股', hint = '持倉與自選標的，不必返回上一頁', manualSymbol = '', setManualSymbol, onAddManual, manualError = '', styles }) {
  const marketName = market => ({ TW: '台股', US: '美股', CRYPTO: '虛擬貨幣' }[String(market || '').toUpperCase()] || market);
  return <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.strategySheetOverlay}>
      <Pressable accessibilityRole="button" accessibilityLabel="關閉個股切換器" style={StyleSheet.absoluteFill} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.assetKeyboardAvoiding}>
      <View style={[styles.assetSwitcherSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.strategySheetHeader}>
          <View style={styles.flex}><Text style={[styles.strategySheetTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.strategySheetHint, { color: colors.textSub }]}>{multiSelect ? `${hint} · 最多 ${maxSelected} 檔` : hint}</Text></View>
          <TouchableOpacity onPress={onClose} style={[styles.strategySheetClose, { backgroundColor: colors.cardAlt }]}><X size={20} color={colors.textSub} /></TouchableOpacity>
        </View>
        <View style={[styles.assetSwitcherSearch, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
          <Search size={17} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="搜尋代碼或名稱"
            placeholderTextColor={colors.textMuted}
            style={[styles.assetSwitcherInput, { color: colors.text }]}
          />
          {!!query && <TouchableOpacity accessibilityLabel="清除搜尋" onPress={() => setQuery('')}><X size={16} color={colors.textMuted} /></TouchableOpacity>}
        </View>
        {multiSelect && <View style={styles.manualCompareRow}>
          <TextInput
            value={manualSymbol}
            onChangeText={setManualSymbol}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={String(market).toUpperCase() === 'TW' ? '直接輸入台股代碼' : String(market).toUpperCase() === 'CRYPTO' ? '直接輸入幣種代碼' : String(market).toUpperCase() === 'ALL' ? '代碼或市場:代碼，例如 US:AAPL' : '直接輸入美股代碼'}
            placeholderTextColor={colors.textMuted}
            style={[styles.manualCompareInput, { color: colors.text, backgroundColor: colors.cardAlt, borderColor: colors.border }]}
          />
          <TouchableOpacity onPress={onAddManual} style={[styles.manualCompareButton, { backgroundColor: colors.accent }]}><Text style={[styles.manualCompareButtonText, { color: colors.accentContrast }]}>加入</Text></TouchableOpacity>
        </View>}
        {!!manualError && <Text style={[styles.assetSwitcherError, { color: colors.warning, marginBottom: 8 }]}>{manualError}</Text>}
        {!!setSource && <View style={styles.assetSwitcherFilterGroup}>
          <Text style={[styles.assetSwitcherFilterLabel, { color: colors.textMuted }]}>來源</Text>
          <ScrollView horizontal style={styles.assetSwitcherMarketScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assetSwitcherMarkets}>
            {[['ALL', '全部'], ['HOLDING', '持倉'], ['WATCHLIST', '自選']].map(([key, label]) => (
              <TouchableOpacity key={key} onPress={() => setSource(key)} style={[styles.assetSwitcherMarketChip, { backgroundColor: source === key ? colors.accentSoft : colors.cardAlt, borderColor: source === key ? colors.accent : colors.border }]}>
                <Text style={[styles.assetSwitcherMarketText, { color: source === key ? colors.accent : colors.textSub }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>}
        <View style={styles.assetSwitcherFilterGroup}>
          <Text style={[styles.assetSwitcherFilterLabel, { color: colors.textMuted }]}>市場</Text>
          <ScrollView horizontal style={styles.assetSwitcherMarketScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assetSwitcherMarkets}>
          {[['ALL', '全部'], ['TW', '台股'], ['US', '美股'], ['CRYPTO', '虛擬貨幣']].map(([key, label]) => (
            <TouchableOpacity key={key} onPress={() => setMarket(key)} style={[styles.assetSwitcherMarketChip, { backgroundColor: market === key ? colors.accentSoft : colors.cardAlt, borderColor: market === key ? colors.accent : colors.border }]}>
              <Text style={[styles.assetSwitcherMarketText, { color: market === key ? colors.accent : colors.textSub }]}>{label}</Text>
            </TouchableOpacity>
          ))}
          </ScrollView>
        </View>
        {loading ? <View style={styles.assetSwitcherState}><ActivityIndicator color={colors.accent} /><Text style={[styles.strategySheetHint, { color: colors.textSub }]}>載入持倉與自選…</Text></View>
          : error ? <View style={styles.assetSwitcherState}><CircleAlert size={22} color={colors.warning} /><Text style={[styles.assetSwitcherError, { color: colors.textSub }]}>{error}</Text><TouchableOpacity onPress={onRefresh}><Text style={{ color: colors.accent, fontWeight: '800' }}>重新載入</Text></TouchableOpacity></View>
            : <ScrollView style={styles.assetSwitcherList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {assets.length ? assets.map(asset => {
                const key = switchAssetKey(asset);
                const selected = multiSelect ? selectedKeys.includes(key) : key === currentKey;
                return <TouchableOpacity
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => multiSelect ? onToggle?.(asset) : onSelect(asset)}
                  style={[styles.assetSwitcherRow, { borderBottomColor: colors.borderLight, backgroundColor: selected ? colors.accentSoft : 'transparent' }]}
                >
                  <View style={styles.flex}><Text style={[styles.assetSwitcherSymbol, { color: selected ? colors.accent : colors.text }]}>{asset.symbol}</Text><Text numberOfLines={1} style={[styles.assetSwitcherName, { color: colors.textSub }]}>{asset.name || asset.symbol} · {marketName(asset.market_type)}</Text></View>
                  <View style={styles.assetSwitcherBadges}>{asset.isHolding && <View style={[styles.assetSwitcherBadge, { borderColor: colors.accent }]}><Text style={[styles.assetSwitcherBadgeText, { color: colors.accent }]}>持倉</Text></View>}{asset.isWatchlist && <View style={[styles.assetSwitcherBadge, { borderColor: colors.border }]}><Text style={[styles.assetSwitcherBadgeText, { color: colors.textSub }]}>自選</Text></View>}{selected && <Check size={18} color={colors.accent} />}</View>
                </TouchableOpacity>;
              }) : <View style={styles.assetSwitcherState}><Text style={[styles.assetSwitcherError, { color: colors.textSub }]}>{query ? '找不到符合的持倉或自選標的' : '目前沒有持倉或自選標的'}</Text></View>}
            </ScrollView>}
        {multiSelect && <TouchableOpacity onPress={onClose} style={[styles.assetSwitcherDone, { backgroundColor: colors.accent }]}><Text style={[styles.assetSwitcherDoneText, { color: colors.accentContrast }]}>完成</Text></TouchableOpacity>}
      </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}
