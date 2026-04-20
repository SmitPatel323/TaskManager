'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { videocallsApi } from '../../../src/api/videocalls.api';
import { useSocket } from '../../providers/SocketProvider';
import axios from 'axios';

/* ─── GSAP ─── */
let gsap: any = null;
if (typeof window !== 'undefined') {
  import('gsap').then((mod) => { gsap = mod.gsap ?? mod.default ?? mod; });
}

/* ─── Types ─── */
interface ChannelCallPromptProps {
  channelId: string;
  channelName: string;
  callType?: 'voice' | 'video';
  onStartCall: (token: string, url: string, roomName: string, callId?: string) => void;
  onJoinCall: (token: string, url: string, roomName: string, callId?: string) => void;
  theme?: 'dark' | 'light';
  autoJoin?: boolean;
}

/* ─── Avatar ─── */
const AVATAR_BG = ['#4338CA', '#0369A1', '#047857', '#B45309', '#7C3AED', '#B91C1C'];
function avatarBg(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_BG[Math.abs(h) % AVATAR_BG.length];
}

function MiniAvatar({ name, size = 26 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: avatarBg(name),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600, color: '#fff',
      flexShrink: 0, letterSpacing: '0.02em',
      border: '2px solid var(--bg-canvas)',
    }}>
      {initials}
    </div>
  );
}

