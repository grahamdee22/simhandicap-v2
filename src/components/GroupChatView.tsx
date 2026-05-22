import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/constants';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import {
  fetchGroupMessages,
  reportGroupMessage,
  sendGroupMessage,
  softDeleteGroupMessage,
  type DbGroupMessageRow,
} from '../lib/groupChat';
import { googleOAuthAccessToken } from '../lib/googleOAuthAccessToken';
import { showAppAlert } from '../lib/alertCompat';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export type GroupChatMember = {
  userId: string;
  displayName: string;
  initials: string;
};

type OptimisticStatus = 'pending' | 'sent' | 'failed';

type ChatMessage = DbGroupMessageRow & {
  optimisticStatus?: OptimisticStatus;
  clientKey?: string;
};

type Props = {
  groupId: string;
  groupName: string;
  memberCount: number;
  members: GroupChatMember[];
  currentUserId: string;
  canModerate: boolean;
};

function mergeMessages(prev: ChatMessage[], incoming: DbGroupMessageRow): ChatMessage[] {
  if (prev.some((m) => m.id === incoming.id)) return prev;
  const withoutOptimistic = prev.filter(
    (m) =>
      !(
        m.optimisticStatus === 'pending' &&
        m.user_id === incoming.user_id &&
        m.content === incoming.content
      )
  );
  return [...withoutOptimistic, incoming];
}

