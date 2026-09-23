import {
  Events,
  EmbedBuilder,
  AuditLogEvent,
  type VoiceState,
  type VoiceBasedChannel,
} from 'discord.js';
import type { EventHandler } from '../../types/index.js';
import { getGuildConfig } from '../../config/guildConfig.js';
import { sendLog, sendLogToChannel } from '../../services/logService.js';
import {
  startSession, recordMove, endSession, recordChannelSize,
} from '../../services/voiceSessions.js';

const MODULE = 'logging';

/** Accent colors per event kind (kept in the LGCY palette). */
export const VOICE_COLORS = {
  join: 0x35d07f, // green
  move: 0x2b8cff, // blue
  leave: 0xa855f7, // purple
  mod: 0xff7a1a, // orange/red — moderator actions
  state: 0x5865f2, // neutral blurple — self-state debug
} as const;

// ── Classification (pure) ───────────────────────────────────────────
export interface VoiceStateLike {
  channelId: string | null;
  selfMute: boolean; selfDeaf: boolean;
  serverMute: boolean; serverDeaf: boolean;
  streaming: boolean; selfVideo: boolean;
}

export type ServerStateChange = 'serverMuteOn' | 'serverMuteOff' | 'serverDeafOn' | 'serverDeafOff';
export type SelfStateChange =
  | 'selfMuteOn' | 'selfMuteOff' | 'selfDeafOn' | 'selfDeafOff'
  | 'streamOn' | 'streamOff' | 'cameraOn' | 'cameraOff';
export type StateChange = ServerStateChange | SelfStateChange;

export type VoiceEvent =
  | { kind: 'join'; channelId: string }
  | { kind: 'leave'; channelId: string }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'state'; channelId: string; changes: StateChange[] }
  | { kind: 'none' };

/** Self-state → debug channel. title = header, verb = "who did what" line. */
export const SELF_STATE_META: Record<SelfStateChange, { cat: 'selfMuteDeafen' | 'camera' | 'screenShare'; name: string; emoji: string; on: boolean; title: string; verb: string }> = {
  selfMuteOn: { cat: 'selfMuteDeafen', name: 'Self Mute', emoji: '🔇', on: true, title: 'Self Muted', verb: 'muted themselves' },
  selfMuteOff: { cat: 'selfMuteDeafen', name: 'Self Mute', emoji: '🎙️', on: false, title: 'Self Unmuted', verb: 'unmuted themselves' },
  selfDeafOn: { cat: 'selfMuteDeafen', name: 'Self Deafen', emoji: '🔇', on: true, title: 'Self Deafened', verb: 'deafened themselves' },
  selfDeafOff: { cat: 'selfMuteDeafen', name: 'Self Deafen', emoji: '🎧', on: false, title: 'Self Undeafened', verb: 'undeafened themselves' },
  streamOn: { cat: 'screenShare', name: 'Screen Share', emoji: '🖥️', on: true, title: 'Started Screen Share', verb: 'started screen sharing' },
  streamOff: { cat: 'screenShare', name: 'Screen Share', emoji: '🖥️', on: false, title: 'Stopped Screen Share', verb: 'stopped screen sharing' },
  cameraOn: { cat: 'camera', name: 'Camera', emoji: '📹', on: true, title: 'Turned Camera On', verb: 'turned their camera on' },
  cameraOff: { cat: 'camera', name: 'Camera', emoji: '📹', on: false, title: 'Turned Camera Off', verb: 'turned their camera off' },
};

export type ModAction = 'moved' | 'disconnected' | 'serverMute' | 'serverUnmute' | 'serverDeafen' | 'serverUndeafen';
/** Server-state → moderator event (main log). */
const SERVER_STATE_META: Record<ServerStateChange, { action: ModAction; changeKey: 'mute' | 'deaf' }> = {
  serverMuteOn: { action: 'serverMute', changeKey: 'mute' },
  serverMuteOff: { action: 'serverUnmute', changeKey: 'mute' },
  serverDeafOn: { action: 'serverDeafen', changeKey: 'deaf' },
  serverDeafOff: { action: 'serverUndeafen', changeKey: 'deaf' },
};
const MOD_TITLE: Record<ModAction, string> = {
  moved: '🔨 Moved by Moderator',
  disconnected: '🔨 Disconnected by Moderator',
  serverMute: '🔇 Server Muted by Moderator',
  serverUnmute: '🎙️ Server Unmuted by Moderator',
  serverDeafen: '🔇 Server Deafened by Moderator',
  serverUndeafen: '🎧 Server Undeafened by Moderator',
};
/** Verb for the "who did what to whom" line. */
const MOD_VERB: Record<ModAction, string> = {
  moved: 'moved', disconnected: 'disconnected', serverMute: 'server-muted',
  serverUnmute: 'server-unmuted', serverDeafen: 'server-deafened', serverUndeafen: 'server-undeafened',
};

