import { defaultLocale, messages } from '@pt/i18n';
import { tokens } from '@pt/ui';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/lib/api';

const t = messages[defaultLocale];

type ApiStatus = { state: 'loading' } | { state: 'online'; version: string } | { state: 'offline' };

export default function HomeScreen() {
  const dark = useColorScheme() === 'dark';
  const [status, setStatus] = useState<ApiStatus>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => !cancelled && setStatus({ state: 'online', version: h.version }))
      .catch(() => !cancelled && setStatus({ state: 'offline' }));
    return () => {
      cancelled = true;
    };
  }, []);

  const fg = dark ? '#f4f6f4' : '#111827';
  const muted = dark ? '#9aa59f' : '#56615b';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? '#0b0f0d' : '#f6f8f6' }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.title, { color: fg }]}>{t.app.name}</Text>
        <Text style={[styles.tagline, { color: muted }]}>{t.app.tagline}</Text>

        <View style={styles.chips}>
          {Object.values(t.nav).map((label) => (
            <View
              key={label}
              style={[styles.chip, { backgroundColor: dark ? '#1b2420' : '#ffffff' }]}
            >
              <Text style={{ color: fg }}>{label}</Text>
            </View>
          ))}
        </View>

        <Text style={{ color: muted }} testID="api-status">
          API: {status.state === 'loading' && '…'}
          {status.state === 'online' && (
            <Text style={{ color: tokens.color.brand, fontWeight: '600' }}>
              online (v{status.version})
            </Text>
          )}
          {status.state === 'offline' && (
            <Text style={{ color: tokens.color.fat, fontWeight: '600' }}>offline</Text>
          )}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    paddingTop: tokens.space.xl * 2,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { fontSize: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
  chip: {
    borderRadius: 999,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs + 2,
  },
});
