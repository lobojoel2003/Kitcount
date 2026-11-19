import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { font, radius, useTheme } from './theme';

interface ToastMessage {
  id: number;
  text: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
  duration: number;
}

let listener: ((m: ToastMessage) => void) | null = null;
let nextId = 1;

export function showToast(text: string, opts: { icon?: IconName; action?: ToastMessage['action']; duration?: number } = {}) {
  listener?.({ id: nextId++, text, icon: opts.icon, action: opts.action, duration: opts.duration ?? 3500 });
}

export function ToastHost({ bottomOffset = 90 }: { bottomOffset?: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<ToastMessage | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    listener = (m) => setMsg(m);
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!msg) return;
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
        setMsg((m) => (m?.id === msg.id ? null : m)),
      );
    }, msg.duration);
    return () => clearTimeout(timer);
  }, [msg, opacity]);

  if (!msg) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', paddingBottom: insets.bottom + bottomOffset }]}>
      <Animated.View accessibilityLiveRegion="polite" style={[styles.toast, { opacity, backgroundColor: t.text }]}>
        {msg.icon && <Icon name={msg.icon} size={20} color={t.bg} />}
        <Text style={{ flex: 1, color: t.bg, fontWeight: '700', fontSize: font.body }}>{msg.text}</Text>
        {msg.action && (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              msg.action?.onPress();
              setMsg(null);
            }}>
            <Text style={{ color: t.primarySoft, fontWeight: '900', fontSize: font.body }}>{msg.action.label}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    marginHorizontal: 16,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
