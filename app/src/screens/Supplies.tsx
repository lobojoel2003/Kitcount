import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { validateCatalog, type Catalog } from '../core/domain/catalog';
import { useSession } from '../state/KitcountProvider';
import { Body, Button, Card, Screen, SectionTitle } from '../ui/components';
import { Icon, supplyGlyph } from '../ui/Icon';
import { font, radius, space, supplyTint, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';

function NumberBox({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <TextInput
        accessibilityLabel={label}
        value={String(value)}
        onChangeText={(v) => onChange(Number(v.replace(/\D/g, '')) || 0)}
        keyboardType="number-pad"
        maxLength={6}
        style={[styles.num, { color: t.text, backgroundColor: t.surfaceAlt, borderColor: t.border }]}
      />
      <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

/** Program-wide catalog. Changes sync to every device (last change wins). */
export function Supplies() {
  const s = useSession();
  const t = useTheme();
  const [draft, setDraft] = useState<Catalog>(() => JSON.parse(JSON.stringify(s.config.catalog)) as Catalog);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.config.catalog);

  const updateSupply = (i: number, patch: Partial<Catalog['supplies'][number]>) =>
    setDraft((d) => ({ ...d, supplies: d.supplies.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const list = [...d.supplies];
      const j = i + by;
      if (j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, supplies: list };
    });

  const save = async () => {
    setBusy(true);
    try {
      const catalog = validateCatalog({ ...draft, supplies: draft.supplies.map((x) => ({ ...x, step: Math.max(1, x.step) })) });
      await s.setConfig('catalog', catalog);
      showToast('Supplies updated on all devices', { icon: 'check-circle' });
    } catch (e) {
      showToast((e as Error).message, { icon: 'alert-circle' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        dirty ? (
          <View style={[styles.footer, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Button
              kind="secondary"
              label="Discard"
              onPress={() => setDraft(JSON.parse(JSON.stringify(s.config.catalog)))}
              style={{ flex: 1 }}
            />
            <Button label="Save for program" icon="content-save" busy={busy} onPress={save} style={{ flex: 2 }} />
          </View>
        ) : undefined
      }>
      <Body muted>Tap amount is how much one tap on the tile adds. Kitcount warns when this device’s stock reaches the warning level.</Body>
      <SectionTitle>Supply tiles</SectionTitle>
      {draft.supplies.map((x, i) => (
        <Card key={x.id} style={[styles.row, { opacity: x.enabled ? 1 : 0.55 }]}>
          <View style={{ gap: 2 }}>
            <Pressable accessibilityLabel={`Move ${x.name} up`} onPress={() => move(i, -1)} hitSlop={6}>
              <Icon name="chevron-up" size={20} color={t.textMuted} />
            </Pressable>
            <Pressable accessibilityLabel={`Move ${x.name} down`} onPress={() => move(i, 1)} hitSlop={6}>
              <Icon name="chevron-down" size={20} color={t.textMuted} />
            </Pressable>
          </View>
          <Icon name={supplyGlyph(x.icon)} size={24} color={supplyTint(x.icon, t)} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: font.body }} numberOfLines={1}>
              {x.name}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: font.tiny }}>
              {x.critical ? 'Critical · ' : ''}
              {x.unit}
            </Text>
          </View>
          <NumberBox label="per tap" value={x.step} onChange={(n) => updateSupply(i, { step: n })} />
          <NumberBox label="warn at" value={x.lowAt} onChange={(n) => updateSupply(i, { lowAt: n })} />
          <Switch
            value={x.enabled}
            onValueChange={(v) => updateSupply(i, { enabled: v })}
            accessibilityLabel={`Show ${x.name}`}
            trackColor={{ true: t.primary, false: t.border }}
          />
        </Card>
      ))}
      <SectionTitle>Referral types</SectionTitle>
      <Card style={{ paddingVertical: space.xs }}>
        {draft.referrals.map((r, i) => (
          <View key={r.id} style={[styles.refRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
            <Text style={{ flex: 1, color: t.text, fontSize: font.body }}>{r.name}</Text>
            <Switch
              value={r.enabled}
              accessibilityLabel={`Offer ${r.name}`}
              onValueChange={(v) => setDraft((d) => ({ ...d, referrals: d.referrals.map((x, k) => (k === i ? { ...x, enabled: v } : x)) }))}
              trackColor={{ true: t.primary, false: t.border }}
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
  },
  num: { width: 58, height: 38, borderRadius: radius.sm, borderWidth: 1, textAlign: 'center', fontWeight: '800', fontSize: font.small + 1 },
  refRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  footer: { flexDirection: 'row', gap: space.md, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
