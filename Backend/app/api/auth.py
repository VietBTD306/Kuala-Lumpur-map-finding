from fastapi import APIRouter ,HTTPException , status , Depends
from fastapi.security import HTTPBearer , HTTPAuthorizationCredentials
import logging

from app.Shemas.auth import (
    LoginRequest ,
    TokenResponse,
    TokenData ,
    RefreshTokenRequest ,
    UserResponse
)

from app.Services.auth import(
    authenticate_user,
    create_access_token , 
    create_refresh_token ,
    verify_token , 
    blacklist_token
)

from app.Dependencies.access_control import get_current_user
from app.Shemas.auth import TokenData

logger = logging.getLogger(__name__)

security = HTTPBearer()
router = APIRouter(prefix="/api", tags=["Authentication"])

@router.post("/login", response_model = TokenResponse)
async def login ( credentials : LoginRequest):
    
    user = authenticate_user (credentials.username , credentials.password)
    
    if not user :
        logger.warning("Failed login attempt for username: %s", credentials.username)
        raise HTTPException(
            status_code= status.HTTP_401_UNAUTHORIZED,
            detail = "Incorrect username or password",
            headers = {"WWW-Authenticate": "Bearer"},
        )
    
    logger.info("Successful login for username: %s", user["username"])
    
    # Create tokens
    token_data = {
        "sub": user["username"],
        "role": user["role"]
    }
    
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    
    return TokenResponse(
        access_token = access_token,
        refresh_token = refresh_token
    )

@router.post("/logout")
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: TokenData = Depends(get_current_user)
):
    blacklist_token(credentials.credentials)
    return {
        "message": "Successfully logged out",
        "username": current_user.username
    }
    
@router.get("/verify", response_model=UserResponse)
async def verify(
    current_user: TokenData = Depends(get_current_user)
):
    return UserResponse(
        username = current_user.username,
        role = current_user.role        
    )
    
@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: RefreshTokenRequest):
    """
    Refresh access token using refresh token
    """
    payload = verify_token(request.refresh_token, expected_type="refresh")
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create new tokens
    token_data = {
        "sub": payload["username"],
        "role": payload["role"]
    }
    
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token
    )
