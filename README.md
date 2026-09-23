# LGCY Core

The permanent, **modular** Discord bot for the LGCY community. Instead of
installing a new third-party bot every time we want a feature, we keep expanding
this one. Every feature is an isolated **module** — adding a future feature does
not require rewriting the core.

> This is **not** NovaForge. NovaForge stays as migration/backup tooling.
> LGCY Core is the production bot for the actual server.

---

## Stack

- **Node.js** + **TypeScript** (ESM)
- **discord.js v14** — slash commands, buttons, select menus, modals
- **SQLite** via Node's built-in `node:sqlite` — zero native compilation,
  Windows-friendly (no Visual Studio / node-gyp needed)
- **@napi-rs/canvas** — dynamic welcome-card rendering (prebuilt binaries)
- **pino** — structured logging
- **zod** — env + guild-config validation
- Secrets in `.env` only

## Quick start (local, no server connection)

```bash
npm install
npm run preview:card     # render sample welcome cards to /preview  (no token needed)
npm run smoke            # boot everything except Discord login     (no token needed)
```

When you're ready to connect (a later step — not yet):

```bash
cp .env.example .env     # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID
npm run deploy-commands  # register slash commands to your guild (talks to Discord)
npm run dev              # start the bot with hot reload
```

## Architecture

```
src/
  index.ts                 # bootstrap: env → db → client → modules → login
  config/                  # env (secrets) + typed per-guild config + constants
  database/                # node:sqlite handle, versioned migrations, repositories
  events/                  # CORE gateway events (ready, interactionCreate router)
  services/                # client, module/command/event loader, log service
  modules/                 # every feature — isolated & self-registering
    system/  welcome/  roles/  moderation/  logging/  tickets/  voice/
  types/                   # Command / EventHandler / Module contracts
  utils/                   # logger, permissions, embeds, time
scripts/                   # preview-card, smoke, deploy-commands, db-reset
```

### How modularity works

- A **module** (`src/types/index.ts → Module`) contributes commands, event
  handlers, and a component (button/select/modal) handler, plus a
  `defaultEnabled` flag.
- `src/modules/index.ts` is the **only** place a feature is wired in — add one
  line to `MODULES` and the loader does the rest.
- Component interactions route by `customId` convention `module:action:args`, so
  no central switch statement grows as features are added.
- Every command declares the **exact** permissions it needs; the core validates
  them at runtime. **The bot never relies on Administrator.**
- Per-guild **feature toggles** (`/modules enable|disable`) turn modules on/off
  without code changes.

## Configuration

Nothing guild-specific is hard-coded. Per-guild config lives in the DB as a
validated JSON blob and covers: `welcomeChannelId`, `rulesChannelId`,
`rolesChannelId`, `ticketCategoryId`, `logChannels` (per-category), `selfRoleGroups`,
`staffRoleIds`, `colors`, welcome copy (title/message/DM/leave), `welcomeBackground`,
and `features` (module enable/disable). Secrets live only in `.env`.

## Safety

- Explicit permission checks per command (not Administrator).
- Role-hierarchy checks on every moderation action (invoker > target, bot > target,
  never the owner/self/bot).
- Self-roles can **never** expose staff/security roles — blocked by name pattern,
  by `staffRoleIds`, by Administrator permission, and by hierarchy.
- Minimal gateway intents; startup env validation; graceful shutdown; structured
  audit logging of all moderation cases.

## Phase 1 status

| Feature            | Status                                             |
|--------------------|----------------------------------------------------|
| Core architecture  | ✅ done                                             |
| Configuration      | ✅ done (typed, DB-backed, validated)               |
| Database           | ✅ done (migrations + repositories)                 |
| Command/event loader | ✅ done                                           |
| Welcome + card     | ✅ done (graphical card + join/leave/DM)            |
| Roles              | ✅ foundation (groups, panel, safe self-assign)     |
| Logging            | ✅ foundation (10 event types, per-category routing)|
| Moderation         | ✅ 11 commands with case logging                    |
| Tickets            | ✅ done (panel, modal, claim/close/transfer/add/remove, HTML transcripts, recovery) |
| Temp/Private voice | ⏳ dormant by design (disabled until old system understood) |
```
