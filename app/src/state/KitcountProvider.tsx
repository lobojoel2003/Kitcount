import * as ScreenCapture from 'expo-screen-capture';
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { installRandomSource } from '../platform/random';
import { AUTO_LOCK_MS, session, type Session } from './session';

installRandomSource();

const SessionContext = createContext<Session>(session);

const SYNC_INTERVAL_MS = 3 * 60_000;

export function KitcountProvider({ children }: { children: ReactNode }) {
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    void session.boot();
  }, []);

  // Block screenshots, screen recording and app-switcher previews on device.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenCapture.preventScreenCaptureAsync('kitcount').catch(() => undefined);
    return () => {
      ScreenCapture.allowScreenCaptureAsync('kitcount').catch(() => undefined);
    };
  }, []);

  // Auto-lock after a minute in the background; try to sync when we come back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundAt.current ??= Date.now();
        return;
      }
      if (state === 'active') {
        const since = backgroundAt.current;
        backgroundAt.current = null;
        if (since !== null && Date.now() - since > AUTO_LOCK_MS) void session.lock();
        else session.scheduleSync(2_000);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const id = setInterval(() => session.scheduleSync(0), SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** The session, re-rendering the caller whenever its state changes. */
export function useSession(): Session {
  const s = useContext(SessionContext);
  useSyncExternalStore(s.subscribe, s.getSnapshot, s.getSnapshot);
  return s;
}
