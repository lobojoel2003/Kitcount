import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useSession } from '../state/KitcountProvider';
import { Banner, Body, Button, Card, Screen } from '../ui/components';
import { PinPad } from '../ui/PinPad';
import { font, space, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';

/** Shows the enrollment QR (contains the program secret) after re-entering the PIN. */
export function ShareDevice() {
  const s = useSession();
  const t = useTheme();
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);
  const [code, setCode] = useState<string | null>(null);

  if (!code) {
    return (
      <Screen>
        <Body muted style={{ textAlign: 'center', marginBottom: space.xl }}>
          The enrollment code contains your program’s secret key. Enter your PIN to show it.
        </Body>
        <PinPad
          value={pin}
          onChange={setPin}
          shakeKey={shake}
          onSubmit={async (p) => {
            if (await s.checkPin(p)) setCode(s.enrollmentCode());
            else {
              setShake((n) => n + 1);
              setPin('');
            }
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Banner
        tone="warning"
        icon="eye-off"
        title="Show this only to your own staff"
        body="Anyone who scans it can read your program's data from the sync server. Never photograph, print or send it."
      />
      <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
        <View style={{ padding: 14, backgroundColor: '#FFFFFF', borderRadius: 16 }}>
          <QRCode value={code} size={232} ecl="M" color="#0E211D" backgroundColor="#FFFFFF" />
        </View>
        <Text style={{ color: t.textMuted, fontSize: font.small, fontWeight: '700', marginTop: space.lg }}>PROGRAM FINGERPRINT</Text>
        <Text style={{ color: t.text, fontSize: font.heading, fontWeight: '900', letterSpacing: 3 }}>{s.fingerprint}</Text>
        <Text style={{ color: t.textMuted, fontSize: font.small, textAlign: 'center', marginTop: space.sm }}>
          On the new device choose “Join with an enrollment code” and check this fingerprint matches.
        </Text>
      </Card>
      <Button
        kind="secondary"
        label="Copy code instead"
        icon="content-copy"
        onPress={async () => {
          await Clipboard.setStringAsync(code);
          showToast('Copied. Paste it on the new device, then clear your clipboard.', { icon: 'content-copy', duration: 5000 });
        }}
      />
      <Text style={{ color: t.textMuted, fontSize: font.small, marginTop: space.lg }}>
        The new device still needs its own sync token from your administrator. Revoking a device on the server blocks it from syncing.
      </Text>
    </Screen>
  );
}
