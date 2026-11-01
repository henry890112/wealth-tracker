import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import CompactDataTable from './CompactDataTable';

const finite = value => Number.isFinite(Number(value));
const numberText = (value, digits = 2) => finite(value) ? Number(value).toFixed(digits) : '—';
const dateText = value => String(value || '').replaceAll('-', '/').slice(0, 10) || '—';

const eventTypeText = event => {
  if (event?.type === 'mixed') return '權息';
  if (event?.type === 'stock') return '除權';
  if (event?.type === 'split') return '拆併';
  return '除息';
};

const fillText = status => ({
  filled: '已填權息',
  unfilled: '尚未填權息',
  pending: '等待回補',
  not_applicable: '—',
}[status] || '—');

function EventTypeCell({ event, colors }) {
  const typeColor = event?.type === 'stock' || event?.type === 'split'
    ? colors.accent
    : event?.type === 'mixed' ? colors.warning : colors.positive;
  const amount = event?.type === 'split'
    ? (event.ratioLabel || '—')
    : [finite(event?.cashDividend) ? `息 ${numberText(event.cashDividend)}` : null, finite(event?.stockDividend) && Number(event.stockDividend) > 0 ? `權 ${numberText(event.stockDividend, 4)}` : null]
      .filter(Boolean).join(' · ') || '金額未提供';
  return <View style={styles.eventTypeCell}>
      <View style={[styles.typeBadge, { backgroundColor: `${typeColor}20`, borderColor: typeColor }]}><Text style={[styles.typeBadgeText, { color: typeColor }]}>{eventTypeText(event)}</Text></View>
      <Text numberOfLines={1} style={[styles.eventAmount, { color: colors.text }]}>{amount}</Text>
  </View>;
}

