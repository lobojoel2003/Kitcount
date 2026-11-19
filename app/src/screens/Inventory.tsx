import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../state/KitcountProvider';
import { Badge, Banner, Card, Screen, SectionTitle, Segmented } from '../ui/components';
import { formatNumber, plural } from '../ui/format';
import { Icon, supplyGlyph } from '../ui/Icon';
import { font, radius, space, supplyTint, useTheme } from '../ui/theme';

export function Inventory() {
  const s = useSession();
  const t = useTheme();
  const [scope, setScope] = useState<'device' | 'program'>('device');
  const levels = s.ledger.stockLevels(scope === 'device' ? s.deviceId : undefined);
  const low = levels.filter((l) => l.low);
  const critical = low.filter((l) => l.supply.critical);

  return (
    <Screen>
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { value: 'device', label: 'This device' },
          { value: 'program', label: 'Whole program' },
        ]}
      />
      <View style={{ height: space.lg }} />
      {critical.length > 0 ? (
        <Banner
          tone="danger"
          icon="alert-octagon"
          title={`${critical.map((c) => c.supply.short).join(' and ')} below the warning level`}
          body="Restock before the next outreach shift. Tap a supply to record a delivery."
        />
      ) : low.length > 0 ? (
        <Banner
          tone="warning"
          icon="alert"
          title={`${plural(low.length, 'supply', 'supplies')} running low`}
          body={low.map((l) => l.supply.short).join(', ')}
        />
      ) : (
        <Banner
          tone="success"
          icon="check-circle"
          title="Stock levels look good"
          body="Kitcount warns you here and on the Log screen before anything runs out."
        />
      )}
      <SectionTitle>{scope === 'device' ? 'On this device' : 'Across all devices'}</SectionTitle>
      <Card style={{ paddingVertical: space.xs }}>
        {levels.map((l, i) => {
          const tint = supplyTint(l.supply.icon, t);
          const ratio = l.supply.lowAt > 0 ? Math.min(1, l.onHand / (l.supply.lowAt * 4)) : 1;
          return (
            <Pressable
              key={l.supply.id}
              accessibilityRole="button"
              accessibilityLabel={`${l.supply.name}: ${l.onHand} ${l.supply.unit} on hand${l.low ? ', low' : ''}`}
              disabled={scope !== 'device'}
              onPress={() => router.push({ pathname: '/stock', params: { supply: l.supply.id } })}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border },
                pressed && { opacity: 0.7 },
              ]}>
              <View style={[styles.icon, { backgroundColor: t.surfaceAlt }]}>
                <Icon name={supplyGlyph(l.supply.icon)} size={22} color={tint} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={styles.titleRow}>
                  <Text style={{ color: t.text, fontWeight: '700', fontSize: font.body, flexShrink: 1 }} numberOfLines={1}>
                    {l.supply.name}
                  </Text>
                  {l.low && <Badge label={l.onHand <= 0 ? 'OUT' : 'LOW'} tone={l.supply.critical ? 'danger' : 'warning'} />}
                </View>
                <View style={[styles.track, { backgroundColor: t.surfaceAlt }]}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${Math.max(2, ratio * 100)}%`, backgroundColor: l.low ? (l.supply.critical ? t.danger : t.warning) : tint },
                    ]}
                  />
                </View>
                <Text style={{ color: t.textMuted, fontSize: font.tiny }}>
                  Warn at {formatNumber(l.supply.lowAt)}
                  {l.visitsLeft !== null ? ` · ~${plural(l.visitsLeft, 'visit')} left at recent pace` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{
                    color: l.low ? (l.supply.critical ? t.danger : t.warning) : t.text,
                    fontWeight: '900',
                    fontSize: font.title,
                    fontVariant: ['tabular-nums'],
                  }}>
                  {formatNumber(l.onHand)}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: font.tiny }}>{l.supply.unit}</Text>
              </View>
            </Pressable>
          );
        })}
      </Card>
      <Text style={{ color: t.textMuted, fontSize: font.small, textAlign: 'center', marginTop: space.sm }}>
        {scope === 'device' ? 'Stock counts down automatically as visits are logged.' : 'Program totals include every synced device.'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  icon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
