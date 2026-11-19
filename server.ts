import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  UPLOADS_DIR,
  authenticateAdmin,
  authenticateAdminByPassword,
  bootstrapDatabase,
  createContactMessage,
  createMediaFolder,
  createSession,
  deleteContactMessageRecord,
  deleteMediaFolder,
  deleteMediaItemRecord,
  deleteSession,
  getDashboardOverview,
  getMediaItemById,
  getPublicSecurityState,
  getAdminSecuritySettings,
  getSessionUser,
  getSiteDocument,
  hasAdminUsers,
  insertMediaItem,
  isWebsiteLockedForToken,
  listContactMessages,
  listMediaFolders,
  listMediaItems,
  listRecentActivity,
  logActivity,
  resetAdminShortcut,
  resetSecuritySettings,
  saveSiteDocument,
  setWebsiteLockActive,
  updateAdminPassword,
  updateAdminShortcut,
  updateContactMessageRecord,
  updateMediaItemRecord,
  updateSessionTimeoutMinutes,
  updateWebsiteLockSettings,
  verifySiteLockCredential,
} from './server/db.ts';
import type { CmsSiteState, MessageStatus, WebsiteLockType } from './src/types/cms.ts';

bootstrapDatabase();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'ms_admin_session';
const UNLOCK_COOKIE = 'ms_site_unlock';

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.svg',
  '.gif',
  '.mp4',
  '.webm',
]);

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'image/gif',
  'video/mp4',
  'video/webm',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .slice(0, 48) || 'asset';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(
        new Error(
          'Unsupported file format. Allowed: JPG, JPEG, PNG, WEBP, SVG, GIF, MP4, WEBM.'
        )
      );
      return;
    }
    cb(null, true);
  },
});

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    result[k] = v;
  }
  return result;
}

function extractSessionToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] || null;
}

function extractUnlockToken(req: Request): string | null {
  const headerToken = req.headers['x-site-unlock'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[UNLOCK_COOKIE] || null;
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

interface RateBucket {
  failures: number[];
  blockedUntil: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(scope: string, ip: string, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const key = `${scope}:${ip}`;
  const bucket = rateBuckets.get(key);
  if (!bucket) return { allowed: true, retryAfterSec: 0 };
  const now = Date.now();
  if (bucket.blockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)) };
  }
  bucket.failures = bucket.failures.filter((ts) => now - ts < windowMs);
  return { allowed: true, retryAfterSec: 0 };
}

function recordRateFailure(
  scope: string,
  ip: string,
  maxFailures: number,
  windowMs: number,
  lockoutMs: number
): boolean {
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { failures: [], blockedUntil: 0 };
  bucket.failures = bucket.failures.filter((ts) => now - ts < windowMs);
  bucket.failures.push(now);
  let triggeredLockout = false;
  if (bucket.failures.length >= maxFailures) {
    bucket.blockedUntil = now + lockoutMs;
    bucket.failures = [];
    triggeredLockout = true;
  }
  rateBuckets.set(key, bucket);
  return triggeredLockout;
}

function clearRateLimit(scope: string, ip: string): void {
  rateBuckets.delete(`${scope}:${ip}`);
}

interface AuthedRequest extends Request {
  adminUser?: { id: string; email: string; username: string };
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractSessionToken(req);
  const user = getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: 'Session expired or unauthorized. Please sign in.' });
    return;
  }
  req.adminUser = user;
  next();
}

