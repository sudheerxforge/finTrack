# finTrack backend (FastAPI) — optional

> The app uses the Cloudflare Worker in `../cloudflare` (deployed from GitHub). This FastAPI
> copy of the AI routes is only for local experiments; you do not need to run it.

Keeps your Gemini API key off the phone.

| Endpoint | What it does |
|---|---|
| `GET /health` | Is the server up |
| `POST /token` | Single-use Gemini Live token for the voice assistant. Body `{"model": "models/gemini-3.8-live"}` |
| `POST /ai/parse` | Text or receipt photo (base64) → transactions. Body `{"text": "...", "categories": [...]}` |
| `POST /ai/insights` | Short money tips from a summary the app sends |

Interactive docs at http://localhost:8000/docs.

## First-time setup (PowerShell)

```powershell
cd D:\finTrack\backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # then put your key in .env
```

`.env`:

```
GEMINI_API_KEY=your-key
APP_KEY=                     # optional shared secret; app sends it as X-App-Key
TEXT_MODEL=gemini-flash-lite-latest
```

## Run

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
adb reverse tcp:8000 tcp:8000      # lets a USB phone reach it
```

## Notes

- `TEXT_MODEL` is used for parsing and tips. Google retires model names; if you
  get a 404 "no longer available", pick a current one. `gemini-flash-lite-latest`
  is an alias that keeps working. Bigger flash models can be slow or busy at
  times; the backend retries 503s and times out after 30 s.
- Live voice model names are listed in `ALLOWED_LIVE_MODELS` in `main.py`.

## Before production

- Host it (Cloud Run, Render, Railway) behind **HTTPS**.
- Add real **user authentication**. `APP_KEY` only deters casual abuse, because anything inside an app can be extracted.
- Add **rate limiting** so one user cannot use up your quota.
- Point `BACKEND_URL` in `mobile/src/config.ts` at the deployed URL.
