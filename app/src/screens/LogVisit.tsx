import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkCode } from '../core/crypto/codes';
import { useSession } from '../state/KitcountProvider';
import { Badge, Banner, Button, Chip, IconButton, SectionTitle } from '../ui/components';
import { plural, timeAgo } from '../ui/format';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Stepper } from '../ui/Stepper';
import { SupplyTile } from '../ui/SupplyTile';
import { font, radius, space, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';
import { SyncBadge } from './SyncBadge';

const COLUMNS = 3;

export function LogVisit() {
  const s = useSession();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const codeRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const [code, setCode] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [out, setOut] = useState<Record<string, number>>({});
  const [syringesIn, setSyringesIn] = useState(0);
  const [reversals, setReversals] = useState(0);
  const [secondary, setSecondary] = useState(0);
  const [referrals, setReferrals] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);

  const config = s.config;
  const supplies = useMemo(() => config.catalog.supplies.filter((x) => x.enabled), [config.catalog]);
  const referralTypes = useMemo(() => config.catalog.referrals.filter((x) => x.enabled), [config.catalog]);
  const levels = s.ledger.stockLevels(s.deviceId);
  const lowIds = new Set(levels.filter((l) => l.low).map((l) => l.supply.id));
  const criticalLow = s.ledger.lowStock(s.deviceId).filter((l) => l.supply.critical);

  const check = code ? checkCode(code, config.codePattern || undefined) : null;
  const participant = check?.ok ? s.ledger.participant(s.participantHash(check.normalized)) : null;
  const identified = anonymous || !!check?.ok;
  const totalOut = Object.values(out).reduce((a, b) => a + b, 0);
  const hasContent = totalOut > 0 || syringesIn > 0 || reversals > 0 || referrals.length > 0 || secondary > 0;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayCount = s.ledger
    .visitsBetween(todayStart, new Date(todayStart.getTime() + 86_400_000))
    .filter((v) => v.device === s.deviceId).length;

  const add = useCallback(
    (id: string) => {
      const supply = s.config.catalog.supplies.find((x) => x.id === id);
      if (!supply) return;
      setOut((o) => ({ ...o, [id]: (o[id] ?? 0) + supply.step }));
    },
    [s],
  );
  const remove = useCallback(
    (id: string) => {
      const supply = s.config.catalog.supplies.find((x) => x.id === id);
      if (!supply) return;
      setOut((o) => ({ ...o, [id]: Math.max(0, (o[id] ?? 0) - supply.step) }));
    },
    [s],
  );

  const reset = () => {
    setCode('');
    setAnonymous(false);
    setOut({});
    setSyringesIn(0);
    setReversals(0);
    setSecondary(0);
    setReferrals([]);
    setShowMore(false);
  };

  const save = async () => {
    if (!identified || saving) return;
    setSaving(true);
    try {
      const visit = await s.logVisit({ code: anonymous ? null : code, out, syringesIn, reversals, referrals, secondary });
      haptic.success();
      reset();
      showToast(participant ? 'Visit saved' : anonymous ? 'Anonymous visit saved' : 'Visit saved · new participant', {
        icon: 'check-circle',
        duration: 6000,
        action: {
          label: 'Undo',
          onPress: () => {
            void s.voidVisit(visit.id).then(() => showToast('Visit removed', { icon: 'undo' }));
          },
        },
      });
      codeRef.current?.focus();
    } catch (e) {
      haptic.error();
      showToast((e as Error).message, { icon: 'alert-circle' });
    } finally {
      setSaving(false);
    }
  };

  const rows: (typeof supplies)[] = [];
  for (let i = 0; i < supplies.length; i += COLUMNS) rows.push(supplies.slice(i, i + COLUMNS));

  let status: React.ReactNode;
  if (anonymous) status = <Badge label="NO CODE · COUNTS AS AN ENCOUNTER ONLY" tone="muted" />;
  else if (!code) status = <Text style={[styles.hint, { color: t.textMuted }]}>{config.codeHint}</Text>;
  else if (check && !check.ok) status = <Text style={[styles.hint, { color: t.warning }]}>{check.reason}</Text>;
  else if (participant)
    status = (
      <View style={styles.statusRow}>
        <Badge label="RETURNING" tone="primary" />
        <Text style={[styles.hint, { color: t.text }]}>
          {plural(participant.visits, 'visit')} · last {timeAgo(participant.lastAt)}
        </Text>
      </View>
    );
  else status = <Badge label="NEW PARTICIPANT" tone="success" />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm, backgroundColor: t.bg }]}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: font.small, fontWeight: '700' }}>
            {s.programName}
          </Text>
          <Text numberOfLines={1} style={{ color: t.text, fontSize: font.heading, fontWeight: '900', letterSpacing: -0.4 }}>
            Log visit{' '}
            <Text style={{ color: t.textMuted, fontSize: font.body, fontWeight: '700', letterSpacing: 0 }}>· {todayCount} today</Text>
          </Text>
        </View>
        <SyncBadge />
        <IconButton icon="history" label="Visit history" onPress={() => router.push('/history')} />
        <IconButton icon="lock-outline" label="Lock Kitcount" onPress={() => void s.lock()} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {criticalLow.length > 0 && (
          <Banner
            tone="danger"
            icon="alert-octagon"
            title={`${criticalLow[0].supply.short} running low`}
            body={`${plural(criticalLow[0].onHand, criticalLow[0].supply.unit.replace(/s$/, ''), criticalLow[0].supply.unit)} left on this device${criticalLow[0].visitsLeft !== null ? ` · enough for about ${plural(criticalLow[0].visitsLeft, 'more visit')} at the recent pace` : ''}.`}
            action={<IconButton icon="chevron-right" label="Open inventory" color={t.danger} onPress={() => router.push('/inventory')} />}
          />
        )}

        <View style={[styles.codeCard, { backgroundColor: t.surface, borderColor: check?.ok || anonymous ? t.primary : t.border }]}>
          <View style={styles.codeRow}>
            <Icon name="account-question-outline" size={26} color={t.textMuted} />
            <TextInput
              ref={codeRef}
              testID="code-input"
              value={anonymous ? '' : code}
              editable={!anonymous}
              onChangeText={(v) => setCode(v.toUpperCase())}
              placeholder={anonymous ? 'No code given' : 'Participant code'}
              placeholderTextColor={t.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              importantForAutofill="no"
              textContentType="none"
              keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
              returnKeyType="done"
              maxLength={24}
              accessibilityLabel="Participant code"
              style={[styles.codeInput, { color: t.text }, !code && styles.codeEmpty]}
            />
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: anonymous }}
              accessibilityLabel="No code"
              onPress={() => {
                haptic.select();
                setAnonymous((a) => !a);
                setCode('');
              }}
              style={[styles.noCode, { backgroundColor: anonymous ? t.primary : t.surfaceAlt }]}>
              <Text style={{ color: anonymous ? t.primaryText : t.textMuted, fontWeight: '800', fontSize: font.tiny }}>NO CODE</Text>
            </Pressable>
          </View>
          <View style={{ minHeight: 24, justifyContent: 'center', marginTop: space.xs }}>{status}</View>
        </View>

        <SectionTitle
          action={
            totalOut > 0 ? (
              <Text onPress={() => setOut({})} style={{ color: t.primary, fontWeight: '700' }}>
                Clear
              </Text>
            ) : undefined
          }>
          Hand out · tap to add, hold to remove
        </SectionTitle>
        {rows.map((row, i) => (
          <View key={i} style={styles.tileRow}>
            {row.map((supply) => (
              <SupplyTile
                key={supply.id}
                supply={supply}
                count={out[supply.id] ?? 0}
                low={lowIds.has(supply.id)}
                onAdd={add}
                onRemove={remove}
              />
            ))}
            {row.length < COLUMNS && Array.from({ length: COLUMNS - row.length }, (_, k) => <View key={`pad-${k}`} style={{ flex: 1 }} />)}
          </View>
        ))}

        <SectionTitle>Collected</SectionTitle>
        <Stepper icon="trash-can-outline" label="Syringes in" value={syringesIn} onChange={setSyringesIn} step={1} quick={10} />

        <Pressable accessibilityRole="button" onPress={() => setShowMore((m) => !m)} style={styles.moreToggle}>
          <SectionTitle>
            {`Reversals, referrals & more${reversals + secondary + referrals.length > 0 ? ` · ${reversals + secondary + referrals.length}` : ''}`}
          </SectionTitle>
          <Icon name={showMore ? 'chevron-up' : 'chevron-down'} size={22} color={t.textMuted} />
        </Pressable>
        {showMore && (
          <>
            <Stepper icon="heart-pulse" label="Overdoses reversed" value={reversals} onChange={setReversals} max={20} tone="danger" />
            <Stepper icon="account-group" label="Picking up for others" value={secondary} onChange={setSecondary} max={20} />
            <Text style={[styles.subLabel, { color: t.textMuted }]}>Referred to</Text>
            <View style={styles.chips}>
              {referralTypes.map((r) => (
                <Chip
                  key={r.id}
                  label={r.name}
                  selected={referrals.includes(r.id)}
                  onPress={() => setReferrals((list) => (list.includes(r.id) ? list.filter((x) => x !== r.id) : [...list, r.id]))}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: t.surface, borderColor: t.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: '800', fontSize: font.body }}>
            {totalOut > 0 ? plural(totalOut, 'item') : hasContent ? 'No supplies' : 'Nothing yet'}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: font.small }} numberOfLines={1}>
            {[
              syringesIn ? `${syringesIn} in` : null,
              reversals ? `${reversals} reversal${reversals > 1 ? 's' : ''}` : null,
              referrals.length ? plural(referrals.length, 'referral') : null,
            ]
              .filter(Boolean)
              .join(' · ') || (identified ? 'Ready to save' : 'Enter a code first')}
          </Text>
        </View>
        <Button
          big
          label="Done"
          icon="check-bold"
          onPress={save}
          disabled={!identified}
          busy={saving}
          style={{ minWidth: 150 }}
          testID="done"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.sm, gap: 2 },
  codeCard: { borderRadius: radius.xl, borderWidth: 2, padding: space.md, paddingLeft: space.lg },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  codeInput: { flex: 1, minWidth: 0, fontSize: 30, fontWeight: '900', letterSpacing: 4, paddingVertical: 6, fontVariant: ['tabular-nums'] },
  codeEmpty: { fontSize: 22, fontWeight: '700', letterSpacing: 0 },
  noCode: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 9 },
  hint: { fontSize: font.small, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  moreToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subLabel: { fontSize: font.small, fontWeight: '700', marginBottom: space.sm, marginTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    paddingLeft: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