export function GroupChatView({
  groupId,
  groupName,
  memberCount,
  members,
  currentUserId,
  canModerate,
}: Props) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const scrollRef = useRef<ScrollView | null>(null);
  const supabaseOn = isSupabaseConfigured();

  const memberByUserId = useMemo(() => {
    const m = new Map<string, GroupChatMember>();
    for (const mem of members) {
      if (mem.userId) m.set(mem.userId, mem);
    }
    return m;
  }, [members]);

  const scrollToBottom = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!groupId || !supabaseOn || !currentUserId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const token = googleOAuthAccessToken ?? undefined;
      const res = await fetchGroupMessages(groupId, token);
      if (cancelled) return;
      setMessages(res.data ?? []);
      setLoading(false);
      scrollToBottom(false);
    };
    void load();

    if (!client) return () => {
      cancelled = true;
    };

    const channel = client
      .channel(`group-chat:${groupId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const row = payload.new as DbGroupMessageRow;
          setMessages((prev) => mergeMessages(prev, row));
          scrollToBottom(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const row = payload.new as DbGroupMessageRow;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setReconnecting(false);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setReconnecting(true);
      });

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [groupId, currentUserId, supabaseOn, scrollToBottom]);

  const handleSend = async (text: string, retryKey?: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending || !supabaseOn) return;

    const clientKey = retryKey ?? `opt-${Date.now()}`;
    if (!retryKey) {
      const optimistic: ChatMessage = {
        id: clientKey,
        clientKey,
        group_id: groupId,
        user_id: currentUserId,
        content: trimmed,
        created_at: new Date().toISOString(),
        deleted_at: null,
        optimisticStatus: 'pending',
      };
      setMessages((prev) => [...prev, optimistic]);
      setInput('');
      scrollToBottom(true);
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientKey === retryKey ? { ...m, optimisticStatus: 'pending', content: trimmed } : m
        )
      );
    }

    setSending(true);
    const token = googleOAuthAccessToken ?? undefined;
    const res = await sendGroupMessage(groupId, currentUserId, trimmed, token);
    setSending(false);

    if (res.error || !res.data) {
      setMessages((prev) =>
        prev.map((m) => (m.clientKey === clientKey ? { ...m, optimisticStatus: 'failed' } : m))
      );
      return;
    }

    setMessages((prev) => {
      const merged = mergeMessages(
        prev.filter((m) => m.clientKey !== clientKey),
        res.data!
      );
      return merged;
    });
    Keyboard.dismiss();
    scrollToBottom(true);
  };

  const onLongPressMessage = (m: ChatMessage) => {
    if (m.deleted_at) return;
    const isMine = m.user_id === currentUserId;
    const canDelete = isMine || canModerate;
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'Cancel', style: 'cancel' },
    ];
    if (canDelete) {
      buttons.push({
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Delete message?',
            'This cannot be undone. The message will show as deleted for everyone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => void onDeleteMessage(m.id),
              },
            ]
          );
        },
      });
    }
    buttons.push({
      text: 'Report',
      style: 'destructive',
      onPress: () => void onReportMessage(m.id),
    });
    Alert.alert('Message options', undefined, buttons);
  };

  const onDeleteMessage = async (messageId: string) => {
    if (messageId.startsWith('opt-')) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      return;
    }
    const token = googleOAuthAccessToken ?? undefined;
    const res = await softDeleteGroupMessage(messageId, token);
    if (res.error) showAppAlert('Delete failed', res.error);
  };

  const onReportMessage = async (messageId: string) => {
    if (messageId.startsWith('opt-')) return;
    const token = googleOAuthAccessToken ?? undefined;
    const res = await reportGroupMessage(messageId, token);
    if (res.error) {
      showAppAlert('Report failed', res.error);
      return;
    }
    showAppAlert('Report received', 'Thanks — your report has been logged.');
  };

  const displayRows = useMemo(() => {
    return messages.map((m) => {
      const mem = memberByUserId.get(m.user_id);
      const name = mem?.displayName.replace(/\s*\(you\)\s*$/i, '').trim() || 'Member';
      const initials = mem?.initials ?? '?';
      const isMine = m.user_id === currentUserId;
      const deleted = m.deleted_at != null;
      return {
        ...m,
        isMine,
        deleted,
        name,
        initials,
        timeLabel: formatRelativeTime(m.created_at),
      };
    });
  }, [messages, memberByUserId, currentUserId]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {groupName}
        </Text>
        <Text style={styles.headerSub}>
          {memberCount} member{memberCount === 1 ? '' : 's'}
        </Text>
        {reconnecting ? <Text style={styles.reconnecting}>Reconnecting…</Text> : null}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.header} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollToBottom(false)}
        >
          {displayRows.length === 0 ? (
            <Text style={styles.empty}>
              No messages yet. Start the conversation — organize a tournament, set up a match, or
              just talk golf.
            </Text>
          ) : (
            displayRows.map((m) => (
              <View key={m.clientKey ?? m.id}>
                <Pressable
                  onLongPress={() => onLongPressMessage(m)}
                  delayLongPress={300}
                  style={[styles.msgRow, m.isMine ? styles.msgRowMine : styles.msgRowTheirs]}
                >
                  {!m.isMine ? (
                    <View style={styles.avatar}>
                      <Text style={styles.avatarTxt}>{m.initials}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.msgCol, m.isMine && styles.msgColMine]}>
                    <Text style={[styles.senderName, m.isMine && styles.senderNameMine]}>
                      {m.isMine ? 'You' : m.name}
                    </Text>
                    <View
                      style={[
                        styles.bubble,
                        m.isMine ? styles.bubbleMine : styles.bubbleTheirs,
                        m.deleted && styles.bubbleDeleted,
                      ]}
                    >
                      <Text
                        style={[
                          m.isMine ? styles.msgTxtMine : styles.msgTxtTheirs,
                          m.deleted && styles.msgTxtDeleted,
                        ]}
                      >
                        {m.deleted ? 'Message deleted' : m.content}
                      </Text>
                    </View>
                    <Text style={styles.timeTxt}>{m.timeLabel}</Text>
                    {m.optimisticStatus === 'failed' ? (
                      <View style={styles.failedRow}>
                        <Text style={styles.failedTxt}>Could not send</Text>
                        <Pressable
                          onPress={() => void handleSend(m.content, m.clientKey)}
                          hitSlop={8}
                        >
                          <Text style={styles.retryTxt}>Retry</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={(t) => setInput(t.slice(0, 500))}
          placeholder="Message your crew…"
          placeholderTextColor={colors.subtle}
          editable={!sending && supabaseOn}
          multiline
          maxLength={500}
        />
        <Pressable
          onPress={() => void handleSend(input)}
          disabled={sending || !input.trim() || !supabaseOn}
          style={({ pressed }) => [
            styles.sendBtn,
            (sending || !input.trim()) && styles.sendBtnDisabled,
            pressed && input.trim() && !sending && styles.sendBtnPressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendBtnTxt}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  headerSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  reconnecting: { fontSize: 12, color: colors.warn, marginTop: 6 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingVertical: 16, flexGrow: 1 },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: 12,
    marginTop: 24,
  },
  msgRow: {
    flexDirection: 'row',
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  avatarTxt: { fontSize: 11, fontWeight: '700', color: colors.header },
  msgCol: { maxWidth: '78%', flexShrink: 1 },
  msgColMine: { alignItems: 'flex-end' },
  senderName: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 4,
  },
  senderNameMine: { textAlign: 'right' },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleMine: { backgroundColor: colors.sage },
  bubbleTheirs: { backgroundColor: '#eef2ef' },
  bubbleDeleted: { backgroundColor: '#f4f4f4' },
  msgTxtMine: { fontSize: 15, lineHeight: 20, color: '#fff' },
  msgTxtTheirs: { fontSize: 15, lineHeight: 20, color: colors.ink },
  msgTxtDeleted: { fontSize: 14, fontStyle: 'italic', color: colors.subtle },
  timeTxt: { fontSize: 11, color: colors.subtle, marginTop: 4 },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  failedTxt: { fontSize: 12, color: colors.danger },
  retryTxt: { fontSize: 12, fontWeight: '600', color: colors.header },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  sendBtn: {
    backgroundColor: colors.header,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 72,
    alignItems: 'center',
  },
  sendBtnPressed: { opacity: 0.88 },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
