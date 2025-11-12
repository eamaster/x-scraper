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
  // 1) If user has selected a community, use it (validate it's numeric)
  if (selectedCommunity?.id) {
    const id = String(selectedCommunity.id).trim();
    if (/^\d+$/.test(id)) {
      console.log(`✅ Using selected community ID: ${id}`);
      return id;
    }
    console.warn('⚠️ Selected community ID is not numeric:', id);
  }
  
  // 2) If there's an ID typed, validate it's numeric
  const typed = (document.getElementById('community-id-input')?.value || '').trim();
  if (typed) {
    if (/^\d+$/.test(typed)) {
      console.log(`✅ Using typed community ID: ${typed}`);
      return typed;
    } else {
      const errorMsg = `Invalid community ID: "${typed}". Community ID must be a number. Please select a community from search results or enter a numeric ID.`;
      console.error('❌', errorMsg);
      throw new Error(errorMsg);
    }
  }
  
  // 3) Resolve from the keyword search automatically (pick best match with numeric ID)
  const kw = (document.getElementById('community-search-input')?.value || '').trim();
  if (!kw) {
    const errorMsg = 'No community ID provided. Please search for a community and select one, or enter a numeric community ID.';
    console.error('❌', errorMsg);
    throw new Error(errorMsg);
  }
  
  console.log(`🔍 Auto-resolving community ID from keyword: "${kw}"`);
  const searchData = await fetchFromAPI('/search-community', { query: kw, count: 20 });
  const list = extractCommunitiesFromResponse(searchData);
  if (!list.length) {
    const errorMsg = `No communities found for "${kw}". Please try a different search term or enter a numeric community ID manually.`;
    console.error('❌', errorMsg);
    throw new Error(errorMsg);
  }
  
  // Find first community with a valid numeric ID
  const validCommunity = list.find(c => c.id && /^\d+$/.test(String(c.id)));
  if (!validCommunity) {
    const errorMsg = `Found communities for "${kw}" but none have valid numeric IDs. Please enter a numeric community ID manually.`;
    console.error('❌', errorMsg);
    throw new Error(errorMsg);
  }
  
  setSelectedCommunity(validCommunity);
  console.log(`✅ Auto-selected community: "${validCommunity.name}" (ID: ${validCommunity.id})`);
  return validCommunity.id;
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
    // Check for error responses first
    if (json.error || json.errors) {
        console.error('❌ API returned error:', json.error || json.errors);
        throw new Error(json.message || json.errors?.[0]?.message || 'User not found');
    }
    
    console.log('📊 Normalizing user data. Response keys:', Object.keys(json || {}));
    console.log('📊 Full response structure (first 1000 chars):', JSON.stringify(json, null, 2).substring(0, 1000));
    
    // Try multiple paths to find user data (X API can return data in various structures)
    const candidates = [
        json,
        dget(json, 'result'),
        dget(json, 'user'),
        dget(json, 'data.user'),
        dget(json, 'data.user.result'),
        dget(json, 'result.data.user'),
        dget(json, 'result.data.user.result'),
        dget(json, 'result.data.user_by_screen_name'),
        dget(json, 'result.data.user_by_screen_name.result'),
        dget(json, 'result.user'),
        dget(json, 'result.user.result'),
        dget(json, 'core.user_results.result'),
        dget(json, 'user_results.result'),
    ].filter(Boolean);

    let u = null;
    let userObj = null;
    
    // First, try to find a user object with legacy property
    // Note: In new X API, user data is at result.data.user.result
    // which has both core (for screen_name/name) and legacy (for metrics)
    for (const c of candidates) {
        if (c && typeof c === 'object') {
            // Check if this candidate has both legacy and core (new API structure)
            if (c.legacy && c.core) {
                userObj = c;
            u = c.legacy;
                console.log('✅ Found user with both legacy and core (new API structure)');
            break;
        }
            // Check if this candidate has legacy (older API structure)
            if (c.legacy && !userObj) {
                userObj = c;
                u = c.legacy;
                console.log('✅ Found user with legacy at path:', c === json ? 'root' : 'nested');
            }
            // Check if this candidate has user.legacy
            if (c.user && c.user.legacy && !userObj) {
                userObj = c;
            u = c.user.legacy;
                console.log('✅ Found user.user.legacy');
            }
        }
    }

    // If no legacy found, check if the candidate itself has user-like properties
    if (!u) {
        for (const c of candidates) {
            if (c && typeof c === 'object') {
                // Check if this object looks like a user object (has screen_name or name)
                if (c.screen_name || c.name || (c.legacy && (c.legacy.screen_name || c.legacy.name))) {
                    if (c.legacy) {
                        userObj = c;
                        u = c.legacy;
                    } else {
                        userObj = c;
                        u = c;
                    }
                    console.log('✅ Found user-like object');
            break;
                }
            }
        }
    }

    // Check globalObjects (legacy X API format)
    if (!u && dget(json, 'globalObjects.users')) {
        const users = dget(json, 'globalObjects.users');
        const first = Object.values(users)[0];
        if (first) {
            u = first.legacy || first;
            userObj = first;
            console.log('✅ Found user in globalObjects.users');
        }
    }

    // Last resort: DFS to find any object with screen_name or name
    if (!u) {
        const found = findFirst(json, o => {
            if (!o || typeof o !== 'object') return false;
            return ('screen_name' in o && o.screen_name) || 
                   ('name' in o && o.name) ||
                   (o.legacy && ('screen_name' in o.legacy || 'name' in o.legacy));
        });
        if (found) {
            if (found.legacy) {
                u = found.legacy;
                userObj = found;
            } else {
                u = found;
                userObj = found;
            }
            console.log('✅ Found user via DFS');
        }
    }

    if (!u) {
        console.error('❌ Could not find user data in response');
        console.error('Response structure:', JSON.stringify(json, null, 2).substring(0, 2000));
        throw new Error('User not found - could not parse user data from API response');
    }

    // Extract user data from the found user object
    // IMPORTANT: In new X API, screen_name is in core, NOT legacy!
    // Structure: result.data.user.result.core.screen_name (for username/name)
    //           result.data.user.result.legacy (for metrics like followers_count, statuses_count)
    // So we need to check core first, then fall back to legacy
    const name = (userObj?.core?.name) ||
                 (userObj?.name) ||
                 dget(u, 'name') ||
                 dget(json, 'result.data.user.result.core.name') ||
                 dget(json, 'result.data.user.result.legacy.name') ||
                 dget(json, 'result.data.user_by_screen_name.result.core.name') ||
                 dget(json, 'result.data.user_by_screen_name.result.legacy.name') ||
                 '';
    
    const username = (userObj?.core?.screen_name) ||
                     (userObj?.screen_name) ||
                     dget(u, 'screen_name') ||
                     dget(json, 'result.data.user.result.core.screen_name') ||
                     dget(json, 'result.data.user.result.legacy.screen_name') ||
                     dget(json, 'result.data.user_by_screen_name.result.core.screen_name') ||
                     dget(json, 'result.data.user_by_screen_name.result.legacy.screen_name') ||
                     '';
    
    if (!username) {
        console.error('❌ Could not extract username from user data');
        console.error('User object (legacy) keys:', Object.keys(u || {}));
        console.error('UserObj keys:', Object.keys(userObj || {}));
        console.error('UserObj.core:', userObj?.core);
        console.error('UserObj.core?.screen_name:', userObj?.core?.screen_name);
        console.error('UserObj.core?.name:', userObj?.core?.name);
        if (userObj) {
            console.error('Full userObj structure:', JSON.stringify({
                hasCore: !!userObj.core,
                hasLegacy: !!userObj.legacy,
                coreKeys: userObj.core ? Object.keys(userObj.core) : [],
                legacyKeys: userObj.legacy ? Object.keys(userObj.legacy) : []
            }, null, 2));
        }
        console.error('Full userObj (first 2000 chars):', JSON.stringify(userObj, null, 2).substring(0, 2000));
        throw new Error('User not found - could not extract username');
    }
    
    console.log('✅ Extracted username:', username, 'from core:', !!userObj?.core?.screen_name);
    
    // Extract avatar
    const avatar =
        (userObj?.avatar?.image_url) ||
        dget(u, 'profile_image_url_https') ||
        dget(u, 'profile_image_url') ||
        (userObj?.profile_image_url_https) ||
        (userObj?.profile_image_url) ||
        dget(json, 'result.data.user.result.avatar.image_url') ||
        dget(json, 'result.data.user_by_screen_name.result.avatar.image_url') ||
        dget(json, 'user.avatar.image_url') || '';
    
    // Extract description
    const description =
        dget(u, 'description') ||
        (userObj?.legacy?.description) ||
        (userObj?.description) ||
        dget(json, 'result.data.user.result.legacy.description') ||
        dget(json, 'result.data.user_by_screen_name.result.legacy.description') ||
        dget(json, 'user.description') || '';
    
    // Extract verified status
    const verified = !!(dget(u, 'verified') || 
                       dget(u, 'is_blue_verified') ||
                       (userObj?.is_blue_verified) ||
                       (userObj?.verified) ||
                       (userObj?.verification?.verified) ||
                       dget(json, 'result.data.user.result.is_blue_verified') ||
                       dget(json, 'result.data.user.result.verification.verified') ||
                       dget(json, 'result.data.user_by_screen_name.result.is_blue_verified') ||
                       dget(json, 'result.data.user_by_screen_name.result.verification.verified'));

    // Extract metrics
    const tweets = dget(u, 'statuses_count') ??
                   dget(userObj, 'statuses_count') ??
                       dget(json, 'result.data.user.result.legacy.statuses_count') ??
                   dget(json, 'result.data.user_by_screen_name.result.legacy.statuses_count') ??
                   dget(json, 'user.legacy.statuses_count') ??
                   0;
    
    const followers = dget(u, 'followers_count') ??
                      dget(userObj, 'followers_count') ??
                      dget(json, 'result.data.user.result.legacy.followers_count') ??
                      dget(json, 'result.data.user_by_screen_name.result.legacy.followers_count') ??
                      0;
    
    const following = dget(u, 'friends_count') ??
                      dget(userObj, 'friends_count') ??
                      dget(json, 'result.data.user.result.legacy.friends_count') ??
                      dget(json, 'result.data.user_by_screen_name.result.legacy.friends_count') ??
                      0;
    
    const favourites = dget(u, 'favourites_count') ??
                       dget(u, 'favouritesCount') ??
                       dget(userObj, 'favourites_count') ??
                       dget(json, 'result.data.user.result.legacy.favourites_count') ??
                       dget(json, 'result.data.user_by_screen_name.result.legacy.favourites_count') ??
                       0;

    console.log('✅ Normalized user:', { name, username, verified, tweets, followers, following });

    return {
        name,
        username,
        description,
        avatar,
        verified,
        metrics: { tweets: tweets || 0, followers: followers || 0, following: following || 0, favourites: favourites || 0 }
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
    container.innerHTML = `<div class="alert alert-warning" style="background-color: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 12px; border-radius: 4px; margin: 10px 0;">
        <strong>⚠️ Warning:</strong> ${esc(message)}
    </div>`;
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
    const countInput = document.getElementById('search-count').value;
    // Convert to number and ensure minimum of 1
    const count = Math.max(1, parseInt(countInput, 10) || 20);
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
    if (!username) { 
        showError(container, 'Please enter a username'); 
        return; 
    }
    currentUsername = username;
    showLoading(container);
    try {
        console.log(`🔍 Fetching user profile for: ${username}`);
        const data = await fetchFromAPI('/user', { username });
        console.log('📊 Raw user API response:', data);
        
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
            throw new Error('Empty response from API');
        }
        
        const normalized = normalizeUser(data);
        console.log('✅ Normalized user data:', normalized);
        
        if (!normalized || !normalized.username) {
            throw new Error('Could not extract user information from API response');
        }
        
        renderUserCard(normalized, container);
    } catch (error) { 
        console.error('❌ Error fetching user profile:', error);
        showError(container, error.message || 'User not found'); 
    }
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
        
        console.log(`🔍 Fetching ${type} for user ID: ${userId}`);
        const data = await fetchFromAPI(endpoints[type], { user: userId, count });
        
        console.log(`🔍 ${type} response structure:`, Object.keys(data), data);
        console.log(`🔍 ${type} full response (first 2000 chars):`, JSON.stringify(data, null, 2).substring(0, 2000));
        
        // Special handling for likes endpoint (deprecated, might have empty timeline_v2)
        if (type === 'likes') {
            // Check if the response indicates the endpoint is deprecated or unavailable
            if (data.error || data.errors) {
                throw new Error(data.message || data.errors?.[0]?.message || 'Likes endpoint is unavailable');
            }
            // Check if timeline_v2 exists but is empty
            const timelineV2 = dget(data, 'data.user.result.timeline_v2') || 
                              data.data?.user?.result?.timeline_v2 ||
                              data.result?.timeline_v2;
            if (timelineV2 && typeof timelineV2 === 'object' && Object.keys(timelineV2).length === 0) {
                console.warn('⚠️ timeline_v2 is empty - endpoint might be deprecated or unavailable');
                showWarning(container, 'The user-likes endpoint is deprecated and may not return data. User likes are not publicly available through this API.');
                return;
            }
        }
        
        // Extract tweets - try multiple possible structures
        let tweets = extractTweetsFromResponse(data);
        
        console.log(`✅ Extracted ${tweets.length} tweets for ${type}`);
        
        if (tweets.length === 0) {
            if (type === 'likes') {
                showWarning(container, 'No likes found. The user-likes endpoint is deprecated and may not work. User likes are not publicly available through this API.');
            } else {
                showWarning(container, `No ${type} found for this user.`);
            }
            return;
        }
        
        // Build users index for author resolution
        const usersIdx = buildUsersIndexDeep(data);
        console.log(`👥 Built users index with ${Object.keys(usersIdx).length} users for ${type}`);
        
        // Extract users from tweets themselves and merge into usersIdx
        for (const tweet of tweets) {
            const t = tweet?.result || tweet;
            const userPaths = [
                dget(t, 'core.user_results.result'),
                dget(t, 'user_results.result'),
                dget(t, 'user'),
                dget(t, 'legacy.user'),
                t.core?.user_results?.result,
                t.user_results?.result,
                t.user,
                t.legacy?.user,
            ];
            for (const user of userPaths) {
                if (!user) continue;
                const legacy = user.legacy || user;
                const uid = user.rest_id || legacy.id_str || user.id_str || user.id;
                const uidStr = uid ? String(uid) : null;
                if (uidStr && (legacy.screen_name || user.screen_name || user.core?.screen_name)) {
                    if (!usersIdx[uidStr]) {
                        usersIdx[uidStr] = legacy;
                        const uidNum = Number(uidStr);
                        if (!isNaN(uidNum) && uidNum.toString() === uidStr && !usersIdx[uidNum]) {
                            usersIdx[uidNum] = legacy;
                        }
                    }
                }
            }
        }
        
        displayTweets(tweets, container, `${type.charAt(0).toUpperCase() + type.slice(1)} from @${username}`, { usersIndex: usersIdx });
    } catch (error) { 
        console.error(`❌ Error fetching ${type}:`, error);
        showError(container, error.message); 
    }
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
    
    // Try structure 0: data.user.result.timeline_v2 (for user-likes endpoint - deprecated)
    // Also check data.result.timeline_v2 as alternative structure
    const timelineV2Paths = [
        dget(data, 'data.user.result.timeline_v2'),
        dget(data, 'data.user.result.timeline_v2.timeline'),
        data.data?.user?.result?.timeline_v2,
        data.result?.timeline_v2,
        data.timeline_v2
    ].filter(Boolean);
    
    for (const timelineV2 of timelineV2Paths) {
        if (timelineV2 && typeof timelineV2 === 'object') {
            console.log('📋 Found timeline_v2 structure');
            console.log('📋 timeline_v2 keys:', Object.keys(timelineV2));
            console.log('📋 timeline_v2 structure (first 500 chars):', JSON.stringify(timelineV2, null, 2).substring(0, 500));
            
            // Check if timeline_v2 is empty (deprecated endpoint)
            if (Object.keys(timelineV2).length === 0) {
                console.warn('⚠️ timeline_v2 is empty - endpoint is deprecated');
                continue; // Try other paths
            }
            
            // Check if timeline_v2 has instructions (nested timeline)
            const nestedTimeline = timelineV2.timeline;
            const v2Instructions = timelineV2.instructions || 
                                   nestedTimeline?.instructions || 
                                   [];
            
            if (v2Instructions.length > 0) {
                console.log(`📋 Found ${v2Instructions.length} instructions in timeline_v2`);
                for (const instruction of v2Instructions) {
                    if (!instruction || typeof instruction !== 'object') continue;
                    const candEntries =
                        instruction.entries ||
                        instruction.addEntries ||
                        instruction.moduleItems ||
                        [];
                    if (Array.isArray(candEntries) && candEntries.length) {
                        console.log(`  - Checking ${candEntries.length} candidate entries in timeline_v2`);
                        for (const e of candEntries) {
                            if (!e || typeof e !== 'object') continue;
                            const tweetNode = 
                                e.content?.itemContent?.tweet_results?.result ||
                                e.content?.itemContent?.tweet_results ||
                                e.content?.itemContent?.tweet ||
                                e.content?.tweet_results?.result ||
                                e.content?.tweet_results ||
                                e.tweet_results?.result ||
                                e.tweet_results ||
                                (e.content?.itemContent?.tweetDisplayType === 'Tweet' ? e.content?.itemContent : null);
                            
                            if (tweetNode) {
                                let final = tweetNode.result || tweetNode;
                                if (final.tweet) {
                                    final = final.tweet.result || final.tweet;
                                }
                                if (final && (final.legacy || final.full_text || final.text || final.__typename === 'Tweet')) {
                                    tweets.push(final);
                                }
                            }
                        }
                        console.log(`  - Extracted ${tweets.length} tweets from timeline_v2`);
                    }
                }
                if (tweets.length > 0) break; // Found tweets, stop searching
            } else {
                // Check if timeline_v2 has other structures
                console.log('⚠️ timeline_v2 has no instructions. Checking alternative structures...');
                
                // Check for tweets array directly
                if (timelineV2.tweets && Array.isArray(timelineV2.tweets) && timelineV2.tweets.length > 0) {
                    console.log(`  - Found ${timelineV2.tweets.length} tweets directly in timeline_v2`);
                    tweets = timelineV2.tweets;
                    break;
                }
                
                // Check for entries array
                if (timelineV2.entries && Array.isArray(timelineV2.entries) && timelineV2.entries.length > 0) {
                    console.log(`  - Found ${timelineV2.entries.length} entries in timeline_v2`);
                    // Process entries similar to instructions
                    for (const e of timelineV2.entries) {
                        if (!e || typeof e !== 'object') continue;
                        const tweetNode = 
                            e.content?.itemContent?.tweet_results?.result ||
                            e.content?.itemContent?.tweet_results ||
                            e.content?.itemContent?.tweet ||
                            e.content?.tweet_results?.result ||
                            e.tweet_results?.result;
                        if (tweetNode) {
                            let final = tweetNode.result || tweetNode;
                            if (final && (final.legacy || final.full_text || final.text || final.__typename === 'Tweet')) {
                                tweets.push(final);
                            }
                        }
                    }
                    if (tweets.length > 0) break;
                }
                
                // Check for any nested structures that might contain tweets
                for (const [key, value] of Object.entries(timelineV2)) {
                    if (Array.isArray(value) && value.length > 0) {
                        console.log(`  - Found array at timeline_v2.${key} with ${value.length} items`);
                        // Check if it looks like tweets
                        if (value[0] && (value[0].__typename === 'Tweet' || value[0].legacy || value[0].full_text)) {
                            console.log(`  - Looks like tweets! Using array from timeline_v2.${key}`);
                            tweets = value;
                            break;
                        }
                    }
                }
                if (tweets.length > 0) break;
            }
        }
    }
    
    // Try structure 1: data.result.timeline.instructions
    const instructions = data.result?.timeline?.instructions || [];
    console.log(`📋 Found ${instructions.length} instructions`);
    if (instructions.length > 0 && tweets.length === 0) {
        for (const instruction of instructions) {
            console.log(`  - Instruction type: ${instruction.type || 'unknown'}`);
            const candEntries =
                instruction.entries ||
                instruction.addEntries ||
                instruction.moduleItems ||
                [];
            if (Array.isArray(candEntries) && candEntries.length) {
                console.log(`  - Checking ${candEntries.length} candidate entries`);
                // More tolerant filtering - check for tweet-like structures
                for (const e of candEntries) {
                    if (!e || typeof e !== 'object') continue;
                    // Try multiple paths to find tweet
                    // Check if this entry has tweet-like content
                    const tweetNode = 
                        e.content?.itemContent?.tweet_results?.result ||
                        e.content?.itemContent?.tweet_results ||
                        e.content?.itemContent?.tweet ||
                        e.content?.tweet_results?.result ||
                        e.content?.tweet_results ||
                        e.tweet_results?.result ||
                        e.tweet_results ||
                        (e.content?.itemContent?.tweetDisplayType === 'Tweet' ? e.content?.itemContent : null);
                    
                    if (tweetNode) {
                        // Unwrap the tweet node - it might be wrapped in result
                        let final = tweetNode.result || tweetNode;
                        // If final has legacy with full_text, it's a valid tweet
                        // If final has full_text directly, it's also valid
                        // If final has tweet property, unwrap further
                        if (final.tweet) {
                            final = final.tweet.result || final.tweet;
                        }
                        // Make sure we have a tweet-like object
                        if (final && (final.legacy || final.full_text || final.text || final.__typename === 'Tweet')) {
                            tweets.push(final);
                        }
                    }
                }
                console.log(`  - Extracted ${tweets.length} tweets from instructions`);
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

// Universal user extractor - handles retweets, likes, followers, following, etc.
function extractUsersFromResponse(data) {
    let users = [];
    const seenUserIds = new Set();
    
    // Helper to add user if not already seen
    const addUser = (user) => {
        if (!user || typeof user !== 'object') return;
        const uid = user.rest_id || user.id_str || user.id || 
                   user.legacy?.id_str || user.legacy?.id ||
                   user.core?.rest_id || user.core?.id_str;
        const uidStr = uid ? String(uid) : null;
        if (uidStr && !seenUserIds.has(uidStr)) {
            seenUserIds.add(uidStr);
            users.push(user);
        } else if (!uidStr && (user.screen_name || user.legacy?.screen_name || user.core?.screen_name)) {
            // If no ID but has screen_name, add it anyway (dedupe by screen_name)
            const screenName = user.screen_name || user.legacy?.screen_name || user.core?.screen_name;
            if (screenName && !seenUserIds.has(screenName)) {
                seenUserIds.add(screenName);
                users.push(user);
            }
        }
    };
    
    // Try structure 1: data.result.timeline.instructions[].entries
    const instructions = data.result?.timeline?.instructions || data.timeline?.instructions || [];
    console.log(`🔍 extractUsersFromResponse: Found ${instructions.length} instructions`);
    if (instructions.length > 0) {
        for (const instruction of instructions) {
            if (!instruction || typeof instruction !== 'object') continue;
            // Check all instruction types, not just TimelineAddEntries
            const entries = instruction.entries || instruction.addEntries || instruction.moduleItems || [];
            console.log(`🔍 extractUsersFromResponse: Instruction type: ${instruction.type}, entries: ${entries.length}`);
            
            for (const entry of entries) {
                if (!entry || typeof entry !== 'object') continue;
                
                // Skip entries that don't look like user entries
                const entryId = entry.entryId || '';
                const isUserEntry = entryId.startsWith('user-') || entryId.includes('user');
                
                // Try multiple paths to extract user from entry
                const userPaths = [
                    // Standard path: entry.content.itemContent.user_results.result
                    dget(entry, 'content.itemContent.user_results.result'),
                    // Alternative: entry.content.itemContent.user
                    dget(entry, 'content.itemContent.user'),
                    // Alternative: entry.content.user_results.result
                    dget(entry, 'content.user_results.result'),
                    // Alternative: entry.content.user
                    dget(entry, 'content.user'),
                    // Direct access
                    entry.content?.itemContent?.user_results?.result,
                    entry.content?.itemContent?.user,
                    entry.content?.user_results?.result,
                    entry.content?.user,
                    // For timeline modules with items
                    ...(entry.content?.items || []).map(item => 
                        dget(item, 'item.itemContent.user_results.result') ||
                        dget(item, 'itemContent.user_results.result') ||
                        item.item?.itemContent?.user_results?.result ||
                        item.itemContent?.user_results?.result
                    ),
                ];
                
                // Log entry structure for debugging (first few entries only)
                if (users.length < 5 && (isUserEntry || entry.content?.itemContent)) {
                    console.log(`🔍 Entry ${entryId} structure:`, {
                        hasItemContent: !!entry.content?.itemContent,
                        itemContentKeys: entry.content?.itemContent ? Object.keys(entry.content.itemContent) : [],
                        hasUserResults: !!entry.content?.itemContent?.user_results,
                        hasUser: !!entry.content?.itemContent?.user,
                    });
                }
                
                for (const user of userPaths) {
                    if (user && typeof user === 'object') {
                        addUser(user);
                    }
                }
                
                // Also check if the entry itself is a user (some endpoints return users directly)
                if (entry.screen_name || entry.legacy?.screen_name || entry.core?.screen_name) {
                    addUser(entry);
                }
                
                // If entryId starts with "user-", try to extract user from content more aggressively
                if (isUserEntry && users.length === 0 && entry.content) {
                    // Try DFS within the entry content
                    const findUserInEntry = (obj, depth = 0) => {
                        if (depth > 3 || !obj || typeof obj !== 'object') return null;
                        if (obj.screen_name || obj.legacy?.screen_name || obj.core?.screen_name) {
                            if (obj.rest_id || obj.id_str || obj.id || obj.legacy?.id_str) {
                                return obj;
                            }
                        }
                        for (const value of Object.values(obj)) {
                            if (value && typeof value === 'object') {
                                const found = findUserInEntry(value, depth + 1);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    const foundUser = findUserInEntry(entry.content);
                    if (foundUser) {
                        addUser(foundUser);
                    }
                }
            }
        }
    }
    
    // Try structure 2: data.data (direct array or object)
    if (users.length === 0 && data.data) {
        console.log('🔍 Trying data.data structure');
        const dataArray = Array.isArray(data.data) ? data.data : Object.values(data.data);
        console.log(`🔍 data.data is array: ${Array.isArray(data.data)}, length: ${dataArray.length}`);
        for (const item of dataArray) {
            if (item && typeof item === 'object') {
                // Check if it's a user object
                if (item.screen_name || item.legacy?.screen_name || item.core?.screen_name || 
                    item.user_results?.result || item.user_results) {
                    const user = item.user_results?.result || item.user_results || item;
                    addUser(user);
                }
            }
        }
    }
    
    // Try structure 3: globalObjects.users (legacy format)
    const globalUsers = dget(data, 'globalObjects.users') || data.globalObjects?.users;
    if (globalUsers && typeof globalUsers === 'object') {
        console.log(`🔍 Found globalObjects.users with ${Object.keys(globalUsers).length} users`);
        for (const user of Object.values(globalUsers)) {
            addUser(user);
        }
    }
    
    // Try structure 4: direct timeline array
    if (users.length === 0 && data.timeline && Array.isArray(data.timeline)) {
        console.log(`🔍 Trying data.timeline array, length: ${data.timeline.length}`);
        for (const item of data.timeline) {
            if (item && typeof item === 'object') {
                addUser(item);
            }
        }
    }
    
    // Try structure 5: data.result (direct result object, might contain users)
    if (users.length === 0 && data.result && typeof data.result === 'object' && !data.result.timeline) {
        console.log('🔍 Trying data.result structure (no timeline)');
        // Check if result itself contains user-like objects
        if (data.result.screen_name || data.result.legacy?.screen_name || data.result.core?.screen_name) {
            addUser(data.result);
        }
        // Check if result has users array
        if (Array.isArray(data.result.users)) {
            for (const user of data.result.users) {
                addUser(user);
            }
        }
        // Check if result has user_results
        if (data.result.user_results?.result) {
            addUser(data.result.user_results.result);
        }
    }
    
    // Try structure 5: DFS search for user-like objects
    if (users.length === 0) {
        const findUsers = (obj, depth = 0) => {
            if (depth > 5 || !obj || typeof obj !== 'object' || Array.isArray(obj)) return;
            
            // Check if this object is a user
            if (obj.screen_name || obj.legacy?.screen_name || obj.core?.screen_name) {
                if (obj.rest_id || obj.id_str || obj.id || obj.legacy?.id_str) {
                    addUser(obj);
                }
            }
            
            // Recursively search nested objects
            for (const value of Object.values(obj)) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    findUsers(value, depth + 1);
                } else if (Array.isArray(value)) {
                    for (const item of value) {
                        if (item && typeof item === 'object') {
                            findUsers(item, depth + 1);
                        }
                    }
                }
            }
        };
        findUsers(data);
    }
    
    console.log(`✅ extractUsersFromResponse: Found ${users.length} users`);
    return users.filter(u => u && typeof u === 'object'); // Remove null/undefined
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
let selectedTweet = null;
let tweetDataCache = {}; // Cache tweet data by ID

// Extract tweet ID from URL or return as-is if it's already an ID
function extractTweetId(input) {
    if (!input) return null;
    input = input.trim();
    
    // If it's already a numeric ID, return it
    if (/^\d+$/.test(input)) {
        return input;
    }
    
    // Try to extract from X/Twitter URL
    // Patterns: 
    // - https://x.com/username/status/1234567890
    // - https://twitter.com/username/status/1234567890 (legacy)
    // - x.com/username/status/1234567890
    // - twitter.com/username/status/1234567890 (legacy)
    const urlPatterns = [
        /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i,
        /\/status\/(\d+)/i,
        /status\/(\d+)/i
    ];
    
    for (const pattern of urlPatterns) {
        const match = input.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    
    // If no pattern matches, try to extract any long numeric string
    const numericMatch = input.match(/\d{15,}/);
    if (numericMatch) {
        return numericMatch[0];
    }
    
    return null;
}

// Set selected tweet and update UI
function setSelectedTweet(tweet, tweetId) {
    selectedTweet = tweet;
    currentTweetId = tweetId;
    document.getElementById('tweet-id-input').value = tweetId;
    
    // Store tweet in cache
    if (tweet) {
        tweetDataCache[tweetId] = tweet;
    }
    
    // Update selected tweet pill
    const pill = document.getElementById('selected-tweet-pill');
    if (pill && tweet) {
        try {
            const author = resolveAuthorFromTweet(tweet, {});
            pill.textContent = `Selected: @${author.username} - Tweet ID: ${tweetId}`;
            pill.style.display = 'inline-block';
        } catch (e) {
            pill.textContent = `Selected Tweet ID: ${tweetId}`;
            pill.style.display = 'inline-block';
        }
    }
    
    console.log(`✅ Selected tweet ID: ${tweetId}`);
}

// Get tweet ID from input or selected tweet
function getTweetIdOrResolve() {
    const input = document.getElementById('tweet-id-input').value.trim();
    
    // If input exists, extract ID from it
    if (input) {
        const extractedId = extractTweetId(input);
        if (extractedId) {
            currentTweetId = extractedId;
            return extractedId;
        }
        // If extraction failed but input looks like an ID, use it
        if (/^\d+$/.test(input)) {
            currentTweetId = input;
            return input;
        }
        throw new Error('Invalid tweet ID or URL. Please enter a valid tweet ID or URL.');
    }
    
    // If no input but we have a selected tweet, use it
    if (currentTweetId) {
        return currentTweetId;
    }
    
    throw new Error('No tweet selected. Please search for a tweet and click on it, or enter a tweet ID/URL.');
}

// Search for tweets and display clickable results
document.getElementById('search-tweets-btn').addEventListener('click', async () => {
    const query = document.getElementById('tweet-search-input').value.trim();
    const type = document.getElementById('tweet-search-type').value;
    const count = document.getElementById('tweet-search-count').value || 20;
    const container = document.getElementById('tweet-search-results');
    
    if (!query) {
        showError(container, 'Please enter a search query');
        return;
    }
    
    // Check if the input is a URL - if so, extract ID and load tweet directly
    const tweetId = extractTweetId(query);
    if (tweetId && (query.includes('twitter.com') || query.includes('x.com') || query.includes('/status/'))) {
        console.log(`🔍 Detected tweet URL, extracting ID: ${tweetId}`);
        // Set the tweet ID and load it
        document.getElementById('tweet-id-input').value = tweetId;
        currentTweetId = tweetId;
        handleTweetSelect(tweetId);
        return;
    }
    
    showLoading(container);
    try {
        console.log(`🔍 Searching tweets for: ${query}`);
        const data = await fetchFromAPI('/search-v2', { query, type, count });
        
        // Extract tweets
        const tweets = extractTweetsFromResponse(data);
        console.log(`✅ Found ${tweets.length} tweets`);
        
        if (tweets.length === 0) {
            showWarning(container, 'No tweets found. Try a different search query.');
            return;
        }
        
        // Build users index
        const usersIdx = buildUsersIndexDeep(data);
        console.log(`👥 Built users index with ${Object.keys(usersIdx).length} users`);
        
        // Extract users from tweets
        for (const tweet of tweets) {
            const t = tweet?.result || tweet;
            const userPaths = [
                dget(t, 'core.user_results.result'),
                dget(t, 'user_results.result'),
                dget(t, 'user'),
                t.core?.user_results?.result,
                t.user_results?.result,
                t.user,
            ];
            for (const user of userPaths) {
                if (!user) continue;
                const legacy = user.legacy || user;
                const uid = user.rest_id || legacy.id_str || user.id_str || user.id;
                const uidStr = uid ? String(uid) : null;
                if (uidStr && (legacy.screen_name || user.screen_name || user.core?.screen_name)) {
                    if (!usersIdx[uidStr]) {
                        usersIdx[uidStr] = legacy;
                    }
                }
            }
        }
        
        // Display tweets with click handlers
        displayTweetsWithSelection(tweets, container, `Search Results for "${query}"`, usersIdx);
        
    } catch (error) {
        console.error('❌ Error searching tweets:', error);
        showError(container, error.message);
    }
});

// Display tweets with click-to-select functionality
function displayTweetsWithSelection(tweets, container, title, usersIndex = {}) {
    if (!Array.isArray(tweets) || tweets.length === 0) {
        container.innerHTML = `<h3>${title}</h3><p>No tweets found.</p>`;
        return;
    }
    
    console.log(`🎨 Displaying ${tweets.length} tweets with selection`);
    
    // Store tweets in cache for later retrieval
    tweets.forEach((t, idx) => {
        let node = unwrapTweet(t);
        if (!node) return;
        
        const tweetId = node.rest_id || 
                       node.legacy?.id_str || 
                       node.id_str || 
                       node.id ||
                       dget(node, 'result.rest_id') ||
                       dget(node, 'result.legacy.id_str') ||
                       '';
        
        if (tweetId) {
            tweetDataCache[tweetId] = t;
        }
    });
    
    container.innerHTML = `<h3>${title} - Click on a tweet to view details</h3>${
        tweets.map((t, idx) => {
            // Unwrap tweet node
            let node = unwrapTweet(t);
            if (!node) return '';
            
            // Get tweet ID
            const tweetId = node.rest_id || 
                           node.legacy?.id_str || 
                           node.id_str || 
                           node.id ||
                           dget(node, 'result.rest_id') ||
                           dget(node, 'result.legacy.id_str') ||
                           '';
            
            if (!tweetId) {
                console.warn(`⚠️ Tweet ${idx} has no ID`);
                return '';
            }
            
            // Extract tweet data
            let legacy = node.legacy;
            if (!legacy) {
                if (node.full_text || node.created_at || node.text) {
                    legacy = node;
                } else {
                    legacy = node.tweet?.legacy || node.result?.legacy || node;
                }
            }
            
            const text = 
                legacy?.full_text || 
                legacy?.text || 
                node?.full_text || 
                node?.text || 
                '';
            
            const author = resolveAuthorFromTweet(t, usersIndex);
            
            const favoriteCount = legacy?.favorite_count || legacy?.favourites_count || 0;
            const retweetCount = legacy?.retweet_count || 0;
            const replyCount = legacy?.reply_count || 0;
            
            // Format date
            const dateRaw = legacy?.created_at || node?.created_at || '';
            let dateStr = 'Unknown';
            if (dateRaw) {
                try {
                    const parsed = new Date(dateRaw);
                    dateStr = isNaN(parsed.getTime()) ? dateRaw : parsed.toLocaleString();
                } catch (e) {
                    dateStr = String(dateRaw);
                }
            }
            
            return `<div class="tweet-card selectable-tweet" data-tweet-id="${esc(tweetId)}" style="cursor: pointer; border: 2px solid #e1e8ed; border-radius: 8px; padding: 12px; margin: 8px 0; transition: all 0.2s; background: #fff;" 
                     onmouseover="this.style.borderColor='#1da1f2'; this.style.boxShadow='0 2px 8px rgba(29,161,242,0.2)';" 
                     onmouseout="this.style.borderColor='#e1e8ed'; this.style.boxShadow='none';">
                <p><strong>@${esc(author.username)}:</strong> ${text ? esc(text.substring(0, 200)) + (text.length > 200 ? '...' : '') : '<em style="color: #657786;">No content</em>'}</p>
                <div class="tweet-footer">
                  <span>❤️ ${formatNumber(favoriteCount)}</span>
                  <span>🔁 ${formatNumber(retweetCount)}</span>
                  <span>💬 ${formatNumber(replyCount)}</span>
                  <span>📅 ${esc(dateStr)}</span>
                  <span style="margin-left: 10px; color: #1da1f2; font-weight: bold;">📌 Click to select</span>
                </div>
                <div style="margin-top: 5px; font-size: 12px; color: #657786;">Tweet ID: ${esc(tweetId)}</div>
            </div>`;
        }).filter(Boolean).join('')
    }`;
    
    // Add click event listeners to tweet cards
    container.querySelectorAll('.selectable-tweet').forEach(card => {
        card.addEventListener('click', function() {
            const tweetId = this.getAttribute('data-tweet-id');
            if (tweetId) {
                handleTweetSelect(tweetId);
            }
        });
    });
}

// Handle tweet selection - simplified version
function handleTweetSelect(tweetId) {
    if (!tweetId) return;
    
    console.log(`✅ Tweet selected: ${tweetId}`);
    
    // Set the tweet ID in the input field
    document.getElementById('tweet-id-input').value = tweetId;
    currentTweetId = tweetId;
    
    // Update selected tweet pill
    const pill = document.getElementById('selected-tweet-pill');
    if (pill) {
        pill.textContent = `Selected Tweet ID: ${tweetId}`;
        pill.style.display = 'inline-block';
    }
    
    // Automatically load tweet details
    document.getElementById('get-tweet-btn').click();
}

document.getElementById('get-tweet-btn').addEventListener('click', async () => {
    const input = document.getElementById('tweet-id-input').value.trim();
    const container = document.getElementById('tweet-details');
    
    if (!input) {
        showError(container, 'Please enter a tweet ID or URL, or search for a tweet and click on it');
        return;
    }
    
    // Extract tweet ID from input (handles URLs)
    const tweetId = extractTweetId(input);
    if (!tweetId) {
        showError(container, 'Invalid tweet ID or URL. Please enter a valid tweet ID or URL (e.g., https://x.com/username/status/1234567890)');
        return;
    }
    
    currentTweetId = tweetId;
    showLoading(container);
    
    try {
        console.log(`🔍 Fetching tweet details for ID: ${tweetId}`);
        const data = await fetchFromAPI('/tweet-v2', { pid: tweetId });
        console.log('📊 Tweet details response:', data);
        console.log('📊 Tweet details response keys:', Object.keys(data || {}));
        console.log('📊 Tweet details response structure (first 1500 chars):', JSON.stringify(data, null, 2).substring(0, 1500));
        
        // Extract tweet from response - handle multiple response structures
        // The /tweet-v2 endpoint returns: { result: { tweetResult: { result: { ... } } } }
        // Or sometimes: { tweetResult: { result: { ... } } }
        let tweet = null;
        
        // Log full response structure for debugging
        console.log('📊 Full response keys:', Object.keys(data || {}));
        if (data.result) {
            console.log('📊 data.result keys:', Object.keys(data.result || {}));
            if (data.result.tweetResult) {
                console.log('📊 data.result.tweetResult keys:', Object.keys(data.result.tweetResult || {}));
                if (data.result.tweetResult.result) {
                    console.log('📊 data.result.tweetResult.result keys:', Object.keys(data.result.tweetResult.result || {}));
                }
            }
        }
        
        // Try all possible paths in order of likelihood
        // Based on console logs, the structure is often: { result: { tweetResult: { result: { ... } } } }
        // Or: { tweetResult: { result: { ... } } }
        
        // Priority 1: Check data.result.tweetResult.result (most common for /tweet-v2)
        if (data.result?.tweetResult?.result) {
            tweet = data.result.tweetResult.result;
            console.log('✅ Extracted tweet from data.result.tweetResult.result');
        }
        // Priority 2: Check data.tweetResult.result
        else if (data.tweetResult?.result) {
            tweet = data.tweetResult.result;
            console.log('✅ Extracted tweet from data.tweetResult.result');
        }
        // Priority 3: Check data.result.result
        else if (data.result?.result) {
            tweet = data.result.result;
            console.log('✅ Extracted tweet from data.result.result');
            // If this result has tweetResult, unwrap further
            if (tweet.tweetResult?.result) {
                tweet = tweet.tweetResult.result;
                console.log('✅ Further unwrapped to data.result.result.tweetResult.result');
            }
        }
        // Priority 4: Check if data.result is the tweet itself
        else if (data.result?.__typename === 'Tweet' || data.result?.legacy || data.result?.rest_id) {
            tweet = data.result;
            console.log('✅ Extracted tweet from data.result (direct Tweet object)');
            // If result has tweetResult, unwrap it
            if (tweet.tweetResult?.result) {
                tweet = tweet.tweetResult.result;
                console.log('✅ Unwrapped data.result.tweetResult.result');
            }
        }
        // Priority 5: Check data.tweetResult (without nested result)
        else if (data.tweetResult) {
            tweet = data.tweetResult;
            console.log('✅ Extracted tweet from data.tweetResult');
            // If it has a nested result, unwrap it
            if (tweet.result && (tweet.result.__typename === 'Tweet' || tweet.result.legacy || tweet.result.rest_id)) {
                tweet = tweet.result;
                console.log('✅ Unwrapped data.tweetResult.result');
            }
        }
        // Priority 6: Check data.result (fallback)
        else if (data.result) {
            tweet = data.result;
            console.log('✅ Extracted tweet from data.result (fallback)');
        }
        // Priority 7: Check if data itself is a tweet
        else if (data.__typename === 'Tweet' || data.legacy || data.rest_id) {
            tweet = data;
            console.log('✅ Using data itself as tweet (direct Tweet)');
        }
        // Last resort: use data itself
        else {
            tweet = data;
            console.log('⚠️ Using data itself as tweet (last resort fallback)');
        }
        
        if (!tweet || typeof tweet !== 'object') {
            console.error('❌ No valid tweet object found');
            console.error('Data structure:', JSON.stringify(data, null, 2).substring(0, 2000));
            throw new Error('No tweet data found in response');
        }
        
        console.log('✅ Extracted tweet. Tweet keys:', Object.keys(tweet || {}));
        console.log('✅ Tweet has __typename:', tweet.__typename);
        console.log('✅ Tweet has rest_id:', tweet.rest_id);
        console.log('✅ Tweet has legacy:', !!tweet.legacy);
        if (tweet.legacy) {
            console.log('✅ Tweet legacy keys:', Object.keys(tweet.legacy || {}));
            console.log('✅ Tweet legacy has full_text:', !!tweet.legacy.full_text);
            console.log('✅ Tweet legacy has text:', !!tweet.legacy.text);
            if (tweet.legacy.full_text) {
                console.log('✅ Tweet text (first 100 chars):', tweet.legacy.full_text.substring(0, 100));
            }
        }
        console.log('✅ Tweet structure (first 2000 chars):', JSON.stringify(tweet, null, 2).substring(0, 2000));
        
        // Validate tweet - check if it has the necessary properties
        const hasLegacy = tweet.legacy !== undefined && tweet.legacy !== null;
        const hasText = !!(tweet.legacy?.full_text || tweet.legacy?.text || tweet.full_text || tweet.text || tweet.note_tweet?.note_tweet_results?.result?.text);
        const hasId = !!(tweet.rest_id || tweet.legacy?.id_str || tweet.id_str);
        
        console.log('✅ Tweet validation - has legacy:', hasLegacy, 'has text:', hasText, 'has ID:', hasId);
        
        // If tweet doesn't look valid, try one more unwrap
        if (!hasLegacy && !hasText && !hasId && tweet.result) {
            console.warn('⚠️ Tweet doesn\'t look valid, trying to unwrap tweet.result...');
            if (tweet.result.__typename === 'Tweet' || tweet.result.legacy || tweet.result.rest_id) {
                tweet = tweet.result;
                console.log('✅ Unwrapped to tweet.result');
            }
        }
        
        // Final check - ensure we have a valid tweet
        if (!tweet.legacy && !tweet.rest_id && !tweet.__typename) {
            console.error('❌ Tweet still doesn\'t look valid after all unwrapping attempts');
            console.error('Tweet keys:', Object.keys(tweet));
            console.error('Full tweet (first 3000 chars):', JSON.stringify(tweet, null, 2).substring(0, 3000));
            // Don't throw error - try to display it anyway and let displayTweets handle it
        }
        
        // Build users index for author resolution
        const usersIdx = buildUsersIndexDeep(data);
        console.log(`👥 Built users index with ${Object.keys(usersIdx).length} users`);
        
        // Extract users from tweet itself
        const userPaths = [
            dget(tweet, 'core.user_results.result'),
            dget(tweet, 'user_results.result'),
            tweet.core?.user_results?.result,
            tweet.user_results?.result,
        ];
        for (const user of userPaths) {
            if (!user) continue;
            const legacy = user.legacy || user;
            const uid = user.rest_id || legacy.id_str || user.id_str || user.id;
            const uidStr = uid ? String(uid) : null;
            if (uidStr && (legacy.screen_name || user.screen_name || user.core?.screen_name)) {
                if (!usersIdx[uidStr]) {
                    usersIdx[uidStr] = legacy;
                }
            }
        }
        
        // Update selected tweet
        setSelectedTweet(tweet, tweetId);
        
        // Display tweet details
        displayTweets([tweet], container, 'Tweet Details', { usersIndex: usersIdx });
        
    } catch (error) {
        console.error('❌ Error fetching tweet:', error);
        showError(container, error.message);
    }
});

async function getTweetInteractions(type) {
    const countInput = document.getElementById('tweet-count').value;
    // Convert to number and ensure minimum of 1
    const count = Math.max(1, parseInt(countInput, 10) || 40);
    const container = document.getElementById('tweet-interactions');
    
    // Get tweet ID (from input or selected)
    let tweetId;
    try {
        tweetId = getTweetIdOrResolve();
    } catch (error) {
        showError(container, error.message);
        return;
    }
    
    if (!tweetId) {
        showError(container, 'Please enter a tweet ID first, or search for a tweet and click on it');
        return;
    }
    
    showLoading(container);
    const endpoints = { comments: '/comments-v2', retweets: '/retweets', quotes: '/quotes', likes: '/likes' };
    try {
        const params = { pid: tweetId, count };
        if (type === 'comments') params.rankingMode = 'Relevance';
        
        console.log(`🔍 Fetching ${type} for tweet ID: ${tweetId} with count: ${count}`);
        const data = await fetchFromAPI(endpoints[type], params);
        console.log(`📊 ${type} response:`, data);
        
        // Handle retweets and likes - these endpoints return users, not tweets
        if (type === 'likes' || type === 'retweets') {
            // Log full response structure for debugging
            console.log(`📊 ${type} response keys:`, Object.keys(data || {}));
            console.log(`📊 ${type} response structure (first 2000 chars):`, JSON.stringify(data, null, 2).substring(0, 2000));
            
            let users = extractUsersFromResponse(data);
            console.log(`✅ Extracted ${users.length} users for ${type}`);
            
            if (users.length === 0) {
                // For likes, check if the endpoint is deprecated or unavailable
        if (type === 'likes') {
                    // Check if response indicates no data or deprecated endpoint
                    const hasInstructions = !!(data.result?.timeline?.instructions || data.timeline?.instructions || []);
                    const hasData = !!(data.data || data.result || data.timeline);
                    
                    if (!hasInstructions && !hasData) {
                        showWarning(container, 'The likes endpoint may be deprecated or unavailable. User likes are not publicly available through this API.');
                    } else {
                        showWarning(container, 'No likes found for this tweet.');
                    }
                } else {
                    showWarning(container, `No ${type} found for this tweet.`);
                }
                return;
            }
            
            // Limit results to requested count
            if (users.length > count) {
                users = users.slice(0, count);
                console.log(`📊 Limited ${type} results to ${count} users (API returned ${users.length} total)`);
            }
            
            displayUsers(users, container, type.charAt(0).toUpperCase() + type.slice(1));
        } else {
            // Comments and quotes return tweets, not users
            // Build users index for author resolution
            const usersIdx = buildUsersIndexDeep(data);
            console.log(`👥 Built users index with ${Object.keys(usersIdx).length} users`);
            
            // Extract tweets from response
            let tweets = extractTweetsFromResponse(data);
            console.log(`🔬 Extracted ${tweets.length} tweets from ${type} response`);
            
            // Extract users from tweets and merge into usersIdx
            for (const tweet of tweets) {
                const t = tweet?.result || tweet;
                const userPaths = [
                    dget(t, 'core.user_results.result'),
                    dget(t, 'user_results.result'),
                    t.core?.user_results?.result,
                    t.user_results?.result,
                ];
                for (const user of userPaths) {
                    if (!user) continue;
                    const legacy = user.legacy || user;
                    const uid = user.rest_id || legacy.id_str || user.id_str || user.id;
                    const uidStr = uid ? String(uid) : null;
                    if (uidStr && (legacy.screen_name || user.screen_name || user.core?.screen_name)) {
                        if (!usersIdx[uidStr]) {
                            usersIdx[uidStr] = legacy;
                        }
                    }
                }
            }
            
            console.log(`✅ Extracted ${tweets.length} tweets for ${type}`);
            if (tweets.length === 0) {
                showWarning(container, `No ${type} found for this tweet.`);
                return;
            }
            
            // Limit results to requested count
            if (tweets.length > count) {
                tweets = tweets.slice(0, count);
                console.log(`📊 Limited ${type} results to ${count} tweets (API returned ${tweets.length} total)`);
            }
            
            displayTweets(tweets, container, type.charAt(0).toUpperCase() + type.slice(1), { usersIndex: usersIdx });
        }
    } catch (error) {
        console.error(`❌ Error fetching ${type}:`, error);
        showError(container, error.message);
    }
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
  const seenIds = new Set(); // Track IDs to avoid duplicates
  
  console.log('🔍 Extracting communities from response with keys:', Object.keys(json || {}));

  const pushNorm = (raw, context = '') => {
    if (!raw) return;
    const r = raw.community || raw.community_results?.result || raw.result || raw;
    if (!r || typeof r !== 'object') return;
    
    // Skip community rules - they have __typename === 'CommunityRule' or are in a rules array
    if (r.__typename === 'CommunityRule' || context === 'rules') {
      return;
    }
    
    // Try multiple ID paths - must be numeric
    const idRaw = r.community_id || r.rest_id || r.id_str || r.id || r.object_id;
    const id = idRaw ? String(idRaw).trim() : '';
    // Only accept numeric IDs
    if (id && !/^\d+$/.test(id)) {
      return;
    }
    
    // Skip if we've already seen this ID
    if (id && seenIds.has(id)) {
      return;
    }
    
    // Must be an actual community
    // Priority 1: Has __typename === 'Community' (definite community)
    // Priority 2: From communities_search_slice context (we know these are communities from the API structure)
    // Priority 3: Has description AND (member_count or access field) - communities have these, rules don't
    const isActualCommunity = 
      r.__typename === 'Community' || 
      context === 'communities_search_slice' ||
      (context && r.description && (r.member_count !== undefined || r.members_count !== undefined || r.access));
    
    // In contexts other than communities_search_slice, be very strict
    if (!isActualCommunity) {
      if (context === 'deepscan') {
        // Deep scan: only accept if __typename === 'Community'
        if (r.__typename !== 'Community') {
          return;
        }
      } else if (context && context !== 'communities_search_slice') {
        // Other contexts: must have __typename === 'Community' or clear community indicators
        if (r.__typename !== 'Community' && !(r.description && (r.member_count !== undefined || r.access))) {
          return;
        }
      } else if (!context) {
        // No context: must be explicit
        if (r.__typename !== 'Community') {
          return;
        }
      } else {
        // Not a community
        return;
      }
    }
    
    const name = r.name || r.community_name || r.display_name || r.topic || r.title || 'Community';
    
    // Filter out common rule names that might slip through (with or without trailing punctuation)
    const ruleNames = [
      'Explore and share',
      'Keep posts on topic',
      'Keep Tweets on topic',
      'Be kind and respectful',
      'No spam',
      'No self-promotion',
      'Turn on notifications',
      'Turn on Notifications',
      "Don't spread",
      "Keep tweets",
      'Stay on topic',
      'Provide English',
      'No Rage',
      'No Politics',
      'No Racism',
      'No Nude',
      'Must Be',
      'Report any',
      "Don't be",
      "Don't ask",
      'No doxxing',
      'No hate',
      'Keep tweets related',
      'Skor tahmin',
      'Sorduğunuz',
      'Her türlü',
      'Kışkırtıcı',
      'Reklam',
      'Küfür',
      'Tweetlerde',
      'Siyasetle',
      'FM dışı',
      'Publikuj',
      'Komunikuj',
      'Pomagaj',
      'Bez spamu',
      'Legit check',
      'Cringe',
      'No unapproved',
      'No Hudl',
      'No Sexually',
      'No unapproved soliciting',
      'No quote tweeting',
      'No sensitive media',
      'No Nude or Sexual',
      'Must Be an Ohio State Fan',
      'College Football',
      'No Hudl Self Promotion',
      'Report any posts',
      'No Sexually Explicit',
      'Quoted tweet has been removed',
      "Don't spread misinformation",
      'No self-promotion or cross-posting',
      'DM mods about hidden tweets',
      "Don't spam unnecessary tweets",
      "Don't ask for money",
      'No doxxing or impersonation',
      'Keep tweets related to KSI',
      'No hate or negativity',
      'Tweetlerde konuyla alakasız',
      'Siyasetle alakalı paylaşım yasaktır',
      'FM dışı konularla alakalı',
      'Skor tahmin gönderileri paylaşmak yasaktır',
      'Sorduğunuz sorunun cevabını almışsanız gizliyoruz',
      'Her türlü illegal içerik',
      'Kışkırtıcı paylaşımlar yasaktır',
      'Spam yapmayın',
      'Reklam yapmak yasaktır',
      'Küfür, hakaret, aşağılayıcı söz',
      'Publikuj wpisy na temat',
      'Komunikuj się życzliwie',
      'Pomagaj innym',
      'Bez spamu',
      'Legit check',
      'Platform Manipulation',
      'No Unnecessary Negative Posts',
      "Don't Spread Misinformation",
      'No Spam Or Self-Promotion',
      'Keep Tweets On Topic',
      'Be Kind And Respectful',
      'Welcome All Arsenal Fans'
    ];
    
    // Check if name matches any rule name (case-insensitive, with optional trailing punctuation)
    const nameLower = name.toLowerCase().replace(/[.!?]+$/, '').trim();
    if (ruleNames.some(rule => nameLower === rule.toLowerCase() || nameLower.startsWith(rule.toLowerCase() + ' '))) {
      console.log(`  ⚠️ Skipping rule: "${name}"`);
      return;
    }
    
    // Additional check: if name is very short and doesn't look like a community name, skip it
    if (name.length < 3 || name === 'Community') {
      return;
    }
    
    const desc = r.description || r.summary || r.bio || '';
    const members =
      r.member_count ?? r.members_count ?? r.stats?.member_count ?? r.members ?? 0;
    const avatar =
      r.avatar?.image_url || 
      r.avatar_image?.image_url || 
      r.profile_image_url_https ||
      r.profile_image_url ||
      '';

    // Only add if it has an ID and looks like a real community
    if (id && name && name !== 'Community') {
      seenIds.add(id);
      out.push({ id, name, desc, members, avatar });
      console.log(`  ✓ Added community: "${name}" (ID: ${id})`);
    }
  };

  // 1) PRIORITY: communities_search_slice.items (the main search results structure)
  const searchSlice = json?.result?.communities_search_slice?.items;
  if (Array.isArray(searchSlice) && searchSlice.length > 0) {
    console.log(`📋 Found ${searchSlice.length} items in communities_search_slice.items`);
    for (const item of searchSlice) {
      // Each item structure: { rest_id: "...", result: { __typename: "Community", ... } }
      if (item.result && item.result.__typename === 'Community') {
        // This is definitely a community
        pushNorm(item.result, 'communities_search_slice');
      } else if (item.rest_id && item.result && typeof item.result === 'object') {
        // Has rest_id and result object - likely a community
        // But double-check it's not a rule by checking if it has description (communities usually do)
        if (item.result.description || item.result.member_count !== undefined) {
          pushNorm(item.result, 'communities_search_slice');
        }
      }
    }
    console.log(`✅ Extracted ${out.length} communities from search slice`);
  }

  // 2) Direct arrays at root level
  const direct = json?.result?.communities || json?.communities || json?.list || json?.data?.communities;
  if (Array.isArray(direct) && direct.length > 0) {
    console.log(`📋 Found ${direct.length} communities in direct array`);
    direct.forEach(item => pushNorm(item, 'direct'));
  }

  // 3) Timeline instructions
  const ins = json?.result?.timeline?.instructions || [];
  if (ins.length > 0) {
    console.log(`📋 Found ${ins.length} timeline instructions`);
    for (const i of ins) {
      const es = i.entries || i.addEntries || i.moduleItems || [];
      for (const e of es) {
        if (!e || typeof e !== 'object') continue;
        const c1 = e?.content?.itemContent?.community_results?.result;
        const c2 = e?.content?.itemContent?.community;
        const c3 = e?.content?.community_results?.result;
        const c4 = e?.content?.community;
        const c5 = e?.community_results?.result;
        const c6 = e?.community;
        [c1, c2, c3, c4, c5, c6].forEach(c => pushNorm(c, 'timeline'));
      }
    }
  }

  // 4) Check for communities in data.result structure (but skip if we already found some)
  if (!out.length && json?.result) {
    console.log('🔍 Checking result structure...');
    // Try various result paths
    const resultPaths = [
      json.result.communities,
      json.result.data?.communities,
      json.result.community,
      json.result.community_results?.result,
    ];
    for (const path of resultPaths) {
      if (Array.isArray(path)) {
        console.log(`📋 Found ${path.length} communities in result path`);
        path.forEach(item => pushNorm(item, 'result'));
      } else if (path && typeof path === 'object') {
        pushNorm(path, 'result');
      }
    }
  }

  // 5) Deep scan for obvious arrays of communities (only if we haven't found any yet)
  if (!out.length) {
    console.log('🔍 Using deep scan for communities...');
    const stack = [json];
    const visited = new WeakSet();
    while (stack.length && out.length < 100) { // Limit to prevent infinite loops
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object' || visited.has(cur)) continue;
      visited.add(cur);
      
      // Only accept objects with __typename === 'Community'
      if (cur.__typename === 'Community' && cur.rest_id && /^\d+$/.test(String(cur.rest_id))) {
        pushNorm(cur, 'deepscan');
      }
      
      // Walk children, but skip rules arrays
      for (const [key, v] of Object.entries(cur)) {
        if (key === 'rules' && Array.isArray(v)) {
          // Skip rules - they're not communities
          continue;
        }
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item && typeof item === 'object' && !visited.has(item)) {
              stack.push(item);
            }
          }
        } else if (v && typeof v === 'object' && !visited.has(v)) {
          stack.push(v);
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
  if (!node || typeof node !== 'object') {
    return { id: '', name: 'Untitled list', description: 'No description', memberCount: 0, subscriberCount: 0, ownerHandle: '', ownerName: '' };
  }

  // Extract ID - check object_id first (common in search-lists response)
  let id = '';
  if (node.object_id) {
    id = String(node.object_id).trim();
  } else if (node.url && typeof node.url === 'string') {
    // Extract ID from URL like "x.com/i/lists/76314257" or "twitter.com/i/lists/76314257"
    const match = node.url.match(/lists\/(\d+)/);
    if (match) id = match[1];
  }
  
  // Fallback to other ID fields
  if (!id) {
    id =
      node.id_str ||
      node.rest_id ||
      node.list_id ||
      node.id ||
      node.legacy?.id_str ||
      node.legacy?.id ||
      dget(node, 'id_str') ||
      dget(node, 'rest_id') ||
      dget(node, 'list_id') ||
      dget(node, 'id') ||
      dget(node, 'legacy.id_str') ||
      String(node.id || '').trim() ||
      '';
  }

  // Extract name - check topic first (common in search-lists response)
  let name = '';
  if (node.topic && typeof node.topic === 'string') {
    name = node.topic;
  } else {
    name =
      node.name ||
      node.title ||
      node.legacy?.name ||
      node.legacy?.title ||
      dget(node, 'name') ||
      dget(node, 'title') ||
      dget(node, 'legacy.name') ||
      dget(node, 'legacy.title') ||
      '';
  }

  // Extract description from result_contexts or other fields
  let description = '';
  if (node.result_contexts && Array.isArray(node.result_contexts) && node.result_contexts.length > 0) {
    // result_contexts might contain description
    const context = node.result_contexts[0];
    description = context.description || context.text || context.summary || '';
  }
  
  if (!description) {
    description =
      node.description ||
      node.summary ||
      node.legacy?.description ||
      node.legacy?.summary ||
      dget(node, 'description') ||
      dget(node, 'summary') ||
      dget(node, 'legacy.description') ||
      dget(node, 'legacy.summary') ||
      '';
  }

  // Extract member count from facepile_urls length or other fields
  let memberCount = 0;
  if (node.facepile_urls && Array.isArray(node.facepile_urls)) {
    memberCount = node.facepile_urls.length;
  }
  
  if (!memberCount) {
    memberCount =
      node.member_count ||
      node.members_count ||
      node.legacy?.member_count ||
      node.legacy?.members_count ||
      dget(node, 'member_count') ||
      dget(node, 'members_count') ||
      dget(node, 'legacy.member_count') ||
      dget(node, 'legacy.members_count') ||
      0;
  }

  const subscriberCount =
    node.subscriber_count ||
    node.subscribers_count ||
    node.legacy?.subscriber_count ||
    node.legacy?.subscribers_count ||
    dget(node, 'subscriber_count') ||
    dget(node, 'subscribers_count') ||
    dget(node, 'legacy.subscriber_count') ||
    dget(node, 'legacy.subscribers_count') ||
    0;

  // Try to resolve owner - check multiple paths
  const owner =
    node.user ||
    node.owner ||
    node.legacy?.user ||
    node.legacy?.owner ||
    node.user_results?.result ||
    node.owner_results?.result ||
    dget(node, 'user') ||
    dget(node, 'owner') ||
    dget(node, 'legacy.user') ||
    dget(node, 'legacy.owner') ||
    dget(node, 'user_results.result') ||
    dget(node, 'owner_results.result') ||
    {};

  const ownerLegacy = owner?.legacy || owner || {};
  const ownerHandle = ownerLegacy?.screen_name || owner?.screen_name || '';
  const ownerName = ownerLegacy?.name || owner?.name || '';

  return {
    id: String(id).trim(),
    name: String(name).trim() || 'Untitled list',
    description: String(description).trim() || 'No description',
    memberCount: Number(memberCount) || 0,
    subscriberCount: Number(subscriberCount) || 0,
    ownerHandle: String(ownerHandle).trim(),
    ownerName: String(ownerName).trim()
  };
}

// DFS to find list-like objects anywhere in a payload
function extractListsFromResponse(payload) {
  const lists = [];
  const seen = new Set();

  // Priority 1: Direct arrays at root level (most common for /search-lists)
  const directLists = payload?.lists || payload?.result?.lists || payload?.result?.data?.lists;
  if (Array.isArray(directLists) && directLists.length > 0) {
    console.log(`📋 Found ${directLists.length} lists in direct array`);
    // Log first item structure for debugging
    if (directLists[0]) {
      console.log('📋 Sample list item keys:', Object.keys(directLists[0]));
      console.log('📋 Sample list item:', JSON.stringify(directLists[0]).substring(0, 500));
    }
    for (const item of directLists) {
      if (!item || typeof item !== 'object') continue;
      // Try to normalize directly - might be wrapped in list/list_results/result
      const node = item.list || item.list_results?.result || item.result || item;
      const norm = normalizeList(node);
      // Use ID if available, otherwise use index-based key or name
      const key = norm.id || norm.name || `list-${lists.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Accept lists with name or ID (don't require both)
        if (norm.name && norm.name !== 'Untitled list') {
          lists.push(norm);
          console.log(`  ✓ Added list: "${norm.name}" (ID: ${norm.id || 'none'})`);
        } else if (norm.id) {
          lists.push(norm);
          console.log(`  ✓ Added list: ID ${norm.id} (name: ${norm.name || 'none'})`);
        } else {
          console.log(`  ✗ Skipped list: no name or ID`, norm);
        }
      }
    }
    // If we found lists in direct array, return early (most reliable)
    if (lists.length > 0) {
      console.log(`✅ Extracted ${lists.length} lists from direct array`);
      return lists;
    } else {
      console.log(`⚠️ Found ${directLists.length} items but extracted 0 lists`);
    }
  }

  // Priority 2: Timeline instructions (for list timelines/details)
  const instructions = dget(payload, 'result.timeline.instructions') || [];
  if (instructions.length > 0) {
    console.log(`📋 Found ${instructions.length} timeline instructions`);
    for (const ins of instructions) {
      const entries = ins.entries || ins.addEntries || ins.moduleItems || [];
      for (const e of entries) {
        if (!e || typeof e !== 'object') continue;
        const listNode = dget(e, 'content.itemContent.list') || 
                        dget(e, 'content.itemContent.list_results.result') ||
                        dget(e, 'content.list') ||
                        dget(e, 'list');
        if (listNode) {
          const norm = normalizeList(listNode);
          const key = norm.id || `list-${lists.length}`;
          if (!seen.has(key) && (norm.name !== 'Untitled list' || norm.id)) {
            seen.add(key);
            lists.push(norm);
          }
        }
      }
    }
    if (lists.length > 0) {
      console.log(`✅ Extracted ${lists.length} lists from timeline instructions`);
      return lists;
    }
  }

  // Priority 3: DFS fallback to find list-like objects
  console.log('🔍 Using DFS fallback to find lists...');
  const stack = [payload];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;

    // Candidate: object that looks like a list
    const looksLikeList =
      ('list' in cur) || ('list_id' in cur) || 
      ('member_count' in cur) || ('subscriber_count' in cur) ||
      cur.__typename === 'List' || 
      (cur.entryType === 'TimelineTimelineItem' && dget(cur, 'content.itemContent.list')) ||
      (('name' in cur) && (('member_count' in cur) || ('subscriber_count' in cur)));

    if (looksLikeList) {
      const node = cur.list || cur;
      const norm = normalizeList(node);
      const key = norm.id || `list-${lists.length}`;
      if (!seen.has(key) && (norm.name !== 'Untitled list' || norm.id)) {
        seen.add(key);
        lists.push(norm);
      }
    }

    // Walk children (but skip if we already processed direct arrays)
    for (const k in cur) {
      if (k === 'lists' && Array.isArray(cur[k])) continue; // Already processed
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

  console.log(`✅ Final extracted ${lists.length} lists`);
  return lists;
}

// Render list cards and wire click -> fill list ID + enable actions
function renderLists(container, lists, title = 'Lists') {
  if (!lists || lists.length === 0) {
    container.innerHTML = `<h3>${title}</h3><p>No lists found.</p>`;
    return;
  }

  console.log(`🎨 Rendering ${lists.length} lists`);
  container.innerHTML = `<h3>${title}</h3>` +
    lists.map((lst, idx) => {
      const listId = lst.id || '';
      return `
      <div class="community-card" style="cursor: pointer; margin-bottom: 10px;" data-list-id="${esc(listId)}" data-list-index="${idx}">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          <div style="flex: 1;">
            <strong>${esc(lst.name || 'Untitled list')}</strong>
            ${listId ? `<span class="badge badge-count">ID: ${esc(listId)}</span>` : '<span class="badge badge-count" style="opacity:0.6;">No ID</span>'}
          </div>
        </div>
        <p style="margin: 8px 0; color: #65676b;">${esc(lst.description || 'No description')}</p>
        <div class="tweet-footer">
          <span>👥 ${formatNumber(lst.memberCount || 0)} members</span>
          <span>👀 ${formatNumber(lst.subscriberCount || 0)} subscribers</span>
          ${lst.ownerHandle ? `<span>· by @${esc(lst.ownerHandle)}${lst.ownerName ? ` (${esc(lst.ownerName)})` : ''}</span>` : ''}
        </div>
      </div>
    `;
    }).join('');

  // Add click handlers to list cards
  container.querySelectorAll('[data-list-id]').forEach(card => {
    card.addEventListener('click', () => {
      const listId = card.dataset.listId;
      if (listId) {
        const input = document.getElementById('list-id-input');
        if (input) input.value = listId;
        // Optionally scroll to the actions section
        const detailsBtn = document.getElementById('get-list-details-btn');
        if (detailsBtn) {
          detailsBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else {
        console.warn('⚠️ Clicked list has no ID, cannot auto-fill');
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
    const communityId = btn.dataset.communityId;
    const communityName = btn.dataset.communityName;
    
    if (!communityId) {
        alert(`Community "${communityName}" has no ID and cannot be used for community details. Please select a community with a numeric ID.`);
        return;
    }
    
    setSelectedCommunity({
        id: communityId,
        name: communityName
    });
    console.log(`✅ Selected community: "${communityName}" (ID: ${communityId})`);
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
        console.log(`🎨 Rendering ${list.length} communities`);
        // Render simple cards with a Select button
        container.innerHTML = `<h3>Found ${list.length} communities</h3>` + list.map((c, i) => `
      <div class="community-card" style="margin-bottom:10px;padding:12px;border:1px solid #ddd;border-radius:8px;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${c.avatar ? `<img src="${esc(c.avatar)}" alt="" width="40" height="40" style="border-radius:8px;object-fit:cover">` : ''}
          <div style="flex:1;">
            <strong>${esc(c.name || 'Community')}</strong>
            ${c.id ? `<span class="badge badge-count" style="margin-left:8px;">ID: ${esc(c.id)}</span>` : '<span class="badge" style="margin-left:8px;opacity:0.6;">No ID</span>'}
            ${c.members ? `<div class="tweet-footer" style="margin-top:4px;"><span>👥 ${esc(c.members)} members</span></div>` : ''}
          </div>
          <div>
            <button class="btn-secondary select-community-btn" data-community-id="${esc(c.id || '')}" data-community-name="${esc(c.name || 'Community')}" ${!c.id ? 'style="opacity:0.7;" title="This community has no ID and cannot be used for details"' : ''}>Select</button>
          </div>
        </div>
        ${c.desc ? `<p style="margin-top:8px;color:#666;">${esc(c.desc)}</p>` : ''}
      </div>
    `).join('');
        // Remove old listener if exists, then add new one
        container.removeEventListener('click', handleCommunitySelectClick);
        container.addEventListener('click', handleCommunitySelectClick);
        console.log('✅ Community cards rendered with select handlers');
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
        const mergeIdx = (src) => { 
            for (const [k,v] of Object.entries(src || {})) {
                if (!usersIdx[k]) usersIdx[k] = v;
                // Also store with numeric key if applicable
                const kNum = Number(k);
                if (!isNaN(kNum) && kNum.toString() === k && !usersIdx[kNum]) {
                    usersIdx[kNum] = v;
                }
            }
        };
        for (const id of ids) {
            const tData = await fetchFromAPI('/explore-community-timeline', { topicId: id });
            const idx = buildUsersIndexDeep(tData);
            console.log(`👥 Built users index with ${Object.keys(idx).length} users for topic ${id}`);
            mergeIdx(idx);
            const ts = extractTweetsFromResponse(tData);
            // Extract users from each tweet (important for DFS-found tweets)
            // Also rebuild users index from extracted tweets to catch any missed users
            for (const tweet of ts) {
                const t = tweet?.result || tweet;
                // Try multiple paths to find user in tweet
                const userPaths = [
                    dget(t, 'core.user_results.result'),
                    dget(t, 'user_results.result'),
                    dget(t, 'user'),
                    dget(t, 'legacy.user'),
                    t.core?.user_results?.result,
                    t.user_results?.result,
                    t.user,
                    t.legacy?.user,
                ];
                for (const user of userPaths) {
                    if (!user) continue;
                    const legacy = user.legacy || user;
                    const uid = user.rest_id || legacy.id_str || user.id_str || user.id || legacy.id_str;
                    const uidStr = uid ? String(uid) : null;
                    const screenName = legacy.screen_name || user.screen_name;
                    if (uidStr && screenName) {
                        if (!usersIdx[uidStr]) {
                            usersIdx[uidStr] = legacy;
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
        // Final pass: extract users directly from all extracted tweets (last resort)
        if (Object.keys(usersIdx).length === 0 && allTweets.length > 0) {
            console.log('⚠️ No users in index, doing final extraction from tweets...');
            for (const tweet of allTweets) {
                const t = tweet?.result || tweet;
                // DFS to find any user-like object in the tweet
                const userObj = findFirst(t, o => {
                    if (!o || typeof o !== 'object') return false;
                    return (o.screen_name && (o.id_str || o.rest_id || o.id)) ||
                           (o.legacy && o.legacy.screen_name && (o.legacy.id_str || o.rest_id));
                });
                if (userObj) {
                    const legacy = userObj.legacy || userObj;
                    const uid = userObj.rest_id || legacy.id_str || userObj.id_str || userObj.id;
                    const uidStr = uid ? String(uid) : null;
                    if (uidStr && legacy.screen_name) {
                        if (!usersIdx[uidStr]) {
                            usersIdx[uidStr] = legacy;
                        }
                    }
                }
            }
            console.log(`👥 After final extraction: ${Object.keys(usersIdx).length} users`);
        }
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
        if (!communityId) {
            showWarning(container, 'No community ID found. Please search for a community and select one, or enter a numeric community ID.');
            return;
        }
        const details = await fetchFromAPI('/community-details', { communityId });
        // The response structure is: result.result.name, result.result.member_count, etc.
        const community = dget(details, 'result.result') || dget(details, 'result') || {};
        const name = community.name || 'Community';
        const desc = community.description || '';
        const members = community.member_count || 0;
        const isMember = community.is_member || false;
        const role = community.role || 'NonMember';
        const joinPolicy = community.join_policy || 'Unknown';
        const createdAt = community.created_at;
        const isNSFW = community.is_nsfw || false;
        const primaryTopic = dget(community, 'primary_community_topic.topic_name') || '';
        const creator = dget(community, 'creator_results.result.legacy.screen_name') || '';
        const rules = community.rules || [];
        const customBanner = dget(community, 'custom_banner_media.media_info.original_img_url') || '';
        const defaultBanner = dget(community, 'default_banner_media.media_info.original_img_url') || '';
        const bannerUrl = customBanner || defaultBanner;
        
        // Format created date
        let createdDateStr = '';
        if (createdAt) {
            try {
                const date = new Date(Number(createdAt));
                createdDateStr = date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
            } catch (e) {
                createdDateStr = '';
            }
        }
        
        container.innerHTML = `
      <div class="community-card" style="padding: 16px;">
        ${bannerUrl ? `<img src="${esc(bannerUrl)}" alt="Community banner" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px; margin-bottom: 16px;">` : ''}
        <h3 style="margin: 0 0 8px 0;">${esc(name)} <small style="opacity:.7; font-weight: normal;">(${esc(communityId)})</small></h3>
        ${desc ? `<p style="color: #65676b; margin: 8px 0;">${esc(desc)}</p>` : ''}
        <div class="tweet-footer" style="margin: 12px 0;">
          <span>👥 ${formatNumber(members)} members</span>
          ${primaryTopic ? `<span>🏷️ ${esc(primaryTopic)}</span>` : ''}
          ${isNSFW ? '<span style="color: #e0245e;">🔞 NSFW</span>' : ''}
          ${isMember ? `<span style="color: #1da1f2;">✓ Member</span>` : `<span style="color: #657786;">Not a member</span>`}
        </div>
        <div style="margin: 12px 0; padding: 12px; background: #f7f9fa; border-radius: 8px;">
          <div style="margin-bottom: 8px;"><strong>Join Policy:</strong> ${esc(joinPolicy)}</div>
          ${creator ? `<div style="margin-bottom: 8px;"><strong>Creator:</strong> @${esc(creator)}</div>` : ''}
          ${createdDateStr ? `<div style="margin-bottom: 8px;"><strong>Created:</strong> ${esc(createdDateStr)}</div>` : ''}
          ${role ? `<div><strong>Your Role:</strong> ${esc(role)}</div>` : ''}
        </div>
        ${rules.length > 0 ? `
          <div style="margin: 12px 0;">
            <strong style="display: block; margin-bottom: 8px;">Community Rules (${rules.length}):</strong>
            <ul style="margin: 0; padding-left: 20px; color: #65676b;">
              ${rules.map(rule => `<li>${esc(rule.name || 'Unnamed rule')}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        <details style="margin-top:16px;">
          <summary style="cursor: pointer; color: #1da1f2; user-select: none;">📋 View Raw JSON</summary>
          <pre class="json-dump" style="margin-top: 8px; max-height: 400px; overflow: auto; background: #f7f9fa; padding: 12px; border-radius: 4px; font-size: 12px;">${esc(JSON.stringify(details, null, 2))}</pre>
        </details>
      </div>
    `;
    } catch (err) {
        console.error('Community details error:', err);
        const errorMsg = err.message || 'Could not load community details.';
        showError(container, errorMsg);
    }
});

document.getElementById('get-community-tweets-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId) {
            showWarning(container, 'No community ID found. Please search for a community and select one, or enter a numeric community ID.');
            return;
        }
        const data = await fetchFromAPI('/community-tweets', { communityId, searchType: 'Default', rankingMode: 'Relevance', count: 20 });
        console.log('📊 Community tweets response:', Object.keys(data || {}));
        const usersIdx = buildUsersIndexDeep(data);
        console.log(`👥 Built users index with ${Object.keys(usersIdx).length} users`);
        const tweets = extractTweetsFromResponse(data);
        console.log(`📝 Extracted ${tweets.length} tweets`);
        // Also extract users from tweets themselves
        for (const tweet of tweets) {
            const t = tweet?.result || tweet;
            const userPaths = [
                dget(t, 'core.user_results.result'),
                dget(t, 'user_results.result'),
                dget(t, 'user'),
                dget(t, 'legacy.user'),
                t.core?.user_results?.result,
                t.user_results?.result,
                t.user,
                t.legacy?.user,
            ];
            for (const user of userPaths) {
                if (!user) continue;
                const legacy = user.legacy || user;
                const uid = user.rest_id || legacy.id_str || user.id_str || user.id;
                const uidStr = uid ? String(uid) : null;
                if (uidStr && (legacy.screen_name || user.screen_name)) {
                    if (!usersIdx[uidStr]) {
                        usersIdx[uidStr] = legacy;
                        const uidNum = Number(uidStr);
                        if (!isNaN(uidNum) && uidNum.toString() === uidStr && !usersIdx[uidNum]) {
                            usersIdx[uidNum] = legacy;
                        }
                    }
                }
            }
        }
        console.log(`👥 Final users index: ${Object.keys(usersIdx).length} users`);
        displayTweets(tweets, container, 'Community Tweets', { usersIndex: usersIdx });
    } catch (err) {
        console.error('Community tweets error:', err);
        const errorMsg = err.message || 'Could not load community tweets.';
        showError(container, errorMsg);
    }
});

document.getElementById('get-community-members-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId) {
            showWarning(container, 'No community ID found. Please search for a community and select one, or enter a numeric community ID.');
            return;
        }
        const data = await fetchFromAPI('/community-members', { communityId });
        console.log('📊 Community members response:', Object.keys(data || {}));
        
        // Extract users from timeline instructions (primary method for members)
        const instructions = dget(data, 'result.timeline.instructions') || [];
        console.log(`📋 Found ${instructions.length} timeline instructions`);
        const users = [];
        const seenUserIds = new Set();
        
        // Extract from timeline instructions - this is the main source for members
        for (const ins of instructions) {
            if (!ins || typeof ins !== 'object') continue;
            // Check all instruction types, not just TimelineAddEntries
            const entries = ins.entries || ins.addEntries || ins.moduleItems || [];
            for (const e of entries) {
                if (!e || typeof e !== 'object') continue;
                // Check for timeline modules with user items (for members/moderators)
                if (e.content?.entryType === 'TimelineTimelineModule' && e.content.items) {
                    for (const item of e.content.items) {
                        if (!item || typeof item !== 'object') continue;
                        // Try multiple paths to get user from item
                        const user = dget(item, 'item.itemContent.user_results.result') || 
                                   dget(item, 'itemContent.user_results.result') ||
                                   item.item?.itemContent?.user_results?.result ||
                                   item.itemContent?.user_results?.result;
                        if (user && typeof user === 'object') {
                            // Get legacy - it might be nested or direct
                            const legacy = user.legacy || user;
                            const uid = user.rest_id || legacy.id_str || user.id || legacy.id;
                            const uidStr = uid ? String(uid) : null;
                            const screenName = legacy.screen_name || user.screen_name;
                            if (uidStr && screenName && !seenUserIds.has(uidStr)) {
                                seenUserIds.add(uidStr);
                                users.push({
                                    rest_id: uidStr,
                                    legacy: legacy,
                                    user: user // Keep full user object
                                });
                            }
                        }
                    }
                }
                // Also check direct user results in entries (for other structures)
                const userPaths = [
                    dget(e, 'content.itemContent.user_results.result'),
                    e.content?.itemContent?.user_results?.result,
                ];
                for (const ur of userPaths) {
                    if (!ur || typeof ur !== 'object') continue;
                    const legacy = ur.legacy || ur;
                    const uid = ur.rest_id || legacy.id_str || ur.id || legacy.id;
                    const uidStr = uid ? String(uid) : null;
                    const screenName = legacy.screen_name || ur.screen_name;
                    if (uidStr && screenName && !seenUserIds.has(uidStr)) {
                        seenUserIds.add(uidStr);
                        users.push({
                            rest_id: uidStr,
                            legacy: legacy,
                            user: ur
                        });
                    }
                }
            }
        }
        
        // Fallback: use buildUsersIndexDeep if no users found
        if (users.length === 0) {
            console.log('⚠️ No users from timeline, trying buildUsersIndexDeep...');
            const usersIdx = buildUsersIndexDeep(data);
            console.log(`👥 Built users index with ${Object.keys(usersIdx).length} users`);
            // buildUsersIndexDeep stores legacy objects directly
            for (const [uid, legacyObj] of Object.entries(usersIdx)) {
                if (!legacyObj || typeof legacyObj !== 'object') continue;
                // legacyObj is already the legacy object from buildUsersIndexDeep
                const legacy = legacyObj.legacy || legacyObj;
                const screenName = legacy.screen_name || legacyObj.screen_name;
                if (screenName && !seenUserIds.has(uid)) {
                    seenUserIds.add(uid);
                    users.push({
                        rest_id: uid,
                        legacy: legacy,
                        user: { rest_id: uid, legacy: legacy }
                    });
                }
            }
        }
        
        console.log(`✅ Extracted ${users.length} members`);
        if (users.length === 0) {
            showWarning(container, 'No members found. The community might be private or have no members.');
            return;
        }
        displayUsers(users, container, `Community Members (${users.length})`);
    } catch (err) {
        console.error('Community members error:', err);
        const errorMsg = err.message || 'Could not load community members.';
        showError(container, errorMsg);
    }
});

document.getElementById('get-community-moderators-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId) {
            showWarning(container, 'No community ID found. Please search for a community and select one, or enter a numeric community ID.');
            return;
        }
        const data = await fetchFromAPI('/community-moderators', { communityId });
        console.log('📊 Community moderators response:', Object.keys(data || {}));
        
        // Extract users from timeline instructions (primary method for moderators)
        const instructions = dget(data, 'result.timeline.instructions') || [];
        console.log(`📋 Found ${instructions.length} timeline instructions`);
        const users = [];
        const seenUserIds = new Set();
        
        // Extract from timeline instructions - this is the main source for moderators
        for (const ins of instructions) {
            if (!ins || typeof ins !== 'object') continue;
            // Check all instruction types, not just TimelineAddEntries
            const entries = ins.entries || ins.addEntries || ins.moduleItems || [];
            for (const e of entries) {
                if (!e || typeof e !== 'object') continue;
                // Check for timeline modules with user items (for moderators)
                if (e.content?.entryType === 'TimelineTimelineModule' && e.content.items) {
                    for (const item of e.content.items) {
                        if (!item || typeof item !== 'object') continue;
                        // Try multiple paths to get user from item
                        const user = dget(item, 'item.itemContent.user_results.result') || 
                                   dget(item, 'itemContent.user_results.result') ||
                                   item.item?.itemContent?.user_results?.result ||
                                   item.itemContent?.user_results?.result;
                        if (user && typeof user === 'object') {
                            // Get legacy - it might be nested or direct
                            const legacy = user.legacy || user;
                            const uid = user.rest_id || legacy.id_str || user.id || legacy.id;
                            const uidStr = uid ? String(uid) : null;
                            const screenName = legacy.screen_name || user.screen_name;
                            if (uidStr && screenName && !seenUserIds.has(uidStr)) {
                                seenUserIds.add(uidStr);
                                users.push({
                                    rest_id: uidStr,
                                    legacy: legacy,
                                    user: user // Keep full user object
                                });
                            }
                        }
                    }
                }
                // Also check direct user results in entries (for other structures)
                const userPaths = [
                    dget(e, 'content.itemContent.user_results.result'),
                    e.content?.itemContent?.user_results?.result,
                ];
                for (const ur of userPaths) {
                    if (!ur || typeof ur !== 'object') continue;
                    const legacy = ur.legacy || ur;
                    const uid = ur.rest_id || legacy.id_str || ur.id || legacy.id;
                    const uidStr = uid ? String(uid) : null;
                    const screenName = legacy.screen_name || ur.screen_name;
                    if (uidStr && screenName && !seenUserIds.has(uidStr)) {
                        seenUserIds.add(uidStr);
                        users.push({
                            rest_id: uidStr,
                            legacy: legacy,
                            user: ur
                        });
                    }
                }
            }
        }
        
        // Fallback: use buildUsersIndexDeep if no users found
        if (users.length === 0) {
            console.log('⚠️ No users from timeline, trying buildUsersIndexDeep...');
            const usersIdx = buildUsersIndexDeep(data);
            console.log(`👥 Built users index with ${Object.keys(usersIdx).length} users`);
            // buildUsersIndexDeep stores legacy objects directly
            for (const [uid, legacyObj] of Object.entries(usersIdx)) {
                if (!legacyObj || typeof legacyObj !== 'object') continue;
                // legacyObj is already the legacy object from buildUsersIndexDeep
                const legacy = legacyObj.legacy || legacyObj;
                const screenName = legacy.screen_name || legacyObj.screen_name;
                if (screenName && !seenUserIds.has(uid)) {
                    seenUserIds.add(uid);
                    users.push({
                        rest_id: uid,
                        legacy: legacy,
                        user: { rest_id: uid, legacy: legacy }
                    });
                }
            }
        }
        
        console.log(`✅ Extracted ${users.length} moderators`);
        if (users.length === 0) {
            showWarning(container, 'No moderators found. The community might not have moderators or the data is not available.');
            return;
        }
        displayUsers(users, container, `Community Moderators (${users.length})`);
    } catch (err) {
        console.error('Community moderators error:', err);
        const errorMsg = err.message || 'Could not load community moderators.';
        showError(container, errorMsg);
    }
});

document.getElementById('get-community-about-btn').addEventListener('click', async () => {
    const container = document.getElementById('community-results');
    showLoading(container);
    try {
        const communityId = await getCommunityIdOrResolve();
        if (!communityId) {
            showWarning(container, 'No community ID found. Please search for a community and select one, or enter a numeric community ID.');
            return;
        }
        const data = await fetchFromAPI('/community-about', { communityId });
        console.log('📊 Community about response:', Object.keys(data || {}));
        
        // The About endpoint returns timeline instructions with moderators and members
        const instructions = dget(data, 'result.timeline.instructions') || [];
        const moderators = [];
        const members = [];
        
        // Extract moderators and members from timeline instructions
        for (const ins of instructions) {
            if (ins.type === 'TimelineAddEntries' && ins.entries) {
                for (const entry of ins.entries) {
                    if (entry.entryId === 'communityModerators' && entry.content?.items) {
                        for (const item of entry.content.items) {
                            const user = dget(item, 'item.itemContent.user_results.result');
                            if (user && user.legacy) {
                                moderators.push({
                                    rest_id: user.rest_id || user.legacy.id_str || user.id,
                                    legacy: user.legacy
                                });
                            }
                        }
                    } else if (entry.entryId === 'communityMembers' && entry.content?.items) {
                        for (const item of entry.content.items) {
                            const user = dget(item, 'item.itemContent.user_results.result');
                            if (user && user.legacy) {
                                members.push({
                                    rest_id: user.rest_id || user.legacy.id_str || user.id,
                                    legacy: user.legacy
                                });
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`👥 Extracted ${moderators.length} moderators and ${members.length} members from About`);
        
        // Display formatted information
        let html = `<div class="community-card" style="padding: 16px;">`;
        html += `<h3 style="margin: 0 0 16px 0;">About Community <small style="opacity:.7; font-weight: normal;">(${esc(communityId)})</small></h3>`;
        
        if (moderators.length > 0) {
            html += `<div style="margin-bottom: 24px;">`;
            html += `<h4 style="margin: 0 0 12px 0; color: #1da1f2;">👮 Moderators (${moderators.length})</h4>`;
            html += `<div style="display: grid; gap: 12px;">`;
            for (const mod of moderators) {
                const legacy = mod.legacy || {};
                html += `<div class="user-card" style="padding: 12px; border: 1px solid #e1e8ed; border-radius: 8px;">`;
                html += `<div style="display: flex; align-items: center; gap: 12px;">`;
                if (legacy.profile_image_url_https) {
                    html += `<img src="${esc(legacy.profile_image_url_https)}" alt="" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">`;
                }
                html += `<div style="flex: 1;">`;
                html += `<strong>@${esc(legacy.screen_name || 'unknown')}</strong> ${legacy.verified ? '<span class="badge badge-verified">✓</span>' : ''}`;
                html += `<div style="color: #657786; font-size: 14px; margin-top: 4px;">${esc(legacy.name || '')}</div>`;
                if (legacy.description) {
                    html += `<div style="color: #657786; font-size: 13px; margin-top: 4px;">${esc(legacy.description)}</div>`;
                }
                html += `<div class="tweet-footer" style="margin-top: 8px;">`;
                html += `<span>👥 ${formatNumber(legacy.followers_count || 0)} followers</span>`;
                html += `<span>📝 ${formatNumber(legacy.statuses_count || 0)} tweets</span>`;
                html += `</div>`;
                html += `</div>`;
                html += `</div>`;
                html += `</div>`;
            }
            html += `</div>`;
            html += `</div>`;
        }
        
        if (members.length > 0) {
            html += `<div style="margin-bottom: 24px;">`;
            html += `<h4 style="margin: 0 0 12px 0; color: #1da1f2;">👥 Members (${members.length})</h4>`;
            html += `<div style="display: grid; gap: 12px;">`;
            for (const mem of members.slice(0, 20)) { // Show first 20 members
                const legacy = mem.legacy || {};
                html += `<div class="user-card" style="padding: 12px; border: 1px solid #e1e8ed; border-radius: 8px;">`;
                html += `<div style="display: flex; align-items: center; gap: 12px;">`;
                if (legacy.profile_image_url_https) {
                    html += `<img src="${esc(legacy.profile_image_url_https)}" alt="" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover;">`;
                }
                html += `<div style="flex: 1;">`;
                html += `<strong>@${esc(legacy.screen_name || 'unknown')}</strong> ${legacy.verified ? '<span class="badge badge-verified">✓</span>' : ''}`;
                html += `<div style="color: #657786; font-size: 14px; margin-top: 4px;">${esc(legacy.name || '')}</div>`;
                if (legacy.description) {
                    html += `<div style="color: #657786; font-size: 13px; margin-top: 4px;">${esc(legacy.description)}</div>`;
                }
                html += `<div class="tweet-footer" style="margin-top: 8px;">`;
                html += `<span>👥 ${formatNumber(legacy.followers_count || 0)} followers</span>`;
                html += `<span>📝 ${formatNumber(legacy.statuses_count || 0)} tweets</span>`;
                html += `</div>`;
                html += `</div>`;
                html += `</div>`;
                html += `</div>`;
            }
            if (members.length > 20) {
                html += `<p style="color: #657786; margin-top: 12px;">... and ${members.length - 20} more members</p>`;
            }
            html += `</div>`;
            html += `</div>`;
        }
        
        if (moderators.length === 0 && members.length === 0) {
            html += `<p style="color: #657786;">No moderators or members data available.</p>`;
        }
        
        html += `<details style="margin-top:16px;">`;
        html += `<summary style="cursor: pointer; color: #1da1f2; user-select: none;">📋 View Raw JSON</summary>`;
        html += `<pre class="json-dump" style="margin-top: 8px; max-height: 400px; overflow: auto; background: #f7f9fa; padding: 12px; border-radius: 4px; font-size: 12px;">${esc(JSON.stringify(data, null, 2))}</pre>`;
        html += `</details>`;
        html += `</div>`;
        
        container.innerHTML = html;
    } catch (err) {
        console.error('Community about error:', err);
        const errorMsg = err.message || 'Could not load community about.';
        showError(container, errorMsg);
    }
});

async function doExplore(query, type = 'Top', count = 20, container) {
  try {
    // Ensure count is a number and at least 1
    const countNum = Math.max(1, parseInt(count, 10) || 20);
    console.log(`🔍 Searching with count: ${countNum} (original: ${count}, type: ${typeof count})`);
    
    let data = await fetchFromAPI('/search-v2', { query, type, count: countNum });
    if (type === 'People') {
      let users = extractUsersFromSearch(data);
      if (!users.length) {
        data = await fetchFromAPI('/search', { query, type, count: countNum });
        users = extractUsersFromSearch(data);
      }
      displayUsers(users, container, `People for "${query}"`);
      return;
    }
    let tweets = extractTweetsFromSearchV2(data);
    let usersIndex = buildUsersIndex(data);
    console.log(`✅ Extracted ${tweets.length} tweets from /search-v2`);
    
    if (!tweets.length) {
      console.log('⚠️ No tweets from /search-v2, trying /search fallback...');
      data = await fetchFromAPI('/search', { query, type, count: countNum });
      tweets = extractTweetsFromSearchV2(data);
      if (!tweets.length) tweets = extractTweetsLegacy(data);
      console.log(`✅ Extracted ${tweets.length} tweets from /search fallback`);
      usersIndex = Object.keys(usersIndex).length ? usersIndex : buildUsersIndex(data);
    }
    
    if (!tweets.length) {
      showWarning(container, 'No results found for this query.');
      return;
    }
    
    // Limit results to the requested count (API might return more)
    if (tweets.length > countNum) {
      tweets = tweets.slice(0, countNum);
      console.log(`📊 Limited results to ${countNum} tweets (API returned ${tweets.length})`);
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
                    ${trend.url ? `<br><a href="${trend.url}" target="_blank" style="color: #1da1f2;">View on X →</a>` : ''}
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
    const handle = legacy.screen_name || u.screen_name;
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
      if (!e || typeof e !== 'object') continue;
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
      // Also extract from the entry itself (for DFS-found tweets)
      const tweetNode = dget(e, 'content.itemContent.tweet_results.result') || 
                       dget(e, 'content.itemContent.tweet_results') ||
                       dget(e, 'content.itemContent.tweet');
      if (tweetNode) {
        const tweetUser = dget(tweetNode, 'core.user_results.result');
        if (tweetUser) push(tweetUser);
        // Also try to extract user from the tweet node itself
        if (tweetNode.core?.user_results?.result) push(tweetNode.core.user_results.result);
      }
      // DFS through the entry to find any user-like objects
      const entryUser = findFirst(e, o => {
        if (!o || typeof o !== 'object') return false;
        return (o.screen_name && (o.id_str || o.rest_id || o.id)) ||
               (o.legacy && o.legacy.screen_name && (o.legacy.id_str || o.rest_id));
      });
      if (entryUser) push(entryUser);
    }
  }
  
  // Legacy/alt: globalObjects.users
  const go = dget(json, 'globalObjects.users');
  if (go) {
    for (const [id, u] of Object.entries(go)) {
      push(u);
    }
  }
  
  // DFS fallback to catch users in any nesting - be more aggressive
  const stack = [json];
  const visited = new WeakSet();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || visited.has(cur)) continue;
    if (cur !== json) visited.add(cur);
    
    // Check if this object looks like a user
    if (cur.screen_name || (cur.legacy && cur.legacy.screen_name)) {
      push(cur);
    }
    
    // Common user locations
    push(cur?.core?.user_results?.result);
    push(cur?.user_results?.result);
    push(cur?.user);
    push(cur?.owner);
    
    // Check legacy objects
    if (cur.legacy && cur.legacy.screen_name) {
      push(cur);
    }
    
    if (Array.isArray(cur?.users)) {
      for (const u of cur.users) push(u?.legacy || u);
    }
    if (cur?.result?.users) {
      const ru = cur.result.users;
      if (Array.isArray(ru)) for (const u of ru) push(u?.legacy || u);
      else for (const u of Object.values(ru)) push(u);
    }
    
    // Walk children
    for (const v of Object.values(cur)) {
      if (v && typeof v === 'object' && !visited.has(v)) stack.push(v);
    }
  }
  
  console.log(`👥 Built users index with ${Object.keys(idx).length} users`);
  // If we found very few users but the response is large, do a more aggressive DFS
  if (Object.keys(idx).length < 5) {
    console.log('⚠️ Few users found, doing aggressive DFS search...');
    const aggressiveStack = [json];
    const aggressiveVisited = new WeakSet();
    let foundCount = 0;
    while (aggressiveStack.length && foundCount < 1000) { // Limit to prevent infinite loops
      const cur = aggressiveStack.pop();
      if (!cur || typeof cur !== 'object' || aggressiveVisited.has(cur)) continue;
      aggressiveVisited.add(cur);
      
      // Check for user-like objects more aggressively
      if (cur.screen_name || (cur.legacy && cur.legacy.screen_name)) {
        push(cur);
        foundCount++;
      }
      
      // Check nested structures
      if (Array.isArray(cur)) {
        for (const item of cur) {
          if (item && typeof item === 'object' && !aggressiveVisited.has(item)) {
            aggressiveStack.push(item);
          }
        }
      } else {
        for (const v of Object.values(cur)) {
          if (v && typeof v === 'object' && !aggressiveVisited.has(v)) {
            aggressiveStack.push(v);
          }
        }
      }
    }
    console.log(`👥 After aggressive DFS: ${Object.keys(idx).length} users`);
  }
  return idx;
}

function unwrapTweet(node) {
    if (!node || typeof node !== 'object') return node;
    
    // Handle tweetResult wrapper (from /tweet-v2 endpoint)
    if (node.tweetResult) {
        return node.tweetResult.result || node.tweetResult;
    }
    
    // Handle result wrapper
    if (node.result) {
        // Check if result has tweetResult
        if (node.result.tweetResult) {
            return node.result.tweetResult.result || node.result.tweetResult;
        }
        return node.result;
    }
    
    // Return node as-is
    return node;
}

function resolveAuthorFromTweet(tweet, usersIndex = {}) {
  const t = (tweet?.result || tweet);
  
  // First check: embedded user in tweet (try multiple paths)
  const embed1 = dget(t, 'core.user_results.result.legacy');
  const embed2 = dget(t, 'core.user_results.result');
  const embed3 = dget(t, 'user.legacy');
  const embed4 = dget(t, 'user');
  const embed = embed1 || embed2 || embed3 || embed4;
  if (embed?.screen_name || embed?.legacy?.screen_name) {
    const legacy = embed.legacy || embed;
    return { name: legacy.name || embed.name || 'Unknown', username: legacy.screen_name || embed.screen_name };
  }
  
  // Second check: look up by user_id_str from usersIndex (try multiple ID fields)
  const uid = dget(t, 'legacy.user_id_str') || 
              dget(t, 'user_id_str') || 
              dget(t, 'legacy.user_id') || 
              dget(t, 'user_id') ||
              dget(t, 'legacy.userId') ||
              dget(t, 'userId');
  if (uid) {
    const uidStr = String(uid);
    // Try string key first, then numeric, then try variations
    const idx = usersIndex[uidStr] || 
                usersIndex[uid] || 
                usersIndex[Number(uidStr)] ||
                usersIndex[String(Number(uidStr))];
    if (idx?.screen_name) {
      return { name: idx.name || 'Unknown', username: idx.screen_name };
    }
    // Also check if the ID itself is in the index as a legacy object
    if (usersIndex[uidStr]?.legacy?.screen_name) {
      const leg = usersIndex[uidStr].legacy;
      return { name: leg.name || 'Unknown', username: leg.screen_name };
    }
  }
  
  // Third check: DFS fallback to find any screen_name in the tweet object (before usersIndex lookup)
  const any = findFirst(t, o => {
    if (!o || typeof o !== 'object') return false;
    const hasScreenName = ('screen_name' in o && o.screen_name) || 
                         (o.legacy && 'screen_name' in o.legacy && o.legacy.screen_name);
    return hasScreenName;
  });
  if (any?.screen_name) {
    return { name: any.name || any.legacy?.name || 'Unknown', username: any.screen_name };
  }
  if (any?.legacy?.screen_name) {
    return { name: any.legacy.name || 'Unknown', username: any.legacy.screen_name };
  }
  
  // Fourth check: Try all user_id variations and look up in usersIndex
  const uidVariations = [
    dget(t, 'legacy.user_id_str'),
    dget(t, 'user_id_str'),
    dget(t, 'legacy.user_id'),
    dget(t, 'user_id'),
    dget(t, 'legacy.userId'),
    dget(t, 'userId'),
    t.legacy?.user_id_str,
    t.user_id_str,
    t.legacy?.user_id,
    t.user_id,
  ];
  
  for (const uid of uidVariations) {
    if (!uid) continue;
    const uidStr = String(uid);
    const keyVariations = [uidStr, uid, Number(uidStr), String(Number(uidStr))];
    for (const key of keyVariations) {
      const idx = usersIndex[key];
      if (idx) {
        const legacy = idx.legacy || idx;
        if (legacy?.screen_name) {
          return { name: legacy.name || 'Unknown', username: legacy.screen_name };
        }
        if (idx.screen_name) {
          return { name: idx.name || 'Unknown', username: idx.screen_name };
        }
      }
    }
  }
  
  // Fifth check: Try to find user by searching the usersIndex for matching user objects in the tweet
  if (Object.keys(usersIndex).length > 0) {
    for (const [userId, userData] of Object.entries(usersIndex)) {
      if (!userData) continue;
      const legacy = userData.legacy || userData;
      if (!legacy?.screen_name) continue;
      
      // Check if this user's ID appears anywhere in the tweet structure
      const found = findFirst(t, o => {
        if (!o || typeof o !== 'object') return false;
        const tweetUid = o?.user_id_str || o?.user_id || o?.userId || 
                         o?.legacy?.user_id_str || o?.legacy?.user_id;
        return tweetUid && String(tweetUid) === String(userId);
      });
      
      if (found) {
        return { name: legacy.name || 'Unknown', username: legacy.screen_name };
      }
    }
  }
  
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
    
    console.log(`🎨 Displaying ${tweets.length} tweets`);
    if (tweets.length > 0) {
        const sample = tweets[0];
        console.log('📝 Sample tweet keys:', Object.keys(sample || {}));
        console.log('📝 Sample tweet (first 800 chars):', JSON.stringify(sample, null, 2).substring(0, 800));
    }
    
    container.innerHTML = `<h3>${title}</h3>${
        tweets.map((t, idx) => {
            // Unwrap tweet node - try multiple unwrapping strategies
            let node = t;
            
            // First, try to unwrap using unwrapTweet function
            node = unwrapTweet(node) || node;
            
            // Further unwrapping if needed - handle tweetResult wrapper (from /tweet-v2)
            if (node && typeof node === 'object') {
                // Check for tweetResult wrapper
                if (node.tweetResult) {
                    if (node.tweetResult.result) {
                        node = node.tweetResult.result;
                    } else {
                        node = node.tweetResult;
                    }
                }
                // Check for tweet wrapper
                if (node.tweet) {
                    if (node.tweet.result) {
                        node = node.tweet.result;
                    } else {
                        node = node.tweet;
                    }
                }
                // Check for result wrapper
                if (node.result) {
                    // If result looks like a tweet, use it
                    if (node.result.__typename === 'Tweet' || node.result.legacy || node.result.rest_id) {
                        node = node.result;
                    }
                }
            }
            
            if (!node || typeof node !== 'object') {
                console.warn(`⚠️ Tweet ${idx} has no valid node after unwrap`);
                return '';
            }
            
            // Try multiple paths for legacy object
            let legacy = null;
            
            // Direct legacy access
            if (node.legacy && typeof node.legacy === 'object') {
                legacy = node.legacy;
            } else if (node.full_text || node.created_at || node.text || (node.favorite_count !== undefined)) {
                // Node itself might be the legacy object
                legacy = node;
            } else {
                // Try nested paths
                legacy = node.tweet?.legacy || 
                        node.result?.legacy || 
                        node.tweetResult?.result?.legacy ||
                        null;
            }
            
            // If still no legacy, check if node has tweet-like properties
            if (!legacy) {
                if (node.__typename === 'Tweet' && node.rest_id) {
                    // This is a tweet object, legacy might not exist, but we can use node directly
                    legacy = node;
                } else {
                    // Fallback to node itself
                    legacy = node;
                }
            }
            
            if (!legacy) {
                console.warn(`⚠️ Tweet ${idx} has no legacy object. Node keys:`, Object.keys(node || {}));
                legacy = node; // Fallback to node itself
            }
            
            // Try multiple paths for tweet text - be very aggressive
            // Check note_tweet first (for long tweets/articles)
            const noteText = dget(node, 'note_tweet.note_tweet_results.result.text') ||
                            dget(node, 'note_tweet.text') ||
                            node.note_tweet?.note_tweet_results?.result?.text ||
                            node.note_tweet?.text ||
                            '';
            
            // Try all possible paths for text
            const text = 
                noteText ||
                legacy?.full_text || 
                legacy?.text || 
                node?.full_text || 
                node?.text || 
                dget(node, 'tweet.legacy.full_text') ||
                dget(node, 'tweet.legacy.text') ||
                dget(node, 'tweetResult.result.legacy.full_text') ||
                dget(node, 'tweetResult.result.legacy.text') ||
                dget(node, 'result.legacy.full_text') ||
                dget(node, 'result.legacy.text') ||
                dget(node, 'legacy.full_text') ||
                dget(node, 'legacy.text') ||
                // Try to find any text property in the object
                (() => {
                    // DFS search for text in legacy object
                    if (legacy && typeof legacy === 'object') {
                        const legacyKeys = Object.keys(legacy);
                        for (const key of legacyKeys) {
                            if ((key.includes('text') || key === 'full_text') && typeof legacy[key] === 'string' && legacy[key].length > 0) {
                                return legacy[key];
                            }
                        }
                    }
                    // DFS search in node
                    if (node && typeof node === 'object') {
                        const nodeKeys = Object.keys(node);
                        for (const key of nodeKeys) {
                            if ((key.includes('text') || key === 'full_text') && typeof node[key] === 'string' && node[key].length > 0) {
                                return node[key];
                            }
                        }
                    }
                    return '';
                })() ||
                '';
            
            // Try multiple paths for date
            const dateRaw = 
                legacy?.created_at || 
                node?.created_at || 
                dget(node, 'tweet.legacy.created_at') ||
                dget(node, 'result.legacy.created_at') ||
                dget(node, 'legacy.created_at') ||
                '';
            
            // Try multiple paths for counts
            const favoriteCount = 
                legacy?.favorite_count || 
                legacy?.favourites_count ||
                node?.favorite_count || 
                node?.favourites_count ||
                dget(node, 'tweet.legacy.favorite_count') ||
                dget(node, 'tweet.legacy.favourites_count') ||
                dget(node, 'legacy.favorite_count') ||
                dget(node, 'legacy.favourites_count') ||
                0;
            
            const retweetCount = 
                legacy?.retweet_count || 
                node?.retweet_count || 
                dget(node, 'tweet.legacy.retweet_count') ||
                dget(node, 'legacy.retweet_count') ||
                0;
            
            const replyCount = 
                legacy?.reply_count || 
                node?.reply_count || 
                dget(node, 'tweet.legacy.reply_count') ||
                dget(node, 'legacy.reply_count') ||
                0;
            
            // Format date - handle X date format
            let dateStr = 'Unknown';
            if (dateRaw) {
                try {
                    // X dates are in format: "Tue Nov 30 14:10:47 +0000 2010"
                    if (typeof dateRaw === 'string') {
                        if (dateRaw.includes('+0000') || dateRaw.includes('GMT')) {
                            const parsed = new Date(dateRaw);
                            dateStr = isNaN(parsed.getTime()) ? dateRaw : parsed.toLocaleString();
                        } else {
                            // Try parsing as-is
                            const parsed = new Date(dateRaw);
                            dateStr = isNaN(parsed.getTime()) ? dateRaw : parsed.toLocaleString();
                        }
                    } else if (typeof dateRaw === 'number') {
                        // Might be timestamp in milliseconds
                        dateStr = new Date(dateRaw).toLocaleString();
                    }
                    if (dateStr === 'Invalid Date' || (dateRaw && isNaN(new Date(dateRaw).getTime()))) {
                        dateStr = String(dateRaw);
                    }
                } catch (e) {
                    console.warn(`⚠️ Date parsing error for tweet ${idx}:`, dateRaw, e);
                    dateStr = String(dateRaw);
                }
            }
            
            // Resolve author
            const author = resolveAuthorFromTweet(t, ctx.usersIndex || {});
            
            // Debug first tweet if no text - log full structure for analysis
            if (!text && idx === 0) {
                console.warn('⚠️ First tweet has no text.');
                console.warn('  Node keys:', Object.keys(node || {}));
                console.warn('  Legacy keys:', Object.keys(legacy || {}));
                console.warn('  Node has full_text:', !!node.full_text, 'legacy has full_text:', !!legacy?.full_text);
                console.warn('  Node.__typename:', node.__typename);
                console.warn('  Node.rest_id:', node.rest_id);
                // Log the full node structure
                console.warn('  Full node (first 2000 chars):', JSON.stringify(node, null, 2).substring(0, 2000));
                // Log the full legacy structure if it exists
                if (legacy && legacy !== node) {
                    console.warn('  Full legacy (first 2000 chars):', JSON.stringify(legacy, null, 2).substring(0, 2000));
                }
                
                // Try to find text in any property of the node
                const allKeys = Object.keys(node || {});
                for (const key of allKeys) {
                    const value = node[key];
                    if (typeof value === 'string' && value.length > 10 && value.length < 500) {
                        console.warn(`  Found potential text in node.${key}:`, value.substring(0, 100));
                    }
                    if (typeof value === 'object' && value !== null) {
                        const subKeys = Object.keys(value);
                        for (const subKey of subKeys) {
                            if (subKey.includes('text') || subKey.includes('Text')) {
                                console.warn(`  Found potential text key: node.${key}.${subKey}:`, value[subKey]);
                            }
                        }
                    }
                }
            }
            
            // If still no text, try one more aggressive search
            if (!text) {
                // DFS search for any text-like property
                const findTextInObject = (obj, depth = 0) => {
                    if (depth > 3 || !obj || typeof obj !== 'object') return null;
                    for (const [key, value] of Object.entries(obj)) {
                        if (key.includes('text') || key.includes('Text') || key === 'full_text' || key === 'text') {
                            if (typeof value === 'string' && value.length > 5) {
                                return value;
                            }
                        }
                        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                            const found = findTextInObject(value, depth + 1);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                const foundText = findTextInObject(node);
                if (foundText) {
                    console.log(`✅ Found text via DFS: ${foundText.substring(0, 50)}...`);
                    text = foundText;
                }
            }
            
            return `<div class="tweet-card">
        <p><strong>@${esc(author.username)}:</strong> ${text ? esc(text.substring(0, 280)) : '<em style="color: #657786;">No content available</em>'}</p>
        <div class="tweet-footer">
          <span>❤️ ${formatNumber(favoriteCount)}</span>
          <span>🔁 ${formatNumber(retweetCount)}</span>
          <span>💬 ${formatNumber(replyCount)}</span>
          <span>📅 ${esc(dateStr)}</span>
        </div>
      </div>`;
        }).filter(Boolean).join('')
    }`;
}

function displayUsers(users, container, title) {
    if (!users || users.length === 0) { 
        container.innerHTML = `<h3>${title}</h3><p>No users found.</p>`; 
        return; 
    }
    
    console.log(`🎨 Displaying ${users.length} users`);
    if (users.length > 0) {
        console.log('👤 Sample user structure:', JSON.stringify(users[0], null, 2).substring(0, 500));
    }
    
    container.innerHTML = `<h3>${title}</h3>${users.map((user, idx) => {
        // Try multiple paths for legacy object
        const legacy = user.legacy || user.user?.legacy || user.result?.legacy || user;
        
        // Try multiple paths for user data - check core.screen_name first (new API structure)
        const screenName = 
            user.core?.screen_name ||
            legacy?.screen_name || 
            user.screen_name ||
            dget(user, 'core.screen_name') ||
            dget(user, 'user.legacy.screen_name') ||
            dget(user, 'result.legacy.screen_name') ||
            dget(user, 'legacy.screen_name') ||
            'unknown';
        
        // Try multiple paths for name - check core.name first (new API structure)
        const name = 
            user.core?.name ||
            legacy?.name || 
            user.name ||
            dget(user, 'core.name') ||
            dget(user, 'user.legacy.name') ||
            dget(user, 'result.legacy.name') ||
            dget(user, 'legacy.name') ||
            '';
        
        // Try multiple paths for description
        const description = 
            legacy?.description || 
            user.description ||
            dget(user, 'user.legacy.description') ||
            dget(user, 'result.legacy.description') ||
            dget(user, 'legacy.description') ||
            '';
        
        // Try multiple paths for followers count
        const followersCount = 
            legacy?.followers_count || 
            legacy?.normal_followers_count ||
            user.followers_count ||
            dget(user, 'user.legacy.followers_count') ||
            dget(user, 'user.legacy.normal_followers_count') ||
            dget(user, 'legacy.followers_count') ||
            dget(user, 'legacy.normal_followers_count') ||
            0;
        
        // Try multiple paths for statuses count
        const statusesCount = 
            legacy?.statuses_count || 
            user.statuses_count ||
            dget(user, 'user.legacy.statuses_count') ||
            dget(user, 'legacy.statuses_count') ||
            0;
        
        // Try multiple paths for verified status
        const verified = 
            legacy?.verified || 
            user.verified ||
            user.is_blue_verified ||
            dget(user, 'user.legacy.verified') ||
            dget(user, 'legacy.verified') ||
            false;
        
        // Debug first user if screen_name is still unknown
        if (idx === 0 && (!screenName || screenName === 'unknown')) {
            console.warn('⚠️ First user has no screen_name. User keys:', Object.keys(user || {}));
            console.warn('  User.core:', user.core);
            console.warn('  User.legacy:', user.legacy);
            console.warn('  Legacy keys:', Object.keys(legacy || {}));
            console.warn('  Full user (first 1000 chars):', JSON.stringify(user, null, 2).substring(0, 1000));
        }
        
        return `<div class="user-card">
            <strong>@${esc(screenName)}</strong>${name ? ` - ${esc(name)}` : ''}
            ${verified ? ' <span class="badge badge-verified">✓</span>' : ''}
            ${description ? `<br><small>${esc(description)}</small>` : '<br><small style="color: #657786;">No description</small>'}
            <div class="tweet-footer">
                <span>👥 ${formatNumber(followersCount)} followers</span>
                <span>📝 ${formatNumber(statusesCount)} tweets</span>
            </div>
        </div>`;
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
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        container.innerHTML = `<h3>${title}</h3><p>No data available.</p>`;
        return;
    }
    container.innerHTML = `<h3>${title}</h3><div class="list-card" style="padding: 16px;">
        <p style="color: #65676b; margin-bottom: 12px;">Raw API response data:</p>
        <details>
            <summary style="cursor: pointer; color: #1da1f2; user-select: none;">📋 View Raw JSON</summary>
            <pre class="json-dump" style="margin-top: 8px; max-height: 400px; overflow: auto; background: #f7f9fa; padding: 12px; border-radius: 4px; font-size: 12px; white-space: pre-wrap; word-wrap: break-word;">${esc(JSON.stringify(data, null, 2))}</pre>
        </details>
    </div>`;
}

