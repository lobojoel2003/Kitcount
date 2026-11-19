import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useSession } from '../state/KitcountProvider';
import { Icon } from '../ui/Icon';
import { font, radius, useTheme } from '../ui/theme';

/** Compact sync status: pending uploads, offline, or synced. Tap for details. */
export function SyncBadge() {
  const s = useSession();
  const t = useTheme();
  const { configured, running, pending, lastError, revoked } = s.sync;
  let icon: React.ComponentProps<typeof Icon>['name'] = 'cloud-off-outline';
  let color = t.textMuted;
  let label = 'Local';
  if (configured) {
    if (revoked) {
      icon = 'cloud-alert';
      color = t.danger;
      label = 'Revoked';
    } else if (lastError) {
      icon = 'cloud-off-outline';
      color = t.warning;
      label = pending > 0 ? `${pending}` : 'Offline';
    } else if (pending > 0) {
      icon = 'cloud-upload-outline';
      color = t.info;
      label = `${pending}`;
    } else {
      icon = 'cloud-check-outline';
      color = t.success;
      label = 'Synced';
    }
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${label}${pending ? `, ${pending} waiting to upload` : ''}`}
      onPress={() => router.push('/sync')}
      style={[styles.badge, { backgroundColor: t.surface, borderColor: t.border }]}>
      {running ? <ActivityIndicator size="small" color={t.primary} /> : <Icon name={icon} size={18} color={color} />}
      <Text style={{ color, fontWeight: '800', fontSize: font.tiny }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    height: 32,
    marginRight: 4,
  },
});
