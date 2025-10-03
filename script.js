// Configuration
// Cloudflare Worker URL (API key is stored securely in Cloudflare)
const WORKER_URL = 'https://twitter-api-proxy.smah0085.workers.dev';

// For local development with API key, create a config.js file (see config.example.js)
// and uncomment the line below:
// const WORKER_URL = null; // This will use direct API calls with config.js

// --- DOM Elements ---
const searchBtn = document.getElementById('search-btn');
const searchQueryInput = document.getElementById('search-query-input');
const tweetSearchResultsContainer = document.getElementById('tweet-search-results');
const keywordSortContainer = document.getElementById('keyword-sort-container');
const sortByDateBtn = document.getElementById('sort-by-date');
const sortByLikesBtn = document.getElementById('sort-by-likes');
const sortByRetweetsBtn = document.getElementById('sort-by-retweets');

const userSearchBtn = document.getElementById('user-search-btn');
const userSearchInput = document.getElementById('user-search-input');
const userKeywordInput = document.getElementById('user-keyword-input');
const userProfileContainer = document.getElementById('user-profile');
const userTweetsContainer = document.getElementById('user-tweets');
const userSortContainer = document.getElementById('user-sort-container');
const userSortByDateBtn = document.getElementById('user-sort-by-date');
const userSortByLikesBtn = document.getElementById('user-sort-by-likes');
const userSortByRetweetsBtn = document.getElementById('user-sort-by-retweets');

// --- State ---
let currentKeywordTweets = [];
let currentUserTweets = [];

// --- Generic Fetch Function ---
async function fetchFromAPI(endpoint, params) {
    // Check if using Cloudflare Worker proxy
    if (WORKER_URL && WORKER_URL !== 'YOUR_CLOUDFLARE_WORKER_URL') {
        // Use Cloudflare Worker as proxy
        const url = new URL(WORKER_URL);
        url.searchParams.set('endpoint', endpoint);
        url.searchParams.set('query', params.query);

        const response = await fetch(url.toString(), {
            method: 'GET',
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return await response.json();
    } else if (typeof window.API_CONFIG !== 'undefined') {
        // Fallback to direct API call for local development (requires config.js)
        const url = new URL(`https://${window.API_CONFIG.host}${endpoint}`);
        url.search = new URLSearchParams(params).toString();

        const options = {
            method: 'GET',
            headers: {
                'X-RapidAPI-Key': window.API_CONFIG.key,
                'X-RapidAPI-Host': window.API_CONFIG.host
            }
        };

        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return await response.json();
    } else {
        throw new Error('API configuration not found. Please set up your Cloudflare Worker URL or create config.js for local development.');
    }
}

// --- Generic Tweet Display Function ---
function displayTweets(tweets, container, title) {
    if (!tweets || tweets.length === 0) {
        container.innerHTML = `<h3>${title}</h3><p>No tweets found.</p>`;
        return;
    }

    const tweetsHtml = tweets.map(tweet => `
        <div class="tweet-card">
            <p><strong>@${tweet.screen_name}:</strong> ${tweet.text}</p>
            <div class="tweet-footer">
                <span>❤️ ${tweet.favorites || 0}</span>
                <span>🔁 ${tweet.retweets || 0}</span>
                <span>💬 ${tweet.replies || 0}</span>
                <span>${new Date(tweet.created_at).toLocaleString()}</span>
            </div>
        </div>
    `).join('');

    container.innerHTML = `<h3>${title}</h3>${tweetsHtml}`;
}

// --- Tweet Search Feature ---
searchBtn.addEventListener('click', () => {
    const query = searchQueryInput.value.trim();
    if (query) {
        tweetSearchResultsContainer.innerHTML = '<p>Loading...</p>';
        searchTweets(query);
    }
});

async function searchTweets(query) {
    searchBtn.disabled = true;
    keywordSortContainer.style.display = 'none';
    try {
        const data = await fetchFromAPI('/search.php', { query });
        currentKeywordTweets = data.timeline || [];
        displayTweets(currentKeywordTweets, tweetSearchResultsContainer, 'Search Results');
        if (currentKeywordTweets.length > 0) {
            keywordSortContainer.style.display = 'flex';
        }
    } catch (error) {
        console.error('Error searching tweets:', error);
        tweetSearchResultsContainer.innerHTML = `<p class="error">Failed to fetch tweets. Please try again.</p>`;
    } finally {
        searchBtn.disabled = false;
    }
}

// --- Sorting for Keyword Search ---
sortByDateBtn.addEventListener('click', () => {
    currentKeywordTweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    displayTweets(currentKeywordTweets, tweetSearchResultsContainer, 'Search Results');
});

sortByLikesBtn.addEventListener('click', () => {
    currentKeywordTweets.sort((a, b) => (b.favorites || 0) - (a.favorites || 0));
    displayTweets(currentKeywordTweets, tweetSearchResultsContainer, 'Search Results');
});

sortByRetweetsBtn.addEventListener('click', () => {
    currentKeywordTweets.sort((a, b) => (b.retweets || 0) - (a.retweets || 0));
    displayTweets(currentKeywordTweets, tweetSearchResultsContainer, 'Search Results');
});

// --- User Profile Search Feature ---
userSearchBtn.addEventListener('click', async () => {
    const username = userSearchInput.value.trim();
    const keyword = userKeywordInput.value.trim();

    if (!username) {
        alert('Please enter a username.');
        return;
    }

    userProfileContainer.innerHTML = ''; // Clear profile section
    userTweetsContainer.innerHTML = '<p>Loading user tweets...</p>';
    userSortContainer.style.display = 'none';
    userSearchBtn.disabled = true;

    try {
        let query = `from:${username}`;
        if (keyword) {
            query = `${keyword} ${query}`;
        }

        const tweetsData = await fetchFromAPI('/search.php', { query });

        let title = `Tweets from @${username}`;
        if (keyword) {
            title += ` containing "${keyword}"`;
        }

        if (tweetsData && tweetsData.timeline && tweetsData.timeline.length > 0) {
            currentUserTweets = tweetsData.timeline;
            displayTweets(currentUserTweets, userTweetsContainer, title);
            userProfileContainer.innerHTML = `<h2>${title}</h2>`;
            userSortContainer.style.display = 'flex'; // Show sort buttons
        } else {
            userTweetsContainer.innerHTML = `<p class="error">No tweets found for this search.</p>`;
            userProfileContainer.innerHTML = '';
        }
    } catch (error) {
        console.error('Error searching user:', error);
        userProfileContainer.innerHTML = '';
        userTweetsContainer.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    } finally {
        userSearchBtn.disabled = false;
    }
});

// --- Sorting for User Search ---
userSortByDateBtn.addEventListener('click', () => {
    currentUserTweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    displayTweets(currentUserTweets, userTweetsContainer, `Tweets from @${userSearchInput.value.trim()}`);
});

userSortByLikesBtn.addEventListener('click', () => {
    currentUserTweets.sort((a, b) => (b.favorites || 0) - (a.favorites || 0));
    displayTweets(currentUserTweets, userTweetsContainer, `Tweets from @${userSearchInput.value.trim()}`);
});

userSortByRetweetsBtn.addEventListener('click', () => {
    currentUserTweets.sort((a, b) => (b.retweets || 0) - (a.retweets || 0));
    displayTweets(currentUserTweets, userTweetsContainer, `Tweets from @${userSearchInput.value.trim()}`);
});
