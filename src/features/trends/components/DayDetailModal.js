import React from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { PNL_GAIN_COLOR, pnlColor, signedPnlAmount, signedPnlPercent } from '../tradePnl';

export default function DayDetailModal({ dayDetailVisible, setDayDetailVisible, dayDetailDate, dayDetailMode, dayDetailEarnings, openEarningsAnalysis, performanceMode, dailyPnlMap, selectedTradePoint, selectedDaySellRows, selectedDayTradeSummary, dayDetailNetWorth, dayDetailLoading, dayDetailData, fmt, currency, colors, styles, CATEGORY_CONFIG, MARKET_TYPE_CONFIG, PRIMARY }) {
  return (
      <Modal
        visible={dayDetailVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDayDetailVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, maxHeight: '82%' }]}>
            <View style={[styles.modalHeader, { paddingHorizontal: 24, paddingTop: 24 }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{dayDetailDate}</Text>
              <TouchableOpacity onPress={() => setDayDetailVisible(false)}>
                <X size={20} color={colors.textSub} />
              </TouchableOpacity>
            </View>
            <ScrollView
              key={`${dayDetailMode}-${dayDetailDate}-${dayDetailVisible}`}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
            >

              {dayDetailMode === 'earnings' ? (
                dayDetailEarnings.length ? (
                  <>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 12 }}>
                      當日財報事件 · {dayDetailEarnings.length} 檔
                    </Text>
                    {dayDetailEarnings.map((event, eventIndex) => {
                      const statusLabel = event.status === 'released'
                        ? '已公告'
                        : event.status === 'recent' ? '最近公布'
                          : event.isFilingDeadline || event.status === 'filing_deadline' ? '法定申報期限' : '預估日期';
                      const tags = [
                        event.isHolding && '持有中',
                        event.isWatchlist && '已收藏',
                        (event.isFilingDeadline || event.status === 'filing_deadline') && '一般期限推算',
                        String(event.source || '第三方資料').split(/[・＋]/)[0],
                        event.sourceDate && event.sourceDate !== event.date
                          && `美國日期 ${event.sourceDate}${event.time ? ` ${event.time}` : ''}`,
                      ].filter(Boolean);
                      return (
                        <TouchableOpacity
                          key={`${event.key}:${eventIndex}`}
                          accessibilityRole="button"
                          accessibilityLabel={`開啟 ${event.symbol} 財報分析`}
                          activeOpacity={0.78}
                          onPress={() => openEarningsAnalysis(event)}
                          style={{
                            backgroundColor: colors.cardAlt,
                            borderWidth: 1,
                            borderColor: colors.borderLight,
                            borderRadius: 12,
                            paddingHorizontal: 14,
                            paddingVertical: 12,
                            marginBottom: 10,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                            <Text style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>
                              {event.symbol}{event.quarter ? ` · ${event.quarter}` : ''}
                            </Text>
                            <Text style={{ color: event.status === 'released' ? PNL_GAIN_COLOR : colors.accent, fontSize: 12, fontWeight: '800' }}>
                              {statusLabel}
                            </Text>
                          </View>
                          <Text style={{ color: colors.textSub, fontSize: 12, marginBottom: 5 }} numberOfLines={2}>
                            {event.name || event.symbol}
                          </Text>
                          {!!tags.length && (
                            <Text style={{ color: colors.textMuted, fontSize: 10, lineHeight: 15 }}>
                              {tags.join(' · ')}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : (
                  <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                    此日沒有財報事件
                  </Text>
                )
              ) : performanceMode === 'trade' ? (
                dayDetailDate && (dailyPnlMap[dayDetailDate] || selectedTradePoint) ? (() => {
                  const pnl = dailyPnlMap[dayDetailDate];
                  const detailRows = [
                    { label: '已實現', value: Number(pnl?.realizedDiff) || 0, pct: Number(pnl?.realizedPct) || 0, cumulative: Number(pnl?.realizedPnl ?? selectedTradePoint?.realizedPnl) || 0 },
                    { label: '未實現', value: Number(pnl?.unrealizedDiff) || 0, pct: Number(pnl?.unrealizedPct) || 0, cumulative: Number(pnl?.unrealizedPnl ?? selectedTradePoint?.unrealizedPnl) || 0 },
                    { label: '總損益', value: Number(pnl?.totalDiff ?? pnl?.diff) || 0, pct: Number(pnl?.totalPct) || 0, cumulative: Number(pnl?.totalPnl ?? selectedTradePoint?.totalPnl) || 0 },
                  ];
                  return (
                    <>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 12 }}>
                        {pnl ? '當日變化（相較前一個圖表資料點）' : '圖表起始日，沒有前一個資料點可比較；以下顯示截至當日累計。'}
                      </Text>
                      {detailRows.map(row => (
                        <View
                          key={row.label}
                          style={{
                            backgroundColor: colors.cardAlt,
                            borderWidth: 1,
                            borderColor: colors.borderLight,
                            borderRadius: 12,
                            paddingHorizontal: 14,
                            paddingVertical: 12,
                            marginBottom: 10,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                            <Text style={{ flex: 1, color: colors.textSub, fontSize: 13, fontWeight: '700' }}>{row.label}</Text>
                            <Text style={{ color: pnlColor(row.value, colors.textMuted), fontSize: 16, fontWeight: '800' }}>
                              {signedPnlAmount(row.value, fmt)} {currency}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11 }}>
                              截至當日累計 {signedPnlAmount(row.cumulative, fmt)} {currency}
                            </Text>
                            <Text style={{ color: pnlColor(row.pct, colors.textMuted), fontSize: 12, fontWeight: '700' }}>
                              {signedPnlPercent(row.pct, 2)}
                            </Text>
                          </View>
                        </View>
                      ))}
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 8, marginBottom: 8 }}>
                        當日賣出明細 · {selectedDaySellRows.length} 檔
                      </Text>
                      {selectedDaySellRows.map(row => (
                        <View key={row.assetId} style={{ backgroundColor: colors.cardAlt, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', flex: 1 }} numberOfLines={1}>{row.symbol} · {row.name}</Text>
                            <Text style={{ color: pnlColor(row.realizedPnl, colors.textMuted), fontSize: 12, fontWeight: '800' }}>{signedPnlAmount(row.realizedPnl, fmt)} {currency}</Text>
                          </View>
                          <Text style={{ color: colors.textMuted, fontSize: 10 }}>
                            {row.matchedSellCount} 筆賣出 · 淨賣出 {fmt(row.sellProceeds)} · 已售 FIFO 成本 {fmt(row.realizedCost)} {currency}
                          </Text>
                        </View>
                      ))}
                      {!selectedDaySellRows.length && (
                        <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 8 }}>當日沒有可配對的賣出紀錄；已實現累計可能來自先前交易。</Text>
                      )}
                      {pnl && selectedDayTradeSummary && Math.abs((Number(pnl.realizedDiff) || 0) - (Number(selectedDayTradeSummary.realizedPnl) || 0)) > 1 && (
                        <Text style={{ color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 4 }}>
                          當日已實現變化與賣出明細合計不同：部分標的可能缺少官方日線，走勢終點也可能經目前持倉資料校正。
                        </Text>
                      )}
                    </>
                  );
                })() : (
                  <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                    此日無交易損益資料
                  </Text>
                )
              ) : (
                <>
                  {/* Net worth + daily change */}
                  {dayDetailDate && dailyPnlMap[dayDetailDate] && (() => {
                    const pnl = dailyPnlMap[dayDetailDate];
                    const pct = pnl.prevValue > 0 ? (pnl.diff / pnl.prevValue) * 100 : 0;
                    return (
                      <View style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.borderLight }}>
                        {dayDetailNetWorth != null && (
                          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                            {fmt(dayDetailNetWorth)} {currency}
                          </Text>
                        )}
                        <Text style={{ fontSize: 15, fontWeight: '700', color: pnlColor(pnl.diff, colors.textMuted) }}>
                          {signedPnlAmount(pnl.diff, fmt)} {currency} ({signedPnlPercent(pct, 2)})
                        </Text>
                      </View>
                    );
                  })()}

                  {/* Category breakdown */}
                  {dayDetailLoading ? (
                    <ActivityIndicator size="small" color={PRIMARY} style={{ marginTop: 16 }} />
                  ) : dayDetailData.length > 0 ? (
                    <>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSub, marginBottom: 10 }}>資產類別</Text>
                      {dayDetailData
                        .filter(d => d.value > 0)
                        .sort((a, b) => b.value - a.value)
                        .map((d, i) => {
                          const cfg   = { ...CATEGORY_CONFIG, ...MARKET_TYPE_CONFIG }[d.category];
                          const label = cfg?.label || d.category;
                          const color = cfg?.color || '#94a3b8';
                          return (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 10 }} />
                              <Text style={{ flex: 1, fontSize: 14, color: colors.textSub }}>{label}</Text>
                              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{fmt(d.value)}</Text>
                            </View>
                          );
                        })
                      }
                    </>
                  ) : (
                    <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                      此日無類別快照資料
                    </Text>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
  );
}
