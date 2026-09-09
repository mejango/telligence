export type PriceSeriesPoint = {
  timestamp: number;
  value: number;
};

/**
 * A time-weighted display of exact post-trade pool spots. Short-lived prices
 * contribute only for the time they were actually in force, while the exact
 * opening and latest values remain pinned to the line's endpoints.
 */
export function smoothPriceSeries(points: PriceSeriesPoint[], maxBuckets = 96): PriceSeriesPoint[] {
  const sorted = points
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) && Number.isFinite(point.value) && point.value > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .reduce<PriceSeriesPoint[]>((deduped, point) => {
      if (deduped.at(-1)?.timestamp === point.timestamp) {
        deduped[deduped.length - 1] = point;
      } else {
        deduped.push(point);
      }
      return deduped;
    }, []);

  if (sorted.length < 4 || maxBuckets < 1) return sorted;

  const start = sorted[0].timestamp;
  const end = sorted.at(-1)!.timestamp;
  const duration = end - start;
  if (!(duration > 0)) return sorted;

  const bucketCount = Math.min(maxBuckets, Math.max(2, (sorted.length - 1) * 2));
  const bucketWidth = duration / bucketCount;
  const smoothed: PriceSeriesPoint[] = [{ timestamp: start, value: sorted[0].value }];
  let eventIndex = 1;
  let currentValue = sorted[0].value;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const bucketStart = start + bucket * bucketWidth;
    const bucketEnd = bucket === bucketCount - 1 ? end : start + (bucket + 1) * bucketWidth;

    while (eventIndex < sorted.length && sorted[eventIndex].timestamp <= bucketStart) {
      currentValue = sorted[eventIndex].value;
      eventIndex += 1;
    }

    let cursor = bucketStart;
    let weightedTotal = 0;
    let nextIndex = eventIndex;
    let bucketValue = currentValue;
    while (nextIndex < sorted.length && sorted[nextIndex].timestamp < bucketEnd) {
      const event = sorted[nextIndex];
      weightedTotal += bucketValue * (event.timestamp - cursor);
      cursor = event.timestamp;
      bucketValue = event.value;
      nextIndex += 1;
    }
    weightedTotal += bucketValue * (bucketEnd - cursor);
    currentValue = bucketValue;
    eventIndex = nextIndex;

    smoothed.push({
      timestamp: bucketStart + (bucketEnd - bucketStart) / 2,
      value: weightedTotal / (bucketEnd - bucketStart),
    });
  }

  const latest = sorted.at(-1)!;
  smoothed.push({ timestamp: end, value: latest.value });
  return smoothed;
}

/**
 * Both sides of the pool at one moment: the raw holdings in whole tokens, and each side valued in
 * pair tokens at that moment's pool price (the token side converted) for the bars.
 */
export type PoolReservePoint = {
  timestamp: number;
  pairAmount: number;
  tokenAmount: number;
  pairValue: number;
  tokenValue: number;
};

/** The last reserves observed at or before `timestamp`; undefined before the pool first held anything. */
export function poolReservesAt(
  points: readonly PoolReservePoint[],
  timestamp: number,
): PoolReservePoint | undefined {
  let found: PoolReservePoint | undefined;
  for (const point of points) {
    if (point.timestamp > timestamp) break;
    found = point;
  }
  return found;
}

/**
 * The pool's reserves resampled onto `count` even buckets across [start, end], each taking the
 * last observation at or before its close — so the bars sit on a regular grid whatever the
 * trade cadence and the final bar reflects everything up to `end`. Buckets before the first
 * observation are omitted rather than drawn empty.
 */
export function bucketPoolReserves(
  points: readonly PoolReservePoint[],
  start: number,
  end: number,
  count: number,
): PoolReservePoint[] {
  const observed = [...points].sort((a, b) => a.timestamp - b.timestamp);
  if (!observed.length || !(end > start) || count < 1) return [];
  const width = (end - start) / count;
  const buckets: PoolReservePoint[] = [];
  let index = 0;
  let current: PoolReservePoint | undefined;
  for (let bucket = 0; bucket < count; bucket += 1) {
    const timestamp = start + (bucket + 0.5) * width;
    const close = start + (bucket + 1) * width;
    while (index < observed.length && observed[index].timestamp <= close) {
      current = observed[index++];
    }
    if (!current) continue;
    buckets.push({ ...current, timestamp });
  }
  return buckets;
}
