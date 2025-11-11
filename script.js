// === Worker URL resolution ===
function resolveWorkerURL() {
  // If a server-side override exists (worker-config.js), use it
  if (typeof window.WORKER_URL_OVERRIDE === 'string' &&
      window.WORKER_URL_OVERRIDE &&
      window.WORKER_URL_OVERRIDE !== 'https://YOUR_WORKER.subdomain.workers.dev') {
    console.log('🔧 Using WORKER_URL_OVERRIDE from worker-config.js');
    return window.WORKER_URL_OVERRIDE;
  }

  // Built-in production fallback for the live site
  const host = (window.location && window.location.hostname || '').toLowerCase();
  if (host === 'hesam.me') {
    console.log('🌐 Using built-in production Worker URL for hesam.me');
    return 'https://twitter-api-proxy.smah0085.workers.dev';
  }

  // No config found → keep existing error behavior
  throw new Error('API configuration not found. Create worker-config.js or set window.WORKER_URL_OVERRIDE.');
}

// Use the resolver wherever WORKER_URL is needed (keep the rest of logic unchanged)
const WORKER_URL = resolveWorkerURL();

// ---- helpers ----
function dget(o, p) { if (!o || !p) return; return p.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((x,k)=> x && k in x ? x[k] : undefined, o); }

// Build a users index from modern search/list/community timelines and legacy globalObjects
function buildUsersIndex(json) {
  const idx = {};
  // Modern /search-v2: result.timeline.instructions[].entries[].content.itemContent.tweet_results.result.core.user_results.result
  const instructions = dget(json, 'result.timeline.instructions') || [];
  for (const ins of instructions) {
    for (const e of (ins.entries || [])) {
      const u = dget(e, 'content.itemContent.tweet_results.result.core.user_results.result') ||
                dget(e, 'content.itemContent.tweet_results.core.user_results.result');
      if (u) {
        const id = u.rest_id || dget(u, 'legacy.id_str');
        const legacy = u.legacy || u;
        if (id && legacy) idx[id] = legacy;
      }
    }
  }
  // Legacy/alt: globalObjects.users
  const go = dget(json, 'globalObjects.users');
  if (go) for (const [id, u] of Object.entries(go)) if (!idx[id]) idx[id] = u;
  return idx;
}

// Shallow DFS to find the first object that contains any of the given keys
function findFirst(obj, predicate) {
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === 'object') {
      if (predicate(cur)) return cur;
      for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
    }
  }
}

// Extract tweets from modern /search-v2 structure: result.timeline.instructions[].entries[].content.itemContent.tweet_results.result
function extractTweetsFromSearchV2(json) {
  const out = [];
  const instructions = dget(json, 'result.timeline.instructions') || [];
  for (const ins of instructions) {
    for (const e of (ins.entries || [])) {
      const ic = e?.content?.itemContent;
      const tr = dget(ic, 'tweet_results.result') || dget(ic, 'tweet_results');
      const node = tr?.result || tr; // ← always unwrap wrapper
      if (node) out.push(node);
    }
  }
  return out;
}

// Legacy fallbacks: globalObjects or arrays
function extractTweetsLegacy(json) {
  const go = dget(json, 'globalObjects.tweets');
  if (go && typeof go === 'object') return Object.values(go);
  if (Array.isArray(json.tweets)) return json.tweets;
  for (const v of Object.values(json || {})) {
    if (Array.isArray(v) && v.length && (v[0]?.legacy || v[0]?.full_text || v[0]?.text)) return v;
  }
  return [];
}

// People tab: user results in instructions or globalObjects.users
function extractUsersFromSearch(json) {
  const out = [];
  const instructions = dget(json, 'result.timeline.instructions') || [];
  for (const ins of instructions) {
    for (const e of (ins.entries || [])) {
      const ur = dget(e, 'content.itemContent.user_results.result');
      if (ur) out.push(ur);
    }
  }
  const go = dget(json, 'globalObjects.users');
  if (!out.length && go) return Object.values(go);
  return out;
}

