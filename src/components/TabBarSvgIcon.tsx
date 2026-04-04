import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { IconAnalyticsBars } from './SvgUiIcons';

export type TabBarSvgName = 'home' | 'add-circle' | 'analytics' | 'people' | 'person';

type Props = {
  name: TabBarSvgName;
  color: string;
  size?: number;
};

/**
 * Tab bar glyphs as SVG (no icon font). Avoids Ionicons.ttf on web static hosts
 * (Surge, etc.) where font URLs or MIME types often break and icons render as empty squares.
 */
export function TabBarSvgIcon({ name, color, size = 22 }: Props) {
  if (name === 'analytics') {
    return <IconAnalyticsBars size={size} color={color} />;
  }

  const s = size;
  const vb = 24;

  const glyph = (() => {
    switch (name) {
      case 'home':
        return (
          <Path
            fill={color}
            d="M4 10.2L12 3l8 7.2V20a1 1 0 0 1-1 1h-5v-6.5H10V21H5a1 1 0 0 1-1-1v-9.8z"
          />
        );
      case 'add-circle':
        return (
          <>
            <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" fill="none" />
            <Path
              d="M12 8v8M8 12h8"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        );
      case 'people':
        return (
          <>
            <Circle cx="9" cy="9" r="3" fill={color} />
            <Path
              d="M4 18.5c0-2.2 2-4 5-4s5 1.8 5 4v.5H4v-.5z"
              fill={color}
            />
            <Circle cx="17" cy="8.5" r="2.5" fill={color} opacity={0.9} />
            <Path
              d="M14 17.5c0-1.6 1.4-2.8 3.5-2.8.8 0 1.5.2 2 .5v2.3h-5v.5z"
              fill={color}
              opacity={0.9}
            />
          </>
        );
      case 'person':
        return (
          <>
            <Circle cx="12" cy="8.5" r="3.5" fill={color} />
            <Path
              d="M6 19.5c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5v.5H6v-.5z"
              fill={color}
            />
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox={`0 0 ${vb} ${vb}`}>
        {glyph}
      </Svg>
    </View>
  );
}
