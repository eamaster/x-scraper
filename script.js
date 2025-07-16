const apiKey = '4aaf9685f9msh91bb6936661eb07p1a7da5jsn7ff9f3fe3216';
const apiHost = 'twitter-api45.p.rapidapi.com';

const searchBtn = document.getElementById('search-btn');
const searchQueryInput = document.getElementById('search-query-input');
const resultsContainer = document.getElementById('results');
const userProfileContainer = document.getElementById('user-profile');
const sortByDateBtn = document.getElementById('sort-by-date');
const sortByLikesBtn = document.getElementById('sort-by-likes');
const sortByRetweetsBtn = document.getElementById('sort-by-retweets');
const searchTypeKeywordRadio = document.getElementById('search-type-keyword');
const searchTypeUserRadio = document.getElementById('search-type-user');

searchTypeKeywordRadio.addEventListener('change', () => {
    searchQueryInput.placeholder = 'Enter keyword or #hashtag';
});

searchTypeUserRadio.addEventListener('change', () => {
    searchQueryInput.placeholder = 'Enter username';
});

searchBtn.addEventListener('click', () => {
    const query = searchQueryInput.value.trim();
    if (!query) return;

    resultsContainer.innerHTML = '<p>Loading...</p>';
    userProfileContainer.innerHTML = '';

    const searchType = document.querySelector('input[name="search-type"]:checked').value;

    if (searchType === 'user') {
        searchUser(query);
    } else {
        searchTweets(query);
    }
});

let currentTweets = [];

async function searchUser(username) {
    searchBtn.disabled = true;
    try {
        const [userProfile, userTweets] = await Promise.all([
            fetchUserProfile(username),
            fetchUserTweets(username)
        ]);

        displayUserProfile(userProfile);
        currentTweets = userTweets;
        displayTweets(userTweets);

    } catch (error) {
        handleSearchError(error);
    } finally {
        searchBtn.disabled = false;
    }
}

async function searchTweets(query) {
    searchBtn.disabled = true;
    try {
        const tweets = await fetchTweetsByQuery(query);
        currentTweets = tweets;
        displayTweets(tweets);
    } catch (error) {
        handleSearchError(error);
    } finally {
        searchBtn.disabled = false;
    }
}

function handleSearchError(error) {
    console.error(error);
    let errorMessage = 'An unexpected error occurred. Please try again.';
    if (error.message.includes('Status: 404')) {
        errorMessage = 'User or tweets not found. Please check the username or keyword.';
    } else if (error.message.includes('Status: 429')) {
        errorMessage = 'You have exceeded the API rate limit. Please wait a moment before trying again.';
    } else if (error.message.includes('Status: 500')) {
        errorMessage = 'The Twitter data service is temporarily unavailable (Error 500). Please try again later.';
    } else if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Could not connect to the Twitter data service. Please check your internet connection and try again.';
    }
    resultsContainer.innerHTML = `<p>${errorMessage}</p>`;
}

sortByDateBtn.addEventListener('click', () => {
    currentTweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    displayTweets(currentTweets);
});

sortByLikesBtn.addEventListener('click', () => {
    currentTweets.sort((a, b) => b.favorites - a.favorites);
    displayTweets(currentTweets);
});

sortByRetweetsBtn.addEventListener('click', () => {
    currentTweets.sort((a, b) => b.retweets - a.retweets);
    displayTweets(currentTweets);
});

const fetchTweetsByQuery = async (query) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://${apiHost}/search.php?query=${encodedQuery}`;
    return await apiRequest(url);
};

const fetchUserProfile = async (username) => {
    const url = `https://${apiHost}/userinfo.php?user=${username}`;
    return await apiRequest(url);
};

const fetchUserTweets = async (username) => {
    const url = `https://${apiHost}/usertweet.php?user=${username}`;
    const result = await apiRequest(url);
    return result.timeline || [];
};

const apiRequest = async (url) => {
    const options = {
        method: 'GET',
        headers: {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': apiHost
        }
    };
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Failed to fetch data. Status: ${response.status}`);
    }
    return await response.json();
};

function displayUserProfile(profile) {
    if (!profile || !profile.screen_name) {
        userProfileContainer.innerHTML = '<p>Could not load user profile.</p>';
        return;
    }

    const profileHtml = `
        <div class="user-profile-card">
            <img src="${profile.profile_image_url_https}" alt="Profile picture of ${profile.screen_name}" class="profile-image">
            <div class="profile-info">
                <h3>${profile.name}</h3>
                <p>@${profile.screen_name}</p>
                <p>${profile.description}</p>
                <div class="profile-stats">
                    <span><strong>Following:</strong> ${profile.friends_count}</span>
                    <span><strong>Followers:</strong> ${profile.followers_count}</span>
                    <span><strong>Listed:</strong> ${profile.listed_count}</span>
                </div>
            </div>
        </div>
    `;
    userProfileContainer.innerHTML = profileHtml;
}

function displayTweets(tweets) {
    resultsContainer.innerHTML = ''; // Clear previous results before displaying new ones
    let tweetsHtml = '<h3>Search Results</h3>';
    if (Array.isArray(tweets) && tweets.length > 0) {
        tweets.forEach(tweet => {
            // Using the correct fields from the new API response
            tweetsHtml += `
                <div class="tweet-card">
                    <p><strong>@${tweet.screen_name}:</strong> ${tweet.text}</p>
                    <div class="tweet-footer">
                        <span>❤️ ${tweet.favorites || 0}</span>
                        <span>🔁 ${tweet.retweets || 0}</span>
                        <span>💬 ${tweet.replies || 0}</span>
                        <span>${new Date(tweet.created_at).toLocaleString()}</span>
                    </div>
                </div>
            `;
        });
    } else {
        tweetsHtml += '<p>No tweets found for this query.</p>';
    }
    resultsContainer.innerHTML = tweetsHtml;
}