// Map any of the Twttr API user payload shapes to our UI fields.
// Fixes "Unknown/@unknown" when fields move (legacy, result, data.*)
function normalizeUser(json) {
    const candidates = [
        json,
        dget(json, 'result'),
        dget(json, 'user'),
        dget(json, 'data.user'),
        dget(json, 'data.user.result'),
        dget(json, 'core.user_results.result'),
    ].filter(Boolean);

    let u = null;
    for (const c of candidates) {
        if (dget(c, 'legacy')) {
            u = c.legacy;
            break;
        }
        if (dget(c, 'user.legacy')) {
            u = c.user.legacy;
            break;
        }
    }

    if (!u && dget(json, 'globalObjects.users')) {
        const users = dget(json, 'globalObjects.users');
        const first = Object.values(users)[0];
        if (first) u = first;
    }

    if (!u) {
        const found = findFirst(json, o => ('screen_name' in o) || ('name' in o));
        if (found) u = found;
    }

    const name = dget(u, 'name') || dget(json, 'user.name') || '';
    const username = dget(u, 'screen_name') || dget(json, 'user.screen_name') || '';
    // name / handle already resolved above – extend avatar + description fallbacks:
    const avatar =
        dget(u, 'profile_image_url_https') ||
        dget(u, 'profile_image_url') ||
        dget(json, 'result.data.user.result.avatar.image_url') ||
        dget(json, 'user.avatar.image_url') || '';
    const description =
        dget(u, 'description') ||
        dget(json, 'result.data.user.result.legacy.description') ||
        dget(json, 'user.description') || '';
    const verified = !!(dget(u, 'verified') || dget(u, 'is_blue_verified'));

    // Probe for metrics in multiple places to avoid zeros on valid users
    const tweets     = dget(u, 'statuses_count') ??
                       dget(json, 'result.data.user.result.legacy.statuses_count') ??
                       dget(json, 'user.legacy.statuses_count');
    const followers  = dget(u, 'followers_count') ??
                       dget(json, 'result.data.user.result.legacy.followers_count');
    const following  = dget(u, 'friends_count') ??
                       dget(json, 'result.data.user.result.legacy.friends_count');
    const favourites = dget(u, 'favourites_count') ??
                       dget(u, 'favouritesCount') ??
                       dget(json, 'result.data.user.result.legacy.favourites_count');

    return {
        name,
        username,
        description,
        avatar,
        verified,
        metrics: { tweets, followers, following, favourites }
    };
}

function extractCommunityTopics(json) {
    const topics = dget(json, 'data.fetch_user_community_topics.community_topics');
    if (Array.isArray(topics)) return topics;
    throw new Error('UNEXPECTED_COMMUNITY_TOPICS');
}

function extractAutocomplete(json) {
    const root = dget(json, 'result') || json || {};
    return {
        users: Array.isArray(root.users) ? root.users : [],
        topics: Array.isArray(root.topics) ? root.topics : [],
        lists: Array.isArray(root.lists) ? root.lists : [],
        events: Array.isArray(root.events) ? root.events : [],
        num: root.num_results ?? (root.users?.length || 0)
    };
}

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

function showWarning(container, message) {
    showError(container, message);
}

function renderUserCard(user, container) {
    if (!user || !user.username) {
        showError(container, 'User not found');
        return;
    }

    const photo = user.avatar || user.profile_image_url_https || '';
    const avatar = photo
        ? photo.replace('_normal', '_400x400')
        : 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
    const metrics = user.metrics || {};

    container.innerHTML = `
        <div class="profile-card">
            <div class="profile-header">
                <img src="${avatar}" alt="${user.name || 'User'}" width="80" height="80" onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png'">
                <div class="profile-info">
                    <h2>${user.name || 'Unknown'} ${user.verified ? '<span class="badge badge-verified">✓</span>' : ''}</h2>
                    <p>@${user.username || 'unknown'}</p>
                </div>
            </div>
            <p>${user.description || 'No description'}</p>
            <div class="profile-stats">
                <div class="stat"><span class="stat-value">${formatNumber(metrics.tweets || 0)}</span><span class="stat-label">Tweets</span></div>
                <div class="stat"><span class="stat-value">${formatNumber(metrics.followers || 0)}</span><span class="stat-label">Followers</span></div>
                <div class="stat"><span class="stat-value">${formatNumber(metrics.following || 0)}</span><span class="stat-label">Following</span></div>
                <div class="stat"><span class="stat-value">${formatNumber(metrics.favourites || 0)}</span><span class="stat-label">Likes</span></div>
            </div>
        </div>`;
}

function renderSearchResults(tweets, container, query, ctx = {}) {
    displayTweets(tweets, container, `Search Results for "${query}"`, ctx);
}

function esc(s){return (s??'').toString().replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));}

