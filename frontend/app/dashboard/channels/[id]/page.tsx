"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { useSocket } from "../../../providers/SocketProvider";
import {
  channelsApi,
  type Channel,
  type ChannelAttachment,
  type ChannelMessage,
  type ChannelUser,
} from "../../../../src/api/channels.api";
import { ChannelVideoCall } from "../../../components/videocalls/ChannelVideoCall";
import { ChannelVoiceCall } from "../../../components/videocalls/ChannelVoiceCall";
import { ChannelCallPrompt } from "../../../components/videocalls/ChannelCallPrompt";
import { CallHistoryMessage } from "../../../components/chat/CallHistoryMessage";
import { MessageActions } from "../../../components/chat/MessageActions";
import { ReactionBar } from "../../../components/chat/ReactionBar";
import { ReactionPicker } from "../../../components/chat/ReactionPicker";
import { ReplyPreview } from "../../../components/chat/ReplyPreview";
import { useMessageActions } from "../../../hooks/useMessageActions";
import { videocallsApi } from "../../../../src/api/videocalls.api";
import {
  HashtagIcon,
  UserGroupIcon,
  MagnifyingGlassIcon,
  BellIcon,
  VideoCameraIcon,
  PhoneIcon,
  ChatBubbleBottomCenterTextIcon as ChatBubbleLeftRightIcon, 
  ChevronRightIcon,
  Squares2X2Icon,
  PaperAirplaneIcon,
  FaceSmileIcon,
  PlusIcon,
  Cog6ToothIcon,
  EllipsisVerticalIcon,
  MagnifyingGlassIcon as SearchIcon,
  MicrophoneIcon,
} from "@heroicons/react/24/outline";

/* ─── Types ─────────────────────────────────────────────────── */
type Member = ChannelUser;

interface Message extends Omit<ChannelMessage, "_id" | "channelId" | "createdAt" | "updatedAt" | "mentions" | "attachments"> {
  _id?: string;
  channelId?: string;
  text?: string;
  sender: Member | null;
  mentions?: Member[];
  attachments?: ChannelAttachment[];
  replyTo?: {
    messageId: string;
    text: string;
    senderName: string;
    senderId: string;
  } | null;
  createdAt: string | Date;
  local?: boolean; // optimistic
}

type StoredChannel = Channel;

/* ─── Toast ──────────────────────────────────────────────────── */
type ToastType = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

