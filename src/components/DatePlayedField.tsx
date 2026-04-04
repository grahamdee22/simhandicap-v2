import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../lib/constants';
import {
  clampYmdParts,
  dateFromYmdLocal,
  daysInMonth,
  parseYmdParts,
  todayLocalYmd,
  ymdFromParts,
} from '../lib/dates';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WHEEL_ROW = 40;

function formatDisplay(ymd: string): string {
  const p = parseYmdParts(ymd);
  if (!p) return ymd;
  const t = new Date(p.y, p.m - 1, p.d);
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function WebWheelColumn({
  data,
  selectedIndex,
  onSelectIndex,
}: {
  data: { label: string; key: string }[];
  selectedIndex: number;
  onSelectIndex: (i: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const pad = WHEEL_ROW * 2;

  useEffect(() => {
    const y = Math.min(selectedIndex, Math.max(0, data.length - 1)) * WHEEL_ROW;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    });
  }, [data.length, selectedIndex]);

  return (
    <View style={webWheelStyles.col}>
      <View style={webWheelStyles.maskTop} pointerEvents="none" />
      <View style={webWheelStyles.maskBottom} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ROW}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: pad }}
        onMomentumScrollEnd={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          const i = Math.round(y / WHEEL_ROW);
          const clamped = Math.max(0, Math.min(data.length - 1, i));
          onSelectIndex(clamped);
        }}
      >
        {data.map((row, i) => (
          <View key={row.key} style={{ height: WHEEL_ROW, justifyContent: 'center' }}>
            <Text
              style={[
                webWheelStyles.rowTxt,
                i === selectedIndex && webWheelStyles.rowTxtOn,
              ]}
              numberOfLines={1}
            >
              {row.label}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function WebDateWheels({
  ymd,
  onApply,
}: {
  ymd: string;
  onApply: (next: string) => void;
}) {
  const initial = parseYmdParts(ymd) ?? parseYmdParts(todayLocalYmd())!;
  const [y, setY] = useState(initial.y);
  const [m, setM] = useState(initial.m);
  const [d, setD] = useState(() => clampYmdParts(initial.y, initial.m, initial.d).d);

  const yearStart = 2018;
  const yearEnd = new Date().getFullYear() + 1;
  const years = useMemo(
    () =>
      Array.from({ length: yearEnd - yearStart + 1 }, (_, i) => ({
        key: `y-${yearStart + i}`,
        label: String(yearStart + i),
      })),
    [yearEnd]
  );
  const months = useMemo(
    () => MONTH_NAMES.map((name, i) => ({ key: `m-${i + 1}`, label: name })),
    []
  );
  const dim = daysInMonth(y, m);
  const days = useMemo(
    () =>
      Array.from({ length: dim }, (_, i) => ({
        key: `d-${i + 1}`,
        label: String(i + 1),
      })),
    [dim]
  );

  const yi = Math.max(0, Math.min(years.length - 1, y - yearStart));
  const mi = m - 1;
  const di = Math.min(d, dim) - 1;

  useEffect(() => {
    if (d > dim) setD(dim);
  }, [dim, d]);

  return (
    <View style={webWheelStyles.wrap}>
      <View style={webWheelStyles.row}>
        <WebWheelColumn
          data={months}
          selectedIndex={mi}
          onSelectIndex={(i) => {
            const nm = i + 1;
            const nd = clampYmdParts(y, nm, d).d;
            setM(nm);
            setD(nd);
          }}
        />
        <WebWheelColumn
          data={days}
          selectedIndex={Math.max(0, Math.min(days.length - 1, di))}
          onSelectIndex={(i) => setD(i + 1)}
        />
        <WebWheelColumn
          data={years}
          selectedIndex={yi}
          onSelectIndex={(i) => {
            const ny = yearStart + i;
            const nd = clampYmdParts(ny, m, d).d;
            setY(ny);
            setD(nd);
          }}
        />
      </View>
      <Pressable style={webWheelStyles.applyBtn} onPress={() => onApply(ymdFromParts(y, m, d))}>
        <Text style={webWheelStyles.applyTxt}>Done</Text>
      </Pressable>
    </View>
  );
}

const webWheelStyles = StyleSheet.create({
  wrap: { paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    paddingVertical: 8,
    minHeight: WHEEL_ROW * 5,
  },
  col: {
    flex: 1,
    maxHeight: WHEEL_ROW * 5,
    position: 'relative',
  },
  maskTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: WHEEL_ROW * 2,
    zIndex: 1,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  maskBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: WHEEL_ROW * 2,
    zIndex: 1,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowTxt: {
    textAlign: 'center',
    fontSize: 14,
    color: colors.muted,
    fontWeight: '500',
  },
  rowTxtOn: { color: colors.ink, fontWeight: '700' },
  applyBtn: {
    marginTop: 4,
    paddingVertical: 12,
    backgroundColor: colors.header,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

export function DatePlayedField({
  value,
  onChange,
}: {
  value: string;
  onChange: (ymd: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [iosDraft, setIosDraft] = useState(() => dateFromYmdLocal(value));
  const [androidOpen, setAndroidOpen] = useState(false);

  useEffect(() => {
    if (open && Platform.OS === 'ios') {
      setIosDraft(dateFromYmdLocal(value));
    }
  }, [open, value]);

  const close = useCallback(() => setOpen(false), []);

  const applyYmd = useCallback(
    (ymd: string) => {
      onChange(ymd);
      close();
    },
    [close, onChange]
  );

  const onAndroidChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      setAndroidOpen(false);
      if (event.type === 'set' && date) {
        const y = date.getFullYear();
        const m = date.getMonth() + 1;
        const d = date.getDate();
        onChange(ymdFromParts(y, m, d));
      }
      close();
    },
    [close, onChange]
  );

  return (
    <>
      <Text style={fieldStyles.sectionLabel}>Date played</Text>
      <Pressable
        style={({ pressed }) => [fieldStyles.pill, pressed && fieldStyles.pillPressed]}
        onPress={() => {
          if (Platform.OS === 'android') {
            setAndroidOpen(true);
          } else {
            setOpen(true);
          }
        }}
      >
        <Text style={fieldStyles.pillVal}>{formatDisplay(value)}</Text>
        <Text style={fieldStyles.chev}>▾</Text>
      </Pressable>
      <Text style={fieldStyles.dateHint}>Used for your index timeline and recent rounds order.</Text>

      {Platform.OS === 'android' && androidOpen ? (
        <DateTimePicker
          value={dateFromYmdLocal(value)}
          mode="date"
          display="spinner"
          onChange={onAndroidChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
          <View style={fieldStyles.modalRoot}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={close} />
            <View style={[fieldStyles.sheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={fieldStyles.sheetBar}>
                <Pressable onPress={close} hitSlop={12}>
                  <Text style={fieldStyles.sheetCancel}>Cancel</Text>
                </Pressable>
                <Text style={fieldStyles.sheetTitle}>Date played</Text>
                <Pressable
                  onPress={() => {
                    const dt = iosDraft;
                    applyYmd(ymdFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()));
                  }}
                  hitSlop={12}
                >
                  <Text style={fieldStyles.sheetDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={iosDraft}
                mode="date"
                display="spinner"
                themeVariant="light"
                onChange={(_, date) => {
                  if (date) setIosDraft(date);
                }}
                style={fieldStyles.iosPicker}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {Platform.OS === 'web' && open ? (
        <Modal visible={open} animationType="none" transparent onRequestClose={close}>
          <View style={fieldStyles.modalRoot}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={close} />
            <View style={[fieldStyles.sheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={fieldStyles.sheetBar}>
                <Pressable onPress={close} hitSlop={12}>
                  <Text style={fieldStyles.sheetCancel}>Cancel</Text>
                </Pressable>
                <Text style={fieldStyles.sheetTitle}>Date played</Text>
                <View style={{ width: 56 }} />
              </View>
              <WebDateWheels key={value} ymd={value} onApply={applyYmd} />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const fieldStyles = StyleSheet.create({
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.subtle,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 5,
    marginTop: 10,
  },
  pill: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: 11,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  pillPressed: { opacity: 0.85 },
  pillVal: { fontSize: 14, fontWeight: '600', color: colors.ink },
  chev: { fontSize: 9, color: colors.subtle },
  dateHint: { fontSize: 10, color: colors.muted, marginTop: 4 },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  sheetCancel: { fontSize: 16, color: colors.muted, width: 72 },
  sheetDone: { fontSize: 16, fontWeight: '600', color: colors.accent, width: 72, textAlign: 'right' },
  iosPicker: { alignSelf: 'center', width: '100%' },
});
