import { EmbedBuilder, type Guild, type User } from 'discord.js';
import {
  modCasesRepo,
  type ModActionType,
  type ModCase,
} from '../../database/repositories/modCasesRepo.js';
import { sendLog } from '../../services/logService.js';
import { BRAND } from '../../config/constants.js';
import { formatDuration } from '../../utils/time.js';
import { scopedLogger } from '../../utils/logger.js';

const log = scopedLogger('moderation');

const COLOR: Record<ModActionType, number> = {
  warn: BRAND.colorWarn,
  timeout: BRAND.colorWarn,
  untimeout: BRAND.colorSuccess,
  kick: BRAND.colorDanger,
  ban: BRAND.colorDanger,
  unban: BRAND.colorSuccess,
};

interface RecordInput {
  guild: Guild;
  type: ModActionType;
  target: User;
  moderator: User;
  reason?: string;
  durationMs?: number;
  /** DM the target before the action takes effect (kick/ban). */
  notifyTarget?: boolean;
}

/**
 * Records a moderation case (moderator, target, reason, timestamp) and writes it
 * to the moderation log channel. Returns the created case so the command can
 * quote its number back to the moderator.
 */
export async function recordModCase(input: RecordInput): Promise<ModCase> {
  const modCase = modCasesRepo.create({
    guildId: input.guild.id,
    type: input.type,
    targetId: input.target.id,
    targetTag: input.target.tag,
    moderatorId: input.moderator.id,
    moderatorTag: input.moderator.tag,
    reason: input.reason,
    durationMs: input.durationMs,
  });

  const embed = new EmbedBuilder()
    .setColor(COLOR[input.type])
    .setAuthor({
      name: `Case #${modCase.caseNumber} · ${input.type.toUpperCase()}`,
      iconURL: input.target.displayAvatarURL(),
    })
    .addFields(
      { name: 'User', value: `<@${input.target.id}> (${input.target.id})`, inline: true },
      { name: 'Moderator', value: `<@${input.moderator.id}>`, inline: true },
    )
    .setTimestamp();

  if (input.durationMs) {
    embed.addFields({ name: 'Duration', value: formatDuration(input.durationMs), inline: true });
  }
  embed.addFields({ name: 'Reason', value: input.reason ?? '*No reason provided*' });

  await sendLog(input.guild, 'moderation', embed).catch((err) =>
    log.error({ err }, 'failed to log mod case'),
  );

  return modCase;
}

/** Best-effort DM to the target explaining the action. Never throws. */
export async function dmTarget(
  target: User,
  guildName: string,
  action: string,
  reason?: string,
  durationMs?: number,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(BRAND.colorWarn)
    .setTitle(`You were ${action} in ${guildName}`)
    .setDescription(reason ? `**Reason:** ${reason}` : '*No reason provided.*')
    .setTimestamp();
  if (durationMs) embed.addFields({ name: 'Duration', value: formatDuration(durationMs) });
  await target.send({ embeds: [embed] }).catch(() => {
    /* target has DMs closed — ignore */
  });
}
