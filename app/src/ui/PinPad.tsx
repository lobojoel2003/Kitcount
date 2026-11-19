import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { haptic } from './haptics';
import { Icon } from './Icon';
import { font, useTheme } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

/** Large numeric keypad. PIN digits never go through the system keyboard (no keyboard learning/cache). */
export function PinPad({
  value,
  onChange,
  length = 6,
  onSubmit,
  shakeKey,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  onSubmit?: (v: string) => void;
  /** Change this to trigger the "wrong PIN" shake. */
  shakeKey?: number;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [shake] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!shakeKey) return;
    haptic.error();
    Animated.sequence(
      [12, -12, 8, -8, 4, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 50, useNativeDriver: true })),
    ).start();
  }, [shakeKey, shake]);

  const press = (k: (typeof KEYS)[number]) => {
    if (disabled) return;
    if (k === 'del') {
      haptic.select();
      onChange(value.slice(0, -1));
      return;
    }
    if (!k || value.length >= length) return;
    haptic.tap();
    const next = value + k;
    onChange(next);
    if (next.length === length) onSubmit?.(next);
  };

  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.View
        style={[styles.dots, { transform: [{ translateX: shake }] }]}
        accessibilityLabel={`${value.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.dot, { borderColor: t.primary, backgroundColor: i < value.length ? t.primary : 'transparent' }]} />
        ))}
      </Animated.View>
      <View style={styles.grid}>
        {KEYS.map((k, i) => (
          <Pressable
            key={i}
            disabled={!k || disabled}
            accessibilityRole="button"
            accessibilityLabel={k === 'del' ? 'Delete' : k}
            onPress={() => press(k)}
            style={({ pressed }) => [
              styles.key,
              k && k !== 'del' && { backgroundColor: pressed ? t.primarySoft : t.surface, borderColor: t.border },
            ]}>
            {k === 'del' ? (
              <Icon name="backspace-outline" size={28} color={t.text} />
            ) : (
              <Text style={[styles.keyText, { color: t.text }]}>{k}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 16, marginBottom: 28 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 300, justifyContent: 'space-between', rowGap: 14 },
  key: {
    width: 88,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  keyText: { fontSize: font.display - 4, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
