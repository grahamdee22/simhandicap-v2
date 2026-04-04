import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../lib/constants';
import { mergeViewStyles } from '../lib/mergeStyles';
import { useResponsive } from '../lib/responsive';

/**
 * Centers content and grows usable width on tablets / web instead of a skinny phone column.
 * Merges styles into a single plain object so react-native-web never forwards an array to the DOM.
 */
export function ContentWidth({
  children,
  style,
  contentStyle,
  bg = colors.bg,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  bg?: string;
}) {
  const { maxContent } = useResponsive();

  const innerStyle = useMemo(
    () =>
      mergeViewStyles(
        stylesInner,
        Platform.OS === 'web'
          ? {
              width: '100%' as const,
              maxWidth: maxContent,
              /** Center the column on web; stretch was forcing full viewport width and visual asymmetry. */
              alignSelf: 'center' as const,
              position: 'relative' as const,
              zIndex: 0,
            }
          : {
              width: '100%' as const,
              maxWidth: maxContent,
            },
        contentStyle
      ),
    [maxContent, contentStyle]
  );

  const outerMerged = useMemo(
    () =>
      mergeViewStyles(stylesOuter, {
        backgroundColor: bg,
      }, style),
    [bg, style]
  );

  return (
    <View style={outerMerged}>
      <View style={innerStyle}>{children}</View>
    </View>
  );
}

/** Plain objects — not StyleSheet.create — so mergeViewStyles never sees opaque numeric refs on web edge cases. */
const stylesOuter: ViewStyle = {
  flex: 1,
  width: '100%',
  minHeight: 0,
  alignItems: 'center',
  alignSelf: 'stretch',
};

const stylesInner: ViewStyle = {
  flex: 1,
  minHeight: 0,
  alignSelf: 'center',
};
