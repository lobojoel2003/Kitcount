import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { decodeEnrollment, programFingerprint, type Enrollment } from '../core/crypto/keys';
import { bundledTemplates } from '../core/reports/registry';
import { demoHistory, demoToday } from '../demo/seed';
import { useSession } from '../state/KitcountProvider';
import { Banner, Body, Button, Card, Chip, Field, Title } from '../ui/components';
import { Icon, type IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { font, radius, space, useTheme } from '../ui/theme';
import { PinSetup } from './PinSetup';

type Step =
  | { kind: 'intro' }
  | { kind: 'create' }
  | { kind: 'join' }
  | { kind: 'scan' }
  | { kind: 'confirm'; enrollment: Enrollment }
  | { kind: 'pin'; mode: 'create' | 'join'; enrollment?: Enrollment };

function Feature({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const t = useTheme();
  return (
    <View style={styles.feature}>
      <View style={[styles.featureIcon, { backgroundColor: t.primarySoft }]}>
        <Icon name={icon} size={22} color={t.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.body }}>{title}</Text>
        <Text style={{ color: t.textMuted, fontSize: font.small, lineHeight: 20, marginTop: 2 }}>{body}</Text>
      </View>
    </View>
  );
}

export function Welcome() {
  const s = useSession();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('generic-monthly');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const tryCode = (text: string) => {
    try {
      const enrollment = decodeEnrollment(text);
      setError(null);
      setStep({ kind: 'confirm', enrollment });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const finish = async (pin: string) => {
    if (step.kind !== 'pin') return;
    setBusy(true);
    try {
      if (step.mode === 'create') await s.createProgram({ programName: name, templateId, pin });
      else if (step.enrollment) await s.joinProgram(step.enrollment, pin);
    } catch (e) {
      setError((e as Error).message);
      setStep({ kind: step.mode === 'create' ? 'create' : 'join' });
    } finally {
      setBusy(false);
    }
  };

  const back = (to: Step) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        setError(null);
        setStep(to);
      }}
      hitSlop={12}
      style={styles.back}>
      <Icon name="arrow-left" size={24} color={t.text} />
      <Text style={{ color: t.text, fontWeight: '700', fontSize: font.body }}>Back</Text>
    </Pressable>
  );

  let content: React.ReactNode;
  switch (step.kind) {
    case 'intro':
      content = (
        <>
          <View style={{ alignItems: 'center', marginTop: space.xl, marginBottom: space.xl }}>
            <Logo size={84} />
            <Text style={[styles.brand, { color: t.text }]}>Kitcount</Text>
            <Body muted style={{ textAlign: 'center', maxWidth: 320 }}>
              Fast, private visit logging and state reporting for syringe services programs.
            </Body>
          </View>
          {s.wipeNotice && <Banner tone="info" icon="shield-check" title="Device wiped" body={s.wipeNotice} />}
          <Card>
            <Feature
              icon="timer-outline"
              title="A visit in about 15 seconds"
              body="Enter the participant code, tap the supplies, done. Built for one hand."
            />
            <Feature
              icon="incognito"
              title="No names, ever"
              body="Codes are hashed with your program's key. The plaintext is never saved."
            />
            <Feature
              icon="cloud-off-outline"
              title="Works fully offline"
              body="Encrypted on the phone. Syncs end-to-end encrypted when you're back in range."
            />
            <Feature icon="file-chart" title="One-button state report" body="Pick your state's template and share a CSV or PDF." />
          </Card>
          <Button
            big
            label="Set up a new program"
            icon="plus-circle"
            onPress={() => setStep({ kind: 'create' })}
            style={{ marginTop: space.md }}
            testID="setup-new"
          />
          <Button
            big
            kind="secondary"
            label="Join with an enrollment code"
            icon="qrcode-scan"
            onPress={() => setStep({ kind: 'join' })}
            style={{ marginTop: space.md }}
          />
          {Platform.OS === 'web' && (
            <Button
              kind="ghost"
              label="Explore the demo with sample data"
              icon="play-circle-outline"
              busy={busy}
              testID="start-demo"
              onPress={async () => {
                setBusy(true);
                await s.startDemo(
                  (k, d) => demoHistory(k, d),
                  (k, d) => demoToday(k, d),
                );
                setBusy(false);
              }}
              style={{ marginTop: space.md }}
            />
          )}
        </>
      );
      break;

    case 'create':
      content = (
        <>
          {back({ kind: 'intro' })}
          <Title>New program</Title>
          <Body muted style={{ marginBottom: space.xl, marginTop: space.xs }}>
            This phone creates the program’s secret key. You’ll add other devices from Settings with a QR code.
          </Body>
          <Field
            label="Program name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Harbor Harm Reduction"
            autoCapitalize="words"
            maxLength={120}
            returnKeyType="done"
            error={error}
          />
          <Text style={[styles.label, { color: t.textMuted }]}>Default report</Text>
          <View style={styles.chips}>
            {bundledTemplates().map((e) => (
              <Chip
                key={e.template.id}
                label={e.template.name}
                selected={templateId === e.template.id}
                onPress={() => setTemplateId(e.template.id)}
              />
            ))}
          </View>
          <Button
            big
            label="Continue"
            icon="arrow-right"
            disabled={!name.trim()}
            onPress={() => setStep({ kind: 'pin', mode: 'create' })}
            style={{ marginTop: space.xl }}
          />
        </>
      );
      break;

    case 'join':
      content = (
        <>
          {back({ kind: 'intro' })}
          <Title>Join a program</Title>
          <Body muted style={{ marginBottom: space.xl, marginTop: space.xs }}>
            On a device that’s already set up, open Settings → Add a device. Scan its QR code, or paste the code it shows.
          </Body>
          {Platform.OS !== 'web' && (
            <Button
              big
              label="Scan QR code"
              icon="qrcode-scan"
              onPress={async () => {
                const p = permission?.granted ? permission : await requestPermission();
                if (p.granted) setStep({ kind: 'scan' });
                else setError('Camera access was denied. Paste the code instead.');
              }}
              style={{ marginBottom: space.lg }}
            />
          )}
          <Field
            label="Enrollment code"
            value={code}
            onChangeText={setCode}
            placeholder="kitcount:join:v1:…"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={{
              minHeight: 96,
              paddingTop: 14,
              fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
              fontSize: font.small,
            }}
            error={error}
          />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Button
              kind="secondary"
              label="Paste"
              icon="content-paste"
              onPress={async () => {
                const text = await Clipboard.getStringAsync();
                setCode(text);
                if (text) tryCode(text);
              }}
              style={{ flex: 1 }}
            />
            <Button label="Continue" icon="arrow-right" disabled={!code.trim()} onPress={() => tryCode(code)} style={{ flex: 1 }} />
          </View>
        </>
      );
      break;

    case 'scan':
      return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (data?.startsWith('kitcount:join:')) tryCode(data);
            }}
          />
          <View style={[styles.scanOverlay, { paddingTop: insets.top + space.lg }]}>
            <Text style={{ color: '#fff', fontSize: font.title, fontWeight: '800' }}>Point at the enrollment QR code</Text>
            <View style={styles.scanFrame} />
            <Button kind="secondary" label="Cancel" onPress={() => setStep({ kind: 'join' })} />
          </View>
        </View>
      );

    case 'confirm': {
      const e = step.enrollment;
      content = (
        <>
          {back({ kind: 'join' })}
          <Title>Join “{e.programName}”?</Title>
          <Body muted style={{ marginTop: space.xs, marginBottom: space.xl }}>
            Check that this fingerprint matches the one shown on the other device.
          </Body>
          <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
            <Text style={{ color: t.textMuted, fontSize: font.small, fontWeight: '700' }}>PROGRAM FINGERPRINT</Text>
            <Text
              style={{
                color: t.text,
                fontSize: font.display,
                fontWeight: '900',
                letterSpacing: 3,
                marginTop: space.sm,
                fontVariant: ['tabular-nums'],
              }}>
              {programFingerprint(e)}
            </Text>
            {e.serverUrl ? <Text style={{ color: t.textMuted, marginTop: space.md }}>Sync server: {e.serverUrl}</Text> : null}
          </Card>
          <Button
            big
            label="Fingerprints match"
            icon="check-decagram"
            onPress={() => setStep({ kind: 'pin', mode: 'join', enrollment: e })}
            style={{ marginTop: space.lg }}
          />
        </>
      );
      break;
    }

    case 'pin':
      content = (
        <>
          {back(step.mode === 'create' ? { kind: 'create' } : { kind: 'join' })}
          {busy ? (
            <View style={{ alignItems: 'center', paddingTop: 120, gap: space.lg }}>
              <Logo size={64} />
              <Body muted>Creating encrypted storage…</Body>
            </View>
          ) : (
            <PinSetup
              title="Choose a 6-digit PIN"
              subtitle="You'll enter it to open Kitcount. After 10 wrong tries the device wipes itself."
              onDone={finish}
            />
          )}
        </>
      );
      break;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.xl,
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.xxl,
          maxWidth: 560,
          width: '100%',
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled">
        {s.bootError && <Banner tone="danger" icon="alert-octagon" title="Secure storage is unavailable" body={s.bootError} />}
        {content}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: font.display + 4, fontWeight: '900', letterSpacing: -1, marginTop: space.md, marginBottom: space.xs },
  feature: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingVertical: space.sm },
  featureIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.lg, alignSelf: 'flex-start' },
  label: { fontSize: font.small, fontWeight: '700', marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  scanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingBottom: 60, paddingHorizontal: space.xl },
  scanFrame: { width: 250, height: 250, borderRadius: 24, borderWidth: 4, borderColor: '#fff' },
});
