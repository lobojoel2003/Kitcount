/**
 * Reporting periods in the device's local time zone. A period is half-open:
 * start <= t < end.
 */
export type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';

export interface Period {
  kind: PeriodKind;
  start: Date;
  end: Date;
  label: string;
  /** Stable key for filenames, e.g. 2026-10, 2026-Q3, 2026. */
  key: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');

export function monthPeriod(year: number, month0: number): Period {
  const start = new Date(year, month0, 1);
  const end = new Date(year, month0 + 1, 1);
  return { kind: 'month', start, end, label: `${MONTHS[start.getMonth()]} ${start.getFullYear()}`, key: `${start.getFullYear()}-${pad(start.getMonth() + 1)}` };
}

export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4): Period {
  const start = new Date(year, (quarter - 1) * 3, 1);
  const end = new Date(year, quarter * 3, 1);
  return { kind: 'quarter', start, end, label: `Q${quarter} ${year}`, key: `${year}-Q${quarter}` };
}

export function yearPeriod(year: number): Period {
  return { kind: 'year', start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1), label: String(year), key: String(year) };
}

export function customPeriod(start: Date, endInclusive: Date): Period {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(endInclusive.getFullYear(), endInclusive.getMonth(), endInclusive.getDate() + 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const last = new Date(e.getTime() - 1);
  return { kind: 'custom', start: s, end: e, label: `${fmt(s)} – ${fmt(last)}`, key: `${fmt(s)}_${fmt(last)}` };
}

/** The most recent complete period of a kind, relative to `now`. */
export function previousPeriod(kind: Exclude<PeriodKind, 'custom'>, now: Date = new Date()): Period {
  // Date normalises month -1 to December of the previous year.
  if (kind === 'month') return monthPeriod(now.getFullYear(), now.getMonth() - 1);
  if (kind === 'quarter') {
    const q = Math.floor(now.getMonth() / 3); // current quarter, 0-based
    return q === 0 ? quarterPeriod(now.getFullYear() - 1, 4) : quarterPeriod(now.getFullYear(), q as 1 | 2 | 3);
  }
  return yearPeriod(now.getFullYear() - 1);
}

/** The period containing `now` (to date). */
export function currentPeriod(kind: Exclude<PeriodKind, 'custom'>, now: Date = new Date()): Period {
  if (kind === 'month') return monthPeriod(now.getFullYear(), now.getMonth());
  if (kind === 'quarter') return quarterPeriod(now.getFullYear(), (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4);
  return yearPeriod(now.getFullYear());
}

/** Moves a period backwards/forwards by whole periods. */
export function shiftPeriod(p: Period, by: number): Period {
  if (p.kind === 'month') return monthPeriod(p.start.getFullYear(), p.start.getMonth() + by);
  if (p.kind === 'quarter') {
    const index = p.start.getFullYear() * 4 + Math.floor(p.start.getMonth() / 3) + by;
    return quarterPeriod(Math.floor(index / 4), ((index % 4) + 1) as 1 | 2 | 3 | 4);
  }
  if (p.kind === 'year') return yearPeriod(p.start.getFullYear() + by);
  const len = p.end.getTime() - p.start.getTime();
  return customPeriod(new Date(p.start.getTime() + by * len), new Date(p.end.getTime() + by * len - 1));
}
