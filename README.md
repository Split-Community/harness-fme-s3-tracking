# Harness FME + AWS S3 Event Tracking Example

> A Node.js example demonstrating how to track events to both Harness Feature Management & Experimentation (FME) and AWS S3 using a server-side batching approach.

## Overview

This example shows how to:
- Track events to Harness FME using the Split SDK's `track()` method
- Simultaneously batch and store the same events to AWS S3 as NDJSON files
- Use a Node.js Express server for secure credential management and event batching
- Avoid exposing AWS credentials on the client side

**Why this approach?** Tracking events to S3 provides a backup data warehouse for analytics, compliance, or custom data processing while maintaining real-time tracking to Harness FME.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  ┌─────────────────┐                                        │
│  │  index.ejs      │                                        │
│  │  (HTML + JS)    │                                        │
│  └────────┬────────┘                                        │
│           │                                                  │
│           ├──────────────────────┐                          │
│           │                      │                          │
│           ▼                      ▼                          │
│  ┌─────────────────┐   ┌─────────────────┐                 │
│  │  Harness FME    │   │  track.js       │                 │
│  │  SDK (Split)    │   │  wrapper        │                 │
│  └────────┬────────┘   └────────┬────────┘                 │
│           │                      │                          │
└───────────┼──────────────────────┼──────────────────────────┘
            │                      │
            ▼                      ▼
    ┌──────────────┐      ┌──────────────────────────┐
    │ Harness FME  │      │  Express Server          │
    │ Cloud        │      │  (server.js)             │
    └──────────────┘      │                          │
                          │  • Batches events        │
                          │  • Flushes @ 100 events  │
                          │  • NDJSON format         │
                          └────────┬─────────────────┘
                                   │
                                   ▼
                          ┌──────────────────────────┐
                          │  AWS S3 Bucket           │
                          │  events/*.ndjson         │
                          └──────────────────────────┘
```


## Prerequisites

- **Node.js** v14 or higher
- **AWS Account** with S3 access
- **Harness FME Account** ([sign up free](https://www.split.io/sign-up))

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure AWS S3

#### Create an S3 Bucket

```bash
# Using AWS CLI
aws s3 mb s3://your-bucket-name --region us-east-1
```

Or create via [AWS Console](https://console.aws.amazon.com/s3/).

#### Configure AWS Credentials

**Option 1: AWS CLI (Recommended for Local Development)**

```bash
aws configure
# Enter your credentials when prompted
```

This stores credentials in `~/.aws/credentials`. The server will automatically use them — **no need to put credentials in `.env`!**

**Option 2: Explicit Credentials in .env**

For deployment environments, you can set credentials directly in `.env`:

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Create a new user with programmatic access
3. Attach a policy with `s3:PutObject` permission
4. Add credentials to `.env` (see Step 3)

### 3. Configure Environment Variables

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Harness FME SDK Key (get from https://app.harness.io/)
HARNESS_FME_API_KEY=your_harness_fme_sdk_key_here

# AWS Configuration
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name

# Server Configuration (optional)
PORT=3000
BATCH_SIZE=100

# Only needed if NOT using AWS CLI credentials:
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...
```

**Get your Harness FME SDK key:**
1. Log in to [Harness](https://app.harness.io/)
2. Go to **Feature Management and Experimentation** → **Environments**
3. Select your environment
4. Copy the **Client-side SDK Key**

### 4. Start the Server

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

You should see:

```
========================================
Server running on http://localhost:3000
S3 Bucket: your-bucket-name
Batch Size: 100
========================================
```

### 5. Open the Application

Visit **http://localhost:3000** in your browser.

The server will render the HTML page with your Harness FME API key automatically injected from the `.env` file.

## Usage

1. Click the **"Send Track Event"** button
2. Watch the event log in the UI
3. Check the server console for batching progress
4. After 100 events, the batch will automatically flush to S3

### Manual Flush

To flush events before reaching the batch size:

```bash
curl -X POST http://localhost:3000/api/flush
```

### Check Server Status

```bash
curl http://localhost:3000/api/status
```

## S3 Output Format

Events are stored as [NDJSON](http://ndjson.org/) (newline-delimited JSON) files:

**S3 Path**: `s3://your-bucket-name/events/batch-YYYY-MM-DDTHH-MM-SS-mmmZ.ndjson`

**File Content**:
```json
{"trafficType":"user","name":"button_click","value":1,"properties":{"timestamp":"2025-10-24T10:30:15.123Z","counter":1,"userAgent":"Mozilla/5.0...","page":"/"},"timestamp":"2025-10-24T10:30:15.456Z"}
{"trafficType":"user","name":"button_click","value":2,"properties":{"timestamp":"2025-10-24T10:30:16.234Z","counter":2,"userAgent":"Mozilla/5.0...","page":"/"},"timestamp":"2025-10-24T10:30:16.567Z"}
```

### Reading NDJSON Files

**Python:**
```python
import json

with open('batch.ndjson', 'r') as f:
    for line in f:
        event = json.loads(line)
        print(event)
```

**Command Line:**
```bash
# Pretty print
cat batch.ndjson | jq '.'

# Filter events
cat batch.ndjson | jq 'select(.name == "button_click")'

# Count events
wc -l batch.ndjson
```

**AWS Athena:**
NDJSON can be queried directly using [AWS Athena](https://docs.aws.amazon.com/athena/latest/ug/json.html) for SQL-based analytics.

## API Endpoints

### POST /api/track

Track an event (used by frontend).

**Request:**
```json
{
  "trafficType": "user",
  "name": "button_click",
  "value": 1,
  "properties": {
    "timestamp": "2025-10-24T10:30:15.123Z",
    "counter": 1
  }
}
```

**Response:**
```json
{
  "success": true,
  "batchSize": 45,
  "flushed": null
}
```

When batch size is reached (100 events):
```json
{
  "success": true,
  "batchSize": 0,
  "flushed": {
    "flushed": 100,
    "filename": "events/batch-2025-10-24T10-30-15-123Z.ndjson",
    "bucket": "your-bucket-name"
  }
}
```

### POST /api/flush

Manually trigger flush to S3.

**Response:**
```json
{
  "success": true,
  "flushed": 45,
  "filename": "events/batch-2025-10-24T10-30-15-123Z.ndjson",
  "bucket": "your-bucket-name"
}
```

### GET /api/status

Get server status.

**Response:**
```json
{
  "status": "running",
  "batchSize": 45,
  "maxBatchSize": 100,
  "s3Bucket": "your-bucket-name",
  "region": "us-east-1"
}
```

### GET /health

Health check and API information.

**Response:**
```json
{
  "service": "Harness FME + S3 Event Batching Server",
  "version": "1.0.0",
  "endpoints": {
    "track": "POST /api/track",
    "flush": "POST /api/flush",
    "status": "GET /api/status"
  }
}
```

### GET /

Serves the main HTML application page with Harness FME API key injected from `.env`.

## Configuration

### Batch Size

Change the batch size in `.env`:

```env
BATCH_SIZE=50  # Flush every 50 events instead of 100
```

### AWS Region

Change the AWS region in `.env`:

```env
AWS_REGION=eu-west-1
```

### Server Port

Change the port in `.env`:

```env
PORT=8080
```

## Project Structure

```
track-multi/
├── .env.example          # Environment variable template
├── .gitignore           # Git ignore file
├── index.ejs            # HTML template (rendered by server)
├── package.json         # Node.js dependencies
├── README.md           # This file
├── server.js           # Express server with batching logic
└── track.js            # Client-side tracking wrapper
```

## How It Works

### Client-Side (track.js)

The `track.js` module provides a simple wrapper:

1. **Initialization**: Call `initTracker(client)` once when the Harness FME SDK is ready
2. **Tracking**: Call `track(trafficType, eventName, value, properties)` to track events
3. **Dual Send**: Events are sent to both:
   - Harness FME via the SDK's native `track()` method
   - Express server via `POST /api/track`

```javascript
import { initTracker, track } from './track.js';

// Initialize once
const client = factory.client();
initTracker(client);

// Track events
await track('user', 'button_click', 1, { page: '/home' });
```

### Server-Side (server.js)

The Express server:

1. Receives events via `POST /api/track`
2. Adds them to an in-memory batch array
3. When batch size reaches 100 (configurable):
   - Converts events to NDJSON format
   - Uploads to S3 with timestamp-based filename
   - Clears the batch
4. On graceful shutdown, flushes remaining events

### Template Injection (index.ejs)

The server renders `index.ejs` with the Harness FME API key injected from `.env`:

```html
<!-- index.ejs -->
<script>
const factory = window.splitio({
  core: {
    authorizationKey: '<%= splitApiKey %>'  // From .env
  }
});
</script>
```

This keeps secrets server-side and out of version control.

## Troubleshooting

### CORS Errors

If you see CORS errors in the browser console:
1. Ensure the server is running (`npm start`)
2. Check the server URL in `track.js` matches your server port

### AWS Credentials Error

If you see AWS credential errors:
1. Double-check your `.env` file
2. Verify IAM user has S3 write permissions
3. Confirm the bucket name is correct and exists
4. If using AWS CLI: run `aws s3 ls` to verify credentials work

### Harness FME SDK Timeout

If the Harness FME SDK times out:
- This is normal if you don't have a valid API key
- Events will still be sent to S3
- For production, get a real API key from [Harness](https://app.harness.io/)

### Events Not Flushing

- Events only flush after 100 events (by default)
- Use `POST /api/flush` to manually flush
- Check server logs for errors

### Module Import Errors

If you see `Cannot use import statement outside a module`:
- Ensure your HTML is served by the Express server at `http://localhost:3000`
- Don't open `index.ejs` directly as a file (it needs templating)

## Security Considerations

**For Production Deployments:**

1. **Don't commit `.env`**: Already in `.gitignore`
2. **Use IAM Roles**: If running on AWS (EC2, Lambda), use IAM roles instead of access keys
3. **Least Privilege**: Grant only `s3:PutObject` permission, not `AmazonS3FullAccess`
4. **Environment-specific Keys**: Use different AWS credentials for dev/staging/production
5. **HTTPS**: Use HTTPS in production
6. **Rate Limiting**: Add rate limiting to prevent abuse
7. **Authentication**: Add authentication to the API endpoints
8. **Input Validation**: Validate event data before storage
9. **Monitoring**: Set up CloudWatch alarms for S3 write failures

## Use Cases

This example is useful for:

- **Compliance & Auditing**: Keep immutable event logs in S3 for compliance
- **Custom Analytics**: Process events with AWS Athena, EMR, or Glue
- **Data Warehousing**: Load events into Redshift or Snowflake
- **Backup**: Maintain a backup of all events outside Harness FME
- **Cost Optimization**: Analyze events in S3 instead of making expensive API calls

## Learn More

- [Harness FME Documentation](https://developer.harness.io/docs/feature-flags/)
- [Split SDK Reference](https://help.split.io/hc/en-us/articles/360020448791-JavaScript-SDK)
- [AWS S3 Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/best-practices.html)
- [NDJSON Specification](http://ndjson.org/)

## Contributing

This is a community example. Feel free to:
- Open issues for bugs or questions
- Submit pull requests for improvements
- Adapt this example for your own use cases

## Support

For Harness FME support, visit the [Harness Community](https://community.harness.io/) or [documentation](https://developer.harness.io/).

For AWS support, refer to [AWS Support](https://aws.amazon.com/premiumsupport/).

---

**Note**: This example uses the Split SDK (now part of Harness FME). The SDK naming conventions reference "Split" for backward compatibility, but the service is now **Harness Feature Management & Experimentation (FME)**.
