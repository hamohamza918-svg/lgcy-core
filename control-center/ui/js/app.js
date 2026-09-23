import { api } from './api.js';

const view = document.getElementById('view');
const overlay = document.getElementById('overlay');
let STATE = null;

// ── helpers ──────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const intToHex = (n) => '#' + (Number(n) || 0).toString(16).padStart(6, '0');
const hexToInt = (h) => parseInt(String(h).replace('#', ''), 16);
const fmtBytes = (b) => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(1) + ' KB';
const val = (id) => document.getElementById(id).value;
const chk = (id) => document.getElementById(id).checked;

function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function pill(kind, text) { return `<span class="pill ${kind}"><span class="dot"></span>${esc(text)}</span>`; }
function topbar(title, sub, right = '') { return `<div class="topbar"><div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div><div>${right}</div></div>`; }
function emptyState(big, msg) { return `<div class="empty"><div class="big">🗂️</div><strong>${esc(big)}</strong><div>${esc(msg)}</div></div>`; }
function sampleBanner() { return `<div class="samplebar">◈ Sample data — this page shows a mock LGCY server. Values become live once the bot is connected (a later approved step).</div>`; }
function loadingSkeleton() { return `<div class="loading-grid">${'<div class="card skel"></div>'.repeat(4)}</div>`; }
function channelOptions(channels, selected, type = 'text') {
  const opts = channels.filter((c) => c.type === type).map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${type === 'category' ? '📁 ' : '# '}${esc(c.name)}</option>`).join('');
  return `<option value="">— none —</option>${opts}`;
}
async function saveDraft(patch, note = 'Saved to draft') { await api.post('/config/draft', patch); toast(note); await refreshDraftBar(); }

// ── modal + live-action confirmation ─────────────────────────────────
function showModal(html) { overlay.innerHTML = `<div class="overlay"><div class="wizard">${html}</div></div>`; }
function closeModal() { overlay.innerHTML = ''; }
function confirmLive(title, body, confirmLabel, onConfirm) {
  showModal(`<h2>${esc(title)}</h2><p class="muted">${body}</p><div class="spacer"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" id="cl-no">Cancel</button><button class="btn live" id="cl-yes">${esc(confirmLabel)}</button></div>`);
  document.getElementById('cl-no').onclick = closeModal;
  document.getElementById('cl-yes').onclick = async () => { closeModal(); await onConfirm(); };
}
function diffTable(changes) {
  return `<table><tr><th>Setting</th><th>From</th><th>To</th></tr>${changes.map((c) => `<tr><td class="mono">${esc(c.path)}</td><td class="mono muted">${esc(JSON.stringify(c.from))}</td><td class="mono">${esc(JSON.stringify(c.to))}</td></tr>`).join('')}</table>`;
}

// ── Role Manager helpers ─────────────────────────────────────────────
const RM = { roles: [], botTop: 0, dragId: null };
const PERM_GROUP = {
  General: ['ViewChannel', 'CreateInstantInvite', 'ChangeNickname', 'ManageNicknames', 'ViewAuditLog', 'ViewGuildInsights'],
  Membership: ['KickMembers', 'BanMembers', 'ModerateMembers'],
  Text: ['SendMessages', 'SendTTSMessages', 'ManageMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'MentionEveryone', 'UseExternalEmojis', 'AddReactions', 'UseApplicationCommands', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads', 'ManageThreads', 'UseExternalStickers', 'SendVoiceMessages', 'SendPolls', 'PinMessages', 'UseExternalApps', 'BypassSlowmode'],
  Voice: ['Connect', 'Speak', 'Stream', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'UseVAD', 'PrioritySpeaker', 'RequestToSpeak', 'UseEmbeddedActivities', 'UseSoundboard', 'UseExternalSounds', 'SetVoiceChannelStatus'],
  Events: ['ManageEvents', 'CreateEvents'],
  Advanced: ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageEmojisAndStickers', 'ManageGuildExpressions', 'CreateGuildExpressions'],
};
const DANGER_C = { Administrator: 'high', ManageRoles: 'high', ManageGuild: 'high', BanMembers: 'high', KickMembers: 'high', ManageChannels: 'high', ManageWebhooks: 'high', MentionEveryone: 'med', ModerateMembers: 'med' };
const permGroup = (p) => Object.entries(PERM_GROUP).find(([, a]) => a.includes(p))?.[0] ?? 'Advanced';

