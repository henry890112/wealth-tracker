import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

function renderInline(text, color, fontSize = 14, lineHeight = 22) {
  const parts = String(text || '').split(/(\*\*.*?\*\*|`.*?`)/);
  return (
    <Text style={{ color, fontSize, lineHeight }}>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <Text key={index} style={styles.bold}>{part.slice(2, -2)}</Text>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <Text key={index} style={styles.inlineCode}>{part.slice(1, -1)}</Text>;
        }
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}

function parseTableCells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function MarkdownTable({ headers, rows, color, colors }) {
  const columns = Math.max(headers.length, 1);
  const tableWidth = Math.max(300, columns * 112);
  const cellStyle = { width: tableWidth / columns };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroller} contentContainerStyle={{ minWidth: tableWidth }}>
      <View style={[styles.table, { width: tableWidth, borderColor: colors.border }]}> 
        <View style={[styles.tableRow, styles.tableHeader, { backgroundColor: colors.cardAlt }]}> 
          {headers.map((header, index) => (
            <View key={`${header}-${index}`} style={[styles.tableCell, cellStyle]}>
              <Text style={[styles.tableHeaderText, { color }]}>{header.replace(/\*\*/g, '')}</Text>
            </View>
          ))}
        </View>
        {rows.map((row, rowIndex) => (
          <View key={`${row.join('-')}-${rowIndex}`} style={[styles.tableRow, { borderTopColor: colors.border }]}> 
            {headers.map((_, columnIndex) => (
              <View key={columnIndex} style={[styles.tableCell, cellStyle]}>
                {renderInline(row[columnIndex] || '—', color, 12, 18)}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export default function MarkdownText({ text, color, colors, compact = false }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const nodes = [];
  const bodySize = compact ? 13 : 14;
  const bodyLineHeight = compact ? 20 : 22;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const divider = lines[index + 1];
    const isTableHeader = line.includes('|') && divider && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider);

    if (isTableHeader) {
      const headers = parseTableCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|')) {
        rows.push(parseTableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      nodes.push(<MarkdownTable key={`table-${index}`} headers={headers} rows={rows} color={color} colors={colors} />);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      nodes.push(<Text key={index} style={[styles.heading, level === 1 ? styles.heading1 : level === 2 ? styles.heading2 : styles.heading3, { color }]}>{heading[2].replace(/\*\*/g, '')}</Text>);
      continue;
    }

    const bullet = line.match(/^\s*(?:[-*]|▸)\s+(.+)/);
    if (bullet) {
      nodes.push(<View key={index} style={styles.listRow}><Text style={[styles.bullet, { color: colors.accent }]}>•</Text><View style={styles.listContent}>{renderInline(bullet[1], color, bodySize, bodyLineHeight)}</View></View>);
      continue;
    }

    const numbered = line.match(/^\s*(\d+[.、]|[①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)/);
    if (numbered) {
      nodes.push(<View key={index} style={styles.listRow}><Text style={[styles.number, { color: colors.accent }]}>{numbered[1]}</Text><View style={styles.listContent}>{renderInline(numbered[2], color, bodySize, bodyLineHeight)}</View></View>);
      continue;
    }

    const quote = line.match(/^>\s*(.+)/);
    if (quote) {
      nodes.push(<View key={index} style={[styles.quote, { borderLeftColor: colors.accent, backgroundColor: colors.cardAlt }]}>{renderInline(quote[1], color, bodySize, bodyLineHeight)}</View>);
      continue;
    }

    if (/^\s*(?:---|___)\s*$/.test(line)) {
      nodes.push(<View key={index} style={[styles.divider, { backgroundColor: colors.border }]} />);
      continue;
    }

    if (!line.trim()) {
      nodes.push(<View key={index} style={styles.spacer} />);
      continue;
    }

    nodes.push(<View key={index} style={styles.paragraph}>{renderInline(line, color, bodySize, bodyLineHeight)}</View>);
  }

  return <View style={styles.container}>{nodes}</View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', minWidth: 0 },
  bold: { fontWeight: '800' },
  inlineCode: { fontFamily: 'Courier', fontSize: 12 },
  heading: { fontWeight: '800' },
  heading1: { fontSize: 20, lineHeight: 27, marginTop: 10, marginBottom: 5 },
  heading2: { fontSize: 17, lineHeight: 24, marginTop: 9, marginBottom: 4 },
  heading3: { fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 3 },
  paragraph: { marginVertical: 1 },
  spacer: { height: 7 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 3, paddingRight: 2 },
  bullet: { width: 18, fontSize: 17, lineHeight: 21, fontWeight: '900' },
  number: { minWidth: 24, marginRight: 4, fontSize: 13, lineHeight: 21, fontWeight: '800' },
  listContent: { flex: 1, minWidth: 0 },
  quote: { borderLeftWidth: 3, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, marginVertical: 5 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 9 },
  tableScroller: { width: '100%', marginVertical: 7 },
  table: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tableHeader: { borderTopWidth: 0 },
  tableCell: { paddingHorizontal: 8, paddingVertical: 8 },
  tableHeaderText: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
});
