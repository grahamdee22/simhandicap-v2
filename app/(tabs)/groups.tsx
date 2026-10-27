import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthContext';
import { isSocialGroupCreator, isSocialGroupManager } from '../../src/lib/socialGroupCreator';
import { ContentWidth } from '../../src/components/ContentWidth';
import { PendingTournamentHolesBanner } from '../../src/components/PendingTournamentHolesBanner';
import { GroupTournamentsSection } from '../../src/components/GroupTournamentsSection';
import { MatchPlayHub } from '../../src/components/MatchPlayHub';
import { IconPlus } from '../../src/components/SvgUiIcons';
import { useTranslation } from '../../src/i18n';
import { confirmDestructive, showAppAlert } from '../../src/lib/alertCompat';
import { colors } from '../../src/lib/constants';
import { socialPageSectionTitleStyles } from '../../src/lib/socialPageSectionTitle';
import { formatHandicapIndexDisplay } from '../../src/lib/handicap';
import { useResponsive } from '../../src/lib/responsive';
import {
  cancelOutboundGroupInvite,
  createSocialGroup,
  deleteSocialGroupAsCreator,
  fetchInboundGroupInvitesIntoStore,
  backfillGroupCreatorsInStore,
  fetchMySocialGroupsIntoStore,
  patchGroupMemberAdminInStore,
  resolveSocialGroupsAccessToken,
  parseBulkInviteEmails,
  respondToGroupInvite,
  sendBulkGroupInvites,
  sendGroupInvite,
  setGroupMemberAdmin,
  type SendBulkGroupInvitesResult,
} from '../../src/lib/socialGroups';
import { googleOAuthAccessToken } from '../../src/lib/googleOAuthAccessToken';
import { isSupabaseConfigured } from '../../src/lib/supabase';
import { useAppStore, type GroupMember } from '../../src/store/useAppStore';
import type { TFunction } from 'i18next';

const APP_INVITE_URL = 'https://simhandicap-v2.vercel.app';

function socialSectionInfoCopy(t: TFunction): Record<
  'match' | 'groups' | 'net' | 'tournaments',
  { title: string; body: string }
> {
  return {
    match: {
      title: t('groups.section.match.title'),
      body: t('groups.section.match.body'),
    },
    groups: {
      title: t('groups.section.groups.title'),
      body: t('groups.section.groups.body'),
    },
    tournaments: {
      title: t('groups.section.tournaments.title'),
      body: t('groups.section.tournaments.body'),
    },
    net: {
      title: t('groups.section.net.title'),
      body: t('groups.section.net.body'),
    },
  };
}

function openMailtoSimCapInvite(email: string, inviterName: string, t: TFunction) {
  const who = inviterName.trim() || t('groups.invite.aFriend');
  const body = t('groups.invite.mailtoBody', { who, url: APP_INVITE_URL });
  const subject = t('groups.invite.mailtoSubject');
  const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  void Linking.openURL(url);
}

const avColors = [
  ['#e1f5ee', '#0f6e56'],
  ['#eeedfe', '#3c3489'],
  ['#faeeda', '#854f0b'],
  ['#faece7', '#712b13'],
  ['#e6f1fb', '#0c447c'],
] as const;

function avatarStyle(i: number) {
  const [bg, fg] = avColors[i % avColors.length];
  return { backgroundColor: bg, color: fg as string };
}

function trendLabel(trend: GroupMember['trend'], t: TFunction): { text: string; style: object } {
  if (trend === 'down') return { text: t('groups.trend.improving'), style: styles.trendUp };
  if (trend === 'up') return { text: t('groups.trend.needsWork'), style: styles.trendDn };
  return { text: t('groups.trend.steady'), style: styles.trendFl };
}

function indexSortKey(m: GroupMember): number {
  return m.index ?? 999;
}