function isHttpsRequest(req: Request): boolean {
  return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

function setSessionCookie(req: Request, res: Response, signedToken: string): void {
  const secure = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE, signedToken, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function setUnlockCookie(req: Request, res: Response, signedToken: string): void {
  const secure = isHttpsRequest(req);
  res.cookie(UNLOCK_COOKIE, signedToken, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Serve persisted uploads
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

  // -------- AUTH ROUTES --------
  app.get('/api/auth/status', (req: Request, res: Response) => {
    const initialized = hasAdminUsers();
    const token = extractSessionToken(req);
    const user = getSessionUser(token);
    res.json({
      initialized,
      authenticated: Boolean(user),
      user: user || null,
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const limit = checkRateLimit('admin_login', ip, 15 * 60 * 1000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({
        error: `Too many failed attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).`,
      });
      return;
    }

    const { identifier, password } = req.body as { identifier?: string; password?: string };
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Incorrect password' });
      return;
    }
    const user = identifier
      ? authenticateAdmin(identifier, password)
      : authenticateAdminByPassword(password);
    if (!user) {
      const lockedOut = recordRateFailure('admin_login', ip, 5, 15 * 60 * 1000, 15 * 60 * 1000);
      logActivity(
        lockedOut ? 'AUTH_RATE_LIMITED' : 'ADMIN_LOGIN_FAILED',
        'Admin Security',
        lockedOut
          ? 'Temporarily blocked repeated failed admin login attempts.'
          : 'Failed admin login attempt rejected.'
      );
      res.status(lockedOut ? 429 : 401).json({
        error: lockedOut
          ? 'Too many failed attempts. Please wait 15 minutes before trying again.'
          : 'Incorrect password',
      });
      return;
    }
    clearRateLimit('admin_login', ip);
    const { signedToken } = createSession(user.id);
    setSessionCookie(req, res, signedToken);
    logActivity('ADMIN_LOGIN', user.username, 'Signed in to Admin Portal.');
    res.json({ user, token: signedToken });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = extractSessionToken(req);
    const user = getSessionUser(token);
    deleteSession(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    if (user) {
      logActivity('ADMIN_LOGOUT', user.username, 'Signed out of Admin Portal.');
    }
    res.json({ ok: true });
  });

  app.post('/api/auth/change-password', requireAdmin, (req: AuthedRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }
    const result = updateAdminPassword(req.adminUser!.id, currentPassword, newPassword);
    if (!result.ok) {
      res.status(400).json({ error: result.error || 'Password update failed.' });
      return;
    }
    res.json({ ok: true });
  });

  // -------- PUBLIC ROUTES --------
  app.get('/api/public/site', (req: Request, res: Response) => {
    const unlockToken = extractUnlockToken(req);
    const security = getPublicSecurityState(unlockToken);
    const wantsPreview = req.query.preview === '1';

    if (wantsPreview) {
      const token = extractSessionToken(req);
      const user = getSessionUser(token);
      if (user) {
        const draftDoc = getSiteDocument('draft');
        res.json({
          mode: 'preview',
          locked: false,
          updatedAt: draftDoc.updatedAt,
          data: draftDoc.state,
          security,
        });
        return;
      }
    }

    if (security.locked) {
      res.json({
        mode: 'locked',
        locked: true,
        updatedAt: null,
        data: null,
        security,
      });
      return;
    }

    const publishedDoc = getSiteDocument('published');
    res.json({
      mode: 'published',
      locked: false,
      updatedAt: publishedDoc.updatedAt,
      data: publishedDoc.state,
      security,
    });
  });

  app.post('/api/public/unlock', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const limit = checkRateLimit('site_unlock', ip, 10 * 60 * 1000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({
        error: `Too many failed attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).`,
      });
      return;
    }

    const { credential } = req.body as { credential?: string };
    const result = verifySiteLockCredential(typeof credential === 'string' ? credential : '');
    if (!result.ok) {
      const lockedOut = recordRateFailure('site_unlock', ip, 5, 10 * 60 * 1000, 10 * 60 * 1000);
      logActivity(
        lockedOut ? 'SITE_UNLOCK_RATE_LIMITED' : 'SITE_UNLOCK_FAILED',
        'Website Lock',
        lockedOut
          ? 'Temporarily blocked repeated failed website unlock attempts.'
          : 'Failed website lock credential attempt.'
      );
      res.status(lockedOut ? 429 : 401).json({
        error: lockedOut
          ? 'Too many failed attempts. Please wait 10 minutes before trying again.'
          : result.error,
      });
      return;
    }

    clearRateLimit('site_unlock', ip);
    setUnlockCookie(req, res, result.unlockToken);
    logActivity('SITE_UNLOCK_SUCCESS', 'Website Lock', 'Visitor unlocked website with valid credential.');
    res.json({ ok: true, unlockToken: result.unlockToken });
  });

  app.post('/api/public/contact', (req: Request, res: Response) => {
    const unlockToken = extractUnlockToken(req);
    const adminUser = getSessionUser(extractSessionToken(req));
    if (!adminUser && isWebsiteLockedForToken(unlockToken)) {
      res.status(423).json({ error: 'Website is currently locked.' });
      return;
    }

    const { name, email, service, budget, message } = req.body as {
      name?: string;
      email?: string;
      service?: string;
      budget?: string;
      message?: string;
    };
    if (!name || name.trim().length < 2) {
      res.status(400).json({ error: 'Please enter your full name.' });
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    if (!message || message.trim().length < 10) {
      res.status(400).json({ error: 'Please enter a message of at least 10 characters.' });
      return;
    }

    const created = createContactMessage({
      name: name.trim(),
      email: email.trim(),
      service: (service || 'General Inquiry').trim(),
      budget: (budget || 'Not specified').trim(),
      message: message.trim(),
    });
    res.status(201).json({ ok: true, id: created.id });
  });

  // -------- PROTECTED ADMIN ROUTES --------
  app.get('/api/admin/overview', requireAdmin, (_req: Request, res: Response) => {
    res.json(getDashboardOverview());
  });

  app.put('/api/admin/draft', requireAdmin, (req: Request, res: Response) => {
    const { state, summary } = req.body as { state?: CmsSiteState; summary?: string };
    if (!state || typeof state !== 'object') {
      res.status(400).json({ error: 'Invalid CMS draft payload.' });
      return;
    }
    const updatedAt = saveSiteDocument('draft', state);
    logActivity('DRAFT_SAVED', summary || 'Website Draft', 'Saved draft configuration changes.');
    res.json({ ok: true, updatedAt, overview: getDashboardOverview() });
  });

  app.post('/api/admin/publish', requireAdmin, (req: Request, res: Response) => {
    const { state } = req.body as { state?: CmsSiteState };
    const sourceState = state && typeof state === 'object' ? state : getSiteDocument('draft').state;
    saveSiteDocument('draft', sourceState);
    const updatedAt = saveSiteDocument('published', sourceState);
    logActivity('PUBLISHED', 'Live Website', 'Published draft configuration to live website.');
    res.json({ ok: true, updatedAt, overview: getDashboardOverview() });
  });

  app.post('/api/admin/discard-draft', requireAdmin, (_req: Request, res: Response) => {
    const publishedDoc = getSiteDocument('published');
    saveSiteDocument('draft', publishedDoc.state);
    logActivity('DRAFT_DISCARDED', 'Website Draft', 'Reverted draft to match live published site.');
    res.json({ ok: true, overview: getDashboardOverview() });
  });

  // -------- MEDIA LIBRARY ROUTES --------
  app.get('/api/admin/media', requireAdmin, (_req: Request, res: Response) => {
    res.json({
      folders: listMediaFolders(),
      items: listMediaItems(),
    });
  });

  app.post('/api/admin/media/folders', requireAdmin, (req: Request, res: Response) => {
    const { name } = req.body as { name?: string };
    if (!name || name.trim().length < 2) {
      res.status(400).json({ error: 'Folder name must be at least 2 characters.' });
      return;
    }
    try {
      const folder = createMediaFolder(name);
      res.status(201).json({ folder });
    } catch {
      res.status(400).json({ error: 'A folder with this name already exists.' });
    }
  });

  app.delete('/api/admin/media/folders/:id', requireAdmin, (req: Request, res: Response) => {
    const folderId = String(req.params.id);
    if (folderId === 'general') {
      res.status(400).json({ error: 'Default folder cannot be deleted.' });
      return;
    }
    deleteMediaFolder(folderId);
    res.json({ ok: true });
  });

  app.post(
    '/api/admin/media/upload',
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      upload.array('files', 20)(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
          return;
        }
        next();
      });
    },
    (req: Request, res: Response) => {
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        res.status(400).json({ error: 'No files uploaded.' });
        return;
      }
      const folderId = typeof req.body.folderId === 'string' ? req.body.folderId : 'general';
      const usageLocation =
        typeof req.body.usageLocation === 'string' ? req.body.usageLocation : 'Media Library';
      const ts = new Date().toISOString();

      const created = files.map((file) => {
        const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
        return insertMediaItem({
          id: crypto.randomUUID(),
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          mediaType,
          sizeBytes: file.size,
          url: `/uploads/${file.filename}`,
          folderId,
          usageLocation,
          createdAt: ts,
          updatedAt: ts,
        });
      });

      res.status(201).json({ items: created });
    }
  );

  app.post(
    '/api/admin/media/:id/replace',
    requireAdmin,
    (req: Request, res: Response, next: NextFunction) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : 'Replace failed.' });
          return;
        }
        next();
      });
    },
    (req: Request, res: Response) => {
      const id = String(req.params.id);
      const existing = getMediaItemById(id);
      const file = req.file;
      if (!existing || !file) {
        if (file) fs.unlink(file.path, () => {});
        res.status(404).json({ error: 'Media item or replacement file missing.' });
        return;
      }
      // Remove previous file safely
      const oldPath = path.join(UPLOADS_DIR, path.basename(existing.filename));
      if (fs.existsSync(oldPath)) {
        fs.unlink(oldPath, () => {});
      }
      const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const updated = updateMediaItemRecord(id, {
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        mediaType,
        sizeBytes: file.size,
        url: `/uploads/${file.filename}`,
      });
      res.json({ item: updated });
    }
  );

  app.patch('/api/admin/media/:id', requireAdmin, (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { originalName, folderId, usageLocation } = req.body as {
      originalName?: string;
      folderId?: string;
      usageLocation?: string;
    };
    const updated = updateMediaItemRecord(id, {
      ...(originalName ? { originalName: originalName.trim() } : {}),
      ...(folderId ? { folderId } : {}),
      ...(usageLocation !== undefined ? { usageLocation: usageLocation.trim() } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: 'Media item not found.' });
      return;
    }
    res.json({ item: updated });
  });

  app.delete('/api/admin/media/:id', requireAdmin, (req: Request, res: Response) => {
    const id = String(req.params.id);
    const deleted = deleteMediaItemRecord(id);
    if (!deleted) {
      res.status(404).json({ error: 'Media item not found.' });
      return;
    }
    const filePath = path.join(UPLOADS_DIR, path.basename(deleted.filename));
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }
    res.json({ ok: true });
  });

  // -------- CONTACT MESSAGES ROUTES --------
  app.get('/api/admin/messages', requireAdmin, (_req: Request, res: Response) => {
    res.json({ items: listContactMessages() });
  });

  app.patch('/api/admin/messages/:id', requireAdmin, (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { status, notes } = req.body as { status?: MessageStatus; notes?: string };
    const updated = updateContactMessageRecord(id, { status, notes });
    if (!updated) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    res.json({ item: updated });
  });

  app.delete('/api/admin/messages/:id', requireAdmin, (req: Request, res: Response) => {
    const id = String(req.params.id);
    const ok = deleteContactMessageRecord(id);
    if (!ok) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/admin/activity', requireAdmin, (_req: Request, res: Response) => {
    res.json({ items: listRecentActivity(150) });
  });

  // -------- PROTECTED ADMIN SECURITY & SHORTCUT ROUTES --------
  app.get('/api/admin/security', requireAdmin, (_req: Request, res: Response) => {
    res.json({
      settings: getAdminSecuritySettings(),
      publicSecurity: getPublicSecurityState(null),
    });
  });

  app.put('/api/admin/security/shortcut', requireAdmin, (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      ctrl?: boolean;
      shift?: boolean;
      alt?: boolean;
      meta?: boolean;
      key?: string;
    };
    const result = updateAdminShortcut({
      ctrl: Boolean(body.ctrl),
      shift: Boolean(body.shift),
      alt: Boolean(body.alt),
      meta: Boolean(body.meta),
      key: typeof body.key === 'string' ? body.key : '',
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      ok: true,
      settings: result.settings,
      publicSecurity: getPublicSecurityState(null),
    });
  });

  app.post('/api/admin/security/shortcut/reset', requireAdmin, (_req: Request, res: Response) => {
    const settings = resetAdminShortcut();
    res.json({
      ok: true,
      settings,
      publicSecurity: getPublicSecurityState(null),
    });
  });

  app.put('/api/admin/security/lock', requireAdmin, (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      enabled?: boolean;
      lockType?: WebsiteLockType;
      lockMessage?: string;
      newCredential?: string;
      confirmCredential?: string;
    };
    const result = updateWebsiteLockSettings({
      enabled: Boolean(body.enabled),
      lockType: body.lockType === 'pin' ? 'pin' : 'password',
      lockMessage: typeof body.lockMessage === 'string' ? body.lockMessage : '',
      newCredential: typeof body.newCredential === 'string' ? body.newCredential : undefined,
      confirmCredential: typeof body.confirmCredential === 'string' ? body.confirmCredential : undefined,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    if (result.settings.websiteLock.enabled) {
      res.clearCookie(UNLOCK_COOKIE, { path: '/' });
    }
    res.json({
      ok: true,
      settings: result.settings,
      publicSecurity: getPublicSecurityState(null),
    });
  });

  app.post('/api/admin/security/lock-now', requireAdmin, (_req: Request, res: Response) => {
    const result = setWebsiteLockActive(true);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.clearCookie(UNLOCK_COOKIE, { path: '/' });
    res.json({
      ok: true,
      settings: result.settings,
      publicSecurity: getPublicSecurityState(null),
    });
  });

  app.post('/api/admin/security/unlock-site', requireAdmin, (_req: Request, res: Response) => {
    const result = setWebsiteLockActive(false);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      ok: true,
      settings: result.settings,
      publicSecurity: getPublicSecurityState(null),
    });
  });

  app.put('/api/admin/security/session-timeout', requireAdmin, (req: Request, res: Response) => {
    const { minutes } = (req.body || {}) as { minutes?: number };
    const result = updateSessionTimeoutMinutes(Number(minutes));
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, settings: result.settings });
  });

  app.post('/api/admin/security/reset', requireAdmin, (_req: Request, res: Response) => {
    const settings = resetSecuritySettings();
    res.clearCookie(UNLOCK_COOKIE, { path: '/' });
    res.json({
      ok: true,
      settings,
      publicSecurity: getPublicSecurityState(null),
    });
  });

  // -------- VITE / STATIC SPA HOSTING --------
  if (!IS_PROD) {
    const viteModule = await import('vite');
    const vite = await viteModule.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
