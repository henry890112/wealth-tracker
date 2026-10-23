import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BarChart3, BellRing, Bot, ChevronRight, CircleHelp, CloudUpload, CreditCard, Landmark,
  FileDown, Globe, Info, Newspaper, Palette, Settings2, TrendingUp, UserRound,
} from 'lucide-react-native';
import { useTheme } from '../lib/ThemeContext';

const SECTIONS = [
  {
    title: '財務工具',
    items: [
      { title: '固定支出', subtitle: '管理定期扣款與固定支出', Icon: CreditCard, route: 'FixedExpenses' },
      { title: '市場動態', subtitle: '台美大盤、科技、半導體、估值與利率', Icon: TrendingUp, route: 'MarketOverview' },
      { title: '美股／台股選擇權分析', subtitle: 'Gamma 敞口、Call／Put Wall 與成交量分布', Icon: BarChart3, route: 'OptionsAnalysis' },
      { title: 'AI 財務分析', subtitle: '資產組合分析與投資建議', Icon: Bot, route: 'AI' },
      { title: '台股研究訊號', subtitle: '低估值、法人與趨勢的每日篩選', Icon: BarChart3, route: 'InvestmentSignals' },
    ],
  },
  {
    title: '資料',
    items: [
      { title: '匯出與備份', subtitle: '匯出報表、備份或還原資料', Icon: FileDown, route: 'Settings', params: { section: 'data' } },
      { title: '同步狀態', subtitle: '查看報價與資料同步設定', Icon: CloudUpload, route: 'Settings', params: { section: 'sync' } },
      { title: '玉山證券', subtitle: '查看持倉、即時市值與未實現損益', Icon: Landmark, route: 'EsunSync' },
    ],
  },
  {
    title: '偏好設定',
    items: [
      { title: '訊號通知', subtitle: '設定每日／每小時 Email 與 LINE 提醒', Icon: BellRing, route: 'SignalNotificationSettings' },
      { title: '重大事件通知', subtitle: 'AI 搜尋持倉相關事件與來源連結', Icon: Newspaper, route: 'MajorEventNotifications' },
      { title: '外觀與主題', subtitle: '調整淺色、深色與系統主題', Icon: Palette, route: 'Settings', params: { section: 'theme' } },
      { title: '基準貨幣', subtitle: '設定預設貨幣與顯示方式', Icon: Globe, route: 'Settings', params: { section: 'currency' } },
      { title: '所有設定', subtitle: '帳號、資料與其他選項', Icon: Settings2, route: 'Settings' },
    ],
  },
  {
    title: '支援',
    items: [
      { title: '使用說明', subtitle: '教學與常見問題', Icon: CircleHelp },
      { title: '關於 WealthTracker', subtitle: '版本資訊與服務條款', Icon: Info },
    ],
  },
];

export default function MoreScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const open = (route, params) => route && navigation.navigate(route, params);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingTop: insets.top + 18, paddingBottom: 120 }}
    >
      <Text style={[styles.title, { color: colors.text }]}>更多</Text>

      <TouchableOpacity style={[styles.profile, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => open('Settings', { section: 'account' })}>
        <View style={[styles.profileIcon, { backgroundColor: colors.accentSoft }]}><UserRound size={26} color={colors.accent} /></View>
        <View style={styles.flex}>
          <Text style={[styles.profileTitle, { color: colors.text }]}>個人帳戶</Text>
          <Text style={[styles.subtitle, { color: colors.textSub }]}>管理帳號與個人設定</Text>
        </View>
        <ChevronRight size={20} color={colors.textMuted} />
      </TouchableOpacity>

      {SECTIONS.map(section => (
        <View key={section.title} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {section.items.map((item, index) => {
              const itemColor = colors.chartPalette[index % colors.chartPalette.length];
              return (
              <TouchableOpacity
                key={item.title}
                style={[styles.row, index < section.items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                onPress={() => open(item.route, item.params)}
                disabled={!item.route}
              >
                <View style={[styles.iconWrap, { backgroundColor: `${itemColor}18` }]}>
                  <item.Icon size={21} color={itemColor} />
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{item.title}</Text>
                  <Text style={[styles.subtitle, { color: colors.textSub }]}>{item.subtitle}</Text>
                </View>
                <ChevronRight size={19} color={colors.textMuted} />
              </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 32, fontWeight: '800', paddingHorizontal: 20, marginBottom: 18 },
  profile: { marginHorizontal: 16, borderWidth: 1, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  profileIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EAF2FF', alignItems: 'center', justifyContent: 'center' },
  profileTitle: { fontSize: 17, fontWeight: '700', marginBottom: 3 },
  flex: { flex: 1 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 19, fontWeight: '700', marginBottom: 10, paddingHorizontal: 2 },
  card: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  row: { minHeight: 76, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
