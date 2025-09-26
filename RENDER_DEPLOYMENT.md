# Deploying Nostr Relay NestJS to Render

This guide provides step-by-step instructions for deploying the Nostr relay NestJS application to Render.

## Prerequisites

1. **Render Account**: Sign up at [render.com](https://render.com)
2. **GitHub Repository**: Push your code to a GitHub repository
3. **PostgreSQL Database**: You'll need a PostgreSQL database (Render PostgreSQL or external)
4. **Environment Variables**: Prepare your environment configuration

## Step 1: Prepare Your Repository

### 1.1 Create a Render-specific Environment File

Create a new file `render.env` in your project root:

```bash
# Render Environment Variables
NODE_ENV=production
PORT=10000
LOG_LEVEL=info

# Database Configuration
DATABASE_URL=postgresql://username:password@hostname:port/database

# Relay Configuration
RELAY_PUBKEY=your-64-character-nostr-public-key
RELAY_CONTACT=your-email@example.com
HOSTNAME=your-app-name.onrender.com

# Optional: MeiliSearch Configuration
MEILI_SEARCH_HOST=https://your-meilisearch-host.com
MEILI_SEARCH_API_KEY=your-meilisearch-api-key
MEILI_SEARCH_SYNC_EVENT_KINDS=0,1,30023,31000

# Optional: Web of Trust Configuration
# WOT_TRUST_ANCHOR_PUBKEY=trust-anchor-pubkey
# WOT_TRUST_DEPTH=1
# WOT_REFRESH_INTERVAL=3600000

# Performance Configuration
DATABASE_MAX_CONNECTIONS=20
LOG_SLOW_EXECUTION_THRESHOLD=500
MAX_SUBSCRIPTIONS_PER_CLIENT=20

# Throttling Configuration
THROTTLER_TTL=1000
THROTTLER_LIMIT=100
THROTTLER_EVENT_TTL=1000
THROTTLER_EVENT_LIMIT=10
THROTTLER_REQ_TTL=1000
THROTTLER_REQ_LIMIT=10

# Cache Configuration
EVENT_HANDLING_RESULT_CACHE_TTL=300000
FILTER_RESULT_CACHE_TTL=10000

# Message Handling Configuration
EVENT_MESSAGE_HANDLING_ENABLED=true
REQ_MESSAGE_HANDLING_ENABLED=true
CLOSE_MESSAGE_HANDLING_ENABLED=true
TOP_MESSAGE_HANDLING_ENABLED=true
AUTH_MESSAGE_HANDLING_ENABLED=true
```

### 1.2 Create a Render Build Script

Create `render-build.sh`:

```bash
#!/bin/bash
set -e

echo "Starting Render build process..."

# Install dependencies
npm ci

# Build the application
npm run build

# Run database migrations
npm run migration:run

echo "Build completed successfully!"
```

Make it executable:
```bash
chmod +x render-build.sh
```

### 1.3 Update package.json (Optional)

Add a Render-specific start script to your `package.json`:

```json
{
  "scripts": {
    "start:render": "node dist/src/main"
  }
}
```

## Step 2: Set Up PostgreSQL Database

### Option A: Render PostgreSQL (Recommended)

1. Go to your Render dashboard
2. Click "New +" → "PostgreSQL"
3. Configure:
   - **Name**: `nostr-relay-db`
   - **Database**: `nostr_relay`
   - **User**: `nostr_user`
   - **Region**: Choose closest to your users
   - **Plan**: Start with Free tier, upgrade as needed

4. Note the connection details for environment variables

### Option B: External PostgreSQL

Use any PostgreSQL provider (Supabase, Railway, Neon, etc.) and get the connection string.

## Step 3: Deploy to Render

### 3.1 Create a New Web Service

1. Go to your Render dashboard
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure the service:

**Basic Settings:**
- **Name**: `nostr-relay`
- **Environment**: `Node`
- **Region**: Choose closest to your users
- **Branch**: `main` (or your preferred branch)
- **Root Directory**: Leave empty (or specify if in subdirectory)

**Build & Deploy:**
- **Build Command**: `./render-build.sh`
- **Start Command**: `npm run start:render` (or `node dist/src/main`)

**Advanced Settings:**
- **Instance Type**: 
  - Free: 512MB RAM, 0.1 CPU
  - Starter: 512MB RAM, 0.5 CPU ($7/month)
  - Standard: 1GB RAM, 1 CPU ($25/month)
- **Auto-Deploy**: Yes (recommended)

### 3.2 Configure Environment Variables

In your Render service settings, go to "Environment" tab and add:

**Required Variables:**
```
NODE_ENV=production
PORT=10000
DATABASE_URL=postgresql://username:password@hostname:port/database
RELAY_PUBKEY=your-64-character-nostr-public-key
RELAY_CONTACT=your-email@example.com
HOSTNAME=your-app-name.onrender.com
```

**Optional Variables:**
```
LOG_LEVEL=info
MEILI_SEARCH_HOST=https://your-meilisearch-host.com
MEILI_SEARCH_API_KEY=your-meilisearch-api-key
MEILI_SEARCH_SYNC_EVENT_KINDS=0,1,30023,31000
DATABASE_MAX_CONNECTIONS=20
THROTTLER_TTL=1000
THROTTLER_LIMIT=100
```

### 3.3 Deploy

1. Click "Create Web Service"
2. Render will automatically:
   - Clone your repository
   - Run the build command
   - Start your application
   - Provide a public URL

## Step 4: Configure Custom Domain (Optional)

1. In your Render service settings, go to "Settings" tab
2. Scroll to "Custom Domains"
3. Add your domain (e.g., `relay.yourdomain.com`)
4. Follow Render's DNS configuration instructions
5. Update your `HOSTNAME` environment variable

## Step 5: Monitor and Scale

### 5.1 Monitor Your Service

- **Logs**: View real-time logs in Render dashboard
- **Metrics**: Monitor CPU, memory, and response times
- **Health Checks**: Render automatically checks `/health-check` endpoint

### 5.2 Scaling Considerations

**Free Tier Limitations:**
- 512MB RAM
- 0.1 CPU
- Sleeps after 15 minutes of inactivity
- 750 hours/month limit

**Upgrade When:**
- High traffic volume
- Need for always-on service
- Better performance requirements

## Step 6: Security Considerations

### 6.1 Environment Variables
- Never commit sensitive data to Git
- Use Render's environment variable system
- Rotate database credentials regularly

### 6.2 Database Security
- Use strong passwords
- Enable SSL connections
- Restrict database access to your Render service

### 6.3 Application Security
- The application already includes:
  - Helmet for security headers
  - CORS configuration
  - Rate limiting
  - Input validation

## Troubleshooting

### Common Issues

**1. Build Failures:**
- Check Node.js version compatibility
- Ensure all dependencies are in `package.json`
- Verify build command syntax

**2. Database Connection Issues:**
- Verify `DATABASE_URL` format
- Check database credentials
- Ensure database is accessible from Render

**3. Application Crashes:**
- Check logs for error messages
- Verify environment variables
- Ensure port configuration is correct

**4. Performance Issues:**
- Monitor resource usage
- Consider upgrading instance type
- Optimize database queries
- Implement caching strategies

### Debug Commands

```bash
# Check application logs
# (Available in Render dashboard)

# Test database connection
npm run migration:run

# Verify environment variables
node -e "console.log(process.env)"
```

## Cost Estimation

**Render Pricing (as of 2024):**
- **Free Tier**: $0/month (with limitations)
- **Starter**: $7/month (512MB RAM, 0.5 CPU)
- **Standard**: $25/month (1GB RAM, 1 CPU)
- **Pro**: $85/month (2GB RAM, 2 CPU)

**PostgreSQL Pricing:**
- **Free Tier**: $0/month (1GB storage, 1 connection)
- **Starter**: $7/month (1GB storage, 100 connections)
- **Standard**: $20/month (10GB storage, 100 connections)

## Maintenance

### Regular Tasks
1. **Monitor logs** for errors
2. **Update dependencies** regularly
3. **Backup database** (Render handles this automatically)
4. **Monitor performance** metrics
5. **Update environment variables** as needed

### Updates
1. Push changes to your Git repository
2. Render will automatically redeploy
3. Monitor the deployment process
4. Verify the application is working correctly

## Support

- **Render Documentation**: [render.com/docs](https://render.com/docs)
- **Render Support**: Available through dashboard
- **Nostr Protocol**: [nostr.com](https://nostr.com)
- **NestJS Documentation**: [nestjs.com](https://nestjs.com)

---

## Quick Start Checklist

- [ ] Push code to GitHub repository
- [ ] Create Render PostgreSQL database
- [ ] Create Render Web Service
- [ ] Configure environment variables
- [ ] Deploy and test
- [ ] Set up custom domain (optional)
- [ ] Monitor and scale as needed

Your Nostr relay should now be running on Render! 🚀
