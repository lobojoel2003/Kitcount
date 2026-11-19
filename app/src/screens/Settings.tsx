import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { buildInfo } from '../platform/buildInfo';
import { useSession } from '../state/KitcountProvider';
import { Card, Divider, HoldButton, ListRow, Screen, SectionTitle } from '../ui/components';
import { formatNumber, timeAgo } from '../ui/format';
import { Logo } from '../ui/Logo';
import { font, space, useTheme } from '../ui/theme';

export function Settings() {
  const s = useSession();
  const t = useTheme();
  const info = buildInfo();
  const sync = s.sync;
  const syncSubtitle = !sync.configured
    ? 'Not connected — data stays on this device'
    : sync.revoked
      ? 'This device was revoked'
      : sync.lastError
        ? `Offline · ${formatNumber(sync.pending)} waiting`
        : sync.lastAt
          ? `Synced ${timeAgo(sync.lastAt)}${sync.pending ? ` · ${formatNumber(sync.pending)} waiting` : ''}`
          : 'Connected';

  return (
    <Screen>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Logo size={52} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: font.title, fontWeight: '900' }} numberOfLines={1}>
            {s.programName}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: font.small }}>
            Fingerprint {s.fingerprint} · {formatNumber(s.ledger.visits().length)} visits
          </Text>
        </View>
      </Card>

      <SectionTitle>Program</SectionTitle>
      <Card style={{ paddingVertical: space.xs }}>
        <ListRow icon="cellphone-link" title="Add a device" subtitle="Show the enrollment QR code" onPress={() => router.push('/share')} />
        <Divider />
        <ListRow icon="cloud-sync-outline" title="Sync" subtitle={syncSubtitle} onPress={() => router.push('/sync')} />
        <Divider />
        <ListRow
          icon="package-variant"
          title="Supplies & referrals"
          subtitle="Tiles, tap amounts, warning levels"
          onPress={() => router.push('/supplies')}
        />
        <Divider />
        <ListRow
          icon="card-account-details-outline"
          title="Program details"
          subtitle="Name, participant code format, default report"
          onPress={() => router.push('/program')}
        />
        <Divider />
        <ListRow icon="history" title="Visit history" subtitle="Review or undo recent visits" onPress={() => router.push('/history')} />
      </Card>

      <SectionTitle>Security</SectionTitle>
      <Card style={{ paddingVertical: space.xs }}>
        <ListRow
          icon="shield-lock-outline"
          title="PIN & duress PIN"
          subtitle="Change PIN, set a PIN that silently wipes"
          onPress={() => router.push('/security')}
        />
        <Divider />
        <ListRow
          icon="lock-outline"
          title="Lock now"
          subtitle="Also locks after 1 minute in the background"
          onPress={() => void s.lock()}
        />
      </Card>
      <HoldButton label="Panic wipe — hold 3 seconds" holdingLabel="Erasing in a moment…" ms={3000} onConfirm={() => void s.wipe()} />
      <Text style={{ color: t.textMuted, fontSize: font.small, marginTop: space.sm, marginBottom: space.md }}>
        Deletes the encrypted database and every key on this phone. Unsynced visits are lost. Synced data stays on the server, encrypted.
      </Text>

      <SectionTitle>About</SectionTitle>
      <Card style={{ paddingVertical: space.xs }}>
        <ListRow
          icon="information-outline"
          title="About Kitcount"
          subtitle={`Version ${info.version} (build ${info.build})`}
          onPress={() => router.push('/about')}
        />
      </Card>
    </Screen>
  );
}
