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

// ---- community selection ----
let selectedCommunity = null;

function setSelectedCommunity(c){
  if (!c) return;
  selectedCommunity = {
    id: c.id || c.rest_id || c.community_id,
    name: c.name || c.community_name || c.display_name || 'Community'
  };
  const idInput = document.getElementById('community-id-input');
  if (idInput) idInput.value = selectedCommunity.id || '';
  const pill = document.getElementById('selected-community-pill');
  if (pill){
    pill.textContent = `${selectedCommunity.name} (${selectedCommunity.id || 'id?'})`;
    pill.style.display = 'inline-block';
  }
}

async function getCommunityIdOrResolve(){
  // 1) If user has selected a community, use it
  if (selectedCommunity?.id) return selectedCommunity.id;
  // 2) If there's an ID typed, use it
  const typed = (document.getElementById('community-id-input')?.value || '').trim();
  if (typed) return typed;
  // 3) Resolve from the keyword search automatically (pick best match)
  const kw = (document.getElementById('community-search-input')?.value || '').trim();
  const q = kw || 'football';
  const searchData = await fetchFromAPI('/search-community', { query: q, count: 20 });
  const list = extractCommunitiesFromResponse(searchData);
  if (!list.length) return null;
  setSelectedCommunity(list[0]);
  return selectedCommunity.id || null;
}

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

