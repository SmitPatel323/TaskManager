'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    LiveKitRoom,
    AudioConference,
    ControlBar,
    useRemoteParticipants,
    useLocalParticipant,
    useTracks,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';
import { videocallsApi } from '../../../src/api/videocalls.api';
import { useSocket } from '../../providers/SocketProvider';
import { AgentAudioVisualizerBar } from '@/components/agent-audio-visualizer-bar';
import { AgentAudioVisualizerAura } from '@/components/agent-audio-visualizer-aura';
import { useCall } from '@/app/providers/CallProvider';
import { CallSettingsModal } from './CallSettingsModal';

import {
    MicrophoneIcon,
    ChevronDownIcon,
    Cog6ToothIcon,
    SpeakerWaveIcon,
    XMarkIcon
} from '@heroicons/react/24/outline';



interface VoiceCallProps {
    channelId: string;
    channelName: string;
    onCallEnd?: () => void;
    theme?: 'dark' | 'light';
    token?: string;
    url?: string;
    roomName?: string;
    callId?: string;
    currentUser?: { _id: string; firstName: string; lastName: string } | null;
}

// Helper to get remote audio level
function ControlButton({
    icon: Icon,
    offIcon: OffIcon,
    source
}: {
    icon: any,
    offIcon?: any,
    source: Track.Source
}) {
    const { localParticipant } = useLocalParticipant();

    const enabled = source === Track.Source.Camera
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
            className={`p-3 rounded-full transition-all hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center ${enabled ? 'bg-white/5 hover:bg-white/10 border border-white/5' : 'bg-red-500/20 hover:bg-red-500/30 border border-red-500/20'}`}
            title={enabled ? `Turn Off` : `Turn On`}
        >
            {enabled ? (
                <Icon className="w-6 h-6 text-white" />
            ) : (
                <div className="relative flex items-center justify-center">
                    {(OffIcon || Icon) && <Icon className="w-6 h-6 text-red-500" />}
                    <div className="absolute w-[120%] h-[2px] bg-red-500 rotate-45 rounded-full" />
                </div>
            )}
        </div>
    );
}