export default function CorporateActionsCard({ data, loading, error, colors, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const events = useMemo(() => [...(data?.events || [])]
    .filter(event => event?.exDate || event?.announcementDate)
    .sort((a, b) => String(b.exDate || b.announcementDate).localeCompare(String(a.exDate || a.announcementDate))), [data?.events]);
  const visibleEvents = expanded ? events : events.slice(0, 8);
  const summary = data?.summary || {};
  const nextEvent = summary.nextEvent;
  const latestEvent = summary.latestEvent;
  const currency = data?.currency || (String(data?.marketType).toUpperCase() === 'TW' ? 'TWD' : 'USD');
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.header}>
      <View style={styles.flex}><Text style={[styles.title, { color: colors.text }]}>股利／除權息</Text><Text style={[styles.subtitle, { color: colors.textMuted }]}>{data?.source || '股利事件資料'} · 更新 {data?.asOf || '等待資料'}</Text></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="更新股利除權息資料" onPress={onRefresh} disabled={loading} style={[styles.refresh, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>{loading ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={14} color={colors.textSub} />}</TouchableOpacity>
    </View>

    {loading && !data ? <View style={[styles.state, { backgroundColor: colors.cardAlt }]}><ActivityIndicator color={colors.accent} /><Text style={[styles.stateText, { color: colors.textSub }]}>正在整理股利與除權息資料…</Text></View>
      : error && !data ? <View style={[styles.state, { backgroundColor: colors.cardAlt }]}><Text style={[styles.stateTitle, { color: colors.text }]}>暫時無法取得資料</Text><Text style={[styles.stateText, { color: colors.textSub }]}>{error}</Text></View>
        : <>
          <View style={styles.nextRow}>
            <View style={[styles.nextBox, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
              <Text style={[styles.nextLabel, { color: colors.accent }]}>下一次已公告</Text>
              <Text style={[styles.nextValue, { color: colors.text }]}>{nextEvent?.exDate ? dateText(nextEvent.exDate) : '尚未公告'}</Text>
              <Text style={[styles.nextMeta, { color: colors.textSub }]}>{nextEvent ? `${eventTypeText(nextEvent)} · ${finite(nextEvent.cashDividend) ? `${numberText(nextEvent.cashDividend)} ${currency}` : '金額待確認'}` : '資料來源目前沒有未來日期'}</Text>
            </View>
            <View style={[styles.nextBox, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
              <Text style={[styles.nextLabel, { color: colors.textMuted }]}>最近一次</Text>
              <Text style={[styles.nextValue, { color: colors.text }]}>{latestEvent?.exDate ? dateText(latestEvent.exDate) : '—'}</Text>
              <Text style={[styles.nextMeta, { color: colors.textSub }]}>{latestEvent ? `${eventTypeText(latestEvent)} · 發放 ${dateText(latestEvent.paymentDate)}` : '尚無事件'}</Text>
            </View>
          </View>
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryItem, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.summaryLabel, { color: colors.textMuted }]}>近 12 月現金股利</Text><Text style={[styles.summaryValue, { color: colors.text }]}>{finite(summary.trailingCashDividend) ? `${numberText(summary.trailingCashDividend)} ${currency}` : '—'}</Text></View>
            <View style={[styles.summaryItem, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.summaryLabel, { color: colors.textMuted }]}>近 12 月殖利率</Text><Text style={[styles.summaryValue, { color: colors.positive }]}>{finite(summary.trailingYield) ? `${numberText(summary.trailingYield)}%` : '—'}</Text></View>
            <View style={[styles.summaryItem, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.summaryLabel, { color: colors.textMuted }]}>近 5 年事件</Text><Text style={[styles.summaryValue, { color: colors.text }]}>{events.length} 次</Text></View>
            <View style={[styles.summaryItem, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.summaryLabel, { color: colors.textMuted }]}>平均頻率</Text><Text style={[styles.summaryValue, { color: colors.text }]}>{summary.frequency || '—'}</Text></View>
          </View>
          {visibleEvents.length ? <>
            <CompactDataTable
              style={{ marginTop: 10 }} rows={visibleEvents} colors={colors} rowHeight={50}
              rowKey={(event, index) => `${event.exDate || event.announcementDate}-${index}`}
              fixedColumn={{ header: '除權息日', width: 82, render: event => <View style={styles.eventCentered}><Text style={[styles.eventDate, { color: colors.text }]}>{dateText(event?.exDate)}</Text><Text style={[styles.eventSub, { color: colors.textMuted }]}>{event?.status === 'announced' ? '已公告' : '除權息日'}</Text></View> }}
              columns={[
                { key: 'event', header: '事件／股利', width: 120, render: event => <EventTypeCell event={event} colors={colors} /> },
                { key: 'payment', header: '發放日', width: 88, render: event => dateText(event?.paymentDate) },
                { key: 'fill', header: '填權息', width: 86, render: event => fillText(event?.fillStatus), color: event => event?.fillStatus === 'filled' ? colors.positive : event?.fillStatus === 'unfilled' ? colors.warning : colors.textMuted },
              ]}
            />
            {events.length > 8 && <TouchableOpacity onPress={() => setExpanded(value => !value)} style={[styles.expand, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}><Text style={[styles.expandText, { color: colors.accent }]}>{expanded ? '收合歷史事件' : `查看全部 ${events.length} 次事件`}</Text></TouchableOpacity>}
          </> : <View style={[styles.state, { backgroundColor: colors.cardAlt }]}><Text style={[styles.stateTitle, { color: colors.text }]}>目前沒有可用股利事件</Text><Text style={[styles.stateText, { color: colors.textSub }]}>可能是公司沒有配息，或資料來源尚未提供。</Text></View>}
        </>}
    {!!data?.warnings?.length && <Text style={[styles.warning, { color: colors.textMuted }]}>{data.warnings.join('；')}</Text>}
    {error && data && <Text style={[styles.warning, { color: colors.warning }]}>更新失敗，畫面保留上次成功資料：{error}</Text>}
    <Text style={[styles.note, { color: colors.textMuted }]}>股利與除權息是公司行動資料；殖利率與填權息狀態會隨價格、資料日期及來源更新，不構成買賣建議。</Text>
  </View>;
}

const styles = StyleSheet.create({
  eventCentered: { alignItems: 'center' },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, overflow: 'hidden' }, flex: { flex: 1, minWidth: 0 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, title: { fontSize: 17, fontWeight: '900' }, subtitle: { fontSize: 9, marginTop: 3 }, refresh: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  nextRow: { flexDirection: 'row', gap: 8, marginTop: 12 }, nextBox: { flex: 1, borderWidth: 1, borderRadius: 13, padding: 10, minHeight: 84 }, nextLabel: { fontSize: 10, fontWeight: '800' }, nextValue: { fontSize: 19, fontWeight: '900', marginTop: 5 }, nextMeta: { fontSize: 9, lineHeight: 14, marginTop: 3 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, summaryItem: { width: '48%', borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 68 }, summaryLabel: { fontSize: 9 }, summaryValue: { fontSize: 15, fontWeight: '900', marginTop: 6 },
  eventTypeCell: { alignItems: 'center' }, eventDate: { fontSize: 10, fontWeight: '800' }, eventSub: { fontSize: 8, marginTop: 2 }, eventAmount: { fontSize: 9, marginTop: 4, textAlign: 'center' }, typeBadge: { alignSelf: 'center', borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }, typeBadgeText: { fontSize: 8, fontWeight: '900' },
  expand: { borderWidth: 1, borderRadius: 10, minHeight: 32, alignItems: 'center', justifyContent: 'center', marginTop: 9 }, expandText: { fontSize: 10, fontWeight: '900' }, state: { minHeight: 140, alignItems: 'center', justifyContent: 'center', borderRadius: 13, padding: 20, gap: 7, marginTop: 12 }, stateTitle: { fontSize: 13, fontWeight: '900' }, stateText: { fontSize: 10, lineHeight: 16, textAlign: 'center' }, warning: { fontSize: 9, lineHeight: 14, marginTop: 10 }, note: { fontSize: 9, lineHeight: 14, marginTop: 9 },
});
