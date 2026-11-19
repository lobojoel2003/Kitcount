/**
 * HTTP transport for the Kitcount sync protocol (docs/sync-protocol.md).
 * The server only ever sees opaque, encrypted blobs.
 */

export interface RemoteRecord {
  seq: number;
  id: string;
  device: string;
  blob: string;
}

export interface PullPage {
  events: RemoteRecord[];
  next: number;
  more: boolean;
}

export interface PushResult {
  accepted: number;
  duplicates: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
}

export interface ServerInfo {
  device: DeviceInfo;
  server: { version: string; build?: string };
}

export interface SyncTransport {
  whoami(): Promise<ServerInfo>;
  push(records: { id: string; blob: string }[]): Promise<PushResult>;
  pull(after: number, limit: number): Promise<PullPage>;
}

export type SyncErrorKind =
  | 'offline'
  | 'timeout'
  | 'unauthorized'
  | 'revoked'
  | 'wipe'
  | 'rejected'
  | 'server'
  | 'protocol'
  | 'config';

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function normalizeServerUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SyncError('config', 'Server address is not a valid URL');
  }
  const isLocal = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    throw new SyncError('config', 'Use an https:// address (plain http is only allowed on a local network)');
  }
  return url;
}

export class HttpTransport implements SyncTransport {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly timeoutMs = 20_000,
  ) {
    this.base = normalizeServerUrl(baseUrl);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new SyncError('timeout', 'The sync server did not answer in time');
      throw new SyncError('offline', 'Could not reach the sync server');
    } finally {
      clearTimeout(timer);
    }

    let payload: { error?: string; message?: string } & Record<string, unknown> = {};
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (res.ok) throw new SyncError('protocol', 'The server sent an unreadable response', res.status);
      }
    }
    if (res.ok) return payload as T;

    const code = typeof payload.error === 'string' ? payload.error : '';
    const msg = typeof payload.message === 'string' ? payload.message : `HTTP ${res.status}`;
    if (res.status === 410 || code === 'device_wipe') throw new SyncError('wipe', 'This device was remotely wiped by an administrator', res.status);
    if (code === 'device_revoked') throw new SyncError('revoked', 'This device has been revoked by an administrator', res.status);
    if (res.status === 401 || res.status === 403) throw new SyncError('unauthorized', 'The device token was not accepted', res.status);
    if (res.status === 400 || res.status === 413 || res.status === 422) throw new SyncError('rejected', msg, res.status);
    if (res.status === 429) throw new SyncError('server', 'The server is busy; try again shortly', res.status);
    throw new SyncError('server', msg, res.status);
  }

  async whoami(): Promise<ServerInfo> {
    const r = await this.request<ServerInfo>('GET', '/v1/whoami');
    if (!r?.device?.id) throw new SyncError('protocol', 'Unexpected whoami response');
    return r;
  }

  async push(records: { id: string; blob: string }[]): Promise<PushResult> {
    const r = await this.request<PushResult>('POST', '/v1/events', { events: records });
    if (typeof r?.accepted !== 'number' || typeof r?.duplicates !== 'number') {
      throw new SyncError('protocol', 'Unexpected push response');
    }
    return r;
  }

  async pull(after: number, limit: number): Promise<PullPage> {
    const r = await this.request<PullPage>('GET', `/v1/events?after=${encodeURIComponent(String(after))}&limit=${limit}`);
    if (!Array.isArray(r?.events) || typeof r.next !== 'number' || typeof r.more !== 'boolean') {
      throw new SyncError('protocol', 'Unexpected pull response');
    }
    return r;
  }
}