function roleCardHtml(r) {
  const drag = r.botCanManage && !r.managed;
  const propName = r.proposedName && r.proposedName !== r.name;
  const propColor = r.proposedColor && r.proposedColor.toLowerCase() !== r.color.toLowerCase();
  return `<div class="rolecard" draggable="${drag}" data-id="${r.id}" style="border-left-color:${esc(r.color)}">
    <span class="grip">${drag ? '⋮⋮' : '🔒'}</span>
    <span class="swatch" style="background:${esc(r.color)}"></span>
    <div><div class="rname">${esc(r.name)} ${propName ? `<span class="tag2 prop">→ ${esc(r.proposedName)}</span>` : ''}</div>
      <div class="rmeta">pos ${r.position} · ${r.memberCount} member${r.memberCount === 1 ? '' : 's'}</div></div>
    <div class="flags">
      ${r.protectedRole ? '<span class="tag2 prot">🔒 PROTECTED</span>' : ''}
      ${r.managed ? '<span class="tag2 managed">managed</span>' : (r.botCanManage ? '' : '<span class="tag2 nomanage">above bot</span>')}
      ${r.hoist ? '<span class="tag2 hoist">hoisted</span>' : ''}
      ${r.dangerousPerms.length ? `<span class="tag2 danger">${r.dangerousPerms.length} risky</span>` : ''}
      ${propColor ? '<span class="tag2 prop">new color</span>' : ''}
    </div></div>`;
}
function reorderRoles(fromId, toId) {
  const arr = RM.roles;
  const fi = arr.findIndex((r) => r.id === fromId); if (fi < 0) return;
  const [m] = arr.splice(fi, 1);
  const ti = arr.findIndex((r) => r.id === toId);
  arr.splice(ti < 0 ? arr.length : ti, 0, m);
}
function wireRoleCards() {
  document.querySelectorAll('.rolecard').forEach((c) => {
    c.onclick = (e) => { if (e.target.classList.contains('grip')) return; const r = RM.roles.find((x) => x.id === c.dataset.id); if (r) openRoleEditor(r); };
    if (c.getAttribute('draggable') === 'true') {
      c.addEventListener('dragstart', () => { RM.dragId = c.dataset.id; c.classList.add('dragging'); });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
      c.addEventListener('dragover', (e) => { e.preventDefault(); c.classList.add('dragover'); });
      c.addEventListener('dragleave', () => c.classList.remove('dragover'));
      c.addEventListener('drop', async (e) => {
        e.preventDefault(); c.classList.remove('dragover');
        const from = RM.dragId, to = c.dataset.id;
        if (!from || from === to) return;
        reorderRoles(from, to);
        await api.post('/roles/manager/order', { order: RM.roles.map((r) => r.id) });
        toast('Reordered (draft)'); pages.roleManager();
      });
    }
  });
}
function openRoleEditor(r) {
  const e = r.draftEdit || {};
  showModal(`<h2>${esc(r.name)}</h2><div class="muted" style="font-size:12px">${esc(r.categoryLabel)} · id ${esc(r.id)}${r.protectedRole ? ' · 🔒 PROTECTED' : ''}</div>
    <div class="tabs"><button class="tab on" data-t="gen">General</button><button class="tab" data-t="perm">Permissions</button><button class="tab" data-t="mem">Members (${r.memberCount})</button><button class="tab" data-t="chan">Channels (${r.channelDependencies.length})</button></div>
    <div class="editor" id="rm-ed"></div>`);
  const gen = () => `
    <label class="field"><span class="lab">Name</span><input id="ed-name" type="text" value="${esc(e.name ?? r.name)}"/></label>
    ${r.proposedName && r.proposedName !== r.name ? `<button class="btn ghost" id="ed-usename">Use proposed: ${esc(r.proposedName)}</button>` : ''}
    <label class="field"><span class="lab">Color (current ${esc(r.color)})</span><input id="ed-color" type="color" value="${esc(e.color ?? r.color)}" style="height:42px"/></label>
    ${r.proposedColor ? `<button class="btn ghost" id="ed-usecolor">Use proposed ${esc(r.proposedColor)}</button>` : ''}
    <div style="display:flex;gap:16px;margin:12px 0">
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ed-hoist" ${(e.hoist ?? r.hoist) ? 'checked' : ''}/> Display separately (hoist)</label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ed-ment" ${(e.mentionable ?? r.mentionable) ? 'checked' : ''}/> Mentionable</label>
    </div>
    ${r.proposedHoist !== null ? `<div class="hint">Recommended hoist: <strong>${r.proposedHoist ? 'yes' : 'no'}</strong></div>` : ''}
    ${r.protectedRole ? `<label style="display:flex;gap:8px;align-items:center;color:var(--warn);margin-top:8px"><input type="checkbox" id="ed-protack"/> This role is 🔒 PROTECTED — tick to allow saving.</label>` : ''}
    <div class="spacer"></div><button class="btn apply" id="ed-save">Save to draft</button>`;
  const perm = () => {
    const groups = {};
    r.permissions.forEach((p) => { (groups[permGroup(p)] = groups[permGroup(p)] || []).push(p); });
    let h = `<p class="muted">Untick a permission to remove it (staged). 🔴 high-risk · 🟠 elevated.</p>`;
    if (!r.permissions.length) h += '<div class="muted">This role has no permissions.</div>';
    for (const [g, arr] of Object.entries(groups)) {
      h += `<div class="rm-cat">${g}</div><div class="perm-grid">` + arr.map((p) => {
        const d = DANGER_C[p]; const removed = (e.permsRemove || []).includes(p);
        return `<label class="perm-row ${d ? 'd-' + d : ''}"><input type="checkbox" data-perm="${p}" ${removed ? '' : 'checked'}/> <span class="pn">${d === 'high' ? '🔴 ' : d === 'med' ? '🟠 ' : ''}${p}</span></label>`;
      }).join('') + `</div>`;
    }
    h += `<div class="spacer"></div><button class="btn apply" id="ed-permsave">Save permission changes</button>`;
    return h;
  };
  const mem = () => r.members.length ? r.members.map((u) => `<div class="row"><div>${esc(u)}</div><button class="btn ghost" data-mem="${esc(u)}">roles →</button></div>`).join('') + `<div id="ed-stack" style="margin-top:8px"></div>` : '<div class="muted">No members have this role.</div>';
  const chan = () => r.channelDependencies.length ? `<p class="muted">This role is referenced by these channels' permissions — changing/removing it affects access here:</p>` + r.channelDependencies.map((c) => `<div class="row"><div>#️⃣ ${esc(c)}</div></div>`).join('') : '<div class="muted">No channel permission dependencies.</div>';
  const tabs = { gen, perm, mem, chan };
  const show = (t) => {
    document.getElementById('rm-ed').innerHTML = tabs[t]();
    document.querySelectorAll('.tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    if (t === 'gen') {
      const un = document.getElementById('ed-usename'); if (un) un.onclick = () => { document.getElementById('ed-name').value = r.proposedName; };
      const uc = document.getElementById('ed-usecolor'); if (uc) uc.onclick = () => { document.getElementById('ed-color').value = r.proposedColor; };
      document.getElementById('ed-save').onclick = async () => {
        if (r.protectedRole && !document.getElementById('ed-protack')?.checked) { toast('Tick the protected box to save', true); return; }
        const edit = { name: val('ed-name'), color: val('ed-color'), hoist: chk('ed-hoist'), mentionable: chk('ed-ment') };
        if (r.protectedRole) edit.protectedOverride = true;
        await api.post('/roles/manager/edit', { roleId: r.id, edit }); toast('Saved to draft'); closeModal(); pages.roleManager();
      };
    } else if (t === 'perm') {
      document.getElementById('ed-permsave').onclick = async () => {
        if (r.protectedRole && !confirm('This role is protected. Stage permission changes?')) return;
        const removed = [...document.querySelectorAll('#rm-ed [data-perm]')].filter((c) => !c.checked).map((c) => c.dataset.perm);
        const edit = { permsRemove: removed }; if (r.protectedRole) edit.protectedOverride = true;
        await api.post('/roles/manager/edit', { roleId: r.id, edit }); toast('Permission changes staged'); closeModal(); pages.roleManager();
      };
    } else if (t === 'mem') {
      document.querySelectorAll('#rm-ed [data-mem]').forEach((b) => b.onclick = () => {
        const u = b.dataset.mem; const st = RM.roles.filter((x) => x.members && x.members.includes(u)).map((x) => x.name);
        document.getElementById('ed-stack').innerHTML = `<div class="result"><strong>${esc(u)}</strong> role stack: ${st.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ') || '—'}</div>`;
      });
    }
  };
  document.querySelectorAll('.tabs .tab').forEach((b) => b.onclick = () => show(b.dataset.t));
  show('gen');
}
function opsTable(ops) {
  return `<table><tr><th>Op</th><th>Role</th><th>Change</th></tr>${ops.map((o) => `<tr><td class="mono">${esc(o.type)}</td><td>${esc(o.roleName)}</td><td class="mono">${o.from !== null && o.from !== undefined ? esc(JSON.stringify(o.from)) + ' → ' : ''}${esc(JSON.stringify(o.to))}</td></tr>`).join('')}</table>`;
}
async function showRoleDiff() {
  const { ops } = await api.get('/roles/manager/diff');
  showModal(`<h2>Staged role changes (${ops.length})</h2>${ops.length ? opsTable(ops) : '<p class="muted">No changes staged.</p>'}<div class="spacer"></div><div style="text-align:right"><button class="btn" id="m-c">Close</button></div>`);
  document.getElementById('m-c').onclick = closeModal;
}
function opsList(ops) {
  return ops.length ? ops.map((o) => `<label class="perm-row"><input type="checkbox" data-op="${esc(o.id)}" ${o.selected ? 'checked' : ''}/> <span class="mono">[${o.type}]</span> ${esc(o.roleName)} <span class="muted mono">${o.from !== null && o.from !== undefined ? esc(JSON.stringify(o.from)) + '→' : ''}${esc(JSON.stringify(o.to))}</span>${o.type === 'MOVE' ? ' <span class="tag2 warn2">validate</span>' : ''}${o.protectedRole ? ' <span class="tag2 prot">🔒</span>' : ''}</label>`).join('') : '<div class="muted">No changes.</div>';
}

