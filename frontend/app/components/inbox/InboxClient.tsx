"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { inboxApi, type InboxMessage } from "../../../src/api/inbox.api";
import {
  EnvelopeIcon,
  EnvelopeOpenIcon,
  TrashIcon,
  CheckIcon,
  BellAlertIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

type InboxFilter = "unread" | "read";

export default function InboxClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<InboxFilter>("unread");
  const queryClient = useQueryClient();

  const { data: inboxData, isLoading } = useQuery({
    queryKey: ["inbox-messages"],
    queryFn: () => inboxApi.getMessages(100, 0),
    staleTime: 30 * 1000,
  });

  const markAsReadMutation = useMutation({
    mutationFn: (messageId: string) => inboxApi.markMessageAsRead(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-messages", activeFilter] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => inboxApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-messages", activeFilter] });
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: (messageId: string) => inboxApi.deleteMessage(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-messages", activeFilter] });
    },
  });

  // Add reply mutation
  const addReplyMutation = useMutation({
    mutationFn: (data: { messageId: string; message: string }) => inboxApi.addReply(data.messageId, data.message),
    onSuccess: () => {
      // Invalidate all inbox queries (all filters) since replies can appear in multiple tabs
      queryClient.invalidateQueries({ queryKey: ["inbox-messages"] });
      setReplyText({});
    },
  });

  const messages = inboxData?.messages || [];
  const unreadCount = inboxData?.unreadCount || 0;
  const readCount = Math.max(messages.length - unreadCount, 0);

  const visibleMessages = useMemo(() => {
    if (filter === "unread") return messages.filter((m) => !m.isRead);
    return messages.filter((m) => m.isRead);
  }, [filter, messages]);

  const getStatusBadgeColor = (status: string | undefined) => {
    switch (status) {
      case "to-do":
        return "bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)]";
      case "in-progress":
        return "bg-blue-500/10 text-blue-500 border border-blue-500/30";
      case "completed":
        return "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30";
      default:
        return "bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)]";
    }
  };

  const getMessageIcon = (type: string) => {
    switch (type) {
      case "task-assigned":
        return "📌";
      default:
        return "📧";
    }
  };

  const senderInitials = (message: InboxMessage) => {
    if (!message.senderId) return "U";
    const first = message.senderId.firstName?.charAt(0) || "";
    const last = message.senderId.lastName?.charAt(0) || "";
    const initials = `${first}${last}`.toUpperCase();
    return initials || "U";
  };

  const toggleExpanded = (messageId: string) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId);
    } else {
      newExpanded.add(messageId);
      if (!messages.find((m) => m._id === messageId)?.isRead) {
        markAsReadMutation.mutate(messageId);
      }
    }
    setExpandedMessages(newExpanded);
  };

  const handleNavigateToTask = (message: InboxMessage) => {
    // Navigate to task page with filter and task ID
    const taskId = message.taskId || "";
    const taskName = message.taskName || "";
    router.push(`/dashboard/tasks?filter=assigned&taskId=${taskId}&scrollTo=${taskName}`);
  };

  // Auto-expand notification from query parameter (when clicked from toast)
  useEffect(() => {
    const expandNotificationId = searchParams.get("expandNotification");
    if (expandNotificationId && messages.length > 0) {
      const notification = messages.find(m => m._id === expandNotificationId);
      if (notification) {
        // Expand the notification
        setExpandedMessages(new Set([expandNotificationId]));

        // Scroll to the notification after a short delay
        setTimeout(() => {
          const element = document.getElementById(`notification-${expandNotificationId}`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 300);
      }
    }
  }, [searchParams, messages]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-[var(--bg-canvas)]">
        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-[var(--border-subtle)]">
          <div className="h-7 w-40 rounded-md bg-[var(--bg-surface-2)] animate-pulse" />
          <div className="h-4 w-64 rounded-md bg-[var(--bg-surface-2)] animate-pulse mt-2" />
        </div>
        <div className="p-4 sm:p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
            >
              <div className="h-4 w-48 rounded bg-[var(--bg-surface-2)] animate-pulse" />
              <div className="h-3 w-full rounded bg-[var(--bg-surface-2)] animate-pulse mt-3" />
              <div className="h-3 w-4/5 rounded bg-[var(--bg-surface-2)] animate-pulse mt-2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-canvas)]">
      <div className="border-b border-[var(--border-subtle)] px-4 sm:px-6 pt-4 sm:pt-5 pb-4 bg-[var(--bg-canvas)]">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] flex items-center justify-center">
                  <BellAlertIcon className="w-4 h-4 text-[var(--ck-blue)]" />
                </div>
                <h1 className="text-[18px] sm:text-[20px] font-semibold text-[var(--text-primary)]">Inbox</h1>
              </div>
              <p className="text-[12px] sm:text-[13px] text-[var(--text-secondary)] mt-2">
                Stay on top of task assignments and status updates.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-secondary)]">
                <ClockIcon className="w-3.5 h-3.5" />
                Auto refresh: 30s
              </div>

              {unreadCount > 0 && (
                <button
                  onClick={() => markAllAsReadMutation.mutate()}
                  disabled={markAllAsReadMutation.isPending}
                  className="px-3 py-1.5 rounded-lg bg-[var(--ck-blue)]/10 text-[var(--ck-blue)] hover:bg-[var(--ck-blue)]/20 text-[12px] font-medium transition-colors disabled:opacity-50"
                >
                  {markAllAsReadMutation.isPending ? "Marking..." : "Mark all read"}
                </button>
              )}
            </div>
          </div>

          <div className="inline-flex items-center p-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] w-fit">
            <FilterChip
              label={`Unread (${unreadCount})`}
              active={filter === "unread"}
              onClick={() => setFilter("unread")}
            />
            <FilterChip
              label={`Read (${readCount})`}
              active={filter === "read"}
              onClick={() => setFilter("read")}
            />
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-[var(--border-subtle)]">
          {(["all", "tasks", "mention", "comment_reply"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`pb-3 px-3 text-[12px] sm:text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeFilter === filter
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {filter === "all" && "All"}
              {filter === "tasks" && "Tasks"}
              {filter === "mention" && "Mentions"}
              {filter === "comment_reply" && "Replies"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 sm:py-5">
        {visibleMessages.length === 0 ? (
          <div className="h-full min-h-[260px] rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] flex items-center justify-center mb-4">
              <EnvelopeOpenIcon className="w-7 h-7 text-[var(--text-muted)]" />
            </div>
            <p className="text-[15px] font-semibold text-[var(--text-primary)]">
              {`No ${filter} messages`}
            </p>
            <p className="text-[12px] sm:text-[13px] text-[var(--text-secondary)] mt-1 max-w-md">
              You will see task assignment updates, progress changes, and team notifications here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visibleMessages.map((message) => {
              const isExpanded = expandedMessages.has(message._id);
              const isUnread = !message.isRead;

              return (
                <div
                  id={`notification-${message._id}`}
                  key={message._id}
                  className={`rounded-xl border transition-all ${isUnread
                      ? "border-[var(--ck-blue)]/40 bg-[var(--ck-blue)]/5"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                    }`}
                >
                  <div
                    onClick={() => toggleExpanded(message._id)}
                    className="px-4 sm:px-5 py-4 cursor-pointer hover:bg-[var(--bg-surface-2)]/60 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {message.type === "task-status-changed" && message.senderId ? (
                        <div
                          className="w-9 h-9 rounded-full bg-gray-700 text-white border border-[var(--border-subtle)] flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
                          title={`${message.senderId.firstName} ${message.senderId.lastName}`}
                        >
                          {senderInitials(message)}
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] flex items-center justify-center text-[16px] flex-shrink-0">
                          {getMessageIcon(message.type)}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-[var(--text-primary)] text-[14px]">{message.title}</h3>
                              {isUnread && (
                                <div className="w-2 h-2 rounded-full bg-[var(--ck-blue)] flex-shrink-0" />
                              )}
                            </div>
                            <p className="text-[13px] text-[var(--text-secondary)] mt-1 line-clamp-2">{message.message}</p>

                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className="px-2 py-1 rounded-md bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[11px]">
                                {message.taskName}
                              </span>
                              {message.type === "task-status-changed" && message.newStatus && (
                                <>
                                  <span className="text-[11px] text-[var(--text-muted)]">→</span>
                                  <span className={`px-2 py-1 rounded-md text-[11px] font-medium ${getStatusBadgeColor(message.newStatus)}`}>
                                    {message.newStatus}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <span className="text-[11px] text-[var(--text-muted)]">{formatDate(message.createdAt)}</span>
                            <div className="flex items-center gap-1">
                              {!isUnread && (
                                <i className="pi pi-envelope-open text-[14px] text-[var(--text-muted)]" />
                              )}
                              {isUnread && <EnvelopeIcon className="w-4 h-4 text-[var(--ck-blue)]" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] space-y-3">
                        <div className="bg-[var(--bg-canvas)] rounded-lg border border-[var(--border-subtle)] p-3 space-y-2 text-sm">
                          <p className="text-[var(--text-primary)] leading-relaxed">{message.message}</p>

                          {message.type === "task-status-changed" && (
                            <div className="flex items-center gap-2 text-[var(--text-muted)]">
                              <span className={`px-2 py-1 rounded-md text-[11px] font-medium ${getStatusBadgeColor(message.previousStatus)}`}>
                                {message.previousStatus}
                              </span>
                              <span>→</span>
                              <span className={`px-2 py-1 rounded-md text-[11px] font-medium ${getStatusBadgeColor(message.newStatus)}`}>
                                {message.newStatus}
                              </span>
                            </div>
                          )}

                          {message.senderId && (
                            <div className="text-[12px] text-[var(--text-muted)]">
                              From: <strong>{message.senderId.firstName} {message.senderId.lastName}</strong> ({message.senderId.email})
                            </div>
                          )}

                          <div className="text-[11px] text-[var(--text-muted)]">
                            {new Date(message.createdAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                          {activeFilter !== "all" && isUnread && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markAsReadMutation.mutate(message._id);
                              }}
                              disabled={markAsReadMutation.isPending}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 text-[12px] font-medium transition-colors disabled:opacity-50"
                            >
                              <i className="pi pi-check" />
                              Mark as read
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMessageMutation.mutate(message._id);
                            }}
                            disabled={deleteMessageMutation.isPending}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 text-[12px] font-medium transition-colors disabled:opacity-50"
                          >
                            <TrashIcon className="w-4 h-4" />
                            Delete
                          </button>
                        </div>

                        {/* Replies Section - Only for comment replies, not in "all" section or mentions */}
                        {activeFilter !== "all" && message.type === "comment_reply" && message.replies && message.replies.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                            <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-3">Replies ({message.replies.length})</h4>
                            <div className="space-y-2">
                              {message.replies.map((reply, idx) => (
                                <div key={idx} className="bg-[var(--bg-surface-2)] rounded-lg p-3 text-sm">
                                  <div className="flex items-start justify-between gap-2 mb-1">
                                    <strong className="text-[var(--text-primary)] text-xs">{reply.senderName}</strong>
                                    <span className="text-xs text-[var(--text-muted)]">{formatDate(reply.createdAt)}</span>
                                  </div>
                                  <p className="text-[var(--text-secondary)] text-xs">{reply.message}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Reply Input - Only for comment replies, not in "all" section or mentions */}
                        {activeFilter !== "all" && message.type === "comment_reply" && (
                          <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]" onClick={(e) => e.stopPropagation()}>
                            <form onSubmit={(e) => {
                              e.preventDefault();
                              if (replyText[message._id]?.trim()) {
                                addReplyMutation.mutate({
                                  messageId: message._id,
                                  message: replyText[message._id]
                                });
                              }
                            }} className="flex gap-2">
                              <input
                                type="text"
                                value={replyText[message._id] || ""}
                                onChange={(e) => setReplyText({...replyText, [message._id]: e.target.value})}
                                placeholder="Add a reply..."
                                disabled={addReplyMutation.isPending}
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1 px-3 py-1.5 bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-50"
                              />
                              <button
                                type="submit"
                                disabled={addReplyMutation.isPending || !replyText[message._id]?.trim()}
                                onClick={(e) => e.stopPropagation()}
                                className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                              >
                                {addReplyMutation.isPending ? "Sending..." : "Reply"}
                              </button>
                            </form>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${active
          ? "bg-[var(--bg-canvas)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
          : "bg-transparent text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)]"
        }`}
    >
      {label}
    </button>
  );
}
