import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createEvent } from '../domain/events';
import { Ledger } from '../domain/ledger';
import { BUNDLED_TEMPLATES } from '../reports/bundled-templates';
import { computeReport, formatValue } from '../reports/engine';
import { reportFilename, reportToCsv, reportToHtml } from '../reports/export';
import { evaluateFormula, formulaRefs, parseFormula } from '../reports/formula';
import { currentPeriod, customPeriod, monthPeriod, previousPeriod, quarterPeriod, shiftPeriod, yearPeriod } from '../reports/period';
import { allTemplates, bundledTemplates } from '../reports/registry';
import { parseTemplate, TemplateError } from '../reports/template';
import { DEVICE_A, DEVICE_B, received, testKeys, visit } from './fixtures';

const templatesDir = join(__dirname, '..', '..', '..', '..', 'templates');

describe('bundled templates', () => {
  const files = readdirSync(templatesDir).filter((f) => f.endsWith('.yaml'));

  it('includes every file in /templates, unchanged', () => {
    expect(Object.keys(BUNDLED_TEMPLATES).sort()).toEqual(files.sort());
    for (const f of files) {
      expect(BUNDLED_TEMPLATES[f]).toBe(readFileSync(join(templatesDir, f), 'utf8').replace(/\r\n/g, '\n'));
    }
  });

  it.each(files)('%s is valid and has a unique id', (file) => {
    const t = parseTemplate(readFileSync(join(templatesDir, file), 'utf8'));
    expect(`${t.id}.yaml`).toBe(file);
    expect(bundledTemplates().filter((e) => e.template.id === t.id)).toHaveLength(1);
  });

  it.each(files)('%s computes without warnings on the default catalog', (file) => {
    const t = parseTemplate(readFileSync(join(templatesDir, file), 'utf8'));
    const r = computeReport(t, new Ledger(), currentPeriod(t.period), {
      manualValues: Object.fromEntries(t.sections.flatMap((s) => s.rows.map((row) => [row.id, 1]))),
    });
    expect(r.warnings).toEqual([]);
  });
});

describe('template validation', () => {
  const ok = `
kitcount_template: 1
id: t
name: T
jurisdiction: Here
period: month
sections:
  - title: S
    rows:
      - { id: a, label: A, metric: visits }
`;
  const withRows = (rows: string) => ok.replace('      - { id: a, label: A, metric: visits }', rows);

  it('accepts a minimal template and defaults ids and formats', () => {
    const t = parseTemplate(withRows('      - { label: A, metric: visits }\n      - { id: b, label: B, formula: s1_r1 * 2 }'));
    expect(t.sections[0].rows[0]).toMatchObject({ id: 's1_r1', format: 'integer' });
    expect(t.sections[0].rows[1]).toMatchObject({ id: 'b', format: 'decimal' });
  });

  it.each([
    ['syntax error', 'kitcount_template: [1', /YAML syntax/],
    ['not a mapping', '- 1', /mapping/],
    ['wrong version', ok.replace('kitcount_template: 1', 'kitcount_template: 2'), /must be 1/],
    ['unknown top key', `${ok}\nextra: 1\n`, /unknown key "extra"/],
    ['bad id', ok.replace('id: t', 'id: "Bad Id"'), /id/],
    ['bad period', ok.replace('period: month', 'period: week'), /period/],
    ['missing name', ok.replace('name: T\n', ''), /name: is required/],
    ['no sections', ok.replace(/sections:[\s\S]*/, 'sections: []'), /sections/],
    ['no rows', ok.replace(/rows:[\s\S]*/, 'rows: []'), /rows/],
    ['unknown row key', withRows('      - { id: a, label: A, metric: visits, color: red }'), /unknown key "color"/],
    ['metric and formula', withRows('      - { id: a, label: A, metric: visits, formula: "1" }'), /exactly one/],
    ['neither', withRows('      - { id: a, label: A }'), /exactly one/],
    ['unknown metric', withRows('      - { id: a, label: A, metric: hugs }'), /unknown metric/],
    ['duplicate id', withRows('      - { id: a, label: A, metric: visits }\n      - { id: a, label: B, metric: visits }'), /duplicate/],
    ['supply on wrong metric', withRows('      - { id: a, label: A, metric: visits, supply: syringes }'), /not used by metric/],
    ['referral on wrong metric', withRows('      - { id: a, label: A, metric: visits, referral: moud }'), /not used by metric/],
    ['bad supply id', withRows('      - { id: a, label: A, metric: supplies_out, supply: "Syringes!" }'), /lowercase id/],
    ['anonymous on wrong metric', withRows('      - { id: a, label: A, metric: participants, anonymous: true }'), /only applies/],
    ['anonymous not boolean', withRows('      - { id: a, label: A, metric: visits, anonymous: "yes" }'), /true or false/],
    ['bad format', withRows('      - { id: a, label: A, metric: visits, format: money }'), /format/],
    ['formula with filter', withRows('      - { id: a, label: A, formula: "1", supply: syringes }'), /cannot have/],
    ['formula syntax', withRows('      - { id: a, label: A, formula: "1 +" }'), /formula/],
    ['formula unknown ref', withRows('      - { id: a, label: A, formula: "b * 2" }'), /unknown row "b"/],
    ['formula cycle', withRows('      - { id: a, label: A, formula: "b" }\n      - { id: b, label: B, formula: "a" }'), /cycle/],
    ['too long', 'x'.repeat(300_000), /too large/],
  ])('rejects %s', (_name, yaml, message) => {
    expect(() => parseTemplate(yaml)).toThrow(TemplateError);
    expect(() => parseTemplate(yaml)).toThrow(message);
  });

  it('lets imported templates override bundled ones and skips broken ones', () => {
    const custom = ok.replace('id: t', 'id: generic-monthly').replace('name: T', 'name: Custom monthly');
    const list = allTemplates([custom, 'not: valid']);
    const monthly = list.find((e) => e.template.id === 'generic-monthly')!;
    expect(monthly.source).toBe('imported');
    expect(monthly.template.name).toBe('Custom monthly');
    expect(list.length).toBe(bundledTemplates().length);
  });
});