// For autocomplete users
function normalizeUserLite(u){
  const L = u?.legacy || u || {};
  return {
    name: L.name || u?.name || 'Unknown',
    handle: L.screen_name || u?.screen_name || 'unknown',
    avatar: L.profile_image_url_https || L.profile_image_url || u?.avatar?.image_url || ''
  };
}

// For autocomplete topics (shapes vary)
function topicMeta(raw){
  // Accept many shapes from /autocomplete:
  // { topic: { topic_name, topic_id } }
  // { topic_name, topic_id }, { name, id }, { display_name }, { query }
  const t = raw?.topic ?? raw ?? {};
  const name =
    t.topic_name ??
    t.name ??
    t.display_name ??
    t.query ??
    t.displayName ??
    (t.topic?.topic_name) ??
    'Topic';
  const id =
    t.topic_id ??
    t.id_str ??
    t.id ??
    (t.topic?.topic_id) ??
    '';
  return { name, id };
}

function renderAutocomplete(ac, container){
  // ---- Users: dedupe by handle (case-insensitive)
  const seenUsers = new Set();
  const users = [];
  for (const u of (ac.users || [])){
    const L = u?.legacy || u || {};
    const name = L.name || u?.name || 'Unknown';
    const handle = (L.screen_name || u?.screen_name || '').toLowerCase();
    if (!handle || seenUsers.has(handle)) continue;
    seenUsers.add(handle);
    const avatar = L.profile_image_url_https || L.profile_image_url || u?.avatar?.image_url || '';
    users.push({ name, handle, avatar });
  }
  // ---- Topics: normalize + dedupe by name+id
  const seenTopics = new Set();
  const topics = [];
  for (const raw of (ac.topics || [])){
    const t = topicMeta(raw);
    const key = `${(t.name||'').toLowerCase()}|${t.id||''}`;
    if (!t.name || seenTopics.has(key)) continue;
    seenTopics.add(key);
    topics.push(t);
  }
  // Lists & events (optional)
  const lists  = (ac.lists  || []).map(l => ({ name: l.name || 'List', id: l.id_str || l.id || '' }));
  const events = (ac.events || []).map(e => ({ name: e.name || 'Event' }));
  // ---- Build rows (single-line per item)
  const userRows = users.map(u => `
    <li class="sug-item">
      ${u.avatar ? `<img class="suggestion-avatar" src="${esc(u.avatar)}" alt="">` : ''}
      <span class="sug-name">${esc(u.name)}</span>
      <span class="sug-handle">(@${esc(u.handle)})</span>
    </li>`).join('');
  const topicRows = topics.map(t => `
    <li class="sug-item">
      <span class="sug-name">#${esc(t.name)}</span>
      ${t.id ? `<span class="sug-id">(${esc(t.id)})</span>` : ''}
    </li>`).join('');
  const listRows = (lists||[]).map(l => `
    <li class="sug-item">
      <span class="sug-name">${esc(l.name)}</span>
      ${l.id ? `<span class="sug-id">(${esc(l.id)})</span>` : ''}
    </li>`).join('');
  const eventRows = (events||[]).map(e => `
    <li class="sug-item">
      <span class="sug-name">${esc(e.name)}</span>
    </li>`).join('');
  const hasUsers  = users.length  > 0;
  const hasTopics = topics.length > 0;
  const hasLists  = lists.length  > 0;
  const hasEvents = events.length > 0;
  container.innerHTML = `
    <h3>Autocomplete suggestions...</h3>
    ${!(hasUsers||hasTopics||hasLists||hasEvents) ? '<p>No suggestions.</p>' : ''}
    ${hasUsers  ? `<h4>Users</h4><ul class="suggestions">${userRows}</ul>`   : ''}
    ${hasTopics ? `<h4>Topics</h4><ul class="suggestions">${topicRows}</ul>` : ''}
    ${hasLists  ? `<h4>Lists</h4><ul class="suggestions">${listRows}</ul>`   : ''}
    ${hasEvents ? `<h4>Events</h4><ul class="suggestions">${eventRows}</ul>` : ''}`;
}

function renderCommunityTopics(topics, container) {
    if (!topics || topics.length === 0) {
        container.innerHTML = '<h3>Community Topics</h3><p>No topics found.</p>';
        return;
    }

    container.innerHTML = `<h3>Community Topics</h3>${
        topics.map(topic => {
            const subtopics = Array.isArray(topic.subtopics) && topic.subtopics.length
                ? `<div class="tweet-footer">${topic.subtopics.map(sub => `<span>${sub.topic_name || sub.name}</span>`).join('')}</div>`
                : '';
            return `<div class="community-card">
                <strong>${topic.topic_name || topic.name || 'Topic'}</strong>
                ${subtopics}
            </div>`;
        }).join('')
    }`;
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
    await doExplore(query, type, count, container);
});

