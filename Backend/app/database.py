import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from app.config import get_settings

logger = logging.getLogger(__name__)
# logger để in log ra (debug, theo dõi hệ thống)

settings = get_settings()
# load config (db url, ...)


def get_db_path() -> str:
    """Get database file path from settings"""
    
    # lấy đường dẫn file db từ database_url
    db_path = settings.database_url.replace("sqlite:///", "")
    
    p = Path(db_path)
    if not p.is_absolute():
        # Nếu là đường dẫn tương đối, chuyển thành tuyệt đối dựa trên thư mục chứa app
        project_root = Path(__file__).resolve().parent.parent
        # Bỏ đi các tiền tố './' hoặc '.\' nếu có
        clean_path = db_path.lstrip("./").lstrip(".\\")
        p = project_root / clean_path
    
    # đảm bảo folder tồn tại (chưa có thì tạo)
    p.parent.mkdir(parents=True, exist_ok=True)  
    
    return str(p)


@contextmanager
def get_db_connection():
    """Context manager for database connections"""
    
    db_path = get_db_path()
    
    conn = sqlite3.connect(db_path)
    # mở kết nối tới database
    
    conn.row_factory = sqlite3.Row  
    # cho phép truy cập kiểu: row["column_name"] thay vì index
    
    try:
        yield conn
        # trả connection ra ngoài để dùng
        
        conn.commit()
        # nếu không lỗi → lưu thay đổi
        
    except Exception as e:
        conn.rollback()
        # nếu lỗi → rollback (tránh dữ liệu lỗi)
        
        raise e
        
    finally:
        conn.close()
        # luôn đóng connection (tránh leak)


def init_database():
    """Initialize database with required tables"""
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # ================== TABLE NODES ==================
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS nodes (
                id INTEGER PRIMARY KEY,
                x REAL NOT NULL,
                y REAL NOT NULL
            )
        """)
        # nodes = các điểm trên bản đồ (tọa độ x, y)
        
        
        # ================== TABLE EDGES ==================
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS edges (
                node_from INTEGER NOT NULL,
                node_to INTEGER NOT NULL,
                weight REAL NOT NULL,
                PRIMARY KEY (node_from, node_to),
                FOREIGN KEY (node_from) REFERENCES nodes(id),
                FOREIGN KEY (node_to) REFERENCES nodes(id)
            )
        """)
        # edges = đường nối giữa 2 node
        # weight = độ dài / chi phí đường
        # PRIMARY KEY (node_from, node_to) → không cho trùng đường
        
        
        # ================== INDEX ==================
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_edges_from 
            ON edges(node_from)
        """)
        # index giúp tìm nhanh theo node_from
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_edges_to 
            ON edges(node_to)
        """)
        # index giúp tìm nhanh theo node_to
        
        
        # ================== ADMIN TABLE ==================
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                hashed_password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin'
            )
        """)
        # bảng admin:
        # username: duy nhất
        # hashed_password: mật khẩu đã hash (không lưu plain)
        # role: phân quyền (mặc định admin)
        
        
        conn.commit()
        logger.info("Database tables created successfully")
        # log ra khi tạo xong db