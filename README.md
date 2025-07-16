# X Scraper

This is a simple web dashboard to search for public Twitter profiles and their tweets, or to search for tweets based on a keyword or hashtag.

## Features

- **Search by Keyword**: Find tweets containing specific keywords or hashtags.
- **Search by User**: Fetch a user's profile information and their recent tweets.
- **Sort Tweets**: Sort search results by date, likes, or retweets.
- **View Engagement**: See likes, retweets, and replies for each tweet.

## How to Use

1. Open `index.html` in your web browser.
2. Select the search type: "Keyword" or "User".
3. Enter a search term in the input box:
    - For **Keyword** search, enter a keyword or #hashtag.
    - For **User** search, enter a Twitter username (without the '@').
4. Click the "Search" button.
5. The results will be displayed below. For a user search, you will see the profile information followed by their tweets.

## API

This project uses the [Twttr API on RapidAPI](https://rapidapi.com/sowmen_barua/api/twttr). You will need a RapidAPI key to use it. The key is already included in `script.js` for convenience, but for a production application, it should be handled more securely.
