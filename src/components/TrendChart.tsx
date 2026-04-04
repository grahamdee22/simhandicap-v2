import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { colors } from '../lib/constants';

export type TrendRange = '1M' | '3M' | '1Y';

type Point = { t: number; index: number; label?: string };

type PlotCoord = { x: number; y: number; index: number };

const DEFAULT_W = 272;
const DEFAULT_H = 80;
const PAD_L = 28;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 18;

function filterByRange(points: Point[], range: TrendRange): Point[] {
  if (points.length === 0) return [];
  const last = points[points.length - 1].t;
  const ms =
    range === '1M' ? 30 * 24 * 60 * 60 * 1000 : range === '3M' ? 90 * 24 * 60 * 60 * 1000 : 365 * 24 * 60 * 60 * 1000;
  const cut = last - ms;
  return points.filter((p) => p.t >= cut);
}

/**
 * Trend line: lower handicap toward the bottom of the chart (improving ↓).
 * Y maps with (max - index) so higher handicap sits toward the top.
 */
export function TrendChart({
  history,
  range,
  onRangeChange,
  plotWidth,
  plotHeight,
  edgePad,
}: {
  history: { date: string; index: number }[];
  range: TrendRange;
  onRangeChange: (r: TrendRange) => void;
  /** Logical width for path math (SVG viewBox). Scales with container. */
  plotWidth?: number;
  plotHeight?: number;
  edgePad?: number;
}) {
  const W = Math.max(240, plotWidth ?? DEFAULT_W);
  const H = Math.max(64, plotHeight ?? DEFAULT_H);
  const padH = edgePad ?? 14;

  const pts = useMemo(() => {
    const base: Point[] = history.map((h) => ({
      t: new Date(h.date).getTime(),
      index: h.index,
    }));
    const f = filterByRange(base, range);
    if (f.length === 0) {
      return { svgPts: '', areaD: '', min: 0, max: 0, first: null as PlotCoord | null, last: null as PlotCoord | null };
    }
    let min = Math.min(...f.map((p) => p.index));
    let max = Math.max(...f.map((p) => p.index));
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    const t0 = f[0].t;
    const t1 = f[f.length - 1].t || t0 + 1;
    const coords = f.map((p) => {
      const x = PAD_L + ((p.t - t0) / (t1 - t0 || 1)) * innerW;
      const yn = (max - p.index) / (max - min);
      const y = PAD_T + yn * innerH;
      return { x, y, index: p.index };
    });
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const lastC = coords[coords.length - 1];
    const areaD = `${line} L${lastC.x.toFixed(1)},${H} L${coords[0].x.toFixed(1)},${H} Z`;
    return {
      svgPts: line,
      areaD,
      min,
      max,
      first: coords[0],
      last: coords[coords.length - 1],
    };
  }, [history, range, W, H]);

  const labelSize = W > 400 ? 10 : 8;

  return (
    <View style={[styles.wrap, { paddingHorizontal: padH, paddingTop: 12 }]}>
      <View style={styles.hdr}>
        <Text style={[styles.title, W > 400 && styles.titleLg]}>Index trend</Text>
        <View style={styles.tabs}>
          {(['1M', '3M', '1Y'] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => onRangeChange(r)}
              style={({ pressed }) => [
                styles.tab,
                range === r && styles.tabOn,
                pressed && !(range === r) && styles.tabPressed,
              ]}
            >
              <Text style={[styles.tabTxt, range === r && styles.tabTxtOn, W > 400 && styles.tabTxtLg]}>{r}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {history.length === 0 ? (
        <Text style={styles.empty}>Log rounds to see your sim index trend.</Text>
      ) : (
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
          <Defs>
            <LinearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={colors.sage} stopOpacity="0.2" />
              <Stop offset="100%" stopColor={colors.sage} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          {pts.areaD ? <Path d={pts.areaD} fill="url(#tg)" /> : null}
          {pts.svgPts ? (
            <Path
              d={pts.svgPts}
              fill="none"
              stroke={colors.sage}
              strokeWidth={W > 400 ? 2.5 : 2}
              strokeLinecap="round"
            />
          ) : null}
          {pts.first ? (
            <SvgText x={PAD_L} y={pts.first.y + 5} fontSize={labelSize} fill={colors.subtle}>
              {pts.max.toFixed(1)}
            </SvgText>
          ) : null}
          {pts.last ? (
            <SvgText
              x={W - 40}
              y={pts.last.y + 5}
              fontSize={labelSize}
              fill={colors.sage}
              fontWeight="600"
            >
              {pts.last.index.toFixed(1)}
            </SvgText>
          ) : null}
        </Svg>
      )}
      <Text style={[styles.hint, W > 400 && styles.hintLg]}>
        Lower on the chart = better (lower) sim index.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  hdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 12, fontWeight: '700', color: colors.ink },
  titleLg: { fontSize: 14 },
  tabs: { flexDirection: 'row', gap: 2, backgroundColor: colors.bg, borderRadius: 8, padding: 3 },
  tab: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  tabOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent, borderRadius: 6 },
  tabPressed: { opacity: 0.72 },
  tabTxt: { fontSize: 10, fontWeight: '600', color: colors.subtle },
  tabTxtLg: { fontSize: 11 },
  tabTxtOn: { color: colors.accent, fontWeight: '700' },
  empty: { fontSize: 12, color: colors.muted, paddingVertical: 16 },
  hint: { fontSize: 10, color: colors.subtle, marginTop: 4 },
  hintLg: { fontSize: 11 },
});
