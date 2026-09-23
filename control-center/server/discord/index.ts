import type { DiscordDataSource } from './types.js';
import { MockDiscordSource } from './mockSource.js';

/**
 * Returns the active Discord data source. Until a live connection layer is
 * added (a later phase), this is always the mock source — so the entire
 * dashboard is usable with zero credentials and never touches Discord.
 */
let source: DiscordDataSource = new MockDiscordSource();

export function getDataSource(): DiscordDataSource {
  return source;
}

export function setDataSource(next: DiscordDataSource): void {
  source = next;
}