document.getElementById('autocomplete-btn').addEventListener('click', async () => {
    const q = (document.getElementById('autocomplete-input')?.value || '').trim();
    const container = document.getElementById('search-results');
    if (!q) { showWarning(container, 'Type a query (e.g., elonmusk, spacex)'); return; }
    showLoading(container);
    try {
        const data = await fetchFromAPI('/autocomplete', { value: q });
        const ac = extractAutocomplete(data);
        renderAutocomplete(ac, container);
    } catch (err) {
        console.error('Autocomplete error:', err);
        showError(container, 'Could not load suggestions.');
    }
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
        const normalized = normalizeUser(data);
        renderUserCard(normalized, container);
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
    
    console.log('🔬 Extracting tweets from data with keys:', Object.keys(data));
    console.log('🔬 Full data structure:', JSON.stringify(data, null, 2).substring(0, 500));
    
    // Try structure 1: data.result.timeline.instructions
    const instructions = data.result?.timeline?.instructions || [];
    console.log(`📋 Found ${instructions.length} instructions`);
    if (instructions.length > 0) {
        for (const instruction of instructions) {
            console.log(`  - Instruction type: ${instruction.type}`);
            if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                const entries = instruction.entries.filter(entry => 
                    entry.content?.itemContent?.tweet_results?.result ||
                    entry.content?.itemContent?.tweetDisplayType === 'Tweet'
                );
                console.log(`  - Found ${entries.length} tweet entries`);
                tweets.push(
                    ...entries
                        .map(entry => entry.content?.itemContent?.tweet_results?.result || entry.content?.itemContent?.tweet_results)
                        .filter(Boolean)
                        .map(t => t.result || t)
                );
            }
        }
    }
    
    // Try structure 2: data.data
    if (tweets.length === 0 && data.data) {
        console.log('📦 Trying data.data structure');
        const dataArray = Array.isArray(data.data) ? data.data : Object.values(data.data);
        console.log(`  - Data array length: ${dataArray.length}`);
        tweets = dataArray.filter(item => item && (item.text || item.full_text || item.legacy?.full_text));
    }
    
    // Try structure 3: direct timeline
    if (tweets.length === 0 && data.timeline) {
        console.log('📜 Trying data.timeline structure');
        tweets = Array.isArray(data.timeline) ? data.timeline : [];
    }
    
    // Try structure 4: Check if data itself is an array
    if (tweets.length === 0 && Array.isArray(data)) {
        console.log('📚 Data itself is an array');
        tweets = data;
    }
    
    // Try structure 5: Look for any array in the response
    if (tweets.length === 0) {
        console.log('🔍 Searching for arrays in response...');
        for (const [key, value] of Object.entries(data)) {
            if (Array.isArray(value) && value.length > 0) {
                console.log(`  - Found array at key "${key}" with ${value.length} items`);
                // Check if it looks like tweets
                if (value[0] && (value[0].text || value[0].full_text || value[0].legacy)) {
                    console.log(`  - Looks like tweets! Using array from "${key}"`);
                    tweets = value;
                    break;
                }
            }
        }
    }
    
    const filtered = tweets.filter(t => t);
    console.log(`✅ Final tweet count: ${filtered.length}`);
    return filtered;
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
        if (type === 'likes') {
            const users = extractUsersFromResponse(data);
            displayUsers(users, container, type.charAt(0).toUpperCase() + type.slice(1));
        } else {
            const tweets = extractTweetsFromResponse(data);
            displayTweets(tweets, container, type.charAt(0).toUpperCase() + type.slice(1));
        }
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
    await doGetTopics(container);
});

