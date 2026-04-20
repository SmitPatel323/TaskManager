import mongoose from "mongoose";
import { InboxModel, TaskStatusNotificationType } from "../models/inbox.model.js";
import { EmailService } from "./email.service.js";
import { emitNotification } from "../infrastructure/socket.js";

export class InboxService {
    private inboxModel: InboxModel;
    private emailService: EmailService;

    constructor() {
        this.inboxModel = new InboxModel();
        this.emailService = new EmailService();
    }

    async notifyTaskAssigned(
        taskId: string,
        taskName: string,
        assignedToUserId: string,
        assignedByUserId: string
    ): Promise<void> {
        try {
            const db = mongoose.connection.db;
            if (!db) {
                throw new Error("Database connection failed");
            }

            // Fetch user details for personalization
            const assignedUser = await db
                .collection("users")
                .findOne({ _id: new mongoose.Types.ObjectId(assignedToUserId) });
            const assignedByUser = await db
                .collection("users")
                .findOne({ _id: new mongoose.Types.ObjectId(assignedByUserId) });

            if (!assignedUser) {
                throw new Error("Assigned user not found");
            }

            const senderName = assignedByUser ? `${assignedByUser.firstName} ${assignedByUser.lastName}` : "Admin";

            // Create inbox notification
            const notification = await this.inboxModel.create({
                recipientId: new mongoose.Types.ObjectId(assignedToUserId),
                senderId: new mongoose.Types.ObjectId(assignedByUserId),
                taskId: new mongoose.Types.ObjectId(taskId),
                taskName,
                type: "task-assigned",
                title: "Task Assigned",
                message: `${senderName} has assigned you the task "${taskName}"`,
                isRead: false,
                createdAt: new Date(),
            } as any);

            // Emit real-time notification via Socket.IO
            emitNotification(assignedToUserId, {
                _id: notification._id.toString(),
                title: notification.title,
                message: notification.message,
                type: notification.type,
                taskName: notification.taskName,
                taskId: notification.taskId?.toString(),
                senderId: notification.senderId?.toString(),
                createdAt: notification.createdAt,
            });

            // Send email notification
            const assigneeEmail =
                typeof assignedUser.email === "string" && assignedUser.email.trim().length > 0
                    ? assignedUser.email.trim()
                    : null;

            if (assigneeEmail) {
                await this.emailService.sendTaskAssignmentNotification(
                    assigneeEmail,
                    `${assignedUser.firstName} ${assignedUser.lastName}`,
                    taskName,
                    senderName
                );
            }
        } catch (error) {
            console.error("Error notifying task assignment:", error);
            // Don't throw - we don't want to fail task creation if notification fails
        }
    }

    /**
     * Create a task status change notification
     * Called when a user changes a task status
     */
    async notifyTaskStatusChanged(
        taskId: string,
        taskName: string,
        statusChangedByUserId: string,
        newStatus: TaskStatusNotificationType,
        previousStatus?: TaskStatusNotificationType,
        taskAssignedToUserId?: string,
        taskCreatedByUserId?: string
    ): Promise<void> {
        try {
            const db = mongoose.connection.db;
            if (!db) {
                throw new Error("Database connection failed");
            }

            const statusChangedByUser = await db
                .collection("users")
                .findOne({ _id: new mongoose.Types.ObjectId(statusChangedByUserId) });

            if (!statusChangedByUser) {
                throw new Error("Status changed by user not found");
            }

            const changerName = `${statusChangedByUser.firstName} ${statusChangedByUser.lastName}`;

            // Determine who should receive the notification
            let notificationRecipientId: string | null = null;

            // If status was changed by the assigned user, notify the creator/admin
            if (taskAssignedToUserId && statusChangedByUserId === taskAssignedToUserId && taskCreatedByUserId) {
                notificationRecipientId = taskCreatedByUserId;
            }
            // If status was changed by someone else (admin/creator), notify the assigned user
            else if (taskAssignedToUserId && statusChangedByUserId !== taskAssignedToUserId) {
                notificationRecipientId = taskAssignedToUserId;
            }

            if (!notificationRecipientId) {
                return; // No one to notify
            }

            const recipient = await db
                .collection("users")
                .findOne({ _id: new mongoose.Types.ObjectId(notificationRecipientId) });

            if (!recipient) {
                throw new Error("Notification recipient not found");
            }

            const statusText = newStatus === "in-progress" ? "In Progress" : newStatus.charAt(0).toUpperCase() + newStatus.slice(1);

            // Create inbox notification
            const notification = await this.inboxModel.create({
                recipientId: new mongoose.Types.ObjectId(notificationRecipientId),
                senderId: new mongoose.Types.ObjectId(statusChangedByUserId),
                taskId: new mongoose.Types.ObjectId(taskId),
                taskName,
                type: "task-status-changed",
                title: "Task Status Changed",
                message: `${changerName} changed the task "${taskName}" status to ${statusText}`,
                previousStatus,
                newStatus,
                isRead: false,
                createdAt: new Date(),
            } as any);

            // Emit real-time notification via Socket.IO
            emitNotification(notificationRecipientId, {
                _id: notification._id.toString(),
                title: notification.title,
                message: notification.message,
                type: notification.type,
                taskName: notification.taskName,
                taskId: notification.taskId?.toString(),
                previousStatus: notification.previousStatus,
                newStatus: notification.newStatus,
                senderId: notification.senderId?.toString(),
                createdAt: notification.createdAt,
            });

            // Send email notification
            await this.emailService.sendTaskStatusChangeNotification(
                recipient.email,
                `${recipient.firstName} ${recipient.lastName}`,
                taskName,
                changerName,
                statusText,
                previousStatus ? this.formatStatus(previousStatus) : undefined
            );
        } catch (error) {
            console.error("Error notifying task status change:", error);
            // Don't throw - we don't want to fail status update if notification fails
        }
    }

