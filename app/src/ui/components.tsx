import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';
import { font, radius, space, useTheme, type Theme } from './theme';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  padded = true,
  footer,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const content = [padded && { padding: space.lg }, { paddingBottom: space.xxl + (footer ? 0 : insets.bottom) }, style];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, content]}>{children}</View>
      )}
      {footer}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const base = [styles.card, { backgroundColor: t.surface, borderColor: t.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: t.textMuted }]} accessibilityRole="header">
        {children}
      </Text>
      {action}
    </View>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: space.sm }} />;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.text, fontSize: font.heading, fontWeight: '800', letterSpacing: -0.3 }, style]}>{children}</Text>;
}

export function Body({
  children,
  muted,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: muted ? t.textMuted : t.text, fontSize: font.body, lineHeight: 22 }, style]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  big,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const colors: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
    primary: { bg: t.primary, fg: t.primaryText, border: t.primary },
    secondary: { bg: t.surface, fg: t.text, border: t.border },
    danger: { bg: t.danger, fg: '#FFFFFF', border: t.danger },
    ghost: { bg: 'transparent', fg: t.primary, border: 'transparent' },
  };
  const c = colors[kind];
  const inactive = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      onPress={() => {
        if (inactive) return;
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: c.bg, borderColor: c.border, opacity: inactive ? 0.45 : pressed ? 0.82 : 1 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={c.fg} /> : icon ? <Icon name={icon} size={big ? 24 : 20} color={c.fg} /> : null}
      <Text style={[styles.buttonText, big && { fontSize: font.title }, { color: c.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
  onLongPress,
  size = 24,
}: {
  icon: IconName;
  onPress?: () => void;
  onLongPress?: () => void;
  label: string;
  color?: string;
  size?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={1500}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? t.surfaceAlt : 'transparent' }]}>
      <Icon name={icon} size={size} color={color ?? t.text} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  tone,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  tone?: 'primary' | 'danger';
}) {
  const t = useTheme();
  const accent = tone === 'danger' ? t.danger : t.primary;
  const soft = tone === 'danger' ? t.dangerSoft : t.primarySoft;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      onPress={() => {
        haptic.select();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? soft : t.surface, borderColor: selected ? accent : t.border, opacity: pressed ? 0.8 : 1 },
      ]}>
      {icon && <Icon name={icon} size={16} color={selected ? accent : t.textMuted} />}
      <Text style={{ color: selected ? accent : t.text, fontWeight: selected ? '700' : '500', fontSize: font.small }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.surfaceAlt }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptic.select();
              onChange(o.value);
            }}
            style={[styles.segment, active && { backgroundColor: t.surface, shadowOpacity: 0.08 }]}>
            <Text style={{ color: active ? t.text : t.textMuted, fontWeight: active ? '700' : '500', fontSize: font.small }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[styles.label, { color: t.textMuted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.textMuted}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          styles.input,
          { color: t.text, backgroundColor: t.surface, borderColor: error ? t.danger : focused ? t.primary : t.border },
          props.style,
        ]}
      />
      {error ? (
        <Text style={{ color: t.danger, marginTop: 6, fontSize: font.small }}>{error}</Text>
      ) : hint ? (
        <Text style={{ color: t.textMuted, marginTop: 6, fontSize: font.small }}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Banner({
  tone,
  icon,
  title,
  body,
  action,
}: {
  tone: 'danger' | 'warning' | 'info' | 'success';
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const t = useTheme();
  const map = {
    danger: [t.danger, t.dangerSoft],
    warning: [t.warning, t.warningSoft],
    info: [t.info, t.infoSoft],
    success: [t.success, t.successSoft],
  } as const;
  const [fg, bg] = map[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg, borderColor: fg }]} accessibilityRole="alert">
      <Icon name={icon} size={22} color={fg} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: fg, fontWeight: '800', fontSize: font.small + 1 }}>{title}</Text>
        {body ? <Text style={{ color: t.text, fontSize: font.small, marginTop: 2 }}>{body}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'danger' | 'warning' | 'success' | 'primary' }) {
  const t = useTheme();
  const map: Record<string, [string, string]> = {
    muted: [t.textMuted, t.surfaceAlt],
    danger: [t.danger, t.dangerSoft],
    warning: [t.warning, t.warningSoft],
    success: [t.success, t.successSoft],
    primary: [t.primary, t.primarySoft],
  };
  const [fg, bg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: font.tiny, fontWeight: '800', letterSpacing: 0.2 }}>{label}</Text>
    </View>
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  danger,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const t = useTheme();
  const color = danger ? t.danger : t.text;
  const inner = (
    <>
      {icon && (
        <View style={[styles.rowIcon, { backgroundColor: danger ? t.dangerSoft : t.surfaceAlt }]}>
          <Icon name={icon} size={20} color={danger ? t.danger : t.primary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color, fontSize: font.body, fontWeight: '600' }}>{title}</Text>
        {subtitle ? <Text style={{ color: t.textMuted, fontSize: font.small, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={22} color={t.textMuted} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.listRow}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.7 }]}>
      {inner}
    </Pressable>
  );
}

/** Press and hold to confirm a destructive action (panic wipe). */
export function HoldButton({
  label,
  holdingLabel,
  onConfirm,
  ms = 2500,
  icon = 'delete-forever',
}: {
  label: string;
  holdingLabel: string;
  onConfirm: () => void;
  ms?: number;
  icon?: IconName;
}) {
  const t = useTheme();
  const [progress] = useState(() => new Animated.Value(0));
  const [holding, setHolding] = useState(false);
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => () => anim.current?.stop(), []);

  const start = () => {
    setHolding(true);
    haptic.warn();
    anim.current = Animated.timing(progress, { toValue: 1, duration: ms, useNativeDriver: false });
    anim.current.start(({ finished }) => {
      if (finished) {
        haptic.heavy();
        onConfirm();
      }
      setHolding(false);
      progress.setValue(0);
    });
  };
  const cancel = () => {
    anim.current?.stop();
    setHolding(false);
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };
  const [width] = useState(() => progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Press and hold to confirm"
      onPressIn={start}
      onPressOut={cancel}
      style={[styles.hold, { borderColor: t.danger, backgroundColor: t.dangerSoft }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { width, backgroundColor: t.danger, opacity: 0.9 }]} />
      <Icon name={icon} size={22} color={holding ? '#FFFFFF' : t.danger} />
      <Text style={{ color: holding ? '#FFFFFF' : t.danger, fontWeight: '800', fontSize: font.body }}>
        {holding ? holdingLabel : label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: space.xxl, gap: space.sm }}>
      <View style={[styles.emptyIcon, { backgroundColor: t.surfaceAlt }]}>
        <Icon name={icon} size={30} color={t.textMuted} />
      </View>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: font.title, textAlign: 'center' }}>{title}</Text>
      <Text style={{ color: t.textMuted, fontSize: font.body, textAlign: 'center', lineHeight: 22 }}>{body}</Text>
    </View>
  );
}

export const shared = (t: Theme) =>
  StyleSheet.create({
    num: { color: t.text, fontVariant: ['tabular-nums'], fontWeight: '800' },
  });

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, marginBottom: space.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.sm },
  sectionTitle: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonBig: { minHeight: 62, borderRadius: radius.lg },
  buttonText: { fontSize: font.body, fontWeight: '800' },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    shadowOpacity: 0,
  },
  label: { fontSize: font.small, fontWeight: '700', marginBottom: 6 },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, paddingHorizontal: space.md, fontSize: font.body + 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    marginBottom: space.md,
  },
  badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hold: {
    minHeight: 58,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    overflow: 'hidden',
  },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
});
