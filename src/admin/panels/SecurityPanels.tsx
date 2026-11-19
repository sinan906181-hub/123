import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Keyboard,
  Lock,
  LogOut,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import {
  formatShortcutLabel,
  normalizeShortcutKey,
  validateShortcutConfig,
} from '../../lib/shortcut';
import type {
  ActivityLogItem,
  AdminSecuritySettings,
  AdminShortcutConfig,
  WebsiteLockType,
} from '../../types/cms';
import {
  CmsFieldLabel,
  CmsInput,
  CmsSelect,
  CmsTextarea,
  CmsToggle,
  DeleteConfirmModal,
} from '../components/AdminPrimitives';
import type { AdminTabId } from './DashboardPanel';

function formatSecurityTimestamp(iso: string | null): string {
  if (!iso) return 'Not modified yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SecurityOverviewStrip: React.FC<{
  security: AdminSecuritySettings;
  onNavigateTab?: (tab: AdminTabId) => void;
}> = ({ security, onNavigateTab }) => {
  const isLocked = security.websiteLock.enabled;
  const statusLabel =
    security.websiteStatus === 'LOCKED'
      ? 'Locked'
      : security.websiteStatus === 'MAINTENANCE'
        ? 'Maintenance'
        : 'Online';

  return (
    <div className="p-5 sm:p-6 rounded-2xl border border-white/10 bg-[#09090C] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-white" />
          <span className="text-xs font-mono tracking-[0.16em] text-zinc-300 uppercase">
            Security Status Overview
          </span>
        </div>
        {onNavigateTab && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateTab('website-lock')}
              className="px-3 py-1 rounded-full border border-white/15 text-[11px] font-mono text-zinc-300 hover:border-white hover:text-white transition-colors"
            >
              Website Lock
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('admin-access')}
              className="px-3 py-1 rounded-full border border-white/15 text-[11px] font-mono text-zinc-300 hover:border-white hover:text-white transition-colors"
            >
              Shortcut Settings
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl border border-white/[0.08] bg-[#050507]">
          <div className="text-[10px] font-mono tracking-[0.14em] text-zinc-500 uppercase">
            Website Status
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
            {isLocked ? (
              <Lock className="w-3.5 h-3.5 text-white shrink-0" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-white shrink-0" />
            )}
            <span>{statusLabel}</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-white/[0.08] bg-[#050507]">
          <div className="text-[10px] font-mono tracking-[0.14em] text-zinc-500 uppercase">
            Admin Security
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
            <span className="w-2 h-2 rounded-full bg-white shrink-0" />
            <span>{security.adminProtected ? 'Protected' : 'Unprotected'}</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-white/[0.08] bg-[#050507]">
          <div className="text-[10px] font-mono tracking-[0.14em] text-zinc-500 uppercase">
            Admin Shortcut
          </div>
          <div className="mt-2 text-xs font-mono font-semibold text-white truncate">
            {security.shortcut.label}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-white/[0.08] bg-[#050507]">
          <div className="text-[10px] font-mono tracking-[0.14em] text-zinc-500 uppercase">
            Website Lock
          </div>
          <div className="mt-2 text-sm font-semibold text-white">
            {security.websiteLock.enabled ? 'Enabled' : 'Disabled'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-white/[0.08] bg-[#050507]">
          <div className="text-[10px] font-mono tracking-[0.14em] text-zinc-500 uppercase">
            Last Security Change
          </div>
          <div className="mt-2 text-xs font-mono text-zinc-300 truncate">
            {formatSecurityTimestamp(security.lastSecurityChangeAt)}
          </div>
        </div>
      </div>
    </div>
  );
};

interface SecurityPanelSharedProps {
  security: AdminSecuritySettings;
  onSecurityChange: (next: AdminSecuritySettings) => void;
  onNavigateTab: (tab: AdminTabId) => void;
  onLockAdminSession: () => Promise<void> | void;
  onNotify: (text: string, kind?: 'ok' | 'err') => void;
}

export const SecurityOverviewPanel: React.FC<SecurityPanelSharedProps> = ({
  security,
  onSecurityChange,
  onNavigateTab,
  onLockAdminSession,
  onNotify,
}) => {
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(security.sessionTimeoutMinutes);
  const [savingTimeout, setSavingTimeout] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwStatus, setPwStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [busyLockToggle, setBusyLockToggle] = useState(false);

  useEffect(() => {
    setTimeoutMinutes(security.sessionTimeoutMinutes);
  }, [security.sessionTimeoutMinutes]);

  const handleSaveTimeout = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTimeout(true);
    try {
      const res = await adminApi.updateSessionTimeout(timeoutMinutes);
      onSecurityChange(res.settings);
      onNotify(`Session inactivity timeout set to ${res.settings.sessionTimeoutMinutes} minutes.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update timeout', 'err');
    } finally {
      setSavingTimeout(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwStatus(null);
    if (newPassword.length < 8) {
      setPwStatus({ kind: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwStatus({ kind: 'err', text: 'New password and confirmation do not match.' });
      return;
    }
    setPwSaving(true);
    try {
      await adminApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwStatus({ kind: 'ok', text: 'Admin password updated securely.' });
      onNotify('Admin password updated.');
    } catch (err) {
      setPwStatus({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to update password.',
      });
    } finally {
      setPwSaving(false);
    }
  };

  const handleQuickSiteLock = async (lock: boolean) => {
    setBusyLockToggle(true);
    try {
      const res = lock ? await adminApi.lockWebsiteNow() : await adminApi.unlockWebsite();
      onSecurityChange(res.settings);
      onNotify(lock ? 'Public website locked immediately.' : 'Public website unlocked.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update lock state', 'err');
    } finally {
      setBusyLockToggle(false);
    }
  };

  const handleResetAllSecurity = async () => {
    setResetConfirmOpen(false);
    try {
      const res = await adminApi.resetSecurity();
      onSecurityChange(res.settings);
      onNotify('All security, lock, and shortcut settings reset to defaults.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Reset failed', 'err');
    }
  };

  return (
    <div className="space-y-6">
      <DeleteConfirmModal
        open={resetConfirmOpen}
        title="Reset Security Settings"
        description="This will disable Website Lock, clear the custom lock password/PIN, restore the default admin shortcut, and reset session timeout to 30 minutes. Continue?"
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={handleResetAllSecurity}
      />

      <SecurityOverviewStrip security={security} onNavigateTab={onNavigateTab} />

      {/* Quick Security Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigateTab('website-lock')}
          className="p-5 rounded-2xl border border-white/10 bg-[#09090C] hover:border-white/35 text-left transition-colors space-y-2"
        >
          <Lock className="w-4 h-4 text-white" />
          <div className="font-display text-sm font-semibold text-white">Website Lock Controls</div>
          <p className="text-xs text-zinc-400">
            Configure Password/PIN protection &amp; custom lock screen message.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('admin-access')}
          className="p-5 rounded-2xl border border-white/10 bg-[#09090C] hover:border-white/35 text-left transition-colors space-y-2"
        >
          <Keyboard className="w-4 h-4 text-white" />
          <div className="font-display text-sm font-semibold text-white">Admin Shortcut</div>
          <p className="text-xs text-zinc-400">
            Active: <span className="font-mono text-zinc-200">{security.shortcut.label}</span>
          </p>
        </button>

        <button
          type="button"
          disabled={busyLockToggle}
          onClick={() => handleQuickSiteLock(!security.websiteLock.enabled)}
          className="p-5 rounded-2xl border border-white/10 bg-[#09090C] hover:border-white/35 text-left transition-colors space-y-2 disabled:opacity-50"
        >
          {security.websiteLock.enabled ? (
            <Unlock className="w-4 h-4 text-white" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-white" />
          )}
          <div className="font-display text-sm font-semibold text-white">
            {security.websiteLock.enabled ? 'Unlock Website Now' : 'Lock Website Now'}
          </div>
          <p className="text-xs text-zinc-400">
            {security.websiteLock.enabled
              ? 'Restore public access immediately.'
              : security.websiteLock.hasCredential
                ? 'Immediately restrict public access.'
                : 'Set a lock credential in Website Lock first.'}
          </p>
        </button>

        <button
          type="button"
          onClick={onLockAdminSession}
          className="p-5 rounded-2xl border border-white/10 bg-[#09090C] hover:border-white/35 text-left transition-colors space-y-2"
        >
          <LogOut className="w-4 h-4 text-white" />
          <div className="font-display text-sm font-semibold text-white">Lock Admin Session</div>
          <p className="text-xs text-zinc-400">
            Invalidate current admin session and require login again.
          </p>
        </button>
      </div>

      {/* Session Timeout + Change Admin Password */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSaveTimeout}
          className="lg:col-span-5 p-6 rounded-2xl border border-white/10 bg-[#09090C] space-y-5"
        >
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-white" />
            <h3 className="font-display text-lg font-semibold text-white">
              Admin Session Timeout
            </h3>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Automatically terminates inactive admin sessions on the server after the selected period.
          </p>

          <CmsSelect
            label="Inactivity Timeout"
            value={String(timeoutMinutes)}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
          >
            <option value="15">15 minutes (High Security)</option>
            <option value="30">30 minutes (Recommended)</option>
            <option value="60">60 minutes</option>
            <option value="120">2 hours</option>
            <option value="240">4 hours</option>
            <option value="480">8 hours</option>
          </CmsSelect>

          <button
            type="submit"
            disabled={savingTimeout}
            className="w-full py-2.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {savingTimeout ? 'Saving...' : 'Save Session Policy'}
          </button>

          <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-zinc-200">Reset All Security Settings</div>
              <div className="text-[11px] text-zinc-500">
                Restores default shortcut &amp; disables website lock.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              className="px-3.5 py-2 rounded-full border border-white/20 text-xs text-zinc-200 hover:border-white hover:text-white transition-colors shrink-0"
            >
              Reset
            </button>
          </div>
        </form>

        <form
          onSubmit={handlePasswordChange}
          className="lg:col-span-7 p-6 rounded-2xl border border-white/10 bg-[#09090C] space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-white" />
            <h3 className="font-display text-lg font-semibold text-white">
              Admin Account Password
            </h3>
          </div>
          <p className="text-xs text-zinc-400">
            Passwords are salted and hashed with scrypt on the backend. Minimum 8 characters.
          </p>

          {pwStatus && (
            <div
              role="status"
              className={`p-3 rounded-xl border text-xs ${
                pwStatus.kind === 'ok'
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-white/25 bg-white/5 text-zinc-200'
              }`}
            >
              {pwStatus.text}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <CmsInput
              label="Current Password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <CmsInput
              label="New Password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <CmsInput
              label="Confirm Password"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={pwSaving}
              className="px-6 py-2.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {pwSaving ? 'Updating...' : 'Update Admin Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const WebsiteLockPanel: React.FC<{
  security: AdminSecuritySettings;
  onSecurityChange: (next: AdminSecuritySettings) => void;
  onLockAdminSession: () => Promise<void> | void;
  onNotify: (text: string, kind?: 'ok' | 'err') => void;
}> = ({ security, onSecurityChange, onLockAdminSession, onNotify }) => {
  const [enabled, setEnabled] = useState(security.websiteLock.enabled);
  const [lockType, setLockType] = useState<WebsiteLockType>(security.websiteLock.lockType);
  const [lockMessage, setLockMessage] = useState(security.websiteLock.lockMessage);
  const [newCredential, setNewCredential] = useState('');
  const [confirmCredential, setConfirmCredential] = useState('');
  const [showCred, setShowCred] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resetModalOpen, setResetModalOpen] = useState(false);

  useEffect(() => {
    setEnabled(security.websiteLock.enabled);
    setLockType(security.websiteLock.lockType);
    setLockMessage(security.websiteLock.lockMessage);
  }, [security]);

  const isPin = lockType === 'pin';

  const validateDraftLockInputs = (targetEnabled: boolean): string | null => {
    if (newCredential || confirmCredential) {
      if (newCredential !== confirmCredential) {
        return 'New password/PIN and confirmation do not match.';
      }
      if (isPin && !/^\d{4,12}$/.test(newCredential)) {
        return 'PIN must be 4 to 12 numeric digits (0–9).';
      }
      if (!isPin && newCredential.length < 4) {
        return 'Lock password must be at least 4 characters.';
      }
    } else if (lockType !== security.websiteLock.lockType && security.websiteLock.hasCredential) {
      return `Enter and confirm a new ${isPin ? 'PIN' : 'password'} when switching lock type.`;
    } else if (targetEnabled && !security.websiteLock.hasCredential) {
      return `Set and confirm a ${isPin ? 'PIN' : 'password'} before enabling Website Lock.`;
    }
    return null;
  };

  const handleSaveSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const validationError = validateDraftLockInputs(enabled);
    if (validationError) {
      setError(validationError);
      onNotify(validationError, 'err');
      return;
    }

    setSaving(true);
    try {
      const res = await adminApi.updateWebsiteLock({
        enabled,
        lockType,
        lockMessage,
        newCredential: newCredential || undefined,
        confirmCredential: confirmCredential || undefined,
      });
      onSecurityChange(res.settings);
      setNewCredential('');
      setConfirmCredential('');
      onNotify('Website security settings saved.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save security settings.';
      setError(msg);
      onNotify(msg, 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleLockNow = async () => {
    setError('');
    const hasPendingEdits =
      Boolean(newCredential || confirmCredential) ||
      lockType !== security.websiteLock.lockType ||
      lockMessage !== security.websiteLock.lockMessage;

    if (hasPendingEdits) {
      const validationError = validateDraftLockInputs(true);
      if (validationError) {
        setError(validationError);
        onNotify(validationError, 'err');
        return;
      }
    }

    setSaving(true);
    try {
      const res = hasPendingEdits
        ? await adminApi.updateWebsiteLock({
            enabled: true,
            lockType,
            lockMessage,
            newCredential: newCredential || undefined,
            confirmCredential: confirmCredential || undefined,
          })
        : await adminApi.lockWebsiteNow();
      onSecurityChange(res.settings);
      setNewCredential('');
      setConfirmCredential('');
      onNotify('Website locked immediately. Public visitors now see the lock screen.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to lock website.';
      setError(msg);
      onNotify(msg, 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlockNow = async () => {
    setError('');
    setSaving(true);
    try {
      const res = await adminApi.unlockWebsite();
      onSecurityChange(res.settings);
      onNotify('Website unlocked. Public visitors can now access the site.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to unlock website.';
      setError(msg);
      onNotify(msg, 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetModalOpen(false);
    setSaving(true);
    try {
      const res = await adminApi.resetSecurity();
      onSecurityChange(res.settings);
      setNewCredential('');
      setConfirmCredential('');
      setError('');
      onNotify('Security settings reset to default.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Reset failed', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <DeleteConfirmModal
        open={resetModalOpen}
        title="Reset Security Settings"
        description="Disable Website Lock, clear the configured lock password/PIN, and restore default security settings?"
        onCancel={() => setResetModalOpen(false)}
        onConfirm={handleReset}
      />

      <SecurityOverviewStrip security={security} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSaveSecuritySettings}
          className="lg:col-span-7 p-6 rounded-2xl border border-white/10 bg-[#09090C] space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">Website Lock</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Server-enforced protection that withholds public portfolio data until unlocked.
              </p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-[11px] font-mono border ${
                security.websiteLock.enabled
                  ? 'border-white text-white bg-white/10'
                  : 'border-white/15 text-zinc-400'
              }`}
            >
              {security.websiteLock.enabled ? 'LOCKED' : 'ONLINE'}
            </span>
          </div>

          <CmsToggle
            label="Website Lock (ON / OFF)"
            description={
              security.websiteLock.hasCredential
                ? 'Require visitors to authenticate before viewing the public website.'
                : 'Set a password or PIN below before enabling Website Lock.'
            }
            checked={enabled}
            onChange={setEnabled}
          />

          <div>
            <CmsFieldLabel label="Lock Type" hint="Password or Numeric PIN" />
            <div className="grid grid-cols-2 gap-2.5">
              {(['password', 'pin'] as WebsiteLockType[]).map((kind) => {
                const active = lockType === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      setLockType(kind);
                      setNewCredential('');
                      setConfirmCredential('');
                      setError('');
                    }}
                    className={`py-2.5 px-4 rounded-xl border text-xs font-mono uppercase tracking-[0.14em] transition-colors ${
                      active
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-[#070709] text-zinc-400 border-white/15 hover:text-white'
                    }`}
                  >
                    {kind === 'password' ? 'Password' : 'PIN (Digits)'}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative">
              <CmsInput
                label={isPin ? 'Change PIN (4–12 digits)' : 'Change Password'}
                hint={security.websiteLock.hasCredential ? 'Optional to keep current' : 'Required'}
                type={showCred ? 'text' : 'password'}
                inputMode={isPin ? 'numeric' : 'text'}
                autoComplete="new-password"
                value={newCredential}
                onChange={(e) => {
                  const val = isPin ? e.target.value.replace(/\D+/g, '') : e.target.value;
                  setNewCredential(val);
                  if (error) setError('');
                }}
                placeholder={isPin ? '••••' : '••••••••'}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCred((prev) => !prev)}
                aria-label={showCred ? 'Hide credential' : 'Show credential'}
                className="absolute right-3 bottom-2.5 p-1 text-zinc-500 hover:text-white"
              >
                {showCred ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <CmsInput
              label={isPin ? 'Confirm PIN' : 'Confirm Password'}
              type={showCred ? 'text' : 'password'}
              inputMode={isPin ? 'numeric' : 'text'}
              autoComplete="new-password"
              value={confirmCredential}
              onChange={(e) => {
                const val = isPin ? e.target.value.replace(/\D+/g, '') : e.target.value;
                setConfirmCredential(val);
                if (error) setError('');
              }}
              placeholder={isPin ? '••••' : '••••••••'}
            />
          </div>

          <CmsTextarea
            label="Lock Screen Message"
            hint={`${lockMessage.length}/280`}
            maxLength={280}
            rows={3}
            value={lockMessage}
            onChange={(e) => setLockMessage(e.target.value)}
            placeholder="Enter custom message displayed on the lock screen"
          />

          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl border border-white/25 bg-white/[0.04] text-xs text-zinc-200"
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Security Settings'}</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleLockNow}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/20 text-xs font-medium text-white hover:border-white transition-colors disabled:opacity-50"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock Website Now</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleUnlockNow}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/20 text-xs font-medium text-zinc-200 hover:border-white hover:text-white transition-colors disabled:opacity-50"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Unlock Website</span>
            </button>
          </div>

          <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setResetModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Security Settings</span>
            </button>

            <button
              type="button"
              onClick={onLockAdminSession}
              className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-white transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Lock Admin Session</span>
            </button>
          </div>
        </form>

        {/* Live Lock Screen Preview */}
        <div className="lg:col-span-5 p-6 rounded-2xl border border-white/10 bg-[#09090C] flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono tracking-[0.16em] text-zinc-500 uppercase">
              Lock Screen Preview
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              {isPin ? 'NUMERIC PIN' : 'PASSWORD'}
            </span>
          </div>

          <div className="flex-1 flex items-center justify-center p-6 rounded-2xl border border-white/10 bg-[#050505]">
            <div className="w-full max-w-xs text-center space-y-4">
              <div className="w-11 h-11 rounded-full border border-white/20 bg-white/[0.04] flex items-center justify-center mx-auto text-white">
                <Lock className="w-4 h-4" />
              </div>
              <div className="text-[10px] font-mono tracking-[0.22em] text-zinc-500 uppercase">
                Access Restricted
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                {lockMessage.trim() ||
                  'This website is protected. Enter the access credential to continue.'}
              </p>
              <div className="px-4 py-2.5 rounded-xl border border-white/15 bg-[#08080B] text-xs font-mono text-zinc-500">
                {isPin ? 'Enter PIN (••••)' : 'Enter Access Password'}
              </div>
              <div className="py-2 rounded-full bg-white text-black text-[11px] font-mono font-semibold tracking-[0.18em]">
                UNLOCK →
              </div>
            </div>
          </div>

          <div className="text-[11px] text-zinc-500 leading-relaxed">
            Credential Status:{' '}
            <span className="text-zinc-200 font-medium">
              {security.websiteLock.hasCredential
                ? 'Hashed & stored securely on backend'
                : 'Not configured yet'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const KEY_OPTIONS: string[] = [
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split(''),
  'f2',
  'f3',
  'f4',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
];

export const AdminAccessShortcutPanel: React.FC<{
  security: AdminSecuritySettings;
  onSecurityChange: (next: AdminSecuritySettings) => void;
  onNavigateTab: (tab: AdminTabId) => void;
  onNotify: (text: string, kind?: 'ok' | 'err') => void;
}> = ({ security, onSecurityChange, onNavigateTab, onNotify }) => {
  const [draftShortcut, setDraftShortcut] = useState<AdminShortcutConfig>(security.shortcut);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftShortcut(security.shortcut);
  }, [security.shortcut]);

  const validation = useMemo(
    () =>
      validateShortcutConfig({
        ctrl: draftShortcut.ctrl,
        shift: draftShortcut.shift,
        alt: draftShortcut.alt,
        meta: draftShortcut.meta,
        key: draftShortcut.key,
      }),
    [draftShortcut]
  );

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        setRecording(false);
        return;
      }

      const normalized = normalizeShortcutKey(e.key, e.code);
      if (!normalized) return;

      const next: AdminShortcutConfig = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
        key: normalized,
        label: formatShortcutLabel({
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
          key: normalized,
        }),
      };
      setDraftShortcut(next);
      setRecording(false);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  const updateModifier = (mod: 'ctrl' | 'alt' | 'shift' | 'meta') => {
    setDraftShortcut((prev) => {
      const next = { ...prev, [mod]: !prev[mod] };
      return { ...next, label: formatShortcutLabel(next) };
    });
  };

  const handleSaveShortcut = async () => {
    if (!validation.ok) {
      onNotify(validation.error, 'err');
      return;
    }
    setSaving(true);
    try {
      const res = await adminApi.updateShortcut(validation.shortcut);
      onSecurityChange(res.settings);
      onNotify(`Admin shortcut updated to ${res.settings.shortcut.label} (active immediately).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save shortcut', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefault = async () => {
    setSaving(true);
    try {
      const res = await adminApi.resetShortcut();
      onSecurityChange(res.settings);
      setDraftShortcut(res.settings.shortcut);
      onNotify(`Shortcut reset to default (${res.settings.shortcut.label}).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to reset shortcut', 'err');
    } finally {
      setSaving(false);
    }
  };

  const renderKeycaps = (cfg: AdminShortcutConfig) => {
    const tokens: string[] = [];
    if (cfg.ctrl) tokens.push('Ctrl');
    if (cfg.alt) tokens.push('Alt');
    if (cfg.shift) tokens.push('Shift');
    if (cfg.meta) tokens.push('Meta');
    if (cfg.key) tokens.push(cfg.key.toUpperCase());

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {tokens.map((tok, i) => (
          <React.Fragment key={`${tok}-${i}`}>
            <kbd className="px-2.5 py-1 rounded-lg border border-white/25 bg-[#050507] text-xs font-mono font-semibold text-white shadow-inner">
              {tok}
            </kbd>
            {i < tokens.length - 1 && <span className="text-zinc-500 text-xs">+</span>}
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <SecurityOverviewStrip security={security} onNavigateTab={onNavigateTab} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 p-6 rounded-2xl border border-white/10 bg-[#09090C] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-mono tracking-[0.16em] text-zinc-500 uppercase">
                Settings → Admin Access → Shortcut
              </div>
              <h3 className="font-display text-lg font-semibold text-white mt-1">
                Admin Portal Keyboard Shortcut
              </h3>
            </div>
            <Keyboard className="w-5 h-5 text-zinc-400" />
          </div>

          <div className="p-4 rounded-xl border border-white/10 bg-[#050507] flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-mono text-zinc-500 uppercase">
                Currently Active Shortcut
              </div>
              <div className="mt-2">{renderKeycaps(security.shortcut)}</div>
            </div>
            <span className="text-[11px] font-mono text-zinc-400">
              Default: {security.defaultShortcutLabel}
            </span>
          </div>

          {/* Interactive Recorder */}
          <div className="space-y-2.5">
            <CmsFieldLabel
              label="Capture New Shortcut"
              hint="Click button & press your key combo"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setRecording((prev) => !prev)}
                className={`px-5 py-2.5 rounded-xl border text-xs font-mono tracking-[0.1em] uppercase transition-colors ${
                  recording
                    ? 'bg-white text-black border-white font-semibold animate-pulse'
                    : 'bg-[#050507] text-white border-white/20 hover:border-white'
                }`}
              >
                {recording ? 'Press Keys Now (Esc to cancel)...' : 'Record Keyboard Shortcut'}
              </button>
              {renderKeycaps(draftShortcut)}
            </div>
          </div>

          {/* Manual Modifier & Key Selector (works cleanly on mobile/touch too) */}
          <div className="p-4 rounded-xl border border-white/10 bg-[#070709] space-y-4">
            <div className="text-[11px] font-mono text-zinc-400 uppercase">
              Or Configure Combination Manually
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'ctrl', label: 'Ctrl' },
                  { id: 'alt', label: 'Alt' },
                  { id: 'shift', label: 'Shift' },
                  { id: 'meta', label: 'Meta / Cmd' },
                ] as const
              ).map((mod) => {
                const active = draftShortcut[mod.id];
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => updateModifier(mod.id)}
                    className={`px-3.5 py-2 rounded-xl border text-xs font-mono transition-colors ${
                      active
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-[#050507] text-zinc-400 border-white/15 hover:text-white'
                    }`}
                  >
                    {mod.label}
                  </button>
                );
              })}

              <select
                aria-label="Shortcut Primary Key"
                value={draftShortcut.key}
                onChange={(e) => {
                  const key = e.target.value;
                  setDraftShortcut((prev) => ({
                    ...prev,
                    key,
                    label: formatShortcutLabel({ ...prev, key }),
                  }));
                }}
                className="px-3.5 py-2 rounded-xl bg-[#050507] border border-white/15 text-xs font-mono text-white uppercase focus:outline-none focus:border-white"
              >
                {KEY_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!validation.ok && (
            <div
              role="alert"
              className="p-3 rounded-xl border border-white/25 bg-white/[0.04] text-xs text-zinc-200"
            >
              {validation.error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={saving || !validation.ok}
              onClick={handleSaveShortcut}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save New Shortcut'}</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleResetDefault}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/20 text-xs font-medium text-zinc-200 hover:border-white hover:text-white transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to Default ({security.defaultShortcutLabel})</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 p-6 rounded-2xl border border-white/10 bg-[#09090C] space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-white" />
            <h3 className="font-display text-base font-semibold text-white">
              Access Protection Rules
            </h3>
          </div>
          <ul className="space-y-3 text-xs text-zinc-400 leading-relaxed">
            <li className="p-3 rounded-xl border border-white/[0.08] bg-[#050507]">
              <span className="text-white font-medium block mb-0.5">Hidden From Public Site</span>
              No Admin link or shortcut hint is rendered on the public website. Public clients verify
              the shortcut against a server-issued HMAC digest without exposing plaintext keys.
            </li>
            <li className="p-3 rounded-xl border border-white/[0.08] bg-[#050507]">
              <span className="text-white font-medium block mb-0.5">Immediate Activation</span>
              Saving a new shortcut updates the backend database and immediately activates across open
              tabs without needing a page refresh.
            </li>
            <li className="p-3 rounded-xl border border-white/[0.08] bg-[#050507]">
              <span className="text-white font-medium block mb-0.5">Browser Conflict Guard</span>
              Reserved combinations like Ctrl+T, Ctrl+W, Ctrl+R, Ctrl+C, Ctrl+V, and bare typing
              keys are rejected automatically.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

type LogCategory = 'ALL' | 'SECURITY' | 'AUTH' | 'CONTENT';

const SECURITY_ACTIONS = new Set([
  'WEBSITE_LOCKED',
  'WEBSITE_UNLOCKED',
  'LOCK_SETTINGS_UPDATED',
  'SHORTCUT_UPDATED',
  'SHORTCUT_RESET',
  'SECURITY_RESET',
  'SESSION_TIMEOUT_UPDATED',
  'SITE_UNLOCK_SUCCESS',
  'SITE_UNLOCK_FAILED',
  'SITE_UNLOCK_RATE_LIMITED',
]);

const AUTH_ACTIONS = new Set([
  'ADMIN_LOGIN',
  'ADMIN_LOGIN_FAILED',
  'AUTH_RATE_LIMITED',
  'ADMIN_LOGOUT',
  'PASSWORD_CHANGED',
  'ADMIN_CREATED',
]);

export const SecurityActivityLogsPanel: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<LogCategory>('ALL');
  const [query, setQuery] = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listActivity();
      setLogs(res.items);
    } catch {
      // Ignore transient errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((item) => {
      if (category === 'SECURITY' && !SECURITY_ACTIONS.has(item.action)) return false;
      if (category === 'AUTH' && !AUTH_ACTIONS.has(item.action)) return false;
      if (
        category === 'CONTENT' &&
        (SECURITY_ACTIONS.has(item.action) || AUTH_ACTIONS.has(item.action))
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.action.toLowerCase().includes(q) ||
        item.target.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q)
      );
    });
  }, [category, logs, query]);

  return (
    <div className="p-6 rounded-2xl border border-white/10 bg-[#09090C] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-white" />
          <h3 className="font-display text-lg font-semibold text-white">
            Activity &amp; Security Logs
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter logs..."
            className="px-3.5 py-2 rounded-xl bg-[#050507] border border-white/15 text-xs text-white focus:outline-none focus:border-white"
          />
          <button
            type="button"
            onClick={loadLogs}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/15 text-xs text-zinc-300 hover:border-white hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'ALL', label: 'All Events' },
            { id: 'SECURITY', label: 'Security & Website Lock' },
            { id: 'AUTH', label: 'Authentication & Rate Limits' },
            { id: 'CONTENT', label: 'CMS & Content' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCategory(tab.id)}
            className={`px-3.5 py-1.5 rounded-full border text-xs font-mono transition-colors ${
              category === tab.id
                ? 'bg-white text-black border-white font-semibold'
                : 'border-white/15 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-xs text-zinc-500 border border-dashed border-white/10 rounded-xl">
          {loading ? 'Loading logs...' : 'No matching activity records found.'}
        </div>
      ) : (
        <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
          {filtered.map((log) => (
            <div
              key={log.id}
              className="p-3.5 rounded-xl border border-white/[0.08] bg-[#050507] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md border border-white/15 bg-white/[0.04] font-mono text-[10px] text-white">
                    {log.action}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-400">{log.target}</span>
                </div>
                <div className="text-zinc-200">{log.detail}</div>
              </div>
              <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                {new Date(log.createdAt).toLocaleString([], {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
