import * as Linking from 'expo-linking';
import { Text, View } from 'react-native';

import { buildInfo } from '../platform/buildInfo';
import { Body, Card, Divider, ListRow, Screen } from '../ui/components';
import { Logo } from '../ui/Logo';
import { font, space, useTheme } from '../ui/theme';

const REPO = 'https://github.com/lobojoel2003/Kitcount';

export function About() {
  const t = useTheme();
  const info = buildInfo();
  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
        <Logo size={80} />
        <Text style={{ color: t.text, fontSize: font.heading, fontWeight: '900', marginTop: space.md }}>Kitcount</Text>
        <Text style={{ color: t.textMuted, fontSize: font.body, marginTop: 4 }}>
          Version {info.version} · build {info.build} · {info.commit}
        </Text>
      </View>
      <Body muted style={{ textAlign: 'center', marginBottom: space.xl }}>
        Free and open-source software for syringe services programs. Made to protect the people you serve.
      </Body>
      <Card style={{ paddingVertical: space.xs }}>
        <ListRow icon="github" title="Source code" subtitle={REPO.replace('https://', '')} onPress={() => void Linking.openURL(REPO)} />
        <Divider />
        <ListRow
          icon="file-document-outline"
          title="Report templates"
          subtitle="How to add your state's form"
          onPress={() => void Linking.openURL(`${REPO}/blob/main/docs/report-templates.md`)}
        />
        <Divider />
        <ListRow
          icon="shield-account-outline"
          title="Privacy & threat model"
          onPress={() => void Linking.openURL(`${REPO}/blob/main/docs/privacy-and-security.md`)}
        />
        <Divider />
        <ListRow
          icon="scale-balance"
          title="License"
          subtitle="App: GPL-3.0-or-later · Server: AGPL-3.0"
          onPress={() => void Linking.openURL(`${REPO}/blob/main/LICENSE`)}
        />
      </Card>
    </Screen>
  );
}
