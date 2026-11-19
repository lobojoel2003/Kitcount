import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { useSession } from '../state/KitcountProvider';
import { Banner, Body, Button, Card, Divider, Field, ListRow, Screen, SectionTitle } from '../ui/components';
import { formatNumber, timeAgo } from '../ui/format';
import { font, space, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';

export function SyncScreen() {
  const s = useSession();
  const t = useTheme();
  const sync = s.sync;
  const [url, setUrl] = useState(sync.url ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!sync.configured);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = await s.configureSync(url, token);
      setToken('');
      setEditing(false);
      showToast(`Connected as “${name}”`, { icon: 'cloud-check-outline' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: space.lg }}>
        Everything is encrypted on this phone with the program key before upload. The sync server stores only ciphertext and can’t read
        visits, supplies or codes.
      </Body>
      {sync.revoked && (
        <Banner tone="danger" icon="cloud-alert" title="This device was revoked" body="Ask your administrator for a new device token." />
      )}
      {sync.rejected > 0 && (
        <Banner
          tone="warning"
          icon="shield-alert"
          title={`${formatNumber(sync.rejected)} records could not be decrypted`}
          body="They were skipped. Another program may share this server, or data was tampered with."
        />
      )}

      {sync.configured && !editing ? (
        <>
          <Card style={{ paddingVertical: space.xs }}>
            <ListRow icon="server-security" title="Server" subtitle={sync.url ?? ''} />
            <Divider />
            <ListRow icon="clock-check-outline" title="Last sync" subtitle={sync.lastAt ? timeAgo(sync.lastAt) : 'Never'} />
            <Divider />
            <ListRow icon="cloud-upload-outline" title="Waiting to upload" subtitle={`${formatNumber(sync.pending)} events`} />
          </Card>
          {sync.lastError && <Banner tone="warning" icon="cloud-off-outline" title="Last attempt failed" body={sync.lastError} />}
          <Button
            big
            label={sync.running ? 'Syncing…' : 'Sync now'}
            icon="sync"
            busy={sync.running}
            onPress={() => void s.syncNow()}
            style={{ marginTop: space.md }}
          />
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
            <Button kind="secondary" label="Change server" onPress={() => setEditing(true)} style={{ flex: 1 }} />
            <Button
              kind="secondary"
              label="Disconnect"
              onPress={() => {
                const go = () => void s.disconnectSync();
                if (Platform.OS === 'web') go();
                else
                  Alert.alert('Disconnect sync?', 'Data stays on this phone. You can reconnect later with a token.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Disconnect', style: 'destructive', onPress: go },
                  ]);
              }}
              style={{ flex: 1 }}
            />
          </View>
        </>
      ) : (
        <Card>
          <Field
            label="Server address"
            value={url}
            onChangeText={setUrl}
            placeholder="https://sync.example.org"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Field
            label="Device token"
            value={token}
            onChangeText={setToken}
            placeholder="kc_dev_…"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            hint="Your administrator creates one per device with: kitcount-server device add -name “Van 1”"
            error={error}
          />
          <Button big label="Connect" icon="lan-connect" busy={busy} disabled={!url.trim() || !token.trim()} onPress={connect} />
        </Card>
      )}

      <SectionTitle>How sync works</SectionTitle>
      <Text style={{ color: t.textMuted, fontSize: font.small, lineHeight: 20 }}>
        Kitcount tries to sync every few minutes and whenever you open the app. Nothing is lost offline: visits queue on the phone until the
        server is reachable. Each device keeps its own inventory; reports combine every device.
      </Text>
    </Screen>
  );
}
