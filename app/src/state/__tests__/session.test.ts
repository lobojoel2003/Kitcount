import { decodeEnrollment } from '../../core/crypto/keys';
import { MemoryStore } from '../../core/store/memory';
import { SyncError } from '../../core/sync/transport';
import { MAX_PIN_ATTEMPTS, Session } from '../session';

// Use the in-memory platform variants (the same ones the browser demo uses).
jest.mock('../../platform/secure', () => jest.requireActual('../../platform/secure.web'));
jest.mock('../../platform/database', () => jest.requireActual('../../platform/database.web'));
jest.mock('../../platform/files', () => ({ clearExports: jest.fn() }));

const mockSyncOnce = jest.fn();
jest.mock('../../core/sync/sync', () => ({ syncOnce: (...args: unknown[]) => mockSyncOnce(...args) }));

const PIN = '482915';

async function readyProgram(): Promise<Session> {
  const s = new Session();
  await s.boot();
  await s.createProgram({ programName: 'Harbor', templateId: 'generic-monthly', pin: PIN });
  return s;
}

afterEach(async () => {
  // Leave the shared in-memory keystore clean between tests.
  await new Session().wipe(null);
  mockSyncOnce.mockReset();
});

describe('Session', () => {
  it('starts on the welcome screen, then creates a program', async () => {
    const s = new Session();
    await s.boot();
    expect(s.status).toBe('welcome');
    await expect(s.createProgram({ programName: ' ', templateId: 'x', pin: PIN })).rejects.toThrow(/name/);
    await expect(s.createProgram({ programName: 'Harbor', templateId: 'generic-monthly', pin: '12' })).rejects.toThrow(/PIN/);
    await s.createProgram({ programName: 'Harbor', templateId: 'generic-monthly', pin: PIN });
    expect(s.status).toBe('ready');
    expect(s.programName).toBe('Harbor');
    expect(s.fingerprint).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it('logs visits with hashed codes only and supports undo', async () => {
    const s = await readyProgram();
    const v = await s.logVisit({
      code: ' jd-03 ',
      out: { syringes: 20, cookers: 0 },
      syringesIn: 10,
      reversals: 1,
      referrals: ['moud'],
      secondary: 0,
    });
    expect(v.participant).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(v)).not.toContain('JD03');
    expect(v.out).toEqual({ syringes: 20 });
    expect(s.ledger.participant(v.participant!)?.visits).toBe(1);
    await expect(s.logVisit({ code: 'x', out: {}, syringesIn: 0, reversals: 0, referrals: [], secondary: 0 })).rejects.toThrow(/at least/);
    const anon = await s.logVisit({ code: null, out: {}, syringesIn: 0, reversals: 0, referrals: [], secondary: 0 });
    expect(anon.participant).toBeNull();
    await s.voidVisit(v.id);
    expect(s.ledger.visits().map((x) => x.id)).toEqual([anon.id]);
  });

  it('enforces the configured code pattern', async () => {
    const s = await readyProgram();
    await s.setConfig('codePattern', '[A-Z]{2}\\d{2}');
    await expect(s.logVisit({ code: 'ABC1', out: {}, syringesIn: 0, reversals: 0, referrals: [], secondary: 0 })).rejects.toThrow(/format/);
    await expect(s.logVisit({ code: 'AB12', out: {}, syringesIn: 0, reversals: 0, referrals: [], secondary: 0 })).resolves.toBeTruthy();
  });

  it('tracks stock including physical counts', async () => {
    const s = await readyProgram();
    await s.receiveStock('naloxone_nasal', 30);
    await s.logVisit({ code: 'AB12', out: { naloxone_nasal: 2 }, syringesIn: 0, reversals: 0, referrals: [], secondary: 0 });
    expect(s.ledger.onHand(s.deviceId).naloxone_nasal).toBe(28);
    expect(await s.countStock('naloxone_nasal', 25)).toBe(-3);
    expect(await s.countStock('naloxone_nasal', 25)).toBe(0);
    await s.adjustStock('naloxone_nasal', -5, 'expired');
    expect(s.ledger.onHand(s.deviceId).naloxone_nasal).toBe(20);
  });

  it('locks, refuses use while locked, and unlocks with the PIN', async () => {
    const s = await readyProgram();
    await s.logVisit({ code: 'AB12', out: {}, syringesIn: 0, reversals: 0, referrals: [], secondary: 0 });
    await s.lock();
    expect(s.status).toBe('locked');
    expect(s.ledger.size).toBe(0);
    expect(() => s.participantHash('AB12')).toThrow(/locked/);
    expect(await s.unlock('000000')).toEqual({ ok: false, remaining: MAX_PIN_ATTEMPTS - 1 });
    expect(await s.unlock(PIN)).toEqual({ ok: true });
    expect(s.status).toBe('ready');
    expect(s.failures).toBe(0);
    expect(s.ledger.visits()).toHaveLength(1);
  });

  it(`wipes after ${MAX_PIN_ATTEMPTS} wrong PINs`, async () => {
    const s = await readyProgram();
    await s.lock();
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) expect((await s.unlock('000000')).remaining).toBe(MAX_PIN_ATTEMPTS - i);
    expect(await s.unlock('000000')).toEqual({ ok: false, wiped: true });
    expect(s.status).toBe('welcome');
    expect(s.wipeNotice).toMatch(/wrong PIN/);
    const fresh = new Session();
    await fresh.boot();
    expect(fresh.status).toBe('welcome');
  });

  it('silently wipes on the duress PIN', async () => {
    const s = await readyProgram();
    await expect(s.setDuressPin(PIN)).rejects.toThrow(/different/);
    await s.setDuressPin('135790');
    expect(await s.hasDuressPin()).toBe(true);
    await expect(s.changePin(PIN, '135790')).rejects.toThrow(/duress/);
    await s.lock();
    expect(await s.unlock('135790')).toEqual({ ok: false, wiped: true });
    expect(s.status).toBe('welcome');
    expect(s.wipeNotice).toBeNull();
  });

  it('changes the PIN and the duress PIN', async () => {
    const s = await readyProgram();
    await expect(s.changePin('111111', '222222')).rejects.toThrow(/wrong/);
    await s.changePin(PIN, '222333');
    expect(await s.checkPin('222333')).toBe(true);
    await s.setDuressPin('135790');
    await s.setDuressPin(null);
    expect(await s.hasDuressPin()).toBe(false);
  });

  it('produces an enrollment code another device can join with', async () => {
    const s = await readyProgram();
    const code = s.enrollmentCode();
    const e = decodeEnrollment(code);
    expect(e.programName).toBe('Harbor');
    const hash = s.participantHash('AB12');
    await s.wipe(null);

    const other = new Session();
    await other.boot();
    await other.joinProgram({ ...e, serverUrl: 'https://sync.example.org' }, '246813');
    expect(other.status).toBe('ready');
    expect(other.participantHash('ab-12')).toBe(hash);
    expect(other.programName).toBe('Harbor');
    expect(other.sync).toMatchObject({ configured: false, url: 'https://sync.example.org' });
  });

  it('imports and removes report templates', async () => {
    const s = await readyProgram();
    const yaml =
      'kitcount_template: 1\nid: my-state\nname: Mine\njurisdiction: Here\nperiod: month\nsections:\n  - title: S\n    rows:\n      - { label: Visits, metric: visits }\n';
    expect((await s.importTemplate(yaml)).id).toBe('my-state');
    await s.importTemplate(yaml.replace('name: Mine', 'name: Mine v2'));
    expect(s.importedTemplates).toHaveLength(1);
    await expect(s.importTemplate('nope')).rejects.toThrow();
    await s.removeTemplate('my-state');
    expect(s.importedTemplates).toEqual([]);
  });

  describe('sync', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
      fetchMock.mockReset();
      global.fetch = fetchMock as unknown as typeof fetch;
    });

    async function connected(): Promise<Session> {
      const s = await readyProgram();
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ device: { id: 'd1', name: 'Van 1' }, server: { version: '1.0.0' } })));
      mockSyncOnce.mockResolvedValue({ pushed: 0, pulled: 0, rejected: 0, cursor: 0, received: [] });
      expect(await s.configureSync('https://sync.example.org/', 'kc_dev_token')).toBe('Van 1');
      expect(s.sync).toMatchObject({ configured: true, url: 'https://sync.example.org' });
      // configureSync kicks off a first sync in the background; let it finish.
      for (let i = 0; i < 50 && s.sync.running; i++) await new Promise((r) => setTimeout(r, 0));
      expect(s.sync.running).toBe(false);
      return s;
    }

    it('validates server settings', async () => {
      const s = await readyProgram();
      await expect(s.configureSync('http://sync.example.org', 'tok')).rejects.toThrow(/https/);
      await expect(s.configureSync('https://sync.example.org', '  ')).rejects.toThrow(/token/);
    });

    it('applies received events and records errors', async () => {
      const s = await connected();
      const donor = await new MemoryStore().allEvents();
      mockSyncOnce.mockResolvedValueOnce({ pushed: 0, pulled: 0, rejected: 0, cursor: 0, received: donor });
      await s.syncNow();
      expect(s.sync.running).toBe(false);
      mockSyncOnce.mockRejectedValueOnce(new SyncError('offline', 'Could not reach the sync server'));
      await s.syncNow();
      expect(s.sync.lastError).toBe('Could not reach the sync server');
      mockSyncOnce.mockRejectedValueOnce(new SyncError('revoked', 'revoked'));
      await s.syncNow();
      expect(s.sync.revoked).toBe(true);
      await s.disconnectSync();
      expect(s.sync.configured).toBe(false);
    });

    it('wipes itself when the server says so', async () => {
      const s = await connected();
      mockSyncOnce.mockRejectedValueOnce(new SyncError('wipe', 'wipe'));
      await s.syncNow();
      expect(s.status).toBe('welcome');
      expect(s.wipeNotice).toMatch(/remotely wiped/);
    });

    it('recovers if the app locks in the middle of a sync', async () => {
      const s = await connected();
      let finish: (v: unknown) => void = () => undefined;
      mockSyncOnce.mockReturnValueOnce(new Promise((r) => (finish = r)));
      const pending = s.syncNow();
      await s.lock();
      finish({ pushed: 0, pulled: 0, rejected: 0, cursor: 0, received: [] });
      await pending;
      await s.unlock(PIN);
      mockSyncOnce.mockResolvedValueOnce({ pushed: 0, pulled: 0, rejected: 0, cursor: 0, received: [] });
      const calls = mockSyncOnce.mock.calls.length;
      await s.syncNow();
      expect(mockSyncOnce.mock.calls.length).toBe(calls + 1);
    });
  });
});
