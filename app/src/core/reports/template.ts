import { parse as parseYaml } from 'yaml';

import { formulaRefs, parseFormula, type Expr } from './formula';
import type { PeriodKind } from './period';

/**
 * Report templates describe a state's (or funder's) reporting form in YAML.
 * See docs/report-templates.md for the full reference. The same validator is
 * used for bundled templates, CI checks, and files a program imports at
 * runtime.
 */

export const METRICS = {
  visits: 'Participant encounters (visits). Filter with `anonymous: true|false`.',
  participants: 'Unduplicated participants (unique codes) with at least one visit.',
  new_participants: 'Participants whose first-ever visit falls in the period.',
  returning_participants: 'Participants seen in the period who had visited before it.',
  supplies_out: 'Units of `supply` handed out (all supplies if omitted).',
  visits_with_supply: 'Visits where any of `supply` was handed out.',
  participants_with_supply: 'Unduplicated participants who received any of `supply`.',
  syringes_in: 'Used syringes collected.',
  reversals: 'Overdose reversals reported by participants.',
  visits_with_reversal: 'Visits where at least one reversal was reported.',
  referrals: 'Referrals made (filter with `referral`).',
  participants_referred: 'Unduplicated participants referred (filter with `referral`).',
  visits_with_referral: 'Visits with at least one referral (filter with `referral`).',
  secondary: 'People reached through secondary distribution.',
  stock_received: 'Units of `supply` received into inventory.',
  stock_on_hand: 'Program-wide units of `supply` on hand at the end of the period.',
  manual: 'A value staff type in when generating the report.',
} as const;

export type Metric = keyof typeof METRICS;
export type RowFormat = 'integer' | 'decimal' | 'percent';

const SUPPLY_METRICS: Metric[] = ['supplies_out', 'visits_with_supply', 'participants_with_supply', 'stock_received', 'stock_on_hand'];
const REFERRAL_METRICS: Metric[] = ['referrals', 'participants_referred', 'visits_with_referral'];

export interface TemplateRow {
  id: string;
  code?: string;
  label: string;
  help?: string;
  metric?: Metric;
  formula?: string;
  expr?: Expr;
  format: RowFormat;
  supply?: string[];
  referral?: string[];
  anonymous?: boolean;
}

export interface TemplateSection {
  title: string;
  rows: TemplateRow[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  jurisdiction: string;
  period: Exclude<PeriodKind, 'custom'>;
  version?: string;
  description?: string;
  source?: string;
  disclaimer?: string;
  sections: TemplateSection[];
}

export class TemplateError extends Error {}

const MAX_TEMPLATE_BYTES = 256 * 1024;
const ROW_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ITEM_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

function fail(where: string, msg: string): never {
  throw new TemplateError(`${where}: ${msg}`);
}

function optText(where: string, v: unknown, max = 2000): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' && typeof v !== 'number') fail(where, 'must be text');
  const s = String(v).trim();
  if (s.length > max) fail(where, `must be at most ${max} characters`);
  return s || undefined;
}

function reqText(where: string, v: unknown, max = 200): string {
  const s = optText(where, v, max);
  if (!s) fail(where, 'is required');
  return s;
}

function idList(where: string, v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const list = Array.isArray(v) ? v : [v];
  if (list.length === 0) fail(where, 'must not be empty');
  return list.map((x, i) => {
    if (typeof x !== 'string' || !ITEM_ID_RE.test(x)) fail(`${where}[${i}]`, 'must be a lowercase id like naloxone_nasal');
    return x;
  });
}

const ROW_KEYS = new Set(['id', 'code', 'label', 'help', 'metric', 'formula', 'format', 'supply', 'referral', 'anonymous']);
const TOP_KEYS = new Set(['kitcount_template', 'id', 'name', 'jurisdiction', 'period', 'version', 'description', 'source', 'disclaimer', 'sections']);

