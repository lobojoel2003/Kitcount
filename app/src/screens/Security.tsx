import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { MAX_PIN_ATTEMPTS } from '../state/session';
import { useSession } from '../state/KitcountProvider';
import { Banner, Body, Button, Card, Divider, ListRow, Screen, SectionTitle } from '../ui/components';
import { PinPad } from '../ui/PinPad';
import { font, space, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';
import { PinSetup } from './PinSetup';

type Mode = { kind: 'menu' } | { kind: 'verify'; next: 'change' | 'duress' } | { kind: 'change'; current: string } | { kind: 'duress' };

export function Security() {
  const s = useSession();
  const t = useTheme();
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  const [hasDuress, setHasDuress] = useState(false);
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);

  useEffect(() => {
    void s.hasDuressPin().then(setHasDuress);
  }, [s, mode]);

  if (mode.kind === 'verify') {
    return (
      <Screen>
        <Body muted style={{ textAlign: 'center', marginBottom: space.xl }}>
          Enter your current PIN
        </Body>
        <PinPad
          value={pin}
          onChange={setPin}
          shakeKey={shake}
          onSubmit={async (p) => {
            setPin('');
            if (!(await s.checkPin(p))) return setShake((n) => n + 1);
            setMode(mode.next === 'change' ? { kind: 'change', current: p } : { kind: 'duress' });
          }}
        />
      </Screen>
    );
  }
  if (mode.kind === 'change') {
    return (
      <Screen>
        <PinSetup
          title="New PIN"
          subtitle="Choose a new 6-digit PIN."
          onDone={async (next) => {
            try {
              await s.changePin(mode.current, next);
              showToast('PIN changed', { icon: 'check-circle' });
            } catch (e) {
              showToast((e as Error).message, { icon: 'alert-circle' });
            }
            setMode({ kind: 'menu' });
          }}
        />
      </Screen>
    );
  }
  if (mode.kind === 'duress') {
    return (
      <Screen>
        <PinSetup
          title="Duress PIN"
          subtitle="Entering this PIN on the lock screen silently erases everything and shows a fresh install."
          onDone={async (p) => {
            try {
              await s.setDuressPin(p);
              showToast('Duress PIN set', { icon: 'shield-check' });
            } catch (e) {
              showToast((e as Error).message, { icon: 'alert-circle' });
            }
            setMode({ kind: 'menu' });
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card style={{ paddingVertical: space.xs }}>
        <ListRow icon="form-textbox-password" title="Change PIN" onPress={() => setMode({ kind: 'verify', next: 'change' })} />
        <Divider />
        <ListRow
          icon="incognito"
          title={hasDuress ? 'Change duress PIN' : 'Set a duress PIN'}
          subtitle={hasDuress ? 'Active' : 'Off'}
          onPress={() => setMode({ kind: 'verify', next: 'duress' })}
        />
      </Card>
      {hasDuress && (
        <Button
          kind="secondary"
          label="Turn off duress PIN"
          onPress={async () => {
            await s.setDuressPin(null);
            setHasDuress(false);
            showToast('Duress PIN removed', { icon: 'shield-off-outline' });
          }}
        />
      )}
      <SectionTitle>Protections on this device</SectionTitle>
      <Banner
        tone="info"
        icon="database-lock"
        title="Encrypted database"
        body="All records are stored with SQLCipher (AES-256). The key lives in the phone's secure hardware keystore."
      />
      <Banner
        tone="info"
        icon="timer-lock-outline"
        title="Auto-lock"
        body="Kitcount locks after one minute in the background and clears exported files."
      />
      <Banner
        tone="info"
        icon="cellphone-screenshot"
        title="No screenshots"
        body="Screenshots, screen recording and app-switcher previews are blocked."
      />
      <Banner
        tone="info"
        icon="shield-alert-outline"
        title={`Wipe after ${MAX_PIN_ATTEMPTS} wrong PINs`}
        body="Repeated wrong PINs erase the database and keys."
      />
      <Text style={{ color: t.textMuted, fontSize: font.small, marginTop: space.sm }}>
        Administrators can also remotely wipe a lost device from the sync server. It erases itself the next time it connects.
      </Text>
    </Screen>
  );
}
