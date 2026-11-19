import { defaultCatalog, validateCatalog } from '../domain/catalog';
import { createEvent, EventValidationError, parseEvent, visitUnits } from '../domain/events';
import { DEVICE_A, testKeys, visit } from './fixtures';

const roundTrip = (e: unknown) => parseEvent(JSON.parse(JSON.stringify(e)));

describe('events', () => {
  const keys = testKeys();

  it('creates and validates every event type', () => {
    const v = visit(keys, '2026-10-02T15:00:00.000Z', { code: 'JD03', out: { syringes: 20, naloxone_nasal: 2 }, syringesIn: 15, reversals: 1, referrals: ['moud', 'moud'], secondary: 2 });
    const parsed = roundTrip(v);
    expect(parsed).toEqual({ ...v, referrals: ['moud'] });
    expect(visitUnits(v)).toBe(22);

    const events = [
      createEvent(DEVICE_A, { type: 'visit.voided', visit: v.id }),
      createEvent(DEVICE_A, { type: 'stock.received', supply: 'syringes', qty: 1000 }),
      createEvent(DEVICE_A, { type: 'stock.adjusted', supply: 'syringes', delta: -10, reason: 'damaged' }),
      createEvent(DEVICE_A, { type: 'config.set', key: 'programName', value: '  Harbor  ' }),
      createEvent(DEVICE_A, { type: 'config.set', key: 'templateId', value: 'generic-monthly' }),
      createEvent(DEVICE_A, { type: 'config.set', key: 'codeHint', value: 'Initials + month' }),
      createEvent(DEVICE_A, { type: 'config.set', key: 'codePattern', value: '[A-Z]{2}\\d{2}' }),
      createEvent(DEVICE_A, { type: 'config.set', key: 'catalog', value: defaultCatalog() }),
    ];
    for (const e of events) expect(roundTrip(e).type).toBe(e.type);
    expect((roundTrip(events[3]) as { value: string }).value).toBe('Harbor');
  });

  it('allows anonymous visits and drops zero quantities and unknown fields', () => {
    const v = visit(keys, '2026-10-02T15:00:00.000Z', { out: { syringes: 0, cookers: 5 } });
    const parsed = roundTrip({ ...v, name: 'should be dropped' });
    expect(parsed).not.toHaveProperty('name');
    expect((parsed as typeof v).participant).toBeNull();
    expect((parsed as typeof v).out).toEqual({ cookers: 5 });
  });

  const base = () => visit(keys, '2026-10-02T15:00:00.000Z', { code: 'JD03' }) as unknown as Record<string, unknown>;

  it.each([
    ['not an object', () => 'x'],
    ['bad id', () => ({ ...base(), id: 'nope' })],
    ['bad version', () => ({ ...base(), v: 2 })],
    ['bad timestamp', () => ({ ...base(), at: 'yesterday' })],
    ['bad device', () => ({ ...base(), device: 'DROP TABLE' })],
    ['bad type', () => ({ ...base(), type: 'visit.deleted' })],
    ['plaintext participant', () => ({ ...base(), participant: 'JD03' })],
    ['negative quantity', () => ({ ...base(), out: { syringes: -1 } })],
    ['fractional quantity', () => ({ ...base(), out: { syringes: 1.5 } })],
    ['bad supply id', () => ({ ...base(), out: { 'Bad Id': 1 } })],
    ['out not object', () => ({ ...base(), out: [1] })],
    ['too many supplies', () => ({ ...base(), out: Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`s${i}`, 1])) })],
    ['bad syringesIn', () => ({ ...base(), syringesIn: -3 })],
    ['bad reversals', () => ({ ...base(), reversals: 1000 })],
    ['bad secondary', () => ({ ...base(), secondary: 'two' })],
    ['bad referrals', () => ({ ...base(), referrals: 'moud' })],
    ['bad referral id', () => ({ ...base(), referrals: ['Free text name'] })],
    ['void without uuid', () => ({ ...base(), type: 'visit.voided', visit: 'x' })],
    ['receive zero', () => ({ ...base(), type: 'stock.received', supply: 'syringes', qty: 0 })],
    ['receive bad supply', () => ({ ...base(), type: 'stock.received', supply: '', qty: 1 })],
    ['adjust zero', () => ({ ...base(), type: 'stock.adjusted', supply: 'syringes', delta: 0, reason: 'count' })],
    ['adjust bad supply', () => ({ ...base(), type: 'stock.adjusted', supply: 'A', delta: 1, reason: 'count' })],
    ['adjust bad reason', () => ({ ...base(), type: 'stock.adjusted', supply: 'syringes', delta: 1, reason: 'stolen?' })],
    ['config bad key', () => ({ ...base(), type: 'config.set', key: 'admin', value: true })],
    ['config bad name', () => ({ ...base(), type: 'config.set', key: 'programName', value: '' })],
    ['config bad template', () => ({ ...base(), type: 'config.set', key: 'templateId', value: 'Bad Id' })],
    ['config bad hint', () => ({ ...base(), type: 'config.set', key: 'codeHint', value: 5 })],
    ['config bad regex', () => ({ ...base(), type: 'config.set', key: 'codePattern', value: '([' })],
    ['config bad pattern type', () => ({ ...base(), type: 'config.set', key: 'codePattern', value: 1 })],
    ['config bad catalog', () => ({ ...base(), type: 'config.set', key: 'catalog', value: { supplies: [] } })],
  ])('rejects %s', (_name, make) => {
    expect(() => parseEvent(make())).toThrow(EventValidationError);
  });
});

describe('catalog validation', () => {
  it('accepts the default catalog', () => {
    expect(validateCatalog(defaultCatalog())).toEqual(defaultCatalog());
  });

  it.each([
    ['null', null],
    ['no supplies', { supplies: [], referrals: [] }],
    ['referrals not list', { supplies: defaultCatalog().supplies, referrals: 'x' }],
    ['bad supply id', { ...defaultCatalog(), supplies: [{ ...defaultCatalog().supplies[0], id: 'Bad' }] }],
    ['duplicate supply', { ...defaultCatalog(), supplies: [defaultCatalog().supplies[0], defaultCatalog().supplies[0]] }],
    ['bad icon', { ...defaultCatalog(), supplies: [{ ...defaultCatalog().supplies[0], icon: 'rocket' }] }],
    ['bad step', { ...defaultCatalog(), supplies: [{ ...defaultCatalog().supplies[0], step: 0 }] }],
    ['bad text', { ...defaultCatalog(), supplies: [{ ...defaultCatalog().supplies[0], short: 'a very long tile label' }] }],
    ['bad referral', { ...defaultCatalog(), referrals: [{ id: 'x', name: '' }] }],
    ['bad referral id', { ...defaultCatalog(), referrals: [{ id: '1x', name: 'n' }] }],
    ['duplicate referral', { ...defaultCatalog(), referrals: [defaultCatalog().referrals[0], defaultCatalog().referrals[0]] }],
  ])('rejects %s', (_n, value) => {
    expect(() => validateCatalog(value)).toThrow();
  });
});
