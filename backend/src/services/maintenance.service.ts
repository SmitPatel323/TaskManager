import { CallHistoryModel } from '../models/callHistory.model.js';

const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Run once per day
const CALL_HISTORY_RETENTION_DAYS = parseInt(process.env.CALL_HISTORY_RETENTION_DAYS || '90', 10);

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the maintenance service
 * Periodically cleans up old call history records
 */
export function startMaintenanceService() {
    if (cleanupInterval) {
        console.warn('⚠️ Maintenance service already running');
        return;
    }

    console.log('🚀 Starting maintenance service');
    console.log(`🗑️ Call history retention: ${CALL_HISTORY_RETENTION_DAYS} days`);

    // Run immediately on startup
    cleanupOldCallHistory();

    // Then run periodically
    cleanupInterval = setInterval(async () => {
        await cleanupOldCallHistory();
    }, CLEANUP_INTERVAL);

    console.log(`✅ Maintenance service started (cleanup every ${CLEANUP_INTERVAL / (60 * 60 * 1000)} hours)`);
}

/**
 * Stop the maintenance service
 */
export function stopMaintenanceService() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        console.log('🛑 Maintenance service stopped');
    }
}

/**
 * Delete old call history records
 */
export async function cleanupOldCallHistory() {
    try {
        const retentionDate = new Date();
        retentionDate.setDate(retentionDate.getDate() - CALL_HISTORY_RETENTION_DAYS);

        console.log(`🧹 Cleaning up call history older than ${retentionDate.toISOString()}`);

        const result = await CallHistoryModel.deleteMany({
            createdAt: { $lt: retentionDate },
        });

        if (result.deletedCount > 0) {
            console.log(
                `✅ Deleted ${result.deletedCount} old call history records (${result.deletedCount * 10}KB+ freed)`
            );
        } else {
            console.log('✅ No old call history to clean up');
        }
    } catch (error) {
        console.error('❌ Call history cleanup error:', error);
    }
}

/**
 * Get call history statistics
 */
export async function getCallHistoryStats() {
    try {
        const totalRecords = await CallHistoryModel.countDocuments();
        // Estimate storage based on sample document size
        const sampleRecord = await CallHistoryModel.findOne().lean();
        const estimatedSize = sampleRecord ? totalRecords * JSON.stringify(sampleRecord).length : 0;

        return {
            totalRecords,
            storageSizeBytes: estimatedSize,
            retentionDays: CALL_HISTORY_RETENTION_DAYS,
        };
    } catch (error) {
        console.error('❌ Error getting call history stats:', error);
        return null;
    }
}

/**
 * Archive call history to external storage (optional - for advanced use)
 * This would export old records to S3/archive before deletion
 */
export async function archiveOldCallHistory(beforeDate: Date): Promise<number> {
    try {
        console.log(`📦 Archiving call history before ${beforeDate.toISOString()}`);

        const oldRecords = await CallHistoryModel.find({
            createdAt: { $lt: beforeDate },
        }).lean();

        if (oldRecords.length === 0) {
            console.log('✅ No records to archive');
            return 0;
        }

        // TODO: Implement S3/archive upload here
        // For now, just log the archive operation
        console.log(`📦 Would archive ${oldRecords.length} records`);

        // If archive succeeds, delete the local records
        // await CallHistoryModel.deleteMany({ createdAt: { $lt: beforeDate } });

        return oldRecords.length;
    } catch (error) {
        console.error('❌ Archive error:', error);
        return 0;
    }
}
