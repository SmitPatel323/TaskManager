import mongoose, { Schema, Document, Model } from "mongoose";
import type { DetailBlock } from "../shared/types/index.js";

export type TaskStatus = "to-do" | "in-progress" | "completed";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface TaskDocument extends Document {
    userId: mongoose.Types.ObjectId;
    taskName: string;
    description?: string;
    hours: number;
    details: DetailBlock[];
    status: TaskStatus;
    priority?: TaskPriority;
    tags?: string[];
    projectId?: mongoose.Types.ObjectId;
    assignedTo?: mongoose.Types.ObjectId;
    startDate?: Date;
    dueDate?: Date;
    comments?: {
        _id?: mongoose.Types.ObjectId;
        userId: mongoose.Types.ObjectId;
        userName: string;
        message: string;
        createdAt: Date;
    }[];
    createdAt: Date;
}

export interface TaskListItem {
    _id: string;
    taskName: string;
    hours: number;
    createdAt: Date;
    detailsCount: number;
    no: number;
    status: TaskStatus;
    priority?: TaskPriority;
    tags?: string[];
    projectId?: string;
    projectName?: string;
    assignedTo?: string;
    startDate?: Date;
    dueDate?: Date;
}

const detailBlockSchema = new Schema<DetailBlock>(
    {
        text: { type: String, required: true },
        time: { type: String, required: true },
    },
    { _id: false }
);

const commentSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: "users", required: true },
        userName: { type: String, required: true },
        message: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
    },
    { _id: true }
);

const taskSchema = new Schema<TaskDocument>(
    {
        userId: { type: Schema.Types.ObjectId, ref: "users", required: true, index: true },
        taskName: { type: String, required: true, trim: true },
        hours: { type: Number, required: true },
        details: { type: [detailBlockSchema], default: [] },
        status: { type: String, enum: ["to-do", "in-progress", "completed"], default: "to-do" },
        priority: {
            type: String,
            enum: ["low", "normal", "high", "urgent"],
            default: undefined,
        },
        tags: [{
            type: String,
            trim: true
        }],
        projectId: { type: Schema.Types.ObjectId, ref: "projects", index: true },
        assignedTo: { type: Schema.Types.ObjectId, ref: "users", index: true },
        startDate: { type: Date },
        dueDate: { type: Date },
        comments: { type: [commentSchema], default: [] },
    },
    {
        timestamps: true,
        collection: "TaskManager",
    }
);

// Create indexes
taskSchema.index({ taskName: 1 });
taskSchema.index({ createdAt: -1 });
taskSchema.index({ userId: 1, status: 1 }); // Compound index for user tasks by status
taskSchema.index({ projectId: 1, status: 1 }); // Compound index for project tasks by status
taskSchema.index({ assignedTo: 1, status: 1 }); // Compound index for assigned tasks by status
taskSchema.index({ projectId: 1, assignedTo: 1 }); // Compound index for filtering by project and user
taskSchema.index({ dueDate: 1 }); // For sorting by due date

const Task = mongoose.models.TaskManager || mongoose.model<TaskDocument>("TaskManager", taskSchema);

export class TaskModel {
    private model: Model<TaskDocument>;

    constructor() {
        this.model = Task;
    }

    /**
     * Find a task by its name for a specific user
     */
    async findByTaskName(taskName: string, userId: string): Promise<TaskDocument | null> {
        return this.model.findOne({ taskName: taskName.trim(), userId });
    }

    /**
     * Create a new task
     */
    async create(taskData: Omit<TaskDocument, "_id" | "createdAt" | keyof Document>): Promise<{ insertedId: string; task: TaskDocument }> {
        const task = await this.model.create(taskData);
        return {
            insertedId: task._id.toString(),
            task,
        };
    }

