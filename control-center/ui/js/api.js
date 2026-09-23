// Tiny fetch client. Attaches the CSRF token to mutating requests. Never holds
// or transmits the bot token (the server never returns it).
let csrf = null;

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (method !== 'GET' && csrf) headers['x-lgcy-csrf'] = csrf;
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  async init() {
    const state = await req('GET', '/state');
    csrf = state.csrfToken;
    return state;
  },
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
};
