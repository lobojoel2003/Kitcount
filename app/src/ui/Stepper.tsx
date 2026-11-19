import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';
import { font, radius, useTheme } from './theme';

export function Stepper({
  icon,
  label,
  value,
  onChange,
  step = 1,
  max = 10_000,
  quick,
  tone = 'primary',
}: {
  icon: IconName;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  max?: number;
  /** Optional larger increment button, e.g. +10 for returned syringes. */
  quick?: number;
  tone?: 'primary' | 'danger';
}) {
  const t = useTheme();
  const accent = tone === 'danger' ? t.danger : t.primary;
  const set = (v: number) => {
    const next = Math.max(0, Math.min(max, v));
    if (next !== value) {
      haptic.tap();
      onChange(next);
    }
  };
  return (
    <View style={[styles.row, { backgroundColor: t.surface, borderColor: value > 0 ? accent : t.border }]}>
      <Icon name={icon} size={22} color={accent} />
      <Text style={[styles.label, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        hitSlop={6}
        onPress={() => set(value - step)}
        style={[styles.btn, { backgroundColor: t.surfaceAlt, opacity: value > 0 ? 1 : 0.4 }]}>
        <Icon name="minus" size={20} color={t.text} />
      </Pressable>
      <Text accessibilityLabel={`${label}: ${value}`} style={[styles.value, { color: value > 0 ? accent : t.textMuted }]}>
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        hitSlop={6}
        onPress={() => set(value + step)}
        style={[styles.btn, { backgroundColor: t.surfaceAlt }]}>
        <Icon name="plus" size={20} color={t.text} />
      </Pressable>
      {quick ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${quick} ${label}`}
          onPress={() => set(value + quick)}
          style={[styles.quick, { backgroundColor: accent }]}>
          <Text style={{ color: t.primaryText, fontWeight: '900', fontSize: font.small }}>+{quick}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
    marginBottom: 10,
  },
  label: { flex: 1, fontSize: font.body, fontWeight: '700' },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 40, textAlign: 'center', fontSize: font.title, fontWeight: '900', fontVariant: ['tabular-nums'] },
  quick: { height: 40, paddingHorizontal: 12, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
