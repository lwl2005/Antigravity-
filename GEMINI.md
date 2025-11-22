# Project: Antigravity to OpenAI API Proxy

This repository contains a Node.js-based proxy service that adapts the Google Antigravity API (Gemini) to be compatible with the OpenAI API specifications. It allows clients designed for OpenAI to interact with Gemini models, supporting features like streaming, function calling, and multi-modal inputs.

## Directory Structure

- **`Antigravity/`**: The main Node.js application source code.
- **`chat.py`**: A Python-based CLI chat client for testing the service.
- **`test_*.py` / `test_*.json`**: Various test scripts and configuration payloads for testing the API.
- **`README.md`**: Project documentation.

---

## Core Service: Antigravity

The core application is located in the `Antigravity` directory.

### 1. Setup and Running

**Prerequisites:** Node.js >= 18.0.0

**Commands (execute within `Antigravity/` directory):**

- **Install Dependencies:**
  ```bash
  npm install
  ```
- **Start Server:**
  ```bash
  npm start
  ```
  Runs on `http://localhost:8045` by default.
- **Development Mode:**
  ```bash
  npm run dev
  ```
  Starts with auto-reload.
- **Login / Get Tokens:**
  ```bash
  npm run login
  ```
  Starts the OAuth flow to generate `data/accounts.json`.

### 2. Configuration

- **`config.json`**: Main configuration file.
  - `server`: Host and port settings (default 8045).
  - `security.apiKey`: The "master" API key for accessing the proxy (default `sk-text`).
  - `defaults`: Default model parameters (temperature, top_k, etc.).
- **`data/accounts.json`**: (Auto-generated) Stores OAuth tokens for Google accounts. Handles rotation and refreshing.

### 3. Architecture & Key Components

- **Entry Point:** `src/server/index.js` (Express app setup, middleware).
- **Token Management:** `src/auth/token_manager.js`
  - Rotates through accounts in `data/accounts.json`.
  - Refreshes expired tokens.
  - Disables accounts returning 403 errors.
- **API Client:** `src/api/client.js`
  - Handles communication with Google Antigravity API.
  - Parses SSE streams.
- **Transformation:** `src/utils/utils.js`
  - Converts OpenAI request bodies to Antigravity format.
  - Transforms Gemini responses back to OpenAI format.
  - Handles image/multimodal inputs.
- **Admin Panel:** `src/admin/routes.js`
  - Web interface at `/admin` for managing keys and accounts.

### 4. API Endpoints

The service exposes OpenAI-compatible endpoints:

- `GET /v1/models`: List available models.
- `POST /v1/chat/completions`: Chat completion (supports `stream: true` and `tools`).

---

## Utilities

### `chat.py`
A simple Python script to interact with the running local service.
- **Usage:** `python chat.py [message]`
- **Config:** Edit `API_BASE`, `API_KEY`, `MODEL` variables at the top of the file.

### Testing
- Use `curl` commands as described in `Antigravity/README.md`.
- Python test scripts (`test_gemini_sdk.py`) are available for SDK-level testing.

## Development Conventions

- **Style:** Standard Node.js/JavaScript (ES Modules).
- **Logging:** Use the internal logger (`src/utils/logger.js`) for application logs.
- **Security:** Never commit `data/accounts.json` or `data/api_keys.json`.
- **Testing:** Verify changes using `chat.py` or `curl` against the local server.
