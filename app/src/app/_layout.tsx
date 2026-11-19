import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { Lock } from '../screens/Lock';
import { Welcome } from '../screens/Welcome';
import { KitcountProvider, useSession } from '../state/KitcountProvider';
import { useTheme } from '../ui/theme';
import { ToastHost } from '../ui/Toast';

function Gate() {
  const s = useSession();
  const t = useTheme();

  if (s.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.primary} size="large" />
      </View>
    );
  }
  // The navigator (and every screen holding data) unmounts while locked.
  if (s.status === 'welcome') return <Welcome />;
  if (s.status === 'locked') return <Lock />;

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: t.bg },
          headerBackTitle: 'Back',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="history" options={{ title: 'Visit history' }} />
        <Stack.Screen name="sync" options={{ title: 'Sync' }} />
        <Stack.Screen name="stock" options={{ title: 'Update stock', presentation: 'modal' }} />
        <Stack.Screen name="share" options={{ title: 'Add a device' }} />
        <Stack.Screen name="supplies" options={{ title: 'Supplies & referrals' }} />
        <Stack.Screen name="program" options={{ title: 'Program details' }} />
        <Stack.Screen name="security" options={{ title: 'PIN & duress PIN' }} />
        <Stack.Screen name="about" options={{ title: 'About' }} />
      </Stack>
      <ToastHost />
    </>
  );
}

function Themed() {
  const t = useTheme();
  const base = t.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, primary: t.primary, background: t.bg, card: t.surface, text: t.text, border: t.border },
      }}>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <Gate />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <KitcountProvider>
      <Themed />
    </KitcountProvider>
  );
}
