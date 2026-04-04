import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../src/components/ContentWidth';
import { GolferPickerModal } from '../../src/components/GolferPickerModal';
import { IconCheckmark } from '../../src/components/SvgUiIcons';
import { PLATFORMS, colors, type PlatformId } from '../../src/lib/constants';
import { COURSE_SEEDS, getCourseById, ratingForCourse } from '../../src/lib/courses';
import { DUMMY_NET_GOLFERS, dummyGolferById } from '../../src/lib/dummyNetGolfers';
import {
  courseParFromSeed,
  formatHolesStrokeSummary,
  simPlayingHandicap,
  strokeGiftBetweenPlayers,
  strokeIndexForCourse,
} from '../../src/lib/netHandicap';
import {
  difficultyProduct,
  formatHandicapIndexDisplay,
  type Mulligans,
  type PinDay,
  type PuttingMode,
  type Wind,
} from '../../src/lib/handicap';
import { useResponsive } from '../../src/lib/responsive';
import { initialsFrom } from '../../src/store/useAppStore';

const PUTTING_OPTS: { key: PuttingMode; label: string }[] = [
  { key: 'auto_2putt', label: 'Auto 2-putt' },
  { key: 'gimme_5', label: 'Gimme' },
  { key: 'putt_all', label: 'Full' },
];

const PIN_OPTS: { key: PinDay; label: string }[] = [
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const WIND_OPTS: { key: Wind; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'light', label: 'Light' },
  { key: 'strong', label: 'Strong' },
];

const MULL_OPTS: { key: Mulligans; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'on', label: 'On' },
];

type PlayerSlot =
  | { kind: 'empty' }
  | { kind: 'pick'; golferId: string }
  | { kind: 'manual'; name: string; index: string };

function slotToForm(slot: PlayerSlot): { name: string; indexStr: string } {
  if (slot.kind === 'empty') return { name: '', indexStr: '' };
  if (slot.kind === 'manual') return { name: slot.name, indexStr: slot.index };
  const g = dummyGolferById(slot.golferId);
  return g ? { name: g.displayName, indexStr: formatHandicapIndexDisplay(g.index) } : { name: '', indexStr: '' };
}

function giftPhrase(
  strokes: number,
  giver: string,
  receiver: string,
  name1: string,
  name2: string
): string {
  if (strokes === 0) {
    return `${name1.trim()} & ${name2.trim()} — match from scratch.`;
  }
  return `${giver} gives ${receiver} ${strokes} stroke${strokes === 1 ? '' : 's'}`;
}

type PickerTarget = 1 | 2 | null;

