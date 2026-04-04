import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/constants';
import { formatHandicapIndexDisplay } from '../lib/handicap';
import type { DummyNetGolfer } from '../lib/dummyNetGolfers';

type Props = {
  visible: boolean;
  title: string;
  golfers: DummyNetGolfer[];
  /** IDs to hide (e.g. other slot already picked this golfer). */
  excludeIds?: string[];
  onClose: () => void;
  onSelect: (g: DummyNetGolfer) => void;
  onEnterManually: () => void;
};

function norm(s: string) {
  return s.trim().toLowerCase();
}

export function GolferPickerModal({
  visible,
  title,
  golfers,
  excludeIds = [],
  onClose,
  onSelect,
  onEnterManually,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const pool = golfers.filter((g) => !excludeIds.includes(g.id));
    const q = norm(query);
    if (!q) return pool;
    return pool.filter((g) => norm(g.displayName).includes(q));
  }, [golfers, excludeIds, query]);

  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === 'web' ? 'none' : 'fade'}
      transparent
      onRequestClose={onClose}
      onShow={() => setQuery('')}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name"
            placeholderTextColor={colors.subtle}
            autoCorrect={false}
            autoCapitalize="words"
            {...Platform.select({ ios: { clearButtonMode: 'while-editing' as const } })}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <View style={styles.rowAvatar}>
                  <Text style={styles.rowAvatarTxt}>{item.initials}</Text>
                </View>
                <View style={styles.rowMid}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  <Text style={styles.rowPlat} numberOfLines={1}>
                    {item.platform}
                  </Text>
                </View>
                <View style={styles.idxBadge}>
                  <Text style={styles.idxBadgeTxt}>{formatHandicapIndexDisplay(item.index)}</Text>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>No golfers match “{query.trim()}”.</Text>
            }
          />
          <Pressable
            style={styles.manualBtn}
            onPress={() => {
              onEnterManually();
              onClose();
            }}
          >
            <Text style={styles.manualBtnTxt}>Enter manually</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    maxHeight: '88%',
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  search: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 8,
  },
  list: { flexGrow: 0, maxHeight: 340 },
  listContent: { paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.header,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  rowMid: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.ink },
  rowPlat: { fontSize: 12, color: colors.muted, marginTop: 2 },
  idxBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  idxBadgeTxt: { fontSize: 13, fontWeight: '700', color: colors.accentDark },
  empty: { fontSize: 13, color: colors.muted, paddingVertical: 20, textAlign: 'center' },
  manualBtn: {
    marginTop: 4,
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  manualBtnTxt: { fontSize: 15, fontWeight: '600', color: colors.sage },
});
