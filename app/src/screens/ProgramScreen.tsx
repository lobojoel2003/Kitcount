import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { allTemplates } from '../core/reports/registry';
import { useSession } from '../state/KitcountProvider';
import { Body, Button, Card, Chip, Field, Screen, SectionTitle } from '../ui/components';
import { font, space, useTheme } from '../ui/theme';
import { showToast } from '../ui/Toast';

export function ProgramScreen() {
  const s = useSession();
  const t = useTheme();
  const cfg = s.config;
  const [name, setName] = useState(s.programName);
  const [hint, setHint] = useState(cfg.codeHint);
  const [pattern, setPattern] = useState(cfg.codePattern);
  const [templateId, setTemplateId] = useState(cfg.templateId);
  const [busy, setBusy] = useState(false);
  const templates = useMemo(() => allTemplates(s.importedTemplates), [s.importedTemplates]);

  let patternError: string | null = null;
  if (pattern) {
    try {
      new RegExp(pattern);
    } catch {
      patternError = 'Not a valid pattern';
    }
  }

  const save = async () => {
    setBusy(true);
    try {
      if (name.trim() && name.trim() !== s.programName) await s.setConfig('programName', name.trim());
      if (hint !== cfg.codeHint) await s.setConfig('codeHint', hint);
      if (pattern !== cfg.codePattern) await s.setConfig('codePattern', pattern);
      if (templateId !== cfg.templateId) await s.setConfig('templateId', templateId);
      showToast('Saved for every device', { icon: 'check-circle' });
      router.back();
    } catch (e) {
      showToast((e as Error).message, { icon: 'alert-circle' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Field label="Program name" value={name} onChangeText={setName} maxLength={120} />
        <Field
          label="Participant code instructions"
          value={hint}
          onChangeText={setHint}
          maxLength={120}
          hint="Shown under the code field so every staff member builds codes the same way."
        />
        <Field
          label="Code format (optional)"
          value={pattern}
          onChangeText={setPattern}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="[A-Z]{2}(0[1-9]|1[0-2])"
          error={patternError}
          hint="A regular expression the code must match after Kitcount removes spaces and punctuation. Leave empty to accept any 3–24 letters and digits."
        />
      </Card>
      <SectionTitle>Default report</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
        {templates.map((e) => (
          <Chip
            key={e.template.id}
            label={e.template.name}
            selected={templateId === e.template.id}
            onPress={() => setTemplateId(e.template.id)}
          />
        ))}
      </View>
      <Body muted style={{ marginBottom: space.lg }}>
        These settings sync to every device in the program.
      </Body>
      <Button big label="Save" icon="content-save" busy={busy} disabled={!!patternError || !name.trim()} onPress={save} />
      <Text style={{ color: t.textMuted, fontSize: font.small, marginTop: space.lg }}>Program fingerprint: {s.fingerprint}</Text>
    </Screen>
  );
}
