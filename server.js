require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');
app.set('views', __dirname);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files (track.js, etc.)

// AWS S3 Configuration
// If AWS credentials are in .env, use them. Otherwise, SDK will use:
// 1. ~/.aws/credentials (AWS CLI credentials)
// 2. IAM roles (if running on EC2/ECS/Lambda)
// 3. Other credential sources in the AWS SDK credential chain
const s3ClientConfig = {
    region: process.env.AWS_REGION || 'us-east-1'
};

// Only add explicit credentials if they're in .env
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    s3ClientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    };
    console.log('Using AWS credentials from .env file');
} else {
    console.log('Using AWS credentials from default credential chain (e.g., ~/.aws/credentials)');
}

const s3Client = new S3Client(s3ClientConfig);

const S3_BUCKET = process.env.S3_BUCKET_NAME;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;

// In-memory batch storage
let eventBatch = [];

/**
 * Flush events to S3 as NDJSON (newline-delimited JSON)
 */
async function flushToS3() {
    if (eventBatch.length === 0) {
        console.log('No events to flush');
        return { flushed: 0 };
    }

    const eventsToFlush = [...eventBatch];
    eventBatch = []; // Clear batch immediately to avoid duplicates

    // Convert to NDJSON format
    const ndjson = eventsToFlush.map(event => JSON.stringify(event)).join('\n') + '\n';

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `events/batch-${timestamp}.ndjson`;

    try {
        const command = new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: filename,
            Body: ndjson,
            ContentType: 'application/x-ndjson'
        });

        await s3Client.send(command);

        console.log(`✓ Flushed ${eventsToFlush.length} events to S3: ${filename}`);

        return {
            flushed: eventsToFlush.length,
            filename,
            bucket: S3_BUCKET
        };
    } catch (error) {
        console.error('✗ Failed to flush to S3:', error);

        // Put events back in batch on failure
        eventBatch = [...eventsToFlush, ...eventBatch];

        throw error;
    }
}

/**
 * POST /api/track - Receive track events
 */
app.post('/api/track', async (req, res) => {
    try {
        const event = req.body;

        // Validate event data
        if (!event.name) {
            return res.status(400).json({
                error: 'Event name is required'
            });
        }

        // Add to batch
        eventBatch.push({
            ...event,
            receivedAt: new Date().toISOString()
        });

        console.log(`→ Event received: ${event.name} (batch: ${eventBatch.length}/${BATCH_SIZE})`);

        // Check if we should flush
        let flushResult = null;
        if (eventBatch.length >= BATCH_SIZE) {
            console.log(`\n→ Batch size reached (${BATCH_SIZE}), flushing to S3...`);
            flushResult = await flushToS3();
        }

        res.json({
            success: true,
            batchSize: eventBatch.length,
            flushed: flushResult
        });

    } catch (error) {
        console.error('Error processing event:', error);
        res.status(500).json({
            error: 'Failed to process event',
            message: error.message
        });
    }
});

/**
 * POST /api/flush - Manually trigger flush
 */
app.post('/api/flush', async (req, res) => {
    try {
        console.log('\n→ Manual flush triggered...');
        const result = await flushToS3();

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Error flushing:', error);
        res.status(500).json({
            error: 'Failed to flush events',
            message: error.message
        });
    }
});

/**
 * GET /api/status - Check server status
 */
app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        batchSize: eventBatch.length,
        maxBatchSize: BATCH_SIZE,
        s3Bucket: S3_BUCKET,
        region: process.env.AWS_REGION || 'us-east-1'
    });
});

/**
 * GET / - Serve the main HTML page
 */
app.get('/', (req, res) => {
    res.render('index', {
        splitApiKey: process.env.HARNESS_FME_API_KEY || process.env.SPLIT_API_KEY || 'YOUR_HARNESS_FME_API_KEY'
    });
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        service: 'Harness FME + S3 Event Batching Server',
        version: '1.0.0',
        endpoints: {
            track: 'POST /api/track',
            flush: 'POST /api/flush',
            status: 'GET /api/status'
        }
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log('\n========================================');
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`S3 Bucket: ${S3_BUCKET}`);
    console.log(`Batch Size: ${BATCH_SIZE}`);
    console.log('========================================\n');
});

// Graceful shutdown - flush remaining events
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
    console.log('\n\n→ Shutting down gracefully...');

    // Stop accepting new requests
    server.close(async () => {
        console.log('→ Server closed');

        // Flush remaining events
        if (eventBatch.length > 0) {
            console.log(`→ Flushing ${eventBatch.length} remaining events...`);
            try {
                await flushToS3();
                console.log('✓ Final flush completed');
            } catch (error) {
                console.error('✗ Final flush failed:', error);
            }
        }

        console.log('→ Goodbye!\n');
        process.exit(0);
    });
}
