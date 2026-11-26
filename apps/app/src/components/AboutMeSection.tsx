import { tokens } from '@pt/ui';
import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';

/** One thing the app knows (spec 014 AC11), and what can be done with it (AC12). */
export interface AboutMeItem {
  key: string;
  label: string;
  value: string;
  /** "Cambiar" opens the screen where it is edited today. */
  change?: Href;
  /** "Borrar" for an optional item; disabled offline (AC15). */
  clear?: () => void;
  /** A required item says why it has no "Borrar". */
  required?: boolean;
}

/** A group of "Lo que sé de ti": its items, each with "Cambiar" and, when optional, "Borrar". */
export function AboutMeSection({
  title,
  items,
  online,
  children,
  testID,
}: {
  title: string;
  items: readonly AboutMeItem[];
  online: boolean;
  /** Group actions under the items ("Borrar mis check-ins"). */
  children?: ReactNode;
  testID?: string;
}) {
  const { t, format } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const a = t.aboutMe;
  return (
    <Card title={title} testID={testID}>
      {items.map((item, index) => (
        <View
          key={item.key}
          style={[
            styles.item,
            index > 0 && {
              borderTopColor: colors.border,
              borderTopWidth: StyleSheet.hairlineWidth,
            },
          ]}
          testID={`about-${item.key}`}
        >
          <View style={styles.text}>
            <AppText variant="caption" tone="muted">
              {item.label}
            </AppText>
            <AppText testID={`about-${item.key}-value`}>{item.value}</AppText>
            {item.required ? (
              <AppText variant="caption" tone="muted">
                {a.required}
              </AppText>
            ) : null}
          </View>
          {item.change || item.clear ? (
            <View style={styles.actions}>
              {item.change ? (
                <Button
                  variant="ghost"
                  label={a.change}
                  accessibilityLabel={format(a.changeA11y, { item: item.label })}
                  onPress={() => router.push(item.change!)}
                  testID={`about-${item.key}-change`}
                />
              ) : null}
              {item.clear ? (
                <Button
                  variant="ghost"
                  label={a.clear}
                  accessibilityLabel={format(a.clearA11y, { item: item.label })}
                  onPress={item.clear}
                  disabled={!online}
                  testID={`about-${item.key}-clear`}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
      {!online && items.some((item) => item.clear) ? (
        <AppText variant="caption" tone="muted">
          {a.needsConnection}
        </AppText>
      ) : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  item: { gap: tokens.space.xs, paddingTop: tokens.space.sm },
  text: { gap: 2 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
    marginLeft: -tokens.space.md,
  },
});
