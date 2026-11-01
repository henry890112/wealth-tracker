import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Keep the identifying column visible while the numeric columns scroll as one grid.
// Rows are rendered together on both sides so their heights always stay aligned.
export default function CompactDataTable({ rows = [], fixedColumn, columns = [], rowKey, onRowPress, rowAccessibilityLabel, colors, rowHeight = 44, maxHeight, style }) {
  const rightWidth = columns.reduce((sum, column) => sum + (column.width || 104), 0);
  const fixedWidth = fixedColumn.width || 76;
  const renderContent = (content, color, header = false) => React.isValidElement(content)
    ? content
    : <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} style={[header ? styles.headerText : styles.cellText, { color }]}>{content == null || content === '' ? '—' : String(content)}</Text>;
  const renderRow = (row, index, fixed) => {
    const content = fixed ? fixedColumn.render(row, index) : null;
    const selected = Boolean(row?.selected);
    const rowStyle = [styles.row, { height: rowHeight, borderBottomColor: colors.borderLight, backgroundColor: selected ? colors.accentSoft : colors.card }];
    const cells = fixed
      ? <View style={[styles.cell, { width: fixedWidth }]}>{renderContent(content, colors.text)}</View>
      : columns.map(column => <View key={column.key} style={[styles.cell, { width: column.width || 104 }]}>{renderContent(column.render(row, index), column.color?.(row, index) || colors.text)}</View>);
    const key = rowKey?.(row, index) ?? index;
    return onRowPress ? <TouchableOpacity key={key} accessibilityRole="button" accessibilityLabel={rowAccessibilityLabel?.(row, index)} onPress={() => onRowPress(row, index)} activeOpacity={0.7} style={rowStyle}>{cells}</TouchableOpacity>
      : <View key={key} style={rowStyle}>{cells}</View>;
  };
  const table =
    <View style={[styles.table, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={[styles.fixed, { width: fixedWidth, borderRightColor: colors.border }]}>
        <View style={[styles.header, { backgroundColor: colors.cardAlt }]}><View style={[styles.cell, { width: fixedWidth }]}>{renderContent(fixedColumn.header, colors.textSub, true)}</View></View>
        {rows.map((row, index) => renderRow(row, index, true))}
      </View>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={styles.horizontal} contentContainerStyle={{ width: rightWidth }}>
        <View style={{ width: rightWidth }}>
          <View style={[styles.header, { backgroundColor: colors.cardAlt }]}>{columns.map(column => <View key={column.key} style={[styles.cell, { width: column.width || 104 }]}>{renderContent(column.header, colors.textSub, true)}</View>)}</View>
          {rows.map((row, index) => renderRow(row, index, false))}
        </View>
      </ScrollView>
    </View>;
  return maxHeight
    ? <ScrollView style={[{ maxHeight }, style]} nestedScrollEnabled showsVerticalScrollIndicator>{table}</ScrollView>
    : <View style={style}>{table}</View>;
}

const styles = StyleSheet.create({
  table: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: 'hidden' },
  fixed: { borderRightWidth: StyleSheet.hairlineWidth },
  horizontal: { flex: 1, minWidth: 0 },
  header: { height: 30, flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { height: '100%', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5 },
  headerText: { textAlign: 'center', fontSize: 10, lineHeight: 13, fontWeight: '800', includeFontPadding: false },
  cellText: { textAlign: 'center', fontSize: 10, lineHeight: 14, fontWeight: '700', includeFontPadding: false },
});
