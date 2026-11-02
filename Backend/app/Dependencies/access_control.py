from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.Services.auth import verify_token
from app.Shemas.auth import TokenData

security = HTTPBearer()

async def get_current_user (
  credentails : HTTPAuthorizationCredentials = Depends(security)
)-> TokenData:
    token = credentails.credentials
    payload= verify_token(token, expected_type="access")
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    return TokenData(
        username = payload.get("username"),
        role = payload.get("role")
    )
    
async def require_admin(
    cur_user : TokenData = Depends(get_current_user)
)-> TokenData :
    if cur_user.role != "admin" :
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    
    return cur_user
