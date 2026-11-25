# """AI chat assistant backend.

# FastAPI server that streams answers from the Claude API and serves the chat UI.
# Run:  uvicorn main:app --reload
# """

# import json
# import os
# from pathlib import Path

# import anthropic
# from dotenv import load_dotenv
# from fastapi import FastAPI
# from fastapi.responses import FileResponse, StreamingResponse
# from pydantic import BaseModel, Field

# load_dotenv()

# BASE_DIR = Path(__file__).parent
# MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")
# MAX_TOKENS = int(os.getenv("MAX_TOKENS", "2048"))
# SYSTEM_PROMPT = os.getenv(
#     "SYSTEM_PROMPT",
#     "You are a helpful, friendly AI assistant. Answer clearly and accurately. "
#     "Use short paragraphs, and use lists or code blocks only when they help.",
# )
# MAX_HISTORY = 30  # most recent messages sent to the model

# # Reads ANTHROPIC_API_KEY from the environment. 60s per-request timeout.
# client = anthropic.AsyncAnthropic(timeout=60.0, max_retries=1)

# app = FastAPI(title="AI Chat Assistant")


# class Message(BaseModel):
#     role: str = Field(pattern="^(user|assistant)$")
#     content: str = Field(min_length=1, max_length=8000)


# class ChatRequest(BaseModel):
#     messages: list[Message] = Field(min_length=1, max_length=200)


# def sse(payload: dict) -> str:
#     return f"data: {json.dumps(payload)}\n\n"


# def friendly_error(exc: Exception) -> str:
#     """Turn an API exception into a message a normal person can understand."""
#     if isinstance(exc, anthropic.AuthenticationError):
#         return "The server's API key was rejected. Please check ANTHROPIC_API_KEY."
#     if isinstance(exc, anthropic.RateLimitError):
#         return "The AI is getting too many requests right now. Please wait a moment and try again."
#     if isinstance(exc, anthropic.APITimeoutError):
#         return "The AI took too long to respond. Please try again."
#     if isinstance(exc, anthropic.APIConnectionError):
#         return "Couldn't reach the AI service. Check the server's internet connection and try again."
#     if isinstance(exc, anthropic.APIStatusError):
#         if exc.status_code in (429, 500, 502, 503, 529):
#             return "The AI service is busy or temporarily down. Please try again shortly."
#         return f"The AI service returned an error ({exc.status_code}). Please try again."
#     return "Something went wrong while generating the answer. Please try again."


# @app.post("/api/chat")
# async def chat(req: ChatRequest):
#     async def event_stream():
#         if not os.getenv("ANTHROPIC_API_KEY"):
#             yield sse({"type": "error", "message": "The server has no API key set. Add ANTHROPIC_API_KEY to the .env file and restart."})
#             return

#         history = [m.model_dump() for m in req.messages][-MAX_HISTORY:]
#         while history and history[0]["role"] != "user":
#             history.pop(0)  # conversation must start with a user message
#         if not history:
#             yield sse({"type": "error", "message": "Please send a message first."})
#             return

#         try:
#             async with client.messages.stream(
#                 model=MODEL,
#                 max_tokens=MAX_TOKENS,
#                 system=SYSTEM_PROMPT,
#                 messages=history,
#             ) as stream:
#                 async for text in stream.text_stream:
#                     yield sse({"type": "text", "text": text})
#             yield sse({"type": "done"})
#         except Exception as exc:  # noqa: BLE001 - mapped to a friendly message
#             print(f"[chat error] {type(exc).__name__}: {exc}")
#             yield sse({"type": "error", "message": friendly_error(exc)})

#     return StreamingResponse(
#         event_stream(),
#         media_type="text/event-stream",
#         headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
#     )


# @app.get("/api/health")
# async def health():
#     return {"ok": True, "model": MODEL, "has_key": bool(os.getenv("ANTHROPIC_API_KEY"))}


# @app.get("/")
# async def index():
#     return FileResponse(BASE_DIR / "index.html")


# @app.get("/style.css")
# async def css():
#     return FileResponse(BASE_DIR / "style.css", media_type="text/css")


# @app.get("/app.js")
# async def js():
#     return FileResponse(BASE_DIR / "app.js", media_type="application/javascript")


"""AI chat assistant backend.

FastAPI server that streams answers from the Claude API and serves the chat UI.
Run:  uvicorn main:app --reload
"""

