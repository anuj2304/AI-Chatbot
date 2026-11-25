# AI Chat Assistant

A ChatGPT-style chat app. FastAPI backend streams answers from the Claude API; the frontend is plain HTML/CSS/JS (no build step) and works on phones.

## Features
- Chat screen with a message box; answers stream in as they are written
- Conversation is saved in the browser and comes back after a refresh
- Clear error messages (no internet, rate limit, busy service, timeout) with a **Try again** button
- "Taking longer than usual" notice after 12 seconds, hard timeout after 90 seconds
- **Stop** button while the AI is answering
- Mobile layout, light/dark mode, basic Markdown (bold, lists, code blocks)

## Run it
```bash
pip install -r requirements.txt
cp .env.example .env        # then put your key in .env
uvicorn main:app --reload
```
Open http://localhost:8000. To try it on your phone, run `uvicorn main:app --host 0.0.0.0` and open `http://<your-computer-ip>:8000` on the same Wi-Fi.

Get an API key at https://console.anthropic.com.

## Configure (in `.env`)
| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your API key (required) | none |
| `CLAUDE_MODEL` | Model to use | `claude-sonnet-5-5` |
| `MAX_TOKENS` | Max length of each answer | `2048` |
| `SYSTEM_PROMPT` | Personality / project instructions | friendly general assistant |

To make it an assistant for your project, set `SYSTEM_PROMPT`, e.g. `You are the support assistant for <project>. Answer only about <topic>.`

## Files
- `main.py` – backend: `/api/chat` (streaming), `/api/health`, serves the UI
- `index.html`, `style.css`, `app.js` – the chat UI
- `requirements.txt`, `.env.example`

## Notes
- The API key stays on the server; the browser never sees it.
- Chat history is stored in the browser's localStorage (per device). Only the last 30 messages are sent to the model.
- Before deploying publicly, add login and rate limiting so strangers can't use up your API credits.
