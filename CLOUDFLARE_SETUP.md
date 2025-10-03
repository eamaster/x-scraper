# Cloudflare Worker Setup Guide

This guide will walk you through setting up a Cloudflare Worker to securely proxy your API requests.

## Why Use Cloudflare Workers?

Cloudflare Workers act as a secure proxy between your frontend and the RapidAPI Twitter API. This keeps your API key hidden on the server side, making it safe to publish your code publicly.

## Step-by-Step Setup

### 1. Sign Up for Cloudflare (Free)

1. Go to [cloudflare.com](https://www.cloudflare.com/)
2. Click "Sign Up" if you don't have an account
3. The free plan is sufficient for this project

### 2. Create a Worker

1. Log in to your Cloudflare Dashboard
2. Click on "Workers & Pages" in the left sidebar
3. Click "Create Application"
4. Select "Create Worker"
5. Give your worker a name (e.g., `twitter-api-proxy`)
6. Click "Deploy" (we'll edit the code in the next step)

### 3. Edit Worker Code

1. After deployment, click "Edit Code" or go to your worker and click "Quick Edit"
2. Delete all the default code
3. Open `cloudflare-worker.js` from this repository
4. Copy the entire contents
5. Paste it into the Cloudflare Worker editor
6. Click "Save and Deploy"

### 4. Add Your API Key as Environment Variable

1. Go back to your Worker's main page (click the worker name in the breadcrumb)
2. Click on "Settings" tab
3. Click on "Variables" in the sidebar
4. Under "Environment Variables", click "Add variable"
5. Enter:
   - **Variable name:** `RAPIDAPI_KEY`
   - **Value:** Your actual RapidAPI key (get it from [RapidAPI Dashboard](https://rapidapi.com/developer/dashboard))
   - **Type:** Leave as "Plaintext" for now (you can use "Secret" for extra security)
6. Click "Save"

> **Note:** For production, it's recommended to use "Secret" type for the API key. Cloudflare will encrypt it and it won't be visible after saving.

### 5. Get Your Worker URL

1. Your Worker URL will be in the format:
   ```
   https://your-worker-name.your-subdomain.workers.dev
   ```
2. You can find this URL on your Worker's page
3. Copy this URL - you'll need it for the next step

### 6. Update Your Frontend Code

1. Open `script.js` in your project
2. Find the line:
   ```javascript
   const WORKER_URL = 'YOUR_CLOUDFLARE_WORKER_URL';
   ```
3. Replace it with your actual Worker URL:
   ```javascript
   const WORKER_URL = 'https://twitter-api-proxy.your-subdomain.workers.dev';
   ```
4. Save the file

### 7. Test Your Setup

1. Open `index.html` in your browser
2. Try searching for a keyword or username
3. If everything is set up correctly, you should see results!

### 8. Deploy Your Site

Now that your API key is secure, you can safely deploy your site to any platform:

- **GitHub Pages:** Push to a `gh-pages` branch
- **Netlify:** Drag and drop your folder or connect to GitHub
- **Vercel:** Connect your GitHub repository
- **Cloudflare Pages:** Use Cloudflare's own hosting (works great with Workers!)

## Troubleshooting

### "API configuration not found" Error

- Make sure you've set `WORKER_URL` correctly in `script.js`
- Check that your Worker is deployed and accessible

### "API key not configured" Error

- Verify you added the `RAPIDAPI_KEY` environment variable in Cloudflare
- Make sure the variable name is exactly `RAPIDAPI_KEY` (case-sensitive)
- Try redeploying your Worker after adding the variable

### CORS Errors

- The Worker code includes CORS headers, but if you still see CORS errors:
- Make sure you deployed the full `cloudflare-worker.js` code
- Check that the Worker is handling OPTIONS requests correctly

### Worker Not Responding

- Check the Worker logs in Cloudflare Dashboard > Workers & Pages > [Your Worker] > Logs
- Make sure your RapidAPI subscription is active
- Verify your API key is valid

## Cost

- **Cloudflare Workers Free Plan:**
  - 100,000 requests per day
  - More than enough for personal projects
  
- **RapidAPI Twttr API:**
  - Check the API pricing on RapidAPI
  - Most plans include a free tier

## Security Best Practices

✅ **Do:**
- Use environment variables for API keys
- Keep your Worker code updated
- Monitor your Worker usage in Cloudflare Dashboard
- Use "Secret" type for sensitive environment variables

❌ **Don't:**
- Commit API keys to version control
- Share your Worker URL if it's not rate-limited
- Use the local development method (`config.js`) in production

## Custom Domain (Optional)

You can use a custom domain with your Worker:

1. Add a domain to Cloudflare
2. Go to Workers & Pages > [Your Worker] > Settings > Triggers
3. Click "Add Custom Domain"
4. Enter your subdomain (e.g., `api.yourdomain.com`)
5. Cloudflare will automatically set up SSL

## Need Help?

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [RapidAPI Support](https://rapidapi.com/support/)
- Open an issue on this GitHub repository