// ── draft bar ────────────────────────────────────────────────────────
async function refreshDraftBar() {
  const { hasDraft } = await api.get('/config/draft');
  document.getElementById('draftbar').classList.toggle('show', !!hasDraft);
}
document.getElementById('draft-apply').onclick = async () => {
  const { changes } = await api.get('/config/diff');
  if (!changes.length) { toast('No changes to apply'); await refreshDraftBar(); return; }
  showModal(`<h2>Apply Configuration</h2><p class="muted">Writes these changes to the <strong>local</strong> bot config. Nothing is sent to Discord. The previous config is saved to history for restore.</p>${diffTable(changes)}<div class="spacer"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" id="m-cancel">Cancel</button><button class="btn apply" id="m-apply">Apply Configuration</button></div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-apply').onclick = async () => { await api.post('/config/apply'); closeModal(); toast('Applied to local config'); await refreshDraftBar(); refreshHealth(); route(); };
};
document.getElementById('draft-discard').onclick = async () => { await api.post('/config/discard'); toast('Draft discarded'); await refreshDraftBar(); route(); };
document.getElementById('draft-review').onclick = async () => {
  const { changes } = await api.get('/config/diff');
  showModal(`<h2>Draft changes</h2>${changes.length ? diffTable(changes) : '<p class="muted">No differences from applied config.</p>'}<div class="spacer"></div><div style="text-align:right"><button class="btn" id="m-close">Close</button></div>`);
  document.getElementById('m-close').onclick = closeModal;
};

// ── pages ────────────────────────────────────────────────────────────
const pages = {
  async overview() {
    const d = await api.get('/overview');
    const mods = d.modules.map((m) => `<div class="row"><div>${m.icon} <strong>${esc(m.name)}</strong></div>${m.enabled ? pill('ok', 'ON') : pill('off', 'OFF')}</div>`).join('');
    view.innerHTML = topbar('Overview', 'LGCY Core at a glance', d.gateway.connected ? pill('ok', 'ONLINE') : pill('off', 'OFFLINE (local)')) + `
      <div class="grid cols-4">
        <div class="card"><div class="label">Bot</div><div class="kpi blue">${esc(d.bot.username)}</div><div class="sub">${d.gateway.source === 'mock' ? 'sample data' : 'live'}</div></div>
        <div class="card"><div class="label">Members</div><div class="kpi">${d.guild.memberCount}</div><div class="sub">${esc(d.guild.name)}</div></div>
        <div class="card"><div class="label">Channels</div><div class="kpi">${d.guild.channelCount}</div><div class="sub">${d.guild.roleCount} roles</div></div>
        <div class="card"><div class="label">Commands</div><div class="kpi">${d.commands}</div><div class="sub">registered</div></div>
      </div>
      <div class="grid cols-3 section">
        <div class="card"><div class="label">Gateway</div><div style="margin-top:8px">${d.gateway.connected ? pill('ok', 'Connected') : pill('off', 'Disconnected')}</div><div class="sub" style="margin-top:8px">${esc(d.gateway.source)} source</div></div>
        <div class="card"><div class="label">Database</div><div style="margin-top:8px">${d.database.healthy ? pill('ok', 'Healthy') : pill('bad', 'Error')}</div><div class="sub" style="margin-top:8px">schema v${d.database.schemaVersion}</div></div>
        <div class="card"><div class="label">Private Voice</div><div style="margin-top:8px">${pill('off', 'Disabled')}</div><div class="sub" style="margin-top:8px">dormant by design</div></div>
      </div>
      <div class="grid cols-2 section">
        <div class="card"><h3>Modules</h3><div style="margin-top:6px">${mods}</div></div>
        <div class="card"><h3>Recent activity</h3><div style="margin-top:6px">${d.activity.map((a) => `<div class="row"><div>${a.icon} ${esc(a.text)}</div><span class="muted">${esc(a.when)}</span></div>`).join('')}</div></div>
      </div>`;
  },

  async bot() {
    const d = await api.get('/bot');
    const prov = STATE.secretProvider;
    const intents = d.intents.map((i) => `<div class="row"><div>${esc(i.name)}</div>${i.privileged ? pill('warn', 'privileged') : pill('ok', 'standard')}</div>`).join('');
    const perms = d.permissions.list.map((p) => `<div class="row"><div><strong>${esc(p.name)}</strong><div class="muted" style="font-size:12px">${esc(p.why)}</div></div></div>`).join('');
    view.innerHTML = topbar('Bot', 'Identity, connection, secrets & permissions', d.gateway.connected ? pill('ok', 'ONLINE') : pill('off', 'OFFLINE')) + `
      <div class="grid cols-3">
        <div class="card"><div class="label">Identity</div><div class="kpi blue" style="font-size:22px">${esc(d.identity.username)}</div><div class="sub mono">${esc(d.identity.id)}</div></div>
        <div class="card"><div class="label">Application ID</div><div class="sub mono" style="margin-top:8px">${esc(d.credentials.applicationId || '— not set —')}</div><div class="label" style="margin-top:12px">Guild ID</div><div class="sub mono">${esc(d.credentials.guildId || '— not set —')}</div></div>
        <div class="card"><div class="label">Secret Storage</div><div style="margin-top:8px">${prov.status === 'SECURE' ? pill('ok', prov.label + ' · SECURE') : prov.status === 'INSECURE' ? pill('warn', prov.label) : pill('bad', prov.label)}</div><div class="sub" style="margin-top:8px">${prov.warning ? esc(prov.warning) : 'token encrypted at rest, outside the repo'}</div></div>
      </div>
      <div class="section"><h2>Controls</h2><div class="card">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-act="start">Start Bot</button>
          <button class="btn live" data-act="stop">Stop Bot</button>
          <button class="btn live" data-act="restart">Restart Bot</button>
          <button class="btn" data-act="doctor">🩺 Run Doctor</button>
          <button class="btn live" data-act="deploy">🚀 Deploy Guild Commands</button>
          <button class="btn" data-act="refresh">🔄 Refresh Data</button>
        </div>
        <div class="legend"><span><span class="dotk" style="background:#2b8cff"></span>Local action</span><span><span class="dotk" style="background:#ff5a6a"></span>Affects Discord (confirmation required)</span></div>
        <div class="hint">Connection-requiring actions are inert until credentials are entered and the connection step is approved. Nothing is sent to Discord.</div>
      </div></div>
      <div class="grid cols-2 section">
        <div class="card"><h3>Gateway intents</h3><div style="margin-top:6px">${intents}</div></div>
        <div class="card"><h3>Permissions <span class="chip">integer ${esc(d.permissions.integer)}</span></h3><div style="margin-top:6px">${perms}</div></div>
      </div>`;
    const live = new Set(['stop', 'restart', 'deploy']);
    view.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
      const act = b.dataset.act;
      const run = async () => { const res = await api.post('/bot/action', { action: act }); toast(res.message); };
      if (live.has(act)) confirmLive(`${act[0].toUpperCase() + act.slice(1)} — affects Discord`, 'This action connects to or changes Discord. It is disabled in local mode; confirming will show the guard message.', `Yes, ${act}`, run);
      else run();
    });
  },

  async connection() {
    const c = await api.get('/connection');
    const connected = c.state === 'connected';
    const hasCreds = c.credentials.hasToken && c.credentials.applicationId && c.credentials.guildId;
    const stepState = (i) => {
      const order = ['setup', 'test', 'connect', 'discovery', 'diagnostics', 'mapping'];
      const reached = connected ? 3 : hasCreds ? 1 : 0;
      return i < reached ? 'done' : i === reached ? 'active' : '';
    };
    const steps = [['SETUP', 'Credentials stored'], ['TEST CREDENTIALS', 'Read-only identify'], ['CONNECT READ-ONLY', 'Guilds intent only'], ['LIVE DISCOVERY', 'Read channels/roles'], ['RUN DIAGNOSTICS', 'Validate live'], ['REVIEW MAPPING', 'You approve']];
    view.innerHTML = topbar('Connection', 'Authenticate & discover — READ-ONLY. No deployment, no mutations.', connected ? pill('ok', 'LIVE — ' + esc(c.guildName || 'connected')) : pill('off', c.state)) + `
      <div class="samplebar" style="border-color:rgba(255,90,106,0.4);color:#ffb3ba;background:rgba(255,90,106,0.06)">🔒 <strong>LIVE MUTATIONS LOCKED</strong> — ${esc(c.liveLock.reason)} Any Discord-changing endpoint is rejected server-side.</div>
      <div class="flow">${steps.map(([t, d], i) => `<div class="step ${stepState(i)}"><div class="n">STEP ${i + 1}</div><div class="t">${t}</div><div class="muted" style="font-size:12px">${d}</div></div>`).join('')}</div>
      <div class="grid cols-2">
        <div class="card"><h3>Status</h3>
          <div class="row"><div>Credentials</div>${hasCreds ? pill('ok', 'stored') : pill('warn', 'incomplete')}</div>
          <div class="row"><div>Connection</div>${connected ? pill('ok', 'connected (read-only)') : pill('off', c.state)}</div>
          <div class="row"><div>Data source</div>${c.source === 'live' ? pill('ok', 'LIVE') : pill('off', 'mock')}</div>
          <div class="row"><div>Live mutations</div>${pill('warn', 'LOCKED')}</div>
          ${c.error ? `<div class="result">❌ ${esc(c.error)}</div>` : ''}
          <div id="conn-result"></div>
        </div>
        <div class="card"><h3>Actions</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn" id="c-test">1 · Test Credentials (read-only)</button>
            ${connected
              ? `<button class="btn live" id="c-disc">Disconnect</button>`
              : `<button class="btn apply" id="c-connect" ${hasCreds ? '' : 'disabled'}>2 · Connect LGCY Core (read-only)</button>`}
            <button class="btn" id="c-refresh">3 · Refresh Live Discovery</button>
            <button class="btn" id="c-diag">4 · Run Live Diagnostics</button>
            <button class="btn" id="c-map">5 · Review Proposed Mapping</button>
          </div>
          <div class="hint">${hasCreds ? 'Connecting opens a read-only gateway (Guilds intent only) — no messages, no member events, no writes.' : 'Complete Setup (enter token + IDs) before connecting.'}</div>
        </div>
      </div>
      <div id="map-out"></div>`;
    document.getElementById('c-test').onclick = async () => {
      document.getElementById('conn-result').innerHTML = '<div class="result">Testing…</div>';
      const r = await api.post('/connection/test', {});
      document.getElementById('conn-result').innerHTML = `<div class="result">${r.ok ? '✅' : '❌'} ${esc(r.message)}${r.bot ? `<br>Bot: <strong>${esc(r.bot.username)}</strong> · Server: <strong>${esc(r.guild?.name || '—')}</strong> (${r.guild?.memberCount ?? '—'} members)` : ''}</div>`;
    };
    const connectBtn = document.getElementById('c-connect');
    if (connectBtn) connectBtn.onclick = async () => {
      connectBtn.disabled = true; connectBtn.textContent = 'Connecting…';
      try { await api.post('/connection/connect', {}); await refreshState(); toast('Connected read-only — LIVE data active'); pages.connection(); }
      catch (e) { toast(e.message, true); pages.connection(); }
    };
    const discBtn = document.getElementById('c-disc');
    if (discBtn) discBtn.onclick = async () => { await api.post('/connection/disconnect', {}); await refreshState(); toast('Disconnected — back to mock'); pages.connection(); };
    document.getElementById('c-refresh').onclick = async () => { const r = await api.post('/bot/action', { action: 'refresh' }); toast(r.message); };
    document.getElementById('c-diag').onclick = () => { location.hash = '#/diagnostics'; };
    document.getElementById('c-map').onclick = async () => {
      const m = await api.get('/mapping');
      const line = (label, v) => `<div class="maprow"><div>${esc(label)}</div><div>${v ? esc(v.name) : '<span class="no">⚠ no match — choose manually</span>'}</div></div>`;
      document.getElementById('map-out').innerHTML = `<div class="card section"><h3>Proposed mapping <span class="chip grey">${esc(m.source)} data</span></h3>
        <p class="muted">${esc(m.note)}</p>
        <div class="mapblock"><strong>START</strong>${line('Welcome', m.start.welcome)}${line('Rules', m.start.rules)}${line('Roles', m.start.roles)}</div>
        <div class="mapblock"><strong>GAME SELF-ROLES</strong>${Object.entries(m.selfRoles).map(([g, v]) => line(g, v)).join('')}</div>
        <div class="mapblock"><strong>TICKETS</strong>${line('Panel', m.tickets.panel)}${line('Parent category', m.tickets.parentCategory)}${line('Archive category', m.tickets.archiveCategory)}${line('Ticket log', m.tickets.log)}</div>
        <div class="mapblock"><strong>LOGS</strong>${Object.entries(m.logs).map(([k, v]) => line(k, v)).join('')}</div>
        <div class="mapblock"><strong>SUGGESTED STAFF ROLES</strong>${m.suggestedStaffRoles.length ? m.suggestedStaffRoles.map((r) => `<div class="maprow"><div>${esc(r.name)}</div><div class="mono muted">${esc(r.id)}</div></div>`).join('') : '<div class="muted">none detected</div>'}</div>
        <div class="hint">Review this, then apply mappings via the Welcome / Roles / Tickets / Logging pages. Nothing is applied automatically.</div></div>`;
    };
  },

  async modules() {
    const { modules } = await api.get('/modules');
    view.innerHTML = topbar('Modules', 'Every registered module — new ones appear here automatically from metadata') +
      `<div class="grid cols-3">${modules.map((m) => `
        <div class="card mod">
          <div class="head"><div class="ico">${m.icon}</div><div class="meta"><h3>${esc(m.name)}</h3><span class="chip grey">v${esc(m.version)}</span></div></div>
          <div class="muted" style="font-size:13px;min-height:38px">${esc(m.description)}</div>
          <div class="row" style="border:none;padding:6px 0"><span class="muted">${m.commands} cmds · ${m.events} events</span>${m.health === 'error' ? pill('bad', 'error') : m.health === 'warn' ? pill('warn', 'warning') : pill('ok', 'healthy')}</div>
          <div class="foot">
            <button class="toggle ${m.enabled ? 'on' : ''} ${m.name === 'voice' ? 'locked' : ''}" data-mod="${m.name}" data-en="${m.enabled}"></button>
            ${m.configurable ? `<button class="btn ghost" data-cfg="${m.section}">Configure →</button>` : `<span class="muted" style="font-size:12px">${m.name === 'voice' ? 'locked' : 'no config'}</span>`}
          </div>
        </div>`).join('')}</div>`;
    view.querySelectorAll('[data-mod]').forEach((t) => t.onclick = async () => {
      if (t.dataset.mod === 'voice') { toast('Private Voice is intentionally locked', true); return; }
      try { const res = await api.post(`/modules/${t.dataset.mod}/toggle`, { enabled: t.dataset.en !== 'true' }); toast(`${res.module.name} ${res.module.enabled ? 'enabled' : 'disabled'}`); pages.modules(); refreshHealth(); }
      catch (e) { toast(e.message, true); }
    });
    view.querySelectorAll('[data-cfg]').forEach((b) => b.onclick = () => { location.hash = '#/' + b.dataset.cfg; });
  },

  async welcome() {
    const { draft } = await api.get('/config/draft');
    const { channels } = await api.get('/discord/channels');
    const w = draft.welcome;
    view.innerHTML = topbar('Welcome', 'Graphical welcome card + join/leave messages') + `
      <div class="grid cols-2">
        <div class="card"><h3>Live card preview</h3><div class="preview-wrap"><img id="wc-preview" src="/api/welcome/preview.png?t=${Date.now()}" alt="welcome preview" /></div>
          <div class="hint">Preview uses a sample avatar/name — <strong>real joins use the member's real avatar, username & number.</strong></div>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
            <input type="file" id="bg-file" accept="image/png,image/jpeg,image/webp" style="max-width:220px;padding:6px" />
            <button class="btn apply" id="bg-up">⬆ Upload Background</button>
            <button class="btn ghost" id="bg-reset">Reset</button>
          </div>
          <div class="hint">${draft.welcomeBackground ? '✅ Custom background set — the avatar, name & member # are drawn on top.' : 'No custom background (gradient default).'}</div>
        </div>
        <div class="card">
          <label class="field"><span class="lab">Welcome channel</span><select id="w-ch">${channelOptions(channels, draft.welcomeChannelId)}</select></label>
          <label class="field"><span class="lab">Rules channel</span><select id="w-rules">${channelOptions(channels, draft.rulesChannelId)}</select></label>
          <label class="field"><span class="lab">Roles channel</span><select id="w-roles">${channelOptions(channels, draft.rolesChannelId)}</select></label>
          <label class="field"><span class="lab">Card title</span><input id="w-title" type="text" value="${esc(w.title)}" /></label>
          <label class="field"><span class="lab">Accent / primary color</span><input id="w-color" type="color" value="${intToHex(draft.colors.primary || 0x2b8cff)}" style="height:42px;padding:4px" /></label>
          <div style="display:flex;gap:14px;margin:10px 0">
            <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="w-dm" ${w.dmEnabled ? 'checked' : ''}/> Join DM</label>
            <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="w-count" ${w.showMemberCount ? 'checked' : ''}/> Show member count</label>
          </div>
        </div>
      </div>
      <div class="card section"><h3>Message</h3>
        <label class="field"><span class="lab">Welcome message ({member} {rules} {roles} {memberCount})</span><textarea id="w-msg">${esc(w.message)}</textarea></label>
        <label class="field"><span class="lab">Leave message ({username})</span><input id="w-leave" type="text" value="${esc(w.leaveMessage)}" /></label>
        <div style="display:flex;gap:8px;margin-top:6px;align-items:center"><button class="btn" id="w-save">💾 Save Draft</button><button class="btn ghost" id="w-refresh">Regenerate preview</button><span class="muted" style="font-size:12px">Draft is applied from the top bar.</span></div>
      </div>`;
    const bust = () => { document.getElementById('wc-preview').src = '/api/welcome/preview.png?t=' + Date.now(); };
    document.getElementById('w-refresh').onclick = bust;
    document.getElementById('bg-up').onclick = () => {
      const f = document.getElementById('bg-file').files[0];
      if (!f) { toast('Choose an image first', true); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try { await api.post('/welcome/background', { data: reader.result }); toast('Background uploaded to draft'); await refreshDraftBar(); bust(); }
        catch (e) { toast(e.message, true); }
      };
      reader.readAsDataURL(f);
    };
    document.getElementById('bg-reset').onclick = async () => { await api.post('/welcome/background/reset', {}); toast('Background reset'); await refreshDraftBar(); bust(); };
    document.getElementById('w-save').onclick = async () => {
      await saveDraft({ welcomeChannelId: val('w-ch') || undefined, rulesChannelId: val('w-rules') || undefined, rolesChannelId: val('w-roles') || undefined, colors: { primary: hexToInt(val('w-color')) }, welcome: { title: val('w-title'), message: val('w-msg'), leaveMessage: val('w-leave'), dmEnabled: chk('w-dm'), showMemberCount: chk('w-count') } }, 'Welcome saved to draft');
      bust();
    };
  },

  async roles() {
    const { roles, groups } = await api.get('/roles');
    const manageable = roles.filter((r) => !r.selfRoleBlockReason);
    const rows = roles.map((r) => `<tr><td><span class="swatch" style="background:${intToHex(r.color)}"></span>${esc(r.name)}</td><td>${r.memberCount}</td><td>${r.position}</td><td>${r.managed ? pill('off', 'managed') : (r.botCanManage ? pill('ok', 'manageable') : pill('bad', 'above bot'))}</td><td>${r.selfRoleBlockReason ? `<span class="muted" title="${esc(r.selfRoleBlockReason)}">🚫 blocked</span>` : pill('ok', 'self-role ok')}</td></tr>`).join('');
    const roleExists = (id) => roles.some((r) => r.id === id);
    const groupCards = groups.length ? groups.map((g) => `<div class="card"><div class="row" style="border:none"><h3>${esc(g.label)} <span class="chip grey">${esc(g.key)}</span></h3><div style="display:flex;gap:10px;align-items:center"><span class="muted">${g.exclusive ? 'single-choice' : 'multi'}</span><button class="btn ghost" data-delgroup="${esc(g.key)}" title="Delete group">🗑</button></div></div>${g.roles.length ? g.roles.map((x) => `<div class="row"><div>${esc(x.label)} ${roleExists(x.roleId) ? '' : '<span style="color:var(--warn)">⚠ not in this server</span>'}</div><div style="display:flex;gap:12px;align-items:center"><span class="mono muted">${esc(x.roleId)}</span><button class="btn ghost" data-rm="${esc(g.key)}|${esc(x.roleId)}" title="Remove from group">✕</button></div></div>`).join('') : '<div class="muted">No roles yet</div>'}</div>`).join('') : `<div class="card">${emptyState('No self-role groups yet', 'Create one below by adding a role to a new group key.')}</div>`;
    view.innerHTML = topbar('Roles', 'Self-role groups & server role safety') + `
      <div class="section"><h2>Self-role groups</h2><div class="grid cols-2">${groupCards}</div></div>
      <div class="card section"><h3>Add self-role</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
          <label class="field" style="margin:0"><span class="lab">Group key</span><input id="r-group" type="text" placeholder="games" list="grouplist"/><datalist id="grouplist">${groups.map((g) => `<option value="${esc(g.key)}">`).join('')}</datalist></label>
          <label class="field" style="margin:0"><span class="lab">Existing role (safe only)</span><select id="r-role">${manageable.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
          <button class="btn apply" id="r-add">Add to draft</button>
        </div>
        <div class="hint">Administrator/staff/managed/above-bot roles are refused automatically — no duplicates created.</div>
      </div>
      <div class="card section"><h3>Server roles</h3><table><tr><th>Role</th><th>Members</th><th>Pos</th><th>Bot</th><th>Self-role</th></tr>${rows}</table></div>`;
    document.getElementById('r-add').onclick = async () => {
      const key = val('r-group').trim().toLowerCase(); const roleId = val('r-role');
      if (!key) { toast('Enter a group key', true); return; }
      const check = await api.post('/roles/check', { roleId });
      if (!check.ok) { toast('Refused: ' + check.reason, true); return; }
      const g = [...groups]; let grp = g.find((x) => x.key === key); const role = roles.find((r) => r.id === roleId);
      if (!grp) { grp = { key, label: key[0].toUpperCase() + key.slice(1), exclusive: false, minValues: 0, maxValues: 25, roles: [] }; g.push(grp); }
      if (!grp.roles.some((x) => x.roleId === roleId)) grp.roles.push({ roleId, label: role.name });
      await saveDraft({ selfRoleGroups: g }, `Added ${role.name} to ${key}`); pages.roles();
    };
    view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
      const [key, roleId] = b.dataset.rm.split('|');
      const g = groups.map((x) => x.key === key ? { ...x, roles: x.roles.filter((r) => r.roleId !== roleId) } : x);
      await saveDraft({ selfRoleGroups: g }, 'Role removed from group'); pages.roles();
    });
    view.querySelectorAll('[data-delgroup]').forEach((b) => b.onclick = async () => {
      const key = b.dataset.delgroup;
      const g = groups.filter((x) => x.key !== key);
      await saveDraft({ selfRoleGroups: g }, `Group "${key}" deleted`); pages.roles();
    });
  },

  async roleManager() {
    const d = await api.get('/roles/manager');
    if (!d.available) {
      view.innerHTML = topbar('Role Manager', 'Manage the real server roles') + `<div class="card">${emptyState('No role snapshot yet', d.message)}<div style="text-align:center"><code class="mono">npm run audit:roles</code></div></div>`;
      return;
    }
    RM.roles = d.roles; RM.botTop = d.botTopPosition;
    const [{ warnings }, { bots }] = [await api.get('/roles/manager/warnings'), await api.get('/roles/manager/bots')];

    // group by category in the returned (hierarchy) order
    let html = topbar('Role Manager', `${d.roles.length} roles · drag to reorder · nothing hits Discord until you apply`,
      `<div style="display:flex;gap:8px"><button class="btn" id="rm-diff">Show Diff</button><button class="btn ghost" id="rm-discard">Discard</button><button class="btn live" id="rm-apply">Apply to Discord</button></div>`);
    if (d.hasDraft) html += `<div class="samplebar" style="border-color:rgba(255,176,32,.4);color:#ffcaa0;background:rgba(255,176,32,.07)">✏️ Draft changes staged — review with <strong>Show Diff</strong>. 🔒 LIVE MUTATIONS LOCKED, so Apply only previews.</div>`;

    html += `<div class="grid cols-2"><div>`;
    let lastCat = null;
    for (const r of d.roles) {
      if (r.categoryLabel !== lastCat) { html += `<div class="rm-cat">${esc(r.categoryLabel)}</div>`; lastCat = r.categoryLabel; }
      html += roleCardHtml(r);
    }
    html += `</div><div>`;
    // warnings panel
    html += `<div class="card"><h3>⚠️ Smart warnings (${warnings.length})</h3>${warnings.length ? warnings.map((x) => `<div class="diag ${x.level === 'high' ? 'error' : x.level === 'med' ? 'warn' : 'ok'}"><div class="ic">${x.level === 'high' ? '🔴' : x.level === 'med' ? '🟠' : 'ℹ️'}</div><div>${esc(x.text)}</div></div>`).join('') : '<div class="muted">No warnings.</div>'}</div>`;
    // bot analysis panel
    html += `<div class="card section"><h3>🤖 Bot dependency analysis</h3>${bots.map((b) => `<div class="mapblock"><div class="row" style="border:none"><strong>${esc(b.name)}</strong>${b.administrator ? pill('bad', 'Administrator') : pill('ok', 'no admin')}</div><div class="maprow"><div>Position</div><div>${b.position}</div></div><div class="maprow"><div>Assigns</div><div>${esc(b.assigns)}</div></div><div class="maprow"><div>Min position</div><div>${esc(b.minPos)}</div></div><div class="maprow"><div>Admin removable?</div><div>${esc(b.adminRemovable)}</div></div><div class="maprow"><div>Depends on</div><div>${esc(b.deps)}</div></div></div>`).join('')}</div>`;
    html += `</div></div>`;
    view.innerHTML = html;

    // wire cards (click to edit + drag to reorder)
    wireRoleCards();
    document.getElementById('rm-discard').onclick = async () => { await api.post('/roles/manager/discard'); toast('Role draft discarded'); pages.roleManager(); };
    document.getElementById('rm-diff').onclick = showRoleDiff;
    document.getElementById('rm-apply').onclick = async () => {
      const { ops } = await api.get('/roles/manager/diff');
      if (!ops.length) { toast('No staged changes'); return; }
      showModal(`<h2>Apply ${ops.length} role change(s) to Discord</h2><p class="muted">A rollback snapshot is taken first, then each operation runs individually.</p>${opsTable(ops)}<div class="spacer"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" id="m-cancel">Cancel</button><button class="btn live" id="m-go">Confirm Apply</button></div>`);
      document.getElementById('m-cancel').onclick = closeModal;
      document.getElementById('m-go').onclick = async () => {
        try { await api.post('/roles/manager/apply'); }
        catch (e) { closeModal(); showModal(`<h2>🔒 Blocked</h2><p class="muted">${esc(e.message)}</p><p class="muted">${ops.length} operation(s) are staged and will run once LIVE mutations are unlocked in the next approved phase.</p><div style="text-align:right"><button class="btn" id="m-ok">OK</button></div>`); document.getElementById('m-ok').onclick = closeModal; }
      };
    };
  },

  async deploy() {
    const d = await api.get('/roles/apply');
    if (!d.available) { view.innerHTML = topbar('Deploy', 'Apply role changes') + `<div class="card">${emptyState('No plan yet', d.message)}</div>`; return; }
    const c = d.counts;
    view.innerHTML = topbar('Deploy — Role Changes', 'First deployment: safe renames / colors / hoist. Permissions & moves held for review.', pill(d.lock.locked ? 'warn' : 'bad', d.lock.locked ? '🔒 MUTATIONS LOCKED' : '⚠ UNLOCKED')) + `
      <div class="grid cols-4">
        <div class="card"><div class="label">Renames</div><div class="kpi blue">${c.renames}</div></div>
        <div class="card"><div class="label">Colors</div><div class="kpi">${c.colors}</div></div>
        <div class="card"><div class="label">Hoist changes</div><div class="kpi">${c.hoist}</div></div>
        <div class="card"><div class="label">Moves</div><div class="kpi">${c.moves}</div><div class="sub">opt-in</div></div>
      </div>
      <div class="grid cols-4 section">
        <div class="card"><div class="label">Permission changes</div><div class="kpi">0</div><div class="sub">held for review</div></div>
        <div class="card"><div class="label">Member changes</div><div class="kpi">0</div></div>
        <div class="card"><div class="label">Deletes</div><div class="kpi">0</div></div>
        <div class="card"><div class="label">Selected</div><div class="kpi blue">${d.selectedCount}</div></div>
      </div>
      <div class="card section"><h3>Rollback & validation</h3>
        <div class="row"><div>Rollback snapshot</div><div class="mono muted">${d.lastSnapshot ? esc(d.lastSnapshot) : '— not created yet —'}</div></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="dp-validate">Validate</button><button class="btn" id="dp-snap">Create Snapshot</button><button class="btn live" id="dp-apply">Unlock & Apply Selected</button></div>
        <div id="dp-result"></div>
        <div class="hint">🔒 Applying is locked. The real apply runs via <code>npm run roles:apply</code> after you set <code>LGCY_ALLOW_MUTATIONS=1</code> — a deliberate manual unlock. It snapshots LIVE first, applies sequentially, verifies each change, and stops on any failure.</div>
      </div>
      <div class="grid cols-2 section">
        <div class="card"><h3>Operations (${d.ops.length})</h3><div class="editor">${opsList(d.ops)}</div></div>
        <div>
          <div class="card"><h3>⚠️ Permission review — NOT in this apply</h3>${d.held.map((h) => `<div class="row"><div><strong>${esc(h.role)}</strong><div class="muted" style="font-size:12px">${esc(h.change)}</div></div></div>`).join('')}</div>
          <div class="card section"><h3>Sidebar preview (hoisted after apply)</h3>${d.sidebar.length ? d.sidebar.map((s) => `<div class="row"><div><span class="swatch" style="background:${esc(s.color)}"></span>${esc(s.name)}</div></div>`).join('') : '<div class="muted">none</div>'}<div class="hint">${d.sidebar.length} member-list group(s) — down from ~20.</div></div>
          <div class="card section"><h3>🤖 Bot positions</h3>${d.bots.map((b) => `<div class="maprow"><div>${esc(b.name)} <span class="muted">pos ${b.currentPosition}${b.administrator ? ' · admin' : ''}</span></div><div class="muted" style="font-size:12px;max-width:55%;text-align:right">${esc(b.minSafe)}</div></div>`).join('')}</div>
        </div>
      </div>`;
    view.querySelectorAll('[data-op]').forEach((cb) => cb.onchange = async () => { await api.post('/roles/apply/toggle', { opId: cb.dataset.op, selected: cb.checked }); pages.deploy(); });
    document.getElementById('dp-validate').onclick = async () => { const r = await api.post('/roles/apply/validate'); document.getElementById('dp-result').innerHTML = `<div class="result">${r.ok ? '✅ no drift' : '⚠️ ' + r.drift.length + ' drift issue(s)'} · ref: ${esc(r.referenceType)} · already-applied: ${r.alreadyApplied.length} · pending: ${r.pending.length} · ${r.roleCount} roles${r.drift.length ? '<br>' + r.drift.map((d) => '• ' + esc(d)).join('<br>') : ''}</div>`; };
    document.getElementById('dp-snap').onclick = async () => { const r = await api.post('/roles/apply/snapshot'); document.getElementById('dp-result').innerHTML = `<div class="result">📸 <span class="mono">${esc(r.path)}</span><br><span class="muted">${esc(r.note)}</span></div>`; pages.deploy(); };
    document.getElementById('dp-apply').onclick = () => {
      const sel = d.ops.filter((o) => o.selected);
      showModal(`<h2>Apply ${sel.length} selected change(s)?</h2><p class="muted">A LIVE rollback snapshot is taken first, then each op runs and is verified.</p>${opsTable(sel.map((o) => ({ type: o.type, roleName: o.roleName, from: o.from, to: o.to })))}<div class="spacer"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" id="m-x">Cancel</button><button class="btn live" id="m-a">Unlock & Apply</button></div>`);
      document.getElementById('m-x').onclick = closeModal;
      document.getElementById('m-a').onclick = async () => {
        try { await api.post('/roles/apply/execute'); }
        catch (e) { closeModal(); showModal(`<h2>🔒 Locked — nothing applied</h2><p class="muted">${esc(e.message)}</p><p class="muted">To apply the ${sel.length} selected op(s): set <code>LGCY_ALLOW_MUTATIONS=1</code> and run <code>npm run roles:apply</code>. It snapshots LIVE first and verifies each change.</p><div style="text-align:right"><button class="btn" id="m-ok">OK</button></div>`); document.getElementById('m-ok').onclick = closeModal; }
      };
    };
  },

  async moderation() {
    const d = await api.get('/moderation');
    const { channels } = await api.get('/discord/channels');
    const { roles } = await api.get('/roles');
    view.innerHTML = topbar('Moderation', 'Staff roles, protection & case logging') + `
      <div class="grid cols-2">
        <div class="card"><h3>Moderator roles</h3>
          <label class="field"><span class="lab">Add a staff role</span><select id="mod-role"><option value="">— choose —</option>${roles.filter((r) => r.isStaffLike).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
          <div style="margin-top:6px">${d.staffRoleIds.length ? d.staffRoleIds.map((id) => `<span class="chip">${esc((roles.find((r) => r.id === id) || {}).name || id)}</span>`).join(' ') : '<span class="muted">None configured</span>'}</div>
          <button class="btn apply" id="mod-add" style="margin-top:10px">Add to draft</button>
        </div>
        <div class="card"><h3>Moderation log</h3>
          <label class="field"><span class="lab">Log channel</span><select id="mod-log">${channelOptions(channels, d.logChannel)}</select></label>
          <button class="btn" id="mod-save">💾 Save Draft</button>
          <div class="hint">/warn /warnings /timeout /untimeout /kick /ban /unban /purge /slowmode /lock /unlock — all hierarchy + permission checked.</div>
        </div>
      </div>
      <div class="card section"><h3>Recent cases</h3>${d.recentCases.length ? '' : emptyState('No moderation cases yet', 'Cases will appear here once the bot is live and moderators act.')}</div>`;
    document.getElementById('mod-add').onclick = async () => { const id = val('mod-role'); if (!id) return; await saveDraft({ staffRoleIds: [...new Set([...d.staffRoleIds, id])] }, 'Staff role added'); pages.moderation(); };
    document.getElementById('mod-save').onclick = async () => { await saveDraft({ logChannels: { moderation: val('mod-log') || undefined } }, 'Mod log saved'); };
  },

  async tickets() {
    const d = await api.get('/tickets');
    const { channels } = await api.get('/discord/channels');
    const c = d.config;
    view.innerHTML = topbar('Tickets', 'Support ticket configuration & live state') + `
      <div class="grid cols-4">
        <div class="card"><div class="label">Open</div><div class="kpi blue">${d.stats.open}</div></div>
        <div class="card"><div class="label">Claimed</div><div class="kpi">${d.stats.claimed}</div></div>
        <div class="card"><div class="label">Unclaimed</div><div class="kpi">${d.stats.unclaimed}</div></div>
        <div class="card"><div class="label">Closed</div><div class="kpi">${d.stats.closed}</div></div>
      </div>
      <div class="grid cols-2 section">
        <div class="card"><h3>Channels</h3>
          <label class="field"><span class="lab">Panel channel</span><select id="t-panel">${channelOptions(channels, c.panelChannelId)}</select></label>
          <label class="field"><span class="lab">Parent category</span><select id="t-parent">${channelOptions(channels, c.parentCategoryId, 'category')}</select></label>
          <label class="field"><span class="lab">Archive category</span><select id="t-archive">${channelOptions(channels, c.archiveCategoryId, 'category')}</select></label>
          <label class="field"><span class="lab">Ticket log</span><select id="t-log">${channelOptions(channels, c.logChannelId)}</select></label>
          <button class="btn" id="t-save">💾 Save Draft</button>
        </div>
        <div class="card"><h3>Categories</h3>${c.categories.map((cat) => `<div class="row"><div>${cat.emoji || '•'} <strong>${esc(cat.label)}</strong> <span class="chip grey">${esc(cat.channelPrefix)}-</span></div><span class="muted">${cat.allowMultiple ? 'multiple' : 'single'}</span></div>`).join('')}
          <div class="hint">Cooldown ${c.cooldownSec}s · delete-delay ${c.deleteDelay}s.</div>
          <button class="btn live" id="t-publish" style="margin-top:10px">🎫 Publish Ticket Panel</button>
        </div>
      </div>
      <div class="card section"><h3>Tickets</h3><table><tr><th>#</th><th>User</th><th>Category</th><th>Status</th><th>Claimed by</th><th>Created</th></tr>${d.tickets.length ? d.tickets.map((t) => `<tr><td>${t.ticketNumber}</td><td class="mono">${esc(t.openerId)}</td><td>${esc(t.category)}</td><td>${t.status}</td><td>${esc(t.claimedBy || '—')}</td><td class="muted">${esc(t.createdAt)}</td></tr>`).join('') : '<tr><td colspan="6">' + emptyState('No tickets yet', 'Tickets open here once the panel is live.') + '</td></tr>'}</table></div>`;
    document.getElementById('t-save').onclick = async () => { await saveDraft({ ticketPanelChannelId: val('t-panel') || undefined, ticketParentCategoryId: val('t-parent') || undefined, ticketArchiveCategoryId: val('t-archive') || undefined, ticketLogChannelId: val('t-log') || undefined }, 'Ticket channels saved'); };
    document.getElementById('t-publish').onclick = () => confirmLive('Publish Ticket Panel — affects Discord', 'This posts the ticket panel (embed + category select) into the configured channel. It is a Discord action, disabled in local mode.', 'Publish to Discord', async () => { toast('Publishing requires an approved live connection — nothing sent.'); });
  },

  async logging() {
    const { logChannels } = await api.get('/logging');
    const { channels } = await api.get('/discord/channels');
    const cats = [['member', 'Member Join / Leave'], ['message', 'Message Delete / Edit'], ['role', 'Role & Nickname Changes'], ['moderation', 'Moderation Actions'], ['voice', 'Voice Join / Leave / Move'], ['server', 'Channel / Server Changes']];
    view.innerHTML = topbar('Logging', 'Route each log category to its own channel') + `
      <div class="card"><table class="matrix"><tr><th>Event category</th><th>Destination channel</th><th></th></tr>
      ${cats.map(([key, label]) => `<tr><td><strong>${esc(label)}</strong></td><td><select data-log="${key}">${channelOptions(channels, logChannels[key])}</select></td><td>${logChannels[key] ? pill('ok', 'routed') : pill('off', 'disabled')}</td></tr>`).join('')}
      </table><div class="hint">Separate channels keep one log from being spammed. Leave "none" to disable a category. Changes are staged as a draft.</div></div>`;
    view.querySelectorAll('[data-log]').forEach((s) => s.onchange = async () => { await saveDraft({ logChannels: { [s.dataset.log]: s.value || undefined } }, `${s.dataset.log} log set`); pages.logging(); });
  },

  async voice() {
    view.innerHTML = topbar('Private Voice', 'Temporary/private voice — intentionally dormant') + `
      <div class="card"><div class="row" style="border:none"><div style="display:flex;gap:12px;align-items:center"><div class="ico" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:22px;background:rgba(43,140,255,0.12)">🔊</div><div><h3>Private Voice</h3><span class="chip grey">v0.1.0 · locked</span></div></div>${pill('off', 'DISABLED')}</div>
      <p class="muted">Disabled by design. The server's existing four Private rooms may be driven by another system, so LGCY Core will not touch voice until that is understood. The toggle is locked.</p>
      <button class="toggle locked"></button></div>`;
  },

  async server() {
    const d = await api.get('/server');
    const cats = d.channels.filter((c) => c.type === 'category');
    const tree = cats.map((cat) => `<div style="margin-bottom:10px"><div style="font-weight:700">📁 ${esc(cat.name)}</div>${d.channels.filter((c) => c.parentId === cat.id).map((c) => `<div class="muted" style="padding-left:16px">${c.type === 'voice' ? '🔊' : '#'} ${esc(c.name)}</div>`).join('')}</div>`).join('');
    const issues = d.issues.length ? d.issues.map((i) => `<div class="diag ${i.level === 'error' ? 'error' : 'warn'}"><div class="ic">${i.level === 'error' ? '❌' : '⚠️'}</div><div>${esc(i.text)}</div></div>`).join('') : `<div class="diag ok"><div class="ic">✅</div><div>No structural issues detected.</div></div>`;
    view.innerHTML = topbar('Server Inspector', 'Read-only view of the server', pill('off', 'read-only')) + `
      <div class="grid cols-2">
        <div class="card"><h3>Channels</h3>${tree}</div>
        <div class="card"><h3>Issues</h3>${issues}<div class="section"><h3>Other bots present</h3><div>${d.otherBots.map((b) => `<span class="chip grey">${esc(b)}</span>`).join(' ')}</div><div class="hint">These stay running until each LGCY Core feature is proven.</div></div></div>
      </div>`;
  },

  async database() {
    const d = await api.get('/database');
    view.innerHTML = topbar('Database', 'Health, schema & safe maintenance') + `
      <div class="grid cols-4">
        <div class="card"><div class="label">Health</div><div style="margin-top:8px">${pill('ok', 'Healthy')}</div></div>
        <div class="card"><div class="label">Schema</div><div class="kpi">v${d.schemaVersion}</div><div class="sub">latest v${d.latestSchemaVersion}</div></div>
        <div class="card"><div class="label">Size</div><div class="kpi">${fmtBytes(d.sizeBytes)}</div></div>
        <div class="card"><div class="label">Tickets</div><div class="kpi">${d.counts.tickets}</div><div class="sub">${d.counts.modCases} cases</div></div>
      </div>
      <div class="card section"><h3>Maintenance</h3>
        <div style="display:flex;gap:8px"><button class="btn apply" id="db-backup">💾 Backup Database</button><button class="btn" id="db-migrate">Run Pending Migrations</button></div>
        <div class="hint">Backups copy the SQLite file locally. Destructive resets are developer-only and not available here.</div>
        <div id="db-result"></div>
      </div>`;
    document.getElementById('db-backup').onclick = async () => { const r = await api.post('/database/backup'); document.getElementById('db-result').innerHTML = `<div class="result">✅ Backed up (${fmtBytes(r.sizeBytes)}) → <span class="mono">${esc(r.path)}</span></div>`; };
    document.getElementById('db-migrate').onclick = async () => { const r = await api.post('/database/migrate'); document.getElementById('db-result').innerHTML = `<div class="result">Schema at v${r.schemaVersion}</div>`; };
  },

  async diagnostics() {
    view.innerHTML = topbar('Diagnostics', 'Full system check with exact fixes', '<button class="btn apply" id="diag-run">Run Full Diagnostic</button>') + `<div id="diag-out" class="card"><div class="muted">Click "Run Full Diagnostic" to check credentials, gateway, permissions, hierarchy, database, modules, secrets, and assets.</div></div>`;
    const run = async () => {
      const d = await api.get('/diagnostics');
      document.getElementById('diag-out').innerHTML = `<div style="display:flex;gap:10px;margin-bottom:14px;align-items:center">${pill('ok', d.summary.ok + ' OK')} ${pill('warn', d.summary.warn + ' warnings')} ${pill('bad', d.summary.error + ' errors')} <button class="btn ghost" id="diag-copy">📋 Copy report</button></div>${d.checks.map((c) => `<div class="diag ${c.status}"><div class="ic">${c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'}</div><div><strong>${esc(c.label)}</strong><div class="muted" style="font-size:13px">${esc(c.detail)}</div>${c.fix ? `<div class="fix">Fix: ${esc(c.fix)}</div>` : ''}</div></div>`).join('')}`;
      document.getElementById('diag-copy').onclick = () => { navigator.clipboard.writeText(JSON.stringify(d, null, 2)); toast('Sanitized report copied'); };
    };
    document.getElementById('diag-run').onclick = run;
    run();
  },

  async activity() {
    const { entries } = await api.get('/audit');
    view.innerHTML = topbar('Activity', 'Control Center audit trail — never records secrets') + `<div class="card">${entries.length ? `<table><tr><th>Time (UTC)</th><th>Action</th><th>Module</th><th>Result</th><th>Detail</th></tr>${entries.map((e) => `<tr><td class="mono muted">${esc(e.ts)}</td><td>${esc(e.action)}</td><td>${esc(e.module || '—')}</td><td>${e.result === 'error' ? pill('bad', 'error') : e.result === 'info' ? pill('off', 'info') : pill('ok', 'ok')}</td><td class="muted">${esc(e.detail || '')}</td></tr>`).join('')}</table>` : emptyState('No activity yet', 'Draft saves, applies, toggles, backups and credential updates will appear here.')}</div>`;
  },

  async settings() {
    const { revisions } = await api.get('/config/history');
    view.innerHTML = topbar('Settings & Backup', 'Export / import config & restore local revisions') + `
      <div class="grid cols-2">
        <div class="card"><h3>Export configuration</h3><p class="muted">Downloads module/channel/role/welcome/ticket/logging config. Never includes the token, keys, or credentials.</p><button class="btn apply" id="exp">⬇ Export config JSON</button></div>
        <div class="card"><h3>Import configuration</h3><textarea id="imp" placeholder="Paste exported config JSON here…"></textarea><div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="imp-prev">Preview changes</button><button class="btn apply" id="imp-apply" disabled>Apply import</button></div><div id="imp-out"></div></div>
      </div>
      <div class="card section"><h3>Local configuration history</h3>${revisions.length ? `<table><tr><th>#</th><th>Saved (UTC)</th><th>Label</th><th></th></tr>${revisions.map((rv) => `<tr><td>${rv.id}</td><td class="mono muted">${esc(rv.ts)}</td><td>${esc(rv.label || '—')}</td><td><button class="btn ghost" data-restore="${rv.id}">Restore</button></td></tr>`).join('')}</table><div class="hint">Restore stages the revision as a draft → review the diff → Apply from the top bar. Nothing is pushed to Discord.</div>` : emptyState('No revisions yet', 'A snapshot is saved automatically before each Apply.')}</div>`;
    document.getElementById('exp').onclick = async () => { const data = await api.get('/settings/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lgcy-config.json'; a.click(); toast('Exported (token excluded)'); };
    document.getElementById('imp-prev').onclick = async () => {
      let payload; try { payload = JSON.parse(val('imp')); } catch { toast('Invalid JSON', true); return; }
      const res = await api.post('/settings/import/preview', payload);
      document.getElementById('imp-out').innerHTML = res.ok ? `<div class="result">${res.diff.length ? diffTable(res.diff) : 'No differences.'}</div>` : `<div class="result">❌ ${esc(res.errors.join('; '))}</div>`;
      document.getElementById('imp-apply').disabled = !res.ok;
      document.getElementById('imp-apply').onclick = async () => { await api.post('/settings/import/apply', payload); toast('Config imported'); await refreshDraftBar(); pages.settings(); };
    };
    view.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
      const { changes } = await api.post(`/config/history/${b.dataset.restore}/restore`);
      showModal(`<h2>Restore revision #${esc(b.dataset.restore)}</h2><p class="muted">This staged the revision as a <strong>draft</strong>. Review the diff below, then <strong>Apply</strong> it from the top bar. Nothing is pushed to Discord.</p>${changes.length ? diffTable(changes) : '<p class="muted">No differences from current config.</p>'}<div class="spacer"></div><div style="text-align:right"><button class="btn" id="m-ok">OK</button></div>`);
      document.getElementById('m-ok').onclick = closeModal;
      await refreshDraftBar();
    });
  },
};

