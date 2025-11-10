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
 * 5. Add environment variable: ALLOWED_ORIGINS with comma-separated origins (e.g., "https://yourdomain.com,http://localhost:8000")
 * 6. Deploy the worker
 * 7. Update the WORKER_URL in script.js with your worker's URL
 */

const RAPIDAPI_HOST = 'twitter241.p.rapidapi.com';

// Build CORS headers based on origin allowlist
function buildCorsHeaders(origin, allowed) {
  const allowedOrigins = (allowed || '').split(',').map(s => s.trim()).filter(Boolean);
  const allow = allowedOrigins.includes(origin) ? origin : 'null';
  
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = buildCorsHeaders(origin, env.ALLOWED_ORIGINS);
    
    // Get the API key from environment variables
    const apiKey = env.RAPIDAPI_KEY;
    
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: cors
      });
    }

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: cors
      });
    }

    try {
      // Parse the request URL
      const url = new URL(request.url);
      const endpoint = url.searchParams.get('endpoint');

      // If no endpoint provided, return helpful information
      if (!endpoint) {
        return new Response(JSON.stringify({ 
          message: 'Twitter API Proxy Worker',
          status: 'active',
          usage: 'This Worker requires an endpoint parameter. Use: ?endpoint=/user&username=elonmusk',
          example: `${url.origin}/?endpoint=/user&username=elonmusk`,
          note: 'This Worker is designed to be called from a frontend application, not accessed directly.'
        }), {
          status: 200,
          headers: cors
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
      return new Response(JSON.stringify(data), {
        status: apiResponse.status,
        headers: {
          ...cors,
          'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: cors
      });
    }
  }
};