describe('formulas', () => {
  const lookup = (vals: Record<string, number | null>) => (id: string) => (id in vals ? vals[id] : null);

  it('respects precedence, parentheses and unary minus', () => {
    expect(evaluateFormula(parseFormula('1 + 2 * 3'), lookup({}))).toBe(7);
    expect(evaluateFormula(parseFormula('(1 + 2) * 3'), lookup({}))).toBe(9);
    expect(evaluateFormula(parseFormula('-a + 10 / 4'), lookup({ a: 1 }))).toBe(1.5);
    expect(evaluateFormula(parseFormula('a - b - c'), lookup({ a: 10, b: 3, c: 2 }))).toBe(5);
    expect(evaluateFormula(parseFormula('1.5e2'), lookup({}))).toBe(150);
  });

  it('returns null for division by zero and missing inputs', () => {
    expect(evaluateFormula(parseFormula('a / b'), lookup({ a: 1, b: 0 }))).toBeNull();
    expect(evaluateFormula(parseFormula('a + 1'), lookup({}))).toBeNull();
    expect(evaluateFormula(parseFormula('-a'), lookup({}))).toBeNull();
  });

  it('lists references', () => {
    expect([...formulaRefs(parseFormula('(a + b) / -c * 2'))].sort()).toEqual(['a', 'b', 'c']);
  });

  it.each(['', '1 +', '(1', '1)', 'a b', 'a $ b', '*', '1..2', `${'('.repeat(40)}1${')'.repeat(40)}`, 'x'.repeat(501)])(
    'rejects %p',
    (src) => {
      expect(() => parseFormula(src)).toThrow();
    },
  );
});

describe('periods', () => {
  it('builds months, quarters and years', () => {
    expect(monthPeriod(2026, 9)).toMatchObject({ label: 'October 2026', key: '2026-10' });
    expect(monthPeriod(2026, 9).end.getMonth()).toBe(10);
    expect(quarterPeriod(2026, 4)).toMatchObject({ label: 'Q4 2026', key: '2026-Q4' });
    expect(yearPeriod(2026)).toMatchObject({ key: '2026' });
    expect(customPeriod(new Date(2026, 9, 3), new Date(2026, 9, 9))).toMatchObject({ key: '2026-10-03_2026-10-09' });
  });

  it('finds previous and current periods', () => {
    const jan = new Date(2026, 0, 15);
    expect(previousPeriod('month', jan).key).toBe('2025-12');
    expect(previousPeriod('quarter', jan).key).toBe('2025-Q4');
    expect(previousPeriod('quarter', new Date(2026, 7, 1)).key).toBe('2026-Q2');
    expect(previousPeriod('year', jan).key).toBe('2025');
    expect(currentPeriod('month', jan).key).toBe('2026-01');
    expect(currentPeriod('quarter', new Date(2026, 11, 31)).key).toBe('2026-Q4');
    expect(currentPeriod('year', jan).key).toBe('2026');
  });

  it('shifts periods', () => {
    expect(shiftPeriod(monthPeriod(2026, 0), -1).key).toBe('2025-12');
    expect(shiftPeriod(quarterPeriod(2026, 1), -1).key).toBe('2025-Q4');
    expect(shiftPeriod(quarterPeriod(2026, 4), 1).key).toBe('2027-Q1');
    expect(shiftPeriod(yearPeriod(2026), 2).key).toBe('2028');
    expect(shiftPeriod(customPeriod(new Date(2026, 9, 1), new Date(2026, 9, 7)), 1).key).toBe('2026-10-08_2026-10-14');
  });
});

