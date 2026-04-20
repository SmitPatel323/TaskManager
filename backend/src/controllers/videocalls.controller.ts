import { Request, Response } from 'express';
import { ChannelModel } from '../models/channel.model.js';
import { UserMongooseModel } from '../models/user.model.js';
import { CallHistoryModel } from '../models/callHistory.model.js';
import { liveKitService } from '../services/livekit.service.js';
import { getIO } from '../infrastructure/socket.js';
import { CallEventLogger } from '../services/callEventLogger.service.js';
import mongoose from 'mongoose';

// Start a video call in a channel
export async function startChannelVideoCall(req: Request, res: Response): Promise<void> {
    try {
        const { channelId } = req.params;
        const { recordingEnabled, type } = req.body;
        const callType = type === 'voice' ? 'voice' : 'video';
        const userId = (req as any).user?.userId;

        console.log('Video call request - userId:', userId, 'channelId:', channelId);

        if (!userId || !channelId) {
            console.error('Missing credentials:', { userId: !!userId, channelId: !!channelId });
            res.status(400).json({ error: 'Missing userId or channelId' });
            return;
        }

        const channel = await ChannelModel.findOne({ channelId }).lean();
        if (!channel) {
            res.status(404).json({ error: 'Channel not found' });
            return;
        }

        const user = await UserMongooseModel.findById(userId).lean();
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Generate room name from channel ID
        const roomName = liveKitService.generateRoomName(channelId);

        // Generate access token for this user
        const { token, url } = await liveKitService.generateLiveKitToken({
            userId: userId.toString(),
            userName: `${user.firstName} ${user.lastName}`,
            roomName,
        });

        // Validate token was generated
        if (!token || typeof token !== 'string' || token.length < 50) {
            console.error('❌ Invalid token generated:', { type: typeof token, length: token?.length });
            res.status(500).json({ error: 'Failed to generate valid authentication token' });
            return;
        }

        console.log('✅ Valid token generated:', {
            tokenLength: token.length,
            tokenPreview: token.substring(0, 50) + '...',
            url,
            roomName,
        });

        // Update channel with active call info
        const objectId = new mongoose.Types.ObjectId(userId);
        const startedAt = new Date();

        await ChannelModel.findOneAndUpdate(
            { channelId },
            {
                activeCall: {
                    roomName,
                    startedAt,
                    initiatorId: objectId,
                    participants: [objectId],
                    type: callType,
                },
            },
            { new: true }
        );

        // Create call history record
        const callHistory = await CallHistoryModel.create({
            channelId,
            roomName,
            initiatorId: objectId,
            participantIds: [objectId],
            startedAt,
            type: callType,
            recordingEnabled: recordingEnabled || false,
        });

        // Notify other users in the channel that a call has started
        const io = getIO();
        io.to(channelId).emit('channel:call-started', {
            callId: callHistory._id,
            channelId,
            roomName,
            initiator: {
                id: userId,
                name: `${user.firstName} ${user.lastName}`,
            },
            startedAt,
            type: callType,
            recordingEnabled: recordingEnabled || false,
        });

        res.json({
            token,
            url,
            roomName,
            channelId,
            callId: callHistory._id,
            recordingEnabled: recordingEnabled || false,
        });
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('❌ Error starting video call:', errorMsg);
        console.error('Full error:', error);

        // Return actual error in development mode for debugging
        res.status(500).json({
            error: 'Failed to start video call',
            details: process.env.NODE_ENV === 'development' ? errorMsg : undefined
        });
    }
}

