import { Request, Response } from "express";
import { TasksService } from "../services/tasks.service.js";
import mongoose from "mongoose";
import type { CreateTaskRequest } from "../shared/types/index.js";

export class TasksController {
  private tasksService: TasksService;

  constructor() {
    this.tasksService = new TasksService();
  }

  async createTask(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const body = req.body as Partial<CreateTaskRequest>;

      if (!body.taskName || typeof body.taskName !== "string") {
        res.status(400).json({ error: "taskName is required" });
        return;
      }

      if (typeof body.hours !== "number" || Number.isNaN(body.hours)) {
        res.status(400).json({ error: "hours (number) is required" });
        return;
      }

      // projectId is optional (can be empty string or not provided)
      if (body.projectId && typeof body.projectId !== "string") {
        res.status(400).json({ error: "projectId must be a string" });
        return;
      }

      if (body.assignedTo && typeof body.assignedTo !== "string") {
        res.status(400).json({ error: "assignedTo must be a string (user ID)" });
        return;
      }

      if (!Array.isArray(body.details) || body.details.length === 0) {
        res.status(400).json({ error: "details must be a non-empty array" });
        return;
      }

      if (body.status && !["to-do", "in-progress", "completed"].includes(body.status)) {
        res.status(400).json({ error: "status must be one of: to-do, in-progress, completed" });
        return;
      }

      if (body.startDate && typeof body.startDate !== "string") {
        res.status(400).json({ error: "startDate must be a string" });
        return;
      }

      if (body.dueDate && typeof body.dueDate !== "string") {
        res.status(400).json({ error: "dueDate must be a string" });
        return;
      }

      const result = await this.tasksService.createTask(body as CreateTaskRequest, userId);
      res.status(201).json(result);
    } catch (error) {
      console.error("Create task error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Server error" });
      }
    }
  }

  async getTasks(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const allowedFilters = ["all", "created", "assigned"];
      const filter = (req.query.filter as string) || "all";

      if (!allowedFilters.includes(filter)) {
        res.status(400).json({ error: "Invalid filter. Must be one of: all, created, assigned" });
        return;
      }

      const result = await this.tasksService.getTasks(userId, page, limit, filter);
      res.json(result);
    } catch (error) {
      console.error("Get tasks error:", error);
      res.status(500).json({ error: "Server error" });
    }
  }

  async getTaskDetails(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { id } = req.params;
      const result = await this.tasksService.getTaskDetails(id, userId);
      res.json(result);
    } catch (error) {
      console.error("Get task details error:", error);
      if (error instanceof Error && error.message === "Invalid id") {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Server error" });
      }
    }
  }

  async updateTaskDetail(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { id, index } = req.params;
      const { text, time } = req.body;

      if (typeof text !== "string" || typeof time !== "string") {
        res.status(400).json({ error: "text and time are required" });
        return;
      }

      const detailIndex = parseInt(index, 10);
      if (Number.isNaN(detailIndex) || detailIndex < 0) {
        res.status(400).json({ error: "Invalid detail index" });
        return;
      }

      const result = await this.tasksService.updateTaskDetail(id, detailIndex, { text, time }, userId);
      res.json(result);
    } catch (error) {
      console.error("Update task detail error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Server error" });
      }
    }
  }

  async updateTaskStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { id } = req.params;
      const { status } = req.body;

      if (!status || !["to-do", "in-progress", "completed"].includes(status)) {
        res.status(400).json({ error: "status must be one of: to-do, in-progress, completed" });
        return;
      }

      const result = await this.tasksService.updateTaskStatus(id, status, userId);
      res.json(result);
    } catch (error) {
      console.error("Update task status error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Server error" });
      }
    }
  }

  async updateTask(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { id } = req.params;
      const body = req.body;

      const result = await this.tasksService.updateTask(id, body, userId);
      res.json(result);
    } catch (error) {
      console.error("Update task error:", error);
      if (error instanceof Error) {
        if (error.message.includes("not found") || error.message.includes("Invalid")) {
          res.status(404).json({ error: error.message });
        } else if (error.message.includes("admin") || error.message.includes("Access")) {
          res.status(403).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: "Server error" });
      }
    }
  }

  async deleteTask(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { id } = req.params;

      const result = await this.tasksService.deleteTask(id, userId);
      res.json(result);
    } catch (error) {
      console.error("Delete task error:", error);
      if (error instanceof Error) {
        if (error.message.includes("not found") || error.message.includes("Invalid")) {
          res.status(404).json({ error: error.message });
        } else if (error.message.includes("admin") || error.message.includes("Access")) {
          res.status(403).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: "Server error" });
      }
    }
  }

  async addComment(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { id } = req.params;
      const { message } = req.body;

      if (!message || typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "Comment message is required" });
        return;
      }

      // Fetch user from database to get firstName and lastName
      const db = mongoose.connection.db;
      if (!db) {
        res.status(500).json({ error: "Database connection failed" });
        return;
      }

      const user = await db.collection("users").findOne({ _id: new mongoose.Types.ObjectId(userId) });
      
      const userName = user 
        ? (user.firstName && user.lastName) 
          ? `${user.firstName} ${user.lastName}`
          : user.firstName || user.lastName || "User"
        : "User";

      const result = await this.tasksService.addComment(id, userId, userName, message);
      res.json(result);
    } catch (error) {
      console.error("Add comment error:", error);
      if (error instanceof Error) {
        if (error.message.includes("not found") || error.message.includes("Invalid")) {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: "Server error" });
      }
    }
  }
}
