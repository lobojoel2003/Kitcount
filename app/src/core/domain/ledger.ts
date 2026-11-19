import { defaultCatalog, type Catalog, type Supply } from './catalog';
import type { ConfigKey, ConfigSet, KitEvent, ProgramConfig, StockAdjusted, StockReceived, VisitLogged } from './events';

/**
 * An in-memory projection of the event log. Events can arrive in any order
 * (offline devices sync days later), so every derived value is computed in an
 * order-independent way: sums for stock, min/max for participant history,
 * last-writer-wins (timestamp, then id) for configuration.
 */

export interface ParticipantSummary {
  visits: number;
  firstAt: string;
  lastAt: string;
}

export interface StockLevel {
  supply: Supply;
  onHand: number;
  low: boolean;
  /** Estimated visits left at the recent per-visit pace, if known. */
  visitsLeft: number | null;
}

export const DEFAULT_CONFIG: ProgramConfig = {
  programName: 'My program',
  templateId: 'generic-monthly',
  codeHint: 'First + last initial, then birth month (e.g. JD03)',
  codePattern: '',
  catalog: defaultCatalog(),
};

function newer(a: KitEvent, b: KitEvent): boolean {
  return a.at > b.at || (a.at === b.at && a.id > b.id);
}

export class Ledger {
  private readonly ids = new Set<string>();
  private readonly visitsById = new Map<string, VisitLogged>();
  private readonly voided = new Set<string>();
  private readonly configEvents = new Map<ConfigKey, ConfigSet>();
  /** device -> supply -> net received/adjusted units (excluding visits). */
  private readonly stockByDevice = new Map<string, Map<string, number>>();
  private readonly stockLog: (StockReceived | StockAdjusted)[] = [];
  private sortedCache: VisitLogged[] | null = null;
  private participantCache: Map<string, ParticipantSummary> | null = null;
  private version = 0;

  constructor(events: Iterable<KitEvent> = []) {
    this.apply(events);
  }

  /** Monotonic counter that changes whenever new events are applied. */
  get revision(): number {
    return this.version;
  }