// Join an existing channel video call
export async function joinChannelVideoCall(req: Request, res: Response): Promise<void> {
    try {
        const { channelId } = req.params;
        const userId = (req as any).user?.userId;

        if (!userId || !channelId) {
            res.status(400).json({ error: 'Missing userId or channelId' });
            return;
        }

        const channel = await ChannelModel.findOne({ channelId }).lean();
        if (!channel) {
            res.status(404).json({ error: 'Channel not found' });
            return;
        }

        if (!channel.activeCall) {
            res.status(400).json({ error: 'No active call in this channel' });
            return;
        }

        const user = await UserMongooseModel.findById(userId).lean();
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const roomName = channel.activeCall.roomName;

        // Generate access token for this user to join the existing room
        const { token, url } = await liveKitService.generateLiveKitToken({
            userId: userId.toString(),
            userName: `${user.firstName} ${user.lastName}`,
            roomName,
        });

        // Validate token was generated
        if (!token || typeof token !== 'string' || token.length < 50) {
            console.error('❌ Invalid token generated for join:', { type: typeof token, length: token?.length });
            res.status(500).json({ error: 'Failed to generate valid authentication token' });
            return;
        }

        console.log('✅ Valid join token generated:', {
            tokenLength: token.length,
            tokenPreview: token.substring(0, 50) + '...',
            roomName,
        });

        // Add user to participants list
        const objectId = new mongoose.Types.ObjectId(userId);
        if (!channel.activeCall.participants.some((p: any) => p.toString() === userId)) {
            await ChannelModel.findOneAndUpdate(
                { channelId },
                {
                    $addToSet: {
                        'activeCall.participants': objectId,
                    },
                },
                { new: true }
            );
        }

        // Notify others that user joined
        const io = getIO();
        io.to(channelId).emit('channel:call-user-joined', {
            channelId,
            user: {
                id: userId,
                name: `${user.firstName} ${user.lastName}`,
            },
        });

        res.json({
            token,
            url,
            roomName,
            channelId,
        });
    } catch (error) {
        console.error('Error joining video call:', error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Failed to join video call' });
    }
}

// End the video call in a channel
export async function endChannelVideoCall(req: Request, res: Response): Promise<void> {
    try {
        const { channelId } = req.params;
        const { callId } = req.body;
        const userId = (req as any).user?.userId;

        if (!userId || !channelId) {
            res.status(400).json({ error: 'Missing userId or channelId' });
            return;
        }

        const channel = await ChannelModel.findOne({ channelId });
        if (!channel) {
            res.status(404).json({ error: 'Channel not found' });
            return;
        }

        if (!channel.activeCall) {
            res.status(400).json({ error: 'No active call in this channel' });
            return;
        }

        // Save initiator ID before clearing the active call
        const initiatorId = channel.activeCall.initiatorId;

        // Calculate call duration
        const endedAt = new Date();
        const duration = Math.floor((endedAt.getTime() - channel.activeCall.startedAt.getTime()) / 1000);

        // Update call history with end time and duration
        if (callId) {
            await CallHistoryModel.findByIdAndUpdate(callId, {
                endedAt,
                duration,
            });
        }

        // Clear the active call
        channel.activeCall = null;
        await channel.save();

        // DISABLED: Call history message logging - removed to prevent issues
        // if (callId) {
        //     try {
        //         const callHistoryObjectId = new mongoose.Types.ObjectId(callId);
        //         await CallEventLogger.logCallEvent(channelId, callHistoryObjectId, initiatorId);
        //     } catch (logError) {
        //         console.error('Error logging call event:', logError);
        //     }
        // }

        // Notify all users that the call has ended
        const io = getIO();
        io.to(channelId).emit('channel:call-ended', {
            callId,
            channelId,
            endedBy: userId,
            endedAt,
            duration,
        });

        res.json({ success: true, message: 'Call ended', duration });
    } catch (error) {
        console.error('Error ending video call:', error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Failed to end video call' });
    }
}

// Remove a user from the active call
export async function leaveChannelVideoCall(req: Request, res: Response): Promise<void> {
    try {
        const { channelId } = req.params;
        const { callId } = req.body;
        const userId = (req as any).user?.userId;

        if (!userId || !channelId) {
            res.status(400).json({ error: 'Missing userId or channelId' });
            return;
        }

        const channel = await ChannelModel.findOne({ channelId });
        if (!channel || !channel.activeCall) {
            res.status(400).json({ error: 'No active call in this channel' });
            return;
        }

        // Save initiator before clearing
        const initiatorId = channel.activeCall.initiatorId;

        // Remove user from participants
        channel.activeCall.participants = channel.activeCall.participants.filter(
            (p: any) => p.toString() !== userId
        );

        // Check if this was the last participant
        const wasLastParticipant = channel.activeCall.participants.length === 0;

        // If no participants left, end the call
        if (wasLastParticipant) {
            channel.activeCall = null;
        }

        await channel.save();

        // Notify others
        const io = getIO();

        if (wasLastParticipant) {
            // DISABLED: Call history message logging - removed to prevent issues
            // if (callId) {
            //     try {
            //         const callHistoryObjectId = new mongoose.Types.ObjectId(callId);
            //         await CallEventLogger.logCallEvent(channelId, callHistoryObjectId, initiatorId);
            //     } catch (logError) {
            //         console.error('Error logging call event on last participant leave:', logError);
            //     }
            // }

            io.to(channelId).emit('channel:call-ended', {
                channelId,
                endedBy: userId,
                endedAt: new Date(),
                reason: 'last_participant_left',
                callId,
            });
        } else {
            // Otherwise, just notify that a user left
            io.to(channelId).emit('channel:call-user-left', {
                channelId,
                userId,
            });
        }

        res.json({ success: true, message: 'Left the call' });
    } catch (error) {
        console.error('Error leaving video call:', error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Failed to leave video call' });
    }
}

// Get active call information for a channel
export async function getChannelCallInfo(req: Request, res: Response): Promise<void> {
    try {
        const { channelId } = req.params;
        const userId = (req as any).user?.userId;

        if (!userId || !channelId) {
            res.status(400).json({ error: 'Missing userId or channelId' });
            return;
        }

        const channel = await ChannelModel.findOne({ channelId }).lean();
        if (!channel) {
            res.status(404).json({ error: 'Channel not found' });
            return;
        }

        // If no active call, return early
        if (!channel.activeCall) {
            res.json({
                hasActiveCall: false,
                activeCall: null,
            });
            return;
        }

        // Manually populate participants since they're embedded
        const participantIds = channel.activeCall.participants || [];
        const initiatorId = channel.activeCall.initiatorId;

        const allUserIds = [...participantIds];
        if (initiatorId && !allUserIds.some(id => String(id) === String(initiatorId))) {
            allUserIds.push(initiatorId);
        }

        const users = await UserMongooseModel.find({ _id: { $in: allUserIds } })
            .select('firstName lastName email')
            .lean();

        const userMap = new Map(users.map(u => [String(u._id), u]));
        const participants = participantIds.map(id => userMap.get(String(id))).filter(Boolean);
        const initiator = initiatorId ? userMap.get(String(initiatorId)) : null;

        res.json({
            hasActiveCall: true,
            activeCall: {
                ...channel.activeCall,
                participants,
                initiator: initiator ? {
                    id: String(initiator._id),
                    name: `${initiator.firstName} ${initiator.lastName}`
                } : null,
                type: channel.activeCall.type || 'video',
            },
        });
    } catch (error) {
        console.error('Error getting call info:', error);
        res.status(500).json({ error: 'Failed to get call info' });
    }
}

// Get call history for a channel
export async function getChannelCallHistory(req: Request, res: Response): Promise<void> {
    try {
        const { channelId } = req.params;
        const { limit = 10, skip = 0 } = req.query;
        const userId = (req as any).user?.userId;

        if (!userId || !channelId) {
            res.status(400).json({ error: 'Missing userId or channelId' });
            return;
        }

        // Get call history for the channel
        const callHistory = await CallHistoryModel.find({ channelId })
            .populate('initiatorId', 'firstName lastName email')
            .populate('participantIds', 'firstName lastName email')
            .sort({ startedAt: -1 })
            .limit(Number(limit) || 10)
            .skip(Number(skip) || 0)
            .lean();

        const totalCalls = await CallHistoryModel.countDocuments({ channelId });

        res.json({
            calls: callHistory,
            total: totalCalls,
            limit: Number(limit) || 10,
            skip: Number(skip) || 0,
        });
    } catch (error) {
        console.error('Error getting call history:', error);
        res.status(500).json({ error: 'Failed to get call history' });
    }
}

// Enable recording for active call
export async function enableRecording(req: Request, res: Response): Promise<void> {
    try {
        const { channelId } = req.params;
        const { callId } = req.body;
        const userId = (req as any).user?.userId;

        if (!userId || !channelId) {
            res.status(400).json({ error: 'Missing userId or channelId' });
            return;
        }

        const channel = await ChannelModel.findOne({ channelId }).lean();
        if (!channel) {
            res.status(404).json({ error: 'Channel not found' });
            return;
        }

        if (!channel.activeCall) {
            res.status(400).json({ error: 'No active call in this channel' });
            return;
        }

        const roomName = channel.activeCall.roomName;

        // Update call history with recording start time
        if (callId) {
            const updated = await CallHistoryModel.findByIdAndUpdate(
                callId,
                {
                    recordingEnabled: true,
                    recordingStartedAt: new Date(),
                },
                { new: true }
            );

            console.log(`🎥 Recording enabled for call ${callId} in room ${roomName}`);

            // Notify users that recording is enabled
            const io = getIO();
            io.to(channelId).emit('channel:recording-enabled', {
                callId,
                channelId,
                roomName,
                recordingStartedAt: updated?.recordingStartedAt,
            });

            res.json({
                success: true,
                message: 'Recording enabled',
                recordingStartedAt: updated?.recordingStartedAt,
            });
        } else {
            res.status(400).json({ error: 'Missing callId' });
        }
    } catch (error) {
        console.error('Error enabling recording:', error);
        res.status(500).json({ error: 'Failed to enable recording' });
    }
}

// Get user call statistics
export async function getUserCallStats(req: Request, res: Response): Promise<void> {
    try {
        const userId = (req as any).user?.userId;

        if (!userId) {
            res.status(400).json({ error: 'Missing userId' });
            return;
        }

        const objectId = new mongoose.Types.ObjectId(userId);

        // Get stats for initiated calls
        const initiatedCalls = await CallHistoryModel.countDocuments({ initiatorId: objectId });

        // Get stats for participated calls
        const participatedCalls = await CallHistoryModel.countDocuments({
            participantIds: objectId,
        });

        // Calculate total call duration
        const callStats = await CallHistoryModel.aggregate([
            {
                $match: {
                    $or: [
                        { initiatorId: objectId },
                        { participantIds: objectId },
                    ],
                },
            },
            {
                $group: {
                    _id: null,
                    totalDuration: { $sum: '$duration' },
                    totalCalls: { $sum: 1 },
                    averageDuration: { $avg: '$duration' },
                },
            },
        ]);

        const stats = callStats.length > 0 ? callStats[0] : { totalDuration: 0, totalCalls: 0, averageDuration: 0 };

        res.json({
            initiatedCalls,
            participatedCalls,
            totalDuration: stats.totalDuration,
            averageDuration: Math.round(stats.averageDuration || 0),
            totalCalls: stats.totalCalls,
        });
    } catch (error) {
        console.error('Error getting call stats:', error);
        res.status(500).json({ error: 'Failed to get call stats' });
    }
}

// Get all currently active video calls across all channels
export async function getActiveCalls(_req: Request, res: Response): Promise<void> {
    try {
        // Find channels with an active call. $ne: null works for non-existent values too.
        const activeChannels = await ChannelModel.find({
            'activeCall.roomName': { $exists: true, $ne: null }
        }).lean();

        if (activeChannels.length === 0) {
            res.json([]);
            return;
        }

        // Gather all user IDs we might need for one batch query (initiators and participants)
        const userIds = new Set<string>();
        activeChannels.forEach(c => {
            if (c.activeCall?.initiatorId) userIds.add(String(c.activeCall.initiatorId));
            c.activeCall?.participants?.forEach(p => userIds.add(String(p)));
        });

        // Batch fetch all required users
        const users = await UserMongooseModel.find({ _id: { $in: Array.from(userIds) } })
            .select('firstName lastName email')
            .lean();

        const userMap = new Map(users.map(u => [String(u._id), u]));

        // Transform into a frontend-friendly format
        const result = activeChannels.map(channel => {
            const initiator = channel.activeCall?.initiatorId
                ? userMap.get(String(channel.activeCall.initiatorId))
                : null;

            return {
                channelId: channel.channelId,
                channelName: channel.name,
                roomName: channel.activeCall?.roomName,
                startedAt: channel.activeCall?.startedAt,
                initiator: initiator ? {
                    id: String(initiator._id),
                    name: `${initiator.firstName} ${initiator.lastName}`
                } : { id: 'unknown', name: 'Someone' },
                participantsCount: channel.activeCall?.participants?.length || 0,
                type: channel.activeCall?.type || 'video',
            };
        });

        res.json(result);
    } catch (error) {
        console.error('Error in getActiveCalls:', error);
        res.status(500).json({ error: 'Failed to fetch active calls' });
    }
}
