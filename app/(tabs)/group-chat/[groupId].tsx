import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { GroupChatView, type GroupChatMember } from '../../../src/components/GroupChatView';
import { colors } from '../../../src/lib/constants';
import { isSocialGroupManager } from '../../../src/lib/socialGroupCreator';
import { useAppStore, initialsFrom } from '../../../src/store/useAppStore';

export default function GroupChatScreen() {
  const { groupId: rawId } = useLocalSearchParams<{ groupId: string | string[] }>();
  const groupId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, session } = useAuth();
  const groups = useAppStore((s) => s.groups);

  const authUserId = session?.user?.id ?? user?.id ?? null;
  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);

  const members: GroupChatMember[] = useMemo(() => {
    if (!group) return [];
    return group.members
      .filter((m) => m.userId)
      .map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        initials: m.initials || initialsFrom(m.displayName),
      }));
  }, [group]);

  const isMember = useMemo(() => {
    if (!authUserId || !group) return false;
    return group.members.some((m) => m.userId === authUserId);
  }, [group, authUserId]);

  const canModerate = isSocialGroupManager(group, authUserId);

  if (!group || !isMember || !authUserId) {
    return (
      <View style={[styles.fallback, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.fallbackTxt}>This group chat is not available.</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnTxt}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.navRow}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Text style={styles.backLink}>‹ Back</Text>
        </Pressable>
      </View>
      <GroupChatView
        groupId={group.id}
        groupName={group.name}
        memberCount={group.members.length}
        members={members}
        currentUserId={authUserId}
        canModerate={canModerate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  navRow: {
    paddingHorizontal: 12,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backLink: { fontSize: 17, fontWeight: '600', color: colors.header },
  fallback: { flex: 1, padding: 24, backgroundColor: colors.surface },
  fallbackTxt: { fontSize: 16, color: colors.muted, marginBottom: 16 },
  backBtn: { alignSelf: 'flex-start' },
  backBtnTxt: { fontSize: 16, fontWeight: '600', color: colors.header },
});
