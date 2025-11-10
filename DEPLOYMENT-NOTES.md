# Deployment Notes

## ⚠️ Important: Local Deployment Configuration

When deploying to your live server (e.g., hesam.me), you need to update `script.js` with your actual Worker URL **locally on the server**, but **DO NOT commit it to Git**.

## Quick Fix for Live Server

### Option 1: Direct Edit (Recommended)

1. **On your server** (hesam.me), edit the file: `/x-scraper/script.js`
2. Find line 5:
   ```javascript
   const WORKER_URL = 'YOUR_CLOUDFLARE_WORKER_URL';
   ```
3. Replace with your actual Worker URL:
   ```javascript
   const WORKER_URL = 'https://twitter-api-proxy.smah0085.workers.dev';
   ```
4. **DO NOT commit this change to Git**
5. Save and test

### Option 2: Use Local Override File

Create a file `worker-config.js` on your server (not in Git):

```javascript
// worker-config.js - Local override (DO NOT COMMIT)
window.WORKER_URL_OVERRIDE = 'https://twitter-api-proxy.smah0085.workers.dev';
```

Then update `index.html` to load it before `script.js`:

```html
<script src="worker-config.js"></script>
<script src="script.js"></script>
```

And update `script.js` to check for override:

```javascript
const WORKER_URL = window.WORKER_URL_OVERRIDE || 'YOUR_CLOUDFLARE_WORKER_URL';
```

### Option 3: Server-Side Environment Variable

If your server supports environment variables, you can inject the Worker URL server-side.

## Remember

- ✅ Update `script.js` on your **live server** with the real Worker URL
- ❌ **NEVER** commit the real Worker URL to Git
- ✅ The repository should always have `YOUR_CLOUDFLARE_WORKER_URL` placeholder
- ✅ Each deployment needs its own Worker URL configured locally

