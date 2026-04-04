import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { colors } from '../lib/constants';
import { formatHandicapIndexDisplay } from '../lib/handicap';
import type { ChartPoint } from '../lib/realVsSim';

type Props = {
  width: number;
  height: number;
  simPts: ChartPoint[];
  realPts: ChartPoint[];
  yMin: number;
  yMax: number;
  tMin: number;
  tMax: number;
};

const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 8;
const PAD_B = 26;

function DualIndexChartInner({ width, height, simPts, realPts, yMin, yMax, tMin, tMax }: Props) {
  const iw = Math.max(1, width - PAD_L - PAD_R);
  const ih = Math.max(1, height - PAD_T - PAD_B);

  const toXY = (p: ChartPoint) => ({
    x: PAD_L + p.nx * iw,
    y: PAD_T + p.ny * ih,
  });

  const simXY = simPts.map(toXY);
  const realXY = realPts.map(toXY);

  const simPointsStr = simXY.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const realPointsStr = realXY.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const fmtShort = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const y0 = PAD_T + ih;
  const x0 = PAD_L;
  const x1 = PAD_L + iw;

  return (
    <View style={styles.wrap}>
      <Svg width={width} height={height}>
        <Line x1={x0} y1={y0} x2={x1} y2={y0} stroke={colors.border} strokeWidth={1} />
        <Line x1={x0} y1={PAD_T} x2={x0} y2={y0} stroke={colors.border} strokeWidth={1} />

        {simPts.length >= 2 ? (
          <Polyline
            points={simPointsStr}
            fill="none"
            stroke={colors.sage}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {simPts.length === 1 ? (
          <Circle cx={simXY[0].x} cy={simXY[0].y} r={4} fill={colors.sage} />
        ) : null}

        {realPts.length >= 2 ? (
          <Polyline
            points={realPointsStr}
            fill="none"
            stroke={colors.warn}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {realPts.length === 1 ? (
          <Circle cx={realXY[0].x} cy={realXY[0].y} r={4} fill={colors.warn} />
        ) : null}

        <SvgText x={4} y={PAD_T + 10} fontSize={9} fill={colors.subtle}>
          {formatHandicapIndexDisplay(yMax)}
        </SvgText>
        <SvgText x={4} y={y0 - 4} fontSize={9} fill={colors.subtle}>
          {formatHandicapIndexDisplay(yMin)}
        </SvgText>
        <SvgText x={PAD_L} y={height - 6} fontSize={9} fill={colors.subtle}>
          {fmtShort(tMin)}
        </SvgText>
        <SvgText x={width - 8} y={height - 6} fontSize={9} fill={colors.subtle} textAnchor="end">
          {fmtShort(tMax)}
        </SvgText>
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: colors.sage }]} />
          <Text style={styles.legendTxt}>Sim index</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: colors.warn }]} />
          <Text style={styles.legendTxt}>GHIN (real)</Text>
        </View>
      </View>
    </View>
  );
}

export const DualIndexChart = memo(DualIndexChartInner);

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8, paddingLeft: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { fontSize: 11, fontWeight: '600', color: colors.muted },
});
