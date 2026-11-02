import logging
from fastapi import APIRouter , HTTPException , Query, status
from app.Services.pathfinding import get_pathfinding_service
from app.Services.routing import find_multimodal_path
from app.database import get_db_connection 
from app.config import get_settings 

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags = ["Pathfinding"])

settings = get_settings()

@router.get("/path")
async def find_path(
    start_x: float = Query(..., description="Starting Latitude coordinate"),
    start_y: float = Query(..., description="Starting Longitude coordinate"),
    end_x: float = Query(..., description="Ending Latitude coordinate"),
    end_y: float = Query(..., description="Ending Longitude coordinate"),
    vehicle: str = Query("foot", description="Vehicle type: 'car', 'foot', or 'motorbike'"),
    speed: float = Query(1.0, description="Speed of vehicle (m/s)"),
    mode: str = Query("all", description="Routing mode: 'all', 'metro', or 'road'")
):
    result = find_multimodal_path(start_x, start_y, end_x, end_y, vehicle, speed, mode=mode)
    
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No path found between the specified points. Make sure both points are near valid nodes."
        )
    
    return result

@router.post("/path/reload")
async def reload_graph():
    """
    Reload graph from database
    Call this after updating edge weights or scenarios
    """
    from app.Services.routing import clear_metro_cache
    service = get_pathfinding_service()
    service.reload_graph()
    clear_metro_cache()
    
    return {
        "message": "Graph reloaded successfully",
    }
    
@router.get("/nodes", tags=["nodes"])
async def get_all_nodes():
    """
    Lấy danh sách tất cả các node (điểm) có trong cơ sở dữ liệu.
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, x, y FROM nodes")
            
            nodes = [dict(row) for row in cursor.fetchall()]
            
            return {"nodes": nodes}
            
    except Exception as e:
        logger.error("Error fetching nodes: %s", e)
        raise HTTPException(status_code=500, detail="Internal server error while fetching nodes")
