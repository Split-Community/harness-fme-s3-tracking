// Module-level storage for Split client
let splitClient = null;

/**
 * Initialize the tracker with a Split.io client instance
 * Call this once during app initialization
 *
 * @param {object} client - The Split.io client instance
 */
export function initTracker(client) {
    if (!client) {
        throw new Error('Split client is required');
    }
    splitClient = client;
    console.log('Tracker initialized with Split client');
}

/**
 * track method for multiple analytics tools
 * Sends events to Split.io and batches them to S3 via Express server
 *
 * @param {string} trafficType - The traffic type
 * @param {string} name - The event name
 * @param {number} value - The event value
 * @param {object} properties - The event properties
 *
 * @returns {Promise<void>}
 */
export async function track(trafficType, name, value, properties) {
    if (!splitClient) {
        throw new Error('Tracker not initialized. Call initTracker(client) first.');
    }

    // Track to Harness FME
    const splitResult = splitClient.track(trafficType, name, value, properties);

    // Track to S3 via Express server
    await trackToS3({
        trafficType,
        name,
        value,
        properties,
        timestamp: new Date().toISOString()
    });

    return splitResult;
}

/**
 * Send event data to Express server for batching to S3
 *
 * @param {object} eventData - The event data to send
 * @returns {Promise<void>}
 */
async function trackToS3(eventData) {
    const SERVER_URL = 'http://localhost:3000/api/track';

    try {
        const response = await fetch(SERVER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(eventData)
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('Event sent to S3 batching server:', result);

    } catch (error) {
        // Log error but don't throw - we don't want S3 tracking failures to break the app
        console.error('Failed to send event to S3 batching server:', error);

        // Could optionally implement retry logic or local queue here
    }
}
