"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, memo, Suspense, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { authApi } from "../../src/api/auth.api";
import { channelsApi } from "../../src/api/channels.api";
import { inboxApi } from "../../src/api/inbox.api";
import { projectsApi } from "../../src/api/projects.api";
import { teamsApi } from "../../src/api/teams.api";
import { useNotifications } from "../hooks/useNotifications";
import { SkeletonSidebarItems } from "./Skeleton";

/* ─── Types ─────────────────────────────────────────────────── */
type ChannelMember = { _id: string; firstName: string; lastName: string; email?: string };
type StoredChannel = {
  id: string;
  name: string;
  members?: ChannelMember[];
  isPrivate?: boolean;
  createdBy?: string;
  joinedMemberIds?: string[];
  joined?: boolean;
};
type SidebarProject = {
  _id: string;
  projectName: string;
  team?: { _id: string; teamName: string };
  assignedUsers?: Array<{ _id: string; firstName: string; lastName: string }>;
};
type GroupedProjects = { id: string; name: string; projects: SidebarProject[] };
type User = { _id?: string; id?: string; firstName: string; lastName: string; email: string; role?: "admin" | "user"; avatar?: string };

interface SidebarProps { userRole?: "admin" | "user"; }

/* ─── Task Filters (uses searchParams, needs Suspense) ───────── */
const TaskFilters = memo(function TaskFilters({
  pathname, user, onNavigate,
}: { pathname: string; myTasksOpen: boolean; user: User | null; onNavigate: (url: string) => void }) {
  const searchParams = useSearchParams();
  const items = [
    {
      key: "assigned", href: "/dashboard/tasks?filter=assigned", label: "Assigned to me",
      icon: "pi pi-user",
      isActive: pathname === "/dashboard/tasks" && searchParams.get("filter") === "assigned",
    },
    {
      key: "all", href: "/dashboard/tasks", label: "All Tasks",
      icon: "pi pi-list-check",
      isActive: pathname === "/dashboard/tasks" && !searchParams.get("filter"),
    },
    {
      key: "created", href: "/dashboard/tasks?filter=created", label: "Personal List",
      icon: "pi pi-file-edit",
      isActive: pathname === "/dashboard/tasks" && searchParams.get("filter") === "created",
    },
  ];
  return (
    <div className="py-0.5 space-y-0.5">
      {items.map((item) => (
        <NavItem key={item.key} icon={item.icon} label={item.label} active={item.isActive}
          onClick={() => onNavigate(item.href)} indent />
      ))}
    </div>
  );
});

