import { fromBase64Url, toBase64Url, toHex } from '../core/crypto/bytes';
import { checkCode, hashCode } from '../core/crypto/codes';
import {
  deriveProgramKeys,
  encodeEnrollment,
  generateProgram,
  programFingerprint,
  type Enrollment,
  type ProgramKeys,
} from '../core/crypto/keys';
import { hashPin, PIN_RE, verifyPin } from '../core/crypto/pin';
import { randomBytes, uuid } from '../core/crypto/random';
import {
  createEvent,
  type AdjustReason,
  type ConfigKey,
  type KitEvent,
  type NewEvent,
  type ProgramConfig,
  type VisitLogged,
} from '../core/domain/events';
import { Ledger } from '../core/domain/ledger';
import { parseTemplate, type ReportTemplate } from '../core/reports/template';
import { META } from '../core/store/types';
import { syncOnce } from '../core/sync/sync';
import { HttpTransport, normalizeServerUrl, SyncError } from '../core/sync/transport';
import { destroyDatabase, openDatabase, type OpenDatabase } from '../platform/database';
import { clearExports } from '../platform/files';
import { secure } from '../platform/secure';

/**
 * The app session: owns secrets, the encrypted database and the in-memory
 * ledger, and implements lock, unlock and panic wipe. React components read
 * it through src/state/KitcountProvider.tsx.
 */

export type Status = 'loading' | 'welcome' | 'locked' | 'ready';

export const MAX_PIN_ATTEMPTS = 10;
/** PIN of the browser demo (sample data only). */
export const DEMO_PIN = '246810';
export const AUTO_LOCK_MS = 60_000;

const K = {
  program: 'kc.program',
  dbKey: 'kc.dbkey',
  device: 'kc.device',
  pin: 'kc.pin',
  duress: 'kc.duress',
  failures: 'kc.failures',
  sync: 'kc.sync',
  programName: 'kc.programName',
} as const;

const META_TEMPLATES = 'templates.imported';

export interface SyncState {
  configured: boolean;
  url: string | null;
  running: boolean;
  lastAt: string | null;
  lastError: string | null;
  pending: number;
  rejected: number;
  revoked: boolean;
}

export interface UnlockResult {
  ok: boolean;
  remaining?: number;
  wiped?: boolean;
  error?: string;
}

export interface VisitInput {
  code: string | null;
  out: Record<string, number>;
  syringesIn: number;
  reversals: number;
  referrals: string[];
  secondary: number;
}

export class Session {
  status: Status = 'loading';
  ledger = new Ledger();
  keys: ProgramKeys | null = null;
  deviceId = '';
  failures = 0;
  importedTemplates: string[] = [];
  /** Set when the device was wiped (shown once on the welcome screen). */
  wipeNotice: string | null = null;
  bootError: string | null = null;
  sync: SyncState = {
    configured: false,
    url: null,
    running: false,
    lastAt: null,
    lastError: null,
    pending: 0,
    rejected: 0,
    revoked: false,
  };

  private db: OpenDatabase | null = null;
  private syncCreds: { url: string; token: string | null } | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  // --- React integration ---------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.version;

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // --- Lifecycle -----------------------------------------------------------

  async boot(): Promise<void> {
    try {
      const program = await secure.get(K.program);
      this.failures = Number((await secure.get(K.failures)) ?? '0') || 0;
      this.status = program ? 'locked' : 'welcome';
    } catch (e) {
      this.bootError = (e as Error).message;
      this.status = 'welcome';
    }
    this.emit();
  }

  get programName(): string {
    if (this.ledger.hasConfig('programName')) return this.ledger.config().programName;
    return this.fallbackName ?? this.ledger.config().programName;
  }
  private fallbackName: string | null = null;

  get config(): ProgramConfig {
    return this.ledger.config();
  }

  get fingerprint(): string {
    return this.keys ? programFingerprint(this.keys) : '';
  }

  private async provision(programId: string, secret: Uint8Array, pin: string, name: string): Promise<void> {
    if (!PIN_RE.test(pin)) throw new Error('PIN must be 4 to 8 digits');
    // Start from a clean slate in case an earlier setup was interrupted.
    await destroyDatabase();
    await secure.set(K.program, JSON.stringify({ programId, secret: toBase64Url(secret) }));
    await secure.set(K.dbKey, toHex(randomBytes(32)));
    await secure.set(K.device, uuid());
    await secure.set(K.pin, await hashPin(pin));
    await secure.set(K.programName, name);
    await secure.set(K.failures, '0');
    await secure.del(K.duress);
  }

