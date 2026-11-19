import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock } from 'lucide-react';
import { adminApi } from '../lib/adminApi';
import type { PublicSecurityState } from '../types/cms';
import { BrandMark } from './Icons';

interface WebsiteLockScreenProps {
  security: PublicSecurityState;
  onUnlocked: () => Promise<void> | void;
}

export const WebsiteLockScreen: React.FC<WebsiteLockScreenProps> = ({
  security,
  onUnlocked,
}) => {
  const [credential, setCredential] = useState('');
  const [showCredential, setShowCredential] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const pts = Array.from({ length: 64 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.24,
      vy: (Math.random() - 0.5) * 0.24,
      size: 0.7 + Math.random() * 1.1,
      alpha: 0.12 + Math.random() * 0.28,
      phase: i * 0.72,
    }));

    let time = 0;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (document.hidden) return;
      time += 0.015;
      ctx.clearRect(0, 0, width, height);

      for (const p of pts) {
        p.x += p.vx + Math.cos(time + p.phase) * 0.07;
        p.y += p.vy + Math.sin(time + p.phase) * 0.07;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        const a = p.alpha * (0.65 + 0.35 * Math.sin(time * 1.6 + p.phase));
        ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    };

    rafId = requestAnimationFrame(tick);
    window.addEventListener('resize', resize, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const isPin = security.lockType === 'pin';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credential.trim()) {
      setError(isPin ? 'Please enter your PIN.' : 'Please enter the access password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await adminApi.unlockPublicSite(credential);
      setCredential('');
      await onUnlocked();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isPin
            ? 'Incorrect PIN. Please try again.'
            : 'Incorrect password. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center px-4 py-12 relative overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 w-full h-full"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-white/[0.03] blur-3xl"
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/15 bg-[#08080B]/90 backdrop-blur-xl px-7 py-9 sm:px-9 sm:py-10 shadow-[0_24px_80px_rgba(0,0,0,0.92)]">
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2.5 text-zinc-300 mb-6">
            <BrandMark logoUrl={security.logoUrl} className="w-5 h-5 text-white" />
            <span className="font-display text-sm font-semibold tracking-tight text-white">
              {security.siteName || 'Protected Portfolio'}
            </span>
          </div>

          <div className="w-12 h-12 rounded-full border border-white/20 bg-white/[0.04] flex items-center justify-center text-white mb-5 shadow-[0_0_24px_rgba(255,255,255,0.08)]">
            <Lock className="w-5 h-5" />
          </div>

          <div className="text-[11px] font-mono tracking-[0.24em] text-zinc-500 uppercase">
            Access Restricted
          </div>

          <p className="mt-3 text-sm sm:text-[15px] text-zinc-300 leading-relaxed max-w-sm">
            {security.lockMessage}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <div className="relative">
            <input
              type={showCredential ? 'text' : 'password'}
              inputMode={isPin ? 'numeric' : 'text'}
              pattern={isPin ? '[0-9]*' : undefined}
              autoFocus
              autoComplete="off"
              data-allow-admin-shortcut="true"
              value={credential}
              onChange={(e) => {
                const val = isPin ? e.target.value.replace(/\D+/g, '') : e.target.value;
                setCredential(val);
                if (error) setError('');
              }}
              placeholder={isPin ? 'Enter PIN' : 'Enter Access Password'}
              aria-label={isPin ? 'Website Lock PIN' : 'Website Lock Password'}
              className={`w-full pl-4 pr-11 py-3.5 rounded-xl bg-[#050507] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-white transition-colors ${
                isPin ? 'tracking-[0.28em] font-mono text-center' : ''
              }`}
            />
            <button
              type="button"
              onClick={() => setShowCredential((prev) => !prev)}
              aria-label={showCredential ? 'Hide credential' : 'Show credential'}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-500 hover:text-white transition-colors"
            >
              {showCredential ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="px-3.5 py-2.5 rounded-xl border border-white/25 bg-white/[0.04] text-center text-xs font-mono text-zinc-200"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-full bg-white text-black text-xs font-mono font-semibold tracking-[0.2em] uppercase hover:bg-zinc-200 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span>{loading ? 'VERIFYING...' : 'UNLOCK'}</span>
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </form>
      </div>
    </div>
  );
};
