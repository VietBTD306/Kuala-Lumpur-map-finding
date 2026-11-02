from pydantic import BaseModel
from typing import Literal, List, Optional

class Point(BaseModel):
    """Geographic point"""
    lat: float
    lng: float


class ScenarioRequest(BaseModel):
    """Dữ liệu client gửi lên để tạo tắc đường"""
    
    scenario_type: Literal["rain", "metro-block"]   
    
    line_start: Point
    line_end: Point
    # 2 điểm này tạo thành 1 đoạn đường bị ảnh hưởng
    
    penalty_weight: float
    # mức độ "phạt"
    
    threshold: float = 50.0
    # ngưỡng ảnh hưởng 

    points: Optional[List[Point]] = None
    # danh sách các điểm click để vẽ hình bao mềm mại
    
    class Config:
        json_schema_extra = {
            "example": {
                "scenario_type": "rain", 
                "line_start": {"lat": 21.0, "lng": 105.8},
                "line_end": {"lat": 21.1, "lng": 105.9},
                "penalty_weight": 50.0,
                "threshold": 50.0
            }
        }


class ScenarioResponse(BaseModel):
    message: str  
    # thông báo trả về (ok, created,...)
    affected_edges: int   
    # số đoạn đường bị ảnh hưởng
    scenario_type: str
    blocked_path: Optional[List[List[Point]]] = None


class ScenarioItem(ScenarioRequest):
    id: int
    # id để quản lý 
    
    active: bool = True
    # còn hiệu lực hay không (bật/tắt)
    
    blocked_path: Optional[List[List[Point]]] = None