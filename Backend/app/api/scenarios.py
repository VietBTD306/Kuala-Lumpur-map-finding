import logging
from fastapi import APIRouter , Depends , HTTPException

logger =logging.getLogger(__name__)
from typing import List

#Import schemas
from app.Shemas.scenario import ScenarioRequest, ScenarioResponse ,ScenarioItem
#Import services
from app.Services.scenario import get_scenario_service
from app.Services.pathfinding import get_pathfinding_service
from app.Dependencies.access_control import require_admin

router = APIRouter (prefix= "/scenarios" , tags= ["Scenarios"])

@router.get("/" , response_model= List[ScenarioItem])
@router.get("" , response_model= List[ScenarioItem])
async def get_scenarios():
    return get_scenario_service().active_scenarios

@router.post("/" , response_model = ScenarioResponse )
@router.post("" , response_model = ScenarioResponse )
async def create_scenario(
    request: ScenarioRequest,
    _= Depends(require_admin)
):
    """
    Tạo kịch bản mới:
    1. Tính toán hình học (ScenarioService)
    2. Cập nhật RAM (PathfindingService)
    """
    pf_service = get_pathfinding_service()
    sc_service = get_scenario_service()
    
    points_list = None
    if request.points:
        points_list = [(pt.lat, pt.lng) for pt in request.points]

    affected_edges_map = sc_service.calculate_affected_edges(
        pathfinding_service=pf_service,
        line_p1=(request.line_start.lat, request.line_start.lng),
        line_p2=(request.line_end.lat, request.line_end.lng),
        threshold=request.threshold,
        scenario_type=request.scenario_type,
        points=points_list
    )
    
    total_affected = 0
    for v_type,edges in affected_edges_map.items():
        total_affected += len(edges)
        for u,v in edges:
            pf_service.update_weight_in_ram(u,v,request.penalty_weight, v_type)
            
    # Calculate snapped blocked path coordinates as a single clean sorted line
    blocked_path = []
    
    if request.scenario_type == "metro-block" and request.points and len(request.points) >= 2:
        v_type = "metro"
        graph = pf_service.graphs[v_type]
        nodes = graph["nodes"]
        
        path_nodes = []
        # For metro blocks, keep the existing A* tracing logic
        for idx in range(len(request.points) - 1):
            p1 = request.points[idx]
            p2 = request.points[idx+1]
            
            n1 = pf_service.find_nearest_node(p1.lat, p1.lng, v_type)
            n2 = pf_service.find_nearest_node(p2.lat, p2.lng, v_type)
            
            if n1 is not None and n2 is not None:
                if n1 == n2:
                    if len(path_nodes) == 0 or path_nodes[-1] != n1:
                        path_nodes.append(n1)
                    continue
                
                path_res = pf_service.a_star(n1, n2, v_type, speed=1.0, allow_transfers=False)
                if not path_res:
                    path_res = pf_service.a_star(n2, n1, v_type, speed=1.0, allow_transfers=False)
                    if path_res and "node_ids" in path_res:
                        path_res["node_ids"] = list(reversed(path_res["node_ids"]))
                
                if path_res and "node_ids" in path_res:
                    node_ids = path_res["node_ids"]
                    for node_id in node_ids:
                        if len(path_nodes) == 0 or path_nodes[-1] != node_id:
                            path_nodes.append(node_id)
                else:
                    # Fallback to straight line connecting snapped endpoints if A* fails
                    if len(path_nodes) == 0 or path_nodes[-1] != n1:
                        path_nodes.append(n1)
                    path_nodes.append(n2)
        
        # Build ordered segments
        for idx in range(len(path_nodes) - 1):
            u = path_nodes[idx]
            v = path_nodes[idx+1]
            if u in nodes and v in nodes:
                blocked_path.append([
                    {"lat": nodes[u][0], "lng": nodes[u][1]},
                    {"lat": nodes[v][0], "lng": nodes[v][1]}
                ])
    
    from app.Services.routing import clear_metro_cache
    
    # Save blocked_path in scenario dict
    scenario_dict = request.dict()
    scenario_dict["blocked_path"] = blocked_path
    saved_scenario = sc_service.add_scenario(scenario_dict, affected_edges_map)
    
    clear_metro_cache()
    
    logger.info("Applied scenario %s to %d edges.", request.scenario_type, total_affected)
    return ScenarioResponse(
        message="Scenario applied successfully (In-Memory)",
        affected_edges=total_affected,
        scenario_type=request.scenario_type,
        blocked_path=blocked_path
    )

@router.delete("/{scenario_id}")
async def delete_scenario(
    scenario_id: int,
    _=Depends(require_admin)
):
    """
    Xóa kịch bản:
    Chiến thuật: Reset RAM về gốc -> Apply lại các kịch bản còn lại.
    (Đây là cách an toàn nhất để tránh sai lệch trọng số)
    """
    pf_service = get_pathfinding_service()
    sc_service = get_scenario_service()
    
    #Xóa khỏi danh sách quản lý
    success =sc_service.remove_scenario(scenario_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    from app.Services.routing import clear_metro_cache
    pf_service.reset_weights_in_ram()
    for scenario in sc_service.active_scenarios:
        penalty = scenario['penalty_weight']
        for v_type, edges in scenario['affected_edges_map'].items():
            for u, v in edges:
                pf_service.update_weight_in_ram(u, v, penalty, v_type)
                
    clear_metro_cache()
    logger.info("Scenario %d removed. Graph refreshed.", scenario_id)
    return {"message": "Scenario deleted and graph updated"}

@router.delete("/")
@router.delete("")
async def clear_all_scenarios(_=Depends(require_admin)):
    """Xóa tất cả kịch bản (Nút Clear All)"""
    pf_service = get_pathfinding_service()
    sc_service = get_scenario_service()
    
    # 1. Xóa danh sách
    sc_service.clear_all()
    
    # 2. Reset RAM về zin
    pf_service.reset_weights_in_ram()
    
    from app.Services.routing import clear_metro_cache
    clear_metro_cache()
    
    logger.info("All scenarios cleared. Graph reset to original.")
    return {"message": "All scenarios cleared"}
