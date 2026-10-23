const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;

function decodeCell(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<\/(?:div|p|span|td|th|li)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;|&ensp;|&emsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&mdash;|&ndash;/gi, '—')
    .replace(/&minus;/gi, '−')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cellNumber(value) {
  const normalized = decodeCell(value).replace(/[$,\s]/g, '').replace(/−/g, '-');
  if (!normalized || /^(?:—|–|-)$/.test(normalized)) return null;
  const parenthesized = /^\((.+)\)$/.exec(normalized);
  const parsed = Number(parenthesized ? `-${parenthesized[1]}` : normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function periodLabel(periodEnd) {
  const [year, month] = String(periodEnd || '').split('-').map(Number);
  if (!year || !month) return null;
  return `${year} Q${Math.ceil(month / 3)}`;
}

function statementPeriodEnd(rows) {
  const headerIndex = rows.findIndex(row => /three months ended/i.test(row.join(' ')));
  if (headerIndex < 0) return null;
  const header = rows[headerIndex].join(' ').split(/nine months ended/i)[0];
  const dateMatch = /three months ended\s+([a-z]+\s+\d{1,2})(?:,?\s+(\d{4}))?/i.exec(header);
  if (!dateMatch) return null;
  const year = Number(dateMatch[2] || (rows[headerIndex + 1] || []).map(cell => /\b(20\d{2})\b/.exec(cell)?.[1]).find(Boolean));
  const month = new Date(`${dateMatch[1]} ${year} 00:00:00 UTC`).getUTCMonth() + 1;
  const day = Number(/\b(\d{1,2})\s*$/.exec(dateMatch[1])?.[1]);
  if (!Number.isInteger(year) || year < 1900 || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}

function growthPercent(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
    ? (current - previous) / Math.abs(previous) * 100
    : null;
}

// Parse only a clearly identified consolidated quarterly income statement.
// Press-release values are kept separate from Company Facts and are labelled
// as 8-K速報 by the UI until a structured 10-Q/10-K supersedes them.
export function parseSecEarningsReleaseHtml(html, release) {
  const filedAt = dateOnly(release?.date);
  if (!filedAt) return null;

  const tableMatches = [...String(html || '').matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  for (const tableMatch of tableMatches) {
    const table = tableMatch[0];
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => decodeCell(cell[1])))
      .filter(row => row.length);
    const allText = rows.flat().join(' ');
    const contextText = decodeCell(String(html || '').slice(Math.max(0, tableMatch.index - 1200), tableMatch.index));
    const statementText = `${contextText} ${allText}`;
    if (!/consolidated statements? of operations/i.test(statementText) || !/three months ended/i.test(allText) || !/\$/i.test(allText)) continue;
    const periodEnd = statementPeriodEnd(rows);
    if (!periodEnd) continue;
    const unit = /in\s+billions\b/i.test(statementText) ? 1e9
      : /in\s+millions\b/i.test(statementText) ? 1e6
        : /in\s+thousands\b/i.test(statementText) ? 1e3
          : null;
    if (!unit) continue;

    const valuesFor = (pattern, startIndex = 0) => {
      const row = rows.slice(startIndex).find(candidate => pattern.test(candidate[0] || ''));
      if (!row) return [];
      return row.slice(1).map(cellNumber).filter(value => value !== null);
    };
    const revenueValues = valuesFor(/^revenue\b|^total revenues?\b/i);
    const operatingValues = valuesFor(/^(?:income|loss)\s*\(?(?:loss|income)\)?\s+from operations\b|^operating income\b/i);
    const netIncomeValues = valuesFor(/^net income\b|^net loss\b/i);
    const epsHeaderIndex = rows.findIndex(row => /net income\s*\(loss\)\s*per share|earnings per share/i.test(row[0] || ''));
    const dilutedEpsValues = epsHeaderIndex < 0 ? [] : valuesFor(/^diluted\b/i, epsHeaderIndex + 1);
    const revenue = revenueValues[0];
    const operatingIncome = operatingValues[0];
    const netIncome = netIncomeValues[0];
    if (revenue === undefined || netIncome === undefined) continue;

    return {
      periodEnd,
      label: periodLabel(periodEnd),
      filedAt,
      announcementDate: filedAt,
      source: 'SEC 8-K EX-99.1',
      sourceLabel: 'SEC 8-K 公告速報',
      revenue: revenue * unit,
      revenueYoY: growthPercent(revenue, revenueValues[1]),
      grossProfit: null,
      grossMargin: null,
      operatingIncome: operatingIncome === undefined ? null : operatingIncome * unit,
      operatingMargin: operatingIncome === undefined || revenue === 0 ? null : operatingIncome / revenue * 100,
      netIncome: netIncome * unit,
      netIncomeYoY: growthPercent(netIncome, netIncomeValues[1]),
      netMargin: revenue === 0 ? null : netIncome / revenue * 100,
      eps: dilutedEpsValues[0] ?? null,
      epsYoY: growthPercent(dilutedEpsValues[0], dilutedEpsValues[1]),
      operatingCashFlow: null,
      capex: null,
      freeCashFlow: null,
    };
  }
  return null;
}

// Nokia is a foreign private issuer: its quarterly release is attached to a
// Form 6-K and reports in EUR, so it is not represented by SEC's us-gaap
// Company Facts or the domestic 8-K release table above.
export function parseNokia6KEarningsReleaseHtml(html, release) {
  const filedAt = dateOnly(release?.date);
  const sourceHtml = String(html || '');
  if (!filedAt || !/Nokia Corporation/i.test(sourceHtml) || !/FINANCIAL RESULTS/i.test(sourceHtml)) return null;

  const tableMatches = [...sourceHtml.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  for (const tableMatch of tableMatches) {
    const rows = [...tableMatch[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => decodeCell(cell[1])))
      .filter(row => row.length);
    const header = rows.flat().join(' ');
    if (!/EUR million\s*\(except for EPS in EUR\)/i.test(header)) continue;
    const quarterMatch = /\bQ([1-4])\s*['’]\s*(\d{2,4})\b/i.exec(header);
    if (!quarterMatch) continue;
    const reportedIndex = rows.findIndex(row => /^reported results$/i.test(row[0] || ''));
    if (reportedIndex < 0) continue;
    const comparableIndex = rows.findIndex((row, index) => index > reportedIndex && /^comparable results$/i.test(row[0] || ''));
    const reportedRows = rows.slice(reportedIndex + 1, comparableIndex < 0 ? rows.length : comparableIndex);
    const valuesFor = pattern => {
      const row = reportedRows.find(candidate => pattern.test(candidate[0] || ''));
      return row ? row.slice(1).map(cellNumber).filter(value => value !== null) : [];
    };
    const revenueValues = valuesFor(/^net sales$/i);
    const grossMarginValues = valuesFor(/^gross margin\s*%$/i);
    const operatingValues = valuesFor(/^operating profit$/i);
    const operatingMarginValues = valuesFor(/^operating margin\s*%$/i);
    const netIncomeValues = valuesFor(/^profit for the period$/i);
    const epsValues = valuesFor(/^EPS from continuing operations, diluted$/i);
    const revenue = revenueValues[0];
    const grossMargin = grossMarginValues[0];
    const operatingIncome = operatingValues[0];
    const operatingMargin = operatingMarginValues[0];
    const netIncome = netIncomeValues[0];
    const eps = epsValues[0];
    if ([revenue, grossMargin, operatingIncome, netIncome, eps].some(value => value === undefined)) continue;

    const quarter = Number(quarterMatch[1]);
    const yearDigits = Number(quarterMatch[2]);
    const year = yearDigits < 100 ? 2000 + yearDigits : yearDigits;
    const month = quarter * 3;
    const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const netMargin = revenue ? netIncome / revenue * 100 : null;
    return {
      periodEnd,
      label: `${year} Q${quarter}`,
      filedAt,
      announcementDate: filedAt,
      source: 'SEC 6-K',
      sourceLabel: 'SEC 6-K 公司財報公告',
      currency: 'EUR',
      revenue: revenue * 1e6,
      revenueYoY: growthPercent(revenue, revenueValues[1]),
      grossProfit: revenue * grossMargin / 100 * 1e6,
      grossMargin,
      operatingIncome: operatingIncome * 1e6,
      operatingMargin: operatingMargin ?? (revenue ? operatingIncome / revenue * 100 : null),
      netIncome: netIncome * 1e6,
      netIncomeYoY: growthPercent(netIncome, netIncomeValues[1]),
      netMargin,
      eps,
      epsYoY: growthPercent(eps, epsValues[1]),
      operatingCashFlow: null,
      capex: null,
      freeCashFlow: null,
    };
  }
  return null;
}

// SEC submissions is an array-of-columns feed. Item 2.02 identifies earnings
// announcements; other 8-Ks must not advance the "recent release" date.
export function latestSecEarningsRelease(submissions, cik, include6K = false, beforeDate = null) {
  const recent = submissions?.filings?.recent || {};
  const normalizedCik = String(cik || '').replace(/^0+/, '');
  if (!/^\d+$/.test(normalizedCik)) return null;
  const releases = (recent.form || []).flatMap((form, index) => {
    const date = dateOnly(recent.filingDate?.[index]);
    const items = String(recent.items?.[index] || '');
    const accession = String(recent.accessionNumber?.[index] || '');
    const document = String(recent.primaryDocument?.[index] || '');
    const isEightKRelease = /^8-K(?:\/A)?$/.test(String(form)) && /(?:^|,)2\.02(?:,|$)/.test(items.replace(/\s/g, ''));
    const isIncludedSixKRelease = include6K && /^6-K$/.test(String(form));
    if (!date || (beforeDate && date >= beforeDate) || (!isEightKRelease && !isIncludedSixKRelease)
      || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^[a-zA-Z0-9._-]+\.html?$/.test(document)) return [];
    return [{
      date,
      accession,
      primaryDocument: document,
      form: String(form),
      source: isIncludedSixKRelease ? 'SEC 6-K・Nokia 公司財報公告' : 'SEC 8-K・業績新聞稿',
      url: `https://www.sec.gov/Archives/edgar/data/${normalizedCik}/${accession.replace(/-/g, '')}/${document}`,
    }];
  });
  return releases.sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}