  get size(): number {
    return this.ids.size;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** Applies events, ignoring duplicates. Returns the number of new events. */
  apply(events: Iterable<KitEvent>): number {
    let added = 0;
    for (const e of events) {
      if (this.ids.has(e.id)) continue;
      this.ids.add(e.id);
      added++;
      switch (e.type) {
        case 'visit.logged':
          this.visitsById.set(e.id, e);
          break;
        case 'visit.voided':
          this.voided.add(e.visit);
          break;
        case 'stock.received':
          this.addStock(e.device, e.supply, e.qty);
          this.stockLog.push(e);
          break;
        case 'stock.adjusted':
          this.addStock(e.device, e.supply, e.delta);
          this.stockLog.push(e);
          break;
        case 'config.set': {
          const current = this.configEvents.get(e.key);
          if (!current || newer(e, current)) this.configEvents.set(e.key, e);
          break;
        }
      }
    }
    if (added > 0) {
      this.sortedCache = null;
      this.participantCache = null;
      this.version++;
    }
    return added;
  }

  private addStock(device: string, supply: string, delta: number) {
    let m = this.stockByDevice.get(device);
    if (!m) {
      m = new Map();
      this.stockByDevice.set(device, m);
    }
    m.set(supply, (m.get(supply) ?? 0) + delta);
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  config(): ProgramConfig {
    const cfg: ProgramConfig = { ...DEFAULT_CONFIG, catalog: DEFAULT_CONFIG.catalog };
    for (const [key, e] of this.configEvents) {
      (cfg as unknown as Record<string, unknown>)[key] = e.value;
    }
    return cfg;
  }

  catalog(): Catalog {
    return this.config().catalog;
  }

  /** Whether any device has explicitly set this configuration key. */
  hasConfig(key: ConfigKey): boolean {
    return this.configEvents.has(key);
  }

  // -------------------------------------------------------------------------
  // Visits and participants
  // -------------------------------------------------------------------------

  isVoided(visitId: string): boolean {
    return this.voided.has(visitId);
  }

  /** Non-voided visits in chronological order. */
  visits(): readonly VisitLogged[] {
    if (!this.sortedCache) {
      this.sortedCache = Array.from(this.visitsById.values())
        .filter((v) => !this.voided.has(v.id))
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
    }
    return this.sortedCache;
  }

  /** Non-voided visits with start <= at < end. */
  visitsBetween(start: Date, end: Date): VisitLogged[] {
    const s = start.toISOString();
    const e = end.toISOString();
    const all = this.visits();
    // Binary search for the first visit at or after start.
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid].at < s) lo = mid + 1;
      else hi = mid;
    }
    const out: VisitLogged[] = [];
    for (let i = lo; i < all.length && all[i].at < e; i++) out.push(all[i]);
    return out;
  }

  /** Most recent visits first, including voided ones (flagged) for the history screen. */
  recentVisits(limit: number, device?: string): { visit: VisitLogged; voided: boolean }[] {
    const all = Array.from(this.visitsById.values())
      .filter((v) => !device || v.device === device)
      .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));
    return all.slice(0, limit).map((visit) => ({ visit, voided: this.voided.has(visit.id) }));
  }

  participants(): ReadonlyMap<string, ParticipantSummary> {
    if (!this.participantCache) {
      const m = new Map<string, ParticipantSummary>();
      for (const v of this.visits()) {
        if (!v.participant) continue;
        const p = m.get(v.participant);
        if (!p) m.set(v.participant, { visits: 1, firstAt: v.at, lastAt: v.at });
        else {
          p.visits++;
          if (v.at < p.firstAt) p.firstAt = v.at;
          if (v.at > p.lastAt) p.lastAt = v.at;
        }
      }
      this.participantCache = m;
    }
    return this.participantCache;
  }

  participant(hash: string): ParticipantSummary | null {
    return this.participants().get(hash) ?? null;
  }

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------

  /**
   * On-hand stock per supply. With a device id: that device's own kit (van,
   * backpack). Without: the whole program.
   */
  onHand(device?: string): Record<string, number> {
    const out: Record<string, number> = {};
    const devices = device ? [device] : Array.from(this.stockByDevice.keys());
    for (const d of devices) {
      const m = this.stockByDevice.get(d);
      if (!m) continue;
      for (const [s, q] of m) out[s] = (out[s] ?? 0) + q;
    }
    for (const v of this.visits()) {
      if (device && v.device !== device) continue;
      for (const [s, q] of Object.entries(v.out)) out[s] = (out[s] ?? 0) - q;
    }
    return out;
  }

  /** Stock receipts and adjustments (unordered). */
  stockEvents(): readonly (StockReceived | StockAdjusted)[] {
    return this.stockLog;
  }

  /** Program-wide on-hand stock as of a moment (events strictly before `at`). */
  onHandAt(at: Date): Record<string, number> {
    const cutoff = at.toISOString();
    const out: Record<string, number> = {};
    for (const e of this.stockLog) {
      if (e.at >= cutoff) continue;
      out[e.supply] = (out[e.supply] ?? 0) + (e.type === 'stock.received' ? e.qty : e.delta);
    }
    for (const v of this.visits()) {
      if (v.at >= cutoff) break;
      for (const [s, q] of Object.entries(v.out)) out[s] = (out[s] ?? 0) - q;
    }
    return out;
  }

  /** Units of a supply handed out per visit over the trailing window. */
  perVisitRate(supply: string, device: string | undefined, now: Date, days = 14): number | null {
    const start = new Date(now.getTime() - days * 86_400_000);
    const recent = this.visitsBetween(start, new Date(now.getTime() + 1)).filter((v) => !device || v.device === device);
    if (recent.length < 5) return null;
    let units = 0;
    for (const v of recent) units += v.out[supply] ?? 0;
    return units / recent.length;
  }

  stockLevels(device: string | undefined, now: Date = new Date()): StockLevel[] {
    const onHand = this.onHand(device);
    return this.catalog()
      .supplies.filter((s) => s.enabled)
      .map((supply) => {
        const qty = onHand[supply.id] ?? 0;
        const rate = this.perVisitRate(supply.id, device, now);
        return {
          supply,
          onHand: qty,
          low: qty <= supply.lowAt,
          // Forecasts beyond a few hundred visits are noise, not information.
          visitsLeft: rate && rate > 0 && qty / rate < 1000 ? Math.max(0, Math.floor(qty / rate)) : null,
        };
      });
  }

  /** Supplies at or below their warning level, critical ones first. */
  lowStock(device: string | undefined, now: Date = new Date()): StockLevel[] {
    return this.stockLevels(device, now)
      .filter((l) => l.low)
      .sort((a, b) => Number(!!b.supply.critical) - Number(!!a.supply.critical) || a.onHand - b.onHand);
  }
}