export default function GroupsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const { user, session } = useAuth();
  const { gutter } = useResponsive();
  const insets = useSafeAreaInsets();
  const supabaseOn = isSupabaseConfigured();
  const sectionInfoCopy = socialSectionInfoCopy(t);

  const groups = useAppStore((s) => s.groups);
  const inboundGroupInvites = useAppStore((s) => s.inboundGroupInvites);
  const displayName = useAppStore((s) => s.displayName);
  const addGroup = useAppStore((s) => s.addGroup);
  const removeGroupById = useAppStore((s) => s.removeGroupById);
  const recomputeGroupsFromYou = useAppStore((s) => s.recomputeGroupsFromYou);

  const [tab, setTab] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhase, setInvitePhase] = useState<'form' | 'success'>('form');
  const [inviteSuccessDetail, setInviteSuccessDetail] = useState('');
  const [listRefreshing, setListRefreshing] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false);
  const [bulkInviteText, setBulkInviteText] = useState('');
  const [bulkInvitePhase, setBulkInvitePhase] = useState<'form' | 'results'>('form');
  const [bulkInviteBusy, setBulkInviteBusy] = useState(false);
  const [bulkInviteResults, setBulkInviteResults] = useState<SendBulkGroupInvitesResult | null>(null);
  const [inboundBusy, setInboundBusy] = useState(false);
  const [deleteGroupBusy, setDeleteGroupBusy] = useState(false);
  const [adminBusyUserId, setAdminBusyUserId] = useState<string | null>(null);
  const [socialSectionInfo, setSocialSectionInfo] = useState<
    'match' | 'groups' | 'net' | 'tournaments' | null
  >(null);
  const [creatorsBackfillReady, setCreatorsBackfillReady] = useState(false);

  /** Bumps on blur so in-flight fetches don’t leave `listRefreshing` stuck true (e.g. switch tabs mid-request). */
  const groupsRefreshSessionRef = useRef(0);

  const [incomingMatchTabBadge, setIncomingMatchTabBadge] = useState(0);
  const [outgoingAcceptedTabBadge, setOutgoingAcceptedTabBadge] = useState(0);
  const onIncomingDirectMatchCount = useCallback((n: number) => {
    setIncomingMatchTabBadge(n);
  }, []);
  const onOutgoingAcceptedUnseenCount = useCallback((n: number) => {
    setOutgoingAcceptedTabBadge(n);
  }, []);

  useLayoutEffect(() => {
    const sum =
      incomingMatchTabBadge + outgoingAcceptedTabBadge + inboundGroupInvites.length;
    navigation.setOptions({
      tabBarBadge: sum > 0 ? sum : undefined,
    });
  }, [navigation, incomingMatchTabBadge, outgoingAcceptedTabBadge, inboundGroupInvites.length]);

  const g = groups[tab] ?? groups[0];

  useFocusEffect(
    useCallback(() => {
      if (!supabaseOn) return;
      const session = ++groupsRefreshSessionRef.current;
      const emptyShell = useAppStore.getState().groups.length === 0;
      if (emptyShell) setListRefreshing(true);

      void (async () => {
        try {
          const accessToken =
            googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
          await fetchMySocialGroupsIntoStore(user?.id, accessToken);
          await backfillGroupCreatorsInStore(accessToken);
          await fetchInboundGroupInvitesIntoStore(user?.id, accessToken);
          if (groupsRefreshSessionRef.current !== session) return;
          useAppStore.getState().recomputeGroupsFromYou();
          setCreatorsBackfillReady(true);
        } finally {
          if (groupsRefreshSessionRef.current === session && emptyShell) {
            setListRefreshing(false);
          }
        }
      })();

      return () => {
        groupsRefreshSessionRef.current += 1;
        setListRefreshing(false);
      };
    }, [supabaseOn, user?.id, googleOAuthAccessToken])
  );

  useEffect(() => {
    if (groups.length === 0) {
      setTab(0);
      return;
    }
    if (tab >= groups.length) setTab(groups.length - 1);
  }, [groups.length, tab]);

  const ranked = useMemo(() => {
    if (!g) return [];
    return [...g.members].sort((a, b) => indexSortKey(a) - indexSortKey(b));
  }, [g]);

  const pendingInAppRows = g?.pendingInApp ?? [];
  const pendingEmailRows = g?.pendingEmail ?? [];
  const hasMemberOrPending =
    ranked.length > 0 || pendingInAppRows.length > 0 || pendingEmailRows.length > 0;

  const onCreate = () => {
    setNewName('');
    setCreateOpen(true);
  };

  const createGroupModal = (
    <Modal visible={createOpen} animationType="fade" transparent>
      <Pressable style={styles.modalBackdrop} onPress={() => !createBusy && setCreateOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalKeyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Math.max(insets.bottom, 12)}
        >
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>{t('groups.newGroup.title')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('groups.newGroup.namePlaceholder')}
                placeholderTextColor={colors.subtle}
                value={newName}
                onChangeText={setNewName}
                autoFocus
                editable={!createBusy}
              />
              <View style={styles.modalActions}>
                <Pressable onPress={() => !createBusy && setCreateOpen(false)} style={styles.modalBtn}>
                  <Text style={styles.modalBtnTxt}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void submitCreate()}
                  disabled={createBusy}
                  style={[styles.modalBtn, styles.modalBtnPrimary, createBusy && styles.modalBtnDisabled]}
                >
                  {createBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>{t('groups.newGroup.create')}</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );

  const submitCreate = async () => {
    const n = newName.trim();
    if (!n) {
      showAppAlert(t('groups.newGroup.title'), t('groups.newGroup.enterName'));
      return;
    }
    if (supabaseOn) {
      setCreateBusy(true);
      try {
        const accessToken =
          googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
        const res = await createSocialGroup(n, accessToken);
        if ('error' in res) {
          showAppAlert(t('groups.createGroup.alertTitle'), res.error);
          return;
        }
        setNewName('');
        setCreateOpen(false);
        void (async () => {
          try {
            await fetchMySocialGroupsIntoStore(user?.id, accessToken);
            recomputeGroupsFromYou();
            const ng = useAppStore.getState().groups;
            const i = ng.findIndex((gr) => gr.id === res.id);
            if (i >= 0) setTab(i);
            else setTab(Math.max(0, ng.length - 1));
          } catch (e) {
            console.warn('[groups] refresh after create', e);
            showAppAlert(t('groups.createGroup.createdTitle'), t('groups.createGroup.createdBody'));
          }
        })();
      } catch (e) {
        showAppAlert(
          t('groups.createGroup.alertTitle'),
          e instanceof Error ? e.message : t('common.somethingWentWrong')
        );
      } finally {
        setCreateBusy(false);
      }
      return;
    }
    const nextTab = groups.length;
    addGroup(n);
    setNewName('');
    setCreateOpen(false);
    setTab(nextTab);
  };

  const openInvite = () => {
    setInviteEmail('');
    setInvitePhase('form');
    setInviteSuccessDetail('');
    setInviteOpen(true);
  };

  const closeInvite = () => {
    setInviteOpen(false);
    setInviteEmail('');
    setInvitePhase('form');
    setInviteSuccessDetail('');
  };

  const openBulkInvite = () => {
    setBulkInviteText('');
    setBulkInvitePhase('form');
    setBulkInviteResults(null);
    setBulkInviteOpen(true);
  };

  const closeBulkInvite = () => {
    setBulkInviteOpen(false);
    setBulkInviteText('');
    setBulkInvitePhase('form');
    setBulkInviteResults(null);
  };

  const emailLooksValid = (raw: string) => {
    const e = raw.trim();
    if (e.length < 5) return false;
    const at = e.indexOf('@');
    const dot = e.lastIndexOf('.');
    return at > 0 && dot > at + 1 && dot < e.length - 1;
  };

  const submitInvite = async () => {
    if (!g) return;
    const email = inviteEmail.trim();
    if (!emailLooksValid(email)) {
      showAppAlert(t('groups.invite.checkEmailTitle'), t('groups.invite.checkEmailBody'));
      return;
    }
    if (supabaseOn) {
      setInviteBusy(true);
      const { error, result } = await sendGroupInvite(g.id, email, googleOAuthAccessToken ?? undefined);
      setInviteBusy(false);
      if (error) {
        showAppAlert(t('groups.invite.alertTitle'), error);
        return;
      }
      if (result?.kind === 'already_member') {
        showAppAlert(t('groups.invite.alreadyMemberTitle'), t('groups.invite.alreadyMemberBody', { email }));
        return;
      }
      if (result?.kind === 'in_app') {
        const detail = result.duplicate
          ? t('groups.invite.pendingDuplicate', { email })
          : t('groups.invite.inAppDetail');
        setInviteSuccessDetail(t('groups.invite.sentDetail', { email, detail }));
        if (!result.duplicate) {
          await fetchMySocialGroupsIntoStore(user?.id, googleOAuthAccessToken ?? undefined);
          recomputeGroupsFromYou();
        }
        setInvitePhase('success');
        return;
      }
      if (result?.kind === 'email') {
        const detail = result.duplicate
          ? t('groups.invite.emailDuplicate')
          : t('groups.invite.emailDetail', { url: APP_INVITE_URL });
        if (!result.duplicate) {
          openMailtoSimCapInvite(email, displayName, t);
          await fetchMySocialGroupsIntoStore(user?.id, googleOAuthAccessToken ?? undefined);
          recomputeGroupsFromYou();
        }
        setInviteSuccessDetail(t('groups.invite.sentDetail', { email, detail }));
        setInvitePhase('success');
        return;
      }
      showAppAlert(t('groups.invite.alertTitle'), t('common.somethingWentWrong'));
      return;
    }
    showAppAlert(t('groups.invite.alertTitle'), t('groups.invite.offline'));
    closeInvite();
  };

  const submitBulkInvite = async () => {
    if (!g) return;
    const { valid, invalid } = parseBulkInviteEmails(bulkInviteText);
    if (valid.length === 0 && invalid.length === 0) {
      showAppAlert(t('groups.bulk.title'), t('groups.bulk.enterOne'));
      return;
    }
    if (!supabaseOn) {
      showAppAlert(t('groups.bulk.title'), t('groups.invite.offline'));
      closeBulkInvite();
      return;
    }

    setBulkInviteBusy(true);
    const apiResult =
      valid.length > 0
        ? await sendBulkGroupInvites(g.id, valid, googleOAuthAccessToken ?? undefined)
        : { items: [], succeeded: 0, failed: 0, anyNewInvite: false };

    const invalidItems = invalid.map((email) => ({
      email,
      ok: false as const,
      reason: t('groups.bulk.invalidEmail'),
    }));
    const combined: SendBulkGroupInvitesResult = {
      items: [...apiResult.items, ...invalidItems],
      succeeded: apiResult.succeeded,
      failed: apiResult.failed + invalidItems.length,
      anyNewInvite: apiResult.anyNewInvite,
    };

    setBulkInviteBusy(false);
    setBulkInviteResults(combined);
    setBulkInvitePhase('results');

    if (combined.anyNewInvite) {
      await fetchMySocialGroupsIntoStore(user?.id, googleOAuthAccessToken ?? undefined);
      recomputeGroupsFromYou();
    }
  };

  const onAcceptInboundInvite = async (inv: { id: string; groupId: string }) => {
    setInboundBusy(true);
    const { error } = await respondToGroupInvite(inv.id, true, googleOAuthAccessToken ?? undefined);
    setInboundBusy(false);
    if (error) {
      showAppAlert(t('groups.inbound.acceptTitle'), error);
      return;
    }
    await fetchMySocialGroupsIntoStore(user?.id, googleOAuthAccessToken ?? undefined);
    await fetchInboundGroupInvitesIntoStore(user?.id, googleOAuthAccessToken ?? undefined);
    recomputeGroupsFromYou();
    const ng = useAppStore.getState().groups;
    const gi = ng.findIndex((gr) => gr.id === inv.groupId);
    if (gi >= 0) setTab(gi);
    showAppAlert(t('groups.inbound.welcomeTitle'), t('groups.inbound.welcomeBody'));
  };

  const onDeclineInboundInvite = async (inviteId: string) => {
    setInboundBusy(true);
    const { error } = await respondToGroupInvite(inviteId, false, googleOAuthAccessToken ?? undefined);
    setInboundBusy(false);
    if (error) {
      showAppAlert(t('groups.inbound.declineTitle'), error);
      return;
    }
    await fetchInboundGroupInvitesIntoStore(user?.id, googleOAuthAccessToken ?? undefined);
  };

  const onCancelOutboundInvite = async (kind: 'in_app' | 'email', id: string) => {
    const { error } = await cancelOutboundGroupInvite(kind, id, googleOAuthAccessToken ?? undefined);
    if (error) {
      showAppAlert(t('groups.cancelInviteTitle'), error);
      return;
    }
    await fetchMySocialGroupsIntoStore(user?.id, googleOAuthAccessToken ?? undefined);
    recomputeGroupsFromYou();
  };

  const needsCreatorsBackfill = useMemo(
    () => supabaseOn && groups.some((gr) => gr.id && !gr.createdByUserId?.trim()),
    [groups, supabaseOn]
  );

  useEffect(() => {
    if (!needsCreatorsBackfill) {
      setCreatorsBackfillReady(true);
      return;
    }
    let cancelled = false;
    setCreatorsBackfillReady(false);
    void (async () => {
      const accessToken =
        googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
      await backfillGroupCreatorsInStore(accessToken);
      if (!cancelled) setCreatorsBackfillReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [needsCreatorsBackfill]);

  const authUserId = session?.user?.id ?? user?.id ?? g?.members.find((m) => m.isYou)?.userId ?? null;

  const isGroupCreator = useMemo(
    () => isSocialGroupCreator(g, authUserId),
    [g, authUserId]
  );
  const isGroupManager = useMemo(
    () => isSocialGroupManager(g, authUserId),
    [g, authUserId]
  );

  const creatorUserId = g?.createdByUserId?.trim().toLowerCase() ?? '';
  const memberIsCreator = useCallback(
    (userId: string | undefined) =>
      !!userId && !!creatorUserId && userId.trim().toLowerCase() === creatorUserId,
    [creatorUserId]
  );

  const leagueDisplayNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mem of g?.members ?? []) {
      if (mem.userId) m[mem.userId] = mem.displayName.replace(' (you)', '');
    }
    return m;
  }, [g?.members]);

  const onToggleMemberAdmin = async (memberUserId: string, makeAdmin: boolean) => {
    if (!g?.id || !isGroupCreator || !memberUserId) return;
    setAdminBusyUserId(memberUserId);
    const res = await setGroupMemberAdmin(
      g.id,
      memberUserId,
      makeAdmin,
      googleOAuthAccessToken ?? undefined
    );
    setAdminBusyUserId(null);
    if (res.error) {
      showAppAlert(t('groups.admin.roleTitle'), res.error);
      return;
    }
    patchGroupMemberAdminInStore(g.id, memberUserId, makeAdmin);
  };

  const onDeleteGroup = async () => {
    if (!g?.id || !isGroupCreator) return;
    const ok = await confirmDestructive(
      t('groups.delete.confirmTitle'),
      t('groups.delete.confirmBody'),
      t('groups.delete.confirmAction')
    );
    if (!ok) return;
    const deletedId = g.id;
    const delIdx = groups.findIndex((gr) => gr.id === deletedId);
    setDeleteGroupBusy(true);
    const DELETE_MS = 25000;
    try {
      console.warn('[groups] onDeleteGroup:start', { deletedId, delIdx, tab });
      const res = await Promise.race([
        deleteSocialGroupAsCreator(deletedId, googleOAuthAccessToken ?? undefined),
        new Promise<{ error: string }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                error: t('groups.delete.timeout', { seconds: DELETE_MS / 1000 }),
              }),
            DELETE_MS
          )
        ),
      ]);
      if ('error' in res) {
        console.warn('[groups] onDeleteGroup:failed', res.error);
        showAppAlert(t('groups.delete.alertTitle'), res.error);
        return;
      }
      console.warn('[groups] onDeleteGroup:server_ok, updating store');
      removeGroupById(deletedId);
      const len = useAppStore.getState().groups.length;
      console.warn('[groups] onDeleteGroup:store_after_remove', { len });
      if (len === 0) {
        setTab(0);
        return;
      }
      let nextTab = tab;
      if (delIdx < tab) nextTab -= 1;
      else if (delIdx === tab) nextTab = Math.min(tab, len - 1);
      setTab(Math.max(0, nextTab));
    } catch (e) {
      console.warn('[groups] onDeleteGroup:throw', e instanceof Error ? e.message : e);
      showAppAlert(
        t('groups.delete.alertTitle'),
        e instanceof Error ? e.message : t('common.somethingWentWrong')
      );
    } finally {
      setDeleteGroupBusy(false);
      console.warn('[groups] onDeleteGroup:finally');
    }
  };

  const inboundInviteCards =
    supabaseOn && inboundGroupInvites.length > 0
      ? inboundGroupInvites.map((inv) => (
          <View key={inv.id} style={styles.inboundCard}>
            <Text style={styles.inboundText}>
              <Text style={styles.inboundStrong}>{inv.inviterName}</Text>
              {t('groups.inbound.invitedJoin')}
              <Text style={styles.inboundStrong}>{inv.groupName}</Text>
            </Text>
            <View style={styles.inboundActions}>
              <Pressable
                onPress={() => void onAcceptInboundInvite(inv)}
                disabled={inboundBusy}
                style={[styles.inboundBtn, styles.inboundBtnAccept, inboundBusy && styles.modalBtnDisabled]}
              >
                <Text style={styles.inboundBtnAcceptTxt}>{t('groups.inbound.accept')}</Text>
              </Pressable>
              <Pressable
                onPress={() => void onDeclineInboundInvite(inv.id)}
                disabled={inboundBusy}
                style={[styles.inboundBtn, styles.inboundBtnDecline, inboundBusy && styles.modalBtnDisabled]}
              >
                <Text style={styles.inboundBtnDeclineTxt}>{t('groups.inbound.decline')}</Text>
              </Pressable>
            </View>
          </View>
        ))
      : [];

  if (groups.length === 0) {
    return (
      <View style={styles.page}>
        <ContentWidth bg={colors.surface} style={styles.contentWidthOuter} contentStyle={styles.contentWidthInner}>
          <View style={styles.root}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={{ paddingTop: 22, paddingBottom: insets.bottom + 16 }}
              showsVerticalScrollIndicator={false}
            >
              {inboundInviteCards.length > 0 ? (
                <View style={[styles.inboundCardsWrap, { marginHorizontal: gutter }]}>{inboundInviteCards}</View>
              ) : null}
              <View style={[styles.myGroupsHeader, { paddingHorizontal: gutter }]}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={socialPageSectionTitleStyles.text} accessibilityRole="header">
                    {t('groups.myGroups')}
                  </Text>
                  <Pressable
                    style={styles.infoBtn}
                    onPress={() => setSocialSectionInfo('groups')}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={t('groups.aboutMyGroupsA11y')}
                  >
                    <Text style={styles.infoBtnTxt}>ⓘ</Text>
                  </Pressable>
                </View>
              </View>
              <Text style={[styles.emptyLead, { marginHorizontal: gutter }]}>
                {t('groups.emptyLead')}
              </Text>
              <Text style={[styles.emptyMuted, { marginHorizontal: gutter }]}>
                {t('groups.emptyMuted')}
              </Text>
              {listRefreshing ? (
                <View style={[styles.inlineLoader, { marginHorizontal: gutter }]}>
                  <ActivityIndicator color={colors.header} />
                </View>
              ) : null}
              <Pressable style={[styles.emptyCta, { marginHorizontal: gutter }]} onPress={onCreate}>
                <IconPlus size={18} color="#fff" />
                <Text style={styles.emptyCtaTxt}>{t('groups.createFirstGroup')}</Text>
              </Pressable>
              <View style={styles.socialMatchPlaySection}>
                <MatchPlayHub
                  gutter={gutter}
                  userId={user?.id}
                  supabaseOn={supabaseOn}
                  onIncomingDirectCount={onIncomingDirectMatchCount}
                  onOutgoingAcceptedUnseenCount={onOutgoingAcceptedUnseenCount}
                  onMatchPlayInfoPress={() => setSocialSectionInfo('match')}
                />
              </View>
            </ScrollView>

            {createGroupModal}

            <Modal
              visible={socialSectionInfo != null}
              animationType={Platform.OS === 'web' ? 'none' : 'fade'}
              transparent
              onRequestClose={() => setSocialSectionInfo(null)}
            >
              <View style={styles.infoExplainRoot}>
                <Pressable style={styles.infoExplainBackdrop} onPress={() => setSocialSectionInfo(null)} />
                <View style={[styles.infoExplainSheet, { paddingBottom: insets.bottom + 16 }]}>
                  {socialSectionInfo != null ? (
                    <>
                      <Text style={styles.infoExplainTitle}>{sectionInfoCopy[socialSectionInfo].title}</Text>
                      <Text style={styles.infoExplainBody}>{sectionInfoCopy[socialSectionInfo].body}</Text>
                    </>
                  ) : null}
                </View>
              </View>
            </Modal>
          </View>
        </ContentWidth>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <ContentWidth bg={colors.surface} style={styles.contentWidthOuter} contentStyle={styles.contentWidthInner}>
        <View style={styles.root}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingTop: 22, paddingBottom: insets.bottom + 16 }}
            showsVerticalScrollIndicator={false}
          >
            <PendingTournamentHolesBanner gutter={gutter} />
            {inboundInviteCards.length > 0 ? (
              <View style={[styles.inboundCardsWrap, { marginHorizontal: gutter }]}>{inboundInviteCards}</View>
            ) : null}

            <View style={[styles.myGroupsHeader, { paddingHorizontal: gutter }]}>
              <View style={styles.sectionHeaderRow}>
                <Text style={socialPageSectionTitleStyles.text} accessibilityRole="header">
                  {t('groups.myGroups')}
                </Text>
                <Pressable
                  style={styles.infoBtn}
                  onPress={() => setSocialSectionInfo('groups')}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('groups.aboutMyGroupsA11y')}
                >
                  <Text style={styles.infoBtnTxt}>ⓘ</Text>
                </Pressable>
              </View>
            </View>
            <View style={[styles.tabsBarBleed, { marginHorizontal: -gutter, paddingHorizontal: gutter }]}>
              {groups.map((gr, i) => (
                <Pressable
                  key={gr.id}
                  style={[styles.groupTab, tab === i && styles.groupTabOn]}
                  onPress={() => setTab(i)}
                >
                  <Text style={[styles.groupTabTxt, tab === i && styles.groupTabTxtOn]} numberOfLines={1}>
                    {gr.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.createGroupBtn,
                { marginHorizontal: gutter },
                pressed && styles.createGroupBtnPressed,
              ]}
              onPress={onCreate}
              accessibilityRole="button"
              accessibilityLabel={t('groups.createNewGroupA11y')}
            >
              <Text style={styles.createGroupBtnTxt}>{t('groups.createNewGroup')}</Text>
            </Pressable>

            <View style={[styles.card, { marginHorizontal: gutter }]}>
              <View style={styles.cardHdr}>
                <View style={styles.cardHdrTitle}>
                  <Text style={styles.groupName}>{g.name}</Text>
                  {g.lastRoundSummary ? <Text style={styles.groupMeta}>{g.lastRoundSummary}</Text> : null}
                </View>
                <View style={styles.cardHdrActions}>
                  <Pressable
                    onPress={() => router.push(`/(tabs)/group-chat/${g.id}` as never)}
                    accessibilityRole="button"
                    accessibilityLabel={t('groups.chatA11y', { name: g.name })}
                  >
                    <Text style={styles.invite}>{t('groups.chat')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={openInvite}
                    accessibilityRole="button"
                    accessibilityLabel={t('groups.invite.inviteA11y', { name: g.name })}
                  >
                    <Text style={styles.invite}>{t('groups.invite.plusInvite')}</Text>
                  </Pressable>
                  {isGroupManager ? (
                    <Pressable
                      onPress={openBulkInvite}
                      accessibilityRole="button"
                      accessibilityLabel={t('groups.invite.bulkA11y', { name: g.name })}
                    >
                      <Text style={styles.invite}>{t('groups.invite.bulkLabel')}</Text>
                    </Pressable>
                  ) : null}
                  {isGroupCreator ? (
                    <Pressable
                      onPress={() => void onDeleteGroup()}
                      disabled={deleteGroupBusy}
                      style={({ pressed }) => [styles.groupDeleteBtn, pressed && styles.groupDeleteBtnPressed]}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t('groups.delete.a11y', { name: g.name })}
                    >
                      {deleteGroupBusy ? (
                        <ActivityIndicator size="small" color={colors.subtle} />
                      ) : (
                        <Ionicons name="trash-outline" size={22} color={colors.subtle} />
                      )}
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {!hasMemberOrPending ? (
                <Text style={[styles.membersEmpty, { paddingHorizontal: 12, paddingVertical: 14 }]}>
                  {t('groups.membersEmpty')}
                </Text>
              ) : (
                <>
                  {ranked.map((m, rank) => {
                    const tr = trendLabel(m.trend, t);
                    const av = avatarStyle(rank);
                    return (
                      <View key={m.id} style={[styles.lbRow, m.isYou && styles.lbRowMe]}>
                        <Text
                          style={[
                            styles.lbRank,
                            rank === 0 && styles.rankGold,
                            rank === 1 && styles.rankSilver,
                            rank === 2 && styles.rankBronze,
                          ]}
                        >
                          {rank + 1}
                        </Text>
                        <View style={[styles.lbAv, { backgroundColor: av.backgroundColor }]}>
                          <Text style={[styles.lbAvTxt, { color: av.color }]}>{m.initials}</Text>
                        </View>
                        <View style={styles.lbInfo}>
                          <View style={styles.lbNameRow}>
                            <Text style={[styles.lbName, m.isYou && styles.lbNameMe]} numberOfLines={1}>
                              {m.displayName}
                            </Text>
                            {memberIsCreator(m.userId) ? (
                              <Text style={styles.creatorBadge}>{t('groups.creatorBadge')}</Text>
                            ) : m.isAdmin ? (
                              <Text style={styles.adminBadge}>{t('groups.admin.badge')}</Text>
                            ) : null}
                          </View>
                          <Text style={styles.lbSub} numberOfLines={1}>
                            {t('groups.roundsPlatform', { count: m.roundsLogged, platform: m.platform })}
                          </Text>
                        </View>
                        <View style={styles.lbRight}>
                          <Text style={styles.lbIdx}>
                            {formatHandicapIndexDisplay(m.index)}
                          </Text>
                          <Text style={tr.style}>{tr.text}</Text>
                          {isGroupCreator && m.userId && !m.isYou ? (
                            <Pressable
                              onPress={() => void onToggleMemberAdmin(m.userId, !m.isAdmin)}
                              disabled={adminBusyUserId === m.userId}
                              hitSlop={6}
                              style={styles.adminTogglePress}
                            >
                              <Text style={styles.adminToggleTxt}>
                                {adminBusyUserId === m.userId
                                  ? '…'
                                  : m.isAdmin
                                    ? t('groups.admin.remove')
                                    : t('groups.admin.make')}
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                  {pendingInAppRows.map((p) => (
                    <View key={p.id} style={[styles.lbRow, styles.lbRowPending]}>
                      <Text style={styles.lbRank}>—</Text>
                      <View style={[styles.lbAv, styles.lbAvMuted]}>
                        <Text style={styles.lbAvMutedTxt}>…</Text>
                      </View>
                      <View style={styles.lbInfo}>
                        <Text style={styles.lbName} numberOfLines={1}>
                          {p.label}
                        </Text>
                        <Text style={styles.lbSub} numberOfLines={1}>
                          {t('groups.pendingInvite')}
                        </Text>
                      </View>
                      {isGroupManager ? (
                        <Pressable
                          onPress={() => void onCancelOutboundInvite('in_app', p.id)}
                          hitSlop={8}
                          style={styles.cancelInvitePress}
                        >
                          <Text style={styles.cancelInviteTxt}>{t('common.cancel')}</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.lbRight}>
                          <Text style={styles.pendingBadge}>{t('groups.pendingBadge')}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                  {pendingEmailRows.map((p) => (
                    <View key={p.id} style={[styles.lbRow, styles.lbRowPending]}>
                      <Text style={styles.lbRank}>—</Text>
                      <View style={[styles.lbAv, styles.lbAvMuted]}>
                        <Text style={styles.lbAvMutedTxt}>@</Text>
                      </View>
                      <View style={styles.lbInfo}>
                        <Text style={styles.lbName} numberOfLines={1}>
                          {p.email}
                        </Text>
                        <Text style={styles.lbSub} numberOfLines={1}>
                          {t('groups.pendingEmailInvite')}
                        </Text>
                      </View>
                      {isGroupManager ? (
                        <Pressable
                          onPress={() => void onCancelOutboundInvite('email', p.id)}
                          hitSlop={8}
                          style={styles.cancelInvitePress}
                        >
                          <Text style={styles.cancelInviteTxt}>{t('common.cancel')}</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.lbRight}>
                          <Text style={styles.pendingBadge}>{t('groups.pendingBadge')}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
            </View>

            {g ? (
              <GroupTournamentsSection
                key={g.id}
                group={g}
                authUserId={authUserId}
                gutter={gutter}
                displayNames={leagueDisplayNames}
                onInfoPress={() => setSocialSectionInfo('tournaments')}
              />
            ) : null}

            <View style={styles.socialMatchPlaySection}>
              <MatchPlayHub
                gutter={gutter}
                userId={user?.id}
                supabaseOn={supabaseOn}
                onIncomingDirectCount={onIncomingDirectMatchCount}
                onOutgoingAcceptedUnseenCount={onOutgoingAcceptedUnseenCount}
                onMatchPlayInfoPress={() => setSocialSectionInfo('match')}
              />
            </View>

            <View style={[styles.myGroupsHeader, { paddingHorizontal: gutter, marginTop: 16 }]}>
              <View style={styles.sectionHeaderRow}>
                <Text style={socialPageSectionTitleStyles.text} accessibilityRole="header">
                  {t('groups.section.net.title')}
                </Text>
                <Pressable
                  style={styles.infoBtn}
                  onPress={() => setSocialSectionInfo('net')}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('groups.net.aboutA11y')}
                >
                  <Text style={styles.infoBtnTxt}>ⓘ</Text>
                </Pressable>
              </View>
            </View>
            <Pressable
              style={[styles.netCalcCard, { marginHorizontal: gutter }]}
              onPress={() => router.push('/(tabs)/net-calculator')}
              accessibilityRole="button"
              accessibilityLabel={t('groups.net.openA11y')}
            >
              <View style={styles.netCalcCardInner}>
                <View style={styles.netCalcCardTextCol}>
                  <Text style={styles.netCalcCardDesc}>{t('groups.net.cardDesc')}</Text>
                </View>
                <Text style={styles.netCalcChev} accessible={false}>
                  ›
                </Text>
              </View>
            </Pressable>
          </ScrollView>

          {createGroupModal}

          <Modal visible={inviteOpen} animationType="fade" transparent>
            <Pressable style={styles.modalBackdrop} onPress={() => !inviteBusy && closeInvite()}>
              <KeyboardAvoidingView
                style={styles.modalKeyboardAvoid}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Math.max(insets.bottom, 12)}
              >
                <ScrollView
                  style={styles.modalScroll}
                  contentContainerStyle={styles.modalScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
                    {invitePhase === 'form' ? (
                      <>
                        <Text style={styles.modalTitle}>{t('groups.invite.modalTitle')}</Text>
                        <Text style={styles.modalSub}>
                          {t('groups.invite.modalSubBefore')}
                          <Text style={styles.modalSubStrong}>{g.name}</Text>
                          {t('groups.invite.modalSubAfter')}
                        </Text>
                        <TextInput
                          style={styles.modalInput}
                          placeholder={t('groups.invite.emailPlaceholder')}
                          placeholderTextColor={colors.subtle}
                          value={inviteEmail}
                          onChangeText={setInviteEmail}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="email"
                          autoFocus
                          editable={!inviteBusy}
                        />
                        <View style={styles.modalActions}>
                          <Pressable onPress={() => !inviteBusy && closeInvite()} style={styles.modalBtn}>
                            <Text style={styles.modalBtnTxt}>{t('common.cancel')}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => void submitInvite()}
                            disabled={inviteBusy}
                            style={[styles.modalBtn, styles.modalBtnPrimary, inviteBusy && styles.modalBtnDisabled]}
                          >
                            {inviteBusy ? (
                              <ActivityIndicator color="#fff" />
                            ) : (
                              <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>{t('groups.invite.send')}</Text>
                            )}
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.modalTitle}>{t('groups.invite.sentTitle')}</Text>
                        <Text style={styles.modalSuccessBody}>{inviteSuccessDetail}</Text>
                        <View style={styles.modalActionsCol}>
                          <Pressable
                            onPress={() => {
                              setInvitePhase('form');
                              setInviteEmail('');
                              setInviteSuccessDetail('');
                            }}
                            style={[styles.modalBtn, styles.modalBtnGhost]}
                          >
                            <Text style={styles.modalBtnGhostTxt}>{t('groups.invite.inviteSomeoneElse')}</Text>
                          </Pressable>
                          <Pressable onPress={closeInvite} style={[styles.modalBtn, styles.modalBtnPrimary]}>
                            <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>{t('common.done')}</Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                  </Pressable>
                </ScrollView>
              </KeyboardAvoidingView>
            </Pressable>
          </Modal>

          <Modal visible={bulkInviteOpen} animationType="fade" transparent>
            <Pressable style={styles.modalBackdrop} onPress={() => !bulkInviteBusy && closeBulkInvite()}>
              <KeyboardAvoidingView
                style={styles.modalKeyboardAvoid}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Math.max(insets.bottom, 12)}
              >
                <ScrollView
                  style={styles.modalScroll}
                  contentContainerStyle={styles.modalScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
                    {bulkInvitePhase === 'form' ? (
                      <>
                        <Text style={styles.modalTitle}>{t('groups.bulk.title')}</Text>
                        <Text style={styles.modalSub}>
                          {t('groups.bulk.modalSubBefore')}
                          <Text style={styles.modalSubStrong}>{g.name}</Text>
                          {t('groups.bulk.modalSubAfter')}
                        </Text>
                        <TextInput
                          style={[styles.modalInput, styles.modalTextArea]}
                          placeholder={t('groups.bulk.placeholder')}
                          placeholderTextColor={colors.subtle}
                          value={bulkInviteText}
                          onChangeText={setBulkInviteText}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          autoCorrect={false}
                          multiline
                          textAlignVertical="top"
                          editable={!bulkInviteBusy}
                        />
                        <View style={styles.modalActions}>
                          <Pressable onPress={() => !bulkInviteBusy && closeBulkInvite()} style={styles.modalBtn}>
                            <Text style={styles.modalBtnTxt}>{t('common.cancel')}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => void submitBulkInvite()}
                            disabled={bulkInviteBusy}
                            style={[styles.modalBtn, styles.modalBtnPrimary, bulkInviteBusy && styles.modalBtnDisabled]}
                          >
                            {bulkInviteBusy ? (
                              <ActivityIndicator color="#fff" />
                            ) : (
                              <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>{t('groups.bulk.send')}</Text>
                            )}
                          </Pressable>
                        </View>
                      </>
                    ) : bulkInviteResults ? (
                      <>
                        <Text style={styles.modalTitle}>{t('groups.bulk.resultsTitle')}</Text>
                        <Text style={styles.modalSuccessBody}>
                          {t('groups.bulk.resultsSummary', {
                            succeeded: bulkInviteResults.succeeded,
                            failed: bulkInviteResults.failed,
                          })}
                        </Text>
                        {bulkInviteResults.items.length > 0 ? (
                          <View style={styles.bulkInviteResultsList}>
                            {bulkInviteResults.items.map((item) => (
                              <View key={item.email} style={styles.bulkInviteResultRow}>
                                <Text
                                  style={[
                                    styles.bulkInviteResultEmail,
                                    item.ok ? styles.bulkInviteResultOk : styles.bulkInviteResultFail,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.email}
                                </Text>
                                <Text style={styles.bulkInviteResultReason}>{item.reason}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        <View style={styles.modalActionsCol}>
                          <Pressable
                            onPress={() => {
                              setBulkInvitePhase('form');
                              setBulkInviteText('');
                              setBulkInviteResults(null);
                            }}
                            style={[styles.modalBtn, styles.modalBtnGhost]}
                          >
                            <Text style={styles.modalBtnGhostTxt}>{t('groups.bulk.inviteMore')}</Text>
                          </Pressable>
                          <Pressable onPress={closeBulkInvite} style={[styles.modalBtn, styles.modalBtnPrimary]}>
                            <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>{t('common.done')}</Text>
                          </Pressable>
                        </View>
                      </>
                    ) : null}
                  </Pressable>
                </ScrollView>
              </KeyboardAvoidingView>
            </Pressable>
          </Modal>

          <Modal
            visible={socialSectionInfo != null}
            animationType={Platform.OS === 'web' ? 'none' : 'fade'}
            transparent
            onRequestClose={() => setSocialSectionInfo(null)}
          >
            <View style={styles.infoExplainRoot}>
              <Pressable style={styles.infoExplainBackdrop} onPress={() => setSocialSectionInfo(null)} />
              <View style={[styles.infoExplainSheet, { paddingBottom: insets.bottom + 16 }]}>
                {socialSectionInfo != null ? (
                  <>
                    <Text style={styles.infoExplainTitle}>{sectionInfoCopy[socialSectionInfo].title}</Text>
                    <Text style={styles.infoExplainBody}>{sectionInfoCopy[socialSectionInfo].body}</Text>
                  </>
                ) : null}
              </View>
            </View>
          </Modal>
        </View>
      </ContentWidth>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%', minHeight: 0, backgroundColor: colors.surface },
  contentWidthOuter: { flex: 1, minHeight: 0, width: '100%' },
  contentWidthInner: { flex: 1, minHeight: 0, width: '100%' },
  root: { flex: 1, minHeight: 0, backgroundColor: colors.surface, width: '100%' },
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  emptyLead: { fontSize: 15, color: colors.muted, lineHeight: 22, marginBottom: 12 },
  emptyMuted: { fontSize: 13, color: colors.subtle, lineHeight: 19, marginBottom: 24 },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.header,
    marginTop: 8,
    marginBottom: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyCtaTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  inlineLoader: { alignItems: 'center', marginBottom: 16 },
  membersEmpty: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  modalBtnDisabled: { opacity: 0.7 },
socialMatchPlaySection: {
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: colors.border,
  marginTop: 16,
  paddingBottom: 18,
  marginBottom: 12,
},
  myGroupsHeader: {
    paddingTop: 4,
    paddingBottom: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#7aa390',
    backgroundColor: '#e8f2ed',
  },
  infoBtnTxt: { fontSize: 11, fontWeight: '700', color: '#1a3d2b', lineHeight: 12 },
  infoExplainRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  infoExplainBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  infoExplainSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  infoExplainTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: colors.ink },
  infoExplainBody: { fontSize: 14, lineHeight: 21, color: colors.ink },
  tabsBarBleed: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  groupTab: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 99,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    backgroundColor: colors.accentSoft,
    maxWidth: 160,
  },
  groupTabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  groupTabTxt: { fontSize: 12, fontWeight: '600', color: colors.muted },
  groupTabTxtOn: { color: '#fff' },
  card: {
    marginTop: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardHdr: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  cardHdrTitle: { flex: 1, minWidth: 0 },
  cardHdrActions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexShrink: 0 },
  groupDeleteBtn: {
    minWidth: 36,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  groupDeleteBtnPressed: { opacity: 0.7 },
  groupName: { fontSize: 13, fontWeight: '600', color: colors.ink },
  groupMeta: { fontSize: 10, color: colors.subtle, marginTop: 1 },
  invite: { fontSize: 11, color: colors.sage, fontWeight: '700' },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  lbRowMe: { backgroundColor: colors.accentSoft },
  lbRank: { width: 18, textAlign: 'center', fontSize: 12, fontWeight: '600', color: colors.subtle },
  rankGold: { color: colors.gold },
  rankSilver: { color: colors.silver },
  rankBronze: { color: colors.bronze },
  lbAv: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbAvTxt: { fontSize: 10, fontWeight: '600' },
  lbInfo: { flex: 1, minWidth: 0 },
  lbNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  lbName: { fontSize: 12, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  lbNameMe: { color: colors.accentDark },
  creatorBadge: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  adminBadge: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  adminTogglePress: { marginTop: 4 },
  adminToggleTxt: { fontSize: 10, fontWeight: '600', color: colors.sage },
  lbSub: { fontSize: 10, color: colors.subtle, marginTop: 1 },
  lbRight: { alignItems: 'flex-end' },
  lbIdx: { fontSize: 14, fontWeight: '600', color: colors.ink },
  trendUp: { fontSize: 10, color: colors.accent },
  trendDn: { fontSize: 10, color: colors.danger },
  trendFl: { fontSize: 10, color: colors.subtle },
  netCalcCard: {
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.bg,
  },
  netCalcCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
  },
  netCalcCardTextCol: { flex: 1, minWidth: 0 },
  netCalcCardDesc: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  netCalcChev: { fontSize: 22, color: colors.subtle, fontWeight: '300' },
  createGroupBtn: {
    marginTop: 8,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.header,
    paddingVertical: 12,
    borderRadius: 12,
  },
  createGroupBtnPressed: { opacity: 0.9 },
  createGroupBtnTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalKeyboardAvoid: {
    width: '100%',
  },
  modalScroll: {
    width: '100%',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  modalBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 18,
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  modalSub: { fontSize: 13, color: colors.muted, lineHeight: 18, marginBottom: 14 },
  modalSubStrong: { fontWeight: '600', color: colors.ink },
  modalInput: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 16,
  },
  modalTextArea: { minHeight: 120, maxHeight: 200 },
  bulkInviteResultsList: { gap: 10, marginBottom: 12, maxHeight: 220 },
  bulkInviteResultRow: { gap: 2 },
  bulkInviteResultEmail: { fontSize: 14, fontWeight: '600' },
  bulkInviteResultOk: { color: colors.sage },
  bulkInviteResultFail: { color: '#b45309' },
  bulkInviteResultReason: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalActionsCol: { gap: 10, marginTop: 4 },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  modalBtnPrimary: { backgroundColor: colors.header, borderRadius: 8, alignItems: 'center' },
  modalBtnGhost: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
  },
  modalBtnGhostTxt: { fontSize: 15, fontWeight: '700', color: colors.accent },
  modalBtnTxt: { fontSize: 15, fontWeight: '600', color: colors.accent },
  modalBtnTxtPri: { color: '#fff', fontWeight: '700' },
  modalSuccessBody: { fontSize: 14, color: colors.muted, lineHeight: 21, marginBottom: 8 },
  inboundCardsWrap: {
    gap: 10,
    marginBottom: 18,
  },
  inboundCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    padding: 14,
  },
  inboundText: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  inboundStrong: { fontWeight: '700', color: colors.header },
  inboundActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  inboundBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  inboundBtnAccept: { backgroundColor: colors.header },
  inboundBtnAcceptTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  inboundBtnDecline: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.sage,
  },
  inboundBtnDeclineTxt: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  lbRowPending: { backgroundColor: colors.bg },
  lbAvMuted: { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  lbAvMutedTxt: { fontSize: 12, fontWeight: '600', color: colors.subtle },
  pendingBadge: { fontSize: 10, fontWeight: '700', color: colors.sage },
  cancelInvitePress: { paddingVertical: 4, paddingHorizontal: 4 },
  cancelInviteTxt: { fontSize: 11, fontWeight: '700', color: colors.danger },
});
