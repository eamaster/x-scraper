const apiKey = '4aaf9685f9msh91bb6936661eb07p1a7da5jsn7ff9f3fe3216';
const apiHost = 'twitter-api45.p.rapidapi.com';

const searchBtn = document.getElementById('search-btn');
const searchQueryInput = document.getElementById('search-query-input');
const resultsContainer = document.getElementById('results'); // Corrected ID
const sortByDateBtn = document.getElementById('sort-by-date');
const sortByLikesBtn = document.getElementById('sort-by-likes');
const sortByRetweetsBtn = document.getElementById('sort-by-retweets');

searchBtn.addEventListener('click', () => {
    const query = searchQueryInput.value.trim();
    if (query) {
        resultsContainer.innerHTML = '<p>Loading...</p>';
        searchTweets(query);
    }
});

let currentTweets = []; // To store the current list of tweets

async function searchTweets(query) {
    searchBtn.disabled = true;

    try {
        const tweets = await fetchTweetsByQuery(query);
        currentTweets = tweets; // Store tweets for sorting
        displayTweets(tweets);
    } catch (error) {
        console.error(error);
        let errorMessage = 'An unexpected error occurred. Please try again.';
        if (error.message.includes('Status: 429')) {
            errorMessage = 'You have exceeded the API rate limit. Please wait a moment before trying again.';
        } else if (error.message.includes('Status: 500')) {
            errorMessage = 'The Twitter data service is temporarily unavailable (Error 500). Please try again later.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = 'Could not connect to the Twitter data service. Please check your internet connection and try again.';
        }
        resultsContainer.innerHTML = `<p>${errorMessage}</p>`;
    } finally {
        searchBtn.disabled = false;
    }
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
    const options = {
        method: 'GET',
        headers: {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': apiHost
        }
    };
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Failed to fetch tweets. Status: ${response.status}`);
    }
    const result = await response.json();
    // The API returns tweets in a 'timeline' array
    return result.timeline || [];
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