document.getElementById('explore-community-timeline-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const data = await fetchFromAPI('/explore-community-timeline', {});
        const tweets = extractTweetsFromResponse(data);
        const usersIndex = buildUsersIndex(data);
        displayTweets(tweets, container, 'Community Timeline', { usersIndex });
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
        const tweets = extractTweetsFromResponse(data);
        const usersIndex = buildUsersIndex(data);
        displayTweets(tweets, container, 'Community Tweets', { usersIndex });
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

async function doExplore(query, type = 'Top', count = 20, container) {
  try {
    let data = await fetchFromAPI('/search-v2', { query, type, count });
    if (type === 'People') {
      let users = extractUsersFromSearch(data);
      if (!users.length) {
        data = await fetchFromAPI('/search', { query, type, count });
        users = extractUsersFromSearch(data);
      }
      displayUsers(users, container, `People for "${query}"`);
      return;
    }
    let tweets = extractTweetsFromSearchV2(data);
    let usersIndex = buildUsersIndex(data);
    if (!tweets.length) {
      data = await fetchFromAPI('/search', { query, type, count });
      tweets = extractTweetsFromSearchV2(data);
      if (!tweets.length) tweets = extractTweetsLegacy(data);
      usersIndex = Object.keys(usersIndex).length ? usersIndex : buildUsersIndex(data);
    }
    if (!tweets.length) {
      showWarning(container, 'No results found for this query.');
      return;
    }
    renderSearchResults(tweets, container, query, { usersIndex });
  } catch (err) {
    console.error('Explore error:', err);
    showWarning(container, 'Search failed. Try another query.');
  }
}

async function doGetTopics(container) {
    try {
        const data = await fetchFromAPI('/community-topics', {});
        const topics = extractCommunityTopics(data);
        renderCommunityTopics(topics, container);
    } catch (err) {
        console.error('Community topics error:', err);
        showError(container, err.message || 'Failed to load topics');
    }
}

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
        const tweets = extractTweetsFromResponse(data);
        const usersIndex = buildUsersIndex(data);
        displayTweets(tweets, container, 'List Timeline', { usersIndex });
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

function unwrapTweet(node) {
    // Accept result wrapper, legacy-only nodes, etc.
    return node?.result || node;
}

function resolveAuthorFromTweet(tweet, usersIndex = {}) {
    const t = unwrapTweet(tweet);
    // 1) Modern path: embedded author under core.user_results.result.legacy
    const u1 = dget(t, 'core.user_results.result.legacy');
    if (u1?.screen_name) return { name: u1.name || 'Unknown', username: u1.screen_name };
    // 2) Legacy link: author id on the tweet points into usersIndex
    const uid = dget(t, 'legacy.user_id_str') || dget(t, 'user_id_str');
    const u2 = (uid && usersIndex[uid]) ? usersIndex[uid] : null;
    if (u2?.screen_name) return { name: u2.name || 'Unknown', username: u2.screen_name };
    // 3) Fallback: shallow DFS to find first object with a screen_name
    const any = findFirst(t, o => typeof o === 'object' && o && ('screen_name' in o || 'name' in o));
    if (any?.screen_name) return { name: any.name || 'Unknown', username: any.screen_name };
    return { name: 'Unknown', username: 'unknown' };
}

function normalizeTweetAndAuthor(t, usersIndex) {
    const node = t?.result || t;
    const legacy = node.legacy || node;
    let author =
        dget(node, 'core.user_results.result.legacy') ||
        node.user?.legacy || node.user ||
        dget(node, 'legacy.user') || {};
    // If author missing, resolve via user_id_str using usersIndex from the response
    const uid = dget(legacy, 'user_id_str') || dget(node, 'user_id_str');
    if ((!author.screen_name || !author.name) && uid && usersIndex && usersIndex[uid]) {
        author = { ...usersIndex[uid], ...author };
    }
    return { legacy, author };
}

function displayTweets(tweets, container, title, ctx = {}) {
    if (!Array.isArray(tweets) || tweets.length === 0) {
        container.innerHTML = `<h3>${title}</h3><p>No tweets found.</p>`;
        return;
    }
    container.innerHTML = `<h3>${title}</h3>${
        tweets.map(t => {
            const node = unwrapTweet(t);
            const legacy = node.legacy || node;
            const author = resolveAuthorFromTweet(t, ctx.usersIndex || {});
            const text = legacy.full_text || legacy.text || node.full_text || node.text || '';
            const date = legacy.created_at || node.created_at || 'Unknown';
            return `<div class="tweet-card">
        <p><strong>@${author.username}:</strong> ${text || 'No content'}</p>
        <div class="tweet-footer">
          <span>❤️ ${formatNumber(legacy.favorite_count || 0)}</span>
          <span>🔁 ${formatNumber(legacy.retweet_count || 0)}</span>
          <span>💬 ${formatNumber(legacy.reply_count || 0)}</span>
          <span>📅 ${formatDate(date)}</span>
        </div>
      </div>`;
        }).join('')
    }`;
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