import json
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

load_dotenv()

BASE_DIR = Path(__file__).parent
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "2048"))
SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "You are a helpful, friendly AI assistant. Answer clearly and accurately. "
    "Use short paragraphs, and use lists or code blocks only when they help.",
)
MAX_HISTORY = 30  # most recent messages sent to the model

# ---------------------------------------------------------------------------
# ADI COMPANY INFORMATION
# Write what the assistant should know about ADI between the triple quotes below.
# It answers company questions using ONLY this text. Save the file; uvicorn
# --reload restarts automatically. Delete the "TEMPLATE" line when you are done.
# ---------------------------------------------------------------------------
COMPANY_INFO = """
TEMPLATE - delete this line after filling in the details below

ADI COMPANY

About:
(What ADI is, what it does, when it was founded, where it is based.)

Products / Services:
- (Service or product 1: what it is, who it is for)
- (Service or product 2)

Team / Leadership:
- (Name, role)

Contact:
- Address:
- Phone:
- Email:
- Website:
- Working hours:

Frequently asked questions:
Q: (Common question)
A: (Answer)
"""


def build_system_prompt() -> str:
    knowledge = COMPANY_INFO.strip()
    if not knowledge or "TEMPLATE - delete this line" in knowledge:
        return SYSTEM_PROMPT  # company info not filled in yet
    return (
        f"{SYSTEM_PROMPT}\n\n"
        "You also act as the information assistant for the company described below. "
        "For questions about the company, answer using ONLY this information. "
        "If the answer is not in it, say you don't have that detail and suggest contacting the company; "
        "never invent facts, numbers, names, or contact details. "
        "You can still answer general questions that are unrelated to the company normally.\n\n"
        f"<company_information>\n{knowledge}\n</company_information>"
    )

# Reads ANTHROPIC_API_KEY from the environment. 60s per-request timeout.
client = anthropic.AsyncAnthropic(timeout=60.0, max_retries=1)

app = FastAPI(title="AI Chat Assistant")


class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=200)


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def friendly_error(exc: Exception) -> str:
    """Turn an API exception into a message a normal person can understand."""
    if isinstance(exc, anthropic.AuthenticationError):
        return "The server's API key was rejected. Please check ANTHROPIC_API_KEY."
    if isinstance(exc, anthropic.RateLimitError):
        return "The AI is getting too many requests right now. Please wait a moment and try again."
    if isinstance(exc, anthropic.APITimeoutError):
        return "The AI took too long to respond. Please try again."
    if isinstance(exc, anthropic.APIConnectionError):
        return "Couldn't reach the AI service. Check the server's internet connection and try again."
    if isinstance(exc, anthropic.APIStatusError):
        if exc.status_code in (429, 500, 502, 503, 529):
            return "The AI service is busy or temporarily down. Please try again shortly."
        return f"The AI service returned an error ({exc.status_code}). Please try again."
    return "Something went wrong while generating the answer. Please try again."


@app.post("/api/chat")
async def chat(req: ChatRequest):
    async def event_stream():
        if not os.getenv("ANTHROPIC_API_KEY"):
            yield sse({"type": "error", "message": "The server has no API key set. Add ANTHROPIC_API_KEY to the .env file and restart."})
            return

        history = [m.model_dump() for m in req.messages][-MAX_HISTORY:]
        while history and history[0]["role"] != "user":
            history.pop(0)  # conversation must start with a user message
        if not history:
            yield sse({"type": "error", "message": "Please send a message first."})
            return

        try:
            async with client.messages.stream(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=build_system_prompt(),
                messages=history,
            ) as stream:
                async for text in stream.text_stream:
                    yield sse({"type": "text", "text": text})
            yield sse({"type": "done"})
        except Exception as exc:  # noqa: BLE001 - mapped to a friendly message
            print(f"[chat error] {type(exc).__name__}: {exc}")
            yield sse({"type": "error", "message": friendly_error(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/health")
async def health():
    return {"ok": True, "model": MODEL, "has_key": bool(os.getenv("ANTHROPIC_API_KEY"))}


@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/style.css")
async def css():
    return FileResponse(BASE_DIR / "style.css", media_type="text/css")


@app.get("/app.js")
async def js():
    return FileResponse(BASE_DIR / "app.js", media_type="application/javascript")