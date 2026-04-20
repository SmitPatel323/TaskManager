"use client";

import { useEffect, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";

import TaskTable from "./TaskTable";
import AddTaskForm from "./AddTaskForm";
import { SkeletonTasksList } from "../Skeleton";

export default function TasksClient() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [refreshKey, setRefreshKey] = useState(0);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handleTaskAdded = () => {
    // Refresh task list by invalidating cache
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    setRefreshKey(k => k + 1);
  };

  const handleFilterChange = (filterValue: string) => {
    if (filterValue === "all") {
      router.push("/dashboard/tasks");
    } else {
      router.push(`/dashboard/tasks?filter=${filterValue}`);
    }
  };

  const filterParam = useMemo(() => searchParams.get("filter") || "", [searchParams]);
  const projectParam = useMemo(() => searchParams.get("project") || "", [searchParams]);
  const assignedToParam = useMemo(() => searchParams.get("assignedTo") || "", [searchParams]);

  // Single effect to initialize auth state
  useEffect(() => {
    const userStr = localStorage.getItem("user");
    let isAdminUser = false;

    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        isAdminUser = user.role === "admin";
      } catch {
        isAdminUser = false;
      }
    }

    setIsAdmin(isAdminUser);
    setIsLoggedIn(!!localStorage.getItem("token"));
    setIsLoading(false);
  }, []);

  // Handle auth state changes
  useEffect(() => {
    const handleAuthChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ isLoggedIn: boolean }>;
      const hasToken = customEvent.detail.isLoggedIn;
      setIsLoggedIn(hasToken);
      if (!hasToken) {
        queryClient.clear();
      }
    };

    window.addEventListener("authStateChanged", handleAuthChange);
    return () => window.removeEventListener("authStateChanged", handleAuthChange);
  }, [queryClient]);

  const getBreadcrumbLabel = () => {
    if (filterParam === "assigned") return "Assigned to me";
    if (filterParam === "created") return "Personal List";
    if (projectParam) return "Project Tasks";
    return "All Tasks";
  };

  if (isLoading) {
    return (
      <div className="space-y-0">
        <div className="border-b border-[var(--border-subtle)] pb-0 md:-mx-6 md:px-6 -mt-6 pt-4 bg-[var(--bg-canvas)] px-4">
          <div className="flex items-center gap-2.5 mb-3 flex-wrap">
            <div className="w-4 sm:w-5 h-4 sm:h-5 rounded bg-blue-600 opacity-30" />
            <div className="skeleton skeleton-lg" style={{ width: 100 }} />
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)]"><polyline points="9 18 15 12 9 6" /></svg>
            <div className="skeleton skeleton-lg" style={{ width: 80 }} />
          </div>
        </div>
        <div className="mt-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-canvas)] shadow-sm">
          <SkeletonTasksList rows={8} />
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--bg-surface-2)] flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h3 className="text-xl font-medium text-[var(--text-primary)] mb-2">
          Please sign in
        </h3>
        <p className="text-[var(--text-secondary)] text-sm max-w-sm">
          You need to be logged in to view and manage your tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Breadcrumb + View Tabs */}
      <div className="border-b border-[var(--border-subtle)] pb-0 md:-mx-6 md:px-6 -mt-6 pt-4 bg-[var(--bg-canvas)] px-4">
        {/* Breadcrumb with Add Task button */}
        <div className="flex items-center justify-between gap-2.5 mb-3 text-[var(--text-tertiary)] flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-4 sm:w-5 h-4 sm:h-5 rounded bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              </svg>
            </div>
            <span className="font-semibold text-[var(--text-primary)] text-[13px] sm:text-[16px]">
              {projectParam ? (isAdmin ? "All Projects" : "My Projects") : "My Tasks"}
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="hidden sm:inline"><polyline points="9 18 15 12 9 6" /></svg>
            <span className="font-semibold text-[var(--text-primary)] text-[13px] sm:text-[16px]">{getBreadcrumbLabel()}</span>
          </div>
          <div className="flex-shrink-0">
            <AddTaskForm onAdded={handleTaskAdded} currentFilter={filterParam} isAdmin={isAdmin} />
          </div>
        </div>

        {/* Task Filter Tabs */}
        <div className="flex items-center gap-3 sm:gap-6 mt-4 overflow-x-auto border-b border-[var(--border-subtle)]">
          <button
            onClick={() => handleFilterChange("all")}
            className={`pb-3 text-[12px] sm:text-[13px] font-medium border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap ${!filterParam ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            All Tasks
          </button>
          <button
            onClick={() => handleFilterChange("assigned")}
            className={`pb-3 text-[12px] sm:text-[13px] font-medium border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap ${filterParam === "assigned" ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            Assigned to me
          </button>
          <button
            onClick={() => handleFilterChange("created")}
            className={`pb-3 text-[12px] sm:text-[13px] font-medium border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap ${filterParam === "created" ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            Personal List
          </button>
        </div>

        {/* View Nav Tabs */}
        <div className="flex items-center gap-3 sm:gap-6 mt-4 -mb-[1px] overflow-x-auto">
          <button
            onClick={() => setViewMode("list")}
            className={`pb-3 text-[12px] sm:text-[13px] font-medium border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap ${viewMode === 'list' ? 'border-[var(--ck-blue)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <i className="pi pi-list font-bold w-3 sm:w-4 h-3 sm:h-4 text-[12px] sm:text-[14px]" />
            List
          </button>
          <button
            onClick={() => setViewMode("board")}
            className={`pb-3 text-[12px] sm:text-[13px] font-medium border-b-2 flex items-center gap-1.5 sm:gap-2 transition-colors whitespace-nowrap ${viewMode === 'board' ? 'border-[var(--ck-blue)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <i className="pi pi-th-large w-3 sm:w-4 h-3 sm:h-4 text-[12px] sm:text-[14px]" />
            Board
          </button>
        </div>
      </div>

      {/* Task Content */}
      <div className="mt-4" key={refreshKey}>
        <TaskTable
          initialFilter={filterParam}
          projectFilter={projectParam}
          assignedToFilter={assignedToParam || undefined}
          readOnly={false}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}
