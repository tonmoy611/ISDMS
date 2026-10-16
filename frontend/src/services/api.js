// Single place for talking to the backend. Sends cookies, refreshes an expired session once, then retries.
const BASE = import.meta.env.VITE_API_BASE || '/api/v1';
export const API_BASE = BASE;
const NO_RETRY = ['/auth/login', '/auth/refresh', '/auth/logout'];
let refreshing = null;

async function raw(path, options = {}) {
  const { body, headers, ...rest } = options;
  try {
    const res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: body && typeof body !== 'string' ? JSON.stringify(body) : body,
      ...rest,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON response */ }
    return { status: res.status, ok: res.ok, body: json };
  } catch {
    return { status: 0, ok: false, body: { error: { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' } } };
  }
}

function refreshSession() {
  if (!refreshing) refreshing = raw('/auth/refresh', { method: 'POST' }).then((r) => r.ok).finally(() => { refreshing = null; });
  return refreshing;
}

export async function api(path, options = {}) {
  let res = await raw(path, options);
  if (res.status === 401 && !NO_RETRY.some((p) => path.startsWith(p)) && (await refreshSession())) {
    res = await raw(path, options);
  }
  return res;
}

export const errorMessage = (res, fallback = 'Something went wrong. Please try again.') => res?.body?.error?.message || fallback;
export const fieldErrors = (res) => res?.body?.error?.details || {};