/* ─── Reusable NavItem ───────────────────────────────────────── */
function NavItem({
  icon, label, active, onClick, badge, indent, isCollapsed, children,
}: {
  icon: string; label: string; active?: boolean; onClick?: () => void;
  badge?: number | string; indent?: boolean; isCollapsed?: boolean; children?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-pr-tooltip={label}
      data-pr-position="right"
      data-pr-at="right+10 center"
      className={`nav-item-tooltip w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-left transition-all duration-150 group relative
        ${indent && !isCollapsed ? "pl-7" : ""}
        ${active
          ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] font-medium"
          : "text-[var(--text-secondary)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)]"
        }
        ${isCollapsed ? "justify-center px-0" : ""}
      `}
    >
      <i className={`${icon} text-[14px] flex-shrink-0 ${active ? "text-white" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"} ${isCollapsed ? "mx-auto" : ""}`} />
      {!isCollapsed && <span className="truncate flex-1">{label}</span>}
      {children}
      {!isCollapsed && badge !== undefined && (
        <span className={`ml-auto text-[11px] px-1.5 py-0.5 rounded-md font-medium flex-shrink-0
          ${active ? "bg-white/20 text-white" : "bg-[var(--badge-bg)] text-[var(--badge-text)]"}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

/* ─── Section Header ─────────────────────────────────────────── */
function SectionHeader({
  label, onAdd, onToggle, isOpen, isCollapsed,
}: { label: string; onAdd?: () => void; onToggle?: () => void; isOpen?: boolean; isCollapsed?: boolean }) {
  if (isCollapsed) return <div className="mx-4 my-4 h-px bg-[var(--border-subtle)]" />;
  
  return (
    <div
      className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all duration-150 group ${active
        ? "bg-[var(--accent-light)] text-[var(--text-primary)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]"
        } ${href ? "cursor-pointer" : ""}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2 overflow-hidden flex-1">
        {icon && (
          <div className={`flex-shrink-0 ${active ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"}`}>
            {icon}
          </div>
        )}
        <span className="truncate text-[12px] font-medium">{label}</span>
      </div>
      {rightText && (
        <span className={`text-[11px] flex-shrink-0 ml-1 ${active ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
          {rightText}
        </span>
      )}
    </div>
  );
}

/* ─── Main Sidebar ───────────────────────────────────────────── */
export default function Sidebar({ userRole }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  /* Dropdowns */
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* Password modal */
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  /* Collapsibles */
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load and persist collapse state
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setIsCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(isCollapsed));
    // Update CSS variable for the layout if needed
    document.documentElement.style.setProperty("--sidebar-width", isCollapsed ? "72px" : "260px");
  }, [isCollapsed]);
  const [channelsExpanded, setChannelsExpanded] = useState(false);
  const [spacesOpen, setSpacesOpen] = useState(true);
  const [teamsOpen, setTeamsOpen] = useState(true);
  const [openTeamIds, setOpenTeamIds] = useState<Record<string, boolean>>({});
  const [expandedProjectTeams, setExpandedProjectTeams] = useState<Record<string, boolean>>({});
  const [myTasksOpen, setMyTasksOpen] = useState(false);
  const [showAllTeams, setShowAllTeams] = useState(false);
  const [teamSearch, setTeamSearch] = useState("");

  /* Channels */
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [channelSearch, setChannelSearch] = useState("");
  const CHANNEL_SIDEBAR_LIMIT = 5;

  /* Create Channel modal */
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelPrivacy, setNewChannelPrivacy] = useState<"public" | "private">("public");
  const [allUsers, setAllUsers] = useState<ChannelMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<ChannelMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);

  /* Create Team modal */
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDesc, setNewTeamDesc] = useState("");
  const [newTeamPrivate, setNewTeamPrivate] = useState(false);
  const [teamMemberSearch, setTeamMemberSearch] = useState("");
  const [selectedTeamMemberIds, setSelectedTeamMemberIds] = useState<string[]>([]);
  const [teamCreateError, setTeamCreateError] = useState("");
  const [isTeamCreating, setIsTeamCreating] = useState(false);

  /* Derived */
  const isAdmin = userRole === "admin";
  const currentUserId =
    (user as any)?._id || (user as any)?.id || (user as any)?.userId || "";

  /* ── Queries ── */
  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects", isAdmin ? "admin" : "user"],
    queryFn: isAdmin ? projectsApi.getAllProjects : projectsApi.getMyProjects,
    enabled: !!userRole,
    staleTime: 5 * 60 * 1000,
  });
  const projects: SidebarProject[] = (projectsData?.data || []) as SidebarProject[];

  const { data: teamsData, isLoading: teamsLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: teamsApi.getTeams,
    enabled: !!userRole,
    staleTime: 5 * 60 * 1000,
  });
  const teams = teamsData?.data || [];

  const { data: teamUsersData, isLoading: teamUsersLoading } = useQuery({
    queryKey: ["users-dropdown"],
    queryFn: projectsApi.getAllUsersForDropdown,
    enabled: !!userRole,
    staleTime: 5 * 60 * 1000,
  });
  const teamUsers = teamUsersData?.data || [];

  const { data: inboxUnreadData } = useQuery({
    queryKey: ["inbox-unread-count"],
    queryFn: inboxApi.getUnreadCount,
    enabled: !!userRole,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
  const unreadInboxCount = inboxUnreadData?.unreadCount || 0;

  const normalizedTeamSearch = teamSearch.trim().toLowerCase();
  const filteredTeams = useMemo(() =>
    teams.filter((team: { teamName?: string }) =>
      (team.teamName || "").toLowerCase().includes(normalizedTeamSearch)
    ), [teams, normalizedTeamSearch]);

  const TEAM_SIDEBAR_LIMIT = 4;
  const hasActiveTeamSearch = normalizedTeamSearch.length > 0;
  const teamsToShow = hasActiveTeamSearch || showAllTeams ? filteredTeams : filteredTeams.slice(0, TEAM_SIDEBAR_LIMIT);
  const canToggleMoreTeams = !hasActiveTeamSearch && filteredTeams.length > TEAM_SIDEBAR_LIMIT;

  const groupedProjectsByTeam = useMemo<GroupedProjects[]>(() => {
    const groups = new Map<string, GroupedProjects>();
    for (const team of teams) groups.set(team._id, { id: team._id, name: team.teamName, projects: [] });
    for (const project of projects) {
      const teamId = project.team?._id;
      const teamName = project.team?.teamName || "Ungrouped";
      if (!teamId) {
        if (!groups.has("ungrouped")) groups.set("ungrouped", { id: "ungrouped", name: "Ungrouped", projects: [] });
        groups.get("ungrouped")!.projects.push(project);
        continue;
      }
      if (!groups.has(teamId)) groups.set(teamId, { id: teamId, name: teamName, projects: [] });
      groups.get(teamId)!.projects.push(project);
    }
    return Array.from(groups.values());
  }, [projects, teams]);

  const visibleChannels = useMemo(() => {
    if (!channelSearch.trim()) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(channelSearch.toLowerCase().trim()));
  }, [channels, channelSearch]);

  const PROJECT_SIDEBAR_LIMIT = 4;

  /* ── Effects ── */
  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    const loadUser = () => {
      const storedUser = localStorage.getItem("user");
      if (storedUser) { try { setUser(JSON.parse(storedUser)); } catch { } }
    };
    
    loadUser();

    if (typeof window !== "undefined") {
      const storedTheme = localStorage.getItem("theme-mode");
      const isDark = storedTheme ? storedTheme === "dark" : document.documentElement.classList.contains("dark");
      setIsDarkMode(isDark);
      if (isDark) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");

      // Listen for profile updates from settings page
      window.addEventListener("user-profile-updated", loadUser);
      
      const loadTheme = () => {
        const storedTheme = localStorage.getItem("theme-mode");
        const isDark = storedTheme === "dark" || document.documentElement.classList.contains("dark");
        setIsDarkMode(isDark);
      };
      
      const loadAccentColor = () => {
        const color = localStorage.getItem("accent-color");
        if (color) {
          const root = document.documentElement;
          root.style.setProperty("--accent", color);
          root.style.setProperty("--ring", color);
          root.style.setProperty("--sidebar-ring", color);
          root.style.setProperty("--ck-blue", color);
          root.style.setProperty("--chart-1", color);
          root.style.setProperty("--accent-hover", color + "CC");
        }
      };

      window.addEventListener("appearance-updated", loadTheme);
      window.addEventListener("accent-color-updated", loadAccentColor);

      loadAccentColor(); // Apply on mount

      return () => {
        window.removeEventListener("user-profile-updated", loadUser);
        window.removeEventListener("appearance-updated", loadTheme);
        window.removeEventListener("accent-color-updated", loadAccentColor);
      };
    }
  }, []);

  useEffect(() => {
    const loadChannels = async () => {
      try {
        const data = await channelsApi.getChannels();
        setChannels(data as unknown as StoredChannel[]);
      } catch (error) {
        setChannels([]);
      }
    };
    loadChannels();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsDropdownOpen(false);
    };
    if (isDropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  /* ── Handlers ── */
  const navigateTo = (url: string) => { router.push(url); };

  const toggleTheme = () => {
    const newDark = !isDarkMode;
    setIsDarkMode(newDark);
    if (newDark) { document.documentElement.classList.add("dark"); localStorage.setItem("theme-mode", "dark"); }
    else { document.documentElement.classList.remove("dark"); localStorage.setItem("theme-mode", "light"); }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    // Dispatch custom event to trigger notification refresh on sign in
    window.dispatchEvent(new CustomEvent("authChange"));
    window.location.href = "/";
  };

  const getApiErrorMessage = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as { error?: string; message?: string } | undefined;
      return data?.error || data?.message || err.message || fallback;
    }
    if (err instanceof Error) return err.message;
    return fallback;
  };

  /* Password modal */
  const openPasswordModal = () => {
    setPasswordError(""); setPasswordSuccess("");
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setIsPasswordModalOpen(true); setIsDropdownOpen(false);
  };
  const closePasswordModal = () => {
    setIsPasswordModalOpen(false); setPasswordError(""); setPasswordSuccess("");
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  };
  const handlePasswordFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPasswordForm((prev) => ({ ...prev, [name]: value }));
  };
  const handlePasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordError(""); setPasswordSuccess("");
    if (!passwordForm.currentPassword) { setPasswordError("Current password is required"); return; }
    if (!passwordForm.newPassword) { setPasswordError("New password is required"); return; }
    if (passwordForm.newPassword.length < 6) { setPasswordError("Min 6 characters"); return; }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setPasswordError("Passwords don't match"); return; }
    try {
      setIsPasswordLoading(true);
      const result = await authApi.changePassword(passwordForm.currentPassword, passwordForm.newPassword, passwordForm.confirmPassword);
      setPasswordSuccess(result.message);
      setTimeout(closePasswordModal, 2000);
    } catch (error) {
      setPasswordError(getApiErrorMessage(error, "Failed to change password"));
    } finally {
      setIsPasswordLoading(false);
    }
  };

  /* Channel modal */
  const openChannelModal = async () => {
    setIsChannelModalOpen(true);
    setNewChannelName(""); setNewChannelPrivacy("public");
    setSelectedMembers([]); setMemberSearch("");
    setUsersLoading(true);
    try { const users = await channelsApi.getUsers(); setAllUsers(users); }
    catch { setAllUsers([]); }
    finally { setUsersLoading(false); }
  };
  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) { setIsChannelModalOpen(false); return; }
    const creator: ChannelMember | null = user ? { _id: currentUserId || "me", firstName: user.firstName, lastName: user.lastName, email: user.email } : null;
    const baseMembers = newChannelPrivacy === "private" ? selectedMembers : [];
    const allChannelMembers = creator ? [creator, ...baseMembers.filter((m) => m._id !== creator._id)] : baseMembers;
    try {
      const created = await channelsApi.createChannel({
        name: newChannelName.trim(),
        isPrivate: newChannelPrivacy === "private",
        members: (newChannelPrivacy === "private" ? allChannelMembers : []).map((m) => m._id),
      });
      setChannels((prev) => [...prev, created as unknown as StoredChannel]);
      setNewChannelName(""); setNewChannelPrivacy("public"); setSelectedMembers([]);
      setIsChannelModalOpen(false);
      navigateTo(`/dashboard/channels/${created.id}`);
    } catch (error) { console.error("Failed to create channel", error); }
  };
  const toggleMember = (u: ChannelMember) => {
    setSelectedMembers((prev) => prev.find((m) => m._id === u._id) ? prev.filter((m) => m._id !== u._id) : [...prev, u]);
  };
  const joinChannel = async (channelId: string) => {
    if (!currentUserId) return;
    try {
      const joinedChannel = await channelsApi.joinChannel(channelId);
      setChannels((prev) => prev.map((chan) => (chan.id === channelId ? (joinedChannel as unknown as StoredChannel) : chan)));
    } catch (error) { console.error("Failed to join channel", error); }
  };

  /* Team modal */
  const openTeamModal = () => {
    setTeamCreateError(""); setNewTeamName(""); setNewTeamDesc("");
    setNewTeamPrivate(false); setTeamMemberSearch(""); setSelectedTeamMemberIds([]);
    setIsTeamModalOpen(true);
  };
  const closeTeamModal = () => { setIsTeamModalOpen(false); setTeamCreateError(""); setTeamMemberSearch(""); };
  const toggleTeamMember = (userId: string) => {
    setSelectedTeamMemberIds((prev) => prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]);
  };
  const handleCreateTeam = async () => {
    setTeamCreateError("");
    if (!newTeamName.trim()) { setTeamCreateError("Team name is required"); return; }
    try {
      setIsTeamCreating(true);
      await teamsApi.createTeam({ teamName: newTeamName.trim(), description: newTeamDesc.trim(), isPrivate: newTeamPrivate, members: newTeamPrivate ? selectedTeamMemberIds : [] });
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
      closeTeamModal();
    } catch (error) { setTeamCreateError(getApiErrorMessage(error, "Failed to create team")); }
    finally { setIsTeamCreating(false); }
  };

  const toggleTeamOpen = (teamId: string) => setOpenTeamIds((prev) => ({ ...prev, [teamId]: !(prev[teamId] ?? true) }));
  const toggleProjectTeamExpanded = (teamId: string) => setExpandedProjectTeams((prev) => ({ ...prev, [teamId]: !(prev[teamId] ?? false) }));

  /* ── Main nav items ── */
  const topNavItems = [
    { id: "home", label: "Home", icon: "pi pi-home", href: "/dashboard" },
    { id: "tasks", label: "Tasks", icon: "pi pi-list-check", href: "/dashboard/tasks" },
  ];

  const bottomNavItems = [
    { id: "inbox", label: "Inbox", icon: "pi pi-inbox", href: "/dashboard/inbox" },
    ...(isAdmin ? [
      { id: "projects", label: "Projects", icon: "pi pi-folder", href: "/dashboard/projects" },
      { id: "users", label: "Users", icon: "pi pi-user", href: "/dashboard/users" },
    ] : [
      ...(projects.length > 0 ? [{ id: "projects", label: "Projects", icon: "pi pi-folder", href: "/dashboard/projects" }] : []),
    ]),
  ];

  const employeeNavItems = !isAdmin ? [
    { id: "my-teams", label: "My Teams", icon: "pi pi-users", href: "/dashboard/teams" },
  ] : [];

  /* ── Shared Sidebar Content ── */
  const SidebarContent = ({ onClose, isCollapsed }: { onClose?: () => void; isCollapsed?: boolean }) => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Workspace Header ── */}
      <div className={`px-3 pt-3 pb-2 border-b border-[var(--border-subtle)] flex-shrink-0 transition-all ${isCollapsed ? "px-0" : ""}`}>
        <div className={`flex items-center gap-2.5 px-1 ${isCollapsed ? "justify-center" : ""}`}>
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0 shadow-sm">
            {user?.firstName?.charAt(0) || "W"}
          </div>
          {!isCollapsed && (
            <>
              <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)] truncate">
                {user ? `${user.firstName}'s Workspace` : "Workspace"}
              </span>
              <button
                className="p-1 rounded-md hover:bg-[var(--nav-hover-bg)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
                title="Search"
              >
                <i className="pi pi-search text-[13px]" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inbox / Quick items */}
      {[
        {
          label: "Inbox",
          href: "/dashboard/inbox",
          icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>,
          rightText: unreadInboxCount > 0 ? String(unreadInboxCount) : undefined,
        },
        { label: "Replies", href: "/dashboard", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 00-4-4H4" /></svg> },
        { label: "Assigned Comments", href: "/dashboard", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg> },
        { label: "Tasks", href: "/dashboard/tasks", icon: <ClipboardDocumentListIcon className="w-3.5 h-3.5" /> },
      ].map((item) => (
        <ContentPanelItem key={item.label} href={item.href} label={item.label} rightText={item.rightText} icon={item.icon} active={pathname === item.href && item.href !== "/dashboard"} onNavigate={navigateTo} />
      ))}

                <div className="px-2.5 pt-3 pb-1">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">My Teams</span>
                </div>

                {/* Team Search */}
                <div className="px-1 mb-1">
                  <div className="flex items-center gap-2 mx-1 px-2 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] focus-within:border-[var(--border-default)] transition-colors">
                    <i className="pi pi-search text-[10px] text-[var(--text-muted)] flex-shrink-0" />
                    <input
                      type="text" 
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      placeholder="Search teams"
                      className="no-focus-ring w-full bg-transparent border-0 outline-none text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                </div>

                {/* Team List */}
                {teamsLoading ? <SkeletonSidebarItems count={2} /> : teamsToShow.map((team: any) => (
                  <NavItem key={team._id} icon="pi pi-users" label={team.teamName}
                    active={pathname.includes(`/dashboard/teams/${team._id}`)}
                    onClick={() => { navigateTo(`/dashboard/teams/${team._id}`); onClose?.(); }}
                  />
                ))}

      {isMounted && channelsOpen && (
        <div className="space-y-0.5 mt-1">
          {visibleChannels.slice(0, channelsExpanded ? undefined : CHANNEL_SIDEBAR_LIMIT).map((chan) => {
            const channelId = ((chan as { id?: string; channelId?: string }).id || (chan as { id?: string; channelId?: string }).channelId || "").toLowerCase();
            const isActive = pathname === `/dashboard/channels/${channelId}`;
            const isJoined = !!(chan.joined || (!!currentUserId && (chan.joinedMemberIds || []).includes(currentUserId)));
            const showJoin = !isJoined;
            return (
              <div
                key={channelId || chan.name}
                className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all duration-150 group ${isActive
                  ? "bg-[var(--accent-light)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]"
                  }`}
              >
                <button
                  onClick={() => navigateTo(`/dashboard/channels/${channelId}`)}
                  className="flex items-center gap-2 overflow-hidden flex-1 min-w-0 text-left"
                >
                  <div className={`flex-shrink-0 ${isActive ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9h16 M4 15h16 M10 3L8 21 M16 3l-2 18" /></svg>
                  </div>
                  <span className="truncate text-[12px] font-medium">{chan.name}</span>
                  {chan.isPrivate && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)] flex-shrink-0">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </button>

                {isAdmin && (
                  <button onClick={() => { openTeamModal(); onClose?.(); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-left text-[var(--text-muted)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-secondary)] transition-all">
                    <i className="pi pi-plus text-[12px]" />
                    <span>New Team</span>
                  </button>
                )}
              </div>
            );
          })}
          {visibleChannels.length > CHANNEL_SIDEBAR_LIMIT && (
            <button
              onClick={() => setChannelsExpanded(!channelsExpanded)}
              className="w-full text-left px-2 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] rounded-md transition-colors"
            >
              {channelsExpanded ? "Show less" : " More.."}
            </button>
          )}
          <button
            onClick={openChannelModal}
            className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-[var(--bg-surface-2)] rounded-md transition-colors group"
          >
            <PlusIcon className="w-3.5 h-3.5 text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition-colors" />
            <span className="text-[12px] text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition-colors">Add Channel</span>
          </button>

        </div>
      )}

      <div className="my-3 border-t border-[var(--border-subtle)]" />

      {/* Spaces section (projects) */}
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Spaces</span>
      </div>

      <button
        onClick={() => navigateTo("/dashboard/tasks")}
        className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-[var(--bg-surface-2)] transition-colors text-left"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)]">
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <path d="M4 6h.01" />
          <path d="M4 12h.01" />
          <path d="M4 18h.01" />
        </svg>
        <span className="text-[12px] text-[var(--text-secondary)] truncate">All Tasks - {user?.firstName}&apos;s Workspace</span>
      </button>

        {/* Bottom Nav (Inbox, Projects, Users) */}
        {bottomNavItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          // Get notification badge for Inbox
          const notificationBadge = item.id === "inbox" ? (unreadCount > 0 ? unreadCount : undefined) : undefined;
          return (
            <NavItem key={item.id} icon={item.icon} label={item.label} active={isActive} isCollapsed={isCollapsed}
              badge={notificationBadge}
              onClick={() => { navigateTo(item.href); onClose?.(); }}
            />
          );
        })}

        {/* Channels Section */}
        <SectionHeader label="Channels" onAdd={openChannelModal} onToggle={() => setChannelsOpen(v => !v)} isOpen={channelsOpen} isCollapsed={isCollapsed} />

        {channelsOpen && !isCollapsed && (
          <div className="space-y-0.5">
            {/* Channel search */}
            {channels.length > 3 && (
              <div className="flex items-center gap-2 mx-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] focus-within:border-[var(--border-default)] transition-colors mb-1">
                <i className="pi pi-search text-[11px] text-[var(--text-muted)] flex-shrink-0" />
                <input
                  type="text" value={channelSearch}
                  onChange={(e) => setChannelSearch(e.target.value)}
                  placeholder="Search channels"
                  className="no-focus-ring w-full bg-transparent border-0 outline-none text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
            )}

            {isMounted && visibleChannels.slice(0, channelsExpanded ? undefined : CHANNEL_SIDEBAR_LIMIT).map((chan) => {
              const channelId = ((chan as any).id || (chan as any).channelId || "").toLowerCase();
              const isActive = pathname === `/dashboard/channels/${channelId}`;
              const isJoined = !!(chan.joined || (!!currentUserId && (chan.joinedMemberIds || []).includes(currentUserId)));
              return (
                <div key={channelId || chan.name} className="group relative">
                  <button
                    onClick={() => { navigateTo(`/dashboard/channels/${channelId}`); onClose?.(); }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-left transition-all duration-150 pr-12
                      ${isActive
                        ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)]"
                      }`}
                  >
                    {chan.isPrivate
                      ? <i className={`pi pi-lock text-[12px] flex-shrink-0 ${isActive ? "text-white" : "text-[var(--text-muted)]"}`} />
                      : <i className={`pi pi-hashtag text-[12px] flex-shrink-0 ${isActive ? "text-white" : "text-[var(--text-muted)]"}`} />
                    }
                    <span className="truncate flex-1">{chan.name}</span>
                  </button>
                  {!isJoined && (
                    <button
                      onClick={(e) => { e.stopPropagation(); joinChannel(channelId); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-surface-3)] text-[var(--text-secondary)] hover:bg-[var(--ck-blue)] hover:text-white transition-all"
                    >
                      Join
                    </button>
                  </div>

                  {teamOpen && (
                    <div className="ml-4 mt-0.5 border-l border-[var(--border-subtle)]/80 pl-2 space-y-0.5">
                      {group.projects.slice(0, expandedProjectTeams[group.id] ? undefined : PROJECT_SIDEBAR_LIMIT).map((project, index) => {
                        const isActive = pathname === "/dashboard/tasks" && searchParams.get("project") === project._id;
                        return (
                          <button
                            key={project._id}
                            onClick={() => navigateTo(`/dashboard/tasks?project=${project._id}`)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${isActive ? "bg-[var(--bg-surface-2)]" : "hover:bg-[var(--bg-surface-2)]"}`}
                          >
                            {renderProjectListIcon(project.projectName, index)}
                            <span className={`text-[12px] truncate flex-1 ${isActive ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)]"}`}>
                              {project.projectName}
                            </span>
                            <span className="text-[12px] text-[var(--text-muted)]">{project.assignedUsers?.length || 0}</span>
                          </button>
                        );
                      })}
                      {group.projects.length > PROJECT_SIDEBAR_LIMIT && (
                        <button
                          onClick={() => toggleProjectTeamExpanded(group.id)}
                          className="w-full text-left px-2 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] rounded-md transition-colors"
                        >
                          {expandedProjectTeams[group.id] ? "Show less" : `More.. (${group.projects.length - PROJECT_SIDEBAR_LIMIT})`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {visibleChannels.length > CHANNEL_SIDEBAR_LIMIT && (
              <button
                onClick={() => setChannelsExpanded(!channelsExpanded)}
                className="w-full text-left px-2.5 py-1.5 text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--nav-hover-bg)] rounded-lg transition-colors"
              >
                {channelsExpanded ? "Show less" : `+${visibleChannels.length - CHANNEL_SIDEBAR_LIMIT} more`}
              </button>
            )}

            <button
              onClick={openChannelModal}
              className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-left group text-[var(--text-muted)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-secondary)] transition-all"
            >
              <i className="pi pi-plus text-[12px]" />
              <span>Add Channel</span>
            </button>
          </div>
        )}


      </div>
      {/* ── Footer ── */}
      <div className={`border-t border-[var(--border-subtle)] px-2 py-2 flex-shrink-0 transition-all ${isCollapsed ? "px-1" : ""}`}>
        {user && (
          <div className="relative" ref={dropdownRef}>
            <div
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[var(--nav-hover-bg)] transition-all group cursor-pointer select-none ${isCollapsed ? "justify-center px-1" : ""}`}
            >
              <svg width="20" height="20" viewBox="0 0 52 52" fill="none" className="flex-shrink-0" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" clipRule="evenodd" d="M46.0082 39.8551C46.2484 36.5877 46.5 31.3996 46.5 24c0 -7.3996 -0.2516 -12.5877 -0.4918 -15.85507 -0.2409 -3.27646 -2.7354 -5.85313 -6.0324 -6.13517C36.9912 1.75444 32.4092 1.5 26 1.5c-6.4091 0 -10.9912 0.25443 -13.9758 0.50975 -3.29701 0.28204 -5.79145 2.85871 -6.03236 6.13517 -0.03087 0.41981 -0.06193 0.87133 -0.09261 1.35517 -0.5222 0.00098 -0.99999 0.00954 -1.42534 0.02206 -1.56772 0.04612 -2.90677 1.08015 -2.96243 2.75495C1.50412 12.498 1.5 12.7385 1.5 13s0.00412 0.5019 0.01146 0.7229c0.05566 1.6747 1.3947 2.7088 2.96243 2.7549 0.34125 0.0101 0.71627 0.0176 1.12088 0.0207 -0.03294 1.2367 -0.05889 2.5703 -0.07524 4.0037 -0.37595 0.0034 -0.72564 0.0105 -1.04564 0.0199 -1.56772 0.0462 -2.90677 1.0802 -2.96243 2.755C1.50412 23.498 1.5 23.7385 1.5 24s0.00412 0.5019 0.01146 0.7229c0.05566 1.6747 1.3947 2.7088 2.96243 2.7549 0.32 0.0095 0.66969 0.0166 1.04563 0.02 0.01636 1.4334 0.04231 2.767 0.07525 4.0037 -0.40462 0.0031 -0.77963 0.0106 -1.12088 0.0206 -1.56772 0.0462 -2.90677 1.0802 -2.96243 2.755C1.50412 34.498 1.5 34.7385 1.5 35s0.00412 0.5019 0.01146 0.7229c0.05566 1.6747 1.3947 2.7088 2.96243 2.7549 0.42534 0.0125 0.90314 0.0211 1.42533 0.0221 0.03068 0.4838 0.06174 0.9353 0.0926 1.3552 0.24092 3.2764 2.73535 5.8531 6.03238 6.1351 2.9846 0.2553 7.5666 0.5098 13.9758 0.5098 6.4091 0 10.9912 -0.2544 13.9758 -0.5098 3.297 -0.282 5.7915 -2.8587 6.0324 -6.1351ZM32.0008 20c0 2.1338 -1.1139 4.0075 -2.792 5.0713 2.8422 1.0417 5.0176 3.4147 5.7294 6.3412 0.3117 1.2813 -0.4381 2.4986 -1.7132 2.8349 -1.4247 0.3759 -3.7315 0.7526 -7.2549 0.7526 -3.5233 0 -5.8302 -0.3767 -7.2549 -0.7526 -1.275 -0.3363 -2.0248 -1.5536 -1.7131 -2.8349 0.715 -2.9399 2.9071 -5.3212 5.7684 -6.3554 -1.6657 -1.0662 -2.7697 -2.9327 -2.7697 -5.0571 0 -3.3137 2.6863 -6 6 -6s6 2.6863 6 6Z" fill="currentColor"></path></svg>
              <span className="text-[12px] font-medium text-[var(--text-primary)] truncate text-left flex-1">{team.teamName}</span>
            </button>
          ))}
          {canToggleMoreTeams && (
            <button
              onClick={() => setShowAllTeams((prev) => !prev)}
              className="w-full text-left px-2 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] rounded-md transition-colors"
            >
              {showAllTeams ? "Show less" : "More.."}
            </button>
          )}
        </div>
      )}
    </div>
  );

            {isDropdownOpen && (
              <div className={`absolute bottom-full mb-1 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-lg py-1 z-50 animate-fade-in
                ${isCollapsed ? "left-12 min-w-[180px] bottom-0" : "left-0 right-0"}
              `}>
                {isCollapsed && (
                   <div className="px-3 py-2 border-b border-[var(--border-subtle)] mb-1 flex items-center gap-3">
                     <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-[12px] font-bold shadow-inner">
                       {user.avatar ? (
                         <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                       ) : (
                         <>{user.firstName?.charAt(0)}{user.lastName?.charAt(0)}</>
                       )}
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="text-[12px] font-bold text-[var(--text-primary)] truncate">{user.firstName} {user.lastName}</p>
                       <p className="text-[10px] text-[var(--text-muted)] truncate">{user.email}</p>
                     </div>
                   </div>
                )}
                <button onClick={() => { navigateTo("/dashboard/settings"); setIsDropdownOpen(false); }}
                  className="w-full text-left px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--nav-hover-bg)] transition-colors flex items-center gap-2.5">
                  <i className="pi pi-cog text-[13px] text-[var(--text-muted)]" />
                  Settings
                </button>
                {isCollapsed && (
                  <button onClick={toggleTheme}
                    className="w-full text-left px-3 py-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--nav-hover-bg)] transition-colors flex items-center gap-2.5">
                    <i className={`${isDarkMode ? "pi pi-sun" : "pi pi-moon"} text-[13px] text-[var(--text-muted)]`} />
                    {isDarkMode ? "Light Mode" : "Dark Mode"}
                  </button>
                )}
                <button onClick={handleLogout}
                  className="w-full text-left px-3 py-2 text-[12px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors flex items-center gap-2.5">
                  <i className="pi pi-sign-out text-[13px]" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  /* ── Return ── */
  return (
    <>
      {/* ── Mobile Header ── */}
      <div className="md:hidden h-[52px] bg-[var(--sidebar-bg)] border-b border-[var(--border-subtle)] flex items-center justify-between px-4 flex-shrink-0 shadow-sm">
        <button
          onClick={() => setIsMobileSidebarOpen(true)}
          className="p-1.5 rounded-lg hover:bg-[var(--nav-hover-bg)] text-[var(--text-secondary)] transition-colors"
          title="Menu"
        >
          <i className="pi pi-bars text-[16px]" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-[9px] font-bold">
            {user?.firstName?.charAt(0) || "W"}
          </div>
          <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate max-w-[140px]">
            {user ? `${user.firstName}'s Workspace` : "Workspace"}
          </span>
        </div>
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg hover:bg-[var(--nav-hover-bg)] text-[var(--text-muted)] transition-colors"
        >
          <i className={`${isDarkMode ? "pi pi-sun" : "pi pi-moon"} text-[14px]`} />
        </button>
      </div>

      {/* ── Mobile Overlay ── */}
      {isMobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 top-[52px] backdrop-blur-sm"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* ── Mobile Sidebar ── */}
      <div className={`md:hidden fixed left-0 top-[52px] h-[calc(100vh-52px)] w-[260px] bg-[var(--sidebar-bg)] border-r border-[var(--border-subtle)] shadow-2xl transform transition-transform duration-300 z-50 overflow-hidden
        ${isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Mobile Sidebar Content */}
        <div className="flex-1 overflow-y-auto ck-scrollbar flex flex-col">
          {/* Navigation Items */}
          <div className="p-2 space-y-0.5">
            {visibleNavItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActivePanel(item.id);
                  if (item.href) navigateTo(item.href);
                  setIsMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors text-[12px] ${(activePanel === item.id || (item.href && pathname === item.href))
                  ? "bg-[var(--accent-light)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)]"
                  }`}
              >
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="my-1.5 border-t border-[var(--border-subtle)]" />

          {/* Quick Actions */}
          <div className="px-2 py-1.5 space-y-1">
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide px-2">Recent</div>

            {/* Channels Preview */}
            {isMounted && channels.slice(0, 3).map((chan) => {
              const channelId = ((chan as { id?: string; channelId?: string }).id || (chan as { id?: string; channelId?: string }).channelId || "").toLowerCase();
              const isActive = pathname === `/dashboard/channels/${channelId}`;
              return (
                <button
                  key={channelId || chan.name}
                  onClick={() => {
                    navigateTo(`/dashboard/channels/${channelId}`);
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1 rounded-md text-left transition-colors text-[11px] ${isActive
                    ? "bg-[var(--accent-light)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)]"
                    }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? "bg-[var(--accent)]" : "bg-[var(--border-subtle)]"}`} />
                  <span className="truncate"># {chan.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile Sidebar Footer */}
        <div className="border-t border-[var(--border-subtle)] p-2 space-y-1.5 flex-shrink-0">
          <button
            onClick={() => {
              toggleTheme();
              setIsMobileSidebarOpen(false);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] transition-colors text-[11px]"
          >
            {isDarkMode ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
            <span className="font-medium truncate">{isDarkMode ? "Light" : "Dark"}</span>
          </button>

          {user && (
            <div className="px-2 py-1.5 rounded-md bg-[var(--bg-surface-2)]">
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-full bg-gray-600 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                  {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-[var(--text-primary)] truncate">{user.firstName}</p>
                  <p className="text-[9px] text-[var(--text-muted)] truncate">{user.email}</p>
                </div>
              </div>
              <div className="mt-1.5 flex gap-1 text-[10px]">
                <button
                  onClick={() => {
                    openPasswordModal();
                    setIsMobileSidebarOpen(false);
                  }}
                  className="flex-1 px-1.5 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] transition-colors truncate"
                >
                  Settings
                </button>
                <button
                  onClick={() => {
                    handleLogout();
                    setIsMobileSidebarOpen(false);
                  }}
                  className="flex-1 px-1.5 py-1 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors truncate"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Dual-column sidebar ── */}
      <div className="hidden md:flex h-screen flex-shrink-0">

        {/* Left icon rail — ClickUp dark strip */}
        <div className="w-[56px] bg-[#1A1C22] flex flex-col items-center py-3 gap-1 flex-shrink-0 border-r border-[#2D2F38]">

          {/* Workspace avatar */}
          <button
            className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-indigo-600 flex items-center justify-center text-white text-[11px] font-bold mb-3 shadow-lg"
            title={user ? `${user.firstName}'s Workspace` : "Workspace"}
          >
            {user?.firstName?.charAt(0) || "W"}
          </button>

          {/* Nav icons */}
          <div className="flex flex-col items-center gap-0.5 flex-1 w-full px-1">
            {visibleNavItems.map((item) => {
              const isActive = activePanel === item.id || (item.href && pathname === item.href);
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActivePanel(item.id);
                    if (item.href) navigateTo(item.href);
                  }}
                  title={item.label}
                  className={`w-full flex flex-col items-center justify-center py-2 px-1 rounded-lg transition-all duration-150 group relative ${isActive
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:text-white hover:bg-white/6"
                    }`}
                >
                  <div className={`transition-transform group-hover:scale-110 ${isActive ? "text-white" : "text-gray-400"}`}>
                    {item.icon}
                  </div>
                  <span className="text-[9px] font-medium mt-0.5 leading-none truncate w-full text-center">
                    {item.label}
                  </span>
                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-white rounded-r-full" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Bottom: theme + logout */}
          <div className="flex flex-col items-center gap-2 mt-auto pb-1">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-white/8 text-gray-400 hover:text-white transition-all"
              title={isDarkMode ? "Light mode" : "Dark mode"}
            >
              {isDarkMode ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-red-500/15 text-gray-400 hover:text-red-400 transition-all"
              title="Logout"
            >
              <ArrowRightOnRectangleIcon className="w-4 h-4" />
            </button>
            {/* User avatar */}
            {user && (
              <div className="relative mt-1">
                <div
                  className="w-7 h-7 rounded-full bg-gray-600 text-white flex items-center justify-center text-[10px] font-bold cursor-pointer hover:ring-2 hover:ring-white/20 transition-all"
                  title={`${user.firstName} ${user.lastName}`}
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right content panel */}
        <div className="w-[220px] bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] flex flex-col flex-shrink-0">
          {/* Panel content */}
          {renderPanel()}

          {/* User profile at bottom */}
          {user && (
            <div className="border-t border-[var(--border-subtle)] p-2 flex-shrink-0">
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-[var(--bg-surface-2)] transition-all"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-white text-[9px] font-bold flex-shrink-0">
                    {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                  </div>
                  <div className="flex-1 text-left overflow-hidden">
                    <p className="text-[11px] font-medium text-[var(--text-primary)] truncate">{user.firstName} {user.lastName}</p>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">{user.email}</p>
                  </div>
                  <ChevronDownIcon className={`w-3 h-3 text-[var(--text-muted)] transition-transform flex-shrink-0 ${isDropdownOpen ? "rotate-180" : ""}`} />
                </button>

      {/* Global Tooltip for Collapsed Sidebar */}
      {isMounted && isCollapsed && (
        <Tooltip target=".nav-item-tooltip" position="right" className="text-[12px]" />
      )}

      {/* ── Create Channel Modal ── */}
      {isChannelModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setIsChannelModalOpen(false)}>
          <div className="w-full max-w-[480px] mx-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}>
            <div className="relative pt-6 px-6 pb-3 border-b border-[var(--border-subtle)]">
              <button onClick={() => setIsChannelModalOpen(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-[var(--nav-hover-bg)] text-[var(--text-muted)] transition-colors">
                <i className="pi pi-times text-[13px]" />
              </button>
              <h2 className="text-[17px] font-bold text-[var(--text-primary)]">Create Channel</h2>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1">Chat channels are where conversations happen.</p>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">Name <span className="text-red-500">*</span></label>
                <input autoFocus type="text" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateChannel(); if (e.key === "Escape") setIsChannelModalOpen(false); }}
                  placeholder="e.g. Ideas"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20 transition-all" />
              </div>
              <div>
                <h3 className="text-[12px] font-semibold text-[var(--text-secondary)] mb-2">Privacy</h3>
                <div className="flex items-center gap-4">
                  {["public", "private"].map((type) => (
                    <label key={type} className="inline-flex items-center gap-2 text-[13px] text-[var(--text-secondary)] cursor-pointer">
                      <input type="radio" name="channelPrivacy" checked={newChannelPrivacy === type}
                        onChange={() => setNewChannelPrivacy(type as "public" | "private")}
                        className="accent-[var(--accent)]" />
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              {newChannelPrivacy === "private" && (
                <div className="space-y-3">
                  <h3 className="text-[12px] font-semibold text-[var(--text-secondary)]">Invite Members</h3>
                  <input type="text" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search by name or email"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-all" />
                  <div className="max-h-40 overflow-y-auto border border-[var(--border-subtle)] rounded-lg divide-y divide-[var(--border-subtle)]">
                    {usersLoading ? <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">Loading users...</div>
                      : allUsers.filter((u) => `${u.firstName} ${u.lastName} ${u.email || ""}`.toLowerCase().includes(memberSearch.toLowerCase())).map((u) => {
                        const checked = selectedMembers.some((m) => m._id === u._id);
                        return (
                          <label key={u._id} className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--nav-hover-bg)]">
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{u.firstName} {u.lastName}</p>
                              {u.email && <p className="text-[11px] text-[var(--text-muted)] truncate">{u.email}</p>}
                            </div>
                            <input type="checkbox" checked={checked} onChange={() => toggleMember(u)} className="accent-[var(--accent)]" />
                          </label>
                        );
                      })}
                  </div>
                  {selectedMembers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedMembers.map((m) => (
                        <span key={m._id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[11px] text-[var(--accent)]">
                          {m.firstName}
                          <button onClick={() => toggleMember(m)} className="hover:text-red-500"><i className="pi pi-times text-[9px]" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end px-6 py-4 border-t border-[var(--border-subtle)]">
              <button onClick={handleCreateChannel} disabled={!newChannelName.trim()}
                className="px-5 py-2 rounded-lg text-[13px] font-semibold bg-[var(--nav-active-bg)] hover:opacity-90 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Team Modal ── */}
      {isTeamModalOpen && isAdmin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={closeTeamModal}>
          <div className="w-full max-w-[500px] mx-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}>
            <div className="relative pt-6 px-6 pb-3 border-b border-[var(--border-subtle)]">
              <button onClick={closeTeamModal} className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-[var(--nav-hover-bg)] text-[var(--text-muted)] transition-colors">
                <i className="pi pi-times text-[13px]" />
              </button>
              <h2 className="text-[17px] font-bold text-[var(--text-primary)]">Create Team</h2>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1">Create a team and optionally invite members for private collaboration.</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {teamCreateError && <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-[12px] text-red-500">{teamCreateError}</div>}
              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">Team Name</label>
                <input autoFocus value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="e.g. Product Team"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-all" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">Description</label>
                <input value={newTeamDesc} onChange={(e) => setNewTeamDesc(e.target.value)} placeholder="Optional"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-all" />
              </div>
              <label className="inline-flex items-center gap-2 text-[13px] text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" checked={newTeamPrivate} onChange={(e) => setNewTeamPrivate(e.target.checked)} className="accent-[var(--accent)]" />
                Private team
              </label>
              {newTeamPrivate && (
                <div>
                  <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">Invite Members</label>
                  <input value={teamMemberSearch} onChange={(e) => setTeamMemberSearch(e.target.value)} placeholder="Search users"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] mb-2 transition-all" />
                  <div className="max-h-40 overflow-y-auto border border-[var(--border-subtle)] rounded-lg divide-y divide-[var(--border-subtle)]">
                    {teamUsersLoading ? <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">Loading users...</div>
                      : teamUsers.filter((u: any) => `${u.fullName} ${u.email}`.toLowerCase().includes(teamMemberSearch.trim().toLowerCase()))
                        .map((u: any) => (
                          <label key={u._id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--nav-hover-bg)] cursor-pointer">
                            <div className="min-w-0">
                              <p className="truncate">{u.fullName}</p>
                              <p className="truncate text-[11px] text-[var(--text-muted)]">{u.email}</p>
                            </div>
                            <input type="checkbox" checked={selectedTeamMemberIds.includes(u._id)} onChange={() => toggleTeamMember(u._id)} className="accent-[var(--accent)]" />
                          </label>
                        ))}
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">{selectedTeamMemberIds.length} selected</p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
              <button onClick={closeTeamModal} className="px-4 py-2 rounded-lg text-[13px] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--nav-hover-bg)] transition-all">Cancel</button>
              <button onClick={handleCreateTeam} disabled={isTeamCreating}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-[var(--nav-active-bg)] text-white hover:opacity-90 disabled:opacity-50 transition-all">
                {isTeamCreating ? "Creating..." : "Create Team"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Password Modal ── */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[17px] font-bold text-[var(--text-primary)]">Change Password</h2>
              <button onClick={closePasswordModal} className="p-1.5 rounded-full hover:bg-[var(--nav-hover-bg)] text-[var(--text-muted)] transition-colors">
                <i className="pi pi-times text-[13px]" />
              </button>
            </div>
            {passwordError && <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-[12px] text-red-500">{passwordError}</div>}
            {passwordSuccess && <div className="mb-4 rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-[12px] text-green-600">{passwordSuccess}</div>}
            <form onSubmit={handlePasswordSubmit} className="space-y-3">
              <input type="password" name="currentPassword" placeholder="Current Password" value={passwordForm.currentPassword}
                onChange={handlePasswordFormChange} required disabled={isPasswordLoading} className="ck-input w-full" />
              <input type="password" name="newPassword" placeholder="New Password (min 6 characters)" value={passwordForm.newPassword}
                onChange={handlePasswordFormChange} required disabled={isPasswordLoading} className="ck-input w-full" />
              <input type="password" name="confirmPassword" placeholder="Confirm New Password" value={passwordForm.confirmPassword}
                onChange={handlePasswordFormChange} required disabled={isPasswordLoading} className="ck-input w-full" />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closePasswordModal} className="ck-btn-secondary" disabled={isPasswordLoading}>Cancel</button>
                <button type="submit" disabled={isPasswordLoading} className="ck-btn-primary">
                  {isPasswordLoading ? "Changing..." : "Change Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
