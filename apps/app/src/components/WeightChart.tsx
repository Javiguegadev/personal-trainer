import type { Units } from '@pt/contracts';
import { formatShortDate, weightFieldFromKg, type WeightPoint } from '@pt/core';
import { tokens } from '@pt/ui';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type HostInstance } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import { useWeightFormat } from '@/hooks/useWeightFormat';
import { nearestPoint, weightChartModel, type PlottedPoint } from '@/lib/weightChart';
import { AppText } from './AppText';

const HEIGHT = 200;
const BOX = { left: 44, right: 8, top: 12, bottom: 24 };

/**
 * Weight over the chosen range (spec 003 AC14): entries as dots, the 7-day average as a line (left out
 * for protected profiles). Tapping shows the closest entry; the list below is the table view, and the
 * whole chart has a text alternative.
 */
export function WeightChart({
  entries,
  average,
  today,
  days,
  units,
}: {
  entries: readonly WeightPoint[];
  average: readonly WeightPoint[];
  today: string;
  days: number;
  units: Units;
}) {
  const { t, format, locale } = useI18n();
  const { scheme, colors } = useTheme();
  const fmt = useWeightFormat(units);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<PlottedPoint | null>(null);
  const chartRef = useRef<HostInstance>(null);
  const series = tokens.chart[scheme];
  const p = t.progress;

  const model =
    width > 0
      ? weightChartModel({ entries, average, today, days, box: { ...BOX, width, height: HEIGHT } })
      : null;
  const shownSelected =
    selected && model?.points.some((point) => point.localDate === selected.localDate)
      ? model.points.find((point) => point.localDate === selected.localDate)!
      : null;

  const label = model
    ? format(p.chartLabel, {
        days,
        count: model.points.length,
        min: fmt.weight(model.minKg),
        max: fmt.weight(model.maxKg),
      })
    : p.chartEmpty;

  return (
    <View style={styles.wrap} testID="weight-chart">
      <AppText
        variant="caption"
        tone="muted"
        aria-live="polite"
        accessibilityLiveRegion="polite"
        testID="chart-selected"
      >
        {shownSelected
          ? format(p.selected, {
              date: formatShortDate(shownSelected.localDate, locale, days > 90),
              value: fmt.weight(shownSelected.weightKg),
            })
          : model
            ? p.tapHint
            : ' '}
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
          <Pressable
            onPress={(event) => {
              // `locationX` is relative to the element under the finger (a dot, a line) on web, so
              // measure from the chart itself.
              const { pageX } = event.nativeEvent;
              chartRef.current?.measureInWindow((left) =>
                setSelected(nearestPoint(model.points, pageX - left)),
              );
            }}
            accessible={false}
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
              {model.average.length > 1 ? (
                <Polyline
                  points={model.average.map((point) => `${point.x},${point.y}`).join(' ')}
                  stroke={series.average}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
              ) : null}
              {model.points.map((point) => (
                <Circle
                  key={point.localDate}
                  cx={point.x}
                  cy={point.y}
                  r={point.localDate === shownSelected?.localDate ? 6 : 4}
                  fill={series.entries}
                  // A surface ring keeps overlapping dots and the line apart.
                  stroke={
                    point.localDate === shownSelected?.localDate ? colors.text : colors.background
                  }
                  strokeWidth={2}
                />
              ))}
            </Svg>
          </Pressable>
        ) : null}
        {model ? (
          // Labels as app text (same font as the rest of the app on every platform), over the drawing.
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {model.ticks.map((tick) => (
              <AppText
                key={tick.y}
                variant="caption"
                tone="muted"
                style={[styles.tick, { top: tick.y - 10, width: BOX.left - 6 }]}
              >
                {weightFieldFromKg(tick.kg, units, locale)}
              </AppText>
            ))}
            <AppText variant="caption" tone="muted" style={[styles.date, { left: BOX.left }]}>
              {formatShortDate(model.from, locale)}
            </AppText>
            <AppText variant="caption" tone="muted" style={[styles.date, { right: BOX.right }]}>
              {formatShortDate(today, locale)}
            </AppText>
          </View>
        ) : width > 0 ? (
          <View style={styles.empty}>
            <AppText tone="muted">{p.chartEmpty}</AppText>
          </View>
        ) : null}
      </View>
      {average.length > 0 ? (
        <View style={styles.legend} testID="chart-legend">
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: series.entries }]} />
            <AppText variant="caption" tone="muted">
              {p.legendEntries}
            </AppText>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.line, { backgroundColor: series.average }]} />
            <AppText variant="caption" tone="muted">
              {p.legendAverage}
            </AppText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: tokens.space.xs },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tick: { position: 'absolute', left: 0, textAlign: 'right' },
  date: { position: 'absolute', bottom: 0 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { width: 18, height: 2, borderRadius: 1 },
});