    /**
     * Get paginated tasks with total count for a specific user (tasks created by them or assigned to them)
     */
    async findPaginated(userId: string, page: number = 1, limit: number = 10, filter: string = "all"): Promise<{ items: TaskListItem[]; total: number }> {
        const skip = (page - 1) * limit;
        const userObjectId = new mongoose.Types.ObjectId(userId);

        // Build match condition based on filter
        let matchCondition: any;
        if (filter === "created") {
            matchCondition = { userId: userObjectId };
        } else if (filter === "assigned") {
            // Tasks assigned to user (including self-created tasks)
            matchCondition = {
                assignedTo: userObjectId
            };
        } else {
            // "all" - tasks where user is either the creator OR the assignee
            matchCondition = {
                $or: [
                    { userId: userObjectId },
                    { assignedTo: userObjectId }
                ]
            };
        }

        // Get total count for this user
        const total = await this.model.countDocuments(matchCondition);

        // Get paginated items
        const items = await this.model
            .aggregate([
                { $match: matchCondition },
                {
                    $lookup: {
                        from: "projects",
                        localField: "projectId",
                        foreignField: "_id",
                        as: "projectData"
                    }
                },
                {
                    $lookup: {
                        from: "users",
                        localField: "assignedTo",
                        foreignField: "_id",
                        as: "assignedUserData"
                    }
                },
                {
                    $project: {
                        _id: { $toString: "$_id" },
                        taskName: 1,
                        hours: 1,
                        createdAt: 1,
                        status: 1,
                        projectId: { $toString: "$projectId" },
                        projectName: { $arrayElemAt: ["$projectData.projectName", 0] },
                        assignedTo: { $toString: "$assignedTo" },
                        assignedToName: {
                            $concat: [
                                { $ifNull: [{ $arrayElemAt: ["$assignedUserData.firstName", 0] }, ""] },
                                " ",
                                { $ifNull: [{ $arrayElemAt: ["$assignedUserData.lastName", 0] }, ""] }
                            ]
                        },
                        startDate: 1,
                        dueDate: 1,
                        detailsCount: { $size: { $ifNull: ["$details", []] } },
                    },
                },
                { $sort: { createdAt: -1 } },
                { $skip: skip },
                { $limit: limit },
            ])
            .exec();

        // Add sequential number based on absolute position
        const itemsWithNo = items.map((item, index) => ({
            ...item,
            no: skip + index + 1,
        })) as TaskListItem[];

        return { items: itemsWithNo, total };
    }

    /**
     * Get all paginated tasks for admin (no user filtering)
     */
    async findAllPaginated(page: number = 1, limit: number = 10, userId?: string, filter: string = "all"): Promise<{ items: TaskListItem[]; total: number }> {
        const skip = (page - 1) * limit;

        // Build match condition based on filter (for admin)
        let matchCondition: any = {};
        if (userId && filter === "created") {
            matchCondition = { userId: new mongoose.Types.ObjectId(userId) };
        } else if (userId && filter === "assigned") {
            // Tasks assigned to admin (including self-created tasks)
            const adminObjectId = new mongoose.Types.ObjectId(userId);
            matchCondition = {
                assignedTo: adminObjectId
            };
        }
        // "all" - no filtering

        // Get total count
        const total = await this.model.countDocuments(matchCondition);

        // Get paginated items
        const items = await this.model
            .aggregate([
                { $match: matchCondition },
                {
                    $lookup: {
                        from: "projects",
                        localField: "projectId",
                        foreignField: "_id",
                        as: "projectData"
                    }
                },
                {
                    $lookup: {
                        from: "users",
                        localField: "assignedTo",
                        foreignField: "_id",
                        as: "assignedUserData"
                    }
                },
                {
                    $project: {
                        _id: { $toString: "$_id" },
                        taskName: 1,
                        hours: 1,
                        createdAt: 1,
                        status: 1,
                        projectId: { $toString: "$projectId" },
                        projectName: { $arrayElemAt: ["$projectData.projectName", 0] },
                        assignedTo: { $toString: "$assignedTo" },
                        assignedToName: {
                            $concat: [
                                { $ifNull: [{ $arrayElemAt: ["$assignedUserData.firstName", 0] }, ""] },
                                " ",
                                { $ifNull: [{ $arrayElemAt: ["$assignedUserData.lastName", 0] }, ""] }
                            ]
                        },
                        startDate: 1,
                        dueDate: 1,
                        detailsCount: { $size: { $ifNull: ["$details", []] } },
                    },
                },
                { $sort: { createdAt: -1 } },
                { $skip: skip },
                { $limit: limit },
            ])
            .exec();

        // Add sequential number based on absolute position
        const itemsWithNo = items.map((item, index) => ({
            ...item,
            no: skip + index + 1,
        })) as TaskListItem[];

        return { items: itemsWithNo, total };
    }

