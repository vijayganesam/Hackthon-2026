import asyncio

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from ..auth import bearer_token, current_customer
from ..services.auth_service import AuthError, login_customer, logout, register_customer
from ..services.pega_dx_service import fetch_customer_cases

_warm_tasks: set = set()


async def _warm_cases(customer_id: str) -> None:
    try:
        await fetch_customer_cases(customer_id)
    except Exception:
        pass

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterBody(BaseModel):
    name: str
    email: str
    phone: str
    password: str


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/register")
async def register(body: RegisterBody):
    try:
        customer = register_customer(body.name, body.email, body.phone, body.password)
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "customer": customer}


@router.post("/login")
async def login(body: LoginBody):
    try:
        token, customer = login_customer(body.email, body.password)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    task = asyncio.create_task(_warm_cases(customer["customerId"]))
    _warm_tasks.add(task)
    task.add_done_callback(_warm_tasks.discard)
    return {"success": True, "token": token, "customer": customer}


@router.get("/me")
async def me(customer: dict = Depends(current_customer)):
    return {"success": True, "customer": customer}


@router.post("/logout")
async def do_logout(authorization: str | None = Header(default=None)):
    token = bearer_token(authorization)
    if token:
        logout(token)
    return {"success": True}
