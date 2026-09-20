import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { SimCapWordmark } from '../SimCapWordmark';
import {
  formatShareDifferential,
  formatShareIndex,
  formatShareScoreToPar,
} from './buildShareRoundCardData';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, type ShareRoundCardData } from './types';

type Props = {
  data: ShareRoundCardData;
};

function ShareBrandLockup() {
  return (
    <View style={styles.brandRow} accessibilityRole="image" accessibilityLabel="SimCap">
      <View style={styles.robotWrap}>
        <Svg width="100%" height="100%" viewBox="14 18 64 100" preserveAspectRatio="xMidYMid meet">
          <Rect x="22" y="64" width="48" height="36" rx="6" fill="#2d6a4f" />
          <Rect x="28" y="71" width="36" height="22" rx="3" fill="#0a1810" />
          <Rect x="30" y="98" width="8" height="7" rx="2" fill="#1a3d2b" />
          <Rect x="54" y="98" width="8" height="7" rx="2" fill="#1a3d2b" />
          <Rect x="68" y="71" width="5" height="18" rx="2.5" fill="#2d6a4f" />
          <Circle cx="70" cy="90" r="4" fill="#2d6a4f" />
          <Line x1="70" y1="93" x2="70" y2="110" stroke="#52b788" strokeWidth="2" strokeLinecap="round" />
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
          <Line x1="46" y1="30" x2="46" y2="23" stroke="#52b788" strokeWidth="1.5" strokeLinecap="round" />
          <Circle cx="46" cy="21" r="2.5" fill="#52b788" />
        </Svg>
      </View>
      <View style={styles.wordBlock}>
        <SimCapWordmark accessible={false} fontSize={78} />
        <Text style={styles.brandTagline}>THE SIM GOLF HANDICAP APP</Text>
      </View>
    </View>
  );
}

