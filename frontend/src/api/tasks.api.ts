import { api } from "./http";
import type { CreateTaskRequest, GetTasksResponse, TaskDetailsResponse } from "../types/task";

export const tasksApi = {
  createTask: async (data: CreateTaskRequest) => {
    const response = await api.post("/tasks", data);
    return response.data;
  },

  getTasks: async (page: number = 1, limit: number = 10, filter: string = "all") => {
    const response = await api.get<GetTasksResponse>("/tasks", {
      params: { page, limit, filter }
    });
    return response.data;
  },

  getTaskDetails: async (id: string) => {
    const response = await api.get<TaskDetailsResponse>(`/tasks/${id}/details`);
    return response.data;
  },

  updateTaskDetail: async (taskId: string, detailIndex: number, text: string, time: string) => {
    const response = await api.put(`/tasks/${taskId}/details/${detailIndex}`, {
      text,
      time,
    });
    return response.data;
  },

  updateTaskStatus: async (taskId: string, status: "to-do" | "in-progress" | "completed") => {
    const response = await api.patch(`/tasks/${taskId}/status`, { status });
    return response.data;
  },

  // Update task (admin only)
  updateTask: async (taskId: string, data: { taskName?: string; hours?: number; startDate?: string; dueDate?: string; status?: string; assignedTo?: string; projectId?: string }) => {
    const response = await api.patch(`/tasks/${taskId}`, data);
    return response.data;
  },

  // Delete task (admin only)
  deleteTask: async (taskId: string) => {
    const response = await api.delete(`/tasks/${taskId}`);
    return response.data;
  },

  // Add comment to task
  addComment: async (taskId: string, message: string) => {
    const response = await api.post(`/tasks/${taskId}/comments`, { message });
    return response.data;
  },
};
