import logging
import sqlite3
from datetime import datetime , timedelta
from jose import JWTError,jwt
from passlib.context import CryptContext
from app.config import get_settings
from app.database import get_db_connection

logger = logging.getLogger(__name__)
settings = get_settings()

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

_token_blacklist: set = set()

def verify_password( plain_password : str , hash_password : str) -> bool :
    return pwd_context.verify( plain_password, hash_password)

def get_hash_password ( password : str) -> str:
    return pwd_context.hash( password )

def blacklist_token (token : str):
    _token_blacklist.add(token)
    logger.info("Token blacklisted successfully")
    
def is_blacklist_token ( token : str)-> bool:
    return token in _token_blacklist

def create_access_token(data : dict) ->str :
    to_encode=data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire, "type": "access"})
    encode_jwt = jwt.encode(
        to_encode,
        settings.secret_key,
        algorithm= settings.algorithm
    )
    
    return encode_jwt

def create_refresh_token(data: dict) -> str:
    """Create JWT refresh token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)
    to_encode.update( {"exp": expire , "type" : "refresh" })
    
    encoded_jwt = jwt.encode(
        to_encode, 
        settings.secret_key, 
        algorithm=settings.algorithm
    )
    return encoded_jwt

def verify_token(token : str , expected_type :str ="access"):
    if is_blacklist_token(token):
        logger.info("Rejected blacklisted token")
        return None
    
    try :
        payload = jwt.decode(
            token, 
            settings.secret_key, 
            algorithms=[settings.algorithm]
        )
        token_type = payload.get("type")
        if token_type != expected_type :
             return None
         
        username: str = payload.get("sub")
        role: str = payload.get("role")
        
        if username is None :
            return None
        
        return {"username": username, "role": role}
    
    except JWTError:
        return None

def authenticate_user(username: str, password: str) -> dict | None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT username, hashed_password, role FROM admin WHERE username = ?",
            (username,)
        )
        user = cursor.fetchone()
        if not user:
            return None
        
        if not verify_password(password, user["hashed_password"]):
            return None
        return {
            "username": user["username"],
            "role": user["role"]
        }
        
def create_admin_user(username: str, password: str, role: str = "admin"):
    """Create a new admin user"""
    hashed_password = get_hash_password(password)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO admin (username, hashed_password, role) VALUES (?, ?, ?)",
                (username, hashed_password, role)
            )
            return True
        except sqlite3.IntegrityError:
            return False
