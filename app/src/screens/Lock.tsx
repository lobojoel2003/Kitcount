import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_PIN_ATTEMPTS } from '../state/session';
import { useSession } from '../state/KitcountProvider';
import { Banner, Body, HoldButton } from '../ui/components';
import { Logo } from '../ui/Logo';
import { PinPad } from '../ui/PinPad';
import { font, space, useTheme } from '../ui/theme';

export function Lock() {
  const s = useSession();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWipe, setShowWipe] = useState(false);

  const submit = async (value: string) => {
    setBusy(true);
    const result = await s.unlock(value);
    setBusy(false);
    setPin('');
    if (result.ok || result.wiped) return;
    if (result.error) {
      setError(result.error);
      return;
    }
    setShake((n) => n + 1);
  };

  const remaining = MAX_PIN_ATTEMPTS - s.failures;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.lg,
        paddingHorizontal: space.xl,
        alignItems: 'center',
      }}>
      <Logo size={56} />
      <Text style={{ color: t.text, fontSize: font.heading, fontWeight: '900', marginTop: space.md }}>Kitcount is locked</Text>
      <Body muted style={{ marginTop: space.xs, marginBottom: space.xl }}>
        {busy ? 'Unlocking…' : 'Enter your PIN'}
      </Body>
      {error && <Banner tone="danger" icon="database-alert" title="Could not open the encrypted database" body={error} />}
      {s.failures >= 3 && remaining > 0 && (
        <Banner
          tone={remaining <= 3 ? 'danger' : 'warning'}
          icon="shield-alert"
          title={`${remaining} ${remaining === 1 ? 'try' : 'tries'} left`}
          body="This device erases all Kitcount data after too many wrong PINs."
        />
      )}
      <PinPad value={pin} onChange={setPin} onSubmit={submit} shakeKey={shake} disabled={busy} />
      <View style={{ flex: 1 }} />
      {showWipe ? (
        <View style={{ alignSelf: 'stretch', gap: space.sm }}>
          <HoldButton label="Hold to wipe this device" holdingLabel="Keep holding to erase…" onConfirm={() => void s.wipe()} />
          <Text onPress={() => setShowWipe(false)} style={{ color: t.textMuted, textAlign: 'center', padding: space.sm }}>
            Cancel
          </Text>
        </View>
      ) : (
        <Text
          accessibilityRole="button"
          onPress={() => setShowWipe(true)}
          style={{ color: t.textMuted, fontWeight: '700', padding: space.md }}>
          Emergency wipe
        </Text>
      )}
    </View>
  );
}