// ── wizard ───────────────────────────────────────────────────────────
function showWizard(state) {
  const has = state.credentials.hasToken;
  const prov = state.secretProvider;
  overlay.innerHTML = `<div class="overlay"><div class="wizard">
    <h2>Welcome to LGCY Control Center ⚡</h2>
    <p class="muted">First-time setup. You can also explore the whole dashboard with sample data before entering anything.</p>
    <div class="steps"><div class="s on"></div><div class="s"></div><div class="s"></div></div>
    <h3>Step 1 — Discord Bot</h3>
    <label class="field"><span class="lab">Bot Token ${has ? '(stored — leave blank to keep)' : ''}</span><input id="wz-token" type="password" placeholder="${has ? '•••••••• stored securely' : 'Paste bot token'}" autocomplete="off" /></label>
    <label class="field"><span class="lab">Application ID</span><input id="wz-app" type="text" value="${esc(state.credentials.applicationId || '')}" placeholder="e.g. 155…" /></label>
    <label class="field"><span class="lab">Guild / Server ID</span><input id="wz-guild" type="text" value="${esc(state.credentials.guildId || '')}" placeholder="LGCY server ID" /></label>
    <div class="hint">🔒 Secret storage: <strong>${esc(prov.label)}</strong> — ${esc(prov.status)}. The token is encrypted at rest outside the repo and never shown again (only "Replace Token").</div>
    ${prov.status !== 'SECURE' ? `<div class="result">⚠️ ${esc(prov.warning || '')}</div>` : ''}
    <div id="wz-result"></div>
    <div class="spacer"></div>
    <div style="display:flex;gap:8px;justify-content:space-between">
      <button class="btn ghost" id="wz-explore">Explore with sample data →</button>
      <div style="display:flex;gap:8px"><button class="btn" id="wz-test">Test Credentials</button><button class="btn apply" id="wz-save">Save</button></div>
    </div>
  </div></div>`;
  document.getElementById('wz-explore').onclick = () => { closeModal(); route(); };
  document.getElementById('wz-test').onclick = async () => { const res = await api.post('/secret/test', {}); document.getElementById('wz-result').innerHTML = `<div class="result">🔌 ${esc(res.message)}</div>`; };
  document.getElementById('wz-save').onclick = async () => {
    const token = val('wz-token').trim();
    const body = { applicationId: val('wz-app').trim() || undefined, guildId: val('wz-guild').trim() || undefined };
    try {
      if (token) await api.post('/secret/token', { token, ...body }); else await api.post('/secret/ids', body);
      document.getElementById('wz-result').innerHTML = `<div class="result">✅ Saved securely. Token is stored encrypted and never returned to this page.</div>`;
      STATE = await api.init(); updateHeader();
      setTimeout(() => { closeModal(); route(); }, 900);
    } catch (e) { document.getElementById('wz-result').innerHTML = `<div class="result">❌ ${esc(e.message)}</div>`; }
  };
}