function AvatarStack({ names, max = 5 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const overflow = names.length - max;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((name, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: shown.length - i }}>
          <MiniAvatar name={name} size={26} />
        </div>
      ))}
      {overflow > 0 && (
        <div style={{
          marginLeft: -8, width: 26, height: 26, borderRadius: '50%',
          background: 'var(--bg-surface-3)',
          border: '2px solid var(--bg-canvas)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)',
        }}>+{overflow}</div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  MAIN COMPONENT                                                    */
/* ────────────────────────────────────────────────────────────────── */
export function ChannelCallPrompt({
  channelId,
  channelName,
  callType = 'video',
  onStartCall,
  onJoinCall,
  theme = 'dark',
  autoJoin = false,
}: ChannelCallPromptProps) {
  const [hasActiveCall, setHasActiveCall] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeParticipants, setActiveParticipants] = useState<string[]>([]);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const hasAutoJoined = useRef(false);
  const { socket, isConnected } = useSocket();

  /* ── Entrance animation ── */
  useEffect(() => {
    if (!cardRef.current || !gsap) return;
    gsap.fromTo(cardRef.current,
      { opacity: 0, y: 16, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'power2.out' }
    );
  }, []);

  /* ── Poll ── */
  useEffect(() => {
    checkForActiveCall();
    const interval = setInterval(checkForActiveCall, 5000);
    return () => clearInterval(interval);
  }, [channelId]);

  /* ── Socket ── */
  useEffect(() => {
    if (!socket || !isConnected) return;
    socket.emit('join_channel', channelId);
    const onStarted = (d: any) => { if (d.channelId === channelId) checkForActiveCall(); };
    const onEnded   = (d: any) => { if (d.channelId === channelId) { setHasActiveCall(false); setActiveParticipants([]); setTimeout(checkForActiveCall, 500); } };
    const onJoined  = (d: any) => { if (d.channelId === channelId) checkForActiveCall(); };
    const onLeft    = (d: any) => { if (d.channelId === channelId) { checkForActiveCall(); setTimeout(checkForActiveCall, 100); } };
    socket.on('channel:call-started', onStarted);
    socket.on('channel:call-ended', onEnded);
    socket.on('channel:call-user-joined', onJoined);
    socket.on('channel:call-user-left', onLeft);
    return () => {
      socket.off('channel:call-started', onStarted);
      socket.off('channel:call-ended', onEnded);
      socket.off('channel:call-user-joined', onJoined);
      socket.off('channel:call-user-left', onLeft);
      socket.emit('leave_channel', channelId);
    };
  }, [socket, isConnected, channelId]);

  const checkForActiveCall = async () => {
    try {
      const info = await videocallsApi.getCallInfo(channelId);
      setHasActiveCall(info.hasActiveCall);
      setActiveParticipants(info.activeCall?.participants?.map((p: any) => `${p.firstName} ${p.lastName}`) || []);
    } catch (_) {}
  };

  const handleStartCall = async () => {
    try {
      setLoading(true);
      const d = await videocallsApi.startCall(channelId, recordingEnabled);
      setHasActiveCall(true);
      onStartCall(d.token, d.url, d.roomName, d.callId);
    } catch (error) {
      console.error('Error starting call:', axios.isAxiosError(error) ? error.response?.data?.error || 'Failed' : 'An error occurred');
    } finally { setLoading(false); }
  };

  const handleJoinCall = async () => {
    try {
      setLoading(true);
      const d = await videocallsApi.joinCall(channelId);
      onJoinCall(d.token, d.url, d.roomName, d.callId);
    } catch (error) {
      console.error('Error joining call:', axios.isAxiosError(error) ? error.response?.data?.error || 'Failed' : 'An error occurred');
    } finally { setLoading(false); }
  };

  /* Auto-join */
  useEffect(() => {
    if (autoJoin && hasActiveCall && !loading && !hasAutoJoined.current) {
      hasAutoJoined.current = true;
      handleJoinCall();
    }
  }, [autoJoin, hasActiveCall, loading]);

  /* ──────────────── RENDER ──────────────── */

  /* Auto-joining spinner */
  if (hasActiveCall && autoJoin) {
    return (
      <>
        <style>{promptStyles}</style>
        <div className="vcp-root" ref={cardRef}>
          <div className="vcp-connecting">
            <div className="vcp-spinner" />
            <span className="vcp-connecting-label">Connecting to {callType} call…</span>
          </div>
        </div>
      </>
    );
  }

  /* Active call — join */
  if (hasActiveCall) {
    return (
      <>
        <style>{promptStyles}</style>
        <div className="vcp-root" ref={cardRef}>
          <div className="vcp-card">
            {/* Status indicator */}
            <div className="vcp-status-row">
              <span className="vcp-live-badge">
                <span className="vcp-live-dot" />
                Live
              </span>
              <span className="vcp-status-text">
                Active {callType === 'voice' ? 'voice' : 'video'} call in #{channelName}
              </span>
            </div>

            {/* Icon */}
            <div className="vcp-icon-block vcp-icon-block--green">
              {callType === 'video' ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="vcp-main-icon">
                  <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="vcp-main-icon">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 10v2a7 7 0 0 0 14 0v-2" />
                </svg>
              )}
            </div>

            {/* Participants */}
            {activeParticipants.length > 0 ? (
              <div className="vcp-participants">
                <AvatarStack names={activeParticipants} />
                <span className="vcp-participant-label">
                  {activeParticipants.length} participant{activeParticipants.length !== 1 ? 's' : ''} in call
                </span>
              </div>
            ) : (
              <p className="vcp-empty-notice">Call starting…</p>
            )}

            {activeParticipants.length > 0 && (
              <div className="vcp-name-chips">
                {activeParticipants.slice(0, 4).map((n, i) => (
                  <div key={i} className="vcp-chip">
                    <MiniAvatar name={n} size={18} />
                    <span>{n}</span>
                  </div>
                ))}
                {activeParticipants.length > 4 && (
                  <div className="vcp-chip">+{activeParticipants.length - 4} more</div>
                )}
              </div>
            )}

            {/* Join button */}
            <button onClick={handleJoinCall} disabled={loading} className="vcp-btn vcp-btn--join">
              {loading ? (
                <><div className="vcp-btn-spin" />Joining…</>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 15, height: 15 }}>
                    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
                  </svg>
                  Join {callType === 'voice' ? 'Voice' : 'Video'} Call
                </>
              )}
            </button>
          </div>
        </div>
      </>
    );
  }

  /* No active call — start */
  return (
    <>
      <style>{promptStyles}</style>
      <div className="vcp-root" ref={cardRef}>
        <div className="vcp-card">
          {/* Icon */}
          <div className="vcp-icon-block vcp-icon-block--blue">
            {callType === 'video' ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="vcp-main-icon">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="vcp-main-icon">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 10v2a7 7 0 0 0 14 0v-2" />
              </svg>
            )}
          </div>

          {/* Title */}
          <div>
            <h3 className="vcp-card-title">
              Start a {callType === 'voice' ? 'Voice' : 'Video'} Call
            </h3>
            <p className="vcp-card-sub">
              #{channelName} · {callType === 'video'
                ? 'Connect with your team via HD video'
                : 'Talk with your team over crystal-clear audio'}
            </p>
          </div>

          {/* Features */}
          <div className="vcp-features">
            {[
              { label: 'HD Audio & Video' },
              { label: 'Screen Sharing' },
              { label: 'Recording' },
            ].map(f => (
              <div key={f.label} className="vcp-feat-chip">
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 11, height: 11, color: 'var(--ck-blue)', flexShrink: 0 }}>
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
                {f.label}
              </div>
            ))}
          </div>

          {/* Recording toggle — video only */}
          {callType === 'video' && (
            <button
              type="button"
              className={`vcp-toggle ${recordingEnabled ? 'vcp-toggle--on' : ''}`}
              onClick={() => setRecordingEnabled(r => !r)}
            >
              <div className="vcp-track">
                <div className="vcp-thumb" />
              </div>
              <span className="vcp-toggle-label">Enable recording</span>
            </button>
          )}

          {/* Start button */}
          <button onClick={handleStartCall} disabled={loading} className="vcp-btn vcp-btn--start">
            {loading ? (
              <><div className="vcp-btn-spin" />Starting…</>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 15, height: 15 }}>
                  <path d="M8 5v14l11-7z" />
                </svg>
                Start {callType === 'voice' ? 'Voice' : 'Video'} Call
              </>
            )}
          </button>

          <p className="vcp-hint">Team members will be notified and can join from any channel.</p>
        </div>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  STYLES — match app's design system                                */