export function classifyVoiceEvent(o: VoiceStateLike, n: VoiceStateLike): VoiceEvent {
  if (!o.channelId && n.channelId) return { kind: 'join', channelId: n.channelId };
  if (o.channelId && !n.channelId) return { kind: 'leave', channelId: o.channelId };
  if (o.channelId && n.channelId && o.channelId !== n.channelId) return { kind: 'move', from: o.channelId, to: n.channelId };
  if (o.channelId && n.channelId) {
    const c: StateChange[] = [];
    if (o.selfMute !== n.selfMute) c.push(n.selfMute ? 'selfMuteOn' : 'selfMuteOff');
    if (o.selfDeaf !== n.selfDeaf) c.push(n.selfDeaf ? 'selfDeafOn' : 'selfDeafOff');
    if (o.serverMute !== n.serverMute) c.push(n.serverMute ? 'serverMuteOn' : 'serverMuteOff');
    if (o.serverDeaf !== n.serverDeaf) c.push(n.serverDeaf ? 'serverDeafOn' : 'serverDeafOff');
    if (o.streaming !== n.streaming) c.push(n.streaming ? 'streamOn' : 'streamOff');
    if (o.selfVideo !== n.selfVideo) c.push(n.selfVideo ? 'cameraOn' : 'cameraOff');
    return c.length ? { kind: 'state', channelId: n.channelId, changes: c } : { kind: 'none' };
  }
  return { kind: 'none' };
}

// ── Duration formatting (pure) ──────────────────────────────────────
export function formatDuration(ms: number): string {
  if (ms < 1000) return '0s';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.slice(0, 2).join(' ');
}

// ── Moderator attribution (pure) ────────────────────────────────────
export interface AuditEntryLike {
  executorId: string | null;
  executorTag?: string | null;
  targetId?: string | null;
  createdTimestamp: number;
  extraChannelId?: string | null;
  reason?: string | null;
}

export type ModAttribution =
  | { status: 'mod'; id: string; tag: string; reason?: string }
  | { status: 'self' } // no matching audit entry → the member acted on themselves
  | { status: 'unknown' }; // couldn't read the audit log, or ambiguous → don't guess

/**
 * Classifies who caused a voice change. Exactly one in-window audit entry (with
 * matching channel/target when given) → that moderator. Zero → self. Multiple
 * (ambiguous) → unknown. We never guess which moderator acted.
 */
export function classifyModAttribution(
  entries: AuditEntryLike[],
  opts: { now: number; windowMs?: number; channelId?: string; targetId?: string },
): ModAttribution {
  const windowMs = opts.windowMs ?? 4000;
  const candidates = entries.filter(
    (e) =>
      e.executorId &&
      Math.abs(opts.now - e.createdTimestamp) <= windowMs &&
      (!opts.channelId || !e.extraChannelId || e.extraChannelId === opts.channelId) &&
      (!opts.targetId || e.targetId === opts.targetId),
  );
  if (candidates.length === 0) return { status: 'self' };
  if (candidates.length > 1) return { status: 'unknown' };
  const e = candidates[0]!;
  const res: ModAttribution = { status: 'mod', id: e.executorId!, tag: e.executorTag ?? e.executorId! };
  if (e.reason) res.reason = e.reason;
  return res;
}

/** mod info when reliably attributable, else null. */
export function attributeVoiceModerator(
  entries: AuditEntryLike[],
  opts: { now: number; windowMs?: number; channelId?: string; targetId?: string },
): { id: string; tag: string; reason?: string } | null {
  const r = classifyModAttribution(entries, opts);
  if (r.status !== 'mod') return null;
  const out: { id: string; tag: string; reason?: string } = { id: r.id, tag: r.tag };
  if (r.reason) out.reason = r.reason;
  return out;
}

