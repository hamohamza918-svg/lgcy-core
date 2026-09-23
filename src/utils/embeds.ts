import { EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/constants.js';

/** Consistent embed factory so every module shares the LGCY look. */
export const embeds = {
  base(): EmbedBuilder {
    return new EmbedBuilder().setColor(BRAND.colorPrimary).setTimestamp();
  },
  success(title: string, description?: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(BRAND.colorSuccess)
      .setTitle(`✅ ${title}`)
      .setDescription(description ?? null)
      .setTimestamp();
  },
  error(title: string, description?: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(BRAND.colorDanger)
      .setTitle(`❌ ${title}`)
      .setDescription(description ?? null)
      .setTimestamp();
  },
  warn(title: string, description?: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(BRAND.colorWarn)
      .setTitle(`⚠️ ${title}`)
      .setDescription(description ?? null)
      .setTimestamp();
  },
  info(title: string, description?: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(BRAND.colorInfo)
      .setTitle(title)
      .setDescription(description ?? null)
      .setTimestamp();
  },
};