    /**
     * Get inbox messages for a user with optional type filtering
     */
    async getInboxMessages(
        recipientId: string,
        limit: number = 50,
        skip: number = 0,
        type?: string
    ): Promise<any> {
        const messages = await this.inboxModel.findByRecipientId(recipientId, limit, skip, type);
        const total = await this.inboxModel.countByRecipientId(recipientId, type);
        const unreadCount = await this.inboxModel.countUnreadByRecipientId(recipientId);

        return {
            messages,
            total,
            unreadCount,
            skip,
            limit,
            filter: type || "all",
        };
    }

    /**
     * Mark a single message as read
     */
    async markMessageAsRead(messageId: string): Promise<any> {
        return await this.inboxModel.markAsRead(messageId);
    }

    /**
     * Mark all messages as read for a user
     */
    async markAllMessagesAsRead(recipientId: string): Promise<any> {
        return await this.inboxModel.markAllAsRead(recipientId);
    }

    /**
     * Get a specific message by ID
     */
    async getMessageById(messageId: string): Promise<any> {
        return await this.inboxModel.findById(messageId);
    }

    /**
     * Delete a message
     */
    async deleteMessage(messageId: string): Promise<any> {
        return await this.inboxModel.deleteMessage(messageId);
    }

    /**
     * Get unread count for a user
     */
    async getUnreadCount(recipientId: string): Promise<number> {
        return await this.inboxModel.countUnreadByRecipientId(recipientId);
    }

    private formatStatus(status: TaskStatusNotificationType): string {
        if (status === "in-progress") return "In Progress";
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    /**
     * Add a reply to a notification
     */
    async addReplyToNotification(
        messageId: string,
        senderId: string,
        senderName: string,
        replyMessage: string
    ): Promise<any> {
        try {
            // Add reply to original notification
            const updatedMessage = await this.inboxModel.addReply(messageId, senderId, senderName, replyMessage);
            
            // Get the original notification to get the sender (to notify them)
            const originalNotification = await this.inboxModel.findById(messageId);
            
            if (originalNotification && originalNotification.senderId) {
                // Create a notification for the original sender showing the reply
                const replyNotification = await this.inboxModel.create({
                    recipientId: originalNotification.senderId,
                    senderId: new mongoose.Types.ObjectId(senderId),
                    taskId: originalNotification.taskId,
                    taskName: originalNotification.taskName,
                    type: "comment_reply",
                    title: `${senderName} replied`,
                    message: `${senderName} replied: ${replyMessage}`,
                    isRead: false,
                    createdAt: new Date(),
                    replies: [{
                        senderId: new mongoose.Types.ObjectId(senderId),
                        senderName,
                        message: replyMessage,
                        createdAt: new Date()
                    }]
                });
                
                // Emit socket event for real-time update to the original sender
                emitNotification(originalNotification.senderId.toString(), {
                    _id: replyNotification._id.toString(),
                    title: replyNotification.title,
                    message: replyNotification.message,
                    type: replyNotification.type,
                    taskName: replyNotification.taskName,
                    taskId: replyNotification.taskId?.toString(),
                    senderId: replyNotification.senderId?.toString(),
                    createdAt: replyNotification.createdAt,
                });
            }
            
            // Emit socket event for real-time update to the replier
            emitNotification("notification_reply", {
                messageId,
                reply: {
                    senderId,
                    senderName,
                    message: replyMessage,
                    createdAt: new Date()
                }
            });

            return { ok: true, message: updatedMessage };
        } catch (error) {
            console.error("Error adding reply:", error);
            throw error;
        }
    }

    /**
     * Create a mention notification
     */
    async createMentionNotification(
        mentionedUserId: string,
        taskId: string,
        taskName: string,
        mentionerName: string,
        mentionerUserId: string
    ): Promise<any> {
        try {
            const notification = await this.inboxModel.createMentionNotification(
                mentionedUserId,
                taskId,
                taskName,
                mentionerName,
                mentionerUserId
            );

            // Emit socket event for real-time notification to the mentioned user
            emitNotification(mentionedUserId, {
                _id: notification._id.toString(),
                title: notification.title,
                message: notification.message,
                type: notification.type,
                taskName: notification.taskName,
                taskId: notification.taskId?.toString(),
                senderId: notification.senderId?.toString(),
                createdAt: notification.createdAt,
            });

            return notification;
        } catch (error) {
            console.error("Error creating mention notification:", error);
            throw error;
        }
    }

    /**
     * Notify about a task comment
     */
    async notifyTaskComment(
        taskId: string,
        taskName: string,
        commenterId: string,
        commenterName: string,
        commentMessage: string,
        notifyUserId: string
    ): Promise<void> {
        try {
            const notification = await this.inboxModel.create({
                recipientId: new mongoose.Types.ObjectId(notifyUserId),
                senderId: new mongoose.Types.ObjectId(commenterId),
                taskId: new mongoose.Types.ObjectId(taskId),
                taskName,
                type: "comment_reply",
                title: `${commenterName} commented`,
                message: `${commenterName} commented: ${commentMessage}`,
                isRead: false,
                createdAt: new Date(),
            });

            // Emit socket event for real-time notification
            emitNotification(notifyUserId, {
                _id: notification._id.toString(),
                title: notification.title,
                message: notification.message,
                type: notification.type,
                taskName: notification.taskName,
                taskId: notification.taskId?.toString(),
                senderId: notification.senderId?.toString(),
                createdAt: notification.createdAt,
            });
        } catch (error) {
            console.error("Error notifying task comment:", error);
            // Don't throw - we don't want to fail task update if notification fails
        }
    }
}