function VoiceVisualizerArea() {
    const participants = useRemoteParticipants();
    const { localParticipant } = useLocalParticipant();
    const { setCurrentAudioTrack } = useCall();
    const [localUser, setLocalUser] = useState<{
        firstName?: string;
        lastName?: string;
        email?: string;
        avatar?: string;
        avatarUrl?: string;
        profileImage?: string;
        profilePicture?: string;
        image?: string;
        photoURL?: string;
    } | null>(null);
    const [avatarLoadError, setAvatarLoadError] = useState(false);

    // Find first remote participant or fallback to local
    const targetParticipant = participants[0] || localParticipant;

    const tracks = useTracks([Track.Source.Microphone]);
    const audioTrackRef = tracks.find(
        (t) => t.participant.sid === targetParticipant.sid
    );

    useEffect(() => {
        try {
            const rawUser = localStorage.getItem('user');
            if (!rawUser) return;
            setLocalUser(JSON.parse(rawUser));
        } catch {
            setLocalUser(null);
        }
    }, []);

    const displayName = useMemo(() => {
        if (targetParticipant.isLocal) {
            const localName = [localUser?.firstName, localUser?.lastName].filter(Boolean).join(' ').trim();
            if (localName) return localName;
        }

        const identity = targetParticipant.identity || '';
        if (!identity) return 'User';

        if (identity.includes('_')) {
            const afterUnderscore = identity.split('_').slice(1).join('_').trim();
            if (afterUnderscore) return afterUnderscore;
        }

        return identity;
    }, [localUser?.firstName, localUser?.lastName, targetParticipant.identity, targetParticipant.isLocal]);

    const initials = useMemo(() => {
        const parts = displayName.split(/[\s_]+/).filter(Boolean);
        if (parts.length === 0) return 'U';
        return parts.slice(0, 2).map((p) => p.charAt(0)).join('').toUpperCase();
    }, [displayName]);

    const avatarSrc = useMemo(() => {
        const explicitAvatar = targetParticipant.isLocal
            ? (
                localUser?.avatar ||
                localUser?.avatarUrl ||
                localUser?.profileImage ||
                localUser?.profilePicture ||
                localUser?.image ||
                localUser?.photoURL
            )
            : null;

        if (explicitAvatar) return explicitAvatar;

        return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=4f46e5&color=ffffff&size=256&bold=true`;
    }, [displayName, localUser, targetParticipant.isLocal]);

    useEffect(() => {
        setAvatarLoadError(false);
    }, [avatarSrc]);

    // Share track with global context for sidebar visualization
    useEffect(() => {
        if (audioTrackRef?.publication?.audioTrack) {
            setCurrentAudioTrack(audioTrackRef.publication.audioTrack as any);
        }
        return () => setCurrentAudioTrack(null);
    }, [audioTrackRef, setCurrentAudioTrack]);

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-12 relative overflow-hidden">
            {/* The Official Premium Aura Visualizer - Sized XL for Focal Point */}
            <div className="absolute inset-0 flex items-center justify-center opacity-90">
                <AgentAudioVisualizerAura
                    audioTrack={audioTrackRef?.publication?.audioTrack}
                    state={targetParticipant.isSpeaking ? 'speaking' : 'listening'}
                    size="xl"
                    color="#6366f1"
                />
            </div>

            {/* User Avatar / Identity Overlay */}
            <div className="relative z-20 flex flex-col items-center">
                <div className="w-24 h-24 rounded-full bg-white/5 backdrop-blur-md border border-white/10 flex items-center justify-center overflow-hidden shadow-2xl transition-all duration-500 hover:scale-110">
                    <div className="w-20 h-20 rounded-full bg-indigo-500/20 flex items-center justify-center text-3xl font-bold text-white uppercase border border-white/5 overflow-hidden">
                        {!avatarLoadError ? (
                            <img
                                src={avatarSrc}
                                alt={displayName}
                                className="w-full h-full object-cover"
                                onError={() => setAvatarLoadError(true)}
                            />
                        ) : (
                            initials
                        )}
                    </div>
                </div>
                <div className="mt-8 text-center">
                    <p className="text-white font-bold text-lg uppercase tracking-widest drop-shadow-lg">
                        {targetParticipant.isLocal ? 'You' : displayName}
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-2">
                        <span className={`w-2 h-2 rounded-full ${targetParticipant.isSpeaking ? 'bg-indigo-500 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.8)]' : 'bg-gray-600'}`} />
                        <p className={`text-[10px] font-bold tracking-[0.2em] transition-colors duration-300 ${targetParticipant.isSpeaking ? 'text-indigo-400' : 'text-gray-500'}`}>
                            {targetParticipant.isSpeaking ? 'SPEAKING' : 'LISTENING'}
                        </p>
                    </div>
                </div>

                {/* Official Agent Audio Visualizer Bar - Added Wisely below identity */}
                <div className="mt-10 h-12 flex items-center justify-center">
                    <AgentAudioVisualizerBar
                        audioTrack={audioTrackRef?.publication?.audioTrack}
                        state={targetParticipant.isSpeaking ? 'speaking' : 'listening'}
                        size="sm"
                        barCount={7}
                        color="#6366f1"
                        className="opacity-80 hover:opacity-100 transition-opacity"
                    />
                </div>
            </div>

            {/* Hidden AudioConference to handle the audio tracks invisibly */}
            <div className="hidden">
                <AudioConference />
            </div>
        </div>
    );
}

export function ChannelVoiceCall({
    channelId,
    channelName,
    onCallEnd,
    theme = 'dark',
    token: propsToken,
    url: propsUrl,
    roomName: propsRoomName,
    callId: propsCallId
}: VoiceCallProps) {
    const [token, setToken] = useState<string>(propsToken || '');
    const [url, setUrl] = useState<string>(propsUrl || '');
    const [roomName, setRoomName] = useState<string>(propsRoomName || '');
    const [callId, setCallId] = useState<string>(propsCallId || '');

    const [error, setError] = useState<string>('');
    const [callStarted, setCallStarted] = useState(false);
    const [callDuration, setCallDuration] = useState(0);
    const [showWarning, setShowWarning] = useState(false);
    const [minutesRemaining, setMinutesRemaining] = useState(0);
    const [showSettings, setShowSettings] = useState(false);

    const durationInterval = useRef<NodeJS.Timeout | null>(null);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isLeavingRef = useRef(false);
    const { socket } = useSocket();
    const { endCall: globalEndCall } = useCall();

    // Update state when props change
    useEffect(() => {
        if (propsToken) setToken(propsToken);
        if (propsUrl) setUrl(propsUrl);
        if (propsRoomName) setRoomName(propsRoomName);
        if (propsCallId) setCallId(propsCallId);
    }, [propsToken, propsUrl, propsRoomName, propsCallId]);

    // Validate token/url/roomName and start the call UI
    useEffect(() => {
        if (!token || !url || !roomName) return;

        const isSecure =
            window.location.protocol === 'https:' ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1';

        if (!isSecure || !navigator.mediaDevices) {
            setError(
                'Voice calls require a secure connection (HTTPS or localhost). ' +
                'Please access the app via HTTPS to use voice features.'
            );
            return;
        }

        setError('');
        setCallStarted(true);

        durationInterval.current = setInterval(() => {
            setCallDuration((prev) => prev + 1);
        }, 1000);

        connectionTimeoutRef.current = setTimeout(() => {
            setError((prev) => {
                if (!prev) return 'Connection taking too long. Please check your internet connection.';
                return prev;
            });
        }, 30000);

        return () => {
            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            if (durationInterval.current) clearInterval(durationInterval.current);
        };
    }, [token, url, roomName]);

    // Listen for call warning events
    useEffect(() => {
        if (!socket) return;

        const handleCallWarning = (data: any) => {
            setMinutesRemaining(data.minutesRemaining);
            setShowWarning(true);
            setTimeout(() => setShowWarning(false), 5000);
        };

        const handleCallEnded = (data: any) => {
            if (data.reason === 'max_duration_exceeded') {
                handleLeaveRoom(true);
            }
        };

        socket.on('channel:call-warning', handleCallWarning);
        socket.on('channel:call-ended', handleCallEnded);

        return () => {
            socket.off('channel:call-warning', handleCallWarning);
            socket.off('channel:call-ended', handleCallEnded);
        };
    }, [socket]);

    const handleLeaveRoom = useCallback(async (explicit: boolean = false) => {
        if (isLeavingRef.current) return;
        if (explicit) isLeavingRef.current = true;

        try {
            if (explicit) {
                if (callId) {
                    await videocallsApi.endCall(channelId, callId);
                } else {
                    await videocallsApi.leaveCall(channelId);
                }
                globalEndCall();
            }
        } catch (err) {
            console.error('Error leaving voice call:', err);
        } finally {
            if (explicit) {
                if (durationInterval.current) clearInterval(durationInterval.current);
                if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
                
                // Emit call-ended event with metadata
                socket?.emit('channel:call-ended', {
                    callId,
                    channelId,
                    duration: callDuration,
                    callType: 'voice',
                    status: callDuration > 0 ? 'completed' : 'declined',
                    initiatorId: currentUser?._id,
                });
                
                onCallEnd?.();
            }
        }
    }, [channelId, callId, callDuration, onCallEnd, globalEndCall, socket, currentUser]);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (error) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-[var(--bg-canvas)]">
                <div className="text-center p-6 text-white">
                    <p className="text-red-500 mb-4">{error}</p>
                    <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!token || !url || !roomName) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-[var(--bg-canvas)]">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    <p className="text-[var(--text-secondary)] text-white/70">Preparing voice call...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`w-full h-full ${theme === 'dark' ? 'bg-[#0f0f11]' : 'bg-[#f5f5f5]'} overflow-hidden relative flex flex-col`}>
            {/* Header info */}
            <div className="absolute top-6 left-6 z-30 flex flex-col">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-[0.2em] mb-1">Voice Channel</span>
                <span className="text-lg font-bold text-white tracking-tight">{channelName}</span>
                <div className="flex items-center gap-2 mt-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[11px] font-mono text-gray-400">{formatDuration(callDuration)}</span>
                </div>
            </div>

            {/* Warning banner */}
            {showWarning && (
                <div className="absolute top-20 left-6 right-6 bg-yellow-500/90 text-white p-3 rounded-xl z-50 flex items-center justify-between text-sm shadow-2xl backdrop-blur-md border border-white/10">
                    <div className="flex items-center gap-2">
                        <span>⏰</span>
                        <span className="font-medium">Call ends in {minutesRemaining} min</span>
                    </div>
                    <button onClick={() => setShowWarning(false)} className="hover:opacity-70">✕</button>
                </div>
            )}

            <LiveKitRoom
                video={false}
                audio={true}
                token={token}
                connect={true}
                serverUrl={url}
                data-lk-theme={theme}
                style={{ height: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}
                onConnected={() => {
                    if (connectionTimeoutRef.current) {
                        clearTimeout(connectionTimeoutRef.current);
                        connectionTimeoutRef.current = null;
                    }
                }}
                onDisconnected={() => {
                    if (!isLeavingRef.current) handleLeaveRoom(false);
                }}
            >
                {/* Voice-only Aura UI */}
                <VoiceVisualizerArea />

                {/* Optimized Control Bar for Voice */}
                <div className="pb-12 pt-6 flex justify-center z-10">
                    <div className="bg-[#1e1f26]/80 backdrop-blur-xl border border-white/5 p-4 py-3 rounded-[2.5rem] flex items-center gap-6 shadow-2xl">
                        <ControlButton
                            icon={MicrophoneIcon}
                            source={Track.Source.Microphone}
                        />

                        {/* Dedicated Options/Settings Icon - Improved Visibility */}
                        <div
                            onClick={() => setShowSettings(true)}
                            className="p-3 rounded-full bg-white/5 hover:bg-white/15 border border-white/5 cursor-pointer transition-all hover:scale-110 group relative"
                            title="Settings"
                        >
                            <Cog6ToothIcon className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-500" />
                            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-indigo-500 rounded-full border-2 border-[#1e1f26] animate-pulse" />
                        </div>

                        <div className="w-px h-8 bg-white/10 mx-2" />

                        <button
                            onClick={() => handleLeaveRoom(true)}
                            className="p-3 bg-red-600 hover:bg-red-500 rounded-full transition-all hover:scale-110 active:scale-95 shadow-[0_8px_20px_rgba(239,68,68,0.3)] group"
                            title="End Call"
                        >
                            <XMarkIcon className="w-6 h-6 text-white group-hover:rotate-90 transition-transform" />
                        </button>
                    </div>
                </div>

                {/* Call Settings Modal */}
                <CallSettingsModal
                    isOpen={showSettings}
                    onClose={() => setShowSettings(false)}
                />
            </LiveKitRoom>
        </div>
    );
}

export function SimpleVoiceCallUI({ channelName, onClose, theme = 'dark' }: { channelName: string; onClose: () => void; theme?: 'dark' | 'light' }) {
    return (
        <div className={`w-full h-full ${theme === 'dark' ? 'bg-[#0f0f11]' : 'bg-gray-100'} p-8 flex flex-col items-center justify-center`}>
            <div className="text-center space-y-6">
                <div className="relative">
                    <div className="w-24 h-24 rounded-full bg-indigo-600/20 flex items-center justify-center animate-pulse">
                        <div className="w-16 h-16 rounded-full bg-indigo-500 flex items-center justify-center">
                            <span className="text-3xl">📞</span>
                        </div>
                    </div>
                </div>
                <div>
                    <h3 className="text-xl font-bold text-white mb-1">{channelName}</h3>
                    <p className="text-indigo-400 font-medium">Voice Call Active</p>
                </div>
                <button
                    onClick={onClose}
                    className="mt-8 px-8 py-3 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold transition-colors shadow-lg"
                >
                    Leave Call
                </button>
            </div>
        </div>
    );
}
