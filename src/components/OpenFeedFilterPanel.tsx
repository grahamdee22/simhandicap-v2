import { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, PLATFORMS, type PlatformId } from '../lib/constants';
import {
  OPEN_FEED_HANDICAP_RANGE_ORDER,
  type OpenFeedFilterState,
  type OpenFeedHandicapRangeId,
  openFeedHandicapRangeLabel,
} from '../lib/openFeedFilters';

/** Same tokens as Analyze → Rounds filter panel. */
const F = {
  dark: '#1a3d2b',
  lightBg: '#f0f7f4',
  lightBorder: '#52b788',
  accent: '#52b788',
} as const;

type Props = {
  gutter: number;
  coursesInFeed: string[];
  applied: OpenFeedFilterState;
  draft: OpenFeedFilterState;
  expanded: boolean;
  onOpen: () => void;
  onDraftChange: (next: OpenFeedFilterState) => void;
  onApply: () => void;
  onResetAll: () => void;
  onRemoveHandicapChip: () => void;
  onRemoveCourseChip: () => void;
  onClearPlatformsChip: () => void;
};

export function OpenFeedFilterPanel({
  gutter,
  coursesInFeed,
  applied,
  draft,
  expanded,
  onOpen,
  onDraftChange,
  onApply,
  onResetAll,
  onRemoveHandicapChip,
  onRemoveCourseChip,
  onClearPlatformsChip,
}: Props) {
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [courseSearch, setCourseSearch] = useState('');

  const activeChips = useMemo(() => {
    const out: { key: string; label: string; onRemove: () => void }[] = [];
    if (applied.handicapRanges.length > 0) {
      const ordered = OPEN_FEED_HANDICAP_RANGE_ORDER.filter((id) => applied.handicapRanges.includes(id));
      const rest = applied.handicapRanges.filter((id) => !ordered.includes(id));
      const labels = [...ordered, ...rest].map((id) => openFeedHandicapRangeLabel(id));
      out.push({
        key: 'hcap',
        label: `Handicap · ${labels.join(', ')}`,
        onRemove: onRemoveHandicapChip,
      });
    }
    if (applied.courseName) {
      out.push({
        key: 'course',
        label: `Course · ${applied.courseName}`,
        onRemove: onRemoveCourseChip,
      });
    }
    if (applied.platforms.length > 0) {
      out.push({
        key: 'plat',
        label: `Simulator · ${applied.platforms.join(', ')}`,
        onRemove: onClearPlatformsChip,
      });
    }
    return out;
  }, [applied, onRemoveHandicapChip, onRemoveCourseChip, onClearPlatformsChip]);

  const filteredCourseList = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    if (!q) return coursesInFeed;
    return coursesInFeed.filter((c) => c.toLowerCase().includes(q));
  }, [coursesInFeed, courseSearch]);

  const toggleDraftPlatform = useCallback(
    (p: PlatformId) => {
      onDraftChange({
        ...draft,
        platforms: draft.platforms.includes(p)
          ? draft.platforms.filter((x) => x !== p)
          : [...draft.platforms, p],
      });
    },
    [draft, onDraftChange]
  );

  const toggleDraftHandicapRange = useCallback(
    (id: OpenFeedHandicapRangeId) => {
      const next = draft.handicapRanges.includes(id)
        ? draft.handicapRanges.filter((x) => x !== id)
        : [...draft.handicapRanges, id];
      onDraftChange({ ...draft, handicapRanges: next });
    },
    [draft, onDraftChange]
  );

  const selectCourse = useCallback(
    (name: string | null) => {
      onDraftChange({ ...draft, courseName: name });
      setCourseModalOpen(false);
      setCourseSearch('');
    },
    [draft, onDraftChange]
  );

  return (
    <View style={[styles.filterShell, { marginHorizontal: 0 }]}>
      <View style={styles.filterCollapsed}>
        <View style={styles.filterChipWrap}>
          {activeChips.map((c) => (
            <View key={c.key} style={styles.appliedChip}>
              <Text style={styles.appliedChipTxt} numberOfLines={2}>
                {c.label}
              </Text>
              <Pressable
                onPress={c.onRemove}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${c.label}`}
              >
                <Text style={styles.appliedChipX}>×</Text>
              </Pressable>
            </View>
          ))}
          {!expanded ? (
            <Pressable
              onPress={onOpen}
              hitSlop={8}
              style={styles.addFilterBtn}
              accessibilityRole="button"
              accessibilityLabel="Add filter"
              accessibilityState={{ expanded }}
            >
              <Text style={styles.addFilterBtnTxt}>+ Add filter</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {expanded ? (
        <View style={styles.filterExpanded}>
          <View style={styles.filterExpandedTop}>
            <Text style={styles.filterExpandedTitle}>Filters</Text>
            <Pressable onPress={onResetAll} hitSlop={8}>
              <Text style={styles.resetAllTxt}>Clear filters</Text>
            </Pressable>
          </View>
          <Text style={styles.filterHint}>
            Applies only to the open challenge feed. Incoming and active matches are unchanged.
          </Text>

          <Text style={[styles.fCatLabel, styles.fCatFirst]}>Handicap range</Text>
          <Text style={styles.subHint}>Tap to include; leave none selected for all handicaps.</Text>
          <View style={styles.fPillRow}>
            {OPEN_FEED_HANDICAP_RANGE_ORDER.map((id) => {
              const sel = draft.handicapRanges.includes(id);
              return (
                <Pressable
                  key={id}
                  onPress={() => toggleDraftHandicapRange(id)}
                  style={[styles.fPanelPill, sel ? styles.fPanelPillDark : null]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: sel }}
                >
                  <Text style={[styles.fPanelPillTxt, sel && styles.fPanelPillTxtDark]} numberOfLines={2}>
                    {openFeedHandicapRangeLabel(id)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fCatLabel}>Course</Text>
          <Pressable
            style={styles.coursePickBtn}
            onPress={() => {
              setCourseSearch('');
              setCourseModalOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Choose course filter"
          >
            <Text style={styles.coursePickBtnTxt} numberOfLines={1}>
              {draft.courseName ?? 'All courses'}
            </Text>
            <Text style={styles.coursePickChev}>▾</Text>
          </Pressable>

          <Text style={styles.fCatLabel}>Simulator platform</Text>
          <Text style={styles.subHint}>Tap to include; leave none selected for all platforms.</Text>
          <View style={styles.fPillRow}>
            {PLATFORMS.map((p) => {
              const sel = draft.platforms.includes(p);
              return (
                <Pressable
                  key={p}
                  onPress={() => toggleDraftPlatform(p)}
                  style={[styles.fPanelPill, sel ? styles.fPanelPillDark : null]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: sel }}
                >
                  <Text style={[styles.fPanelPillTxt, sel && styles.fPanelPillTxtDark]} numberOfLines={1}>
                    {p}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={onApply} style={styles.applyFiltersBtn}>
            <Text style={styles.applyFiltersBtnTxt}>Apply filters</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={courseModalOpen} animationType="fade" transparent onRequestClose={() => setCourseModalOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCourseModalOpen(false)} />
          <View style={[styles.modalSheet, { marginHorizontal: gutter }]}>
            <Text style={styles.modalTitle}>Course</Text>
            <TextInput
              style={styles.courseSearch}
              value={courseSearch}
              onChangeText={setCourseSearch}
              placeholder="Search courses…"
              placeholderTextColor={colors.subtle}
            />
            <ScrollView style={styles.courseList} keyboardShouldPersistTaps="handled">
              <Pressable style={styles.courseRow} onPress={() => selectCourse(null)}>
                <Text style={styles.courseRowTxt}>All courses</Text>
              </Pressable>
              {filteredCourseList.map((c) => (
                <Pressable key={c} style={styles.courseRow} onPress={() => selectCourse(c)}>
                  <Text style={styles.courseRowTxt} numberOfLines={2}>
                    {c}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.modalClose} onPress={() => setCourseModalOpen(false)}>
              <Text style={styles.modalCloseTxt}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  filterShell: { marginTop: 0, marginBottom: 10 },
  filterCollapsed: { justifyContent: 'flex-start' },
  /** Chips and “+ Add filter” wrap to extra lines so nothing is clipped horizontally. */
  filterChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  appliedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: F.dark,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: 999,
  },
  appliedChipTxt: { fontSize: 12, fontWeight: '600', color: '#fff', maxWidth: 260 },
  appliedChipX: { fontSize: 18, fontWeight: '500', color: 'rgba(255,255,255,0.85)', lineHeight: 20 },
  addFilterBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: F.lightBorder,
    backgroundColor: F.lightBg,
  },
  addFilterBtnTxt: { fontSize: 12, fontWeight: '700', color: F.accent },
  filterExpanded: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    marginTop: 0,
  },
  filterExpandedTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  filterExpandedTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  resetAllTxt: { fontSize: 13, fontWeight: '700', color: F.accent },
  filterHint: { fontSize: 10, color: colors.muted, lineHeight: 14, marginBottom: 6 },
  fCatLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 8,
  },
  fCatFirst: { marginTop: 2 },
  subHint: { fontSize: 10, color: colors.subtle, marginTop: -4, marginBottom: 6 },
  fPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fPanelPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
  },
  fPanelPillDark: {
    backgroundColor: F.dark,
    borderColor: F.dark,
  },
  fPanelPillTxt: { fontSize: 12, fontWeight: '600', color: colors.muted },
  fPanelPillTxtDark: { color: '#fff' },
  coursePickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.bg,
  },
  coursePickBtnTxt: { fontSize: 13, fontWeight: '600', color: colors.ink, flex: 1, marginRight: 8 },
  coursePickChev: { fontSize: 10, color: colors.subtle },
  applyFiltersBtn: {
    marginTop: 18,
    backgroundColor: F.dark,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyFiltersBtnTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  modalRoot: { flex: 1, justifyContent: 'center' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    maxHeight: '72%',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  courseSearch: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 10,
  },
  courseList: { maxHeight: 320 },
  courseRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  courseRowTxt: { fontSize: 14, fontWeight: '600', color: colors.ink },
  modalClose: { marginTop: 12, alignItems: 'center', paddingVertical: 10 },
  modalCloseTxt: { fontSize: 15, fontWeight: '700', color: F.accent },
});
