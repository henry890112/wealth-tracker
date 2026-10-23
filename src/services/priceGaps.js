const isFinitePrice = value => Number.isFinite(Number(value)) && Number(value) > 0;

/**
 * A price gap exists only when two adjacent candles' complete high/low ranges
 * do not overlap. Keep its fill index so a historical viewport can show the
 * gaps that were still open at that point without looking ahead.
 */
export function detectPriceGapEvents(rows = [], { minGapPercent = 0.35 } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const events = [];
  const threshold = Math.max(0, Number(minGapPercent) || 0);
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const previousHigh = Number(previous?.high);
    const previousLow = Number(previous?.low);
    const currentHigh = Number(current?.high);
    const currentLow = Number(current?.low);
    if (!current?.time || !isFinitePrice(previousHigh) || !isFinitePrice(previousLow)
      || !isFinitePrice(currentHigh) || !isFinitePrice(currentLow)
      || previousLow > previousHigh || currentLow > currentHigh) continue;

    let gap;
    if (currentLow > previousHigh) {
      gap = { lower: previousHigh, upper: currentLow, direction: 'up' };
    } else if (currentHigh < previousLow) {
      gap = { lower: currentHigh, upper: previousLow, direction: 'down' };
    } else continue;

    const reference = isFinitePrice(previous.close)
      ? Number(previous.close) : (previousHigh + previousLow) / 2;
    if (((gap.upper - gap.lower) / reference) * 100 < threshold) continue;

    let filledIndex = null;
    for (let laterIndex = index + 1; laterIndex < rows.length; laterIndex += 1) {
      const later = rows[laterIndex];
      if (gap.direction === 'up' && isFinitePrice(later?.low) && Number(later.low) <= gap.lower
        || gap.direction === 'down' && isFinitePrice(later?.high) && Number(later.high) >= gap.upper) {
        filledIndex = laterIndex;
        break;
      }
    }
    events.push({ startTime: current.time, startIndex: index, ...gap, filledIndex });
  }
  return events;
}
