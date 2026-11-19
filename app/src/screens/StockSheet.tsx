import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { AdjustReason } from '../core/domain/events';
import { useSession } from '../state/KitcountProvider';
import { Body, Button, Card, Chip, Field, Screen, Segmented, Title } from '../ui/components';
import { formatNumber } from '../ui/format';
import { haptic } from '../ui/haptics';
import { Icon, supplyGlyph } from '../ui/Icon';
import { font, space, supplyTint, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';

type Mode = 'receive' | 'count' | 'remove';

const REMOVE_REASONS: { value: AdjustReason; label: string }[] = [
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'transfer_out', label: 'Sent to another site' },
  { value: 'other', label: 'Other' },
];

export function StockSheet() {
  const s = useSession();
  const t = useTheme();
  const { supply: supplyId } = useLocalSearchParams<{ supply: string }>();
  const supply = s.config.catalog.supplies.find((x) => x.id === supplyId);
  const [mode, setMode] = useState<Mode>('receive');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<AdjustReason>('expired');
  const [busy, setBusy] = useState(false);

  if (!supply) {
    return (
      <Screen>
        <Body>Unknown supply.</Body>
      </Screen>
    );
  }
  const onHand = s.ledger.onHand(s.deviceId)[supply.id] ?? 0;
  const n = Number(qty);
  const valid = /^\d+$/.test(qty) && (mode === 'count' ? n >= 0 : n > 0) && n <= 10_000_000;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      if (mode === 'receive') {
        await s.receiveStock(supply.id, n);
        showToast(`Received ${formatNumber(n)} ${supply.unit}`, { icon: 'tray-arrow-down' });
      } else if (mode === 'count') {
        const delta = await s.countStock(supply.id, n);
        showToast(delta === 0 ? 'Count matches — no change' : `Adjusted by ${delta > 0 ? '+' : ''}${formatNumber(delta)}`, {
          icon: 'counter',
        });
      } else {
        await s.adjustStock(supply.id, -n, reason);
        showToast(`Removed ${formatNumber(n)} ${supply.unit}`, { icon: 'tray-arrow-up' });
      }
      haptic.success();
      router.back();
    } catch (e) {
      showToast((e as Error).message, { icon: 'alert-circle' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg }}>
        <Icon name={supplyGlyph(supply.icon)} size={34} color={supplyTint(supply.icon, t)} />
        <View style={{ flex: 1 }}>
          <Title>{supply.name}</Title>
          <Text style={{ color: t.textMuted, fontSize: font.body }}>
            {formatNumber(onHand)} {supply.unit} on this device
          </Text>
        </View>
      </View>
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setQty('');
        }}
        options={[
          { value: 'receive', label: 'Receive' },
          { value: 'count', label: 'Count' },
          { value: 'remove', label: 'Remove' },
        ]}
      />
      <Card style={{ marginTop: space.lg }}>
        <Field
          label={
            mode === 'receive'
              ? `How many ${supply.unit} arrived?`
              : mode === 'count'
                ? `How many ${supply.unit} are physically here?`
                : `How many ${supply.unit} to remove?`
          }
          hint={mode === 'count' ? 'Kitcount records the difference as an adjustment.' : undefined}
          value={qty}
          onChangeText={(v) => setQty(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder="0"
          autoFocus
          maxLength={8}
          style={{ fontSize: font.heading, fontWeight: '800' }}
        />
        {mode === 'remove' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
            {REMOVE_REASONS.map((r) => (
              <Chip key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />
            ))}
          </View>
        )}
        {mode === 'receive' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
            {[supply.step * 10, supply.step * 50, supply.step * 100].map((q) => (
              <Chip key={q} label={`+${formatNumber(q)}`} onPress={() => setQty(String(q))} />
            ))}
          </View>
        )}
        <Button
          big
          label={mode === 'receive' ? 'Add to stock' : mode === 'count' ? 'Save count' : 'Remove from stock'}
          kind={mode === 'remove' ? 'danger' : 'primary'}
          disabled={!valid}
          busy={busy}
          onPress={save}
        />
      </Card>
    </Screen>
  );
}