export function validateTemplate(doc: unknown): ReportTemplate {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('template', 'must be a YAML mapping');
  const t = doc as Record<string, unknown>;
  for (const k of Object.keys(t)) if (!TOP_KEYS.has(k)) fail('template', `unknown key "${k}"`);
  if (t.kitcount_template !== 1) fail('kitcount_template', 'must be 1');
  const id = reqText('id', t.id, 64);
  if (!TEMPLATE_ID_RE.test(id)) fail('id', 'must be lowercase letters, digits, dot, dash or underscore');
  const period = t.period;
  if (period !== 'month' && period !== 'quarter' && period !== 'year') fail('period', 'must be month, quarter or year');
  if (!Array.isArray(t.sections) || t.sections.length === 0) fail('sections', 'must be a non-empty list');

  const usedIds = new Set<string>();
  const formulaRows: TemplateRow[] = [];
  const sections = t.sections.map((rawSection, si): TemplateSection => {
    const where = `sections[${si}]`;
    if (!rawSection || typeof rawSection !== 'object') fail(where, 'must be a mapping');
    const s = rawSection as Record<string, unknown>;
    const title = reqText(`${where}.title`, s.title);
    if (!Array.isArray(s.rows) || s.rows.length === 0) fail(`${where}.rows`, 'must be a non-empty list');
    const rows = s.rows.map((rawRow, ri): TemplateRow => {
      const w = `${where}.rows[${ri}]`;
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) fail(w, 'must be a mapping');
      const r = rawRow as Record<string, unknown>;
      for (const k of Object.keys(r)) if (!ROW_KEYS.has(k)) fail(w, `unknown key "${k}"`);
      const rowId = r.id === undefined ? `s${si + 1}_r${ri + 1}` : reqText(`${w}.id`, r.id, 64);
      if (!ROW_ID_RE.test(rowId)) fail(`${w}.id`, 'must be a lowercase id like syringes_out');
      if (usedIds.has(rowId)) fail(`${w}.id`, `duplicate id "${rowId}"`);
      usedIds.add(rowId);
      const label = reqText(`${w}.label`, r.label, 300);
      const hasMetric = r.metric !== undefined;
      const hasFormula = r.formula !== undefined;
      if (hasMetric === hasFormula) fail(w, 'needs exactly one of `metric` or `formula`');
      const format = (r.format ?? (hasFormula ? 'decimal' : 'integer')) as RowFormat;
      if (!['integer', 'decimal', 'percent'].includes(format)) fail(`${w}.format`, 'must be integer, decimal or percent');
      const row: TemplateRow = {
        id: rowId,
        code: optText(`${w}.code`, r.code, 32),
        label,
        help: optText(`${w}.help`, r.help, 1000),
        format,
      };
      if (hasMetric) {
        if (typeof r.metric !== 'string' || !(r.metric in METRICS)) {
          fail(`${w}.metric`, `unknown metric "${String(r.metric)}". Known: ${Object.keys(METRICS).join(', ')}`);
        }
        row.metric = r.metric as Metric;
        row.supply = idList(`${w}.supply`, r.supply);
        row.referral = idList(`${w}.referral`, r.referral);
        if (row.supply && !SUPPLY_METRICS.includes(row.metric)) fail(`${w}.supply`, `not used by metric ${row.metric}`);
        if (row.referral && !REFERRAL_METRICS.includes(row.metric)) fail(`${w}.referral`, `not used by metric ${row.metric}`);
        if (r.anonymous !== undefined) {
          if (row.metric !== 'visits') fail(`${w}.anonymous`, 'only applies to the visits metric');
          if (typeof r.anonymous !== 'boolean') fail(`${w}.anonymous`, 'must be true or false');
          row.anonymous = r.anonymous;
        }
      } else {
        if (r.supply !== undefined || r.referral !== undefined || r.anonymous !== undefined) {
          fail(w, 'formula rows cannot have supply, referral or anonymous filters');
        }
        const src = reqText(`${w}.formula`, r.formula, 500);
        try {
          row.formula = src;
          row.expr = parseFormula(src);
        } catch (e) {
          fail(`${w}.formula`, (e as Error).message);
        }
        formulaRows.push(row);
      }
      return row;
    });
    return { title, rows };
  });

  // Validate formula references and detect cycles.
  const byId = new Map<string, TemplateRow>();
  for (const s of sections) for (const r of s.rows) byId.set(r.id, r);
  for (const row of formulaRows) {
    for (const ref of formulaRefs(row.expr!)) {
      if (!byId.has(ref)) fail(`row ${row.id}`, `formula refers to unknown row "${ref}"`);
    }
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') fail(`row ${id}`, `formula cycle: ${[...path, id].join(' -> ')}`);
    state.set(id, 'visiting');
    const r = byId.get(id)!;
    if (r.expr) for (const ref of formulaRefs(r.expr)) visit(ref, [...path, id]);
    state.set(id, 'done');
  };
  for (const row of formulaRows) visit(row.id, []);

  return {
    id,
    name: reqText('name', t.name, 200),
    jurisdiction: reqText('jurisdiction', t.jurisdiction, 120),
    period,
    version: optText('version', t.version, 40),
    description: optText('description', t.description),
    source: optText('source', t.source, 500),
    disclaimer: optText('disclaimer', t.disclaimer),
    sections,
  };
}

export function parseTemplate(text: string): ReportTemplate {
  if (text.length > MAX_TEMPLATE_BYTES) throw new TemplateError('Template file is too large (max 256 KB)');
  let doc: unknown;
  try {
    doc = parseYaml(text, { maxAliasCount: 20, prettyErrors: true });
  } catch (e) {
    throw new TemplateError(`YAML syntax error: ${(e as Error).message}`);
  }
  return validateTemplate(doc);
}
