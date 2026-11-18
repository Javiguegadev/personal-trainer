import { formatShortDate } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type HostInstance } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useI18n } from '@/hooks/useI18n';
import type { SetFormat } from '@/hooks/useSetFormat';
import { useTheme } from '@/hooks/useTheme';
import { progressChartModel, type PlottedProgress, type ProgressPoint } from '@/lib/progressChart';
import { nearestPoint } from '@/lib/weightChart';
import { AppText } from './AppText';

const HEIGHT = 180;
const BOX = { left: 52, right: 10, top: 12, bottom: 24 };

/**
 * The best estimated 1RM of each session (spec 009 AC15): one series, so no legend (the title names
 * it); a 2 px line with dots, tap for the value of a session. The session list below is the table
 * view, and the whole chart has a text alternative. Colour from the validated weight-chart token.
 */
export function ExerciseProgressChart({
  points,
  fmt,
}: {
  points: readonly ProgressPoint[];
  fmt: SetFormat;
}) {
  const { t, format, locale } = useI18n();
  const { scheme, colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<PlottedProgress | null>(null);
  const chartRef = useRef<HostInstance>(null);
  const color = tokens.chart[scheme].entries;
  const e = t.training.exercise;
  const model = width > 0 ? progressChartModel(points, { ...BOX, width, height: HEIGHT }) : null;
  const shown = selected && model?.points.find((p) => p.localDate === selected.localDate);
  const label = format(e.chartLabel, {
    count: points.length,
    min: fmt.weight(Math.min(...points.map((p) => p.value))),
    max: fmt.weight(Math.max(...points.map((p) => p.value))),
  });

  return (
    <View style={styles.wrap} testID="exercise-chart">
      <AppText variant="subtitle" weight="bold" accessibilityRole="header">
        {e.chartTitle}
      </AppText>
      <AppText variant="caption" tone="muted" aria-live="polite" accessibilityLiveRegion="polite">
        {shown
          ? format(e.chartSelected, {
              date: formatShortDate(shown.localDate, locale),
              value: fmt.weight(shown.value),
            })
          : e.chartHint}
      </AppText>
      <View
        role="img"
        aria-label={label}
        accessible
        accessibilityLabel={label}
        ref={chartRef}
        style={{ height: HEIGHT }}
        onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
      >
        {model ? (
          <>
            <Pressable
              accessible={false}
              onPress={(event) => {
                const { pageX } = event.nativeEvent;
                chartRef.current?.measureInWindow((left) =>
                  setSelected(nearestPoint(model.points, pageX - left)),
                );
              }}
            >
              <Svg width={width} height={HEIGHT}>
                {model.ticks.map((tick) => (
                  <Line
                    key={tick.y}
                    x1={BOX.left}
                    x2={width - BOX.right}
                    y1={tick.y}
                    y2={tick.y}
                    stroke={colors.border}
                    strokeWidth={1}
                  />
                ))}
                <Polyline
                  points={model.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
                {model.points.map((p, index) => (
                  <Circle
                    key={`${p.localDate}-${index}`}
                    cx={p.x}
                    cy={p.y}
                    r={p.localDate === shown?.localDate ? 6 : 4}
                    fill={color}
                    stroke={p.localDate === shown?.localDate ? colors.text : colors.background}
                    strokeWidth={2}
                  />
                ))}
              </Svg>
            </Pressable>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {model.ticks.map((tick) => (
                <AppText
                  key={tick.y}
                  variant="caption"
                  tone="muted"
                  style={[styles.tick, { top: tick.y - 10, width: BOX.left - 6 }]}
                >
                  {fmt.weightField(tick.value)}
                </AppText>
              ))}
              <AppText variant="caption" tone="muted" style={[styles.date, { left: BOX.left }]}>
                {formatShortDate(model.points[0]!.localDate, locale)}
              </AppText>
              <AppText variant="caption" tone="muted" style={[styles.date, { right: BOX.right }]}>
                {formatShortDate(model.points.at(-1)!.localDate, locale)}
              </AppText>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: tokens.space.xs },
  tick: { position: 'absolute', left: 0, textAlign: 'right' },
  date: { position: 'absolute', bottom: 0 },
});
