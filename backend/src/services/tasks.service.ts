import mongoose from "mongoose";
import { TaskModel } from "../models/task.model.js";
import { InboxService } from "./inbox.service.js";
import { emitTaskUpdate } from "../infrastructure/socket.js";
import type { CreateTaskRequest, DetailBlock, TaskStatus } from "../shared/types/index.js";

function isValidTimeHHMM(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) { return false; }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isValidStatus(value: unknown): value is TaskStatus {
  return value === "to-do" || value === "in-progress" || value === "completed";
}

export class TasksService {
  private taskModel: TaskModel;
  private inboxService: InboxService;

  constructor() {
    this.taskModel = new TaskModel();
    this.inboxService = new InboxService();
  }

  async createTask(data: CreateTaskRequest, userId: string): Promise<any> {
    // Validate projectId if provided
    // Database connection check
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database connection failed");
    }

    // Check for admin privileges to determine assignment restrictions
    const isAdmin = await this.isUserAdmin(userId);

    let projectIdObj: mongoose.Types.ObjectId | undefined;
    if (data.projectId && data.projectId.trim()) {
      if (!mongoose.Types.ObjectId.isValid(data.projectId)) {
        throw new Error("Invalid projectId");
      }

      // Verify project exists
      const project = await db.collection("projects").findOne({ _id: new mongoose.Types.ObjectId(data.projectId) });
      if (!project) {
        throw new Error("Project not found");
      }

      // HYBRID PERMISSION CHECK: Non-admins can only create tasks for projects they're assigned to
      if (!isAdmin) {
        const userAssignedUsers = project.assignedUsers || [];
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const isUserAssignedToProject = userAssignedUsers.some((id: any) => 
          id.toString() === userObjectId.toString()
        );

        if (!isUserAssignedToProject) {
          throw new Error("You can only create tasks for projects you are assigned to. Contact your admin to be added to this project.");
        }
      }

      projectIdObj = new mongoose.Types.ObjectId(data.projectId);
    }

    // If assignedTo is not provided, check admin requirement
    if (!data.assignedTo) {
      if (isAdmin) {
        // Admins must specify assignedTo
        throw new Error("Admins must specify assignedTo when creating tasks");
      }
      // Regular users default to themselves
    }

    // If assignedTo is provided, validate it and check admin restrictions
    const assignedToUser = data.assignedTo || userId;

    // Validate assignedTo user exists
    if (!mongoose.Types.ObjectId.isValid(assignedToUser)) {
      throw new Error("Invalid assignedTo user ID");
    }

    const assignedUser = await db.collection("users").findOne({ _id: new mongoose.Types.ObjectId(assignedToUser) });
    if (!assignedUser) {
      throw new Error("Assigned user not found");
    }

    // Regular users can only assign to themselves
    if (!isAdmin && assignedToUser !== userId) {
      throw new Error("You can only assign tasks to yourself");
    }

    // Check if task name already exists for this user
    const existingTask = await this.taskModel.findByTaskName(data.taskName.trim(), userId);
    if (existingTask) {
      throw new Error("Task name already exists. Please use a unique name.");
    }

    // Validate and clean details
    const cleanedDetails: DetailBlock[] = [];
    for (let i = 0; i < data.details.length; i++) {
      const d = data.details[i] as Partial<DetailBlock>;
      const text = typeof d.text === "string" ? d.text.trim() : "";
      if (!text) continue;

      if (!isValidTimeHHMM(d.time)) {
        throw new Error(`details[${i}] must include a valid time (HH:MM)`);
      }

      cleanedDetails.push({ text, time: d.time });
    }

    if (cleanedDetails.length === 0) {
      throw new Error("At least one detail with text is required");
    }

    const startDate = parseDate(data.startDate);
    const dueDate = parseDate(data.dueDate);
    if (data.startDate && !startDate) {
      throw new Error("startDate must be a valid date");
    }
    if (data.dueDate && !dueDate) {
      throw new Error("dueDate must be a valid date");
    }
    if (startDate && dueDate && dueDate < startDate) {
      throw new Error("dueDate cannot be before startDate");
    }