// ── Timestamp helpers ───────────────────────────────────────────────
/** Exact time only, e.g. "9:18 PM". */
const tExact = (sec: number) => `<t:${sec}:t>`;
/** Exact + relative, e.g. "9:18 PM (2 minutes ago)". */
const tBoth = (sec: number) => `<t:${sec}:t> (<t:${sec}:R>)`;

function micSound(selfMute: boolean, selfDeaf: boolean): string {
  const mic = selfMute ? '🔇 Muted' : '🎙️ Unmuted';
  const sound = selfDeaf ? '🔇 Deafened' : '🎧 Undeafened';
  return `${mic} · ${sound}`;
}

// ── Embed renderers (pure) ──────────────────────────────────────────
export interface JoinData {
  username: string; avatarUrl?: string; channelName: string; channelId: string; userId: string;
  countBefore: number; countAfter: number; selfMute: boolean; selfDeaf: boolean;
  timestampSec: number; includeIds: boolean; showCounts: boolean;
}
export function renderJoinEmbed(d: JoinData): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(VOICE_COLORS.join)
    .setAuthor({ name: d.username, iconURL: d.avatarUrl })
    .setTitle('🟢 Joined Voice')
    .addFields({ name: 'Channel', value: `🔊 ${d.channelName}`, inline: true });
  if (d.showCounts) e.addFields({ name: 'Members', value: `${d.countBefore} → ${d.countAfter}`, inline: true });
  e.addFields(
    { name: 'Voice', value: micSound(d.selfMute, d.selfDeaf), inline: true },
    { name: 'Joined', value: tBoth(d.timestampSec), inline: false },
  ).setTimestamp(new Date(d.timestampSec * 1000));
  if (d.includeIds) e.setFooter({ text: `User ${d.userId} • Channel ${d.channelId}` });
  return e;
}

export interface MoveData {
  username: string; avatarUrl?: string; fromName: string; fromId: string; toName: string; toId: string;
  userId: string; timeInPreviousMs: number; fromBefore: number; fromAfter: number; toBefore: number; toAfter: number;
  joinedAtSec: number; moveNumber: number; timestampSec: number; includeIds: boolean;
  showCounts: boolean; showDuration: boolean; moverNote?: string;
}
export function renderMoveEmbed(d: MoveData): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(VOICE_COLORS.move)
    .setAuthor({ name: d.username, iconURL: d.avatarUrl })
    .setTitle('🔀 Voice Channel Changed');
  if (d.moverNote) e.setDescription(d.moverNote);
  e.addFields(
      { name: 'From', value: `🔊 ${d.fromName}`, inline: true },
      { name: 'To', value: `🔊 ${d.toName}`, inline: true },
    );
  if (d.showDuration) e.addFields({ name: 'Time in previous channel', value: formatDuration(d.timeInPreviousMs), inline: false });
  if (d.showCounts) e.addFields({ name: 'Members', value: `${d.fromName}: ${d.fromBefore} → ${d.fromAfter}\n${d.toName}: ${d.toBefore} → ${d.toAfter}`, inline: false });
  e.addFields({ name: 'Session', value: `Joined ${tExact(d.joinedAtSec)} · Move #${d.moveNumber}`, inline: false })
    .setTimestamp(new Date(d.timestampSec * 1000));
  if (d.includeIds) e.setFooter({ text: `User ${d.userId} • From ${d.fromId} • To ${d.toId}` });
  return e;
}

