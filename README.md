# X Scraper

A powerful and easy-to-use web application for searching and exploring Twitter data. This tool allows you to search for tweets by keyword or hashtag, and to find tweets from specific users, with or without a keyword filter.

## Features

- **Keyword Tweet Search:** Find tweets containing any keyword or #hashtag.
- **User Profile Search:** Fetch recent tweets from any public Twitter user.
- **User Keyword Search:** Combine the power of both searches! Look for a specific keyword or phrase within a particular user's tweets.
- **Advanced Sorting:** Sort search results by date, likes, or retweets to easily find the most relevant content.
- **Clean & Modern UI:** A professional, responsive, and intuitive interface makes searching for tweets a seamless experience.
- **Secure API Key Management:** Uses Cloudflare Workers to keep your API key safe and hidden from the frontend.

## Setup Instructions

This project uses the [Twttr API on RapidAPI](https://rapidapi.com/sowmen_barua/api/twttr). You'll need to set up a Cloudflare Worker to securely proxy API requests.

### Option 1: Production Setup (Recommended - Using Cloudflare Workers)

1. **Get a RapidAPI Key:**
   - Sign up at [RapidAPI](https://rapidapi.com/)
   - Subscribe to the [Twttr API](https://rapidapi.com/sowmen_barua/api/twttr)
   - Copy your API key

2. **Create a Cloudflare Worker:**
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) > Workers & Pages
   - Click "Create Application" > "Create Worker"
   - Give it a name (e.g., `twitter-api-proxy`)
   - Replace the default code with the contents of `cloudflare-worker.js` from this repo
   - Click "Save and Deploy"

3. **Add Environment Variable:**
   - In your Worker settings, go to "Settings" > "Variables"
   - Add a new environment variable:
     - Variable name: `RAPIDAPI_KEY`
     - Value: Your RapidAPI key
   - Click "Save"

4. **Update Frontend Configuration:**
   - Copy your Worker URL (e.g., `https://twitter-api-proxy.your-subdomain.workers.dev`)
   - Open `script.js` in this project
   - Replace `YOUR_CLOUDFLARE_WORKER_URL` with your actual Worker URL:
     ```javascript
     const WORKER_URL = 'https://twitter-api-proxy.your-subdomain.workers.dev';
     ```

5. **Deploy Your Site:**
   - Open `index.html` in your browser, or
   - Deploy to GitHub Pages, Netlify, Vercel, or any static hosting service

### Option 2: Local Development (For Testing Only)

⚠️ **Warning:** This method exposes your API key in the browser. Only use for local testing, never commit `config.js` to version control!

1. Copy `config.example.js` to `config.js`:
   ```bash
   cp config.example.js config.js
   ```

2. Edit `config.js` and add your RapidAPI key:
   ```javascript
   window.API_CONFIG = {
       key: 'your_actual_rapidapi_key_here',
       host: 'twitter-api45.p.rapidapi.com'
   };
   ```

3. In `script.js`, set `WORKER_URL` to `null`:
   ```javascript
   const WORKER_URL = null;
   ```

4. Open `index.html` in your browser or run a local web server:
   ```bash
   python -m http.server
   ```

## How to Use

1. **Tweet Search:**
   - Enter a keyword or #hashtag in the "Tweet Search" section
   - Click "Search" to find tweets containing that term
   - Use the sort buttons to organize results by date, likes, or retweets

2. **User Profile Search:**
   - Enter a Twitter username (without the @) in the "User Profile Search" section
   - Optionally, add a keyword to filter tweets from that user
   - Click "Search" to see their tweets
   - Use the sort buttons to organize results

## Security

- ✅ API key is stored securely in Cloudflare Workers environment variables
- ✅ Frontend never exposes the API key
- ✅ `config.js` (if used locally) is in `.gitignore` and never committed
- ✅ CORS headers properly configured in the Worker

## Technologies Used

- **Frontend:** HTML, CSS, JavaScript (Vanilla JS)
- **API:** Twttr API via RapidAPI
- **Proxy:** Cloudflare Workers
- **Hosting:** Any static site host (GitHub Pages, Netlify, Vercel, etc.)

## Contributing

Feel free to fork this project and submit pull requests. Please ensure you don't commit any API keys or sensitive configuration files.

## License

MIT License - feel free to use this project for your own purposes!
