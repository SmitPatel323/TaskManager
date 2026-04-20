'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSocket } from '../../providers/SocketProvider';
import { videocallsApi } from '../../../src/api/videocalls.api';

/* ─── GSAP ─── */
let gsap: any = null;
if (typeof window !== 'undefined') {
  import('gsap').then((mod) => { gsap = mod.gsap ?? mod.default ?? mod; });
}

interface IncomingCall {
  callId: string;
  channelId: string;
  channelName: string;
  roomName: string;
  initiator: { id: string; name: string };
  startedAt: string;
  type: 'voice' | 'video';
  recordingEnabled?: boolean;
}

function getInitials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_BG = ['#4338CA', '#0369A1', '#047857', '#B45309', '#7C3AED', '#B91C1C'];
function avatarBg(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_BG[Math.abs(h) % AVATAR_BG.length];
}

/* ────────────────────────────────────────────────────────────────── */
/*  GLOBAL INCOMING CALL BANNER                                       */
/* ────────────────────────────────────────────────────────────────── */
export function GlobalIncomingCallBanner() {
  const { socket, isConnected } = useSocket();
  const router = useRouter();
  const pathname = usePathname();
  const [calls, setCalls] = useState<IncomingCall[]>([]);
  const dismissTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const dismiss = useCallback((channelId: string) => {
    setCalls(prev => prev.filter(c => c.channelId !== channelId));
    if (dismissTimers.current[channelId]) {
      clearTimeout(dismissTimers.current[channelId]);
      delete dismissTimers.current[channelId];
    }
  }, []);

  const handleJoin = useCallback((call: IncomingCall) => {
    dismiss(call.channelId);
    router.push(`/dashboard/channels/${call.channelId}?openCall=1`);
  }, [dismiss, router]);

  // Fetch all active calls on mount for persistence across refreshes
  useEffect(() => {
    if (!isConnected) return;

    const fetchActiveCalls = async () => {
      try {
        const activeCalls = await videocallsApi.getActiveCalls();

        // Get current user ID to avoid showing banner for own calls
        let currentUserId = null;
        try {
          const userJson = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
          if (userJson) {
            currentUserId = JSON.parse(userJson).userId;
          }
        } catch (e) {}

        const formatted = activeCalls
          .filter(ac => !currentUserId || ac.initiator.id !== currentUserId)
          .map(ac => ({
            callId: '', // Placeholder as we join by channel/room mainly
            channelId: ac.channelId,
            channelName: ac.channelName,
            roomName: ac.roomName,
            initiator: ac.initiator,
            startedAt: ac.startedAt,
            type: ac.type || 'video',
          }));

        setCalls(prev => {
          // Merge with existing calls from socket events, avoiding duplicates
          const existingIds = new Set(prev.map(c => c.channelId));
          const newCalls = formatted.filter(ac => !existingIds.has(ac.channelId));
          return [...prev, ...newCalls];
        });
      } catch (err) {
        console.error('❌ Failed to fetch active calls on mount:', err);
      }
    };

    fetchActiveCalls();
  }, [isConnected]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleCallStarted = (data: {
      callId: string;
      channelId: string;
      roomName: string;
      initiator: { id: string; name: string };
      startedAt: string;
      type: 'voice' | 'video';
      recordingEnabled?: boolean;
    }) => {
      let currentUserId = null;
      try {
        const userJson = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
        if (userJson) currentUserId = JSON.parse(userJson).userId;
      } catch (_) {}
      if (currentUserId && data.initiator.id === currentUserId) return;

      setCalls(prev => {
        if (prev.some(c => c.channelId === data.channelId)) return prev;
        const channelName = data.channelId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const newCall: IncomingCall = {
          callId: data.callId,
          channelId: data.channelId,
          channelName,
          roomName: data.roomName,
          initiator: data.initiator,
          startedAt: data.startedAt,
          type: data.type || 'video',
          recordingEnabled: data.recordingEnabled,
        };
        dismissTimers.current[data.channelId] = setTimeout(() => {
          setCalls(p => p.filter(c => c.channelId !== data.channelId));
          delete dismissTimers.current[data.channelId];
        }, 30000);
        return [...prev, newCall];
      });
    };

    const handleCallEnded = (data: { channelId: string }) => dismiss(data.channelId);

    socket.on('channel:call-started', handleCallStarted);
    socket.on('channel:call-ended', handleCallEnded);
    return () => {
      socket.off('channel:call-started', handleCallStarted);
      socket.off('channel:call-ended', handleCallEnded);
    };
  }, [socket, isConnected, dismiss]);

  useEffect(() => {
    const timers = dismissTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  // Extract current channel from pathname (e.g., /dashboard/channels/general -> general)
  const currentChannelId = pathname?.split('/').pop()?.toLowerCase() || '';

  // Filter calls to only show the one for the current channel
  const filteredCalls = calls.filter((c) => c.channelId.toLowerCase() === currentChannelId);

  if (filteredCalls.length === 0) return null;

  return (
    <>
      <style>{bannerStyles}</style>
      <div className="vcb-stack">
        {calls.map(call => (
          <CallNotification
            key={call.channelId}
            call={call}
            onJoin={() => handleJoin(call)}
            onDismiss={() => dismiss(call.channelId)}
          />
        ))}
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  SINGLE NOTIFICATION CARD                                          */
/* ────────────────────────────────────────────────────────────────── */
function CallNotification({
  call,
  onJoin,
  onDismiss,
}: {
  call: IncomingCall;
  onJoin: () => void;
  onDismiss: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(100);

  /* GSAP slide-in */
  useEffect(() => {
    if (!cardRef.current || !gsap) return;
    gsap.fromTo(cardRef.current,
      { opacity: 0, x: 60, scale: 0.95 },
      { opacity: 1, x: 0, scale: 1, duration: 0.32, ease: 'power2.out' }
    );
  }, []);

  /* Countdown progress (30s) */
  useEffect(() => {
    const totalMs = 30000;
    const steps = 150;
    const stepMs = totalMs / steps;
    let remaining = steps;
    const t = setInterval(() => {
      remaining--;
      setProgress((remaining / steps) * 100);
      if (remaining <= 0) clearInterval(t);
    }, stepMs);
    return () => clearInterval(t);
  }, []);

  const initials = getInitials(call.initiator.name);
  const bg = avatarBg(call.initiator.name);

  return (
    <div ref={cardRef} className="vcb-card">
      {/* Countdown progress line */}
      <div className="vcb-progress-bar">
        <div className="vcb-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Main content */}
      <div className="vcb-row">
        {/* Avatar */}
        <div className="vcb-avatar" style={{ background: bg }}>
          {initials}
        </div>

        {/* Info */}
        <div className="vcb-info">
          <p className="vcb-label">Incoming call</p>
          <p className="vcb-name">{call.initiator.name}</p>
          <p className="vcb-channel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 11, height: 11, flexShrink: 0 }}>
              <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
            </svg>
            {call.channelName}
          </p>
        </div>

        {/* Dismiss ✕ */}
        <button className="vcb-x" onClick={onDismiss} title="Dismiss">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 12, height: 12 }}>
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Actions */}
      <div className="vcb-actions">
        <button className="vcb-btn vcb-btn--decline" onClick={onDismiss}>
          Decline
        </button>
        <button className="vcb-btn vcb-btn--join" onClick={onJoin}>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 13, height: 13 }}>
            <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
          Join Call
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  STYLES — match app design system                                  */
/* ────────────────────────────────────────────────────────────────── */
const bannerStyles = `
.vcb-stack {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
  font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 13px;
}

/* ── Card — matches the app's toast style ── */
.vcb-card {
  pointer-events: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 14px 12px;
  width: 300px;
  background: var(--bg-canvas);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft-lg);
  overflow: hidden;
  /* matches app's animate-toast-in */
  animation: vcb-toast-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes vcb-toast-in {
  from { opacity: 0; transform: translateX(20px) scale(0.96); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}

/* ── Progress bar ── */
.vcb-progress-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--bg-surface-2);
}
.vcb-progress-fill {
  height: 100%;
  background: var(--ck-blue);
  transition: width 0.2s linear;
  border-radius: 0 1px 1px 0;
}

/* ── Row ── */
.vcb-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 4px;
}

/* ── Avatar ── */
.vcb-avatar {
  width: 38px; height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.02em;
}

/* ── Info ── */
.vcb-info {
  flex: 1;
  min-width: 0;
}
.vcb-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ck-blue);
  margin: 0 0 2px;
}
.vcb-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vcb-channel {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0;
  font-weight: 500;
}

/* ── Dismiss button ── */
.vcb-x {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.vcb-x:hover { color: var(--text-primary); background: var(--bg-surface-2); }

/* ── Action buttons ── */
.vcb-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}
.vcb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1;
}

.vcb-btn--decline {
  background: var(--bg-surface-2);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}
.vcb-btn--decline:hover {
  background: rgba(224, 58, 58, 0.08);
  border-color: rgba(224, 58, 58, 0.25);
  color: var(--status-error);
}

.vcb-btn--join {
  background: var(--ck-blue);
  border: 1px solid transparent;
  color: #fff;
}
.vcb-btn--join:hover { opacity: 0.88; }
.vcb-btn--join:active { transform: scale(0.97); }
`;