  async createProgram(opts: { programName: string; templateId: string; pin: string }): Promise<void> {
    const name = opts.programName.trim();
    if (!name) throw new Error('Give your program a name');
    const { programId, secret } = generateProgram();
    await secure.del(K.sync);
    await this.provision(programId, secret, opts.pin, name);
    await this.open();
    await this.setConfig('programName', name);
    await this.setConfig('templateId', opts.templateId);
  }

  async joinProgram(enrollment: Enrollment, pin: string): Promise<void> {
    await this.provision(enrollment.programId, enrollment.secret, pin, enrollment.programName);
    if (enrollment.serverUrl) {
      await secure.set(K.sync, JSON.stringify({ url: normalizeServerUrl(enrollment.serverUrl), token: null }));
    } else {
      await secure.del(K.sync);
    }
    await this.open();
  }

  private async open(): Promise<void> {
    const [programRaw, dbKey, device, name, syncRaw] = await Promise.all([
      secure.get(K.program),
      secure.get(K.dbKey),
      secure.get(K.device),
      secure.get(K.programName),
      secure.get(K.sync),
    ]);
    if (!programRaw || !dbKey || !device) throw new Error('This device is not set up.');
    const program = JSON.parse(programRaw) as { programId: string; secret: string };
    this.keys = deriveProgramKeys(program.programId, fromBase64Url(program.secret));
    this.deviceId = device;
    this.fallbackName = name;
    this.db = await openDatabase(dbKey);
    this.ledger = new Ledger(await this.db.store.allEvents());
    const templates = await this.db.store.getMeta(META_TEMPLATES);
    this.importedTemplates = templates ? (JSON.parse(templates) as string[]) : [];
    this.syncCreds = syncRaw ? (JSON.parse(syncRaw) as { url: string; token: string | null }) : null;
    await this.refreshSyncState();
    this.status = 'ready';
    this.emit();
    this.scheduleSync(1_000);
  }

  async unlock(pin: string): Promise<UnlockResult> {
    const [pinVerifier, duressVerifier] = await Promise.all([secure.get(K.pin), secure.get(K.duress)]);
    if (duressVerifier && (await verifyPin(pin, duressVerifier))) {
      // Duress PIN: silently erase everything. The app then looks freshly installed.
      await this.wipe(null);
      return { ok: false, wiped: true };
    }
    if (await verifyPin(pin, pinVerifier)) {
      this.failures = 0;
      await secure.set(K.failures, '0');
      try {
        await this.open();
      } catch (e) {
        this.status = 'locked';
        this.emit();
        return { ok: false, error: (e as Error).message };
      }
      return { ok: true };
    }
    this.failures++;
    await secure.set(K.failures, String(this.failures));
    if (this.failures >= MAX_PIN_ATTEMPTS) {
      await this.wipe(`Kitcount was wiped after ${MAX_PIN_ATTEMPTS} wrong PIN attempts.`);
      return { ok: false, wiped: true };
    }
    this.emit();
    return { ok: false, remaining: MAX_PIN_ATTEMPTS - this.failures };
  }

  private async closeDb(): Promise<void> {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    const db = this.db;
    this.db = null;
    if (db) await db.close().catch(() => undefined);
    this.keys = null;
    this.ledger = new Ledger();
    this.importedTemplates = [];
    this.syncCreds = null;
    // A sync interrupted by locking must not leave the "running" guard set.
    this.sync = { ...this.sync, running: false };
    clearExports();
  }

  async lock(): Promise<void> {
    if (this.status !== 'ready') return;
    await this.closeDb();
    this.status = 'locked';
    this.emit();
  }

