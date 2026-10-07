import time

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.exception_handlers import request_validation_exception_handler  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from .routes.auth import router as auth_router  # noqa: E402
from .routes.claims import router as claims_router  # noqa: E402
from .routes.complaints import router as complaints_router  # noqa: E402

app = FastAPI(title="Voice Claims Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={"success": False, "error": "The request was missing required information."},
    )


@app.get("/api/health")
def health_check():
    return {"status": "ok", "timestamp": time.time()}


@app.on_event("startup")
async def warm_pega_connection():
    try:
        from .services.pega_dx_service import _get_access_token

        await _get_access_token()
    except Exception:
        pass


app.include_router(auth_router)
app.include_router(claims_router)
app.include_router(complaints_router)