    const status: TaskStatus = isValidStatus(data.status) ? data.status : "to-do";

    // Validate and clean tags
    const cleanedTags: string[] = Array.isArray(data.tags)
      ? data.tags.map(tag => String(tag).trim()).filter(tag => tag.length > 0)
      : [];

    // Create task document
    const taskData: any = {
      userId: new mongoose.Types.ObjectId(userId),
      taskName: data.taskName.trim(),
      description: data.description?.trim(),
      details: cleanedDetails,
      hours: data.hours,
      status,
      assignedTo: new mongoose.Types.ObjectId(assignedToUser),
      startDate: startDate ?? undefined,
      dueDate: dueDate ?? undefined,
      priority: data.priority,
      tags: cleanedTags,
      createdAt: new Date(),
    };

    // Only add projectId if it was provided
    if (projectIdObj) {
      taskData.projectId = projectIdObj;
    }

    const result = await this.taskModel.create(taskData);

    // Create inbox notification for task assignment
    try {
      await this.inboxService.notifyTaskAssigned(
        result.insertedId.toString(),
        taskData.taskName,
        assignedToUser,
        userId
      );
    } catch (error) {
      console.error("Failed to create inbox notification:", error);
    }

    return {
      ok: true,
      insertedId: result.insertedId,
      task: result.task,
    };
  }

  async getTasks(userId: string, page: number = 1, limit: number = 10, filter: string = "all"): Promise<any> {
    // Validate and sanitize inputs
    const validPage = Math.max(1, Math.floor(page));
    const validLimit = Math.max(1, Math.min(100, Math.floor(limit))); // Max 100 items per page
    const validFilter = ["all", "created", "assigned"].includes(filter) ? filter : "all";

    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId);

    let items, total;
    if (isAdmin) {
      // Admin sees all tasks (or filtered)
      const result = await this.taskModel.findAllPaginated(validPage, validLimit, userId, validFilter);
      items = result.items;
      total = result.total;
    } else {
      // Regular users see only tasks they created or tasks assigned to them
      const result = await this.taskModel.findPaginated(userId, validPage, validLimit, validFilter);
      items = result.items;
      total = result.total;
    }

    const totalPages = Math.ceil(total / validLimit);

    return {
      success: true,
      data: items,
      pagination: {
        currentPage: validPage,
        totalPages,
        totalItems: total,
        itemsPerPage: validLimit,
        hasNextPage: validPage < totalPages,
        hasPreviousPage: validPage > 1,
      },
      message: "Tasks retrieved successfully",
    };
  }

  /**
   * Check if a user is admin
   */
  private async isUserAdmin(userId: string): Promise<boolean> {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) return false;
      
      const db = mongoose.connection.db;
      if (!db) return false;

      const user = await db.collection("users").findOne({ _id: new mongoose.Types.ObjectId(userId) });
      if (!user) return false;

      // Role is stored as string in user model
      return user.role === "admin";
    } catch (error) {
      console.error("Error checking admin status:", error);
      return false;
    }
  }

  async getTaskDetails(id: string, userId: string): Promise<any> {
    const rawId = typeof id === "string" ? id.trim() : "";

    // Validate ID format
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(rawId);
    const isValidNumber = /^\d+$/.test(rawId) && Number(rawId) > 0;

    if (!isValidObjectId && !isValidNumber) {
      throw new Error("Invalid id");
    }

    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId);

    const details = await this.taskModel.getDetails(rawId, userId, isAdmin);
    const comments = await this.taskModel.getComments(rawId);
    return { ok: true, details, comments };
  }

  async updateTaskDetail(taskId: string, detailIndex: number, updatedDetail: { text: string; time: string }, userId: string): Promise<any> {
    // Validate taskId format
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      throw new Error("Invalid task ID");
    }

    // Validate inputs
    if (typeof detailIndex !== "number" || detailIndex < 0) {
      throw new Error("Invalid detail index");
    }

    if (typeof updatedDetail.text !== "string" || !updatedDetail.text.trim()) {
      throw new Error("Detail text is required");
    }

    if (!isValidTimeHHMM(updatedDetail.time)) {
      throw new Error("Detail time must be in HH:MM format");
    }

    const cleanedDetail: DetailBlock = {
      text: updatedDetail.text.trim(),
      time: updatedDetail.time,
    };

    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId);

    const task = await this.taskModel.updateDetail(taskId, detailIndex, cleanedDetail, userId, isAdmin);
    if (!task) {
      throw new Error("Task not found or invalid detail index");
    }

    return { ok: true, detail: cleanedDetail };
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, userId: string): Promise<any> {
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      throw new Error("Invalid task ID");
    }

    // Validate status
    if (!isValidStatus(status)) {
      throw new Error("Invalid task status");
    }

    const isAdmin = await this.isUserAdmin(userId);
    const task = await this.taskModel.findById(taskId, userId, isAdmin);

    if (!task) {
      throw new Error("Task not found or access denied");
    }

    // Store previous status for notification
    const previousStatus = task.status;

    // Update status
    task.status = status;
    await task.save();

    // Fetch user details for real-time update
    const db = mongoose.connection.db;
    let updatedByName = "User";
    if (db) {
      try {
        const user = await db.collection("users").findOne({ _id: new mongoose.Types.ObjectId(userId) });
        if (user) {
          updatedByName = `${user.firstName} ${user.lastName}`;
        }
      } catch (error) {
        console.error("Failed to fetch user details:", error);
      }
    }

    // Emit real-time task update to all users
    try {
      emitTaskUpdate(taskId, {
        _id: task._id.toString(),
        taskName: task.taskName,
        status: status,
        previousStatus: previousStatus,
        updatedBy: userId,
        updatedByName: updatedByName,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("Failed to emit task update:", error);
    }

    // Create inbox notification for status change
    try {
      await this.inboxService.notifyTaskStatusChanged(
        taskId,
        task.taskName,
        userId,
        status,
        previousStatus,
        task.assignedTo?.toString(),
        task.userId.toString()
      );
    } catch (error) {
      console.error("Failed to create status change notification:", error);
    }

    return { success: true, message: "Task status updated successfully", status };
  }

  /**
   * Update task (admin only)
   */
  async updateTask(taskId: string, data: any, userId: string): Promise<any> {
    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId);
    if (!isAdmin) {
      throw new Error("Only admins can update tasks");
    }

    if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
      throw new Error("Invalid task ID");
    }

    const task = await TaskModel.findById(new mongoose.Types.ObjectId(taskId));
    if (!task) {
      throw new Error("Task not found");
    }

    // Build update object
    const updateData: any = {};

    if (data.taskName !== undefined) {
      if (typeof data.taskName !== "string" || data.taskName.trim().length === 0) {
        throw new Error("Task name must be a non-empty string");
      }
      updateData.taskName = data.taskName;
    }

    if (data.hours !== undefined) {
      if (typeof data.hours !== "number" || data.hours < 0) {
        throw new Error("Hours must be a non-negative number");
      }
      updateData.hours = data.hours;
    }

    if (data.startDate !== undefined) {
      updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    }

    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    if (data.status !== undefined) {
      if (!["to-do", "in-progress", "completed"].includes(data.status)) {
        throw new Error("Invalid status");
      }
      updateData.status = data.status;
    }

    if (data.assignedTo !== undefined) {
      if (data.assignedTo && !mongoose.Types.ObjectId.isValid(data.assignedTo)) {
        throw new Error("Invalid assignedTo user ID");
      }
      updateData.assignedTo = data.assignedTo ? new mongoose.Types.ObjectId(data.assignedTo) : null;
    }

    if (data.projectId !== undefined) {
      if (data.projectId && !mongoose.Types.ObjectId.isValid(data.projectId)) {
        throw new Error("Invalid project ID");
      }
      updateData.projectId = data.projectId ? new mongoose.Types.ObjectId(data.projectId) : null;
    }

    updateData.updatedAt = new Date();

    const updatedTask = await TaskModel.findByIdAndUpdate(
      new mongoose.Types.ObjectId(taskId),
      updateData,
      { new: true }
    );

    return {
      success: true,
      data: updatedTask,
      message: "Task updated successfully",
    };
  }

  /**
   * Delete task (admin only)
   */
  async deleteTask(taskId: string, userId: string): Promise<any> {
    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId);
    if (!isAdmin) {
      throw new Error("Only admins can delete tasks");
    }

    if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
      throw new Error("Invalid task ID");
    }

    const task = await TaskModel.findById(new mongoose.Types.ObjectId(taskId));
    if (!task) {
      throw new Error("Task not found");
    }

    await TaskModel.findByIdAndDelete(new mongoose.Types.ObjectId(taskId));

    return {
      success: true,
      message: "Task deleted successfully",
    };
  }

  /**
   * Add a comment to a task and notify the task creator/assigner
   * Also detects @mentions and creates mention notifications
   */
  async addComment(taskId: string, userId: string, userName: string, message: string): Promise<any> {
    if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
      throw new Error("Invalid task ID");
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      throw new Error("Comment message is required");
    }

    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId);

    // Get the task to find who to notify
    const task = await this.taskModel.findById(taskId, userId, isAdmin);
    if (!task) {
      throw new Error("Task not found");
    }

    // Add comment to task
    const updatedTask = await this.taskModel.addComment(taskId, userId, userName, message);

    // Notify the task creator or task assigner (existing comment_reply logic)
    const notifyUserId = task.assignedTo?.toString() === userId 
      ? task.userId // Notify creator if assigned user commented
      : task.assignedTo; // Notify assignee if creator commented

    if (notifyUserId && notifyUserId.toString() !== userId) {
      await this.inboxService.notifyTaskComment(
        taskId.toString(),
        task.taskName,
        userId,
        userName,
        message,
        notifyUserId.toString()
      );
    }

    // Extract mentions from comment message (@username)
    const mentionRegex = /@(\w+)/g;
    let match;
    const mentionedUsernames = new Set<string>();
    
    while ((match = mentionRegex.exec(message)) !== null) {
      mentionedUsernames.add(match[1]);
    }

    // Create mention notifications for each mentioned user
    if (mentionedUsernames.size > 0) {
      await this.notifyMentions(
        taskId.toString(),
        task.taskName,
        userId,
        userName,
        Array.from(mentionedUsernames),
        message
      );
    }

    return {
      success: true,
      comment: updatedTask?.comments?.[updatedTask.comments.length - 1] || null
    };
  }

  /**
   * Helper method to notify mentioned users
   * Finds users by first/last name and creates mention notifications
   */
  private async notifyMentions(
    taskId: string,
    taskName: string,
    mentionerUserId: string,
    mentionerName: string,
    mentionedUsernames: string[],
    commentMessage: string
  ): Promise<void> {
    try {
      const db = mongoose.connection.db;
      if (!db) {
        console.warn("Database connection failed, cannot notify mentions");
        return;
      }

      // Track which users have been notified (avoid duplicates)
      const notifiedUserIds = new Set<string>();

      // For each mentioned username, find and notify the user
      for (const username of mentionedUsernames) {
        try {
          // Search for user by firstName or lastName (case-insensitive)
          const mentionedUser = await db.collection("users").findOne({
            $or: [
              { firstName: { $regex: `^${username}$`, $options: "i" } },
              { lastName: { $regex: `^${username}$`, $options: "i" } }
            ]
          });

          if (!mentionedUser) {
            console.debug(`User not found for mention: @${username}`);
            continue;
          }

          // Don't notify the comment author (they mentioned themselves)
          if (mentionedUser._id.toString() === mentionerUserId) {
            continue;
          }

          // Skip if already notified (avoid duplicates)
          if (notifiedUserIds.has(mentionedUser._id.toString())) {
            continue;
          }

          // Create mention notification
          await this.inboxService.createMentionNotification(
            mentionedUser._id.toString(),
            taskId,
            taskName,
            mentionerName,
            mentionerUserId
          );

          notifiedUserIds.add(mentionedUser._id.toString());
        } catch (error) {
          console.error(`Error processing mention @${username}:`, error);
          // Continue to next mention on error
        }
      }
    } catch (error) {
      console.error("Error notifying mentions:", error);
      // Don't throw - we don't want to fail comment creation if mention notifications fail
    }
  }
}