// ── header (mode + health) ───────────────────────────────────────────
function updateHeader() {
  const m = document.getElementById('mode-badge');
  if (STATE.mode === 'LIVE') { m.className = 'modebadge live'; m.textContent = '🔴 LIVE — ' + (STATE.guildName || 'LGCY'); }
  else { m.className = 'modebadge mock'; m.textContent = '◈ MOCK MODE'; }
  document.getElementById('ver-badge').textContent = 'v' + STATE.version;
  const lb = document.getElementById('lock-badge');
  if (STATE.liveLock && !STATE.liveLock.locked) { lb.className = 'lockbadge open'; lb.textContent = '⚠ MUTATIONS ENABLED'; }
  else { lb.className = 'lockbadge locked'; lb.textContent = '🔒 LIVE MUTATIONS LOCKED'; }
}
async function refreshState() { STATE = await api.init(); updateHeader(); }
async function refreshHealth() {
  try {
    const h = await api.get('/health');
    const b = document.getElementById('health-badge');
    b.className = 'healthbadge ' + h.status;
    b.textContent = (h.status === 'HEALTHY' ? '✅' : h.status === 'WARNING' ? '⚠️' : '❌') + ' System: ' + h.status;
  } catch { /* ignore */ }
}
document.getElementById('health-badge').onclick = () => { location.hash = '#/diagnostics'; };

