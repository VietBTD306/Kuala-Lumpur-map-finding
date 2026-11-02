from pydantic import BaseModel, Field
# BaseModel: giúp validate dữ liệu (kiểm tra đúng kiểu, đúng format)
# Field: dùng để cấu hình chi tiết cho từng field (độ dài, bắt buộc,...)

# ================== LOGIN REQUEST ==================
class LoginRequest(BaseModel):
    # Dữ liệu client gửi lên khi đăng nhập
    
    username: str = Field(..., min_length=3, max_length=60)
    # username:
    # - kiểu string
    # - min_length=3: ít nhất 3 ký tự
    # - max_length=60: tối đa 60 ký tự
    
    password: str = Field(..., min_length=6)
    # password:
    # - ít nhất 6 ký tự (đảm bảo bảo mật cơ bản)
    
    remember_me: bool = False
    # remember_me:
    # - không bắt buộc
    # - mặc định = False
    # - nếu True → hệ thống sẽ giữ đăng nhập lâu hơn


# ================== TOKEN RESPONSE ==================
class TokenResponse(BaseModel):
    # Dữ liệu server trả về sau khi login thành công
    
    access_token: str
    # access_token:
    # - token chính dùng để gọi API
    # - client sẽ gửi lại token này trong header
    
    refresh_token: str
    # refresh_token:
    # - dùng để xin access_token mới khi token cũ hết hạn
    # - không dùng để gọi API trực tiếp
    
    token_type: str = "bearer"
    # token_type:
    # - loại token
    # - "bearer" nghĩa là chỉ cần có token là dùng được


# ================== TOKEN DATA ==================
class TokenData(BaseModel):
    # Dữ liệu bên trong token (sau khi decode)
    
    username: str | None = None
    # username:
    # - tên user
    # - có thể None nếu token không chứa
    
    role: str | None = None
    # role:
    # - quyền của user (admin/user)
    # - dùng để phân quyền API


# ================== REFRESH TOKEN REQUEST ==================
class RefreshTokenRequest(BaseModel):
    # Dữ liệu client gửi lên khi muốn lấy token mới
    
    refresh_token: str
    # refresh_token:
    # - dùng để xin access_token mới


# ================== USER RESPONSE ==================
class UserResponse(BaseModel):
    # Dữ liệu trả về khi lấy thông tin user
    
    username: str
    # tên user
    
    role: str
    # quyền của user (admin/user)