  /**
   * Panic wipe: closes and deletes the encrypted database, then deletes every
   * key from the keystore. Without the keys any surviving copy of the
   * database file is unreadable.
   */
  async wipe(notice: string | null = 'This device was wiped. No Kitcount data remains on it.'): Promise<void> {
    await this.closeDb();
    await destroyDatabase();
    await Promise.all(Object.values(K).map((k) => secure.del(k).catch(() => undefined)));
    this.failures = 0;
    this.deviceId = '';
    this.fallbackName = null;
    this.sync = { configured: false, url: null, running: false, lastAt: null, lastError: null, pending: 0, rejected: 0, revoked: false };
    this.wipeNotice = notice;
    this.status = 'welcome';
    this.emit();
  }

  // --- Recording -----------------------------------------------------------

  private requireReady(): { db: OpenDatabase; keys: ProgramKeys } {
    if (this.status !== 'ready' || !this.db || !this.keys) throw new Error('Kitcount is locked');
    return { db: this.db, keys: this.keys };
  }

  async record<T extends NewEvent>(body: T, at = new Date()): Promise<KitEvent> {
    const { db } = this.requireReady();
    const event = createEvent(this.deviceId, body, at) as unknown as KitEvent;
    await db.store.appendLocal([event]);
    this.ledger.apply([event]);
    this.sync.pending++;
    this.emit();
    this.scheduleSync(15_000);
    return event;
  }

  /** Hash a participant code with the program key (never stored in plaintext). */
  participantHash(code: string): string {
    const { keys } = this.requireReady();
    return hashCode(keys.codeKey, code);
  }

