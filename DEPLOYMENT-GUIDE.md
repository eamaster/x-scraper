# Complete Deployment Guide

## 🚀 Quick Deployment for hesam.me

### Step 1: Pull Latest Code from GitHub

On your server (hesam.me), pull the latest changes:

```bash
cd /path/to/x-scraper
git pull origin main
```

### Step 2: Run Deployment Script

**Option A: Using Bash (Linux/macOS)**
```bash
bash deploy.sh https://twitter-api-proxy.smah0085.workers.dev
```

**Option B: Using PowerShell (Windows)**
```powershell
.\deploy.ps1 -WorkerUrl "https://twitter-api-proxy.smah0085.workers.dev"
```

**Option C: Manual Setup**
If scripts don't work, manually create `worker-config.js`:

```bash
cat > worker-config.js << 'EOF'
/**
 * Worker Configuration - PRODUCTION
 * ⚠️ This file is gitignored and should NOT be committed to Git.
 */

window.WORKER_URL_OVERRIDE = 'https://twitter-api-proxy.smah0085.workers.dev';
EOF
```

### Step 3: Verify Files

Your server should have:
- ✅ `index.html` (loads worker-config.js)
- ✅ `script.js` (checks for WORKER_URL_OVERRIDE)
- ✅ `worker-config.js` (contains your Worker URL) ← **This is the key file!**

### Step 4: Test Your Site

1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh (Ctrl+F5)
3. Go to: https://hesam.me/x-scraper/
4. Try searching for "AI" or getting user "elonmusk"

---

## 🔧 Cloudflare Worker Configuration

### Verify Worker Code is Updated

1. Go to: https://dash.cloudflare.com/767ce92674d0bd477eef696c995faf16/workers/services/view/twitter-api-proxy/production
2. Click **"Edit Code"**
3. Verify it has the CORS allowlist code (from `cloudflare-worker.js`)
4. If not, copy the code from `cloudflare-worker.js` and deploy

### Add Environment Variables

1. Go to **Settings** → **Variables**
2. Verify `RAPIDAPI_KEY` exists (Type: Secret)
3. **Add `ALLOWED_ORIGINS`**:
   - **Variable name:** `ALLOWED_ORIGINS`
   - **Value:** `https://hesam.me,http://localhost:8000`
   - **Type:** Secret
4. Click **"Save and deploy"**

---

## ✅ Verification Checklist

- [ ] `worker-config.js` exists on server with Worker URL
- [ ] Cloudflare Worker code is updated (CORS allowlist)
- [ ] `RAPIDAPI_KEY` environment variable is set in Cloudflare
- [ ] `ALLOWED_ORIGINS` environment variable is set in Cloudflare
- [ ] Site loads without "API configuration not found" error
- [ ] Search functionality works
- [ ] User profile lookup works

---

## 🐛 Troubleshooting

### Error: "API configuration not found"
- **Cause:** `worker-config.js` is missing or doesn't have Worker URL
- **Fix:** Run `deploy.sh` or manually create `worker-config.js`

### Error: CORS errors
- **Cause:** `ALLOWED_ORIGINS` not set or doesn't include your domain
- **Fix:** Add `https://hesam.me` to `ALLOWED_ORIGINS` in Cloudflare Worker

### Error: "API key not configured"
- **Cause:** `RAPIDAPI_KEY` missing in Cloudflare Worker
- **Fix:** Add `RAPIDAPI_KEY` environment variable in Cloudflare Worker

### Error: 404 for worker-config.js
- **Cause:** File doesn't exist on server
- **Fix:** Run deployment script or manually create the file

---

## 📝 Automated Deployment (Optional)

If you want to automate this, add to your deployment process:

```bash
# In your deployment script or CI/CD
git pull origin main
bash deploy.sh https://twitter-api-proxy.smah0085.workers.dev
```

---

## 🔒 Security Reminder

- ✅ `worker-config.js` is gitignored (won't be committed)
- ✅ Repository always has placeholder `YOUR_CLOUDFLARE_WORKER_URL`
- ✅ Each deployment needs its own `worker-config.js`
- ✅ Never commit `worker-config.js` to Git