    async findById(id: string, userId: string, isAdmin: boolean = false): Promise<TaskDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return null;
        }

        const objectId = new mongoose.Types.ObjectId(id);

        if (isAdmin) {
            // Admins can access any task
            return this.model.findOne({ _id: objectId }).exec();
        }

        // Regular users can only access tasks they created or are assigned to
        const userObjectId = new mongoose.Types.ObjectId(userId);
        return this.model.findOne({
            _id: objectId,
            $or: [
                { userId: userObjectId },
                { assignedTo: userObjectId }
            ]
        }).exec();
    }

    async findBySequenceNumber(no: number, userId: string, isAdmin: boolean = false): Promise<TaskDocument | null> {
        if (no <= 0 || !Number.isInteger(no)) {
            return null;
        }

        if (isAdmin) {
            // Admins can access any task
            return this.model
                .findOne({})
                .sort({ createdAt: -1 })
                .skip(no - 1)
                .limit(1);
        }

        // Regular users can only access tasks they created or are assigned to
        const userObjectId = new mongoose.Types.ObjectId(userId);
        return this.model
            .findOne({
                $or: [
                    { userId: userObjectId },
                    { assignedTo: userObjectId }
                ]
            })
            .sort({ createdAt: -1 })
            .skip(no - 1)
            .limit(1);
    }

    async getDetails(id: string, userId: string, isAdmin: boolean = false): Promise<DetailBlock[]> {
        const rawId = id.trim();
        const isObjectId = mongoose.Types.ObjectId.isValid(rawId);
        const numericNo = /^\d+$/.test(rawId) ? Number(rawId) : NaN;

        let task: TaskDocument | null = null;

        if (isAdmin) {
            // Admins can view any task details
            if (isObjectId) {
                task = await this.model.findOne({ _id: rawId }).select("details");
            } else if (!Number.isNaN(numericNo) && numericNo > 0) {
                task = await this.model
                    .findOne({})
                    .select("details")
                    .sort({ createdAt: -1 })
                    .skip(numericNo - 1)
                    .limit(1);
            }
        } else {
            // Regular users can only view tasks they created or are assigned to
            const userObjectId = new mongoose.Types.ObjectId(userId);
            const matchCondition = {
                $or: [
                    { userId: userObjectId },
                    { assignedTo: userObjectId }
                ]
            };

            if (isObjectId) {
                task = await this.model.findOne({ _id: rawId, ...matchCondition }).select("details");
            } else if (!Number.isNaN(numericNo) && numericNo > 0) {
                task = await this.model
                    .findOne(matchCondition)
                    .select("details")
                    .sort({ createdAt: -1 })
                    .skip(numericNo - 1)
                    .limit(1);
            }
        }
        return Array.isArray(task?.details) ? task.details : [];
    }

    /**
     * Update a specific detail in a task
     */
    async updateDetail(taskId: string, detailIndex: number, updatedDetail: DetailBlock, userId: string, isAdmin: boolean = false): Promise<TaskDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return null;
        }

        // Validate updatedDetail
        if (
            !updatedDetail ||
            typeof updatedDetail !== 'object' ||
            typeof updatedDetail.text !== 'string' ||
            updatedDetail.text.trim().length === 0 ||
            typeof updatedDetail.time !== 'string' ||
            updatedDetail.time.trim().length === 0
        ) {
            return null;
        }

        let task: TaskDocument | null;
        if (isAdmin) {
            // Admins can update any task
            task = await this.model.findOne({ _id: taskId });
        } else {
            // Regular users can only update tasks they created or are assigned to
            const userObjectId = new mongoose.Types.ObjectId(userId);
            task = await this.model.findOne({
                _id: taskId,
                $or: [
                    { userId: userObjectId },
                    { assignedTo: userObjectId }
                ]
            });
        }

        if (!task || !Array.isArray(task.details) || detailIndex < 0 || detailIndex >= task.details.length) {
            return null;
        }

        task.details[detailIndex] = updatedDetail;
        await task.save();
        return task;
    }

    /**
     * Add a comment to a task
     */
    async addComment(taskId: string, userId: string, userName: string, message: string): Promise<TaskDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return null;
        }

        return this.model.findByIdAndUpdate(
            new mongoose.Types.ObjectId(taskId),
            {
                $push: {
                    comments: {
                        userId: new mongoose.Types.ObjectId(userId),
                        userName,
                        message,
                        createdAt: new Date()
                    }
                }
            },
            { new: true }
        ).exec();
    }

    /**
     * Get all comments for a task
     */
    async getComments(taskId: string): Promise<any[]> {
        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return [];
        }

        const task = await this.model.findById(taskId).select("comments");
        return task?.comments || [];
    }
}