/* ────────────────────────────────────────────────────────────────── */
const promptStyles = `
/* ── Root ── */
.vcp-root {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 260px;
  font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 13px;
  color: var(--text-primary);
}

/* ── Connecting state ── */
.vcp-connecting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.vcp-spinner {
  width: 32px; height: 32px;
  border-radius: 50%;
  border: 2px solid var(--border-default);
  border-top-color: var(--ck-blue);
  animation: vcp-spin 0.85s linear infinite;
}
@keyframes vcp-spin { to { transform: rotate(360deg); } }
.vcp-connecting-label {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ── Card ── */
.vcp-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 420px;
  padding: 28px 28px 24px;
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft-lg);
}

/* Status row */
.vcp-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vcp-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  background: rgba(0, 184, 132, 0.1);
  border: 1px solid rgba(0, 184, 132, 0.25);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  color: var(--status-success);
  letter-spacing: 0.04em;
}
.vcp-live-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--status-success);
  animation: vcp-pulse 1.5s ease-in-out infinite;
}
@keyframes vcp-pulse {
  0%,100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.7; }
}
.vcp-status-text {
  font-size: 12px;
  color: var(--text-secondary);
}

/* Icon block */
.vcp-icon-block {
  width: 44px; height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid;
}
.vcp-icon-block--blue {
  background: rgba(0, 136, 255, 0.08);
  border-color: rgba(0, 136, 255, 0.18);
}
.vcp-icon-block--green {
  background: rgba(0, 184, 132, 0.08);
  border-color: rgba(0, 184, 132, 0.18);
}
.vcp-main-icon { width: 20px; height: 20px; color: var(--ck-blue); }
.vcp-icon-block--green .vcp-main-icon { color: var(--status-success); }

/* Card title */
.vcp-card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
  line-height: 1.3;
}
.vcp-card-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

/* Features */
.vcp-features {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.vcp-feat-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  background: var(--bg-surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
}

/* Participants */
.vcp-participants {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vcp-participant-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.vcp-empty-notice {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}

/* Name chips */
.vcp-name-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.vcp-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 4px;
  background: var(--bg-surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
}

/* Toggle (recording switch) */
.vcp-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  user-select: none;
}
.vcp-track {
  position: relative;
  width: 36px; height: 20px;
  border-radius: 10px;
  background: var(--bg-surface-3);
  border: 1px solid var(--border-default);
  transition: background 0.2s, border-color 0.2s;
  flex-shrink: 0;
}
.vcp-toggle--on .vcp-track {
  background: var(--ck-blue);
  border-color: var(--ck-blue);
}
.vcp-thumb {
  position: absolute;
  top: 2px; left: 2px;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
}
.vcp-toggle--on .vcp-thumb { transform: translateX(16px); }
.vcp-toggle-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
  transition: color 0.15s;
}
.vcp-toggle--on .vcp-toggle-label { color: var(--text-primary); }

/* Buttons */
.vcp-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  padding: 10px 18px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.12s;
}
.vcp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.vcp-btn:not(:disabled):active { transform: scale(0.98); }

.vcp-btn--start {
  background: var(--ck-blue);
  color: #fff;
}
.vcp-btn--start:not(:disabled):hover { opacity: 0.88; }

.vcp-btn--join {
  background: var(--status-success);
  color: #fff;
}
.vcp-btn--join:not(:disabled):hover { opacity: 0.88; }

.vcp-btn-spin {
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.35);
  border-top-color: #fff;
  animation: vcp-spin 0.8s linear infinite;
  flex-shrink: 0;
}

/* Hint */
.vcp-hint {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  margin: -4px 0 0;
  line-height: 1.5;
}
`;
