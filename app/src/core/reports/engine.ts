import type { VisitLogged } from '../domain/events';
import type { Ledger } from '../domain/ledger';
import { evaluateFormula } from './formula';
import type { Period } from './period';
import type { ReportTemplate, RowFormat, TemplateRow } from './template';

export interface ReportRow {
  id: string;
  code?: string;
  label: string;
  help?: string;
  value: number | null;
  display: string;
  manual: boolean;
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
}

export interface Report {
  templateId: string;
  templateName: string;
  jurisdiction: string;
  templateVersion?: string;
  disclaimer?: string;
  programName: string;
  period: Period;
  generatedAt: Date;
  sections: ReportSection[];
  /** Problems worth showing staff before they submit (unknown ids, missing manual values). */
  warnings: string[];
  /** Number of visits that fed into the report. */
  visitCount: number;
}

export function formatValue(value: number | null, format: RowFormat): string {
  if (value === null || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'integer':
      return Math.round(value).toLocaleString('en-US');
    case 'decimal':
      return (Math.round(value * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
    case 'percent':
      return `${(Math.round(value * 1000) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  }
}

interface Ctx {
  ledger: Ledger;
  period: Period;
  visits: VisitLogged[];
  priorParticipants: Set<string>;
}

function anyOf(list: string[] | undefined, pred: (id: string) => boolean): boolean {
  return list ? list.some(pred) : false;
}

function hasSupply(v: VisitLogged, supply?: string[]): boolean {
  if (!supply) return Object.values(v.out).some((q) => q > 0);
  return anyOf(supply, (s) => (v.out[s] ?? 0) > 0);
}

function hasReferral(v: VisitLogged, referral?: string[]): boolean {
  if (!referral) return v.referrals.length > 0;
  return v.referrals.some((r) => referral.includes(r));
}

function unique(visits: VisitLogged[]): number {
  const s = new Set<string>();
  for (const v of visits) if (v.participant) s.add(v.participant);
  return s.size;
}

function computeMetric(row: TemplateRow, ctx: Ctx): number {
  const { visits } = ctx;
  switch (row.metric!) {
    case 'visits':
      if (row.anonymous === undefined) return visits.length;
      return visits.filter((v) => (v.participant === null) === row.anonymous).length;
    case 'participants':
      return unique(visits);
    case 'new_participants': {
      const seen = new Set<string>();
      for (const v of visits) if (v.participant && !ctx.priorParticipants.has(v.participant)) seen.add(v.participant);
      return seen.size;
    }
    case 'returning_participants': {
      const seen = new Set<string>();
      for (const v of visits) if (v.participant && ctx.priorParticipants.has(v.participant)) seen.add(v.participant);
      return seen.size;
    }
    case 'supplies_out': {
      let n = 0;
      for (const v of visits) {
        if (row.supply) for (const s of row.supply) n += v.out[s] ?? 0;
        else for (const q of Object.values(v.out)) n += q;
      }
      return n;
    }
    case 'visits_with_supply':
      return visits.filter((v) => hasSupply(v, row.supply)).length;
    case 'participants_with_supply':
      return unique(visits.filter((v) => hasSupply(v, row.supply)));
    case 'syringes_in':
      return visits.reduce((n, v) => n + v.syringesIn, 0);
    case 'reversals':
      return visits.reduce((n, v) => n + v.reversals, 0);
    case 'visits_with_reversal':
      return visits.filter((v) => v.reversals > 0).length;
    case 'referrals':
      return visits.reduce((n, v) => n + (row.referral ? v.referrals.filter((r) => row.referral!.includes(r)).length : v.referrals.length), 0);
    case 'participants_referred':
      return unique(visits.filter((v) => hasReferral(v, row.referral)));
    case 'visits_with_referral':
      return visits.filter((v) => hasReferral(v, row.referral)).length;
    case 'secondary':
      return visits.reduce((n, v) => n + v.secondary, 0);
    case 'stock_received': {
      const s = ctx.period.start.toISOString();
      const e = ctx.period.end.toISOString();
      let n = 0;
      for (const ev of ctx.ledger.stockEvents()) {
        if (ev.type !== 'stock.received' || ev.at < s || ev.at >= e) continue;
        if (!row.supply || row.supply.includes(ev.supply)) n += ev.qty;
      }
      return n;
    }
    case 'stock_on_hand': {
      const onHand = ctx.ledger.onHandAt(ctx.period.end);
      if (row.supply) return row.supply.reduce((n, s) => n + (onHand[s] ?? 0), 0);
      return Object.values(onHand).reduce((n, q) => n + q, 0);
    }
    case 'manual':
      return 0; // handled by caller
  }
}

export interface ComputeOptions {
  manualValues?: Record<string, number | null | undefined>;
  programName?: string;
  now?: Date;
}

export function computeReport(template: ReportTemplate, ledger: Ledger, period: Period, opts: ComputeOptions = {}): Report {
  const visits = ledger.visitsBetween(period.start, period.end);
  const priorParticipants = new Set<string>();
  const startIso = period.start.toISOString();
  for (const [hash, p] of ledger.participants()) if (p.firstAt < startIso) priorParticipants.add(hash);
  const ctx: Ctx = { ledger, period, visits, priorParticipants };

  const catalog = ledger.catalog();
  const supplyIds = new Set(catalog.supplies.map((s) => s.id));
  const referralIds = new Set(catalog.referrals.map((r) => r.id));
  const warnings: string[] = [];
  const raw = new Map<string, number | null>();
  const rows = new Map<string, TemplateRow>();

  for (const section of template.sections) {
    for (const row of section.rows) {
      rows.set(row.id, row);
      for (const s of row.supply ?? []) {
        if (!supplyIds.has(s)) warnings.push(`"${row.label}" refers to supply "${s}", which this program does not track.`);
      }
      for (const r of row.referral ?? []) {
        if (!referralIds.has(r)) warnings.push(`"${row.label}" refers to referral "${r}", which this program does not track.`);
      }
      if (row.metric === 'manual') {
        const v = opts.manualValues?.[row.id];
        raw.set(row.id, typeof v === 'number' && Number.isFinite(v) ? v : null);
        if (raw.get(row.id) === null) warnings.push(`"${row.label}" needs a value typed in.`);
      } else if (row.metric) {
        raw.set(row.id, computeMetric(row, ctx));
      }
    }
  }

  // Formula rows, resolved recursively (cycles were rejected at validation).
  const resolve = (id: string): number | null => {
    if (raw.has(id)) return raw.get(id)!;
    const row = rows.get(id);
    if (!row?.expr) return null;
    const v = evaluateFormula(row.expr, resolve);
    raw.set(id, v);
    return v;
  };

  const sections: ReportSection[] = template.sections.map((section) => ({
    title: section.title,
    rows: section.rows.map((row) => {
      const value = resolve(row.id);
      return {
        id: row.id,
        code: row.code,
        label: row.label,
        help: row.help,
        value,
        display: formatValue(value, row.format),
        manual: row.metric === 'manual',
      };
    }),
  }));

  return {
    templateId: template.id,
    templateName: template.name,
    jurisdiction: template.jurisdiction,
    templateVersion: template.version,
    disclaimer: template.disclaimer,
    programName: opts.programName ?? ledger.config().programName,
    period,
    generatedAt: opts.now ?? new Date(),
    sections,
    warnings: Array.from(new Set(warnings)),
    visitCount: visits.length,
  };
}