function ToastContainer({ toasts, remove }: { toasts: Toast[]; remove: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-[13px] font-medium border backdrop-blur-md animate-toast-in
            ${t.type === "success"
              ? "bg-emerald-950/90 border-emerald-700/50 text-emerald-200"
              : t.type === "error"
                ? "bg-red-950/90 border-red-700/50 text-red-200"
                : "bg-[#1e1f26]/90 border-[#36374a] text-gray-200"
            }`}
        >
          <span>
            {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
          </span>
          <span>{t.message}</span>
          <button
            onClick={() => remove(t.id)}
            className="ml-2 opacity-60 hover:opacity-100 transition-opacity text-[11px]"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const add = useCallback((message: string, type: ToastType = "info", duration = 3000) => {
    const id = ++counter.current;
    setToasts((p) => [...p, { id, message, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), duration);
  }, []);
  const remove = useCallback((id: number) => setToasts((p) => p.filter((t) => t.id !== id)), []);
  return { toasts, add, remove };
}

/* ─── Avatar helper ─────────────────────────────────────────── */
const AVATAR_COLORS = [
  "bg-[#2B2B2B]", // Dark Grey (like the JT example)
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const sizeClass = size === "sm" ? "w-7 h-7 text-[10px]" : size === "lg" ? "w-10 h-10 text-[13px]" : "w-8 h-8 text-[11px]";
  return (
    <div
      className={`${sizeClass} rounded-full ${avatarColor(name)} flex items-center justify-center font-semibold text-white flex-shrink-0 shadow-sm`}
    >
      {initials}
    </div>
  );
}

/* ─── @Mention Dropdown ─────────────────────────────────────── */
function MentionDropdown({
  members,
  query,
  onSelect,
  visible,
}: {
  members: Member[];
  query: string;
  onSelect: (m: Member) => void;
  visible: boolean;
}) {
  const filtered = members.filter((m) =>
    `${m.firstName} ${m.lastName}`.toLowerCase().includes(query.toLowerCase())
  );
  if (!visible || filtered.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl shadow-lg overflow-hidden z-50">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
        <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider font-semibold">Members</span>
      </div>
      <div className="max-h-52 overflow-y-auto">
        {filtered.map((m) => (
          <button
            key={m._id}
            onMouseDown={(e) => { e.preventDefault(); onSelect(m); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-surface-2)] transition-colors text-left"
          >
            <Avatar name={`${m.firstName} ${m.lastName}`} size="sm" />
            <div>
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{m.firstName} {m.lastName}</span>
              {m.email && <p className="text-[11px] text-[var(--text-tertiary)] truncate">{m.email}</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Message bubble group ──────────────────────────────────── */
interface MessageGroup {
  sender: Member | null;
  messages: Message[];
  isMe: boolean;
}

function groupMessages(messages: Message[], currentUserId: string): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    const isMe = msg.sender?._id === currentUserId;
    // Each message is individual, not combined with others
    groups.push({ sender: msg.sender, messages: [msg], isMe });
  }
  return groups;
}

function formatTime(d: string | Date) {
  return new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelativeTime(d: string | Date) {
  const now = new Date();
  const then = new Date(d);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString();
}
function formatDateDivider(d: string | Date) {
  const date = new Date(d);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function shouldShowDivider(prev: Message | undefined, curr: Message) {
  if (!prev) return true;
  return new Date(prev.createdAt).toDateString() !== new Date(curr.createdAt).toDateString();
}

function renderMessageText(text: string) {
  const parts = text.split(/(@[a-zA-Z0-9_]+)/g);
  return parts.map((part, index) => {
    if (part.startsWith("@")) {
      return (
        <span key={`${part}-${index}`} className="text-amber-700 font-semibold bg-amber-100 px-1.5 py-0.5 rounded mr-0.5 inline-block">
          {part}
        </span>
      );
    }
    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-4 px-4">
      <div className="flex-1 h-px bg-[#2e2f3e]" />
      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-2">{label}</span>
      <div className="flex-1 h-px bg-[#2e2f3e]" />
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────── */
export default function ChannelPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const normalizedChannelId = decodeURIComponent(id || "").trim().toLowerCase();
  const channelName = id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ");

  const { socket, isConnected } = useSocket();

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [channelConfig, setChannelConfig] = useState<StoredChannel | null>(null);
  const [currentUser, setCurrentUser] = useState<Member | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activePeopleTab, setActivePeopleTab] = useState<"followers" | "access">("followers");
  const [membersOpen, setMembersOpen] = useState(true);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionVisible, setMentionVisible] = useState(false);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const [mentionSuggestions, setMentionSuggestions] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [isJoiningChannel, setIsJoiningChannel] = useState(false);
  const [hideJoinPrompt, setHideJoinPrompt] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChannelAttachment[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  // Add Member feature state
  const [allUsers, setAllUsers] = useState<Member[]>([]);
  const [addMemberQuery, setAddMemberQuery] = useState("");

  // Video call state
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [callType, setCallType] = useState<'voice' | 'video'>('video');
  const [callStarted, setCallStarted] = useState(false);
  const [callData, setCallData] = useState<{ token: string; url: string; roomName: string; callId?: string } | null>(null);

  // Launch a call directly — start if none active, join if one is running
  const [callLaunching, setCallLaunching] = useState(false);
  const handleLaunchCall = useCallback(async (type: 'voice' | 'video') => {
    try {
      setCallLaunching(true);
      setCallType(type);
      setShowVideoCall(true);

      // Check if there's already an active call to join
      const info = await videocallsApi.getCallInfo(normalizedChannelId);
      let data;
      if (info.hasActiveCall) {
        data = await videocallsApi.joinCall(normalizedChannelId);
      } else {
        data = await videocallsApi.startCall(normalizedChannelId, false);
      }
      setCallData({ token: data.token, url: data.url, roomName: data.roomName, callId: data.callId });
      setCallStarted(true);
    } catch (err) {
      console.error('Failed to launch call:', err);
      // Fall back to showing the lobby prompt so the user can retry
      setCallStarted(false);
      setCallData(null);
    } finally {
      setCallLaunching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedChannelId]);

  // Auto-open the call UI when navigated from the global incoming call banner (?openCall=1)
  useEffect(() => {
    if (searchParams.get('openCall') === '1') {
      handleLaunchCall('video');
    }
  }, [searchParams, handleLaunchCall]);


  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const memberSearchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recentEmojiUpdatesRef = useRef<Map<string, number>>(new Map());
  
  // Helper function to safely update emoji reactions
  const handleEmojiReaction = useCallback((messageId: string, emoji: string, add: boolean) => {
    const updateKey = `${messageId}-${emoji}`;
    const now = Date.now();
    const lastUpdate = recentEmojiUpdatesRef.current.get(updateKey);
    
    // Block duplicate updates within 150ms window
    if (lastUpdate && now - lastUpdate < 150) {
      return;
    }
    
    recentEmojiUpdatesRef.current.set(updateKey, now);
    
    setMessageReactions(prev => {
      const next = new Map(prev);
      let reactions = next.get(messageId) ? [...next.get(messageId)!] : [];
      
      if (add) {
        const existingIndex = reactions.findIndex(r => r.emoji === emoji);
        if (existingIndex >= 0) {
          // Create new object to ensure React detects change
          reactions[existingIndex] = {
            emoji: reactions[existingIndex].emoji,
            count: reactions[existingIndex].count + 1
          };
        } else {
          reactions.push({ emoji, count: 1 });
        }
      } else {
        reactions = reactions.map(r => 
          r.emoji === emoji 
            ? { emoji: r.emoji, count: Math.max(0, r.count - 1) }
            : r
        ).filter(r => r.count > 0);
      }
      
      if (reactions.length === 0) {
        next.delete(messageId);
      } else {
        next.set(messageId, reactions);
      }
      return next;
    });
  }, []);
  
  const { toasts, add: addToast, remove: removeToast } = useToast();

  const quickEmojis = ["😀", "😂", "😍", "🔥", "👍", "🎉", "✅", "🙏", "👀", "🤝", "❤️", "🚀"];

  /* ---------- scroll to bottom ---------- */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);
  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  /* ---------- load user + channel + messages ---------- */
  useEffect(() => {
    let mounted = true;
    const userStr = localStorage.getItem("user");
    let localUserId = "";

    if (userStr) {
      try {
        const parsed = JSON.parse(userStr) as {
          _id?: string;
          id?: string;
          userId?: string;
          firstName?: string;
          lastName?: string;
          name?: string;
          email?: string;
          role?: string;
        };

        const fallbackName = (parsed.name || "").trim().split(/\s+/).filter(Boolean);
        localUserId = parsed._id || parsed.id || parsed.userId || "me";
        setCurrentUser({
          _id: localUserId,
          firstName: parsed.firstName || fallbackName[0] || "User",
          lastName: parsed.lastName || fallbackName.slice(1).join(" "),
          email: parsed.email,
        });
        setIsAdmin(parsed.role === "admin");
      } catch (_) { }
    }

    // Fetch channel details and conditionally load messages only for joined users
    const fetchChannelAndHistory = async () => {
      try {
        const channel = await channelsApi.getChannel(normalizedChannelId);
        if (!mounted) return;

        setChannelConfig(channel as StoredChannel);
        setMembers((channel.joinedMembers || channel.members || []) as Member[]);
        setMentionSuggestions((channel.joinedMembers || []) as Member[]);

        const isJoined = channel.joined || (channel.joinedMemberIds || []).some((memberId) => memberId === localUserId);
        const hasPrivateAccess = !channel.isPrivate || (channel.members || []).some((member) => member._id === localUserId);

        if (!isJoined && channel.isPrivate && hasPrivateAccess) {
          try {
            const joined = await channelsApi.joinChannel(normalizedChannelId);
            if (!mounted) return;
            setChannelConfig(joined as StoredChannel);
            setMembers((joined.joinedMembers || joined.members || []) as Member[]);
            setMentionSuggestions((joined.joinedMembers || joined.members || []) as Member[]);
          } catch {
            // Best-effort auto join for invited private members.
          }
        }

        if (isJoined || (channel.isPrivate && hasPrivateAccess)) {
          const history = await channelsApi.getMessages(normalizedChannelId);
          if (!mounted) return;
          setMessages(history as Message[]);
        } else {
          setMessages([]);
        }
      } catch (_) {
        addToast("Could not load channel data", "error");
      } finally {
        setLoading(false);
      }
    };
    fetchChannelAndHistory();

    // Fetch call info for this channel on mount removed - handled by GlobalIncomingCallBanner

    // Fetch all users for inline Add People search
    const fetchAllUsers = async () => {
      try {
        const users = await channelsApi.getUsers();
        if (!mounted) return;
        setAllUsers(users as Member[]);
      } catch (err) {
        console.error("Failed to fetch users", err);
      }
    };
    fetchAllUsers();

    // Join channel using global socket
    if (socket && isConnected) {
      console.log('Joining channel:', normalizedChannelId);
      socket.emit('join_channel', normalizedChannelId);
    }

    const handlePresenceUpdated = (updatedChannel: StoredChannel) => {
      if (!updatedChannel || updatedChannel.id?.toLowerCase() !== normalizedChannelId) return;

      setChannelConfig(updatedChannel);
      const joinedUsers = (updatedChannel.joinedMembers || updatedChannel.members || []) as Member[];
      setMembers(joinedUsers);
      setMentionSuggestions(joinedUsers);
    };

    if (socket) {
      socket.on("receive_message", (msg: Message) => {
        setMessages((prev) => {
          // Avoid duplicate if we already added optimistically by local flag
          const alreadyExists = prev.some((m) => m.local && m.text === msg.text && m.sender?._id === msg.sender?._id);
          if (alreadyExists) {
            return prev.map((m) =>
              m.local && m.text === msg.text && m.sender?._id === msg.sender?._id ? { ...msg } : m
            );
          }
          return [...prev, msg];
        });
      });

      // Fetch fresh messages when call ends to show call history
      socket.on("channel:call-ended", async (data: { callId?: string; channelId: string; duration?: number; callType?: 'voice' | 'video'; status?: 'completed' | 'missed' | 'declined'; initiatorId?: string; participants?: string[] }) => {
        if (data.channelId === normalizedChannelId) {
          try {
            // Add call message directly
            if (data.callType && data.status) {
              const callMessage = await channelsApi.logCall(normalizedChannelId, {
                callType: data.callType,
                status: data.status,
                duration: data.duration || 0,
                participants: data.participants,
                initiatorId: data.initiatorId
              });
              setMessages((prev) => [...prev, callMessage as Message]);
            } else {
              // Fallback: refresh all messages if call data incomplete
              const history = await channelsApi.getMessages(normalizedChannelId);
              setMessages(history as Message[]);
            }
            console.log('Call ended, message added to chat');
          } catch (err) {
            console.error('Failed to add call message:', err);
            // Fallback to refreshing messages
            try {
              const history = await channelsApi.getMessages(normalizedChannelId);
              setMessages(history as Message[]);
            } catch (e) {
              console.error('Failed to refresh messages:', e);
            }
          }
        }
      });

      socket.on("channel_presence_updated", handlePresenceUpdated);

      // In-channel call notice logic removed - handled by GlobalIncomingCallBanner

      socket.on("user_typing_start", (data: { channelId: string; userId: string }) => {
        if (data.channelId === normalizedChannelId) {
          setTypingUsers((prev) => new Set(prev).add(data.userId));
        }
      });

      socket.on("user_typing_stop", (data: { channelId: string; userId: string }) => {
        if (data.channelId === normalizedChannelId) {
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.delete(data.userId);
            return next;
          });
        }
      });
    }

    return () => {
      mounted = false;
      if (socket) {
        socket.off("receive_message");
        socket.off("channel:call-ended");
        socket.off("channel_presence_updated", handlePresenceUpdated);
        socket.off("user_typing_start");
        socket.off("user_typing_stop");
        socket.emit("leave_channel", normalizedChannelId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, id, normalizedChannelId]);

  /* ---------- send message ---------- */
  const handleSendMessage = () => {
    if (!canMessageInChannel) {
      addToast("Join this channel to send messages", "info");
      return;
    }

    const text = newMessage.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!text && !hasAttachments) || !socket || !isConnected || !currentUser) return;

    const mentionIds = selectedMentionIds.filter((mentionId) => {
      const mentionedUser = mentionSuggestions.find((user) => user._id === mentionId);
      if (!mentionedUser) return false;
      return text.toLowerCase().includes(`@${mentionedUser.firstName.toLowerCase()}`);
    });

    // Optimistic message with replyTo included
    const optimistic: Message = {
      text,
      sender: currentUser,
      attachments: pendingAttachments,
      mentions: mentionSuggestions.filter((member) => mentionIds.includes(member._id)),
      replyTo: replyingTo ? {
        messageId: replyingTo._id || '',
        text: replyingTo.messageText || '',
        senderName: replyingTo.senderName || '',
        senderId: replyingTo._id || ''
      } : null,
      createdAt: new Date().toISOString(),
      local: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setNewMessage("");
    setSelectedMentionIds([]);
    setPendingAttachments([]);
    setMentionVisible(false);
    setReplyingTo(null); // Clear reply after sending
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Emit with replyTo data
    socket.emit("send_message", {
      channelId: normalizedChannelId,
      text,
      senderId: currentUser._id,
      mentions: mentionIds,
      attachments: pendingAttachments,
      replyTo: replyingTo ? {
        messageId: replyingTo._id,
        text: replyingTo.messageText || '',
        senderName: replyingTo.senderName,
        senderId: currentUser._id
      } : null,
    });

    // Stop typing indicator on send
    socket.emit("typing_stop", { channelId: normalizedChannelId });
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    addToast("Message sent!", "success", 2000);
  };

  /* ---------- handle textarea input (auto-grow + @mention) ---------- */
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNewMessage(val);

    // Auto-grow
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";

    // @mention detection
    const cursor = ta.selectionStart;
    const before = val.slice(0, cursor);
    const match = before.match(/@([a-zA-Z0-9_]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionVisible(true);
    } else {
      setMentionVisible(false);
    }

    // Typing indication
    if (socket && isConnected && canMessageInChannel) {
      if (!typingTimeoutRef.current) {
        socket.emit("typing_start", { channelId: normalizedChannelId });
      } else {
        clearTimeout(typingTimeoutRef.current);
      }

      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("typing_stop", { channelId: normalizedChannelId });
        typingTimeoutRef.current = null;
      }, 2000);
    }
  };

  const handleMentionSelect = (m: Member) => {
    const cursor = textareaRef.current?.selectionStart ?? newMessage.length;
    const before = newMessage.slice(0, cursor);
    const after = newMessage.slice(cursor);
    const withoutAtQuery = before.replace(/@[a-zA-Z0-9_]*$/, "");
    const inserted = `@${m.firstName} `;
    setNewMessage(withoutAtQuery + inserted + after);
    setSelectedMentionIds((prev) => (prev.includes(m._id) ? prev : [...prev, m._id]));
    setMentionVisible(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!canMessageInChannel) {
      addToast("Join this channel to upload files", "info");
      return;
    }

    const files = Array.from(fileList);
    setIsUploadingFiles(true);
    try {
      const uploaded = await channelsApi.uploadFiles(normalizedChannelId, files);
      setPendingAttachments((prev) => [...prev, ...uploaded]);
      addToast(`${uploaded.length} file${uploaded.length > 1 ? "s" : ""} uploaded`, "success");
    } catch {
      addToast("Failed to upload files", "error");
    } finally {
      setIsUploadingFiles(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };



  const removePendingAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const addEmojiToComposer = (emoji: string) => {
    setNewMessage((value) => `${value}${emoji}`);
    setEmojiPickerOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (mentionVisible) return;
      handleSendMessage();
    }
    if (e.key === "Escape") setMentionVisible(false);
  };

  useEffect(() => {
    const hasAccess = !channelConfig?.isPrivate || !!channelConfig.members?.some((member) => member._id === currentUser?._id);
    if (!mentionVisible || !hasAccess) return;

    const timeoutId = setTimeout(async () => {
      try {
        const suggestions = await channelsApi.getMentionSuggestions(normalizedChannelId, mentionQuery);
        setMentionSuggestions(suggestions);
      } catch {
        // Keep previous suggestions when mention lookup fails.
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [mentionVisible, mentionQuery, normalizedChannelId, channelConfig, currentUser]);

  /* ---------- add member ---------- */
  const handleAddMember = async (user: Member) => {
    if (!canManageMembers) {
      addToast("Only channel creator can add members", "error");
      return;
    }

    // Avoid duplicates
    if (members.find((m) => m._id === user._id)) {
      addToast("User is already a member", "error");
      return;
    }

    try {
      const updated = await channelsApi.addMember(normalizedChannelId, user._id);
      setChannelConfig(updated as unknown as StoredChannel);
      setMembers((updated.joinedMembers || updated.members || []) as Member[]);
      addToast(`${user.firstName} ${user.lastName} added to channel`, "success");
      setAddMemberQuery("");
      setTimeout(() => memberSearchRef.current?.focus(), 0);
    } catch {
      addToast("Failed to add member", "error");
    }
  };

  const addableUsers = useMemo(
    () => allUsers.filter((u) => !members.find((m) => m._id === u._id)),
    [allUsers, members]
  );

  const filteredAddableUsers = useMemo(() => {
    const query = addMemberQuery.trim().toLowerCase();
    if (!query) return [];
    return addableUsers.filter((u) =>
      `${u.firstName} ${u.lastName} ${u.email || ""}`.toLowerCase().includes(query)
    );
  }, [addableUsers, addMemberQuery]);

  useEffect(() => {
    if (!mentionVisible) {
      setMentionSuggestions(members);
    }
  }, [members, mentionVisible]);

  const canAccessChannel = useMemo(() => {
    if (!channelConfig) return true;
    if (!channelConfig.isPrivate) return true;
    if (!currentUser?._id) return false;
    return (channelConfig.members || []).some((m) => m._id === currentUser._id);
  }, [channelConfig, currentUser]);

  const canMessageInChannel = useMemo(() => {
    if (!canAccessChannel) return false;
    if (!channelConfig) return true;
    if (channelConfig.joined) return true;
    if (!currentUser?._id) return false;
    return (channelConfig.joinedMemberIds || []).includes(currentUser._id);
  }, [canAccessChannel, channelConfig, currentUser]);

  const canManageMembers = useMemo(() => {
    if (!currentUser?._id || !channelConfig?.createdBy) return false;
    return channelConfig.createdBy === currentUser._id;
  }, [channelConfig, currentUser]);

  useEffect(() => {
    setHideJoinPrompt(false);
  }, [id]);

  const handleJoinChannel = async () => {
    if (!currentUser?._id) return;
    setIsJoiningChannel(true);
    setHideJoinPrompt(true);
    try {
      const joined = await channelsApi.joinChannel(normalizedChannelId);
      setChannelConfig(joined as unknown as StoredChannel);
      setMembers((joined.joinedMembers || joined.members || []) as Member[]);
      setMentionSuggestions((joined.joinedMembers || []) as Member[]);
      socket?.emit("join_channel", normalizedChannelId);

      try {
        const history = await channelsApi.getMessages(normalizedChannelId);
        setMessages(history as Message[]);
      } catch {
        setMessages([]);
      }

      addToast("You joined this channel", "success");
    } catch {
      setHideJoinPrompt(false);
      addToast("Failed to join channel", "error");
    } finally {
      setIsJoiningChannel(false);
    }
  };

  const accessMembers = useMemo(() => {
    if (!channelConfig?.createdBy) {
      return currentUser ? [currentUser] : ([] as Member[]);
    }

    const owner = members.find((m) => m._id === channelConfig.createdBy);
    if (owner) return [owner];

    if (currentUser && currentUser._id === channelConfig.createdBy) return [currentUser];
    return [] as Member[];
  }, [channelConfig, members, currentUser]);

  const messageGroups = groupMessages(messages, currentUser?._id ?? "");

  return (
    <div className="flex h-full overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* ── MAIN CHAT COLUMN ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="flex-none h-[56px] flex items-center justify-between px-5 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/95 backdrop-blur-sm z-10">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] flex items-center justify-center">
              <HashtagIcon className="w-4 h-4 text-[var(--ck-blue)]" />
            </div>
            <span className="text-[15px] font-semibold text-[var(--text-primary)]">{channelName}</span>
            {canMessageInChannel && members.length > 0 && (
              <span className="text-[12px] text-[var(--text-tertiary)] flex items-center gap-1">
                <UserGroupIcon className="w-3.5 h-3.5" />
                {members.length} member{members.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { if (!showVideoCall) handleLaunchCall('voice'); else { setShowVideoCall(false); setCallStarted(false); setCallData(null); } }}
              disabled={callLaunching}
              className={`p-2 rounded-lg transition-colors ${showVideoCall && callType === 'voice'
                  ? 'bg-[var(--ck-blue)]/10 text-[var(--ck-blue)]'
                  : 'hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              title="Voice Call"
            >
              <PhoneIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => { if (!showVideoCall) handleLaunchCall('video'); else { setShowVideoCall(false); setCallStarted(false); setCallData(null); } }}
              disabled={callLaunching}
              className={`p-2 rounded-lg transition-colors ${showVideoCall && callType === 'video'
                  ? 'bg-[var(--ck-blue)]/10 text-[var(--ck-blue)]'
                  : 'hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              title="Video Call"
            >
              {callLaunching
                ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin block" />
                : <VideoCameraIcon className="w-4 h-4" />}
            </button>
            <div className="w-px h-5 bg-[var(--border-subtle)] mx-1" />
            <button
              onClick={() => setMembersOpen((o) => !o)}
              className={`p-2 rounded-lg transition-colors ${membersOpen ? "bg-indigo-500/10 text-indigo-500" : "hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
              title="Toggle member list"
            >
              <i className="pi pi-users text-[18px] w-4 h-4" ></i>
            </button>
          </div>
        </header>

        {/* Pinned Messages Bar */}
        {pinnedMessages.size > 0 && (
          <div className="flex-none bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-4 py-2 overflow-x-auto ck-scrollbar-h">
            <div className="flex gap-2">
              {Array.from(pinnedMessages).map((pinnedId) => {
                const pinnedMsg = messages.find(m => m._id === pinnedId);
                if (!pinnedMsg) return null;
                
                const senderName = pinnedMsg.sender 
                  ? `${pinnedMsg.sender.firstName} ${pinnedMsg.sender.lastName}`
                  : "Unknown";
                
                return (
                  <div
                    key={pinnedId}
                    className="flex-shrink-0 flex items-center gap-2 bg-[var(--bg-surface-2)] border border-[var(--border-default)] rounded-lg px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-surface-3)] transition-colors group"
                    onClick={() => {
                      const element = document.getElementById(`msg-${pinnedId}`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        element.classList.add('highlight-pulse');
                        setTimeout(() => element.classList.remove('highlight-pulse'), 2000);
                      }
                    }}
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0 text-[var(--ck-blue)]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-[var(--text-secondary)]">{senderName}</p>
                      <p className="text-[12px] text-[var(--text-tertiary)] truncate">{pinnedMsg.text || '[Message]'}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPinnedMessages(prev => {
                          const next = new Set(prev);
                          next.delete(pinnedId);
                          return next;
                        });
                        addToast("Message unpinned", "info", 2000);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      title="Unpin"
                    >
                      <svg className="w-4 h-4 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}


        {/* Call section (Voice or Video) */}
        {showVideoCall ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0a0c10', overflow: 'hidden', position: 'relative' }}>
            {callStarted && callData ? (
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <ChannelVideoCall
                  channelId={normalizedChannelId}
                  channelName={channelName}
                  callType={callType}
                  onCallEnd={() => {
                    setShowVideoCall(false);
                    setCallStarted(false);
                    setCallData(null);
                  }}
                  token={callData.token}
                  url={callData.url}
                  roomName={callData.roomName}
                  callId={callData.callId}
                />
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* Close button row */}
                <div style={{
                  display: 'flex', justifyContent: 'flex-end',
                  padding: '12px 16px 0',
                  flexShrink: 0,
                }}>
                  <button
                    onClick={() => {
                      setShowVideoCall(false);
                      setCallStarted(false);
                      setCallData(null);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 34, height: 34, borderRadius: '50%',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(255,255,255,0.06)',
                      color: 'rgba(255,255,255,0.6)',
                      cursor: 'pointer',
                      backdropFilter: 'blur(8px)',
                      transition: 'all 0.2s',
                    }}
                    title="Close video call"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 14, height: 14 }}>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                {/* Call lobby */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 24px 24px' }}>
                  <ChannelCallPrompt
                    channelId={normalizedChannelId}
                    channelName={channelName}
                    callType={callType}
                    autoJoin={true}
                    onStartCall={(token, url, roomName, callId) => {
                      setCallData({ token, url, roomName, callId });
                      setCallStarted(true);
                    }}
                    onJoinCall={(token, url, roomName, callId) => {
                      setCallData({ token, url, roomName, callId });
                      setCallStarted(true);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Messages area */}
        <div className={`flex-1 overflow-y-auto px-0 py-0 space-y-0 ck-scrollbar ${showVideoCall ? 'hidden' : ''}`} id="messages-container">

          {!canAccessChannel ? (
            <div className="flex items-center justify-center h-full px-6 text-center">
              <div>
                <h2 className="text-[18px] font-bold text-[var(--text-primary)] mb-1.5">Private channel</h2>
                <p className="text-[13px] text-[var(--text-secondary)] max-w-sm">
                  You do not have access to this channel.
                </p>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3 text-gray-600">
                <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                <span className="text-[13px]">Loading messages…</span>
              </div>
            </div>
          ) : messages.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full gap-5 px-6 text-center">
              <div>
                <h2 className="text-[18px] font-bold text-[var(--text-primary)] mb-1.5">Chat in #{channelName}</h2>
                <p className="text-[13px] text-[var(--text-secondary)] max-w-sm leading-relaxed">
                  Collaborate seamlessly across tasks and conversations. Start chatting with your team or connect tasks to stay on top of your work.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 w-full max-w-md mt-2">
                <button
                  onClick={() => {
                    setMembersOpen(true);
                    setTimeout(() => memberSearchRef.current?.focus(), 0);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-[var(--border-default)] text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors"
                >
                  <i className="pi pi-plus text-[14px] text-[var(--text-secondary)]" />
                  Add People
                </button>
              </div>
            </div>
          ) : (
            <div className="py-4">
              {messageGroups.map((group, gi) => {
                const firstMsg = group.messages[0];
                const msgId = firstMsg._id ?? '';
                const prevGroupLastMsg =
                  gi > 0
                    ? messageGroups[gi - 1].messages[messageGroups[gi - 1].messages.length - 1]
                    : undefined;
                const showDiv = shouldShowDivider(prevGroupLastMsg, firstMsg);
                const senderName = group.sender
                  ? `${group.sender.firstName} ${group.sender.lastName}`
                  : "Unknown";

                return (
                  <div key={gi}>
                    {showDiv && <DateDivider label={formatDateDivider(firstMsg.createdAt)} />}

                    {/* Message group */}
                    <div id={`msg-${msgId}`} className={`flex px-3 sm:px-5 py-2 ${group.isMe ? "justify-end" : "justify-start"}`}>
                      <div className={`flex gap-2 max-w-[85%] sm:max-w-[72%] ${group.isMe ? "flex-row-reverse" : "flex-row"}`}>
                        {/* Avatar */}
                        <div className="flex-shrink-0 mt-1">
                          {group.isMe ? (
                            <div className={`w-8 h-8 rounded-full ${avatarColor("Admin User")} flex items-center justify-center text-[11px] font-semibold text-white shadow-sm`}>
                              {(currentUser?.firstName?.[0] ?? "A") + (currentUser?.lastName?.[0] ?? "U")}
                            </div>
                          ) : (
                            <Avatar name={senderName} />
                          )}
                        </div>

                        {/* Message bubble with actions */}
                        <div className={`flex flex-col ${group.isMe ? "items-end" : "items-start"} relative group`}>
                          {!group.isMe && (
                            <span className="text-[12px] font-semibold text-[var(--text-primary)] px-3 mb-0.5">
                              {senderName}
                            </span>
                          )}

                          <div className="relative">
                            <div className={`rounded-2xl px-4 py-2 ${group.isMe
                              ? "bg-[var(--bg-surface)] text-[var(--text-primary)] rounded-br-sm border border-[var(--border-subtle)] shadow-sm"
                              : "bg-[var(--bg-surface-2)] text-[var(--text-primary)] rounded-bl-sm border border-[var(--border-subtle)]"
                              }`}>
                              <div className="space-y-1">
                                {group.messages.map((msg, mi) => (
                                  <div key={mi} className={`${msg.local ? "opacity-60" : ""}`}>
                                    {/* Reply Context */}
                                    {msg.replyTo && (
                                      <div className={`mb-2 p-2 rounded border-l-4 ${group.isMe
                                        ? "bg-[var(--bg-surface-3)] border-[var(--text-secondary)]"
                                        : "bg-white border-[var(--ck-blue)]"
                                        }`}>
                                        <p className="text-[10px] font-bold text-[var(--ck-blue)] mb-0.5 uppercase tracking-wide">
                                          ↳ Replied to
                                        </p>
                                        <p className="text-[11px] font-semibold text-[var(--text-primary)] leading-tight">
                                          {msg.replyTo.senderName}
                                        </p>
                                        <p className="text-[11px] text-[var(--text-tertiary)] truncate leading-snug mt-0.5">
                                          {msg.replyTo.text || '[Deleted or unavailable]'}
                                        </p>
                                      </div>
                                    )}

                                    {/* Only render text messages */}
                                    {msg.text ? (
                                      <p className="text-[14px] leading-relaxed break-words">
                                        {renderMessageText(msg.text)}
                                      </p>
                                    ) : null}

                                    {!!msg.attachments?.length && (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {msg.attachments.map((file, fileIndex) => {
                                          const isPdf = file.fileName?.toLowerCase().endsWith('.pdf');
                                          return (
                                            <a
                                              key={`${file.url}-${fileIndex}`}
                                              href={file.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className={`flex items-center gap-3 w-[280px] rounded-lg p-2.5 shadow-sm transition-all group no-underline ${group.isMe
                                                ? "bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-2)] border border-[var(--border-subtle)]"
                                                : "bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-3)] border border-[var(--border-subtle)]"
                                                }`}
                                            >
                                            {/* Document Icon */}
                                            <div className="relative flex-shrink-0 transition-transform">
                                              <img src="/doc-icon.png" alt="Document" className="w-10 h-10 object-contain" />
                                            </div>

                                            {/* Text Content */}
                                            <div className="flex flex-col flex-1 overflow-hidden">
                                              <span className={`text-[13px] font-bold truncate leading-tight mb-0.5 text-[var(--text-primary)]`}>
                                                {file.fileName}
                                              </span>
                                              <span className={`text-[11px] leading-tight truncate text-[var(--text-tertiary)]`}>
                                                {isPdf ? 'PDF Document' : 'Document'} • Click to view
                                              </span>
                                            </div>

                                            {/* Download/View Icon */}
                                            <div className="flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 transition-colors bg-[var(--bg-surface)] border border-[var(--border-subtle)] group-hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)]">
                                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                              </svg>
                                            </div>
                                          </a>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                            {/* Message Actions Button */}
                            <button
                              onClick={() => setActiveActionMenuId(activeActionMenuId === msgId ? null : msgId)}
                              
                              className={`
                                absolute ${group.isMe ? "right-full mr-2" : "left-full ml-2"}
                                top-0 p-1.5 rounded-md
                                opacity-0 group-hover:opacity-100 transition-opacity duration-200
                                hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                                focus:outline-none focus:ring-2 focus:ring-[var(--ck-blue)]
                              `}
                              title="Message actions"
                            >
                              <EllipsisVerticalIcon className="w-4 h-4" />
                            </button>

                            {/* Message Actions Menu */}
                            {activeActionMenuId === msgId && (
                              <div className={`absolute ${group.isMe ? "right-full mr-2" : "left-full ml-2"} top-0 z-30`}>
                                <MessageActions
                                  isOpen={activeActionMenuId === msgId}
                                  onOpenReactions={() => setActiveReactionPickerId(msgId)}
                                  onReply={() => {
                                    const replySenderName = `${firstMsg.sender?.firstName || 'User'} ${firstMsg.sender?.lastName || ''}`.trim();
                                    setReplyingTo({
                                      _id: msgId,
                                      senderName: replySenderName,
                                      messageText: firstMsg.text || '[Deleted or unavailable]'
                                    });
                                    setReply(msgId, replySenderName, firstMsg.text || '[Deleted or unavailable]');
                                    setActiveActionMenuId(null);
                                  }}
                                  onPin={() => {
                                    const messageId = msgId;
                                    const isPinned = pinnedMessages.has(messageId);
                                    setPinnedMessages(prev => {
                                      const next = new Set(prev);
                                      if (next.has(messageId)) {
                                        next.delete(messageId);
                                      } else {
                                        next.add(messageId);
                                      }
                                      return next;
                                    });
                                    setTimeout(() => {
                                      addToast(isPinned ? "Message unpinned" : "Message pinned", isPinned ? "info" : "success", 2000);
                                    }, 0);
                                    setActiveActionMenuId(null);
                                  }}
                                  onClose={() => setActiveActionMenuId(null)}
                                  isPinned={pinnedMessages.has(msgId)}
                                />
                              </div>
                            )}

                            {/* Reaction Picker */}
                            {activeReactionPickerId === msgId && (
                              <ReactionPicker
                                isOpen={activeReactionPickerId === msgId}
                                position={group.isMe ? "left" : "right"}
                                onSelect={(emoji) => {
                                  handleEmojiReaction(msgId, emoji, true);
                                  // Close picker after selection
                                  setActiveReactionPickerId(null);
                                }}
                                onClose={() => setActiveReactionPickerId(null)}
                              />
                            )}
                          </div>

                          {/* Time stamp */}
                          <span className={`text-[11px] mt-1 ${group.isMe ? "text-[var(--text-tertiary)]" : "text-[var(--text-secondary)]"}`}>
                            {formatRelativeTime(firstMsg.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Reaction Bar - Moved outside max-width container */}
                    {(messageReactions.get(msgId)?.length ?? 0) > 0 && (
                      <div className={`flex px-3 sm:px-5 w-full ${group.isMe ? "justify-end" : "justify-start"}`}>
                        <div className="relative flex flex-wrap gap-1 pointer-events-auto z-20">
                          <ReactionBar
                            reactions={messageReactions.get(msgId) || []}
                            onReact={(emoji) => {
                              handleEmojiReaction(msgId, emoji, true);
                            }}
                            onRemoveReaction={(emoji) => {
                              handleEmojiReaction(msgId, emoji, false);
                            }}
                            userReactions={messageReactions.get(msgId)?.map(r => r.emoji) || []}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* Reply Preview */}
        {replyingTo && (
          <div className="px-3 sm:px-6 pt-2">
            <ReplyPreview
              senderName={replyingTo.senderName}
              messageText={replyingTo.messageText}
              onCancel={() => {
                setReplyingTo(null);
                clearReply();
              }}
            />
          </div>
        )}

        {/* Typing Indicator */}
        {typingUsers.size > 0 && !showVideoCall && (
          <div className="px-6 pb-2 flex items-center animate-toast-in">
            <div className="flex -space-x-2 mr-3">
              {Array.from(typingUsers).map((userId) => {
                const member = allUsers.find(u => u._id === userId) || members.find(m => m._id === userId);
                if (!member) return null;
                return (
                  <div key={userId} className="relative z-10 rounded-full ring-2 ring-[var(--bg-canvas)]">
                    <Avatar name={`${member.firstName} ${member.lastName}`} size="sm" />
                  </div>
                );
              })}
            </div>
            <div className="bg-[var(--bg-surface-2)] rounded-full px-3.5 py-2 shadow-sm border border-[var(--border-subtle)] flex items-center gap-1.5 rounded-bl-sm">
              <span className="w-1.5 h-1.5 bg-[var(--text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-1.5 h-1.5 bg-[var(--text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-1.5 h-1.5 bg-[var(--text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          </div>
        )}

        {/* Message composer */}
        <div className={`flex-none px-3 sm:px-6 pb-4 sm:pb-6 pt-2 relative ${showVideoCall ? 'hidden' : ''}`}>
          {canAccessChannel && !canMessageInChannel && !hideJoinPrompt && (
            <div className="mb-2 flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
              <p className="text-[12px] text-[var(--text-secondary)]">
                {channelConfig?.isPrivate
                  ? "You were added to this private channel. Join to start messaging."
                  : "This channel is public. Join it to post messages."}
              </p>
              <button
                onClick={handleJoinChannel}
                disabled={isJoiningChannel}
                className="px-3 py-1 rounded-md text-[12px] font-semibold bg-[var(--ck-blue)] text-white hover:opacity-90 transition-opacity"
              >
                {isJoiningChannel ? "Joining..." : "Join"}
              </button>
            </div>
          )}

          <div className="relative">
            <MentionDropdown
              members={mentionSuggestions}
              query={mentionQuery}
              onSelect={handleMentionSelect}
              visible={mentionVisible}
            />

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => void handleFileUpload(e.target.files)}
            />

            <div className="relative rounded-xl border border-[var(--border-default)] bg-[var(--bg-canvas)] transition-all shadow-sm">
              {!!pendingAttachments.length && (
                <div className="px-3 pt-4 pb-1 flex flex-wrap gap-3">
                  {pendingAttachments.map((file, index) => {
                    // Quick check if it's a PDF for icon styling
                    const isPdf = file.fileName?.toLowerCase().endsWith('.pdf');
                    return (
                      <div
                        key={`${file.url}-${index}`}
                        className="flex items-center justify-between w-[320px] rounded-lg bg-[var(--bg-surface-2)] p-2.5 shadow border border-[var(--border-subtle)] group"
                      >
                        <div className="flex items-center gap-3">
                          {/* Document Icon */}
                          <div className="flex-shrink-0 mt-0.5">
                            <img src="/doc-icon.png" alt="Document" className="w-10 h-10 object-contain" />
                          </div>

                          {/* Text Content */}
                          <div className="flex flex-col flex-1 overflow-hidden">
                            <span className="text-[13px] font-bold text-white truncate leading-tight mb-0.5">
                              {file.fileName}
                            </span>
                            <span className="text-[11.5px] text-[var(--text-tertiary)] leading-tight truncate">
                              Anyone with the link can edit
                            </span>
                          </div>
                        </div>

                        {/* Close Button */}
                        <button
                          onClick={() => removePendingAttachment(index)}
                          className="flex items-center justify-center w-6 h-6 text-[var(--text-tertiary)] hover:text-white transition-colors ml-2 flex-shrink-0"
                          title="Remove file"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Textarea */}
              <div className="px-3 pt-3 pb-2">
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  placeholder={`Write to ${channelName}, press 'space' for AI, '/' for commands`}
                  className="w-full bg-transparent border-gray-300 outline-none text-[13px] placeholder-[var(--text-tertiary)] resize-none min-h-[24px] max-h-[160px] leading-relaxed"
                  rows={1}
                  disabled={!canAccessChannel || !canMessageInChannel}
                />
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-between px-2 pb-2 mt-1">
                <div className="flex items-center gap-1">
                  <ToolBtn icon={<i className="pi pi-plus" />} title="Add" />

                  <button className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-[var(--bg-surface-2)] text-[12px] font-medium text-[var(--text-secondary)] transition-colors">
                    Message <i className="pi pi-chevron-right text-[10px]" />
                  </button>

                  <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />

                  <ToolBtn
                    icon={<span className="font-bold text-[14px]">@</span>}
                    title="Mention"
                    onClick={() => {
                      setNewMessage((m) => m + "@");
                      setMentionQuery("");
                      setMentionVisible(true);
                      textareaRef.current?.focus();
                    }}
                  />
                  <ToolBtn
                    icon={<i className="pi pi-paperclip" />}
                    title="File"
                    onClick={() => fileInputRef.current?.click()}
                  />
                  <ToolBtn
                    icon={<i className="pi pi-face-smile" />}
                    title="Emoji"
                    onClick={() => setEmojiPickerOpen((open) => !open)}
                  />
                  <ToolBtn icon={<span className="font-bold text-[13px]">/</span>} title="Commands" />
                </div>

                {/* Send button */}
                <button
                  onClick={handleSendMessage}
                  disabled={(!newMessage.trim() && pendingAttachments.length === 0) || !canAccessChannel || !canMessageInChannel || isUploadingFiles}
                  className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Send message"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>

              {emojiPickerOpen && (
                <div className="absolute bottom-[48px] right-2 z-30 w-[260px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] shadow-xl p-2">
                  <p className="text-[11px] text-[var(--text-tertiary)] px-1 pb-1">Pick an emoji</p>
                  <div className="grid grid-cols-6 gap-1">
                    {quickEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => addEmojiToComposer(emoji)}
                        className="h-8 rounded-md hover:bg-[var(--bg-surface-2)] text-[18px]"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── FOLLOWERS PANEL ── */}
      {/* Mobile overlay backdrop */}
      {membersOpen && (
        <div
          className="fixed inset-0 bg-black/30 md:hidden z-40"
          onClick={() => setMembersOpen(false)}
        />
      )}

      {/* Members panel - hidden on mobile, visible on desktop */}
      {membersOpen && (
        <aside className="hidden md:flex w-[300px] flex-shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex-col shadow-[-4px_0_24px_rgba(0,0,0,0.02)] z-20">
          <div className="flex items-center justify-between px-4 py-3 pb-2 border-b border-[var(--border-subtle)]">
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">Followers</span>
            <button onClick={() => setMembersOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-md bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex items-center gap-4 px-4 pt-2 border-b border-[var(--border-subtle)]">
            <button
              onClick={() => setActivePeopleTab("followers")}
              className={`pb-2 text-[13px] transition-colors border-b-2 ${activePeopleTab === "followers"
                ? "font-semibold text-[var(--text-primary)] border-[var(--text-primary)]"
                : "font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-transparent"
                }`}
            >
              Followers <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--bg-surface-3)] text-[10px] ml-1">{canMessageInChannel ? members.length : 0}</span>
            </button>
            <button
              onClick={() => setActivePeopleTab("access")}
              className={`pb-2 text-[13px] transition-colors border-b-2 ${activePeopleTab === "access"
                ? "font-semibold text-[var(--text-primary)] border-[var(--text-primary)]"
                : "font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-transparent"
                }`}
            >
              Access <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--bg-surface-2)] text-[10px] ml-1">{accessMembers.length}</span>
            </button>
          </div>

          {activePeopleTab === "followers" ? (
            <>
              <div className="flex-1 overflow-y-auto ck-scrollbar py-2 px-1 space-y-0.5">
                {!canMessageInChannel ? (
                  <div className="px-3 py-3 text-[12px] text-[var(--text-tertiary)]">
                    Join this channel to view all existing members.
                  </div>
                ) : (
                  <>
                    {canManageMembers && (
                      <div className="pb-2 border-b border-[var(--border-subtle)]">
                        <div className="px-3">
                          <div className="relative flex items-center">
                            <svg className="absolute left-3 w-4 h-4 text-[var(--text-tertiary)]" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                            <input
                              ref={memberSearchRef}
                              type="text"
                              placeholder="Search people or invite by email"
                              value={addMemberQuery}
                              onChange={(e) => setAddMemberQuery(e.target.value)}
                              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[13px] bg-transparent focus:border-[var(--ck-blue)] focus:ring-1 focus:ring-[var(--ck-blue-hover)] outline-none transition-all placeholder-[var(--text-tertiary)]"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {canManageMembers && addMemberQuery.trim() && (
                      <>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] px-3 pt-1 pb-1">
                          SEARCH RESULTS
                        </p>
                        {filteredAddableUsers.map((user) => (
                          <button
                            key={`add-${user._id}`}
                            onClick={() => handleAddMember(user)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--bg-surface-2)] transition-colors text-left group"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                                  {user.firstName} {user.lastName}
                                </p>
                                {user.email && (
                                  <p className="text-[11px] text-[var(--text-tertiary)] truncate">{user.email}</p>
                                )}
                              </div>
                            </div>
                            <div className="px-2 py-1 rounded-md bg-[var(--bg-surface-3)] text-[11px] font-medium text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 group-hover:bg-[var(--ck-blue)] group-hover:text-white transition-all">
                              Add
                            </div>
                          </button>
                        ))}
                        {filteredAddableUsers.length === 0 && (
                          <div className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">
                            No users found.
                          </div>
                        )}
                        <div className="mx-2 my-1 h-px bg-[var(--border-subtle)]" />
                      </>
                    )}

                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] px-3 pt-1 pb-1">
                      FOLLOWERS
                    </p>

                    {!channelConfig?.isPrivate && (
                      <p className="px-3 pb-1 text-[12px] font-semibold text-[var(--text-secondary)]">
                        Everyone !!
                      </p>
                    )}

                    {canManageMembers && (
                      <button
                        onClick={() => memberSearchRef.current?.focus()}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface-2)] transition-colors text-left group"
                      >
                        <div className="w-7 h-7 rounded-full bg-[var(--bg-surface-3)] text-[var(--text-secondary)] border border-dashed border-[var(--border-hover)] flex items-center justify-center group-hover:border-[var(--text-secondary)] transition-colors">
                          <i className="pi pi-plus" />
                        </div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)]">Add People</span>
                      </button>
                    )}

                    {members.map((m) => (
                      <div
                        key={m._id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface-2)] transition-colors cursor-pointer group"
                      >
                        <div className="relative">
                          <Avatar name={`${m.firstName} ${m.lastName}`} size="sm" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                            {m.firstName} {m.lastName}
                          </p>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto ck-scrollbar py-2 px-1 space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] px-3 pt-1 pb-1">
                CAN ADD MEMBERS
              </p>
              {accessMembers.map((user) => (
                <div
                  key={`access-${user._id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface-2)] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                        {user.firstName} {user.lastName}
                      </p>
                      {user.email && (
                        <p className="text-[11px] text-[var(--text-tertiary)] truncate">{user.email}</p>
                      )}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--bg-surface-3)] text-[var(--text-secondary)]">
                    {isAdmin ? "Admin" : "Member"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      {/* Mobile members panel overlay */}
      {membersOpen && (
        <div className="fixed inset-0 md:hidden flex flex-col z-40 bg-[var(--bg-canvas)]">
          {/* Mobile header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">Followers</span>
            <button onClick={() => setMembersOpen(false)} className="p-1.5 rounded-md hover:bg-[var(--bg-surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-4 px-4 pt-2 border-b border-[var(--border-subtle)]">
            <button
              onClick={() => setActivePeopleTab("followers")}
              className={`pb-2 text-[13px] transition-colors border-b-2 whitespace-nowrap ${activePeopleTab === "followers"
                ? "font-semibold text-[var(--text-primary)] border-[var(--text-primary)]"
                : "font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-transparent"
                }`}
            >
              Followers
            </button>
            <button
              onClick={() => setActivePeopleTab("access")}
              className={`pb-2 text-[13px] transition-colors border-b-2 whitespace-nowrap ${activePeopleTab === "access"
                ? "font-semibold text-[var(--text-primary)] border-[var(--text-primary)]"
                : "font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-transparent"
                }`}
            >
              Access
            </button>
          </div>

          {/* Mobile members list */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {activePeopleTab === "followers" ? (
              <>
                {members.map((m) => (
                  <div
                    key={m._id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface-2)] transition-colors"
                  >
                    <div className="relative">
                      <Avatar name={`${m.firstName} ${m.lastName}`} size="sm" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                        {m.firstName} {m.lastName}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <>
                {accessMembers.map((user) => (
                  <div
                    key={`access-${user._id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface-2)] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                          {user.firstName} {user.lastName}
                        </p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[9px] font-semibold bg-[var(--bg-surface-3)] text-[var(--text-secondary)] flex-shrink-0">
                      {isAdmin ? "Admin" : "Member"}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* Highlight animation for pinned messages */}
      <style>{`
        @keyframes highlight-pulse {
          0% {
            background-color: transparent;
          }
          50% {
            background-color: rgba(59, 130, 246, 0.1);
          }
          100% {
            background-color: transparent;
          }
        }
        .highlight-pulse {
          animation: highlight-pulse 2s ease-in-out;
        }
      `}</style>

      {/* Toasts */}
      <ToastContainer toasts={toasts} remove={removeToast} />
    </div>
  );
}

/* ─── Toolbar button ─────────────────────────────────────────── */
function ToolBtn({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#1e1f2c] text-gray-500 hover:text-gray-300 transition-colors"
    >
      {icon}
    </button>
  );
}
