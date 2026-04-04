import { useLayoutEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/** Must match the fallback used when the exporter has no window (0×0). */
const SSR_FALLBACK_W = 390;
const SSR_FALLBACK_H = 844;

/**
 * Breakpoints tuned for phones, tablets, and web (Chrome device toolbar / resize).
 */
export function useResponsive() {
  const { width: rawW, height: rawH } = useWindowDimensions();
  // Static export (Node) has 0×0 window → use fallbacks so layout math stays valid.
  const [webLayoutReady, setWebLayoutReady] = useState(false);
  useLayoutEffect(() => {
    if (Platform.OS === 'web') setWebLayoutReady(true);
  }, []);

  // On web, the first client render must use the same dimensions as SSR (fallback), or
  // maxContent / styles differ from the pre-rendered HTML → hydration mismatch → blank page
  // after a brief flash. After layout, switch to real window size.
  const W =
    Platform.OS === 'web' && !webLayoutReady
      ? SSR_FALLBACK_W
      : rawW > 8
        ? rawW
        : SSR_FALLBACK_W;
  const H =
    Platform.OS === 'web' && !webLayoutReady
      ? SSR_FALLBACK_H
      : rawH > 8
        ? rawH
        : SSR_FALLBACK_H;

  const landscape = W > H;
  const shortEdge = Math.min(W, H);
  const longEdge = Math.max(W, H);

  /** Horizontal inset — tighter on web so content uses more of the canvas. */
  const gutter =
    Platform.OS === 'web'
      ? Math.min(32, Math.max(8, Math.round(W * 0.018)))
      : Math.min(
          44,
          Math.round(
            shortEdge < 360 ? 8 : shortEdge < 420 ? 10 : shortEdge < 600 ? 12 + shortEdge * 0.01 : 16 + shortEdge * 0.01
          )
        );

  const inner = Math.max(W - gutter * 2, 280);

  /**
   * Native: cap width for readability on tablets/desktop.
   * Web: use (almost) full viewport width — the old 560–1200 caps caused a skinny “phone column”
   * on desktop with huge side gutters.
   */
  const maxContent =
    Platform.OS === 'web'
      ? Math.max(280, Math.min(inner, 1920))
      : Math.max(
          280,
          Math.min(
            inner,
            W < 420
              ? inner
              : W < 600
                ? Math.min(inner, 560)
                : W < 840
                  ? Math.min(inner, 760)
                  : W < 1100
                    ? Math.min(inner, 1000)
                    : Math.min(inner, 1200)
          )
        );

  /** Rendered column width (ContentWidth inner). */
  const columnWidth = Math.min(W, maxContent);
  /** Width inside horizontal gutter — hero text, cards, stats row should share this. */
  const contentMaxWidth = Math.max(260, columnWidth - 2 * gutter);

  const isWide = W >= 640;
  const isVeryWide = W >= 900;
  /** Side-by-side home: tablet landscape or comfortable desktop width. */
  const homeSplit =
    (landscape && shortEdge >= 340 && W >= 620) || W >= 880;

  /** Trend card interior ≈ content width minus TrendChart edge padding (12×2). */
  const chartWidth = Math.max(260, Math.floor(contentMaxWidth - 24));
  const chartHeight = isVeryWide ? 120 : isWide ? 100 : 82;

  /**
   * Stack home stat cards only when the *content* column is very narrow.
   * Portrait phones (~390px wide) must stay in a row — do not use shortEdge here
   * or every phone stacks incorrectly.
   */
  const isCompactHome = maxContent < 352;

  return {
    width: W,
    height: H,
    landscape,
    shortEdge,
    longEdge,
    gutter,
    maxContent,
    columnWidth,
    contentMaxWidth,
    isWide,
    isVeryWide,
    homeSplit,
    chartWidth,
    chartHeight,
    isCompactHome,
  };
}