// Normalize /autocomplete payload -> { users:[], topics:[], lists:[], events:[] }
function extractAutocomplete(json) {
  // payload can be under result.* or at root
  const root = json?.result ?? json ?? {};
  
  // --- USERS (existing behavior) ---
  const users = []
  ;(root.users || root.result?.users || []).forEach(u => {
    const legacy = u.legacy || u;
    const name = legacy.name || u.name;
    const handle = legacy.screen_name || u.screen_name;
    const avatar =
      u.avatar?.image_url ||
      legacy.profile_image_url_https ||
      legacy.profile_image_url ||
      null;
    if (name || handle) {
      users.push({ name, handle, avatar });
    }
  });
  
  // --- TOPICS (fix) ---
  const topicsRaw = root.topics || root.result?.topics || [];
  const topics = topicsRaw
    .map(t => {
      // accept many shapes
      const name =
        t.name ||
        t.topic_name ||
        t.display_name ||
        t?.topic?.name ||
        t?.topic?.topic_name ||
        t?.topic_data?.name ||
        t?.topic_data?.topic_name ||
        '';
      const id =
        t.id ||
        t.topic_id ||
        t?.topic?.id ||
        t?.topic?.topic_id ||
        t?.topic_data?.id ||
        t?.topic_data?.topic_id ||
        '';
      return { name: (name || '').toString().trim(), id: (id || '').toString().trim() };
    })
    .filter(t => t.name.length > 0); // render only valid topics
  
  // --- LISTS / EVENTS (pass-through best-effort) ---
  const lists = root.lists || root.result?.lists || [];
  const events = root.events || root.result?.events || [];
  
  // Debug if provider changed shape again
  if ((root.topics || root.result?.topics) && topics.length === 0) {
    const sample = (root.topics || root.result?.topics || [])[0];
    console.warn('⚠️ Autocomplete topics had no names. Sample keys:', sample && Object.keys(sample));
  }
  
  return { users, topics, lists, events };
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

function renderAutocomplete(data, container){
  // data is already normalized by extractAutocomplete
  const sections = [];
  
  if (data.users?.length) {
    sections.push(
      `<h4>Users</h4>` +
      data.users.map(u => `
      <div class="ac-item">
        ${u.avatar ? `<img src="${esc(u.avatar)}" width="24" height="24" style="border-radius:4px;object-fit:cover;margin-right:8px">` : ''}
        <strong>${esc(u.name || '')}</strong>
        ${u.handle ? ` <span style="opacity:.7">(@${esc(u.handle)})</span>` : ''}
      </div>
    `).join('')
    );
  }
  
  if (data.topics?.length) {
    sections.push(
      `<h4>Topics</h4>` +
      data.topics.map(t => `
      <div class="ac-item">
        #${esc(t.name)}${t.id ? ` <span style="opacity:.6">(id: ${esc(t.id)})</span>` : ''}
      </div>
    `).join('')
    );
  }
  
  // Lists & events (optional - keep if present)
  if (data.lists?.length) {
    sections.push(
      `<h4>Lists</h4>` +
      data.lists.map(l => `
      <div class="ac-item">
        ${esc(l.name || 'List')}${l.id_str || l.id ? ` <span style="opacity:.6">(id: ${esc(l.id_str || l.id)})</span>` : ''}
      </div>
    `).join('')
    );
  }
  
  if (data.events?.length) {
    sections.push(
      `<h4>Events</h4>` +
      data.events.map(e => `
      <div class="ac-item">
        ${esc(e.name || 'Event')}
      </div>
    `).join('')
    );
  }
  
  container.innerHTML = sections.length ? `<h3>Autocomplete suggestions...</h3>${sections.join('')}` : `<h3>Autocomplete suggestions...</h3><p>No suggestions.</p>`;
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

// DFS fallback to find tweets in any nesting
function deepFindTweets(obj, acc){
  if (!obj || typeof obj !== 'object') return;
  
  // Accept modern nodes or legacy with full_text
  const isTweet = (o) =>
    (o.__typename === 'Tweet') ||
    (o.legacy && (o.legacy.full_text || o.legacy.created_at));
  
  if (isTweet(obj)) { acc.push(obj); return; }
  
  // Unwrap common wrappers
  const node = obj.result || obj.tweet || obj.tweet_results?.result || obj.item || obj;
  if (node && node !== obj && typeof node === 'object' && node !== null){
    if (isTweet(node)) { acc.push(node); return; }
  }
  
  for (const v of Object.values(obj)){
    if (Array.isArray(v)) {
      for (const it of v) deepFindTweets(it, acc);
    } else if (v && typeof v === 'object') {
      deepFindTweets(v, acc);
    }
  }
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
            const candEntries =
                instruction.entries ||
                instruction.addEntries ||
                instruction.moduleItems ||
                [];
            if (Array.isArray(candEntries) && candEntries.length) {
                const entries = candEntries.filter(e =>
                    e?.content?.itemContent?.tweet_results?.result ||
                    e?.content?.itemContent?.tweet_results ||
                    e?.content?.itemContent?.tweetDisplayType === 'Tweet'
                );
                console.log(`  - Found ${entries.length} tweet entries`);
                tweets.push(
                    ...entries
                        .map(e => e.content?.itemContent?.tweet_results?.result ||
                                  e.content?.itemContent?.tweet_results)
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
    
    // Fallback: DFS scan to catch tweets in unusual shapes
    if (tweets.length === 0){
        console.log('🔍 Using DFS fallback to find tweets...');
        const acc = [];
        deepFindTweets(data?.result || data, acc);
        // Normalize to consistent node shape
        tweets.push(...acc.map(t => t.result || t));
        console.log(`  - Found ${tweets.length} tweets via DFS`);
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
// COMMUNITY EXTRACTORS
// ====================

// Flatten the /community-topics payload into [{topic_id, topic_name}]
function flattenCommunityTopics(json){
  const out = [];
  const groups = (json?.data?.fetch_user_community_topics?.community_topics) || [];
  for (const g of groups){
    if (g.topic_id && g.topic_name) out.push({ topic_id: String(g.topic_id), topic_name: g.topic_name });
    for (const s of (g.subtopics || [])){
      if (s.topic_id && s.topic_name) out.push({ topic_id: String(s.topic_id), topic_name: s.topic_name });
    }
  }
  return out;
}

// Pick topic ids that match the user's keyword (case-insensitive substring)
function resolveTopicIds(keyword, topics){
  const q = (keyword || '').trim().toLowerCase();
  if (!q) return [];
  const hits = topics.filter(t => (t.topic_name || '').toLowerCase().includes(q)).map(t => t.topic_id);
  // Special: if user typed "football" and no direct hit, prefer American Football (2) and Soccer (4)
  if (!hits.length && q.includes('football')) return ['2', '4'];
  return Array.from(new Set(hits));
}

function extractCommunitiesFromResponse(json) {
  const out = [];

  const pushNorm = (raw) => {
    if (!raw) return;
    const r = raw.community || raw.community_results?.result || raw.result || raw;
    const id  = r.community_id || r.rest_id || r.id_str || r.id;
    const name = r.name || r.community_name || r.display_name || r.topic || 'Community';
    const desc = r.description || r.summary || '';
    const members =
      r.member_count ?? r.members_count ?? r.stats?.member_count ?? 0;
    const avatar =
      r.avatar?.image_url || r.avatar_image?.image_url || '';

    out.push({ id, name, desc, members, avatar });
  };

  // 1) Common shapes
  const direct = json?.result?.communities || json?.communities || json?.list;
  if (Array.isArray(direct)) direct.forEach(pushNorm);

  // 2) Timeline instructions
  const ins = json?.result?.timeline?.instructions || [];
  for (const i of ins) {
    const es = i.entries || i.addEntries || i.moduleItems || [];
    for (const e of es) {
      const c1 = e?.content?.itemContent?.community_results?.result;
      const c2 = e?.content?.itemContent?.community;
      const c3 = e?.content?.community_results?.result;
      const c4 = e?.content?.community;
      [c1, c2, c3, c4].forEach(pushNorm);
    }
  }

  // 3) Deep scan for obvious arrays of communities
  if (!out.length) {
    const stack = [json];
    while (stack.length) {
      const cur = stack.pop();
      if (cur && typeof cur === 'object') {
        for (const v of Object.values(cur)) {
          if (Array.isArray(v)) {
            for (const item of v) {
              if (item && typeof item === 'object') {
                const looksLikeCommunity =
                  'community_id' in item ||
                  'community' in item ||
                  'community_results' in item ||
                  item?.__typename === 'Community';
                if (looksLikeCommunity) pushNorm(item);
              }
            }
          } else if (v && typeof v === 'object') {
            stack.push(v);
          }
        }
      }
    }
  }

  // Deduplicate by id+name
  const seen = new Set();
  return out.filter(c => {
    const key = `${c.id || ''}|${(c.name || '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderCommunities(list, container, title = 'Communities') {
  container.innerHTML = `<h3>${title}</h3>` +
    (list.length === 0
      ? '<p>No communities found.</p>'
      : list.map(c => `
          <div class="community-card">
            <div style="display:flex; align-items:center; gap:12px;">
              ${c.avatar ? `<img src="${c.avatar}" alt="" width="40" height="40" style="border-radius:8px;object-fit:cover">` : ''}
              <div>
                <strong>${c.name || 'Community'}</strong>
                ${c.id ? `<span class="badge badge-count">${c.id}</span>` : ''}
              </div>
            </div>
            ${c.desc ? `<p style="margin-top:8px">${c.desc}</p>` : ''}
            <div class="tweet-footer">
              <span>👥 ${c.members ?? 0} members</span>
            </div>
          </div>
        `).join(''));
}

// ---------- LIST HELPERS (robust across shapes) ----------

// Normalize a "list" object (works for multiple shapes)
function normalizeList(node) {
  // Common candidate fields across shapes
  const id =
    dget(node, 'id_str') ||
    dget(node, 'rest_id') ||
    dget(node, 'list_id') ||
    dget(node, 'id') ||
    dget(node, 'legacy.id_str') || '';

  const name =
    dget(node, 'name') ||
    dget(node, 'legacy.name') ||
    dget(node, 'title') ||
    'Untitled list';

  const description =
    dget(node, 'description') ||
    dget(node, 'legacy.description') ||
    'No description';

  const memberCount =
    dget(node, 'member_count') ||
    dget(node, 'members_count') ||
    dget(node, 'legacy.member_count') ||
    0;

  const subscriberCount =
    dget(node, 'subscriber_count') ||
    dget(node, 'subscribers_count') ||
    dget(node, 'legacy.subscriber_count') ||
    0;

  // Try to resolve owner
  const owner =
    dget(node, 'user') ||
    dget(node, 'owner') ||
    dget(node, 'legacy.owner') ||
    dget(node, 'owner_results.result') || {};

  const ownerLegacy = owner.legacy || owner;
  const ownerHandle = ownerLegacy?.screen_name || '';
  const ownerName = ownerLegacy?.name || '';

  return {
    id: String(id || '').trim(),
    name,
    description,
    memberCount,
    subscriberCount,
    ownerHandle,
    ownerName
  };
}

// DFS to find list-like objects anywhere in a payload
function extractListsFromResponse(payload) {
  const lists = [];
  const seen = new Set();
  const stack = [payload];

  // Direct arrays first
  const direct = dget(payload, 'result.lists') || dget(payload, 'lists') || dget(payload, 'result.data.lists');
  if (Array.isArray(direct)) {
    for (const item of direct) {
      if (item && typeof item === 'object') stack.push(item);
    }
  }

  // Timeline instructions
  const instructions = dget(payload, 'result.timeline.instructions') || [];
  for (const ins of instructions) {
    const entries = ins.entries || ins.addEntries || ins.moduleItems || [];
    for (const e of entries) {
      if (e && typeof e === 'object') {
        const listNode = dget(e, 'content.itemContent.list') || 
                        dget(e, 'content.itemContent.list_results.result') ||
                        dget(e, 'content.list') ||
                        dget(e, 'list');
        if (listNode) stack.push(listNode);
        stack.push(e);
      }
    }
  }

  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;

    // Candidate: object that looks like a list
    const looksLikeList =
      ('list' in cur) || ('list_id' in cur) || ('member_count' in cur) ||
      cur.__typename === 'List' || 
      (cur.entryType === 'TimelineTimelineItem' && dget(cur, 'content.itemContent.list')) ||
      (('name' in cur) && (('member_count' in cur) || ('subscriber_count' in cur)));

    if (looksLikeList) {
      const node = cur.list || cur;
      const norm = normalizeList(node);
      if (norm.id && !seen.has(norm.id)) {
        seen.add(norm.id);
        lists.push(norm);
      }
    }

    // Walk children
    for (const k in cur) {
      const v = cur[k];
      if (Array.isArray(v)) {
        for (const x of v) {
          if (x && typeof x === 'object') stack.push(x);
        }
      } else if (v && typeof v === 'object') {
        stack.push(v);
      }
    }
  }

  return lists;
}

// Render list cards and wire click -> fill list ID + enable actions
function renderLists(container, lists, title = 'Lists') {
  if (!lists || lists.length === 0) {
    container.innerHTML = `<h3>${title}</h3><p>No lists found.</p>`;
    return;
  }

  container.innerHTML = `<h3>${title}</h3>` +
    lists.map(lst => `
      <div class="community-card" style="cursor: pointer; margin-bottom: 10px;" data-list-id="${esc(lst.id)}">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          <div style="flex: 1;">
            <strong>${esc(lst.name)}</strong>
            ${lst.id ? `<span class="badge badge-count">ID: ${esc(lst.id)}</span>` : ''}
          </div>
        </div>
        <p style="margin: 8px 0; color: #65676b;">${esc(lst.description)}</p>
        <div class="tweet-footer">
          <span>👥 ${formatNumber(lst.memberCount || 0)} members</span>
          <span>👀 ${formatNumber(lst.subscriberCount || 0)} subscribers</span>
          ${lst.ownerHandle ? `<span>· by @${esc(lst.ownerHandle)}${lst.ownerName ? ` (${esc(lst.ownerName)})` : ''}</span>` : ''}
        </div>
      </div>
    `).join('');

  // Add click handlers to list cards
  container.querySelectorAll('[data-list-id]').forEach(card => {
    card.addEventListener('click', () => {
      const listId = card.dataset.listId;
      const input = document.getElementById('list-id-input');
      if (input) input.value = listId;
      // Optionally scroll to the actions section
      const detailsBtn = document.getElementById('get-list-details-btn');
      if (detailsBtn) {
        detailsBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

// ====================
// COMMUNITY TAB
// ====================

// Event handler for community selection (defined outside to allow proper listener management)
function handleCommunitySelectClick(e) {
    const btn = e.target.closest('.select-community-btn');
    if (!btn) return;
    setSelectedCommunity({
        id: btn.dataset.communityId,
        name: btn.dataset.communityName
    });
}

document.getElementById('search-community-btn').addEventListener('click', async () => {
    const kw = (document.getElementById('community-search-input')?.value || '').trim();
    const container = document.getElementById('community-search-results');
    showLoading(container);
    try {
        const data = await fetchFromAPI('/search-community', { query: kw, count: 20 });
        const list = extractCommunitiesFromResponse(data);
        if (!list.length){
            container.innerHTML = `<p>No communities found.</p>`;
            return;
        }
        // Render simple cards with a Select button
        container.innerHTML = list.map((c, i) => `
      <div class="community-card" style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${c.avatar ? `<img src="${esc(c.avatar)}" alt="" width="40" height="40" style="border-radius:8px;object-fit:cover">` : ''}
          <div>
            <strong>${esc(c.name || 'Community')}</strong>
            ${c.id ? `<span class="badge badge-count">${esc(c.id)}</span>` : ''}
            ${c.members ? `<div class="tweet-footer"><span>👥 ${esc(c.members)} members</span></div>` : ''}
          </div>
          <div style="margin-left:auto;">
            <button class="btn-secondary select-community-btn" data-community-id="${esc(c.id || '')}" data-community-name="${esc(c.name || 'Community')}">Select</button>
          </div>
        </div>
        ${c.desc ? `<p style="margin-top:8px">${esc(c.desc)}</p>` : ''}
      </div>
    `).join('');
        // Remove old listener if exists, then add new one
        container.removeEventListener('click', handleCommunitySelectClick);
        container.addEventListener('click', handleCommunitySelectClick);
    } catch (err) {
        console.error('Community search error:', err);
        showError(container, 'Could not load communities.');
    }
});

document.getElementById('get-community-topics-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    await doGetTopics(container);
});

document.getElementById('explore-community-timeline-btn').addEventListener('click', async () => {
    const kw = (document.getElementById('community-search-input')?.value || '').trim();
    const container = document.getElementById('community-explore-results') || document.getElementById('community-results');
    showLoading(container);
    try {
        const topicsData = await fetchFromAPI('/community-topics', {});
        const topics = flattenCommunityTopics(topicsData);
        const ids = resolveTopicIds(kw, topics);
        if (!ids.length) { showWarning(container, `No matching topics for "${kw}". Try "soccer", "american football", "technology"...`); return; }
        const allTweets = [];
        const usersIdx = {};
        const mergeIdx = (src) => { for (const [k,v] of Object.entries(src || {})) if (!usersIdx[k]) usersIdx[k] = v; };
        for (const id of ids) {
            const tData = await fetchFromAPI('/explore-community-timeline', { topicId: id });
            const idx = buildUsersIndexDeep(tData);
            console.log(`👥 Built users index with ${Object.keys(idx).length} users for topic ${id}`);
            mergeIdx(idx);
            const ts = extractTweetsFromResponse(tData);
            // Also extract users from the tweets themselves (in case they're embedded)
            for (const tweet of ts) {
                const user = dget(tweet, 'core.user_results.result');
                if (user) {
                    const legacy = user.legacy || user;
                    const uid = user.rest_id || legacy.id_str || user.id_str || user.id;
                    const uidStr = uid ? String(uid) : null;
                    if (uidStr && legacy.screen_name) {
                        if (!usersIdx[uidStr]) {
                            usersIdx[uidStr] = legacy;
                            // Also store with numeric key if applicable
                            const uidNum = Number(uidStr);
                            if (!isNaN(uidNum) && uidNum.toString() === uidStr && !usersIdx[uidNum]) {
                                usersIdx[uidNum] = legacy;
                            }
                        }
                    }
                }
            }
            allTweets.push(...ts);
        }
        console.log(`👥 Total users in merged index: ${Object.keys(usersIdx).length}`);
        // dedupe tweets by id
        const seen = new Set();
        const unique = allTweets.filter(t => {
            const id = t?.rest_id || t?.legacy?.id_str || t?.id_str || t?.id;
            if (!id) return true;
            if (seen.has(id)) return false;
            seen.add(id); return true;
        });
        displayTweets(unique, container, `Community Timeline for "${kw}"`, { usersIndex: usersIdx });
    } catch (err) {
        console.error('Explore community timeline error:', err);
        showError(container, 'Could not load community timeline.');
    }
});

document.getElementById('get-community-details-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-details-results') || document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId){ showWarning(container, 'No community matched your search.'); return; }
        const details = await fetchFromAPI('/community-details', { communityId });
        const name = dget(details, 'result.name') || dget(details, 'result.community.name') || 'Community';
        const desc = dget(details, 'result.description') || dget(details, 'result.community.description') || '';
        const members = dget(details, 'result.member_count') || dget(details, 'result.stats.member_count') || 0;
        container.innerHTML = `
      <h3>${esc(name)} <small style="opacity:.7">(${esc(communityId)})</small></h3>
      ${desc ? `<p>${esc(desc)}</p>` : ''}
      <div class="tweet-footer"><span>👥 ${esc(members)} members</span></div>
      <details style="margin-top:8px"><summary>Raw</summary>
        <pre class="json-dump">${esc(JSON.stringify(details, null, 2))}</pre>
      </details>
    `;
    } catch (err) {
        console.error('Community details error:', err);
        showError(container, 'Could not load community details.');
    }
});

document.getElementById('get-community-tweets-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId){ showWarning(container, 'No community matched your search.'); return; }
        const data = await fetchFromAPI('/community-tweets', { communityId, searchType: 'Default', rankingMode: 'Relevance', count: 20 });
        const usersIdx = buildUsersIndexDeep(data);
        const tweets = extractTweetsFromResponse(data);
        displayTweets(tweets, container, 'Community Tweets', { usersIndex: usersIdx });
    } catch (err) {
        console.error('Community tweets error:', err);
        showError(container, 'Could not load community tweets.');
    }
});

document.getElementById('get-community-members-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId){ showWarning(container, 'No community matched your search.'); return; }
        const data = await fetchFromAPI('/community-members', { communityId });
        displayGenericResults(data, container, 'Community Members');
    } catch (err) {
        console.error('Community members error:', err);
        showError(container, 'Could not load community members.');
    }
});

document.getElementById('get-community-moderators-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId){ showWarning(container, 'No community matched your search.'); return; }
        const data = await fetchFromAPI('/community-moderators', { communityId });
        displayGenericResults(data, container, 'Community Moderators');
    } catch (err) {
        console.error('Community moderators error:', err);
        showError(container, 'Could not load community moderators.');
    }
});

document.getElementById('get-community-about-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId){ showWarning(container, 'No community matched your search.'); return; }
        const data = await fetchFromAPI('/community-about', { communityId });
        displayGenericResults(data, container, 'About Community');
    } catch (err) {
        console.error('Community about error:', err);
        showError(container, 'Could not load community about.');
    }
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
        const topicsData = await fetchFromAPI('/community-topics', {});
        const flat = flattenCommunityTopics(topicsData);
        const holder = document.getElementById('community-topics-results') || container;
        holder.innerHTML = `
  <h3>Topics</h3>
  <div id="topic-chips" style="display:flex;flex-wrap:wrap;gap:8px;"></div>`;
        const chips = document.getElementById('topic-chips');
        chips.innerHTML = flat.map(t =>
          `<button class="chip" data-id="${esc(t.topic_id)}" data-name="${esc(t.topic_name)}">#${esc(t.topic_name)} (${esc(t.topic_id)})</button>`
        ).join('');
        chips.addEventListener('click', async (e) => {
            const btn = e.target.closest('.chip');
            if (!btn) return;
            document.getElementById('community-search-input').value = btn.dataset.name;
            // immediately load the timeline for this exact id
            const container = document.getElementById('community-explore-results') || holder;
            showLoading(container);
            const tData = await fetchFromAPI('/explore-community-timeline', { topicId: btn.dataset.id });
            const tweets = extractTweetsFromResponse(tData);
            const usersIdx = buildUsersIndexDeep(tData);
            displayTweets(tweets, container, `Community Timeline for "${btn.dataset.name}"`, { usersIndex: usersIdx });
        });
    } catch (err) {
        console.error('Community topics error:', err);
        showError(container, err.message || 'Failed to load topics');
    }
}

// ====================
// LISTS TAB
// ====================

// Helper to get list ID from input
function getListId() {
    return (document.getElementById('list-id-input')?.value || '').trim();
}

// --- Lists: search by keyword ---
document.getElementById('search-lists-btn').addEventListener('click', async () => {
    const query = document.getElementById('list-search-input').value.trim();
    const container = document.getElementById('lists-results');
    if (!query) { 
        showError(container, 'Please enter a search query'); 
        return; 
    }
    showLoading(container);
    try {
        console.log('🔍 Fetching: /search-lists with params:', { query });
        const data = await fetchFromAPI('/search-lists', { query });
        console.log('✅ API Response:', data);
        const lists = extractListsFromResponse(data);
        renderLists(container, lists, `Lists for "${query}"`);
    } catch (err) {
        console.error('Lists search error:', err);
        showError(container, err.message || String(err));
    }
});

// --- List Details ---
document.getElementById('get-list-details-btn').addEventListener('click', async () => {
    const listId = getListId();
    const container = document.getElementById('lists-results');
    if (!listId) { 
        showWarning(container, 'Enter a List ID or click a list above.'); 
        return; 
    }
    showLoading(container);
    try {
        console.log('📄 Fetching list details for:', listId);
        const data = await fetchFromAPI('/list-details', { listId });
        console.log('📄 List details:', data);
        const lists = extractListsFromResponse(data);
        if (lists.length > 0) {
            const L = lists[0];
            container.innerHTML = `
                <h3>List Details</h3>
                <div class="community-card">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                        <div style="flex: 1;">
                            <strong>${esc(L.name)}</strong>
                            ${L.id ? `<span class="badge badge-count">ID: ${esc(L.id)}</span>` : ''}
                        </div>
                    </div>
                    <p style="margin: 8px 0; color: #65676b;">${esc(L.description)}</p>
                    <div class="tweet-footer">
                        <span>👥 ${formatNumber(L.memberCount || 0)} members</span>
                        <span>👀 ${formatNumber(L.subscriberCount || 0)} subscribers</span>
                        ${L.ownerHandle ? `<span>· by @${esc(L.ownerHandle)}${L.ownerName ? ` (${esc(L.ownerName)})` : ''}</span>` : ''}
                    </div>
                </div>
            `;
        } else {
            showWarning(container, 'No details found for this list.');
        }
    } catch (error) {
        console.error('List details error:', error);
        showError(container, error.message || String(error));
    }
});

// --- List Timeline ---
document.getElementById('get-list-timeline-btn').addEventListener('click', async () => {
    const listId = getListId();
    const container = document.getElementById('lists-results');
    if (!listId) { 
        showWarning(container, 'Enter a List ID or click a list above.'); 
        return; 
    }
    showLoading(container);
    try {
        console.log('📜 Fetching list timeline for:', listId);
        const data = await fetchFromAPI('/list-timeline', { listId });
        // Build users index to resolve authors
        const usersIdx = buildUsersIndexDeep(data);
        console.log(`👥 Built users index with ${Object.keys(usersIdx).length} users for list timeline`);
        const tweets = extractTweetsFromResponse(data);
        displayTweets(tweets, container, 'List Timeline', { usersIndex: usersIdx });
    } catch (error) {
        console.error('List timeline error:', error);
        showError(container, error.message || String(error));
    }
});

// --- List Members ---
document.getElementById('get-list-members-btn').addEventListener('click', async () => {
    const listId = getListId();
    const container = document.getElementById('lists-results');
    if (!listId) { 
        showWarning(container, 'Enter a List ID or click a list above.'); 
        return; 
    }
    showLoading(container);
    try {
        console.log('👥 Fetching list members for:', listId);
        const data = await fetchFromAPI('/list-members', { listId, count: 20 });
        // Extract users from timeline instructions
        const users = [];
        const instructions = dget(data, 'result.timeline.instructions') || [];
        for (const ins of instructions) {
            const entries = ins.entries || ins.addEntries || [];
            for (const e of entries) {
                const ur = dget(e, 'content.itemContent.user_results.result');
                if (ur) users.push(ur);
            }
        }
        // Fallback: use buildUsersIndexDeep and convert to user objects
        if (users.length === 0) {
            const usersIdx = buildUsersIndexDeep(data);
            for (const [id, legacy] of Object.entries(usersIdx)) {
                users.push({
                    rest_id: id,
                    legacy: legacy
                });
            }
        }
        displayUsers(users, container, 'List Members');
    } catch (error) {
        console.error('List members error:', error);
        showError(container, error.message || String(error));
    }
});

// --- List Followers ---
document.getElementById('get-list-followers-btn').addEventListener('click', async () => {
    const listId = getListId();
    const container = document.getElementById('lists-results');
    if (!listId) { 
        showWarning(container, 'Enter a List ID or click a list above.'); 
        return; 
    }
    showLoading(container);
    try {
        console.log('👤 Fetching list followers for:', listId);
        const data = await fetchFromAPI('/list-followers', { listId, count: 20 });
        // Extract users from timeline instructions
        const users = [];
        const instructions = dget(data, 'result.timeline.instructions') || [];
        for (const ins of instructions) {
            const entries = ins.entries || ins.addEntries || [];
            for (const e of entries) {
                const ur = dget(e, 'content.itemContent.user_results.result');
                if (ur) users.push(ur);
            }
        }
        // Fallback: use buildUsersIndexDeep and convert to user objects
        if (users.length === 0) {
            const usersIdx = buildUsersIndexDeep(data);
            for (const [id, legacy] of Object.entries(usersIdx)) {
                users.push({
                    rest_id: id,
                    legacy: legacy
                });
            }
        }
        displayUsers(users, container, 'List Followers');
    } catch (error) {
        console.error('List followers error:', error);
        showError(container, error.message || String(error));
    }
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

// Build a users index from ANY payload (community/search/list/timeline/legacy)
function buildUsersIndexDeep(json) {
  const idx = {};
  const push = (u) => {
    if (!u) return;
    const legacy = u.legacy || u;
    const id = u.rest_id || legacy.id_str || u.id_str || u.id;
    const handle = legacy.screen_name;
    // Normalize ID to string for consistent lookups
    const idStr = id ? String(id) : null;
    if (idStr && handle && !idx[idStr]) {
      idx[idStr] = legacy;
      // Also store with numeric key if it's a number (for backwards compatibility)
      const idNum = Number(idStr);
      if (!isNaN(idNum) && idNum.toString() === idStr && !idx[idNum]) {
        idx[idNum] = legacy;
      }
    }
  };
  
  // First, try timeline instructions (most reliable for community timelines)
  const instructions = dget(json, 'result.timeline.instructions') || [];
  for (const ins of instructions) {
    const entries = ins.entries || ins.addEntries || ins.moduleItems || [];
    for (const e of entries) {
      // Check for users embedded in tweet results - try multiple paths
      const u1 = dget(e, 'content.itemContent.tweet_results.result.core.user_results.result');
      const u2 = dget(e, 'content.itemContent.tweet_results.core.user_results.result');
      const u3 = dget(e, 'content.itemContent.tweet_results.result.core.user_results.result.legacy');
      if (u1) push(u1);
      if (u2 && u2 !== u1) push(u2);
      if (u3 && u3 !== u1 && u3 !== u2) push(u3);
      // Also check for direct user results
      const ur = dget(e, 'content.itemContent.user_results.result');
      if (ur) push(ur);
    }
  }
  
  // Legacy/alt: globalObjects.users
  const go = dget(json, 'globalObjects.users');
  if (go) {
    for (const [id, u] of Object.entries(go)) {
      push(u);
    }
  }
  
  // DFS fallback to catch users in any nesting
  const stack = [json];
  const visited = new WeakSet();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || visited.has(cur)) continue;
    if (cur !== json) visited.add(cur);
    // Common places
    push(cur?.core?.user_results?.result);
    if (Array.isArray(cur?.users)) {
      for (const u of cur.users) push(u?.legacy || u);
    }
    if (cur?.result?.users) {
      const ru = cur.result.users;
      if (Array.isArray(ru)) for (const u of ru) push(u?.legacy || u);
      else for (const u of Object.values(ru)) push(u);
    }
    for (const v of Object.values(cur)) {
      if (v && typeof v === 'object' && !visited.has(v)) stack.push(v);
    }
  }
  return idx;
}

function unwrapTweet(node) {
    // Accept result wrapper, legacy-only nodes, etc.
    return node?.result || node;
}

function resolveAuthorFromTweet(tweet, usersIndex = {}) {
  const t = (tweet?.result || tweet);
  // First check: embedded user in tweet
  const embed = dget(t, 'core.user_results.result.legacy');
  if (embed?.screen_name) return { name: embed.name || 'Unknown', username: embed.screen_name };
  
  // Second check: look up by user_id_str from usersIndex
  const uid = dget(t, 'legacy.user_id_str') || dget(t, 'user_id_str') || dget(t, 'legacy.user_id') || dget(t, 'user_id');
  if (uid) {
    const uidStr = String(uid);
    // Try string key first, then numeric
    const idx = usersIndex[uidStr] || usersIndex[uid] || usersIndex[Number(uidStr)];
    if (idx?.screen_name) {
      return { name: idx.name || 'Unknown', username: idx.screen_name };
    }
  }
  
  // Third check: DFS fallback to find any screen_name in the tweet object
  const any = findFirst(t, o => o && typeof o === 'object' && ('screen_name' in o || 'name' in o));
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

