import Constants from 'expo-constants';

/** Version metadata injected by app.config.ts from /VERSION and CI. */
export function buildInfo(): { version: string; build: string; commit: string } {
  const cfg = Constants.expoConfig;
  const extra = (cfg?.extra ?? {}) as { buildNumber?: string; commit?: string };
  return {
    version: cfg?.version ?? '0.0.0',
    build: String(extra.buildNumber ?? '0'),
    commit: String(extra.commit ?? 'dev').slice(0, 7),
  };
}