describe('computeReport', () => {
  const keys = testKeys();
  const monthly = bundledTemplates().find((e) => e.template.id === 'generic-monthly')!.template;
  const october = monthPeriod(2026, 9);
  const inOct = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

  const events = [
    createEvent(DEVICE_A, { type: 'config.set', key: 'programName', value: 'Harbor Harm Reduction' }, new Date(2026, 0, 1)),
    received('syringes', 5000, new Date(2026, 8, 1).toISOString()),
    received('naloxone_nasal', 100, inOct(2)),
    // JD03 first came in September: returning in October.
    visit(keys, new Date(2026, 8, 20).toISOString(), { code: 'JD03', out: { syringes: 50 } }),
    visit(keys, inOct(1), { code: 'JD03', out: { syringes: 100, naloxone_nasal: 2 }, syringesIn: 80, reversals: 1, referrals: ['moud'] }),
    visit(keys, inOct(3), {
      code: 'AB11',
      out: { syringes: 40, fentanyl_strips: 10 },
      syringesIn: 40,
      referrals: ['hiv_testing', 'hcv_testing'],
      device: DEVICE_B,
    }),
    visit(keys, inOct(9), { code: 'AB11', out: { naloxone_im: 1 }, secondary: 3 }),
    visit(keys, inOct(12), { code: null, out: { syringes: 10 } }),
    // November: outside the period.
    visit(keys, new Date(2026, 10, 1, 9).toISOString(), { code: 'ZZ99', out: { syringes: 500 } }),
  ];
  const voided = visit(keys, inOct(15), { code: 'QQ11', out: { syringes: 999 } });
  events.push(voided, createEvent(DEVICE_A, { type: 'visit.voided', visit: voided.id }));
  const ledger = new Ledger(events);
  const report = computeReport(monthly, ledger, october, { now: new Date(2026, 10, 2) });
  const value = (id: string) => report.sections.flatMap((s) => s.rows).find((r) => r.id === id)!;

  it('counts encounters and participants', () => {
    expect(report.programName).toBe('Harbor Harm Reduction');
    expect(report.visitCount).toBe(4);
    expect(value('encounters').value).toBe(4);
    expect(value('unique_participants').value).toBe(2);
    expect(value('new_participants').value).toBe(1);
    expect(value('returning_participants').value).toBe(1);
    expect(value('anonymous_encounters').value).toBe(1);
    expect(value('secondary_reach').value).toBe(3);
  });

  it('counts supplies, return rate and naloxone', () => {
    expect(value('syringes_out').value).toBe(150);
    expect(value('syringes_in').value).toBe(120);
    expect(value('syringe_return_rate').display).toBe('80%');
    expect(value('syringes_per_encounter').display).toBe('37.5');
    expect(value('naloxone_kits').value).toBe(3);
    expect(value('naloxone_nasal').value).toBe(2);
    expect(value('naloxone_recipients').value).toBe(2);
    expect(value('reversals').value).toBe(1);
    expect(value('fentanyl_strips').value).toBe(10);
  });

  it('counts referrals', () => {
    expect(value('referrals_total').value).toBe(3);
    expect(value('participants_referred').value).toBe(2);
    expect(value('referrals_moud').value).toBe(1);
    expect(value('referrals_testing').value).toBe(2);
    expect(value('referrals_social').value).toBe(0);
  });

  it('reports inventory for the period', () => {
    const quarterly = bundledTemplates().find((e) => e.template.id === 'generic-quarterly')!.template;
    const r = computeReport(quarterly, ledger, quarterPeriod(2026, 4));
    const row = (id: string) => r.sections.flatMap((s) => s.rows).find((x) => x.id === id)!;
    expect(row('naloxone_received').value).toBe(100);
    // Q4 ends 2027-01-01, so the November visit is included as well.
    expect(row('syringes_on_hand').value).toBe(5000 - 50 - 150 - 500);
    expect(row('naloxone_on_hand').value).toBe(100 - 3);
    expect(row('kits_per_reversal').display).toBe('3');
    expect(row('referral_rate').display).toBe('40%');
    expect(row('encounters_per_participant').display).toBe('1.33');
  });

  it('handles manual rows and warns when they are missing', () => {
    const example = bundledTemplates().find((e) => e.template.id === 'example-state-form')!.template;
    const missing = computeReport(example, ledger, october);
    expect(missing.warnings).toEqual(expect.arrayContaining([expect.stringContaining('needs a value')]));
    const r = computeReport(example, ledger, october, { manualValues: { a1: 8, d5: 2 } });
    const row = (id: string) => r.sections.flatMap((s) => s.rows).find((x) => x.id === id)!;
    expect(r.warnings).toEqual([]);
    expect(row('a5').display).toBe('0.5');
    expect(row('b3').value).toBe(30);
    expect(row('c4').value).toBe(1);
    expect(row('d3').value).toBe(0);
    expect(row('a1').manual).toBe(true);
  });

  it('warns about supplies the program does not track', () => {
    const t = parseTemplate(`
kitcount_template: 1
id: x
name: X
jurisdiction: Y
period: year
sections:
  - title: S
    rows:
      - { id: a, label: Unicorns, metric: supplies_out, supply: unicorns }
      - { id: b, label: Hugs, metric: referrals, referral: hugs }
      - { id: c, label: Everything, metric: supplies_out }
      - { id: d, label: Any supply, metric: visits_with_supply }
      - { id: e, label: Any referral, metric: visits_with_referral }
      - { id: f, label: Coded visits, metric: visits, anonymous: false }
      - { id: g, label: All on hand, metric: stock_on_hand }
      - { id: h, label: All received, metric: stock_received }
`);
    const r = computeReport(t, ledger, yearPeriod(2026));
    expect(r.warnings).toHaveLength(2);
    const row = (id: string) => r.sections[0].rows.find((x) => x.id === id)!;
    expect(row('a').value).toBe(0);
    expect(row('c').value).toBe(50 + 100 + 2 + 40 + 10 + 1 + 10 + 500);
    expect(row('d').value).toBe(6);
    expect(row('e').value).toBe(2);
    expect(row('f').value).toBe(5);
    expect(row('g').value).toBe(5100 - 713);
    expect(row('h').value).toBe(5100);
  });

  it('formats values', () => {
    expect(formatValue(null, 'integer')).toBe('—');
    expect(formatValue(Infinity, 'decimal')).toBe('—');
    expect(formatValue(1234.4, 'integer')).toBe('1,234');
    expect(formatValue(0.12345, 'percent')).toBe('12.3%');
    expect(formatValue(2 / 3, 'decimal')).toBe('0.67');
  });

  it('exports CSV and HTML', () => {
    const csv = reportToCsv(report);
    expect(csv).toContain('Program,Harbor Harm Reduction\r\n');
    expect(csv).toContain('Period,2026-10-01 to 2026-10-31\r\n');
    expect(csv).toContain('Section,Code,Item,Value\r\n');
    expect(csv).toContain('Syringes,2.1,Sterile syringes distributed,150\r\n');
    expect(csv).toContain('Syringes,2.3,Syringe return rate,80\r\n');
    expect(csv).toContain('Naloxone and overdose,3.1a,— nasal spray,2\r\n');
    expect(reportFilename(report, 'csv')).toBe('kitcount-generic-monthly-2026-10.csv');

    const html = reportToHtml(report);
    expect(html).toContain('<h1>SSP monthly activity report</h1>');
    expect(html).toContain('Harbor Harm Reduction');
    expect(html).toContain('80%');
  });

  it('escapes CSV and HTML injection', () => {
    const evil = { ...report, programName: '=HYPERLINK("http://x")', templateName: '<script>alert(1)</script>' };
    const csv = reportToCsv(evil);
    expect(csv).toContain(`Program,"'=HYPERLINK(""http://x"")"`);
    expect(reportToHtml(evil)).not.toContain('<script>');
  });
});
