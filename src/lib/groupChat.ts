/**
 * Group chat data access (separate from match_messages / MatchChat).
 */

import { supabase } from './supabase';
import { getSupabaseRestConfig, restSelect } from './tournamentApi';

export type DbGroupMessageRow = {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
  deleted_at: string | null;
};

const MESSAGE_LIMIT = 50;

function restErrorMessage(rawText: string, statusText: string): string {
  let msg = rawText || statusText || 'Request failed';
  try {
    const j = JSON.parse(rawText) as { message?: string };
    if (j?.message) msg = j.message;
  } catch {
    /* keep */
  }
  return msg;
}

/** Last 50 messages, oldest-first for chat UI. */
export async function fetchGroupMessages(
  groupId: string,
  accessToken?: string
): Promise<{ data: DbGroupMessageRow[] | null; error: string | null }> {
  const path =
    `group_messages?group_id=eq.${encodeURIComponent(groupId)}` +
    `&select=id,group_id,user_id,content,created_at,deleted_at` +
    `&order=created_at.desc&limit=${MESSAGE_LIMIT}`;

  if (accessToken) {
    const res = await restSelect<DbGroupMessageRow>(path, accessToken);
    if (res.error) return res;
    return { data: [...(res.data ?? [])].reverse(), error: null };
  }

  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('group_messages')
    .select('id, group_id, user_id, content, created_at, deleted_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_LIMIT);
  if (error) return { data: null, error: error.message };
  return { data: [...(data ?? [])].reverse() as DbGroupMessageRow[], error: null };
}

export async function sendGroupMessage(
  groupId: string,
  userId: string,
  content: string,
  accessToken?: string
): Promise<{ data: DbGroupMessageRow | null; error: string | null }> {
  const trimmed = content.trim().slice(0, 500);
  if (!trimmed) return { data: null, error: 'Message is empty' };

  const row = { group_id: groupId, user_id: userId, content: trimmed };

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) {
      return { data: null, error: 'Supabase is not configured' };
    }
    const res = await fetch(`${supabaseUrl}/rest/v1/group_messages`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) return { data: null, error: restErrorMessage(body, res.statusText) };
    try {
      const parsed = JSON.parse(body) as DbGroupMessageRow[];
      const created = Array.isArray(parsed) ? parsed[0] : null;
      return { data: created ?? null, error: created ? null : 'Could not send message' };
    } catch {
      return { data: null, error: 'Invalid response' };
    }
  }

  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('group_messages')
    .insert(row)
    .select('id, group_id, user_id, content, created_at, deleted_at')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as DbGroupMessageRow, error: null };
}

export async function softDeleteGroupMessage(
  messageId: string,
  accessToken?: string
): Promise<{ error: string | null }> {
  const patch = { deleted_at: new Date().toISOString() };

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) {
      return { error: 'Supabase is not configured' };
    }
    const res = await fetch(
      `${supabaseUrl}/rest/v1/group_messages?id=eq.${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(patch),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: restErrorMessage(body, res.statusText) };
    }
    return { error: null };
  }

  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.from('group_messages').update(patch).eq('id', messageId);
  return { error: error?.message ?? null };
}

export async function reportGroupMessage(
  messageId: string,
  accessToken?: string
): Promise<{ error: string | null }> {
  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) {
      return { error: 'Supabase is not configured' };
    }
    const res = await fetch(`${supabaseUrl}/rest/v1/group_message_reports`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ message_id: messageId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: restErrorMessage(body, res.statusText) };
    }
    return { error: null };
  }

  if (!supabase) return { error: 'Supabase is not configured' };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('group_message_reports')
    .insert({ message_id: messageId, reported_by: user.id });
  return { error: error?.message ?? null };
}
