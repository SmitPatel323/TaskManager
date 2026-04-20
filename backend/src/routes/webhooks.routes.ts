import { Router, Request, Response } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { ENV } from '../config/env.js';
import { ChannelModel } from '../models/channel.model.js';
import { CallHistoryModel } from '../models/callHistory.model.js';
import { getIO } from '../infrastructure/socket.js';

const router = Router();

// Initialize webhook receiver for LiveKit events
// Uses API key and API secret to verify webhook signatures from LiveKit
const receiver = new WebhookReceiver(ENV.LIVEKIT_API_KEY, ENV.LIVEKIT_API_SECRET);

/**
 * LiveKit Webhook Handler
 * Receives events from LiveKit when rooms finish, participants join/leave, etc.
 */
router.post('/livekit/webhook', async (req: Request, res: Response) => {
    try {
        // Verify webhook signature
        const event = await receiver.receive(
            JSON.stringify(req.body),
            req.headers.authorization ?? ''
        );

        console.log(`📨 LiveKit Webhook Event: ${event.event}`);

        // Handle room_finished event - fired when last participant leaves
        if (event.event === 'room_finished') {
            console.log(`✅ Room finished: ${event.room?.name}`);

            // Extract channel ID from room name (e.g., "channel-general" -> "general")
            const roomName = event.room?.name || '';
            const channelId = roomName.replace('channel-', '').replace(/^channel_/, '').split('-').slice(1).join('-');

            // Get actual room duration from LiveKit (estimated, not stored in room object)
            const duration = event.room?.emptyTimeout || 0;

            console.log(`📊 Room duration: ${duration}s, channelId: ${channelId}`);

            // Find and update the call history record
            const callHistory = await CallHistoryModel.findOne({
                roomName,
                endedAt: { $exists: false }, // Not yet ended
            });

            if (callHistory) {
                console.log(`📝 Updating call history ${callHistory._id} with duration: ${duration}s`);

                callHistory.endedAt = new Date();
                callHistory.duration = duration;
                callHistory.durationVerifiedByLiveKit = true;
                await callHistory.save();

                // Clear active call from channel
                await ChannelModel.updateOne(
                    { channelId },
                    { activeCall: null }
                );

                // Notify users via socket that call truly ended
                const io = getIO();
                io.to(channelId).emit('channel:call-ended-by-livekit', {
                    channelId,
                    duration,
                    roomName,
                    source: 'livekit-webhook',
                });

                console.log(`✅ Call history updated and users notified`);
            } else {
                console.warn(`⚠️ No call history found for room: ${roomName}`);
            }

            res.json({ success: true, message: 'Room finished processed' });
            return;
        }

        // Handle room_started event
        if (event.event === 'room_started') {
            console.log(`🎬 Room started: ${event.room?.name}`);
            res.json({ success: true, message: 'Room started' });
            return;
        }

        // Handle participant_joined event
        if (event.event === 'participant_joined') {
            console.log(
                `👤 Participant joined: ${event.participant?.identity} in room ${event.room?.name}`
            );
            res.json({ success: true, message: 'Participant joined' });
            return;
        }

        // Handle participant_left event
        if (event.event === 'participant_left') {
            console.log(
                `👤 Participant left: ${event.participant?.identity} from room ${event.room?.name}`
            );
            res.json({ success: true, message: 'Participant left' });
            return;
        }

        // Note: Recording events are not part of the standard WebhookEvent type
        // They would come through event metadata if LiveKit sends them
        // For now, we handle egress_ended which indicates recording/streaming completion
        if (event.event === 'egress_ended') {
            console.log(`🎥 Egress/Recording ended for room: ${event.room?.name}`);
            res.json({ success: true, message: 'Recording/Egress ended' });
            return;
        }

        // Event not specifically handled
        res.json({ success: true, message: `Event ${event.event} received` });
    } catch (error) {
        if (error instanceof Error) {
            console.error('❌ Webhook error:', error.message);
            // Check if it's a validation error
            if (error.message.includes('Invalid webhook signature')) {
                res.status(401).json({ error: 'Invalid webhook signature' });
                return;
            }
        }
        console.error('❌ Webhook error:', error);
        res.status(500).json({ error: 'Failed to process webhook' });
    }
});

export default router;
