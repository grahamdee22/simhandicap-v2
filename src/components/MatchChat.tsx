import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '@/src/lib/constants';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';

const PRESET_PHRASES = [
  "Get rekt 🏌️",
  'Sandbagging? 👀',
  'Easy game 😎',
  'Oof 😬',
  'You got lucky',
  'GG 🤝',
  'Rough hole 😬',
  'Birdie szn 🐦',
  "How'd you make that work? 🤔",
  'That hurts to watch',
  'Respect 🫡',
] as const;

type MatchMessageRow = {
  id: string;
  match_id: string;
  user_id: string;
  message: string;
  created_at: string;
};

type Props = {
  matchId: string;
  currentUserId: string;
  opponentId: string | null;
  onUnreadCountChange?: (count: number) => void;
};

export function MatchChat({ matchId, currentUserId, opponentId, onUnreadCountChange }: Props) {
  const [messages, setMessages] = useState<MatchMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const supabaseOn = isSupabaseConfigured();
  const scrollRef = useRef<ScrollView | null>(null);
  const atBottomRef = useRef(true);

  const messageLimitReached = messages.length >= 30;

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [unreadCount, onUnreadCountChange]);

  useEffect(() => {
    const client = supabase;
    if (!matchId || !supabaseOn || !currentUserId || !client) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const { data, error } = await client
        .from('match_messages')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setMessages(data as MatchMessageRow[]);
      }
      setLoading(false);
      // start with everything read
      setUnreadCount(0);
      atBottomRef.current = true;
      if (scrollRef.current) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollToEnd({ animated: false });
        });
      }
    };
    void load();

    const channel = client
      .channel(`match-chat:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_messages',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as MatchMessageRow;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
          const fromOpponent = row.user_id === opponentId;
          const atBottom = atBottomRef.current;
          if (fromOpponent && (!expanded || !atBottom)) {
            setUnreadCount((c) => c + 1);
          }
          if (scrollRef.current && expanded && atBottom) {
            requestAnimationFrame(() => {
              scrollRef.current?.scrollToEnd({ animated: true });
            });
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [matchId, currentUserId, opponentId, supabaseOn, expanded]);

  const lastMessage = messages[messages.length - 1] ?? null;
  const lastPreview = lastMessage ? lastMessage.message : 'No messages yet';

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending || messageLimitReached || !supabaseOn || !supabase) return;
    setSending(true);
    try {
      const { error } = await supabase.from('match_messages').insert({
        match_id: matchId,
        user_id: currentUserId,
        message: trimmed.slice(0, 500),
      });
      if (error) {
        if (error.message.toLowerCase().includes('count')) {
          Alert.alert('Chat', 'Message limit reached for this match.');
        } else {
          Alert.alert('Chat', error.message);
        }
        return;
      }
      setInput('');
      setPresetOpen(false);
      Keyboard.dismiss();
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    } finally {
      setSending(false);
    }
  };

  const onSelectPreset = (phrase: string) => {
    void handleSend(phrase);
  };

  const onLongPressMessage = (m: MatchMessageRow) => {
    Alert.alert('Message options', 'What would you like to do?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report message',
        style: 'destructive',
        onPress: () => {
          const subject = encodeURIComponent('Message Report');
          const body = encodeURIComponent(`Reported message:\n\n"${m.message}"\n\nMatch ID: ${m.match_id}\nFrom user: ${m.user_id}\nAt: ${m.created_at}`);
          const url = `mailto:simcapadmin@gmail.com?subject=${subject}&body=${body}`;
          void Linking.openURL(url);
        },
      },
    ]);
  };

  const formattedMessages = useMemo(() => {
    return messages.map((m) => ({
      ...m,
      isMine: m.user_id === currentUserId,
      timeLabel: new Date(m.created_at).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    }));
  }, [messages, currentUserId]);

  const onScroll = (e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const paddingToBottom = 24;
    const atBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
    atBottomRef.current = atBottom;
    if (atBottom && unreadCount > 0) {
      setUnreadCount(0);
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        accessibilityRole="button"
        accessibilityLabel="Match chat"
      >
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Match chat</Text>
          {unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeTxt}>{unreadCount}</Text>
            </View>
          ) : null}
        </View>
        {!expanded ? (
          <Text
            style={styles.previewTxt}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {lastPreview}
          </Text>
        ) : null}
      </Pressable>

      {expanded ? (
        <View style={styles.messagesPanel}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.header} />
            </View>
          ) : (
            <ScrollView
              ref={scrollRef}
              style={styles.messagesScroll}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={32}
            >
              {formattedMessages.map((m) => (
                <Pressable
                  key={m.id}
                  onLongPress={() => onLongPressMessage(m)}
                  delayLongPress={300}
                  style={[
                    styles.msgRow,
                    m.isMine ? styles.msgRowMine : styles.msgRowTheirs,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      m.isMine ? styles.bubbleMine : styles.bubbleTheirs,
                    ]}
                  >
                    <Text
                      style={m.isMine ? styles.msgTxtMine : styles.msgTxtTheirs}
                    >
                      {m.message}
                    </Text>
                    <Text style={styles.timeTxt}>{m.timeLabel}</Text>
                  </View>
                </Pressable>
              ))}
              {formattedMessages.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateTxt}>No messages yet.</Text>
                </View>
              ) : null}
            </ScrollView>
          )}
        </View>
      ) : null}

      {presetOpen && !messageLimitReached ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.presetRow}
          contentContainerStyle={styles.presetContent}
        >
          {PRESET_PHRASES.map((p) => (
            <Pressable
              key={p}
              onPress={() => onSelectPreset(p)}
              style={({ pressed }) => [
                styles.presetPill,
                pressed && styles.presetPillPressed,
              ]}
            >
              <Text style={styles.presetPillTxt}>{p}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.inputRow}>
        <Pressable
          onPress={() => setPresetOpen((o) => !o)}
          disabled={messageLimitReached}
          style={({ pressed }) => [
            styles.presetBtn,
            pressed && styles.presetBtnPressed,
            messageLimitReached && styles.disabledBtn,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Open preset phrases"
        >
          <Text style={styles.presetBtnTxt}>💬</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={messageLimitReached ? 'Message limit reached' : 'Type a message'}
          placeholderTextColor={colors.subtle}
          editable={!sending && !messageLimitReached}
          multiline
        />
        <Pressable
          onPress={() => void handleSend(input)}
          disabled={sending || messageLimitReached || !input.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            (sending || messageLimitReached || !input.trim()) && styles.disabledBtn,
            pressed && !sending && !messageLimitReached && input.trim() && styles.sendBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendBtnTxt}>Send</Text>
          )}
        </Pressable>
      </View>
      {messageLimitReached ? (
        <Text style={styles.limitTxt}>Message limit reached</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 24,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.header,
  },
  unreadBadge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeTxt: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  previewTxt: {
    marginTop: 4,
    fontSize: 13,
    color: colors.muted,
  },
  messagesPanel: {
    marginTop: 8,
    maxHeight: 260,
    borderRadius: 12,
    backgroundColor: '#f7f9f8',
    paddingVertical: 8,
  },
  loadingRow: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesScroll: {
    maxHeight: 260,
  },
  messagesContent: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  msgRow: {
    marginVertical: 4,
    flexDirection: 'row',
  },
  msgRowMine: {
    justifyContent: 'flex-end',
  },
  msgRowTheirs: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  bubbleMine: {
    backgroundColor: '#52b788',
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: '#e8e8e8',
    borderBottomLeftRadius: 4,
  },
  msgTxtMine: {
    color: '#ffffff',
    fontSize: 14,
  },
  msgTxtTheirs: {
    color: colors.ink,
    fontSize: 14,
  },
  timeTxt: {
    marginTop: 2,
    fontSize: 10,
    color: colors.subtle,
    textAlign: 'right',
  },
  emptyState: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateTxt: {
    fontSize: 13,
    color: colors.subtle,
  },
  presetRow: {
    marginTop: 8,
    marginBottom: 4,
  },
  presetContent: {
    paddingHorizontal: 2,
  },
  presetPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
    marginRight: 6,
  },
  presetPillPressed: {
    backgroundColor: colors.accentSoft,
  },
  presetPillTxt: {
    fontSize: 12,
    color: colors.ink,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 8,
  },
  presetBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    marginRight: 6,
  },
  presetBtnPressed: {
    backgroundColor: colors.accentSoft,
  },
  presetBtnTxt: {
    fontSize: 18,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 88,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  sendBtn: {
    marginLeft: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnPressed: {
    backgroundColor: colors.accent,
  },
  sendBtnTxt: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.4,
  },
  limitTxt: {
    marginTop: 4,
    fontSize: 11,
    color: colors.subtle,
  },
});

