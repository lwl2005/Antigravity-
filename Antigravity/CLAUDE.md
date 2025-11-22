# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Antigravity-to-OpenAI API proxy service that converts Google Antigravity API calls into OpenAI-compatible format. The service supports streaming responses, function calling (tools), multi-account token rotation, and automatic token refresh.

## Development Commands

```bash
# Install dependencies
npm install

# Start the server (production)
npm start

# Start with auto-reload (development)
npm run dev

# Run OAuth login flow to obtain tokens
npm run login
```

## Architecture

### Request Flow
1. **Client Request** → Express server receives OpenAI-formatted request at `/v1/chat/completions`
2. **Authentication** → API key validation and rate limiting middleware (src/server/index.js:66-113)
3. **Transformation** → OpenAI messages converted to Antigravity format (src/utils/utils.js:132-145)
4. **Token Management** → Token manager provides valid access token with rotation (src/auth/token_manager.js:117-148)
5. **API Call** → Request sent to Google Antigravity API (src/api/client.js:4-92)
6. **Response Streaming** → SSE chunks converted back to OpenAI format and streamed to client

### Key Components

**Token Management** (src/auth/token_manager.js)
- Manages multiple Google OAuth tokens stored in `data/accounts.json`
- Automatic token rotation using round-robin (currentIndex)
- Auto-refresh tokens when expired (checks 5 minutes before expiry)
- Disables tokens on 403 errors and switches to next available token
- Tracks usage statistics per token

**Message Transformation** (src/utils/utils.js)
- `generateRequestBody()`: Converts OpenAI request to Antigravity format
- `openaiMessageToAntigravity()`: Transforms message history including images, tool calls, and tool responses
- Handles multimodal input (base64 images) in OpenAI format
- Supports thinking mode for models ending in `-thinking` or specific model names

**API Client** (src/api/client.js)
- `generateAssistantResponse()`: Streams responses from Antigravity API
- Parses SSE chunks and extracts text/thinking/function calls
- Handles thinking blocks with `<think>` tags when enabled
- Converts function calls to OpenAI tool_calls format

**Admin Panel** (src/admin/routes.js)
- Web-based admin interface at `/admin` route
- Manages API keys with rate limiting
- Token/account CRUD operations (view, add, delete, enable/disable)
- System monitoring and logging
- Batch token import/export as ZIP files

### Configuration

**config.json** structure:
- `server`: Port and host settings
- `api`: Antigravity API endpoints and headers
- `defaults`: Default model parameters (temperature, top_p, top_k, max_tokens)
- `security`: API key, admin password, max request size
- `systemInstruction`: Default system prompt injected into all requests

**data/accounts.json** structure (auto-generated):
```json
[
  {
    "access_token": "ya29.xxx",
    "refresh_token": "1//xxx",
    "expires_in": 3599,
    "timestamp": 1234567890000,
    "enable": true
  }
]
```

### Authentication

Two authentication systems:
1. **API Authentication**: Bearer token in Authorization header for `/v1/*` endpoints
   - Checks config.json apiKey first (no rate limit)
   - Falls back to database keys with rate limiting (src/admin/key_manager.js)
2. **Admin Authentication**: Session-based auth for `/admin/*` routes using X-Admin-Token header

### Special Features

**Thinking Mode**: Automatically enabled for models ending in `-thinking`, `gemini-2.5-pro`, `gemini-3-pro-*`, and specific internal models. Outputs reasoning in `<think>` blocks.

**Tool Calls**: Converts OpenAI tools to Antigravity functionDeclarations. Tracks function call IDs and merges responses appropriately in message history.

**Idle Management** (src/utils/idle_manager.js): Tracks API activity and logs idle periods for monitoring.

## Testing

The service can be tested using curl:

```bash
# Test streaming chat completion
curl http://localhost:8045/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gemini-2.0-flash-exp",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'

# Get available models
curl http://localhost:8045/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Important Notes

- First-time setup requires running `npm run login` to obtain OAuth tokens
- `data/accounts.json` contains sensitive credentials - never commit to git
- Token rotation happens on every request to distribute load across accounts
- Failed tokens (403 errors) are automatically disabled and removed from rotation
- The admin password is stored in config.json `security.adminPassword`