export interface SessionSummaryData {
  username: string; avatarUrl?: string; channelId: string; userId: string;
  routeNames: string[]; sessionDurationMs: number; moveCount: number; peakChannelSize: number;
  joinedAtSec: number; leftAtSec: number; includeIds: boolean; showCounts: boolean; showDuration: boolean;
}
export function renderSessionSummaryEmbed(d: SessionSummaryData): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(VOICE_COLORS.leave)
    .setAuthor({ name: d.username, iconURL: d.avatarUrl })
    .setTitle('🟣 Voice Session Ended');
  if (d.showDuration) e.addFields({ name: '⏱️ Duration', value: formatDuration(d.sessionDurationMs), inline: true });
  e.addFields({ name: '🔀 Moves', value: String(d.moveCount), inline: true });
  if (d.showCounts) e.addFields({ name: '👥 Peak channel size', value: String(d.peakChannelSize), inline: true });
  e.addFields(
    { name: '🗺️ Route', value: d.routeNames.map((n) => `🔊 ${n}`).join(' → '), inline: false },
    { name: '🎙️ Joined', value: tBoth(d.joinedAtSec), inline: false },
    { name: '🚪 Left', value: tBoth(d.leftAtSec), inline: false },
  ).setTimestamp(new Date(d.leftAtSec * 1000));
  if (d.includeIds) e.setFooter({ text: `User ${d.userId} • Channel ${d.channelId}` });
  return e;
}

export interface StateData {
  username: string; avatarUrl?: string; channelName: string; channelId: string; userId: string;
  name: string; emoji: string; on: boolean; title: string; verb: string;
  timestampSec: number; includeIds: boolean;
}
export function renderStateEmbed(d: StateData): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(VOICE_COLORS.state)
    .setAuthor({ name: d.username, iconURL: d.avatarUrl })
    .setTitle(`${d.emoji} ${d.title}`)
    .setDescription(`**${d.username}** ${d.verb}`)
    .addFields(
      { name: d.name, value: `${d.emoji} ${d.on ? 'OFF → ON' : 'ON → OFF'}`, inline: true },
      { name: 'Channel', value: `🔊 ${d.channelName}`, inline: true },
      { name: 'When', value: tBoth(d.timestampSec), inline: false },
    )
    .setTimestamp(new Date(d.timestampSec * 1000));
  if (d.includeIds) e.setFooter({ text: `User ${d.userId} • Channel ${d.channelId}` });
  return e;
}

export interface ModData {
  username: string; avatarUrl?: string; userId: string; action: ModAction;
  fromName?: string; fromId?: string; toName?: string; toId?: string; channelName?: string; channelId?: string;
  moderatorTag: string; moderatorId?: string; reason?: string; timestampSec: number; includeIds: boolean;
}
export function renderModEmbed(d: ModData): EmbedBuilder {
  const verb = MOD_VERB[d.action];
  const e = new EmbedBuilder()
    .setColor(VOICE_COLORS.mod)
    .setAuthor({ name: d.username, iconURL: d.avatarUrl })
    .setTitle(MOD_TITLE[d.action])
    .setDescription(
      d.moderatorTag === 'Unknown'
        ? `**${d.username}** was ${verb} by an unknown moderator`
        : `**${d.moderatorTag}** ${verb} **${d.username}**`,
    );
  if (d.action === 'moved') {
    e.addFields(
      { name: 'From', value: `🔊 ${d.fromName ?? 'Unknown'}`, inline: true },
      { name: 'To', value: `🔊 ${d.toName ?? 'Unknown'}`, inline: true },
    );
  } else {
    e.addFields({ name: 'Channel', value: `🔊 ${d.channelName ?? 'Unknown'}`, inline: true });
  }
  e.addFields(
    { name: 'Moderator', value: d.moderatorTag, inline: true },
    { name: 'When', value: tBoth(d.timestampSec), inline: false },
  );
  if (d.reason) e.addFields({ name: 'Reason', value: d.reason, inline: false });
  e.setTimestamp(new Date(d.timestampSec * 1000));
  if (d.includeIds) {
    const ids = [`User ${d.userId}`];
    if (d.moderatorId) ids.push(`Mod ${d.moderatorId}`);
    if (d.action === 'moved') { if (d.fromId) ids.push(`From ${d.fromId}`); if (d.toId) ids.push(`To ${d.toId}`); }
    else if (d.channelId) ids.push(`Channel ${d.channelId}`);
    e.setFooter({ text: ids.join(' • ') });
  }
  return e;
}

