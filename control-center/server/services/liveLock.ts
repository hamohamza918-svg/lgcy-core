/**
 * Global LIVE-MUTATIONS lock.
 *
 * In the read-only connection phase, ANY endpoint capable of changing Discord
 * (deploy commands, publish panels, send messages, create/edit/delete channels
 * or roles, change permissions, start/restart the full bot) must refuse to run
 * — even if the API is called directly.
 *
 * The lock is ON by default and cannot be lifted from the dashboard. It only
 * opens if a developer sets LGCY_ALLOW_MUTATIONS=1 in the environment, which is
 * intentionally out of reach of the web UI. This is a later-phase switch.
 */
export const liveLock = {
  isLocked(): boolean {
    return process.env.LGCY_ALLOW_MUTATIONS !== '1';
  },

  status(): { locked: boolean; reason: string } {
    return {
      locked: this.isLocked(),
      reason: this.isLocked()
        ? 'Read-only phase: every Discord-mutating action is globally locked.'
        : 'Mutations enabled by developer environment flag.',
    };
  },

  /** Throws a locked error if mutations are not permitted. Used by every
   * Discord-affecting endpoint. The thrown error carries statusCode 423. */
  assert(actionLabel = 'This action'): void {
    if (this.isLocked()) {
      const err = new Error(`LIVE MUTATIONS are LOCKED. ${actionLabel} was blocked — nothing was sent to Discord.`) as Error & { statusCode?: number };
      err.statusCode = 423;
      throw err;
    }
  },
};
