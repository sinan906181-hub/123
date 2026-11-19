import type {
  ActivityLogItem,
  AdminSecuritySettings,
  CmsSiteState,
  ContactMessage,
  DashboardOverview,
  MediaFolder,
  MediaItem,
  MessageStatus,
  PublicSecurityState,
  WebsiteLockType,
} from '../types/cms';

const TOKEN_KEY = 'ms_admin_token';
const UNLOCK_TOKEN_KEY = 'ms_site_unlock_token';

export function getStoredAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getStoredUnlockToken(): string | null {
  try {
    return sessionStorage.getItem(UNLOCK_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredUnlockToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(UNLOCK_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(UNLOCK_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function broadcastSiteSync(reason: 'draft' | 'published' | 'security'): void {
  try {
    const channel = new BroadcastChannel('ms_cms_sync');
    channel.postMessage({ reason, at: Date.now() });
    channel.close();
  } catch {
    // Ignore unsupported environments
  }
}

export function notifySecurityUpdated(publicSecurity?: PublicSecurityState): void {
  if (publicSecurity && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ms:security-updated', { detail: publicSecurity }));
  }
  broadcastSiteSync('security');
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredAdminToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && url.startsWith('/api/admin/') && typeof window !== 'undefined') {
      setStoredAdminToken(null);
      window.dispatchEvent(new CustomEvent('ms:admin-unauthorized'));
    }
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface AuthStatusResponse {
  initialized: boolean;
  authenticated: boolean;
  user: { id: string; email: string; username: string } | null;
}

export const adminApi = {
  getAuthStatus: () => apiFetch<AuthStatusResponse>('/api/auth/status'),

  login: async (payload: { password: string }) => {
    const res = await apiFetch<{
      user: { id: string; email: string; username: string };
      token: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStoredAdminToken(res.token);
    return res;
  },

  logout: async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredAdminToken(null);
  },

  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    apiFetch<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getOverview: () => apiFetch<DashboardOverview>('/api/admin/overview'),

  saveDraft: async (state: CmsSiteState, summary?: string) => {
    const res = await apiFetch<{ ok: boolean; updatedAt: string; overview: DashboardOverview }>(
      '/api/admin/draft',
      {
        method: 'PUT',
        body: JSON.stringify({ state, summary }),
      }
    );
    broadcastSiteSync('draft');
    return res;
  },

  publish: async (state?: CmsSiteState) => {
    const res = await apiFetch<{ ok: boolean; updatedAt: string; overview: DashboardOverview }>(
      '/api/admin/publish',
      {
        method: 'POST',
        body: JSON.stringify({ state }),
      }
    );
    broadcastSiteSync('published');
    return res;
  },

  discardDraft: async () => {
    const res = await apiFetch<{ ok: boolean; overview: DashboardOverview }>(
      '/api/admin/discard-draft',
      { method: 'POST' }
    );
    broadcastSiteSync('draft');
    return res;
  },

  listMedia: () => apiFetch<{ folders: MediaFolder[]; items: MediaItem[] }>('/api/admin/media'),

  createMediaFolder: (name: string) =>
    apiFetch<{ folder: MediaFolder }>('/api/admin/media/folders', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  deleteMediaFolder: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/media/folders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  uploadMedia: (files: FileList | File[], folderId = 'general', usageLocation = 'Media Library') => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    fd.append('folderId', folderId);
    fd.append('usageLocation', usageLocation);
    return apiFetch<{ items: MediaItem[] }>('/api/admin/media/upload', {
      method: 'POST',
      body: fd,
    });
  },

  replaceMedia: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiFetch<{ item: MediaItem }>(`/api/admin/media/${encodeURIComponent(id)}/replace`, {
      method: 'POST',
      body: fd,
    });
  },

  updateMedia: (
    id: string,
    updates: { originalName?: string; folderId?: string; usageLocation?: string }
  ) =>
    apiFetch<{ item: MediaItem }>(`/api/admin/media/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  deleteMedia: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/media/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listMessages: () => apiFetch<{ items: ContactMessage[] }>('/api/admin/messages'),

  updateMessage: (id: string, updates: { status?: MessageStatus; notes?: string }) =>
    apiFetch<{ item: ContactMessage }>(`/api/admin/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  deleteMessage: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listActivity: () => apiFetch<{ items: ActivityLogItem[] }>('/api/admin/activity'),

  getSecurity: () =>
    apiFetch<{ settings: AdminSecuritySettings; publicSecurity: PublicSecurityState }>(
      '/api/admin/security'
    ),

  updateShortcut: async (payload: {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    key: string;
  }) => {
    const res = await apiFetch<{
      ok: boolean;
      settings: AdminSecuritySettings;
      publicSecurity: PublicSecurityState;
    }>('/api/admin/security/shortcut', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    notifySecurityUpdated(res.publicSecurity);
    return res;
  },

  resetShortcut: async () => {
    const res = await apiFetch<{
      ok: boolean;
      settings: AdminSecuritySettings;
      publicSecurity: PublicSecurityState;
    }>('/api/admin/security/shortcut/reset', {
      method: 'POST',
    });
    notifySecurityUpdated(res.publicSecurity);
    return res;
  },

  updateWebsiteLock: async (payload: {
    enabled: boolean;
    lockType: WebsiteLockType;
    lockMessage: string;
    newCredential?: string;
    confirmCredential?: string;
  }) => {
    const res = await apiFetch<{
      ok: boolean;
      settings: AdminSecuritySettings;
      publicSecurity: PublicSecurityState;
    }>('/api/admin/security/lock', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    notifySecurityUpdated(res.publicSecurity);
    return res;
  },

  lockWebsiteNow: async () => {
    const res = await apiFetch<{
      ok: boolean;
      settings: AdminSecuritySettings;
      publicSecurity: PublicSecurityState;
    }>('/api/admin/security/lock-now', {
      method: 'POST',
    });
    notifySecurityUpdated(res.publicSecurity);
    return res;
  },

  unlockWebsite: async () => {
    const res = await apiFetch<{
      ok: boolean;
      settings: AdminSecuritySettings;
      publicSecurity: PublicSecurityState;
    }>('/api/admin/security/unlock-site', {
      method: 'POST',
    });
    notifySecurityUpdated(res.publicSecurity);
    return res;
  },

  updateSessionTimeout: (minutes: number) =>
    apiFetch<{ ok: boolean; settings: AdminSecuritySettings }>(
      '/api/admin/security/session-timeout',
      {
        method: 'PUT',
        body: JSON.stringify({ minutes }),
      }
    ),

  resetSecurity: async () => {
    const res = await apiFetch<{
      ok: boolean;
      settings: AdminSecuritySettings;
      publicSecurity: PublicSecurityState;
    }>('/api/admin/security/reset', {
      method: 'POST',
    });
    notifySecurityUpdated(res.publicSecurity);
    return res;
  },

  unlockPublicSite: async (credential: string) => {
    const res = await apiFetch<{ ok: boolean; unlockToken?: string }>('/api/public/unlock', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    });
    if (res.unlockToken) {
      setStoredUnlockToken(res.unlockToken);
    }
    return res;
  },
};
