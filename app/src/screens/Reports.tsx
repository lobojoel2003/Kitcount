import * as DocumentPicker from 'expo-document-picker';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { computeReport } from '../core/reports/engine';
import { reportFilename, reportToCsv, reportToHtml } from '../core/reports/export';
import { previousPeriod, shiftPeriod, type Period } from '../core/reports/period';
import { allTemplates } from '../core/reports/registry';
import { readPickedText, shareCsv, sharePdf } from '../platform/files';
import { useSession } from '../state/KitcountProvider';
import { Badge, Banner, Button, Card, Chip, Screen, SectionTitle } from '../ui/components';
import { formatNumber } from '../ui/format';
import { Icon } from '../ui/Icon';
import { font, radius, space, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';

export function Reports() {
  const s = useSession();
  const t = useTheme();
  const templates = useMemo(() => allTemplates(s.importedTemplates), [s.importedTemplates]);
  const [templateId, setTemplateId] = useState(s.config.templateId);
  const entry = templates.find((e) => e.template.id === templateId) ?? templates[0];
  const template = entry.template;
  const [period, setPeriod] = useState<Period>(() => previousPeriod(template.period));
  const [manual, setManual] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);

  const selectTemplate = (id: string) => {
    const next = templates.find((e) => e.template.id === id);
    if (!next) return;
    setTemplateId(id);
    setManual({});
    if (next.template.period !== period.kind) setPeriod(previousPeriod(next.template.period));
  };

  const manualValues = Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, v.trim() === '' ? null : Number(v)]));
  const report = computeReport(template, s.ledger, period, { manualValues, programName: s.programName });
  const isFuture = period.start > new Date();
  const inProgress = !isFuture && period.end > new Date();

  const share = async (kind: 'csv' | 'pdf') => {
    setBusy(kind);
    try {
      const fresh = computeReport(template, s.ledger, period, { manualValues, programName: s.programName });
      if (kind === 'csv') await shareCsv(reportFilename(fresh, 'csv'), reportToCsv(fresh));
      else await sharePdf(reportFilename(fresh, 'pdf'), reportToHtml(fresh));
    } catch (e) {
      showToast((e as Error).message, { icon: 'alert-circle' });
    } finally {
      setBusy(null);
    }
  };

  const importTemplate = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'ios' ? ['public.yaml', 'public.text', 'public.data'] : ['*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const yaml = await readPickedText(res.assets[0].uri);
      const imported = await s.importTemplate(yaml);
      selectTemplate(imported.id);
      setTemplateId(imported.id);
      showToast(`Imported “${imported.name}”`, { icon: 'file-import' });
    } catch (e) {
      Alert.alert('Template not imported', (e as Error).message);
    }
  };

  return (
    <Screen>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingBottom: space.xs }}>
        {templates.map((e) => (
          <Pressable
            key={e.template.id}
            onLongPress={() => {
              if (e.source !== 'imported') return;
              Alert.alert('Remove template?', e.template.name, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => void s.removeTemplate(e.template.id) },
              ]);
            }}>
            <Chip
              label={e.template.name}
              icon={e.source === 'imported' ? 'file-import-outline' : 'file-chart-outline'}
              selected={e.template.id === template.id}
              onPress={() => selectTemplate(e.template.id)}
            />
          </Pressable>
        ))}
        <Chip label="Import YAML" icon="plus" onPress={importTemplate} />
      </ScrollView>

      <View style={[styles.period, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous period"
          hitSlop={8}
          onPress={() => setPeriod((p) => shiftPeriod(p, -1))}
          style={[styles.arrow, { backgroundColor: t.surfaceAlt }]}>
          <Icon name="chevron-left" size={26} color={t.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: t.text, fontSize: font.title, fontWeight: '900' }}>{period.label}</Text>
          <Text style={{ color: t.textMuted, fontSize: font.small }}>
            {template.jurisdiction} · {template.period}ly
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next period"
          hitSlop={8}
          onPress={() => setPeriod((p) => shiftPeriod(p, 1))}
          style={[styles.arrow, { backgroundColor: t.surfaceAlt }]}>
          <Icon name="chevron-right" size={26} color={t.text} />
        </Pressable>
      </View>

      {inProgress && (
        <Banner
          tone="info"
          icon="calendar-clock"
          title="This period is still in progress"
          body="Numbers will change as more visits are logged and synced."
        />
      )}
      {s.sync.pending > 0 && s.sync.configured && (
        <Banner
          tone="info"
          icon="cloud-upload-outline"
          title={`${formatNumber(s.sync.pending)} events not yet synced`}
          body="Sync first so this report includes every device."
        />
      )}
      {report.warnings.length > 0 && (
        <Banner tone="warning" icon="alert" title="Check before submitting" body={report.warnings.join('\n')} />
      )}

      <View style={styles.actions}>
        <Button
          big
          label="Share PDF"
          icon="file-pdf-box"
          onPress={() => share('pdf')}
          busy={busy === 'pdf'}
          style={{ flex: 1.4 }}
          testID="share-pdf"
        />
        <Button
          big
          kind="secondary"
          label="CSV"
          icon="file-delimited-outline"
          onPress={() => share('csv')}
          busy={busy === 'csv'}
          style={{ flex: 1 }}
        />
      </View>
      <Text style={{ color: t.textMuted, fontSize: font.small, marginBottom: space.sm, textAlign: 'center' }}>
        {template.name} · built from {formatNumber(report.visitCount)} encounters
      </Text>

      {report.sections.map((section) => (
        <View key={section.title}>
          <SectionTitle>{section.title}</SectionTitle>
          <Card style={{ paddingVertical: space.xs }}>
            {section.rows.map((row, i) => (
              <View key={row.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
                {row.code ? <Text style={[styles.code, { color: t.textMuted }]}>{row.code}</Text> : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: font.body, fontWeight: '600' }}>{row.label}</Text>
                  {row.help ? <Text style={{ color: t.textMuted, fontSize: font.tiny, marginTop: 2 }}>{row.help}</Text> : null}
                </View>
                {row.manual ? (
                  <TextInput
                    value={manual[row.id] ?? ''}
                    onChangeText={(v) => setManual((m) => ({ ...m, [row.id]: v.replace(/[^\d.]/g, '') }))}
                    keyboardType="decimal-pad"
                    placeholder="Enter"
                    placeholderTextColor={t.warning}
                    accessibilityLabel={row.label}
                    style={[
                      styles.manual,
                      { color: t.text, borderColor: manual[row.id] ? t.border : t.warning, backgroundColor: t.surfaceAlt },
                    ]}
                  />
                ) : (
                  <Text style={[styles.value, { color: row.value === null ? t.textMuted : t.text }]}>{row.display}</Text>
                )}
              </View>
            ))}
          </Card>
        </View>
      ))}
      {template.disclaimer ? (
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
          <Badge label="NOTE" />
          <Text style={{ color: t.textMuted, fontSize: font.small, flex: 1 }}>{template.disclaimer}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  period: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.sm,
    marginVertical: space.md,
  },
  arrow: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.md, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12 },
  code: { width: 34, fontSize: font.small, fontWeight: '700', fontVariant: ['tabular-nums'] },
  value: { fontSize: font.title, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 60, textAlign: 'right' },
  manual: {
    width: 90,
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    textAlign: 'right',
    paddingHorizontal: 10,
    fontSize: font.body,
    fontWeight: '800',
  },
});
