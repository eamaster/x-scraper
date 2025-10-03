# X Scraper - Complete Twitter API Tool

A comprehensive web application for exploring Twitter data with 50+ endpoints. Search tweets, analyze users, explore communities, track trends, and much more - all with a beautiful, modern interface.

## ✨ Features

### 🔍 Search & Explore
- **Advanced Search**: Find tweets by keyword, hashtag, or username with filtering options
- **Autocomplete**: Get intelligent username and hashtag suggestions
- **Multiple Search Types**: Top, Latest, People, Photos, Videos

### 👤 User Analytics
- **User Profiles**: Get detailed user information with stats
- **User Content**: View tweets, replies, media posts, and likes
- **User Network**: Analyze followers, following, and verified followers
- **User Activity**: Track user engagement and posting patterns

### 📝 Tweet Details
- **Tweet Information**: Get complete tweet details and metadata
- **Engagement Analysis**: View comments, retweets, quotes, and likes
- **Batch Operations**: Fetch multiple tweets by IDs
- **Reply Threads**: Follow conversation threads

### 👥 Communities
- **Search Communities**: Find communities by topic or keyword
- **Community Details**: Get comprehensive community information
- **Community Content**: View community tweets and timelines
- **Members & Moderators**: See community participants
- **Topics**: Browse community topics and categories

### 📋 Lists
- **Search Lists**: Find Twitter lists by query
- **List Management**: View list details, timelines, and members
- **List Followers**: See who follows specific lists
- **List Content**: Browse list tweets and members

### 📈 Trends
- **Global Trends**: See what's trending worldwide
- **Location-Based Trends**: Get trends for specific locations
- **Trend Analysis**: View tweet volumes and trending topics
- **Available Locations**: Browse all locations with trend data

## 🔒 Security Features

- ✅ **API Key Protection**: Keys stored securely in Cloudflare Workers
- ✅ **Zero Exposure**: Frontend never exposes sensitive credentials
- ✅ **CORS Configured**: Proper security headers in place
- ✅ **Git Ignore**: Sensitive files excluded from version control
- ✅ **Environment Variables**: Secure key management

## 🚀 Setup Instructions

### Option 1: Production Setup (Recommended)

#### 1. Get RapidAPI Key