// ── Runtime helpers ─────────────────────────────────────────────────
function toLike(s: VoiceState): VoiceStateLike {
  return {
    channelId: s.channelId,
    selfMute: !!s.selfMute, selfDeaf: !!s.selfDeaf,
    serverMute: !!s.serverMute, serverDeaf: !!s.serverDeaf,
    streaming: !!s.streaming, selfVideo: !!s.selfVideo,
  };
}
const count = (ch: VoiceBasedChannel | null | undefined): number => (ch ? ch.members.size : 0);

async function detectMoveAttribution(
  guild: import('discord.js').Guild,
  type: AuditLogEvent.MemberMove | AuditLogEvent.MemberDisconnect,
  channelId: string | undefined,
  now: number,
): Promise<ModAttribution> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entries: AuditEntryLike[] = [...logs.entries.values()].map((e) => ({
      executorId: e.executor?.id ?? null,
      executorTag: e.executor?.tag ?? null,
      createdTimestamp: e.createdTimestamp,
      extraChannelId: (e.extra as { channel?: { id?: string } } | undefined)?.channel?.id ?? null,
      reason: e.reason ?? null,
    }));
    return classifyModAttribution(entries, { now, windowMs: 4000, channelId });
  } catch {
    return { status: 'unknown' }; // no ViewAuditLog permission → can't attribute
  }
}

async function detectServerStateMod(
  guild: import('discord.js').Guild,
  targetUserId: string,
  changeKey: 'mute' | 'deaf',
  now: number,
): Promise<{ id: string; tag: string; reason?: string } | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 8 });
    const entries: AuditEntryLike[] = [...logs.entries.values()]
      .filter((e) => e.changes?.some((c) => c.key === changeKey))
      .map((e) => ({
        executorId: e.executor?.id ?? null,
        executorTag: e.executor?.tag ?? null,
        targetId: e.targetId ?? null,
        createdTimestamp: e.createdTimestamp,
        reason: e.reason ?? null,
      }));
    return attributeVoiceModerator(entries, { now, windowMs: 4000, targetId: targetUserId });
  } catch {
    return null;
  }
}

