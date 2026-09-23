# Module Extension Contract

How a future LGCY Core module appears in the **Control Center** with little or no
custom frontend. The dashboard is data-driven: it reads the module registry
(`src/modules/index.ts → MODULES`) and renders from each module's metadata.

## What a module provides

A module is an object implementing `Module` (`src/types/index.ts`). Fields the
Control Center uses:

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | ✅ | Stable id / feature-toggle key (e.g. `"welcome"`). |
| `description` | ✅ | Shown on the module card and in diagnostics. |
| `version` | ✅ | Semantic version shown on the card and Version page. |
| `defaultEnabled` | ✅ | Default on/off when a guild has no explicit setting. |
| `dashboard.icon` | ▫ optional | Emoji/icon on the card. Defaults to 📦. |
| `dashboard.section` | ▫ optional | Route the "Configure →" button opens. |
| `dashboard.configurable` | ▫ optional | Whether a config page exists. |
| `dashboard.dependencies` | ▫ optional | Other module names it needs. |
| `permissions` | ▫ optional | Discord permission names for the permissions audit. |
| `configSchema` | ▫ optional | Metadata describing settings for generic rendering. |
| `healthCheck()` | ▫ optional | Returns `{status, detail}` shown on the card. |
| `commands` / `events` / `handleComponent` / `init` | ▫ optional | Bot behaviour (not required for the card). |

## Two tiers of integration

1. **Metadata-only (simple modules).** Provide `name`, `description`, `version`,
   `defaultEnabled`, and a `dashboard` block. The module automatically gets:
   - a card on the **Modules** page (icon, version, health, enable/disable),
   - inclusion in **Diagnostics** and the **Overview** module list,
   - a per-guild feature toggle.
   No frontend code is required.

2. **Custom page (complex modules).** Set `dashboard.section` to a route and add
   a page renderer in `control-center/ui/js/app.js` (like Welcome/Tickets). The
   card's "Configure →" opens it. Everything else still comes from metadata.

## Adding a module — checklist

1. Create `src/modules/<name>/index.ts` exporting a `Module`.
2. Add it to `MODULES` in `src/modules/index.ts` (the only wiring point).
3. If it has settings, add fields to `guildConfigSchema` (the shared, validated
   config layer used by both the bot and the Control Center).
4. Optional: add a `healthCheck()`, `permissions`, and a custom page.

That's it — the module shows up in the Control Center on next start. The core
control center is never modified to add a module.
