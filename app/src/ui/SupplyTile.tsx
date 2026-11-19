import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Supply } from '../core/domain/catalog';
import { haptic } from './haptics';
import { Icon, supplyGlyph } from './Icon';
import { font, isDark, radius, supplyTint, useTheme } from './theme';

/**
 * One tap adds a "step" (e.g. 10 syringes); a long press takes one step back.
 * Tiles are large enough to hit with a thumb while holding a bag in the
 * other hand.
 */
export const SupplyTile = memo(function SupplyTile({
  supply,
  count,
  low,
  onAdd,
  onRemove,
}: {
  supply: Supply;
  count: number;
  low: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTheme();
  const tint = supplyTint(supply.icon, t);
  const active = count > 0;
  // Dark mode tints are light, so active tiles use dark ink there.
  const ink = isDark(t) ? '#06201C' : '#FFFFFF';
  return (
    <Pressable
      testID={`tile-${supply.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${supply.name}: ${count} ${supply.unit}`}
      accessibilityHint={`Tap to add ${supply.step}. Press and hold to remove ${supply.step}.`}
      onPress={() => {
        haptic.tap();
        onAdd(supply.id);
      }}
      onLongPress={() => {
        if (!active) return;
        haptic.select();
        onRemove(supply.id);
      }}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: active ? tint : t.surface,
          borderColor: active ? tint : t.border,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}>
      <View style={styles.top}>
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: active ? (isDark(t) ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.22)') : t.surfaceAlt },
          ]}>
          <Icon name={supplyGlyph(supply.icon)} size={22} color={active ? ink : tint} />
        </View>
        {low && (
          <View
            style={[styles.lowDot, { backgroundColor: supply.critical ? t.danger : t.warning, borderColor: active ? tint : t.surface }]}
          />
        )}
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: active ? ink : t.text }]}>
        {supply.short}
      </Text>
      <Text style={[styles.count, { color: active ? ink : t.textMuted }]}>{active ? `+${count}` : `+${supply.step}`}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 104,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: 12,
    justifyContent: 'space-between',
  },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lowDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  label: { fontSize: font.small + 1, fontWeight: '800', marginTop: 6 },
  count: { fontSize: font.title, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