function MetaIconMonitor({ size = 28, color = '#ffffff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="3" y="4" width="18" height="12" rx="2" stroke={color} strokeWidth="1.8" fill="none" />
      <Line x1="8" y1="20" x2="16" y2="20" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Line x1="12" y1="16" x2="12" y2="20" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function MetaIconCalendar({ size = 28, color = '#ffffff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="4" y="5" width="16" height="15" rx="2" stroke={color} strokeWidth="1.6" fill="none" />
      <Line x1="4" y1="10" x2="20" y2="10" stroke={color} strokeWidth="1.6" />
      <Line x1="8" y1="3.5" x2="8" y2="7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="16" y1="3.5" x2="16" y2="7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

function CondIconPutting({ size = 36, color = '#1a3d2b' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="7" y1="4" x2="7" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M7 4h6l-2 3H7z" fill={color} />
      <Circle cx="16" cy="17" r="2.5" fill={color} />
    </Svg>
  );
}

function CondIconFlag({ size = 36, color = '#1a3d2b' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1="7" y1="20" x2="7" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M7 5 L17 9 L7 13 Z" fill={color} />
    </Svg>
  );
}

function CondIconWind({ size = 36, color = '#1a3d2b' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4 9h11a2.5 2.5 0 100-5"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="M4 13h13a2.5 2.5 0 110 5"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path d="M4 17h8" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function CondIconPerson({ size = 36, color = '#1a3d2b' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="8" r="3.2" fill={color} />
      <Path d="M5.5 19c1.4-3.2 3.6-4.8 6.5-4.8S16.6 15.8 18.5 19" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function CondIconCheck({ size = 34, color = '#52b788' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill={color} />
      <Path
        d="M8 12.5l2.5 2.5L16.5 9"
        fill="none"
        stroke="#122A1F"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

type ConditionCellProps = {
  label: string;
  value: string;
  icon: ReactNode;
};

function ConditionCell({ label, value, icon }: ConditionCellProps) {
  return (
    <View style={styles.condCell}>
      <View style={styles.condTextCol}>
        <Text style={styles.condLabel}>{label}</Text>
        <Text style={styles.condValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
      <View style={styles.condIconWrap}>{icon}</View>
    </View>
  );
}

/**
 * Fixed 1080×1920 share card. Designed for capture via react-native-view-shot.
 */
export function ShareRoundCard({ data }: Props) {
  const scoreToParTxt = formatShareScoreToPar(data.scoreToPar);
  const scoreToParLabel = data.scoreToParLabel ?? (data.scoreToPar === 0 ? 'EVEN PAR' : data.scoreToPar > 0 ? 'OVER PAR' : 'UNDER PAR');
  const pillTone =
    data.scoreToPar < 0 ? styles.pillUnder : data.scoreToPar === 0 ? styles.pillEven : styles.pillOver;

  return (
    <View style={styles.card} collapsable={false}>
      <View style={styles.arcOuter} pointerEvents="none" />
      <View style={styles.arcMid} pointerEvents="none" />
      <View style={styles.arcInner} pointerEvents="none" />

      <View style={styles.brandWrap}>
        <ShareBrandLockup />
      </View>

      <Text style={styles.roundComplete}>
        {data.holesLabel ? `${data.holesLabel.toUpperCase()} COMPLETE` : 'ROUND COMPLETE'}
      </Text>
      <Text
        style={[
          styles.heroScore,
          data.score >= 100 ? styles.heroScore3 : data.score < 10 ? styles.heroScore1 : null,
        ]}
        numberOfLines={1}
      >
        {data.score}
      </Text>
      <View style={[styles.pill, pillTone]}>
        <Text style={styles.pillTxt}>{scoreToParTxt}</Text>
      </View>
      <Text style={styles.parCaption}>{scoreToParLabel}</Text>

      <Text style={styles.courseName} numberOfLines={3}>
        {data.courseName}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <MetaIconMonitor />
          <Text style={styles.metaTxt} numberOfLines={1}>
            {data.simName}
          </Text>
        </View>
        <Text style={styles.metaDot}>•</Text>
        <View style={styles.metaItem}>
          <MetaIconCalendar />
          <Text style={styles.metaTxt} numberOfLines={1}>
            {data.dateLabel}
          </Text>
        </View>
        {data.teeLabel ? (
          <>
            <Text style={styles.metaDot}>•</Text>
            <View style={styles.metaItem}>
              <View style={styles.teeDot} />
              <Text style={styles.metaTxt} numberOfLines={1}>
                {data.teeLabel}
              </Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCol}>
          <Text style={styles.statLbl}>DIFFERENTIAL</Text>
          <Text style={styles.statVal}>{formatShareDifferential(data.differential)}</Text>
          {data.differentialSubtext ? (
            <Text style={styles.statSub}>{data.differentialSubtext}</Text>
          ) : null}
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCol}>
          <Text style={styles.statLbl}>INDEX AFTER</Text>
          <Text style={styles.statVal}>{formatShareIndex(data.indexAfter)}</Text>
          {data.indexAfterSubtext ? <Text style={styles.statSub}>{data.indexAfterSubtext}</Text> : null}
        </View>
      </View>

      <View style={styles.conditionsCard}>
        <Text style={styles.conditionsHead}>CONDITIONS PLAYED</Text>
        <View style={styles.conditionsGrid}>
          <ConditionCell
            label="PUTTING MODE"
            value={data.puttingMode ?? '—'}
            icon={<CondIconPutting />}
          />
          <ConditionCell
            label="PIN PLACEMENT"
            value={data.pinPlacement ?? '—'}
            icon={<CondIconFlag />}
          />
          <ConditionCell label="WIND" value={data.wind ?? '—'} icon={<CondIconWind />} />
          <ConditionCell
            label="MULLIGANS"
            value={data.mulligans ?? '—'}
            icon={<CondIconPerson />}
          />
        </View>
      </View>

      <View style={styles.footerChip}>
        <CondIconCheck />
        <View style={styles.footerTextCol}>
          <Text style={styles.footerTitle}>Logged in SimCap</Text>
          <Text style={styles.footerSub}>Every round. Every sim.</Text>
        </View>
      </View>
    </View>
  );
}

const BG = '#122A1F';
const ARC = '#2D4B3E';
const MUTED = '#6aab8a';
const PILL = '#2E6D4E';

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    backgroundColor: BG,
    borderRadius: 48,
    overflow: 'hidden',
    paddingHorizontal: 72,
    paddingTop: 88,
    paddingBottom: 72,
  },
  arcOuter: {
    position: 'absolute',
    right: -420,
    top: 220,
    width: 980,
    height: 980,
    borderRadius: 490,
    borderWidth: 28,
    borderColor: ARC,
    opacity: 0.55,
  },
  arcMid: {
    position: 'absolute',
    right: -300,
    top: 340,
    width: 760,
    height: 760,
    borderRadius: 380,
    borderWidth: 22,
    borderColor: ARC,
    opacity: 0.45,
  },
  arcInner: {
    position: 'absolute',
    right: -180,
    top: 460,
    width: 540,
    height: 540,
    borderRadius: 270,
    borderWidth: 18,
    borderColor: ARC,
    opacity: 0.35,
  },
  brandWrap: {
    alignItems: 'center',
    marginBottom: 36,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  robotWrap: {
    width: 110,
    aspectRatio: 50 / 82,
    flexShrink: 0,
  },
  wordBlock: {
    justifyContent: 'center',
  },
  brandTagline: {
    marginTop: 8,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '600',
    color: '#6aab8a',
    letterSpacing: 1.4,
  },
  brandLogo: {
    width: 620,
    alignSelf: 'center',
  },
  roundComplete: {
    textAlign: 'center',
    color: MUTED,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
    marginTop: 8,
  },
  heroScore: {
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 220,
    fontWeight: '800',
    lineHeight: 240,
    letterSpacing: -4,
    marginTop: 4,
  },
  heroScore1: {
    fontSize: 240,
    lineHeight: 260,
  },
  heroScore3: {
    fontSize: 180,
    lineHeight: 200,
  },
  pill: {
    alignSelf: 'center',
    minWidth: 160,
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: PILL,
    alignItems: 'center',
  },
  pillOver: {
    backgroundColor: PILL,
  },
  pillEven: {
    backgroundColor: '#3d7a5a',
  },
  pillUnder: {
    backgroundColor: '#52b788',
  },
  pillTxt: {
    color: '#ffffff',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  parCaption: {
    textAlign: 'center',
    color: MUTED,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 18,
  },
  courseName: {
    textAlign: 'center',
    color: '#ffffff',
    fontSize: 52,
    fontWeight: '800',
    lineHeight: 62,
    marginTop: 40,
    paddingHorizontal: 12,
  },
  metaRow: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 14,
    paddingHorizontal: 8,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 280,
  },
  metaTxt: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '600',
  },
  metaDot: {
    color: '#ffffff',
    fontSize: 22,
    opacity: 0.7,
  },
  teeDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
  },
  statsRow: {
    marginTop: 48,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 24,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: ARC,
    opacity: 0.8,
  },
  statLbl: {
    color: MUTED,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2,
  },
  statVal: {
    color: '#ffffff',
    fontSize: 64,
    fontWeight: '800',
    marginTop: 10,
  },
  statSub: {
    color: MUTED,
    fontSize: 22,
    fontWeight: '500',
    marginTop: 10,
    textAlign: 'center',
  },
  conditionsCard: {
    marginTop: 48,
    backgroundColor: '#ffffff',
    borderRadius: 28,
    padding: 28,
  },
  conditionsHead: {
    color: '#5a6b62',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 18,
  },
  conditionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  condCell: {
    width: '48%',
    flexGrow: 1,
    minWidth: '46%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d7e5dd',
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
  },
  condTextCol: {
    flex: 1,
    minWidth: 0,
  },
  condLabel: {
    color: '#8a9a92',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  condValue: {
    color: '#1a1a1a',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 8,
  },
  condIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#E8F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerChip: {
    marginTop: 'auto',
    alignSelf: 'center',
    minWidth: 560,
    backgroundColor: '#0d1f17',
    borderRadius: 999,
    paddingVertical: 22,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  footerTextCol: {
    flexShrink: 1,
  },
  footerTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
  },
  footerSub: {
    color: MUTED,
    fontSize: 22,
    fontWeight: '500',
    marginTop: 4,
  },
});