// ── router ───────────────────────────────────────────────────────────
const SAMPLE_PAGES = new Set(['overview', 'bot', 'welcome', 'roles', 'moderation', 'tickets', 'logging', 'server']);
function currentRoute() { return location.hash.replace('#/', '') || 'overview'; }
async function route() {
  const r = currentRoute();
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  view.innerHTML = loadingSkeleton();
  const page = pages[r] || pages.overview;
  try { await page(); }
  catch (e) { view.innerHTML = `<div class="card"><h3>⚠️ Could not load this page</h3><div class="muted">${esc(e.message)}</div><div class="spacer"></div><button class="btn" onclick="location.reload()">Retry</button></div>`; }
  if (STATE?.mode === 'MOCK' && SAMPLE_PAGES.has(r)) view.insertAdjacentHTML('afterbegin', sampleBanner());
  await refreshDraftBar();
  refreshHealth();
}
window.addEventListener('hashchange', route);
document.querySelectorAll('.nav a').forEach((a) => a.onclick = () => { location.hash = '#/' + a.dataset.route; });

(async function boot() {
  try {
    STATE = await api.init();
    updateHeader();
    await route();
    if (!STATE.setupComplete) showWizard(STATE);
  } catch (e) {
    view.innerHTML = `<div class="card"><h3>Control Center failed to start</h3><div class="muted">${esc(e.message)}</div></div>`;
  }
})();