export default function NetCalculatorScreen() {
  const insets = useSafeAreaInsets();
  const { gutter, isWide } = useResponsive();

  const [p1Slot, setP1Slot] = useState<PlayerSlot>({ kind: 'empty' });
  const [p2Slot, setP2Slot] = useState<PlayerSlot>({ kind: 'empty' });
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

  const [courseId, setCourseId] = useState('pebble');
  const [platform, setPlatform] = useState<PlatformId>('Trackman');
  const [putting, setPutting] = useState<PuttingMode>('auto_2putt');
  const [pin, setPin] = useState<PinDay>('thu');
  const [wind, setWind] = useState<Wind>('off');
  const [mulligans, setMulligans] = useState<Mulligans>('off');
  const [courseOpen, setCourseOpen] = useState(false);
  const [platOpen, setPlatOpen] = useState(false);

  const p1Form = useMemo(() => slotToForm(p1Slot), [p1Slot]);
  const p2Form = useMemo(() => slotToForm(p2Slot), [p2Slot]);
  const p1Name = p1Form.name;
  const p1Idx = p1Form.indexStr;
  const p2Name = p2Form.name;
  const p2Idx = p2Form.indexStr;

  const course = getCourseById(courseId);
  const { rating, slope } = course ? ratingForCourse(course, platform) : { rating: 72, slope: 130 };
  const par = course ? courseParFromSeed(course) : 72;
  const strokeIdx = course ? strokeIndexForCourse(course) : [];

  const parsed1 = parseFloat(p1Idx.replace(/,/g, '.'));
  const parsed2 = parseFloat(p2Idx.replace(/,/g, '.'));
  const inputsValid =
    p1Name.trim().length > 0 &&
    p2Name.trim().length > 0 &&
    !Number.isNaN(parsed1) &&
    !Number.isNaN(parsed2) &&
    course != null;

  const result = useMemo(() => {
    if (!inputsValid || !course) return null;
    const ph1 = simPlayingHandicap(parsed1, rating, slope, par, putting, pin, wind, mulligans);
    const ph2 = simPlayingHandicap(parsed2, rating, slope, par, putting, pin, wind, mulligans);
    const gift = strokeGiftBetweenPlayers(p1Name, ph1, p2Name, ph2);
    if (!gift) return null;
    const phrase = giftPhrase(gift.strokes, gift.giverName, gift.receiverName, p1Name, p2Name);
    const si = strokeIdx.length === 18 ? strokeIdx : strokeIndexForCourse(course);
    const holesSummary = gift.strokes > 0 ? formatHolesStrokeSummary(gift.strokes, si) : '';
    const modifier = difficultyProduct(putting, pin, wind, mulligans);
    return {
      ph1,
      ph2,
      phrase,
      holesSummary,
      modifier,
      gift,
    };
  }, [
    inputsValid,
    course,
    parsed1,
    parsed2,
    p1Name,
    p2Name,
    rating,
    slope,
    par,
    putting,
    pin,
    wind,
    mulligans,
    strokeIdx,
  ]);

  const settingsLine = useMemo(() => {
    const windL = wind === 'off' ? 'No wind' : wind === 'light' ? 'Light wind' : 'Wind';
    const put =
      putting === 'auto_2putt' ? 'Auto 2-putt' : putting === 'gimme_5' ? 'Gimme <5ft' : 'Putt everything';
    const pinL = pin === 'thu' ? 'Thu' : pin === 'fri' ? 'Fri' : pin === 'sat' ? 'Sat' : 'Sun';
    const mull = mulligans === 'on' ? 'Mulligans on' : 'Mulligans off';
    return `${platform} · ${put} · ${pinL} · ${windL} · ${mull}`;
  }, [platform, putting, pin, wind, mulligans]);

  const excludePickerIds = useMemo(() => {
    if (pickerTarget === 1) {
      return p2Slot.kind === 'pick' ? [p2Slot.golferId] : [];
    }
    if (pickerTarget === 2) {
      return p1Slot.kind === 'pick' ? [p1Slot.golferId] : [];
    }
    return [];
  }, [pickerTarget, p1Slot, p2Slot]);

  const closePicker = () => setPickerTarget(null);

  const pillRow = (
    label: string,
    opts: { key: string; label: string }[],
    current: string,
    onPick: (k: string) => void
  ) => (
    <View style={styles.catBlock}>
      <Text style={styles.catLabel}>{label}</Text>
      <View style={styles.pillWrap}>
        {opts.map((o) => {
          const on = current === o.key;
          return (
            <Pressable
              key={o.key}
              onPress={() => onPick(o.key)}
              style={[styles.pill, on && styles.pillOn]}
            >
              <Text style={[styles.pillTxt, on && styles.pillTxtOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderSlot = (which: 1 | 2, slot: PlayerSlot, setSlot: (s: PlayerSlot) => void) => {
    const open = () => setPickerTarget(which);

    if (slot.kind === 'manual') {
      return (
        <View style={styles.manualBlock}>
          <Text style={[styles.fieldLbl, styles.manualLblFirst]}>Name</Text>
          <TextInput
            style={styles.input}
            value={slot.name}
            onChangeText={(name) => setSlot({ kind: 'manual', name, index: slot.index })}
            placeholder="Name"
            placeholderTextColor={colors.subtle}
          />
          <Text style={styles.fieldLbl}>Sim index</Text>
          <TextInput
            style={styles.input}
            value={slot.index}
            onChangeText={(index) => setSlot({ kind: 'manual', name: slot.name, index })}
            placeholder="e.g. 4.2"
            placeholderTextColor={colors.subtle}
            keyboardType="decimal-pad"
          />
          <Pressable
            style={styles.rosterLink}
            onPress={() => {
              setSlot({ kind: 'empty' });
              setPickerTarget(which);
            }}
          >
            <Text style={styles.rosterLinkTxt}>Choose from SimCap roster</Text>
          </Pressable>
        </View>
      );
    }

    if (slot.kind === 'pick') {
      const g = dummyGolferById(slot.golferId);
      if (!g) {
        return (
          <Pressable style={styles.slotEmpty} onPress={open}>
            <Text style={styles.slotEmptyTitle}>Tap to choose</Text>
            <Text style={styles.slotEmptyHint}>Player {which}</Text>
          </Pressable>
        );
      }
      return (
        <Pressable style={styles.slotCard} onPress={open}>
          <View style={styles.slotAvatar}>
            <Text style={styles.slotAvatarTxt}>{g.initials}</Text>
          </View>
          <View style={styles.slotBody}>
            <Text style={styles.slotName} numberOfLines={1}>
              {g.displayName}
            </Text>
            <View style={styles.slotMetaRow}>
              <View style={styles.slotIdxPill}>
                <Text style={styles.slotIdxPillTxt}>{formatHandicapIndexDisplay(g.index)}</Text>
              </View>
              <Text style={styles.slotPlat} numberOfLines={1}>
                {g.platform}
              </Text>
            </View>
          </View>
          <Text style={styles.slotChev}>›</Text>
        </Pressable>
      );
    }

    return (
      <Pressable style={styles.slotEmpty} onPress={open}>
        <Text style={styles.slotEmptyTitle}>Tap to choose</Text>
        <Text style={styles.slotEmptyHint}>Player {which} · SimCap roster or enter manually</Text>
      </Pressable>
    );
  };

  return (
    <ContentWidth bg={colors.bg}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: Math.max(gutter, 12),
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, isWide && styles.titleLg]}>Net score calculator</Text>
        <Text style={styles.sub}>
          Pre-round match play strokes from sim indexes, course slope/rating, and today’s sim settings.
        </Text>

        <View style={styles.playersCard}>
          <Text style={styles.cardSection}>Players</Text>
          <Text style={styles.fieldLbl}>Player 1</Text>
          {renderSlot(1, p1Slot, setP1Slot)}
          <Text style={[styles.fieldLbl, styles.fieldSp]}>Player 2</Text>
          {renderSlot(2, p2Slot, setP2Slot)}
        </View>

        {result ? (
          <View style={styles.summaryBlock}>
            <Text style={styles.metaLine}>{course?.name} · {course?.defaultTee ?? 'Tees'}</Text>
            <Text style={styles.metaLine}>{settingsLine}</Text>
            <Text style={styles.metaMuted}>
              Difficulty modifier {result.modifier.toFixed(2)} · Slope {slope} · Rating {rating} · Par {par}
            </Text>
          </View>
        ) : null}

        {result ? (
          <View style={[styles.resultCard, styles.resultCardTop]}>
            <View style={styles.resultPlayers}>
              <View style={styles.avCol}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarTxt}>{initialsFrom(p1Name)}</Text>
                </View>
                <Text style={styles.avName} numberOfLines={2}>
                  {p1Name.trim()}
                </Text>
                <Text style={styles.avHcp}>PH {result.ph1}</Text>
              </View>
              <View style={styles.resultMid}>
                <Text style={styles.strokePhrase} numberOfLines={4}>
                  {result.phrase}
                </Text>
                {result.gift.strokes > 0 && result.holesSummary ? (
                  <Text style={styles.holesLine} numberOfLines={6}>
                    {result.holesSummary}
                  </Text>
                ) : null}
              </View>
              <View style={styles.avCol}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarTxt}>{initialsFrom(p2Name)}</Text>
                </View>
                <Text style={styles.avName} numberOfLines={2}>
                  {p2Name.trim()}
                </Text>
                <Text style={styles.avHcp}>PH {result.ph2}</Text>
              </View>
            </View>
          </View>
        ) : (
          <Text style={[styles.needInput, styles.needInputTop]}>
            Pick two players (or enter manually), then adjust course and sim settings below to see strokes.
          </Text>
        )}

        <View style={styles.card}>
          <Text style={styles.cardSection}>Course & platform</Text>
          <Pressable style={styles.picker} onPress={() => setCourseOpen(true)}>
            <Text style={styles.pickerLbl}>Course</Text>
            <Text style={styles.pickerVal}>{course?.name ?? 'Select'}</Text>
            <Text style={styles.chev}>▾</Text>
          </Pressable>
          <Pressable style={styles.picker} onPress={() => setPlatOpen(true)}>
            <Text style={styles.pickerLbl}>Platform</Text>
            <Text style={styles.pickerVal}>{platform}</Text>
            <Text style={styles.chev}>▾</Text>
          </Pressable>

          {pillRow(
            'Putting',
            PUTTING_OPTS.map((o) => ({ key: o.key, label: o.label })),
            putting,
            (k) => setPutting(k as PuttingMode)
          )}
          {pillRow(
            'Pin',
            PIN_OPTS.map((o) => ({ key: o.key, label: o.label })),
            pin,
            (k) => setPin(k as PinDay)
          )}
          {pillRow(
            'Wind',
            WIND_OPTS.map((o) => ({ key: o.key, label: o.label })),
            wind,
            (k) => setWind(k as Wind)
          )}
          {pillRow(
            'Mulligans',
            MULL_OPTS.map((o) => ({ key: o.key, label: o.label })),
            mulligans,
            (k) => setMulligans(k as Mulligans)
          )}
        </View>
      </ScrollView>

      <GolferPickerModal
        visible={pickerTarget != null}
        title={pickerTarget === 2 ? 'Choose player 2' : 'Choose player 1'}
        golfers={DUMMY_NET_GOLFERS}
        excludeIds={excludePickerIds}
        onClose={closePicker}
        onSelect={(g) => {
          if (pickerTarget === 1) setP1Slot({ kind: 'pick', golferId: g.id });
          if (pickerTarget === 2) setP2Slot({ kind: 'pick', golferId: g.id });
        }}
        onEnterManually={() => {
          if (pickerTarget === 1) setP1Slot({ kind: 'manual', name: '', index: '' });
          if (pickerTarget === 2) setP2Slot({ kind: 'manual', name: '', index: '' });
        }}
      />

      <Modal
        visible={courseOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setCourseOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setCourseOpen(false)} />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.modalTitle}>Course</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {COURSE_SEEDS.map((c) => (
                <Pressable
                  key={c.id}
                  style={styles.modalRow}
                  onPress={() => {
                    setCourseId(c.id);
                    setCourseOpen(false);
                  }}
                >
                  <Text style={styles.modalRowTxt}>{c.name}</Text>
                  {courseId === c.id ? <IconCheckmark size={18} color={colors.accent} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={platOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setPlatOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setPlatOpen(false)} />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.modalTitle}>Platform</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {PLATFORMS.map((p) => (
                <Pressable
                  key={p}
                  style={styles.modalRow}
                  onPress={() => {
                    setPlatform(p);
                    setPlatOpen(false);
                  }}
                >
                  <Text style={styles.modalRowTxt}>{p}</Text>
                  {platform === p ? <IconCheckmark size={18} color={colors.accent} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, width: '100%' },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  titleLg: { fontSize: 22 },
  sub: { fontSize: 12, color: colors.muted, lineHeight: 17, marginBottom: 16 },
  playersCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 14,
  },
  summaryBlock: { marginBottom: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 14,
  },
  cardSection: { fontSize: 11, fontWeight: '700', color: colors.subtle, letterSpacing: 0.6, textTransform: 'uppercase' },
  fieldLbl: { fontSize: 11, fontWeight: '600', color: colors.muted, marginBottom: 4, marginTop: 8 },
  fieldSp: { marginTop: 12 },
  input: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
  },
  slotEmpty: {
    marginTop: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.pillBorder,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 14,
    backgroundColor: colors.bg,
  },
  slotEmptyTitle: { fontSize: 15, fontWeight: '600', color: colors.accentDark, textAlign: 'center' },
  slotEmptyHint: { fontSize: 11, color: colors.subtle, textAlign: 'center', marginTop: 4, lineHeight: 15 },
  slotCard: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.sage,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: colors.header,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: { elevation: 1 },
    }),
  },
  slotAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.header,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotAvatarTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  slotBody: { flex: 1, minWidth: 0 },
  slotName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  slotMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  slotIdxPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  slotIdxPillTxt: { fontSize: 13, fontWeight: '700', color: colors.accentDark },
  slotPlat: { fontSize: 12, fontWeight: '600', color: colors.sage, flex: 1, minWidth: 0 },
  slotChev: { fontSize: 22, color: colors.subtle, fontWeight: '300' },
  manualBlock: { marginTop: 4 },
  manualLblFirst: { marginTop: 0 },
  rosterLink: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 4 },
  rosterLinkTxt: { fontSize: 13, fontWeight: '600', color: colors.sage },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 8,
    gap: 8,
  },
  pickerLbl: { fontSize: 11, fontWeight: '600', color: colors.subtle, width: 72 },
  pickerVal: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  chev: { fontSize: 12, color: colors.subtle },
  catBlock: { marginTop: 14 },
  catLabel: { fontSize: 10, fontWeight: '700', color: colors.subtle, letterSpacing: 0.5, marginBottom: 8 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
  },
  pillOn: { backgroundColor: colors.header, borderColor: colors.header },
  pillTxt: { fontSize: 12, fontWeight: '600', color: colors.muted },
  pillTxtOn: { color: '#fff' },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 20,
  },
  resultCardTop: { marginBottom: 14 },
  resultPlayers: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  avCol: { width: 88, alignItems: 'center' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: colors.accentDark },
  avName: { fontSize: 11, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  avHcp: { fontSize: 10, fontWeight: '600', color: colors.sage, marginTop: 2 },
  resultMid: { flex: 1, minWidth: 0, paddingTop: 4 },
  strokePhrase: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.header,
    textAlign: 'center',
    lineHeight: 18,
  },
  holesLine: { fontSize: 10, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 14 },
  metaLine: { fontSize: 11, fontWeight: '600', color: colors.ink, marginBottom: 4 },
  metaMuted: { fontSize: 10, color: colors.subtle, lineHeight: 14 },
  needInput: { fontSize: 12, color: colors.subtle, fontStyle: 'italic', marginBottom: 24 },
  needInputTop: { marginBottom: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdropPress: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalRowTxt: { fontSize: 15, color: colors.ink, flex: 1 },
});
