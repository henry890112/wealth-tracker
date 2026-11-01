import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { getTaipeiDateString } from '../../../lib/date';
import { PNL_GAIN_SOFT, PNL_LOSS_SOFT, PNL_METRICS, pnlColor, signedPnlAmount, signedPnlPercent } from '../tradePnl';

const pad2 = n => String(n).padStart(2, '0');

export default function PerformanceCalendar({ performanceMode, calendarEarningsOnly, setCalendarEarningsOnly, selectedPnlMetricConfig, selectedFilter, selectedFilterLabel, calendarLoading, performanceDataLoading, earningsCalendarLoading, selectedPnlMetric, setSelectedPnlMetric, calendarMonth, prevMonth, nextMonth, calendarMonthSummary, performanceDataError, dailyPnlMap, loadTradePerformance, calendarRows, earningsByDate, openDayDetail, isDark, fmt, fmtCompact, currency, displayedMonthEarnings, openEarningsAnalysis, earningsCalendarError, marketCalendarError, colors, styles, PRIMARY }) {
  if (performanceMode !== 'trade') return null;
  return (
    <View
          style={[styles.card, { marginHorizontal: 16, marginTop: 16, marginBottom: 8, backgroundColor: colors.card }]}
        >
          {/* Card header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {calendarEarningsOnly ? '財報日曆' : `每日損益日曆 · ${selectedPnlMetricConfig.label}`}{selectedFilter !== 'all' ? `（${selectedFilterLabel}）` : ''}
            </Text>
            {(calendarLoading || performanceDataLoading || earningsCalendarLoading) && <ActivityIndicator size="small" color={PRIMARY} />}
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }} accessibilityRole="tablist">
            {PNL_METRICS.map(metric => {
              const active = !calendarEarningsOnly && selectedPnlMetric === metric.key;
              return <TouchableOpacity
                key={metric.key}
                onPress={() => {
                  setSelectedPnlMetric(metric.key);
                  setCalendarEarningsOnly(false);
                }}
                activeOpacity={0.75}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={{ flex: 1, minHeight: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? PRIMARY : colors.cardAlt, borderWidth: 1, borderColor: active ? PRIMARY : colors.border }}
              >
                <Text style={{ color: active ? colors.accentContrast : colors.textSub, fontSize: 10, fontWeight: active ? '800' : '600' }}>{metric.label}</Text>
              </TouchableOpacity>;
            })}
            <TouchableOpacity
              onPress={() => setCalendarEarningsOnly(true)}
              activeOpacity={0.75}
              accessibilityRole="tab"
              accessibilityLabel="財報日曆"
              accessibilityState={{ selected: calendarEarningsOnly }}
              style={{ flex: 1, minHeight: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: calendarEarningsOnly ? PRIMARY : colors.cardAlt, borderWidth: 1, borderColor: calendarEarningsOnly ? PRIMARY : colors.border }}
            >
              <Text style={{ color: calendarEarningsOnly ? colors.accentContrast : colors.textSub, fontSize: 10, fontWeight: calendarEarningsOnly ? '800' : '600' }}>
                財報
              </Text>
            </TouchableOpacity>
          </View>

          {/* Month navigator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
            <TouchableOpacity onPress={prevMonth} style={{ padding: 8 }} activeOpacity={0.7}>
              <ChevronLeft size={20} color={colors.textSub} />
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, minWidth: 130, textAlign: 'center' }}>
              {calendarMonth.year}年 {calendarMonth.month}月
            </Text>
            <TouchableOpacity onPress={nextMonth} style={{ padding: 8 }} activeOpacity={0.7}>
              <ChevronRight size={20} color={colors.textSub} />
            </TouchableOpacity>
          </View>

          {/* Monthly P&L summary */}
          {!calendarEarningsOnly && (calendarMonthSummary ? (
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              {(() => {
                const summaryValue = selectedPnlMetric === 'realized'
                  ? calendarMonthSummary.realizedDiff
                  : selectedPnlMetric === 'unrealized'
                    ? calendarMonthSummary.unrealizedDiff
                    : calendarMonthSummary.diff;
                const summaryPct = selectedPnlMetric === 'realized'
                  ? calendarMonthSummary.realizedPct
                  : selectedPnlMetric === 'unrealized'
                    ? calendarMonthSummary.unrealizedPct
                    : calendarMonthSummary.pct;
                return <Text style={{ fontSize: 14, fontWeight: '700', color: pnlColor(summaryValue, colors.textMuted) }}>
                  {selectedPnlMetricConfig.label} {signedPnlAmount(summaryValue, fmt)} {currency}
                  {'  '}({signedPnlPercent(summaryPct, 2)})
                </Text>;
              })()}
            </View>
          ) : performanceDataLoading ? (
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              正在重算每日 FIFO 損益…
            </Text>
          ) : !calendarLoading && (
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              {performanceDataError ? '本月每日損益暫時無法計算' : '本月尚無損益紀錄'}
            </Text>
          ))}
          {!calendarEarningsOnly && performanceMode === 'trade' && !!performanceDataError && (
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: colors.warning, fontSize: 10, lineHeight: 15, textAlign: 'center' }}>
                {performanceDataError}{Object.keys(dailyPnlMap).length ? '；目前顯示上次成功計算的資料' : ''}
              </Text>
              {!performanceDataLoading && <TouchableOpacity onPress={() => loadTradePerformance(selectedFilter)} style={{ padding: 5 }}>
                <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>重試計算</Text>
              </TouchableOpacity>}
            </View>
          )}

          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginBottom: 10 }}>
            {calendarEarningsOnly
              ? '只顯示持有或收藏標的的財報日期；Q 代表財報季度，預估日期可能調整'
              : '點選有損益的日期查看明細'}
          </Text>

          {/* Day-of-week headers: Sun → Sat */}
          <View style={{ flexDirection: 'row', marginBottom: 6 }}>
            {['日', '一', '二', '三', '四', '五', '六'].map(d => (
              <Text key={d} style={{
                flex: 1, textAlign: 'center',
                fontSize: 11, fontWeight: '600',
                color: colors.textMuted,
              }}>
                {d}
              </Text>
            ))}
          </View>

          {/* Calendar grid */}
          {(() => {
            const todayStr = getTaipeiDateString();
            return calendarRows.map((week, wi) => (
            <View key={wi} style={{ flexDirection: 'row', marginBottom: 3 }}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={{ flex: 1 }} />;
                const dateStr = `${calendarMonth.year}-${pad2(calendarMonth.month)}-${pad2(day)}`;
                const dayEarnings = earningsByDate[dateStr] || [];
                const pnl     = dailyPnlMap[dateStr];
                const hasPnl  = pnl != null;
                const totalDiff = Number(pnl?.totalDiff ?? pnl?.diff) || 0;
                const realizedDiff = Number(pnl?.realizedDiff) || 0;
                const unrealizedDiff = Number(pnl?.unrealizedDiff) || 0;
                const selectedDiff = selectedPnlMetric === 'realized'
                  ? realizedDiff
                  : selectedPnlMetric === 'unrealized'
                    ? unrealizedDiff
                    : totalDiff;
                const selectedPct = selectedPnlMetric === 'realized'
                  ? Number(pnl?.realizedPct)
                  : selectedPnlMetric === 'unrealized'
                    ? Number(pnl?.unrealizedPct)
                    : Number(pnl?.totalPct);
                const showPnl = hasPnl && !calendarEarningsOnly;
                const isPositive = showPnl && selectedDiff > 0;
                const isNegative = showPnl && selectedDiff < 0;
                const dayTone = pnlColor(selectedDiff, colors.textMuted);
                const pct     = showPnl && Number.isFinite(selectedPct)
                  ? selectedPct : (hasPnl && pnl.prevValue > 0 ? (selectedDiff / pnl.prevValue) * 100 : 0);
                const isToday = dateStr === todayStr;
                const canOpenDetail = calendarEarningsOnly ? dayEarnings.length > 0 : showPnl;
                const Cell    = canOpenDetail ? TouchableOpacity : View;
                return (
                  <Cell
                    key={di}
                    onPress={canOpenDetail
                      ? () => openDayDetail(dateStr, calendarEarningsOnly ? 'earnings' : 'pnl', dayEarnings)
                      : undefined}
                    activeOpacity={0.7}
                    accessibilityRole={canOpenDetail ? 'button' : undefined}
                    accessibilityLabel={canOpenDetail
                      ? calendarEarningsOnly
                        ? `${dateStr} 財報事件 ${dayEarnings.length} 檔`
                        : `${dateStr} ${selectedPnlMetricConfig.label} ${signedPnlAmount(selectedDiff, fmt)} ${currency}`
                      : dateStr}
                    style={{
                      flex: 1,
                      marginHorizontal: 2,
                      borderRadius: 8,
                      paddingVertical: 5,
                      paddingHorizontal: 1,
                      backgroundColor: isPositive
                        ? PNL_GAIN_SOFT
                        : isNegative
                          ? PNL_LOSS_SOFT
                          : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                      alignItems: 'center',
                      minHeight: 70,
                      borderWidth: isToday ? 1.5 : 0,
                      borderColor: isToday ? PRIMARY : 'transparent',
                    }}
                  >
                    <Text style={{
                      fontSize: 11,
                      color: isToday ? PRIMARY
                        : showPnl ? colors.textSub : colors.textMuted,
                      fontWeight: isToday ? '800' : '600',
                      marginBottom: 3,
                    }}>
                      {day}
                    </Text>
                    {showPnl && (
                      <>
                        <Text style={{
                          fontSize: 10, fontWeight: '700',
                          color: dayTone,
                          textAlign: 'center',
                        }} numberOfLines={1}>
                          {signedPnlPercent(pct, 1)}
                        </Text>
                        <Text style={{
                          fontSize: 9, fontWeight: '700',
                          color: dayTone,
                          textAlign: 'center', opacity: 0.9,
                        }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                          {signedPnlAmount(selectedDiff, fmtCompact)}
                        </Text>
                      </>
                    )}
                    {calendarEarningsOnly && dayEarnings.slice(0, 2).map((event, eventIndex) => (
                      <Text key={`${event.key}:${eventIndex}`} style={{ fontSize: 7, lineHeight: 9, fontWeight: '800', color: colors.accent, maxWidth: '100%' }} numberOfLines={1}>
                        {event.symbol}{event.quarter ? ` ${event.quarter.match(/Q[1-4]/)?.[0] || ''}` : ''}
                      </Text>
                    ))}
                    {calendarEarningsOnly && dayEarnings.length > 2 && <Text style={{ fontSize: 7, lineHeight: 9, color: colors.accent }}>+{dayEarnings.length - 2}</Text>}
                  </Cell>
                );
              })}
            </View>
          ));
          })()}

          {calendarEarningsOnly && <View style={{ marginTop: 10, borderRadius: 12, padding: 11, backgroundColor: colors.cardAlt }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>本月財報事件</Text>
              <Text style={{ color: colors.accent, fontSize: 10, fontWeight: '800' }}>{displayedMonthEarnings.length} 檔</Text>
            </View>
            {displayedMonthEarnings.map((event, eventIndex) => (
              <TouchableOpacity key={`${event.key}:${eventIndex}`} accessibilityRole="button" accessibilityLabel={`開啟 ${event.symbol} 財報分析`} activeOpacity={0.75} onPress={() => openEarningsAnalysis(event)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 8 }}>
                <Text style={{ width: 42, color: colors.textSub, fontSize: 10, fontWeight: '800' }}>{event.date.slice(8)}日</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>
                    {event.symbol}{event.quarter ? ` · ${event.quarter}` : ''} · {event.name || event.symbol}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 9, marginTop: 2 }} numberOfLines={1}>
                    {[
                      event.isHolding && '持有',
                      event.isWatchlist && '收藏',
                      event.status === 'released' ? '已公告'
                        : event.status === 'recent' ? '最近一次'
                          : event.isFilingDeadline || event.status === 'filing_deadline' ? '法定申報期限' : '預估',
                      event.isFilingDeadline && event.status === 'released' && '同日申報期限',
                      String(event.source || '第三方資料').split(/[・＋]/)[0],
                      event.sourceDate && event.sourceDate !== event.date && `美國 ${event.sourceDate.slice(5)} ${event.time || ''}`,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            {!displayedMonthEarnings.length && (
              <Text style={{ color: colors.textMuted, fontSize: 10, lineHeight: 15, paddingVertical: 5 }}>
                {earningsCalendarLoading ? '正在查詢持倉與收藏標的…' : '本月尚未取得財報日期；部分公司可能尚未提供日期。'}
              </Text>
            )}
            {!!earningsCalendarError && <Text style={{ color: colors.warning, fontSize: 9, lineHeight: 14, marginTop: 4 }}>{earningsCalendarError}</Text>}
            {!!marketCalendarError && <Text style={{ color: colors.warning, fontSize: 9, lineHeight: 14, marginTop: 4 }}>{marketCalendarError}</Text>}
            <Text style={{ color: colors.textMuted, fontSize: 9, lineHeight: 14, marginTop: 5 }}>
              美股預估日可能調整；台股日期是一般曆年制公司的法定申報期限提醒，不代表公司預告日，金控等特殊產業期限可能不同。實際公告請以公開資訊觀測站及公司公告為準。
            </Text>
          </View>}
        </View>
  );
}
