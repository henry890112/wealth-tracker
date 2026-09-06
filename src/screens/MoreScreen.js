import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bot, ChevronRight, CircleHelp, CloudUpload, CreditCard, DollarSign,
  FileDown, Globe, Info, Palette, Settings2, UserRound,
} from 'lucide-react-native';
import { useTheme } from '../lib/ThemeContext';

const PRIMARY = '#F59E0B';

const SECTIONS = [
  {
    title: '財務工具',
    items: [
      { title: '固定支出', subtitle: '管理定期扣款與固定支出', Icon: CreditCard, color: '#3B82F6', route: 'FixedExpenses' },
      { title: '應收款項', subtitle: '追蹤借出款項與收款狀態', Icon: DollarSign, color: '#14B8A6', route: 'Receivables' },
      { title: 'AI 財務分析', subtitle: '資產組合分析與投資建議', Icon: Bot, color: PRIMARY, route: 'AI' },
    ],
  },
  {
    title: '資料',
    items: [
      { title: '匯出與備份', subtitle: '匯出報表、備份或還原資料', Icon: FileDown, color: '#8B5CF6', route: 'Settings' },
      { title: '同步狀態', subtitle: '查看報價與資料同步設定', Icon: CloudUpload, color: '#3B82F6', route: 'Settings' },
    ],
  },
  {
    title: '偏好設定',
    items: [
      { title: '外觀與主題', subtitle: '調整淺色、深色與系統主題', Icon: Palette, color: '#F97316', route: 'Settings' },
      { title: '基準貨幣', subtitle: '設定預設貨幣與顯示方式', Icon: Globe, color: '#14B8A6', route: 'Settings' },
      { title: '所有設定', subtitle: '帳號、資料與其他選項', Icon: Settings2, color: '#64748B', route: 'Settings' },
    ],
  },
  {
    title: '支援',
    items: [
      { title: '使用說明', subtitle: '教學與常見問題', Icon: CircleHelp, color: '#3B82F6' },
      { title: '關於 WealthTracker', subtitle: '版本資訊與服務條款', Icon: Info, color: '#64748B' },
    ],
  },
];

export default function MoreScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const open = (route) => route && navigation.navigate(route);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingTop: insets.top + 18, paddingBottom: 120 }}
    >
      <Text style={[styles.title, { color: colors.text }]}>更多</Text>

      <TouchableOpacity style={[styles.profile, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => open('Settings')}>
        <View style={styles.profileIcon}><UserRound size={26} color="#2563EB" /></View>
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
            {section.items.map((item, index) => (
              <TouchableOpacity
                key={item.title}
                style={[styles.row, index < section.items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                onPress={() => open(item.route)}
                disabled={!item.route}
              >
                <View style={[styles.iconWrap, { backgroundColor: `${item.color}18` }]}>
                  <item.Icon size={21} color={item.color} />
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{item.title}</Text>
                  <Text style={[styles.subtitle, { color: colors.textSub }]}>{item.subtitle}</Text>
                </View>
                <ChevronRight size={19} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
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
