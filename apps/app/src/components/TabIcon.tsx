import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type TabIconName = 'today' | 'food' | 'training' | 'progress' | 'profile';

/**
 * Tab icons drawn with react-native-svg (works on iOS, Android and web). The selected tab is filled, so
 * the selection is not shown by colour alone (spec 003 AC1).
 */
export function TabIcon({
  name,
  color,
  focused,
  size = 24,
}: {
  name: TabIconName;
  color: ColorValue;
  focused: boolean;
  size?: number;
}) {
  const fill = focused ? color : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'today' ? (
        <>
          <Rect
            x={3.5}
            y={5}
            width={17}
            height={15.5}
            rx={3}
            stroke={color}
            strokeWidth={2}
            fill="none"
          />
          <Path d="M3.5 10h17" stroke={color} strokeWidth={2} />
          <Path d="M8 3v4M16 3v4" stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Rect
            x={7.5}
            y={13}
            width={4}
            height={4}
            rx={1}
            fill={fill}
            stroke={color}
            strokeWidth={1.5}
          />
        </>
      ) : name === 'food' ? (
        <>
          <Path
            d="M3 11h18c0 4.6-3.8 8.5-9 8.5S3 15.6 3 11Z"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            fill={fill}
          />
          <Path
            d="M9 3.5c-1 1.4 1 2.4 0 4M14.5 3.5c-1 1.4 1 2.4 0 4"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
          />
        </>
      ) : name === 'training' ? (
        <>
          <Rect
            x={2.5}
            y={8.5}
            width={3.5}
            height={7}
            rx={1}
            stroke={color}
            strokeWidth={2}
            fill={fill}
          />
          <Rect
            x={18}
            y={8.5}
            width={3.5}
            height={7}
            rx={1}
            stroke={color}
            strokeWidth={2}
            fill={fill}
          />
          <Rect
            x={6}
            y={6}
            width={3}
            height={12}
            rx={1}
            stroke={color}
            strokeWidth={2}
            fill={fill}
          />
          <Rect
            x={15}
            y={6}
            width={3}
            height={12}
            rx={1}
            stroke={color}
            strokeWidth={2}
            fill={fill}
          />
          <Path d="M9 12h6" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : name === 'progress' ? (
        <>
          {focused ? <Path d="M3 19 9 12l4 3 8-9v13H3Z" fill={color} opacity={0.35} /> : null}
          <Path
            d="M3 19 9 12l4 3 8-9"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <Path d="M3 21h18" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : (
        <>
          <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={2} fill={fill} />
          <Path
            d="M4 20.5c1.2-4 4.3-6 8-6s6.8 2 8 6"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            fill={fill}
          />
        </>
      )}
    </Svg>
  );
}
