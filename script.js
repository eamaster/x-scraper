// Configuration
const WORKER_URL = 'https://twitter-api-proxy.smah0085.workers.dev';

// ====================
// UTILITY FUNCTIONS
// ====================

async function fetchFromAPI(endpoint, params = {}) {
    if (WORKER_URL && WORKER_URL !== 'YOUR_CLOUDFLARE_WORKER_URL') {
        const url = new URL(WORKER_URL);
        url.searchParams.set('endpoint', endpoint);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        
        console.log('🔍 Fetching:', endpoint, 'with params:', params);
        const response = await fetch(url.toString(), { method: 'GET' });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error:', response.status, errorText);
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        console.log('✅ API Response:', data);
        return data;
    } else if (typeof window.API_CONFIG !== 'undefined') {
        const url = new URL(`https://${window.API_CONFIG.host}${endpoint}`);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
                'X-RapidAPI-Key': window.API_CONFIG.key,
                'X-RapidAPI-Host': window.API_CONFIG.host
            }
        });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        console.log('✅ API Response:', data);
        return data;
    } else {
        throw new Error('API configuration not found');
    }
}

function showLoading(container) {
    container.innerHTML = '<div class="loading">Loading</div>';
}

function showError(container, message) {
    container.innerHTML = `<div class="error">❌ Error: ${message}</div>`;
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num;
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleString();
}

// ====================
// TAB NAVIGATION
// ====================

