// API client for Prodit

export async function register({ email, password, fullName }) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, fullName })
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Registration failed' }));
    throw new Error(error.error || 'Registration failed');
  }

  return res.json();
}

export async function login({ email, password }) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(error.error || 'Invalid email or password');
  }

  return res.json();
}

export async function logout() {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include'
  });

  return res.ok;
}

export async function getMe() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

export async function getStatus() {
  const res = await fetch('/api/status', { credentials: 'include' });
  if (!res.ok) return { connected: false };
  return res.json();
}

export async function searchItems({ query = '', page = 1, limit = 50 }) {
  const url = new URL('/api/items/search', window.location.origin);
  url.searchParams.set('query', query);
  url.searchParams.set('page', page);
  url.searchParams.set('limit', limit);

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export async function updateItems(items) {
  const res = await fetch('/api/items/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ Items: items })
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`Update failed: ${res.status} ${detail?.detail ? JSON.stringify(detail.detail) : ''}`);
  }

  return res.json();
}

export async function getTaxRates() {
  const res = await fetch('/api/taxrates', { credentials: 'include' });
  if (!res.ok) throw new Error(`TaxRates failed: ${res.status}`);
  return res.json();
}

export async function getAccounts() {
  const res = await fetch('/api/accounts', { credentials: 'include' });
  if (!res.ok) throw new Error(`Accounts failed: ${res.status}`);
  return res.json();
}
