import { Alert, Platform, Text, View } from 'react-native';

import { useSession } from '../state/KitcountProvider';
import { Badge, Card, EmptyState, IconButton, Screen, SectionTitle } from '../ui/components';
import { formatDay, formatTime, plural } from '../ui/format';
import { font, space, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';

/** Recent visits on this device. Visits are never edited: a mistake is voided and logged again. */
export function History() {
  const s = useSession();
  const t = useTheme();
  const items = s.ledger.recentVisits(150, s.deviceId);
  const names = new Map(s.config.catalog.supplies.map((x) => [x.id, x.short]));

  if (items.length === 0) {
    return (
      <Screen>
        <EmptyState icon="history" title="No visits yet" body="Visits logged on this device appear here so you can undo mistakes." />
      </Screen>
    );
  }

  const rows = items.map((item, i) => ({
    ...item,
    day: formatDay(item.visit.at),
    first: i === 0 || formatDay(items[i - 1].visit.at) !== formatDay(item.visit.at),
  }));
  return (
    <Screen>
      {rows.map(({ visit, voided, day, first }) => {
        const header = first ? <SectionTitle>{day}</SectionTitle> : null;
        const supplies = Object.entries(visit.out)
          .map(([id, q]) => `${q} ${names.get(id) ?? id}`)
          .join(' · ');
        return (
          <View key={visit.id}>
            {header}
            <Card
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: voided ? 0.5 : 1, paddingVertical: space.md }}>
              <View style={{ width: 64 }}>
                <Text style={{ color: t.text, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatTime(visit.at)}</Text>
                <Text
                  style={{ color: t.textMuted, fontSize: font.tiny, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }}>
                  {visit.participant ? `#${visit.participant.slice(0, 6)}` : 'no code'}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: t.text, fontSize: font.small }} numberOfLines={2}>
                  {supplies || 'No supplies'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {voided && <Badge label="VOIDED" tone="danger" />}
                  {visit.syringesIn > 0 && <Badge label={`${visit.syringesIn} IN`} tone="primary" />}
                  {visit.reversals > 0 && <Badge label={plural(visit.reversals, 'REVERSAL').toUpperCase()} tone="danger" />}
                  {visit.referrals.length > 0 && <Badge label={plural(visit.referrals.length, 'referral').toUpperCase()} tone="success" />}
                </View>
              </View>
              {!voided && (
                <IconButton
                  icon="undo-variant"
                  label="Void this visit"
                  onPress={() => {
                    const go = () => void s.voidVisit(visit.id).then(() => showToast('Visit voided', { icon: 'undo' }));
                    if (Platform.OS === 'web') go();
                    else
                      Alert.alert('Void this visit?', 'It will be excluded from reports and stock counts on every device.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Void', style: 'destructive', onPress: go },
                      ]);
                  }}
                />
              )}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}
