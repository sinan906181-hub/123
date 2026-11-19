import type { AdminShortcutConfig } from '../types/cms';

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'altgraph']);

const RESERVED_SYSTEM_COMBOS = new Set([
  // Standard clipboard / editing / undo
  'ctrl+a',
  'ctrl+c',
  'ctrl+v',
  'ctrl+x',
  'ctrl+z',
  'ctrl+y',
  // Browser navigation / tab / window controls
  'ctrl+t',
  'ctrl+w',
  'ctrl+n',
  'ctrl+r',
  'ctrl+f',
  'ctrl+p',
  'ctrl+s',
  'ctrl+l',
  'ctrl+h',
  'ctrl+j',
  'ctrl+k',
  'ctrl+d',
  'ctrl+u',
  'ctrl+o',
  'ctrl+g',
  'ctrl+e',
  'ctrl+tab',
  'ctrl+shift+t',
  'ctrl+shift+w',
  'ctrl+shift+n',
  'ctrl+shift+r',
  'ctrl+shift+i',
  'ctrl+shift+j',
  'ctrl+shift+c',
  'ctrl+shift+delete',
  'alt+f4',
  'alt+tab',
  'meta+q',
  'meta+w',
  'meta+t',
  'meta+n',
  'meta+r',
  'meta+c',
  'meta+v',
  'meta+x',
  'meta+a',
  'meta+z',
  'meta+s',
  'meta+l',
  'meta+tab',
]);

const RESERVED_BARE_KEYS = new Set([
  'escape',
  'tab',
  'enter',
  'backspace',
  'delete',
  'capslock',
  'f1',
  'f5',
  'f11',
  'f12',
]);

export function normalizeShortcutKey(rawKey: string, code?: string): string {
  const lower = (rawKey || '').trim().toLowerCase();
  if (MODIFIER_KEYS.has(lower)) return '';

  // Handle e.code for shifted symbols or layout-independent letter/digit keys (e.g., KeyS, Digit4)
  if (code) {
    if (/^Key[A-Z]$/.test(code)) {
      return code.slice(3).toLowerCase();
    }
    if (/^Digit[0-9]$/.test(code)) {
      return code.slice(5);
    }
  }

  if (/^[a-z0-9]$/.test(lower)) return lower;
  if (/^f([1-9]|1[0-2])$/.test(lower)) return lower;
  return '';
}

export function formatShortcutLabel(cfg: {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}): string {
  const parts: string[] = [];
  if (cfg.ctrl) parts.push('Ctrl');
  if (cfg.alt) parts.push('Alt');
  if (cfg.shift) parts.push('Shift');
  if (cfg.meta) parts.push('Meta');
  parts.push(cfg.key.toUpperCase());
  return parts.join(' + ');
}

export function serializeCanonicalShortcut(cfg: {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}): string {
  const k = normalizeShortcutKey(cfg.key);
  return `ctrl:${cfg.ctrl ? 1 : 0}|alt:${cfg.alt ? 1 : 0}|shift:${cfg.shift ? 1 : 0}|meta:${cfg.meta ? 1 : 0}|key:${k}`;
}

export function validateShortcutConfig(input: {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}): { ok: true; shortcut: AdminShortcutConfig } | { ok: false; error: string } {
  const ctrl = Boolean(input.ctrl);
  const shift = Boolean(input.shift);
  const alt = Boolean(input.alt);
  const meta = Boolean(input.meta);
  const key = normalizeShortcutKey(input.key);

  if (!key) {
    return {
      ok: false,
      error: 'Choose a letter (A–Z), number (0–9), or function key (F2–F10).',
    };
  }

  if (RESERVED_BARE_KEYS.has(key)) {
    return {
      ok: false,
      error: `${key.toUpperCase()} is reserved by the browser or system.`,
    };
  }

  if (!ctrl && !alt && !meta) {
    return {
      ok: false,
      error: 'Include Ctrl, Alt, or Meta modifier so normal typing is not disrupted.',
    };
  }

  const comboParts: string[] = [];
  if (ctrl) comboParts.push('ctrl');
  if (alt) comboParts.push('alt');
  if (shift) comboParts.push('shift');
  if (meta) comboParts.push('meta');
  comboParts.push(key);
  const combo = comboParts.join('+');

  if (RESERVED_SYSTEM_COMBOS.has(combo)) {
    return {
      ok: false,
      error: `${formatShortcutLabel({ ctrl, shift, alt, meta, key })} conflicts with a common browser or OS shortcut.`,
    };
  }

  return {
    ok: true,
    shortcut: {
      ctrl,
      shift,
      alt,
      meta,
      key,
      label: formatShortcutLabel({ ctrl, shift, alt, meta, key }),
    },
  };
}
