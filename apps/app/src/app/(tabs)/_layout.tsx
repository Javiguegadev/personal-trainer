import { tokens } from '@pt/ui';
import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabIcon, type TabIconName } from '@/components/TabIcon';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';

/**
 * The tab shell (spec 003 AC1): Today, Food (spec 005), Progress and Profile. JS tabs from expo-router, which render the
 * same on iOS, Android and web; the selected tab is announced by the tab bar and shown with a filled
 * icon and a bold label, not by colour alone.
 */
export default function TabsLayout() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const options = (name: TabIconName, title: string) => ({
    title,
    tabBarAccessibilityLabel: title,
    tabBarButtonTestID: `tab-${name}`,
    tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <TabIcon name={name} color={color} focused={focused} />
    ),
    tabBarLabel: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <Text
        style={{
          color,
          fontSize: tokens.fontSize.caption,
          fontWeight: focused ? '800' : '500',
        }}
      >
        {title}
      </Text>
    ),
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          // The default bar (48 px) clips a 24 px icon plus its label; keep room for the home indicator.
          height: 56 + insets.bottom,
        },
      }}
    >
      <Tabs.Screen name="index" options={options('today', t.tabs.today)} />
      <Tabs.Screen name="food" options={options('food', t.tabs.food)} />
      <Tabs.Screen name="progress" options={options('progress', t.tabs.progress)} />
      <Tabs.Screen name="profile" options={options('profile', t.tabs.profile)} />
    </Tabs>
  );
}