document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tab}-tab`).classList.add('active');
    });
});

// ====================
// SEARCH TAB
// ====================

document.getElementById('search-btn').addEventListener('click', async () => {
    const query = document.getElementById('search-query').value.trim();
    const type = document.getElementById('search-type').value;
    const count = document.getElementById('search-count').value || 20;
    const container = document.getElementById('search-results');
    if (!query) { showError(container, 'Please enter a search query'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/search-v2', { query, type, count });
        console.log('🔍 Raw API response:', data);
        
        // Extract tweets from complex nested structure
        let tweets = [];
        
        // Navigate: data.result.timeline.instructions[0].entries
        const instructions = data.result?.timeline?.instructions || [];
        if (instructions.length > 0) {
            const entries = instructions[0].entries || [];
            console.log(`Found ${entries.length} entries`);
            
            // Extract tweets from entries
            tweets = entries
                .filter(entry => entry.content?.itemContent?.tweet_results?.result)
                .map(entry => entry.content.itemContent.tweet_results.result);
            
            console.log(`Extracted ${tweets.length} tweets`);
        }
        
        displayTweets(tweets, container, `Search Results for "${query}"`);
    } catch (error) { 
        console.error('Search error:', error);
        showError(container, error.message); 
    }
});

document.getElementById('autocomplete-btn').addEventListener('click', async () => {
    const value = document.getElementById('autocomplete-input').value.trim();
    const container = document.getElementById('search-results');
    if (!value) { showError(container, 'Please enter text'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/autocomplete', { value });
        const suggestions = data.users || [];
        if (suggestions.length === 0) { container.innerHTML = '<p>No suggestions found</p>'; return; }
        container.innerHTML = `<h3>Autocomplete Suggestions</h3>${suggestions.map(user => `
            <div class="user-card"><strong>@${user.screen_name}</strong> - ${user.name}
            ${user.verified ? '<span class="badge badge-verified">✓</span>' : ''}</div>`).join('')}`;
    } catch (error) { showError(container, error.message); }
});

// ====================
// USER TAB
// ====================

let currentUsername = '';

document.getElementById('get-user-btn').addEventListener('click', async () => {
    const username = document.getElementById('username-input').value.trim();
    const container = document.getElementById('user-profile');
    if (!username) { showError(container, 'Please enter a username'); return; }
    currentUsername = username;
    showLoading(container);
    try {
        const data = await fetchFromAPI('/user', { username });
        const user = data.result?.data?.user?.result?.legacy || data.result;
        if (!user) { showError(container, 'User not found'); return; }
        const profileImageUrl = user.profile_image_url_https || user.profile_image_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
        const profileImageBigger = profileImageUrl.replace('_normal', '_400x400');
        
        container.innerHTML = `
            <div class="profile-card">
                <div class="profile-header">
                    <img src="${profileImageBigger}" alt="${user.name || 'User'}" width="80" height="80" onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png'">
                    <div class="profile-info">
                        <h2>${user.name || 'Unknown'} ${user.verified ? '<span class="badge badge-verified">✓</span>' : ''}</h2>
                        <p>@${user.screen_name || 'unknown'}</p>
            </div>
        </div>
                <p>${user.description || 'No description'}</p>
                <div class="profile-stats">
                    <div class="stat"><span class="stat-value">${formatNumber(user.statuses_count || 0)}</span><span class="stat-label">Tweets</span></div>
                    <div class="stat"><span class="stat-value">${formatNumber(user.followers_count || 0)}</span><span class="stat-label">Followers</span></div>
                    <div class="stat"><span class="stat-value">${formatNumber(user.friends_count || 0)}</span><span class="stat-label">Following</span></div>
                    <div class="stat"><span class="stat-value">${formatNumber(user.favourites_count || 0)}</span><span class="stat-label">Likes</span></div>
                </div>
            </div>`;
    } catch (error) { showError(container, error.message); }
});

async function getUserContent(type) {
    const username = document.getElementById('username-input').value.trim() || currentUsername;
    const count = document.getElementById('user-count').value || 20;
    const container = document.getElementById('user-results');
    if (!username) { showError(container, 'Please enter a username first'); return; }
    showLoading(container);
    const endpoints = { tweets: '/user-tweets', replies: '/user-replies-v2', media: '/user-media', likes: '/user-likes' };
    try {
        const userData = await fetchFromAPI('/user', { username });
        const userId = userData.result?.data?.user?.result?.rest_id || userData.result?.id_str;
        if (!userId) throw new Error('Could not get user ID');
        const data = await fetchFromAPI(endpoints[type], { user: userId, count });
        
        console.log(`🔍 ${type} response structure:`, Object.keys(data), data);
        
        // Extract tweets - try multiple possible structures
        let tweets = extractTweetsFromResponse(data);
        
        console.log(`✅ Extracted ${tweets.length} tweets for ${type}`);
        displayTweets(tweets, container, `${type.charAt(0).toUpperCase() + type.slice(1)} from @${username}`);
    } catch (error) { showError(container, error.message); }
}

// Universal tweet extractor that handles multiple API response structures
function extractTweetsFromResponse(data) {
    let tweets = [];
    
    // Try structure 1: data.result.timeline.instructions[0].entries
    const instructions = data.result?.timeline?.instructions || [];
    if (instructions.length > 0) {
        for (const instruction of instructions) {
            if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                const entries = instruction.entries.filter(entry => 
                    entry.content?.itemContent?.tweet_results?.result ||
                    entry.content?.itemContent?.tweetDisplayType === 'Tweet'
                );
                tweets.push(...entries.map(entry => entry.content.itemContent.tweet_results.result));
            }
        }
    }
    
    // Try structure 2: data.data (for some endpoints)
    if (tweets.length === 0 && data.data) {
        const dataArray = Array.isArray(data.data) ? data.data : Object.values(data.data);
        tweets = dataArray.filter(item => item && (item.text || item.full_text));
    }
    
    // Try structure 3: direct timeline
    if (tweets.length === 0 && data.timeline) {
        tweets = Array.isArray(data.timeline) ? data.timeline : [];
    }
    
    return tweets.filter(t => t); // Remove null/undefined
}

async function getUserNetwork(type) {
    const username = document.getElementById('username-input').value.trim() || currentUsername;
    const count = document.getElementById('user-count').value || 20;
    const container = document.getElementById('user-results');
    if (!username) { showError(container, 'Please enter a username first'); return; }
    showLoading(container);
    const endpoints = { followers: '/followers', following: '/followings', verified: '/verified-followers' };
    try {
        const userData = await fetchFromAPI('/user', { username });
        const userId = userData.result?.data?.user?.result?.rest_id || userData.result?.id_str;
        if (!userId) throw new Error('Could not get user ID');
        const data = await fetchFromAPI(endpoints[type], { user: userId, count });
        
        console.log(`🔍 ${type} response structure:`, Object.keys(data), data);
        
        // Extract users - try multiple possible structures
        let users = extractUsersFromResponse(data);
        
        console.log(`✅ Extracted ${users.length} users for ${type}`);
        displayUsers(users, container, `${type.charAt(0).toUpperCase() + type.slice(1)} of @${username}`);
    } catch (error) { showError(container, error.message); }
}

// Universal user extractor
function extractUsersFromResponse(data) {
    let users = [];
    
    // Try structure 1: data.result.timeline.instructions[0].entries
    const instructions = data.result?.timeline?.instructions || [];
    if (instructions.length > 0) {
        for (const instruction of instructions) {
            if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                const entries = instruction.entries.filter(entry => 
                    entry.content?.itemContent?.user_results?.result
                );
                users.push(...entries.map(entry => entry.content.itemContent.user_results.result));
            }
        }
    }
    
    // Try structure 2: data.data
    if (users.length === 0 && data.data) {
        const dataArray = Array.isArray(data.data) ? data.data : Object.values(data.data);
        users = dataArray.filter(item => item && item.screen_name);
    }
    
    // Try structure 3: direct timeline
    if (users.length === 0 && data.timeline) {
        users = Array.isArray(data.timeline) ? data.timeline : [];
    }
    
    return users.filter(u => u); // Remove null/undefined
}

document.getElementById('get-user-tweets-btn').addEventListener('click', () => getUserContent('tweets'));
document.getElementById('get-user-replies-btn').addEventListener('click', () => getUserContent('replies'));
document.getElementById('get-user-media-btn').addEventListener('click', () => getUserContent('media'));
document.getElementById('get-user-likes-btn').addEventListener('click', () => getUserContent('likes'));
document.getElementById('get-user-followers-btn').addEventListener('click', () => getUserNetwork('followers'));
document.getElementById('get-user-following-btn').addEventListener('click', () => getUserNetwork('following'));
document.getElementById('get-verified-followers-btn').addEventListener('click', () => getUserNetwork('verified'));

// ====================
// TWEET TAB
// ====================

let currentTweetId = '';

document.getElementById('get-tweet-btn').addEventListener('click', async () => {
    const tweetId = document.getElementById('tweet-id-input').value.trim();
    const container = document.getElementById('tweet-details');
    if (!tweetId) { showError(container, 'Please enter a tweet ID'); return; }
    currentTweetId = tweetId;
    showLoading(container);
    try {
        const data = await fetchFromAPI('/tweet-v2', { pid: tweetId });
        displayTweets([data.result || data], container, 'Tweet Details');
    } catch (error) { showError(container, error.message); }
});

async function getTweetInteractions(type) {
    const tweetId = document.getElementById('tweet-id-input').value.trim() || currentTweetId;
    const count = document.getElementById('tweet-count').value || 40;
    const container = document.getElementById('tweet-interactions');
    if (!tweetId) { showError(container, 'Please enter a tweet ID first'); return; }
    showLoading(container);
    const endpoints = { comments: '/comments-v2', retweets: '/retweets', quotes: '/quotes', likes: '/likes' };
    try {
        const params = { pid: tweetId, count };
        if (type === 'comments') params.rankingMode = 'Relevance';
        const data = await fetchFromAPI(endpoints[type], params);
        const items = data.result?.timeline || data.timeline || [];
        if (type === 'likes') { displayUsers(items, container, type.charAt(0).toUpperCase() + type.slice(1)); }
        else { displayTweets(items, container, type.charAt(0).toUpperCase() + type.slice(1)); }
    } catch (error) { showError(container, error.message); }
}

document.getElementById('get-comments-btn').addEventListener('click', () => getTweetInteractions('comments'));
document.getElementById('get-retweets-btn').addEventListener('click', () => getTweetInteractions('retweets'));
document.getElementById('get-quotes-btn').addEventListener('click', () => getTweetInteractions('quotes'));
document.getElementById('get-likes-btn').addEventListener('click', () => getTweetInteractions('likes'));

// ====================
// COMMUNITY TAB
// ====================

document.getElementById('search-community-btn').addEventListener('click', async () => {
    const query = document.getElementById('community-search-input').value.trim();
    const container = document.getElementById('community-results');
    if (!query) { showError(container, 'Please enter a search query'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/search-community', { query, count: 20 });
        displayCommunities(data.result?.timeline || data.list || [], container, `Communities for "${query}"`);
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-community-topics-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const data = await fetchFromAPI('/community-topics', {});
        displayGenericResults(data, container, 'Community Topics');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('explore-community-timeline-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const data = await fetchFromAPI('/explore-community-timeline', {});
        displayTweets(data.result?.timeline || [], container, 'Community Timeline');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-community-details-btn').addEventListener('click', async () => {
    const communityId = document.getElementById('community-id-input').value.trim();
    const container = document.getElementById('community-results');
    if (!communityId) { showError(container, 'Please enter a community ID'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/community-details', { communityId });
        displayGenericResults(data, container, 'Community Details');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-community-tweets-btn').addEventListener('click', async () => {
    const communityId = document.getElementById('community-id-input').value.trim();
    const container = document.getElementById('community-results');
    if (!communityId) { showError(container, 'Please enter a community ID first'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/community-tweets', { communityId, searchType: 'Default', rankingMode: 'Relevance', count: 20 });
        displayTweets(data.result?.timeline || [], container, 'Community Tweets');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-community-members-btn').addEventListener('click', async () => {
    const communityId = document.getElementById('community-id-input').value.trim();
    const container = document.getElementById('community-results');
    if (!communityId) { showError(container, 'Please enter a community ID first'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/community-members', { communityId });
        displayGenericResults(data, container, 'Community Members');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-community-moderators-btn').addEventListener('click', async () => {
    const communityId = document.getElementById('community-id-input').value.trim();
    const container = document.getElementById('community-results');
    if (!communityId) { showError(container, 'Please enter a community ID first'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/community-moderators', { communityId });
        displayGenericResults(data, container, 'Community Moderators');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-community-about-btn').addEventListener('click', async () => {
    const communityId = document.getElementById('community-id-input').value.trim();
    const container = document.getElementById('community-results');
    if (!communityId) { showError(container, 'Please enter a community ID first'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/community-about', { communityId });
        displayGenericResults(data, container, 'About Community');
    } catch (error) { showError(container, error.message); }
});

// ====================
// LISTS TAB
// ====================

document.getElementById('search-lists-btn').addEventListener('click', async () => {
    const query = document.getElementById('list-search-input').value.trim();
    const container = document.getElementById('lists-results');
    if (!query) { showError(container, 'Please enter a search query'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/search-lists', { query });
        displayLists(data.result?.timeline || data.lists || [], container, `Lists for "${query}"`);
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-list-details-btn').addEventListener('click', async () => {
    const listId = document.getElementById('list-id-input').value.trim();
    const container = document.getElementById('lists-results');
    if (!listId) { showError(container, 'Please enter a list ID'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/list-details', { listId });
        displayGenericResults(data, container, 'List Details');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-list-timeline-btn').addEventListener('click', async () => {
    const listId = document.getElementById('list-id-input').value.trim();
    const container = document.getElementById('lists-results');
    if (!listId) { showError(container, 'Please enter a list ID first'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/list-timeline', { listId });
        displayTweets(data.result?.timeline || [], container, 'List Timeline');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-list-members-btn').addEventListener('click', async () => {
    const listId = document.getElementById('list-id-input').value.trim();
    const container = document.getElementById('lists-results');
    if (!listId) { showError(container, 'Please enter a list ID first'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/list-members', { listId, count: 20 });
        displayUsers(data.result?.timeline || [], container, 'List Members');
    } catch (error) { showError(container, error.message); }
});

document.getElementById('get-list-followers-btn').addEventListener('click', async () => {
    const listId = document.getElementById('list-id-input').value.trim();
    const container = document.getElementById('lists-results');
    if (!listId) { showError(container, 'Please enter a list ID first'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/list-followers', { listId, count: 20 });
        displayUsers(data.result?.timeline || [], container, 'List Followers');
    } catch (error) { showError(container, error.message); }
});

// ====================
// TRENDS TAB
// ====================

document.getElementById('get-trend-locations-btn').addEventListener('click', async () => {
    const container = document.getElementById('trends-results');
    showLoading(container);
    try {
        const data = await fetchFromAPI('/trends-locations', {});
        console.log('📍 Locations response:', data);
        
        const locations = data.result || data;
        
        if (Array.isArray(locations) && locations.length > 0) {
            container.innerHTML = `
                <h3>🌍 Available Trend Locations (${locations.length})</h3>
                <p style="color: #65676b; margin-bottom: 15px;">Click a WOEID to see trends for that location</p>
                ${locations.slice(0, 50).map(loc => `
                    <div class="list-item" style="cursor: pointer;" onclick="document.getElementById('trend-woeid-input').value='${loc.woeid}'; document.getElementById('get-trends-btn').click();">
                        <strong>${loc.name}</strong> ${loc.country ? `- ${loc.country}` : ''}
                        <span class="badge badge-count">WOEID: ${loc.woeid}</span>
                    </div>
                `).join('')}
                ${locations.length > 50 ? `<p style="margin-top: 10px; color: #65676b;">Showing first 50 of ${locations.length} locations</p>` : ''}
            `;
        } else {
            displayGenericResults(data, container, 'Trend Locations'); 
        }
    } catch (error) {
        console.error('Locations error:', error);
        showError(container, error.message); 
    }
});

document.getElementById('get-trends-btn').addEventListener('click', async () => {
    const woeid = document.getElementById('trend-woeid-input').value.trim();
    const container = document.getElementById('trends-results');
    if (!woeid) { showError(container, 'Please enter a WOEID'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/trends-by-location', { woeid });
        console.log('📈 Trends response:', data);
        
        // Extract trends from data.result[0].trends
        const trends = data.result?.[0]?.trends || data[0]?.trends || data.trends || [];
        
        if (trends.length === 0) { container.innerHTML = '<p>No trends found</p>'; return; }
        
        const location = data.result?.[0]?.locations?.[0]?.name || 'Unknown Location';
        
        container.innerHTML = `
            <h3>🔥 Trending in ${location}</h3>
            ${trends.map((trend, i) => `
                <div class="trend-card">
                    <strong>${i + 1}. ${trend.name}</strong>
                    ${trend.tweet_volume ? `<span class="badge badge-count">${formatNumber(trend.tweet_volume)} tweets</span>` : '<span class="badge badge-count">Volume N/A</span>'}
                    ${trend.url ? `<br><a href="${trend.url}" target="_blank" style="color: #1da1f2;">View on Twitter →</a>` : ''}
                </div>
            `).join('')}`;
    } catch (error) { 
        console.error('Trends error:', error);
        showError(container, error.message); 
    }
});

// ====================
// DISPLAY FUNCTIONS
// ====================

function displayTweets(tweets, container, title) {
    console.log('📝 displayTweets called with:', tweets);
    
    // Handle non-array responses
    if (!tweets) {
        container.innerHTML = `<h3>${title}</h3><p>No tweets found.</p>`;
        return;
    }

    // Ensure tweets is an array
    if (!Array.isArray(tweets)) {
        console.error('⚠️ tweets is not an array:', typeof tweets, tweets);
        container.innerHTML = `<h3>${title}</h3><div class="error">⚠️ Unexpected data format. Check console for details.</div>`;
        return;
    }
    
    if (tweets.length === 0) {
        container.innerHTML = `<h3>${title}</h3><p>No tweets found.</p>`;
        return;
    }
    
    container.innerHTML = `<h3>${title}</h3>${tweets.map(tweet => {
        const legacy = tweet.legacy || tweet;
        const user = tweet.user?.legacy || tweet.user || {};
        return `<div class="tweet-card"><p><strong>@${user.screen_name || 'Unknown'}:</strong> ${legacy.full_text || legacy.text || 'No content'}</p>
            <div class="tweet-footer">
                <span>❤️ ${formatNumber(legacy.favorite_count || legacy.favorites || 0)}</span>
                <span>🔁 ${formatNumber(legacy.retweet_count || legacy.retweets || 0)}</span>
                <span>💬 ${formatNumber(legacy.reply_count || legacy.replies || 0)}</span>
                <span>📅 ${formatDate(legacy.created_at || tweet.created_at || 'Unknown')}</span>
            </div></div>`;
    }).join('')}`;
}

function displayUsers(users, container, title) {
    if (!users || users.length === 0) { container.innerHTML = `<h3>${title}</h3><p>No users found.</p>`; return; }
    container.innerHTML = `<h3>${title}</h3>${users.map(user => {
        const legacy = user.legacy || user;
        return `<div class="user-card"><strong>@${legacy.screen_name}</strong> - ${legacy.name}
            ${legacy.verified ? '<span class="badge badge-verified">✓</span>' : ''}
            <br><small>${legacy.description || 'No description'}</small>
            <div class="tweet-footer">
                <span>👥 ${formatNumber(legacy.followers_count || 0)} followers</span>
                <span>📝 ${formatNumber(legacy.statuses_count || 0)} tweets</span>
            </div></div>`;
    }).join('')}`;
}

function displayLists(lists, container, title) {
    if (!lists || lists.length === 0) { container.innerHTML = `<h3>${title}</h3><p>No lists found.</p>`; return; }
    container.innerHTML = `<h3>${title}</h3>${lists.map(list => {
        const legacy = list.legacy || list;
        return `<div class="list-card"><strong>${legacy.name}</strong>
            <br><small>${legacy.description || 'No description'}</small>
            <div class="tweet-footer">
                <span>👥 ${formatNumber(legacy.member_count || 0)} members</span>
                <span>👤 ${formatNumber(legacy.subscriber_count || 0)} subscribers</span>
            </div></div>`;
    }).join('')}`;
}

function displayCommunities(communities, container, title) {
    if (!communities || communities.length === 0) { container.innerHTML = `<h3>${title}</h3><p>No communities found.</p>`; return; }
    container.innerHTML = `<h3>${title}</h3>${communities.map(community => `
        <div class="community-card"><strong>${community.name || 'Unknown'}</strong>
        <br><small>${community.description || 'No description'}</small>
        ${community.member_count ? `<div class="tweet-footer"><span>👥 ${formatNumber(community.member_count)} members</span></div>` : ''}
        </div>`).join('')}`;
}

function displayGenericResults(data, container, title) {
    container.innerHTML = `<h3>${title}</h3><div class="list-card">
        <pre style="white-space: pre-wrap; word-wrap: break-word; font-size: 13px;">${JSON.stringify(data, null, 2)}</pre>
    </div>`;
}

