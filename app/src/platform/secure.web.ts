/**
 * The browser build is a demo only: secrets are kept in memory and vanish on
 * reload. Never use the web build with real participant data.
 */
const memory = new Map<string, string>();

export const secure = {
  get: async (key: string) => memory.get(key) ?? null,
  set: async (key: string, value: string) => {
    memory.set(key, value);
  },
  del: async (key: string) => {
    memory.delete(key);
  },
};

export const SECURE_PERSISTENT = false;
