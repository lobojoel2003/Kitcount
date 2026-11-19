import type { KitEvent } from '../domain/events';
import type { EventStore } from './types';

/** Non-persistent store for tests and the browser demo. */
export class MemoryStore implements EventStore {
  private readonly events = new Map<string, { event: KitEvent; synced: boolean; seq: number }>();
  private readonly meta = new Map<string, string>();
  private seq = 0;

  async appendLocal(events: KitEvent[]): Promise<void> {
    for (const event of events) {
      if (!this.events.has(event.id)) this.events.set(event.id, { event, synced: false, seq: this.seq++ });
    }
  }

  async appendRemote(events: KitEvent[]): Promise<number> {
    let n = 0;
    for (const event of events) {
      if (this.events.has(event.id)) continue;
      this.events.set(event.id, { event, synced: true, seq: this.seq++ });
      n++;
    }
    return n;
  }

  async allEvents(): Promise<KitEvent[]> {
    return Array.from(this.events.values())
      .sort((a, b) => a.seq - b.seq)
      .map((e) => e.event);
  }

  async pending(limit: number): Promise<KitEvent[]> {
    return Array.from(this.events.values())
      .filter((e) => !e.synced)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map((e) => e.event);
  }

  async pendingCount(): Promise<number> {
    let n = 0;
    for (const e of this.events.values()) if (!e.synced) n++;
    return n;
  }

  async markSynced(ids: string[]): Promise<void> {
    for (const id of ids) {
      const e = this.events.get(id);
      if (e) e.synced = true;
    }
  }

  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    if (value === null) this.meta.delete(key);
    else this.meta.set(key, value);
  }
}
