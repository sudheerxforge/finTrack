"""finTrack backend (FastAPI).

Keeps the Gemini API key off the phone and offers a few AI helpers:

  GET  /health          quick check
  POST /token           single-use Gemini Live token (voice assistant)
  POST /ai/parse        free text / receipt photo -> structured transaction(s)
  POST /ai/insights     short spending advice from a summary the app sends

Run:  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import base64
import datetime as dt
import json
import os
import time
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("GEMINI_API_KEY is not set. Add it to backend/.env")

# Optional shared secret. If set, the app must send it as X-App-Key.
APP_KEY = os.getenv("APP_KEY", "")
TEXT_MODEL = os.getenv("TEXT_MODEL", "gemini-flash-lite-latest")

ALLOWED_LIVE_MODELS = {
    "models/gemini-3.8-live",
    "models/gemini-3.8-live-extended-thinking",
}

NEW_SESSION_WINDOW = dt.timedelta(minutes=1)
TOKEN_LIFETIME = dt.timedelta(minutes=30)
MAX_IMAGE_BYTES = 4 * 1024 * 1024

live_client = genai.Client(api_key=API_KEY, http_options={"api_version": "v1alpha"})
client = genai.Client(api_key=API_KEY, http_options=types.HttpOptions(timeout=30000))

app = FastAPI(title="finTrack backend")


def check_key(x_app_key: Optional[str]) -> None:
    if APP_KEY and x_app_key != APP_KEY:
        raise HTTPException(status_code=401, detail="Invalid app key")



def generate(contents, config):
    """generate_content with a few retries: Gemini sometimes answers 503 (busy)."""
    last = None
    for attempt in range(3):
        try:
            return client.models.generate_content(model=TEXT_MODEL, contents=contents, config=config)
        except Exception as e:  # noqa: BLE001
            last = e
            if "503" not in str(e) and "UNAVAILABLE" not in str(e):
                raise
            time.sleep(1.5 * (attempt + 1))
    raise last


# ---------------------------------------------------------------- health ----
@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ----------------------------------------------------------------- token ----
class TokenRequest(BaseModel):
    model: str


class TokenResponse(BaseModel):
    token: str
    expires_at: str


@app.post("/token", response_model=TokenResponse)
def create_token(
    request: TokenRequest, x_app_key: Optional[str] = Header(default=None)
) -> TokenResponse:
    check_key(x_app_key)
    if request.model not in ALLOWED_LIVE_MODELS:
        raise HTTPException(status_code=400, detail=f"Model not allowed: {request.model}")

    now = dt.datetime.now(dt.timezone.utc)
    expires_at = now + TOKEN_LIFETIME
    try:
        token = live_client.auth_tokens.create(
            config=types.CreateAuthTokenConfig(
                uses=1,
                expire_time=expires_at,
                new_session_expire_time=now + NEW_SESSION_WINDOW,
                live_connect_constraints=types.LiveConnectConstraints(model=request.model),
                lock_additional_fields=[],
            )
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not create token: {e}")
    return TokenResponse(token=token.name, expires_at=expires_at.isoformat())


# -------------------------------------------------------------- ai/parse ----
class ParsedTransaction(BaseModel):
    kind: Literal["credit", "debit"]
    amount: float
    category: str
    note: str = ""
    date: str = Field(description="YYYY-MM-DD")


class ParseRequest(BaseModel):
    text: Optional[str] = None
    image_base64: Optional[str] = None
    mime_type: str = "image/jpeg"
    categories: list[str] = []


class ParseResponse(BaseModel):
    transactions: list[ParsedTransaction]


@app.post("/ai/parse", response_model=ParseResponse)
def parse(req: ParseRequest, x_app_key: Optional[str] = Header(default=None)) -> ParseResponse:
    """Turn 'paid 450 for groceries yesterday' or a receipt photo into transactions."""
    check_key(x_app_key)
    if not req.text and not req.image_base64:
        raise HTTPException(status_code=400, detail="Send text or image_base64")

    today = dt.date.today().isoformat()
    cats = ", ".join(req.categories) or "Food, Transport, Bills, Shopping, Salary, Other"
    instruction = (
        f"Today is {today}. Extract every money transaction from the input. "
        "kind is 'debit' when money goes out (spent, paid, bought) and 'credit' "
        "when money comes in (received, salary, refund). amount is a positive "
        f"number. category must be one of: {cats}. date is YYYY-MM-DD; resolve "
        "words like 'yesterday' using today's date. note is a few words."
    )
    parts: list = [instruction]
    if req.text:
        parts.append(req.text)
    if req.image_base64:
        try:
            raw = base64.b64decode(req.image_base64, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="image_base64 is not valid base64")
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Image too large (max 4 MB)")
        parts.append(types.Part.from_bytes(data=raw, mime_type=req.mime_type))

    try:
        res = generate(
            parts,
            types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=list[ParsedTransaction],
            ),
        )
        items = json.loads(res.text)
        return ParseResponse(transactions=[ParsedTransaction(**i) for i in items])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not parse: {e}")


# ----------------------------------------------------------- ai/insights ----
class InsightsRequest(BaseModel):
    # A compact summary built on the phone, e.g. totals per category.
    summary: dict
    currency: str = "INR"


class InsightsResponse(BaseModel):
    tips: list[str]


@app.post("/ai/insights", response_model=InsightsResponse)
def insights(
    req: InsightsRequest, x_app_key: Optional[str] = Header(default=None)
) -> InsightsResponse:
    check_key(x_app_key)
    prompt = (
        "You are a practical personal-finance coach. Based on this summary "
        f"(currency {req.currency}), give 3 to 5 short, specific tips to spend "
        "less, clear debts faster or save more. One sentence each. No "
        "investment-product recommendations.\n\n" + json.dumps(req.summary)[:6000]
    )
    try:
        res = generate(
            prompt,
            types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=list[str],
            ),
        )
        return InsightsResponse(tips=json.loads(res.text))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not get insights: {e}")
