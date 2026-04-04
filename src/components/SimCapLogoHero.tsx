import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText, TSpan } from 'react-native-svg';

const FONT_UI = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'system-ui',
});

/** viewBox width / height — dark lockup art (no card background). */
export const SIM_CAP_LOGO_ASPECT = 270 / 118;

type Props = {
  style?: StyleProp<ViewStyle>;
};

/**
 * Sim Cap horizontal wordmark for dark hero bands — robot + type, transparent
 * (no solid plate behind the mark). Left-aligned within its box.
 */
export function SimCapLogoHero({ style }: Props) {
  return (
    <View
      style={style}
      accessibilityRole="image"
      accessibilityLabel="Sim Cap, sim golf handicap"
    >
      <Svg width="100%" height="100%" viewBox="10 10 270 118" preserveAspectRatio="xMinYMid meet">
        <Rect x="22" y="64" width="48" height="36" rx="6" fill="#2d6a4f" />
        <Rect x="28" y="71" width="36" height="22" rx="3" fill="#0a1810" />
        <Rect x="30" y="98" width="8" height="7" rx="2" fill="#1a3d2b" />
        <Rect x="54" y="98" width="8" height="7" rx="2" fill="#1a3d2b" />
        <Rect x="68" y="71" width="5" height="18" rx="2.5" fill="#2d6a4f" />
        <Circle cx="70" cy="90" r="4" fill="#2d6a4f" />
        <Line
          x1="70"
          y1="93"
          x2="70"
          y2="110"
          stroke="#52b788"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <Rect x="63" y="108" width="14" height="7" rx="3.5" fill="#52b788" />
        <Circle cx="59" cy="107" r="2.5" fill="#ffffff" />
        <Rect x="28" y="44" width="36" height="22" rx="8" fill="#2d6a4f" />
        <Rect x="35" y="51" width="6" height="6" rx="1.5" fill="#0a1810" />
        <Rect x="49" y="51" width="6" height="6" rx="1.5" fill="#0a1810" />
        <Rect x="37" y="53" width="2.5" height="2.5" rx="1" fill="#52b788" />
        <Rect x="51" y="53" width="2.5" height="2.5" rx="1" fill="#52b788" />
        <Rect x="22" y="44" width="48" height="6" rx="3" fill="#1a3d2b" />
        <Rect x="28" y="30" width="36" height="17" rx="7" fill="#1a3d2b" />
        <Circle cx="46" cy="37" r="3" fill="#52b788" />
        <Rect x="16" y="44" width="18" height="5" rx="2.5" fill="#163321" />
        <Line
          x1="46"
          y1="30"
          x2="46"
          y2="23"
          stroke="#52b788"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <Circle cx="46" cy="21" r="2.5" fill="#52b788" />
        <SvgText
          x="96"
          y="80"
          fontFamily={FONT_UI}
          fontSize="34"
          fontWeight="800"
          letterSpacing="-0.5"
        >
          <TSpan fill="#ffffff">Sim</TSpan>
          <TSpan fill="#52b788" dx="4">
            Cap
          </TSpan>
        </SvgText>
        <SvgText
          x="96"
          y="96"
          fontFamily={FONT_UI}
          fontSize="11"
          fontWeight="500"
          fill="#6aab8a"
          letterSpacing="0.8"
        >
          SIM GOLF HANDICAP
        </SvgText>
      </Svg>
    </View>
  );
}
