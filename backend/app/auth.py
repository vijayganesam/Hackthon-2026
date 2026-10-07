from fastapi import Header, HTTPException

from .services.auth_service import customer_for_token


def bearer_token(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


async def current_customer(authorization: str | None = Header(default=None)) -> dict:
    token = bearer_token(authorization)
    customer = customer_for_token(token) if token else None
    if not customer:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    return customer
