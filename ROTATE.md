# Credential Rotation Checklist

This document provides step-by-step instructions for rotating credentials that may have been exposed in Git history or need to be rotated for security best practices.

## ⚠️ Important Notes

- **Forked repositories**: If this repository was forked, the Git history in forks may still contain exposed secrets. Consider notifying fork maintainers.
- **Force push required**: After purging Git history, you must force-push. This rewrites history and may affect collaborators.
- **Backup first**: Always backup your repository before performing history rewrites.

## RapidAPI Key Rotation

### Step 1: Generate New API Key
1. Go to [RapidAPI Dashboard](https://rapidapi.com/developer/dashboard)
2. Navigate to **My Apps** → **Security**
3. Click **"Create API Key"** or **"Regenerate"**
4. Copy the new API key immediately (it won't be shown again)

### Step 2: Update Cloudflare Worker
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** → Your Worker
3. Go to **Settings** → **Variables**
4. Find `RAPIDAPI_KEY` environment variable
5. Click **Edit** → Update with new key
6. Select **"Secret"** type (if not already)
7. Click **"Save and deploy"**

### Step 3: Verify Worker Functionality
1. Test your Worker URL with a simple request
2. Check Cloudflare Worker logs for any errors
3. Verify your frontend application still works

### Step 4: Revoke Old API Key
1. Go back to RapidAPI Dashboard
2. Navigate to **My Apps** → **Security**
3. Find the old/exposed API key
4. Click **"Revoke"** or **"Delete"**
5. Confirm deletion

### Step 5: Monitor Usage
- Check RapidAPI usage dashboard for unexpected activity
- Monitor Cloudflare Worker logs for unauthorized access
- Set up alerts if available

**Location of credential**: Cloudflare Workers → Settings → Variables → `RAPIDAPI_KEY`

---

## Cloudflare Worker URL Rotation

If your Worker URL was exposed and you want to rotate it:

### Step 1: Create New Worker
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages**
3. Click **"Create Application"** → **"Create Worker"**
4. Give it a new name (different from the old one)
5. Copy the new Worker code from `cloudflare-worker.js`
6. Deploy the new Worker

### Step 2: Configure New Worker
1. Add `RAPIDAPI_KEY` environment variable (see RapidAPI rotation above)
2. Add `ALLOWED_ORIGINS` environment variable:
   - Value: `https://yourdomain.com,http://localhost:8000`
   - Type: **Secret** (recommended)
3. Deploy the Worker

### Step 3: Update Frontend
1. Update `script.js` with new Worker URL
2. Update `test-api.html` if used
3. Deploy updated frontend

### Step 4: Delete Old Worker (Optional)
1. Go to old Worker in Cloudflare Dashboard
2. Click **Settings** → **Delete Worker**
3. Confirm deletion

**Location of credential**: Cloudflare Workers → Your Worker → URL shown in dashboard

---

## GitHub Personal Access Token Rotation

If you suspect a GitHub token was exposed:

### Step 1: Generate New Token
1. Go to [GitHub Settings](https://github.com/settings/tokens)
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Select required scopes (minimum: `repo` for private repos)
4. Click **"Generate token"**
5. Copy token immediately (it won't be shown again)

### Step 2: Update Local Git Configuration
```bash
# Update remote URL if using token
git remote set-url origin https://YOUR_NEW_TOKEN@github.com/eamaster/x-scraper.git

# Or use SSH instead
git remote set-url origin git@github.com:eamaster/x-scraper.git
```

### Step 3: Revoke Old Token
1. Go to [GitHub Settings](https://github.com/settings/tokens)
2. Find the old/exposed token
3. Click **"Revoke"**
4. Confirm revocation

**Location of credential**: GitHub → Settings → Developer settings → Personal access tokens

---

## Cloudflare Account API Token Rotation

If you use Cloudflare API tokens:

### Step 1: Generate New Token
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click **"Create Token"**
3. Use **"Edit Cloudflare Workers"** template or create custom permissions
4. Click **"Continue to summary"** → **"Create Token"**
5. Copy token immediately

### Step 2: Update CI/CD or Local Tools
- Update any CI/CD pipelines using Cloudflare API
- Update local deployment scripts
- Update any automation tools

### Step 3: Revoke Old Token
1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Find the old token
3. Click **"Revoke"**
4. Confirm revocation

**Location of credential**: Cloudflare Dashboard → My Profile → API Tokens

---

## After Rotation Checklist

- [ ] All new credentials are stored in secure locations (Cloudflare Secrets, environment variables)
- [ ] Old credentials are revoked/deleted
- [ ] All services are tested and working with new credentials
- [ ] Git history has been purged (if needed, see `scripts/history-purge.sh`)
- [ ] Team members are notified of credential rotation
- [ ] Monitoring/alerts are set up for unauthorized access
- [ ] Documentation is updated with new credential locations

---

## Emergency Response

If you discover active unauthorized access:

1. **Immediately revoke** the exposed credential
2. **Rotate** to a new credential (follow steps above)
3. **Review logs** for unauthorized activity
4. **Check for data exfiltration** or abuse
5. **Notify affected services** (RapidAPI, Cloudflare, etc.)
6. **Consider rate limiting** or temporarily disabling the service
7. **Document the incident** for future reference

---

## Prevention

To prevent future exposure:

- ✅ Never commit real credentials to Git
- ✅ Use `.gitignore` for local config files
- ✅ Use environment variables and secrets management
- ✅ Enable pre-commit hooks (see `.pre-commit-config.yaml`)
- ✅ Run secret scanners regularly
- ✅ Use placeholder values in code
- ✅ Review code before committing
- ✅ Use separate credentials for development/production

