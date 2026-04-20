'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  GridLayout,
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useLocalParticipant,
  useRemoteParticipants,
  useTrackRefContext,
  isTrackReference,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import {
  VideoCameraIcon,
  VideoCameraSlashIcon,
  MicrophoneIcon,
  ChatBubbleLeftEllipsisIcon,
  ComputerDesktopIcon,
  PhoneIcon,
  MapPinIcon as MapPinIconSolid,
} from '@heroicons/react/24/solid';
import {
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';

import { videocallsApi } from '../../../src/api/videocalls.api';
import { useSocket } from '../../providers/SocketProvider';

/* ─── GSAP (lazy-loaded to skip SSR) ─── */
let gsap: any = null;
if (typeof window !== 'undefined') {
  import('gsap').then((mod) => { gsap = mod.gsap ?? mod.default ?? mod; });
}

/* ─── Types ─── */
interface VideoCallProps {
  channelId: string;
  channelName: string;
  callType?: 'voice' | 'video';
  onCallEnd?: () => void;
  theme?: 'dark' | 'light';
  token?: string;
  url?: string;
  roomName?: string;
  callId?: string;
}

/* ─── Duration formatter ─── */
function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/* ────────────────────────────────────────────────────────────────── */
/*  MAIN COMPONENT                                                    */
/* ────────────────────────────────────────────────────────────────── */
export function ChannelVideoCall({
  channelId,
  channelName,
  callType = 'video',
  onCallEnd,
  theme = 'dark',
  token: propsToken,
  url: propsUrl,
  roomName: propsRoomName,
  callId: propsCallId,
}: VideoCallProps) {
  const [token, setToken] = useState<string>(propsToken || '');
  const [url, setUrl] = useState<string>(propsUrl || '');
  const [roomName, setRoomName] = useState<string>(propsRoomName || '');
  const [callId, setCallId] = useState<string>(propsCallId || '');
  const [error, setError] = useState<string>('');
  const [callStarted, setCallStarted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [minutesRemaining, setMinutesRemaining] = useState(0);

  const durationInterval = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isLeavingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { socket } = useSocket();
  const liveKitRoomKey = `${roomName || 'no-room'}:${url || 'no-url'}:${token ? token.slice(-16) : 'no-token'}`;

  /* ── Sync props → state ── */
  useEffect(() => {
    if (propsToken) setToken(propsToken);
    if (propsUrl) setUrl(propsUrl);
    if (propsRoomName) setRoomName(propsRoomName);
    if (propsCallId) setCallId(propsCallId);
  }, [propsToken, propsUrl, propsRoomName, propsCallId]);

  /* ── GSAP entrance ── */
  useEffect(() => {
    if (!containerRef.current || !gsap) return;
    gsap.fromTo(containerRef.current,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
    );
  }, []);

  /* ── Validate + start ── */
  useEffect(() => {
    if (!token || !url || !roomName) return;

    const isSecure =
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (!isSecure || !navigator.mediaDevices) {
      setError('Video/audio calls require a secure connection (HTTPS). Please access the app via localhost or enable HTTPS.');
      return;
    }
    if (typeof token !== 'string' || token.length < 50) { setError('Invalid authentication token. Please try again.'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(roomName)) { setError('Invalid room name format.'); return; }
    try { new URL(url); } catch (_) { setError('Invalid video server URL.'); return; }

    setError('');
    setCallStarted(true);
    durationInterval.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    connectionTimeoutRef.current = setTimeout(() => {
      setError(prev => prev || 'Connection taking too long. Please check your internet and try again.');
    }, 30000);

    return () => {
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (durationInterval.current) clearInterval(durationInterval.current);
    };
  }, [token, url, roomName]);

  /* ── Page unload ── */
  useEffect(() => {
    if (!callStarted || !callId) return;
    const handleBeforeUnload = async (e: BeforeUnloadEvent) => {
      e.preventDefault(); e.returnValue = '';
      try { await videocallsApi.endCall(channelId, callId).catch(() => { }); } catch (_) { }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [callStarted, callId, channelId]);

  /* ── Socket ── */
  useEffect(() => {
    if (!socket) return;
    const onWarning = (data: any) => {
      setMinutesRemaining(data.minutesRemaining);
      setShowWarning(true);
      setTimeout(() => setShowWarning(false), 5000);
    };
    const onEnded = (data: any) => { if (data.reason === 'max_duration_exceeded') handleLeaveRoom(); };
    socket.on('channel:call-warning', onWarning);
    socket.on('channel:call-ended', onEnded);
    return () => { socket.off('channel:call-warning', onWarning); socket.off('channel:call-ended', onEnded); };
  }, [socket]);

  /* ── Leave ── */
  const handleLeaveRoom = useCallback(async () => {
    if (isLeavingRef.current) return;
    isLeavingRef.current = true;
    try {
      if (callId) await videocallsApi.endCall(channelId, callId);
      else await videocallsApi.leaveCall(channelId);
    } catch (_) { }
    finally {
      if (durationInterval.current) clearInterval(durationInterval.current);
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      onCallEnd?.();
    }
  }, [channelId, callId, onCallEnd]);

  const handleEnableRecording = async () => {
    try { if (callId) { await videocallsApi.enableRecording(channelId, callId); setIsRecording(true); } } catch (_) { }
  };

  /* ── Loading state ── */
  if (!token || !url || !roomName) {
    return (
      <>
        <style>{vcStyles}</style>
        <div ref={containerRef} className="vc-root">
          <div className="vc-state-center">
            <div className="vc-spinner" />
            <p className="vc-state-text">Preparing {callType === 'voice' ? 'voice' : 'video'} call…</p>
          </div>
        </div>
      </>
    );
  }

  /* ── Error state ── */
  if (error) {
    return (
      <>
        <style>{vcStyles}</style>
        <div ref={containerRef} className="vc-root">
          <div className="vc-state-center">
            <div className="vc-error-box">
              <div className="vc-error-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
              </div>
              <div>
                <p className="vc-error-title">Connection Failed</p>
                <p className="vc-error-msg">{error}</p>
              </div>
              <button className="vc-retry-btn" onClick={() => window.location.reload()}>Retry</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── Active call ── */
  return (
    <>
      <style>{vcStyles}</style>
      <div ref={containerRef} className="vc-root vc-root--active">
        {/* Duration warning */}
        {showWarning && (
          <div className="vc-warning">
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 15, height: 15, flexShrink: 0 }}>
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
            <span>Call ends in <strong>{minutesRemaining} min{minutesRemaining !== 1 ? 's' : ''}</strong></span>
            <button className="vc-warning-x" onClick={() => setShowWarning(false)}>✕</button>
          </div>
        )}

        {/* LiveKit room */}
        <LiveKitRoom
          key={liveKitRoomKey}
          video={callType === 'video'}
          audio={true}
          token={token}
          connect={true}
          serverUrl={url}
          data-lk-theme="default"
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          onConnected={() => {
            if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null; }
          }}
          onDisconnected={() => { if (!isLeavingRef.current) handleLeaveRoom(); }}
          onError={(err) => {
            const msg = err?.message || '';
            if (msg.toLowerCase().includes('client initiated disconnect') || msg.toLowerCase().includes('client_initiated')) return;
            if (connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null; }
            setError(`Connection failed: ${msg || 'Unable to connect to video server.'}`);
          }}
        >
          <AppStyledConference
            callType={callType}
            channelName={channelName}
            callDuration={callDuration}
            isRecording={isRecording}
            onLeave={handleLeaveRoom}
            onToggleRecording={handleEnableRecording}
          />
        </LiveKitRoom>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────────── */
/*  INNER CONFERENCE (uses LiveKit hooks)                             */
/* ────────────────────────────────────────────────────────────────── */

const PinnedContext = React.createContext<{
  pinnedId: string | null;
  togglePin: (id: string) => void;
}>({ pinnedId: null, togglePin: () => { } });
function AppStyledConference({
  callType,
  channelName,
  callDuration,
  isRecording,
  onLeave,
  onToggleRecording,
}: {
  callType: 'voice' | 'video';
  channelName: string;
  callDuration: number;
  isRecording: boolean;
  onLeave: () => void;
  onToggleRecording: () => void;
}) {
  const tracks = useTracks(
    callType === 'video'
      ? [
        { source: Track.Source.Camera, withPlaceholder: false },
        { source: Track.Source.ScreenShare, withPlaceholder: false },
      ]
      : [{ source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false }
  );

  const confRef = useRef<HTMLDivElement>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFs);
    return () => document.removeEventListener('fullscreenchange', handleFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      confRef.current?.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen().catch(err => console.error(err));
    }
  }, []);

  const pinnedTrack = tracks.find(t => `${t.participant.identity}-${t.source}` === pinnedId);
  const unpinnedTracks = tracks.filter(t => t !== pinnedTrack);

  return (
    <PinnedContext.Provider value={{ pinnedId, togglePin: (id) => setPinnedId(prev => prev === id ? null : id) }}>
      <div className="vc-conference bg-[#0a0a0c]" ref={confRef}>
        {/* ── TOP HEADER BAR ── */}
        <div className="vc-header">
          <div className="vc-header-left">
            {/* Channel name */}
            <div className="vc-channel-tag">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, opacity: 0.6 }}>
                <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
              </svg>
              {channelName}
            </div>
          </div>

          <div className="vc-header-center">
            {/* Live dot + duration */}
            <div className="vc-duration-pill">
              <span className="vc-live-dot" />
              {formatDuration(callDuration)}
            </div>

            {/* Recording */}
            {isRecording && (
              <div className="vc-rec-pill">
                <span className="vc-rec-dot" />
                REC
              </div>
            )}
          </div>

          <div className="vc-header-right">
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 hover:text-white transition-colors"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <ArrowsPointingInIcon className="w-[18px] h-[18px]" /> : <ArrowsPointingOutIcon className="w-[18px] h-[18px]" />}
            </button>

            {/* Signal bars */}
            <div className="vc-signal" title="Good connection">
              <span className="vc-sb vc-sb-1" />
              <span className="vc-sb vc-sb-2" />
              <span className="vc-sb vc-sb-3" />
              <span className="vc-sb vc-sb-4" />
            </div>
          </div>
        </div>

        {/* ── CALL STAGE ── */}
        <RoomAudioRenderer />
        {callType === 'voice' ? (
          <VoiceAvatarStage />
        ) : (
          <div className="vc-grid-area flex flex-col md:flex-row w-full h-full overflow-hidden">
            {pinnedTrack && (
              <div className="flex-1 w-full h-[60%] md:h-full p-2 md:p-4 min-h-[50%]">
                <CustomParticipantTileInner trackRef={pinnedTrack} />
              </div>
            )}
            <div className={`w-full overflow-hidden transition-all ${pinnedTrack ? 'md:w-[280px] h-[40%] md:h-full flex-shrink-0' : 'flex-1 h-full'}`}>
              <GridLayout tracks={pinnedTrack ? unpinnedTracks : tracks} className="vc-grid">
                <CustomParticipantTile />
              </GridLayout>
            </div>
          </div>
        )}

        {/* ── BOTTOM CONTROLS ── */}
        <div className="vc-bottom-bar">
          <VideoControls onEndCall={onLeave} />
        </div>
      </div>
    </PinnedContext.Provider>
  );
}

function getParticipantLabel(participant: any) {
  const raw = participant?.name || participant?.identity || 'User';
  if (typeof raw !== 'string') return 'User';
  if (raw.includes('_')) {
    const cleaned = raw.split('_').slice(1).join(' ').trim();
    if (cleaned) return cleaned;
  }
  return raw;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
}

function VoiceAvatarStage() {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  const participants = useMemo(() => {
    return [localParticipant, ...remoteParticipants].filter(Boolean);
  }, [localParticipant, remoteParticipants]);

  const activeParticipant = useMemo(() => {
    const speakingRemote = remoteParticipants.find((p) => p.isSpeaking);
    if (speakingRemote) return speakingRemote;
    if (localParticipant?.isSpeaking) return localParticipant;
    return remoteParticipants[0] || localParticipant;
  }, [localParticipant, remoteParticipants]);

  const activeName = getParticipantLabel(activeParticipant);
  const activeInitial = (activeName || 'U').trim().charAt(0).toUpperCase() || 'U';

  return (
    <div className="vc-grid-area flex flex-col items-center justify-center px-6 py-8 gap-6">
      <div className="w-[96px] h-[96px] rounded-[1.25rem] bg-gradient-to-br from-red-500 to-indigo-600 flex items-center justify-center text-white text-[40px] font-bold shadow-[0_20px_50px_rgba(0,0,0,0.4)] shrink-0">
        {activeInitial}
      </div>

      <div className="text-center">
        <div className="text-white text-[18px] font-semibold tracking-wide">
          {activeName}{activeParticipant?.isLocal ? ' (You)' : ''}
        </div>
        <div className="text-white/60 text-[12px] mt-1">
          {activeParticipant?.isSpeaking ? 'Speaking' : 'Listening'}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap justify-center max-w-[680px]">
        {participants.map((participant) => {
          const name = getParticipantLabel(participant);
          const isActive = participant?.identity === activeParticipant?.identity;
          return (
            <div
              key={participant?.identity || name}
              className={`px-2.5 py-1 rounded-full text-[11px] border ${isActive
                ? 'bg-white/15 text-white border-white/20'
                : 'bg-white/5 text-white/75 border-white/10'
                }`}
            >
              {name}{participant?.isLocal ? ' (You)' : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  CUSTOM PARTICIPANT TILE — initials avatar when camera off          */
/* ────────────────────────────────────────────────────────────────── */
function tileInitials(name: string) {
  return name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function CustomParticipantTile() {
  const trackRef = useTrackRefContext();
  return <CustomParticipantTileInner trackRef={trackRef} />;
}

function CustomParticipantTileInner({ trackRef }: { trackRef: any }) {
  const participant = trackRef.participant;
  const name = participant?.name || participant?.identity || 'User';
  const isLocal = participant?.isLocal;
  const isSpeaking = participant?.isSpeaking;
  const { pinnedId, togglePin } = React.useContext(PinnedContext);

  const trackId = `${participant?.identity}-${trackRef.source}`;
  const isPinned = pinnedId === trackId;

  // Video is "live" when the track reference has a non-muted camera or screenshare publication
  const isScreenShare = isTrackReference(trackRef) && trackRef.source === Track.Source.ScreenShare;
  const isVideoLive =
    isTrackReference(trackRef) &&
    (trackRef.source === Track.Source.Camera || trackRef.source === Track.Source.ScreenShare) &&
    !!trackRef.publication &&
    !trackRef.publication.isMuted;

  // Just grab the very first character, exactly like the sidebar icon does:
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      className="group w-full h-full relative"
      style={{
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: '#18191e',
        border: isSpeaking && !isScreenShare
          ? '2px solid var(--ck-blue)'
          : '1px solid rgba(255,255,255,0.07)',
        boxShadow: isSpeaking && !isScreenShare ? '0 0 0 3px rgba(0,136,255,0.18)' : 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Pin Button */}
      <button
        onClick={() => togglePin(trackId)}
        className={`absolute top-3 right-3 z-20 w-8 h-8 flex items-center justify-center rounded-lg backdrop-blur-md transition-all shadow-md opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100 ${isPinned
          ? 'bg-[var(--ck-blue)] text-white hover:bg-blue-600'
          : 'bg-black/50 hover:bg-black/70 text-white/80 hover:text-white'
          }`}
        title={isPinned ? "Unpin screen" : "Pin screen"}
      >
        <svg viewBox="0 0 384 512" fill="currentColor" className="w-[14px] h-[14px] mt-[1.5px]">
          <path d="M32 32C32 14.3 46.3 0 64 0H320c17.7 0 32 14.3 32 32s-14.3 32-32 32H290.5l11.4 148.2c36.7 19.9 65.7 53.2 79.5 94.7l1 3c3.3 9.8 .1 20.5-8.4 27.2S358.3 352 347.8 352H224v128c0 17.7-14.3 32-32 32s-32-14.3-32-32V352H36.2c-10.4 0-19.8-6.1-23.9-15.5s-1-20 6.6-26.9l1.9-1.8c12-11 22.1-23.6 29.8-37.6C64 246.3 64 219.7 64 192V64H64 32C14.3 64 0 49.7 0 32z" />
        </svg>
      </button>

      {/* Live video */}
      {isVideoLive && (
        <VideoTrack
          trackRef={trackRef}
          style={{ width: '100%', height: '100%', objectFit: isScreenShare ? 'contain' : 'cover', position: 'absolute', inset: 0 }}
        />
      )}

      {/* Avatar shown when camera/screen is off or disabled */}
      {!isVideoLive && (
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
          width: '100%', height: '100%',
        }}>
          {/* Matches the sidebar workspace avatar */}
          <div className="w-[76px] h-[76px] rounded-[1.25rem] bg-gradient-to-br from-red-500 to-indigo-600 flex items-center justify-center text-white text-[32px] font-bold shadow-lg shrink-0">
            {initial}
          </div>
          {/* Name */}
          <span style={{
            fontSize: 14, fontWeight: 500,
            color: 'rgba(255,255,255,0.85)',
            letterSpacing: '0.01em',
          }}>
            {name}{isLocal ? ' (You)' : ''}
          </span>
        </div>
      )}

      {/* Name label over video (when camera/screen on) */}
      {isVideoLive && (
        <div style={{
          position: 'absolute', bottom: 10, left: 12,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
          borderRadius: 6, padding: '3px 8px',
          fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.9)',
        }}>
          {name}{isLocal ? ' (You)' : ''}{isScreenShare ? "'s screen" : ""}

        </div>
      )}

      {/* Speaking indicator ring */}
      {isSpeaking && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'var(--radius-lg)',
          border: '2px solid var(--ck-blue)',
          pointerEvents: 'none',
          animation: 'vc-speak-ring 1s ease-in-out infinite',
        }} />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  VIDEO CONTROLS — custom control bar                               */
/* ────────────────────────────────────────────────────────────────── */
export const VideoControls = ({
  onEndCall,
  onToggleChat,
}: {
  onEndCall: () => void;
  onToggleChat?: () => void;
}) => {
  return (
    <div className="flex justify-center pb-6">
      <div className="bg-[#1e1f26]/95 rounded-[2.5rem] p-3 px-6 flex items-center gap-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/5 backdrop-blur-xl transition-all duration-300">

        {/* Camera */}
        <ControlButton icon={VideoCameraIcon} offIcon={VideoCameraSlashIcon} source={Track.Source.Camera} />

        {/* Microphone */}
        <ControlButton icon={MicrophoneIcon} offIcon={MicrophoneIcon} source={Track.Source.Microphone} />

        {/* Chat (optional) */}
        {onToggleChat && (
          <div
            onClick={onToggleChat}
            className="p-2.5 rounded-full hover:bg-white/10 cursor-pointer transition-all group active:scale-90"
          >
            <ChatBubbleLeftEllipsisIcon className="w-6 h-6 text-white/90 group-hover:scale-110 transition-transform" />
          </div>
        )}

        {/* Screen Share */}
        <ControlButton icon={ComputerDesktopIcon} offIcon={ComputerDesktopIcon} source={Track.Source.ScreenShare} />

        {/* Divider */}
        <div className="w-px h-8 bg-white/10 mx-2" />

        {/* End Call */}
        <button
          onClick={onEndCall}
          className="p-3 bg-[#f04747] hover:bg-[#ff5c5c] rounded-full transition-all hover:scale-110 active:scale-95 shadow-[0_8px_20px_rgba(240,71,71,0.3)] group"
          title="End Call"
        >
          <PhoneIcon className="w-6 h-6 text-white rotate-[135deg] group-hover:rotate-[145deg] transition-transform" />
        </button>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────── */
/*  CONTROL BUTTON — per-track toggle via useLocalParticipant         */
/* ────────────────────────────────────────────────────────────────── */
function ControlButton({
  icon: Icon,
  offIcon: OffIcon,
  source,
}: {
  icon: React.ElementType;
  offIcon: React.ElementType;
  source: Track.Source;
}) {
  const { localParticipant } = useLocalParticipant();

  const enabled =
    source === Track.Source.Camera
      ? localParticipant.isCameraEnabled
      : source === Track.Source.Microphone
        ? localParticipant.isMicrophoneEnabled
        : localParticipant.isScreenShareEnabled;

  const toggle = () => {
    if (source === Track.Source.Camera) {
      localParticipant.setCameraEnabled(!enabled);
    } else if (source === Track.Source.Microphone) {
      localParticipant.setMicrophoneEnabled(!enabled);
    } else if (source === Track.Source.ScreenShare) {
      localParticipant.setScreenShareEnabled(!enabled);
    }
  };

  return (
    <div
      onClick={toggle}
      className={`p-3 rounded-full transition-all hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center ${enabled
        ? 'bg-white/5 hover:bg-white/15'
        : 'bg-[#f04747]/20 hover:bg-[#f04747]/30 ring-1 ring-[#f04747]/30'
        }`}
      title={enabled ? 'Turn Off' : 'Turn On'}
    >
      {enabled ? (
        <Icon className="w-6 h-6 text-white" />
      ) : (
        <div className="relative flex items-center justify-center">
          <OffIcon className="w-6 h-6 text-[#f04747]" />
          <div className="absolute w-[120%] h-[2px] bg-[#f04747] rotate-45 rounded-full" />
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  SIMPLE FALLBACK  (no LiveKit)                                     */
/* ────────────────────────────────────────────────────────────────── */
export function SimpleVideoCallUI({
  channelId,
  channelName,
  onClose,
  theme = 'dark',
}: VideoCallProps & { onClose: () => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCallDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const participants = [
    { id: 1, initials: 'JD', name: 'John Doe' },
    { id: 2, initials: 'AS', name: 'Alice S.' },
    { id: 3, initials: 'MK', name: 'Mike K.' },
    { id: 4, initials: 'LW', name: 'Lisa W.' },
  ];

  return (
    <>
      <style>{vcStyles}</style>
      <div className="vc-root vc-root--active">
        {/* Header */}
        <div className="vc-header">
          <div className="vc-header-left">
            <div className="vc-channel-tag">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, opacity: 0.6 }}>
                <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
              </svg>
              {channelName}
            </div>
          </div>
          <div className="vc-header-center">
            <div className="vc-duration-pill">
              <span className="vc-live-dot" />
              {formatDuration(callDuration)}
            </div>
          </div>
          <div className="vc-header-right">
            <button className="vc-close-header-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 14, height: 14 }}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Demo grid */}
        <div className="vc-grid-area">
          <div className="vc-demo-grid" style={{ gridTemplateColumns: `repeat(${participants.length <= 2 ? participants.length : 2}, 1fr)` }}>
            {participants.map((p, i) => (
              <div key={p.id} className={`vc-demo-tile ${i === 0 ? 'vc-demo-tile--active' : ''}`}>
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="w-[76px] h-[76px] rounded-[1.25rem] bg-gradient-to-br from-red-500 to-indigo-600 flex items-center justify-center text-white text-[32px] font-bold shadow-lg shrink-0">
                    {p.name.charAt(0)}
                  </div>
                  <span className="text-[14px] font-medium text-[rgba(255,255,255,0.85)] tracking-wide">
                    {p.name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="vc-bottom-bar">
          <div className="vc-extra-btns vc-extra-btns--centered">
            <button className={`vc-extra-btn ${isRecording ? 'vc-extra-btn--recording' : ''}`} onClick={() => setIsRecording(r => !r)}>
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 15, height: 15 }}><circle cx="12" cy="12" r="5" /></svg>
              {isRecording ? 'Recording' : 'Record'}
            </button>
            <button className="vc-extra-btn">
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 15, height: 15 }}>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v4M8 23h8" />
              </svg>
              Mute
            </button>
            <button className="vc-extra-btn">
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 15, height: 15 }}>
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
              Video
            </button>
            <button className="vc-leave-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35-.01.74-.25 1.02l-2.2 2.2z" />
              </svg>
              Leave
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  STYLES — uses the app's CSS variables throughout                  */
/* ────────────────────────────────────────────────────────────────── */
const vcStyles = `
/* ── Root ── */
.vc-root {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 13px;
}

/* Active call gets dark video background */
.vc-root--active {
  background: #111214;
}

/* ── Centered state (loading / error) ── */
.vc-state-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
}

.vc-spinner {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--border-default);
  border-top-color: var(--ck-blue);
  animation: vc-spin 0.85s linear infinite;
}
@keyframes vc-spin { to { transform: rotate(360deg); } }

.vc-state-text {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

/* ── Error box ── */
.vc-error-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 380px;
  padding: 28px 32px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft-lg);
  text-align: center;
}
.vc-error-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(224, 58, 58, 0.1);
  border: 1px solid rgba(224, 58, 58, 0.2);
  color: var(--status-error);
  display: flex;
  align-items: center;
  justify-content: center;
}
.vc-error-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.vc-error-msg {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}
.vc-retry-btn {
  margin-top: 4px;
  padding: 7px 20px;
  background: var(--ck-blue);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}
.vc-retry-btn:hover { opacity: 0.88; }

/* ── Duration warning ── */
.vc-warning {
  position: absolute;
  top: 68px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 80;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-canvas);
  border: 1px solid var(--status-warning);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft-lg);
  color: var(--status-warning);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  animation: vc-drop 0.28s ease-out;
}
@keyframes vc-drop {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.vc-warning-x {
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); margin-left: 4px;
  font-size: 11px; padding: 0; line-height: 1;
  transition: color 0.15s;
}
.vc-warning-x:hover { color: var(--text-primary); }

/* ── Header ── */
.vc-header {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 50;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: linear-gradient(to bottom, rgba(10,10,14,0.82) 0%, transparent 100%);
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.vc-header-left, .vc-header-right { flex: 1; }
.vc-header-right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.vc-header-center { display: flex; align-items: center; gap: 8px; }

/* Channel tag */
.vc-channel-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255,255,255,0.85);
}

/* Duration pill  */
.vc-duration-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255,255,255,0.8);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
}
.vc-live-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--status-success);
  animation: vc-blink 2s ease infinite;
}
@keyframes vc-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

/* Rec pill */
.vc-rec-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  background: rgba(224, 58, 58, 0.75);
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #fff;
}
.vc-rec-dot {
  width: 6px; height: 6px;
  border-radius: 50%; background: #fff;
  animation: vc-blink 1s ease-in-out infinite;
}

/* Call type pill */
.vc-type-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  background: rgba(0, 136, 255, 0.2);
  border: 1px solid rgba(0, 136, 255, 0.3);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255,255,255,0.85);
}

/* Signal bars */
.vc-signal {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
}
.vc-sb {
  display: block;
  width: 3px;
  border-radius: 1px;
  background: var(--status-success);
  opacity: 0.85;
}
.vc-sb-1 { height: 4px; }
.vc-sb-2 { height: 7px; }
.vc-sb-3 { height: 10px; }
.vc-sb-4 { height: 14px; }

/* Close button in header */
.vc-close-header-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.vc-close-header-btn:hover { background: rgba(224,58,58,0.7); color: #fff; }

/* ── Conference wrapper ── */
.vc-conference {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  position: relative;
}

/* ── Grid ── */
.vc-grid-area {
  flex: 1;
  min-height: 0;
  position: relative;
  background: #111214;
}
.vc-grid { height: 100%; }

/* LiveKit tile overrides */
.vc-root [data-lk-participant-tile] {
  border-radius: var(--radius-lg) !important;
  overflow: hidden !important;
  border: 1px solid rgba(255,255,255,0.06) !important;
  transition: border-color 0.2s;
}
.vc-root [data-lk-participant-tile][data-lk-speaking="true"] {
  border-color: var(--ck-blue) !important;
  box-shadow: 0 0 0 2px rgba(0,136,255,0.2) !important;
}

/* ── Bottom control bar ── */
.vc-bottom-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #111214;
  flex-shrink: 0;
  border-top: 1px solid rgba(255,255,255,0.06);
}

/* Leave button */
.vc-leave-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  min-width: 58px;
  background: rgba(224, 58, 58, 0.12);
  border: 1px solid rgba(224, 58, 58, 0.25);
  border-radius: var(--radius-md);
  color: #f87171;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.02em;
  transition: background 0.15s, box-shadow 0.15s, transform 0.12s;
}
.vc-leave-btn:hover {
  background: rgba(224, 58, 58, 0.85);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 16px rgba(224,58,58,0.4);
  transform: translateY(-1px);
}
.vc-leave-btn:active { transform: scale(0.97); }

/* ── Demo grid (SimpleVideoCallUI) ── */
.vc-demo-grid {
  display: grid;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 8px;
}
.vc-demo-tile {
  background: var(--bg-surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: border-color 0.2s;
  position: relative;
  overflow: hidden;
}
.vc-demo-tile--active {
  border-color: var(--ck-blue);
  box-shadow: 0 0 0 1px rgba(0,136,255,0.15);
}
.vc-demo-av {
  width: 48px; height: 48px;
  border-radius: 50%;
  background: var(--bg-surface-3);
  border: 1px solid var(--border-default);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 600;
  color: var(--text-secondary);
}
.vc-demo-name {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255,255,255,0.7);
}
`;
