/**
 * Cloudflare Worker - Twitter API Proxy
 * 
 * This worker acts as a secure proxy between your frontend and the RapidAPI Twitter API.
 * It keeps your API key secret on the server side.
 * 
 * Setup Instructions:
 * 1. Go to Cloudflare Dashboard > Workers & Pages
 * 2. Create a new Worker
 * 3. Copy this code into the worker
 * 4. Add environment variable: RAPIDAPI_KEY with your API key
 * 5. Deploy the worker
 * 6. Update the WORKER_URL in script.js with your worker's URL
 */

const RAPIDAPI_HOST = 'twitter241.p.rapidapi.com';

function buildCors(origin) {
  const allowed = ['https://hesam.me']; // production origin only
  const allow = allowed.includes(origin) ? origin : '';
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allow || 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

export default {
  async fetch(request, env) {
    // Get the API key from environment variables
    const apiKey = env.RAPIDAPI_KEY;
    
    const origin = request.headers.get('Origin') || '';
    
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: buildCors(origin)
      });
    }

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: buildCors(origin)
      });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: buildCors(origin)
      });
    }

    try {
      // Parse the request URL
      const url = new URL(request.url);
      const endpoint = url.searchParams.get('endpoint');

      if (!endpoint) {
        return new Response(JSON.stringify({ error: 'Missing endpoint parameter' }), {
          status: 400,
          headers: buildCors(origin)
        });
      }

      // Build the API URL with all query parameters except 'endpoint'
      const apiUrl = new URL(`https://${RAPIDAPI_HOST}${endpoint}`);
      
      // Copy all query parameters except 'endpoint' to the API URL
      for (const [key, value] of url.searchParams) {
        if (key !== 'endpoint') {
          apiUrl.searchParams.set(key, value);
        }
      }

      // Make the request to RapidAPI
      const apiResponse = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST
        }
      });

      // Get the response data
      const data = await apiResponse.json();

      // Return the response with CORS headers
      const corsHeaders = buildCors(origin);
      corsHeaders['Cache-Control'] = 'public, max-age=300'; // Cache for 5 minutes
      return new Response(JSON.stringify(data), {
        status: apiResponse.status,
        headers: corsHeaders
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: buildCors(origin)
      });
    }
  }
};