  async logVisit(input: VisitInput): Promise<VisitLogged> {
    let participant: string | null = null;
    if (input.code !== null) {
      const check = checkCode(input.code, this.config.codePattern || undefined);
      if (!check.ok) throw new Error(check.reason);
      participant = this.participantHash(check.normalized);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.out)) if (v > 0) out[k] = v;
    return (await this.record({
      type: 'visit.logged',
      participant,
      out,
      syringesIn: input.syringesIn,
      reversals: input.reversals,
      referrals: input.referrals,
      secondary: input.secondary,
    })) as VisitLogged;
  }

  voidVisit(visitId: string) {
    return this.record({ type: 'visit.voided', visit: visitId });
  }

  receiveStock(supply: string, qty: number) {
    return this.record({ type: 'stock.received', supply, qty });
  }

  adjustStock(supply: string, delta: number, reason: AdjustReason) {
    return this.record({ type: 'stock.adjusted', supply, delta, reason });
  }

  /** Records a physical count as an adjustment against this device's stock. */
  async countStock(supply: string, counted: number): Promise<number> {
    const current = this.ledger.onHand(this.deviceId)[supply] ?? 0;
    const delta = counted - current;
    if (delta !== 0) await this.adjustStock(supply, delta, 'count');
    return delta;
  }

  setConfig<KK extends ConfigKey>(key: KK, value: ProgramConfig[KK]) {
    return this.record({ type: 'config.set', key, value } as NewEvent);
  }

  // --- PINs ----------------------------------------------------------------

  async checkPin(pin: string): Promise<boolean> {
    return verifyPin(pin, await secure.get(K.pin));
  }

  async changePin(current: string, next: string): Promise<void> {
    if (!(await this.checkPin(current))) throw new Error('Current PIN is wrong');
    const duress = await secure.get(K.duress);
    if (duress && (await verifyPin(next, duress))) throw new Error('New PIN must differ from the duress PIN');
    await secure.set(K.pin, await hashPin(next));
  }

  async hasDuressPin(): Promise<boolean> {
    return !!(await secure.get(K.duress));
  }

  async setDuressPin(pin: string | null): Promise<void> {
    if (pin === null) {
      await secure.del(K.duress);
      return;
    }
    if (await this.checkPin(pin)) throw new Error('The duress PIN must be different from your PIN');
    await secure.set(K.duress, await hashPin(pin));
  }

  enrollmentCode(): string {
    const { keys } = this.requireReady();
    return encodeEnrollment({
      programId: keys.programId,
      secret: keys.secret,
      programName: this.programName,
      templateId: this.config.templateId,
      serverUrl: this.syncCreds?.url ?? undefined,
    });
  }

  // --- Report templates ----------------------------------------------------

  async importTemplate(yaml: string): Promise<ReportTemplate> {
    const { db } = this.requireReady();
    const template = parseTemplate(yaml);
    const others = this.importedTemplates.filter((y) => {
      try {
        return parseTemplate(y).id !== template.id;
      } catch {
        return false;
      }
    });
    this.importedTemplates = [...others, yaml];
    await db.store.setMeta(META_TEMPLATES, JSON.stringify(this.importedTemplates));
    this.emit();
    return template;
  }

  async removeTemplate(id: string): Promise<void> {
    const { db } = this.requireReady();
    this.importedTemplates = this.importedTemplates.filter((y) => {
      try {
        return parseTemplate(y).id !== id;
      } catch {
        return false;
      }
    });
    await db.store.setMeta(META_TEMPLATES, JSON.stringify(this.importedTemplates));
    this.emit();
  }

  // --- Sync ----------------------------------------------------------------

  private async refreshSyncState(): Promise<void> {
    const store = this.db?.store;
    this.sync = {
      ...this.sync,
      configured: !!this.syncCreds?.token,
      url: this.syncCreds?.url ?? null,
      lastAt: store ? await store.getMeta(META.syncLastAt) : null,
      lastError: store ? await store.getMeta(META.syncLastError) : null,
      pending: store ? await store.pendingCount() : 0,
      rejected: store ? Number((await store.getMeta(META.syncRejected)) ?? '0') || 0 : 0,
    };
  }

  /** Validates the server and token, then saves them. Returns the server's name for this device. */
  async configureSync(url: string, token: string): Promise<string> {
    this.requireReady();
    const normalized = normalizeServerUrl(url);
    const t = token.trim();
    if (!t) throw new SyncError('config', 'Paste the device token from your administrator');
    const info = await new HttpTransport(normalized, t).whoami();
    this.syncCreds = { url: normalized, token: t };
    await secure.set(K.sync, JSON.stringify(this.syncCreds));
    this.sync.revoked = false;
    await this.refreshSyncState();
    this.emit();
    void this.syncNow();
    return info.device.name;
  }

  async disconnectSync(): Promise<void> {
    this.syncCreds = null;
    await secure.del(K.sync);
    await this.refreshSyncState();
    this.emit();
  }

  scheduleSync(delayMs: number): void {
    if (!this.syncCreds?.token || this.status !== 'ready') return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow();
    }, delayMs);
  }

  async syncNow(): Promise<void> {
    if (this.status !== 'ready' || !this.db || !this.keys || !this.syncCreds?.token || this.sync.running) return;
    const { store } = this.db;
    this.sync = { ...this.sync, running: true };
    this.emit();
    try {
      const result = await syncOnce({ store, keys: this.keys, transport: new HttpTransport(this.syncCreds.url, this.syncCreds.token) });
      this.ledger.apply(result.received);
      this.sync.revoked = false;
    } catch (e) {
      const err = e as SyncError;
      if (err instanceof SyncError && err.kind === 'wipe') {
        await this.wipe('An administrator remotely wiped this device. No Kitcount data remains on it.');
        return;
      }
      if (err instanceof SyncError && (err.kind === 'revoked' || err.kind === 'unauthorized')) this.sync.revoked = true;
      await store.setMeta(META.syncLastError, err.message ?? 'Sync failed').catch(() => undefined);
    }
    if (this.db?.store !== store) return; // locked or wiped meanwhile
    await this.refreshSyncState();
    this.sync.running = false;
    this.emit();
  }

  // --- Demo (browser build and screenshots) ---------------------------------

  async startDemo(
    events: (keys: ProgramKeys, deviceId: string) => KitEvent[],
    local: (keys: ProgramKeys, deviceId: string) => KitEvent[],
  ): Promise<void> {
    await this.createProgram({ programName: 'Harbor Harm Reduction', templateId: 'generic-monthly', pin: DEMO_PIN });
    const { db, keys } = this.requireReady();
    const remote = events(keys, this.deviceId);
    await db.store.appendRemote(remote);
    const mine = local(keys, this.deviceId);
    await db.store.appendLocal(mine);
    this.ledger.apply([...remote, ...mine]);
    await db.store.setMeta(META.syncLastAt, new Date(Date.now() - 26 * 60_000).toISOString());
    this.syncCreds = { url: 'https://sync.harbor-hr.example', token: null };
    await this.refreshSyncState();
    this.sync.configured = true;
    this.emit();
  }
}

export const session = new Session();
