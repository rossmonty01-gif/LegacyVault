# LegacyVault Deployment Guide

## Prerequisites

- Node.js 24 or newer
- A server with persistent storage for SQLite database and uploads
- An SSL/TLS certificate (recommended for production)
- Environment variables configured

## Environment Setup

Create a `.env` file in the root directory:

```bash
PORT=3000
HOST=0.0.0.0
SESSION_SECRET=<generate-a-long-random-secret>
DATABASE_PATH=./data/legacyvault.sqlite
UPLOAD_DIR=./uploads
EMERGENCY_ACCESS_DELAY_DAYS=7
NODE_ENV=production
```

**Important**: Generate a strong `SESSION_SECRET` (at least 32 characters).

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Local Deployment

1. Clone the repository:

```bash
git clone https://github.com/rossmonty01-gif/LegacyVault.git
cd LegacyVault
```

2. Install dependencies (if using npm):

```bash
npm install
```

3. Start the application:

```bash
node server.mjs
```

The app will be available at `http://localhost:3000`.

## Production Deployment

### Using a Process Manager (Recommended)

Use PM2 for process management:

```bash
npm install -g pm2
pm2 start server.mjs --name "legacyvault" --env production
pm2 startup
pm2 save
```

### Using Systemd

Create `/etc/systemd/system/legacyvault.service`:

```ini
[Unit]
Description=LegacyVault Service
After=network.target

[Service]
Type=simple
User=legacyvault
WorkingDirectory=/home/legacyvault/LegacyVault
Environment="NODE_ENV=production"
Environment="PORT=3000"
Environment="HOST=127.0.0.1"
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable legacyvault
sudo systemctl start legacyvault
```

### Using Docker

Create `Dockerfile`:

```dockerfile
FROM node:24-slim

WORKDIR /app

COPY . .

RUN mkdir -p data uploads

EXPOSE 3000

CMD ["node", "server.mjs"]
```

Build and run:

```bash
docker build -t legacyvault .
docker run -d \
  -p 3000:3000 \
  -v legacyvault-data:/app/data \
  -v legacyvault-uploads:/app/uploads \
  -e SESSION_SECRET="your-secret-key" \
  --name legacyvault \
  legacyvault
```

## Reverse Proxy Setup (Nginx)

Create `/etc/nginx/sites-available/legacyvault`:

```nginx
upstream legacyvault_backend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 100M;

    location / {
        proxy_pass http://legacyvault_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/legacyvault /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Health Check

Verify the deployment:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{
  "ok": true,
  "name": "LegacyVault",
  "status": "healthy",
  "timestamp": "2026-06-16T10:00:00.000Z"
}
```

## Monitoring & Logging

- Monitor logs: `pm2 logs legacyvault`
- Check resource usage: `pm2 monit`
- Set up log rotation for production

## Backup Strategy

1. **Database**: Back up `data/legacyvault.sqlite` regularly
2. **Uploads**: Back up `uploads/` directory
3. **Environment**: Store `.env` securely

## SSL/TLS Certificate

Use Let's Encrypt for free SSL certificates:

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot certonly --nginx -d yourdomain.com
```

## Scaling

For high traffic, consider:

- Load balancing multiple Node.js instances
- Using a PostgreSQL or MySQL database instead of SQLite
- Implementing caching layer (Redis)
- Using CDN for static assets

## Security Checklist

- [ ] Set strong `SESSION_SECRET`
- [ ] Enable HTTPS/SSL
- [ ] Configure firewalls
- [ ] Keep Node.js updated
- [ ] Monitor logs for suspicious activity
- [ ] Set up regular backups
- [ ] Configure rate limiting
- [ ] Review and update security headers