1. Sign up at [RapidAPI](https://rapidapi.com/)
2. Subscribe to [Twitter241 API](https://rapidapi.com/Alexandr3322/api/twitter241)
3. Copy your API key from the dashboard

#### 2. Deploy Cloudflare Worker

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages**
3. Click **"Create Application"** → **"Create Worker"**
4. Name it `twitter-api-proxy`
5. Click **"Deploy"**
6. Click **"Edit Code"**
7. Copy the contents of `cloudflare-worker.js` from this repo
8. Paste into the Cloudflare editor
9. Click **"Save and Deploy"**

#### 3. Add Environment Variable

1. Go to your Worker's **Settings** → **Variables**
2. Click **"Add variable"**
3. Add:
   - **Variable name**: `RAPIDAPI_KEY`
   - **Value**: Your RapidAPI key
   - **Type**: "Secret" (recommended)
4. Click **"Save and deploy"**

#### 4. Update Worker Code

1. In Cloudflare, go back to your Worker
2. Click **"Edit Code"** again
3. The code should already be there from step 2
4. Click **"Save and Deploy"** again (to apply the environment variable)

#### 5. Configure Frontend

1. Copy your Worker URL (format: `https://twitter-api-proxy.YOUR-SUBDOMAIN.workers.dev`)
2. Open `script.js` in this project
3. Update line 2:
   ```javascript
   const WORKER_URL = 'https://twitter-api-proxy.YOUR-SUBDOMAIN.workers.dev';
   ```

#### 6. Deploy Your Site

Deploy to any static hosting:
- **GitHub Pages**: Push to `gh-pages` branch
- **Netlify**: Connect repository or drag & drop
- **Vercel**: Import GitHub repository
- **Cloudflare Pages**: Perfect companion to Workers!

### Option 2: Local Development

⚠️ **Warning**: Only for testing. Never commit `config.js` to version control!

1. Copy the config template:
   ```bash
   cp config.example.js config.js
   ```

2. Edit `config.js` with your API key:
   ```javascript
   window.API_CONFIG = {
       key: 'your_actual_rapidapi_key_here',
       host: 'twitter241.p.rapidapi.com'
   };
   ```

3. In `script.js`, set:
   ```javascript
   const WORKER_URL = null;
   ```

4. Run a local server:
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Node.js
   npx http-server
   
   # PHP
   php -S localhost:8000
   ```

5. Open `http://localhost:8000` in your browser

## 📖 How to Use

### Search Tab
1. Enter a keyword, #hashtag, or @username
2. Select search type (Top, Latest, People, Photos, Videos)
3. Set result count
4. Click "Search"

### User Tab
1. Enter a username (without @)
2. Click "Get Profile" to see user info
3. Use content buttons to view tweets, replies, media, or likes
4. Use network buttons to see followers and following

### Tweet Tab
1. Enter a tweet ID
2. Click "Get Tweet" to see details
3. Use interaction buttons to view comments, retweets, quotes, or likes

### Community Tab
1. Search for communities by keyword
2. Get community topics or explore timeline
3. Enter community ID for specific community details
4. View tweets, members, and moderators

### Lists Tab
1. Search for lists by query
2. Enter list ID for specific list operations
3. View timeline, members, or followers

### Trends Tab
1. Click "Get Available Locations" to see all locations
2. Enter a WOEID (location ID)
3. Click "Get Trends" to see trending topics

## 🎨 Technologies Used

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **API**: Twitter241 API via RapidAPI
- **Proxy**: Cloudflare Workers (serverless)
- **Hosting**: Any static site host
- **Security**: Environment variables, CORS, API key protection

## 📊 API Endpoints Supported

### User Endpoints (13)
- Get User by Username
- Get Users by IDs
- User Tweets / Replies / Media / Likes
- Followers / Following / Verified Followers
- User Highlights

### Tweet Endpoints (8)
- Get Tweet Details
- Get Tweets by IDs
- Comments / Retweets / Quotes / Likes
- Post interactions

### Search & Explore (3)
- Search Twitter (with filters)
- Autocomplete suggestions
- Multiple search types

### Community Endpoints (10)
- Search Communities
- Community Details / About
- Community Tweets / Members / Moderators
- Popular Communities / Topics / Timeline

### Lists Endpoints (5)
- Search Lists
- List Details / Timeline
- List Members / Followers

### Trends Endpoints (2)
- Available Locations
- Trends by Location

### Other (3)
- Spaces Details
- Organization Affiliates
- Jobs Search

**Total: 50+ endpoints**

## 💰 Cost

### Cloudflare Workers (Free Tier)
- 100,000 requests/day
- More than enough for personal use
- No credit card required for free tier

### RapidAPI Twitter241
- Check pricing on [RapidAPI](https://rapidapi.com/Alexandr3322/api/twitter241)
- Free tier usually available
- Pay-as-you-go for additional requests

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

**Important**: Never commit API keys or `config.js` file!

## 📄 License

MIT License - free to use for any purpose!

## 🔗 Links

- [RapidAPI Platform](https://rapidapi.com/)
- [Twitter241 API](https://rapidapi.com/Alexandr3322/api/twitter241)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [GitHub Repository](https://github.com/eamaster/x-scraper)

## 🛠️ Troubleshooting

### "API configuration not found"
- Check that `WORKER_URL` is set correctly in `script.js`
- Verify your Worker is deployed and accessible

### "API key not configured"
- Ensure you added `RAPIDAPI_KEY` environment variable in Cloudflare
- Variable name must be exact (case-sensitive)
- Redeploy worker after adding the variable

### CORS Errors
- Make sure the full `cloudflare-worker.js` code is deployed
- Check that OPTIONS requests are handled correctly

### "HTTP error! Status: 429"
- You've hit the rate limit
- Wait or upgrade your RapidAPI plan

### Worker Not Responding
- Check Worker logs in Cloudflare Dashboard
- Verify your RapidAPI subscription is active
- Confirm API key is valid

## 📧 Support

Need help? Options:
1. Open an issue on GitHub
2. Check [RapidAPI Support](https://rapidapi.com/support/)
3. Review [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

---

**Built with ❤️ for the Twitter developer community**
