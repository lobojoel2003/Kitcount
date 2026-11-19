import { Tabs } from 'expo-router/js-tabs';

import { useSession } from '../../state/KitcountProvider';
import { Icon } from '../../ui/Icon';
import { useTheme } from '../../ui/theme';

export default function TabsLayout() {
  const s = useSession();
  const t = useTheme();
  const low = s.ledger.lowStock(s.deviceId).length;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        tabBarLabelStyle: { fontWeight: '700' },
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '900', fontSize: 22 },
        headerTitleAlign: 'left',
        sceneStyle: { backgroundColor: t.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Log visit',
          tabBarLabel: 'Log',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="clipboard-plus-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarBadge: low > 0 ? low : undefined,
          tabBarBadgeStyle: { backgroundColor: t.danger, color: '#fff', fontWeight: '800' },
          tabBarIcon: ({ color, size }) => <Icon name="package-variant" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: 'Reports', tabBarIcon: ({ color, size }) => <Icon name="file-chart-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Icon name="cog-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
