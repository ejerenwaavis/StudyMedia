const AUTH_STORAGE_KEY = 'studymedia_auth_v1';

export function getSavedAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getAuthToken() {
  return getSavedAuth()?.token || null;
}

export function saveAuth({ token, user }) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user }));
  } catch {
    // ignore quota errors
  }
}

export function clearAuth() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Authenticated fetch wrapper that automatically attaches `Authorization: Bearer <token>`.
 */
export async function authFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
}

export async function loginRequest({ email, password }) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Login failed (HTTP ${res.status})`);
  }
  saveAuth({ token: data.token, user: data.user });
  return data;
}

export async function registerRequest({ email, password, displayName, inviteCode }) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName, inviteCode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Registration failed (HTTP ${res.status})`);
  }
  saveAuth({ token: data.token, user: data.user });
  return data;
}

export async function fetchCurrentUser() {
  const res = await authFetch('/api/auth/me');
  if (res.status === 401) {
    return { unauthorized: true, user: null };
  }
  if (!res.ok) {
    return { unauthorized: false, user: null, error: true };
  }
  const data = await res.json().catch(() => ({}));
  return { unauthorized: false, user: data.user || null, dbConnected: data.dbConnected };
}