// ── Event handler ───────────────────────────────────────────────────
export const voiceStateLog: EventHandler<Events.VoiceStateUpdate> = {
  name: Events.VoiceStateUpdate,
  module: MODULE,
  async execute(_c, oldState: VoiceState, newState: VoiceState) {
    const guild = newState.guild;
    const member = newState.member ?? oldState.member;
    const user = member?.user;
    if (!user || user.bot) return; // skip bots to keep logs clean

    const vl = getGuildConfig(guild.id).voiceLogging;
    const ev = classifyVoiceEvent(toLike(oldState), toLike(newState));
    const now = Date.now();
    const tsSec = Math.floor(now / 1000);
    const avatarUrl = user.displayAvatarURL();
    const username = member?.displayName ?? user.username;
    const chanName = (id: string): string => {
      const c = guild.channels.cache.get(id);
      return c && 'name' in c ? c.name : 'Unknown';
    };

    if (ev.kind === 'join') {
      const after = count(newState.channel);
      startSession(guild.id, user.id, ev.channelId, now, after);
      recordChannelSize(guild.id, ev.channelId, after);
      if (!vl.joins) return;
      await sendLog(guild, 'voice', renderJoinEmbed({
        username, avatarUrl, channelName: newState.channel?.name ?? 'Unknown', channelId: ev.channelId, userId: user.id,
        countBefore: Math.max(0, after - 1), countAfter: after,
        selfMute: !!newState.selfMute, selfDeaf: !!newState.selfDeaf,
        timestampSec: tsSec, includeIds: vl.includeIds, showCounts: vl.memberCounts,
      }));
      return;
    }

    if (ev.kind === 'move') {
      const res = recordMove(guild.id, user.id, ev.to, now);
      const toAfter = count(newState.channel);
      const fromCh = guild.channels.cache.get(ev.from);
      const fromAfter = fromCh?.isVoiceBased() ? fromCh.members.size : 0;
      recordChannelSize(guild.id, ev.to, toAfter);
      const attr: ModAttribution = vl.moderatorActions
        ? await detectMoveAttribution(guild, AuditLogEvent.MemberMove, ev.to, now)
        : { status: 'self' };
      if (attr.status === 'mod') {
        await sendLog(guild, 'voice', renderModEmbed({
          username, avatarUrl, userId: user.id, action: 'moved',
          fromName: chanName(ev.from), fromId: ev.from, toName: newState.channel?.name ?? 'Unknown', toId: ev.to,
          moderatorTag: attr.tag, moderatorId: attr.id, reason: attr.reason, timestampSec: tsSec, includeIds: vl.includeIds,
        }));
      } else if (vl.moves) {
        const moverNote = attr.status === 'self' ? `**${username}** moved themselves` : 'Moved by: unknown';
        await sendLog(guild, 'voice', renderMoveEmbed({
          username, avatarUrl, fromName: chanName(ev.from), fromId: ev.from, toName: newState.channel?.name ?? 'Unknown', toId: ev.to,
          userId: user.id, timeInPreviousMs: res.timeInPreviousMs, moverNote,
          fromBefore: fromAfter + 1, fromAfter, toBefore: Math.max(0, toAfter - 1), toAfter,
          joinedAtSec: Math.floor(res.session.joinedAt / 1000), moveNumber: res.moveNumber,
          timestampSec: tsSec, includeIds: vl.includeIds, showCounts: vl.memberCounts, showDuration: vl.sessionDuration,
        }));
      }
      return;
    }

    if (ev.kind === 'leave') {
      const end = endSession(guild.id, user.id, now);
      const attr: ModAttribution = vl.moderatorActions
        ? await detectMoveAttribution(guild, AuditLogEvent.MemberDisconnect, ev.channelId, now)
        : { status: 'self' };
      if (attr.status === 'mod') {
        await sendLog(guild, 'voice', renderModEmbed({
          username, avatarUrl, userId: user.id, action: 'disconnected',
          channelName: chanName(ev.channelId), channelId: ev.channelId,
          moderatorTag: attr.tag, moderatorId: attr.id, reason: attr.reason, timestampSec: tsSec, includeIds: vl.includeIds,
        }));
      } else if (vl.leaves) {
        const route = (end?.session.channelsVisited ?? [ev.channelId]).map(chanName);
        await sendLog(guild, 'voice', renderSessionSummaryEmbed({
          username, avatarUrl, channelId: ev.channelId, userId: user.id, routeNames: route,
          sessionDurationMs: end?.totalDurationMs ?? 0, moveCount: end?.moveCount ?? 0,
          peakChannelSize: end?.session.peakChannelSize ?? count(oldState.channel),
          joinedAtSec: end ? Math.floor(end.session.joinedAt / 1000) : tsSec, leftAtSec: tsSec,
          includeIds: vl.includeIds, showCounts: vl.memberCounts, showDuration: vl.sessionDuration,
        }));
      }
      return;
    }

    if (ev.kind === 'state') {
      const ch = newState.channel;
      // Server mute/deafen = moderator events → main voice log (matter most).
      if (vl.moderatorActions) {
        for (const c of ev.changes) {
          if (!c.startsWith('server')) continue;
          const meta = SERVER_STATE_META[c as ServerStateChange];
          const mod = await detectServerStateMod(guild, user.id, meta.changeKey, now);
          await sendLog(guild, 'voice', renderModEmbed({
            username, avatarUrl, userId: user.id, action: meta.action,
            channelName: ch?.name ?? 'Unknown', channelId: ev.channelId,
            moderatorTag: mod?.tag ?? 'Unknown', moderatorId: mod?.id, reason: mod?.reason,
            timestampSec: tsSec, includeIds: vl.includeIds,
          }));
        }
      }
      // Self mute/deafen/camera/stream = detailed debug channel (OFF by default).
      for (const c of ev.changes) {
        if (c.startsWith('server')) continue;
        const meta = SELF_STATE_META[c as SelfStateChange];
        if (!vl.detailedDebug && !vl[meta.cat]) continue;
        await sendLogToChannel(guild, vl.debugChannelId ?? getGuildConfig(guild.id).logChannels.voice, renderStateEmbed({
          username, avatarUrl, channelName: ch?.name ?? 'Unknown', channelId: ev.channelId, userId: user.id,
          name: meta.name, emoji: meta.emoji, on: meta.on, title: meta.title, verb: meta.verb,
          timestampSec: tsSec, includeIds: vl.includeIds,
        }));
      }
    }
  },
};
