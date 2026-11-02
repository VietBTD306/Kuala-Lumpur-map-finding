import logging
import math
import threading
from typing import Any, Dict, List, Tuple, Optional

logger = logging.getLogger(__name__)


def point_to_segment_dist(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx = bx - ax
    dy = by - ay
    len_sq = dx*dx + dy*dy
    if len_sq == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / len_sq
    t = max(0.0, min(1.0, t))
    proj_x = ax + t * dx
    proj_y = ay + t * dy
    return math.hypot(px - proj_x, py - proj_y)


def get_segment_distance_meters(
    c1: Tuple[float, float], c2: Tuple[float, float],
    p1: Tuple[float, float], p2: Tuple[float, float]
) -> float:
    # coordinates are (lat, lng)
    ay, ax = c1[0] * 111000.0, c1[1] * 111000.0
    by, bx = c2[0] * 111000.0, c2[1] * 111000.0
    dy, dx = p1[0] * 111000.0, p1[1] * 111000.0
    fy, fx = p2[0] * 111000.0, p2[1] * 111000.0
    
    d1 = point_to_segment_dist(ay, ax, dy, dx, fy, fx)
    d2 = point_to_segment_dist(by, bx, dy, dx, fy, fx)
    d3 = point_to_segment_dist(dy, dx, ay, ax, by, bx)
    d4 = point_to_segment_dist(fy, fx, ay, ax, by, bx)
    return min(d1, d2, d3, d4)


def get_segment_alignment(
    c1: Tuple[float, float], c2: Tuple[float, float],
    p1: Tuple[float, float], p2: Tuple[float, float]
) -> float:
    # coordinates are (lat, lng)
    # Edge vector
    dy_e = (c2[0] - c1[0]) * 111000.0
    dx_e = (c2[1] - c1[1]) * 111000.0
    len_e = math.hypot(dy_e, dx_e)
    if len_e == 0:
        return 0.0
        
    # Segment vector
    dy_s = (p2[0] - p1[0]) * 111000.0
    dx_s = (p2[1] - p1[1]) * 111000.0
    len_s = math.hypot(dy_s, dx_s)
    if len_s == 0:
        return 0.0
        
    # Dot product of normalized vectors
    dot = (dy_e * dy_s + dx_e * dx_s) / (len_e * len_s)
    return abs(dot)



class ScenarioService:
    def __init__(self):
        self.active_scenarios: List[Dict[str, Any]] = []
        self.counter_id = 1

    def calculate_affected_edges(
        self,
        pathfinding_service,
        line_p1: Tuple[float, float],
        line_p2: Tuple[float, float],
        threshold: float,
        scenario_type: str,
        points: Optional[List[Tuple[float, float]]] = None,
    ) -> Dict[str, List[Tuple[int, int]]]:
        if scenario_type == "metro-block":
            v_types = ["metro"]
            affected_edges_by_type = {v_type: [] for v_type in v_types}
            
            if points and len(points) >= 2:
                for v_type in v_types:
                    graph = pathfinding_service.graphs[v_type]
                    nodes = graph["nodes"]
                    adj_list = graph["adj_list"]
                    
                    for idx in range(len(points) - 1):
                        p1 = points[idx]
                        p2 = points[idx+1]
                        
                        n1 = pathfinding_service.find_nearest_node(p1[0], p1[1], v_type)
                        n2 = pathfinding_service.find_nearest_node(p2[0], p2[1], v_type)
                        
                        if n1 is not None and n2 is not None:
                            if n1 == n2:
                                continue
                            
                            straight_dist = math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 111000
                            
                            path_res = pathfinding_service.a_star(n1, n2, v_type, speed=1.0, allow_transfers=False)
                            if not path_res:
                                path_res = pathfinding_service.a_star(n2, n1, v_type, speed=1.0, allow_transfers=False)
                                
                            is_valid_path = False
                            if path_res and "node_ids" in path_res and "distance" in path_res:
                                if path_res["distance"] <= max(200.0, straight_dist * 2.5):
                                    is_valid_path = True
                                    node_ids = path_res["node_ids"]
                                    for k in range(len(node_ids) - 1):
                                        u = node_ids[k]
                                        v = node_ids[k+1]
                                        if any(edge[0] == v for edge in adj_list.get(u, [])):
                                            affected_edges_by_type[v_type].append((u, v))
                                        if any(edge[0] == u for edge in adj_list.get(v, [])):
                                            affected_edges_by_type[v_type].append((v, u))
                            
                            if not is_valid_path:
                                c1 = nodes[n1]
                                c2 = nodes[n2]
                                line_vec_x = c2[0] - c1[0]
                                line_vec_y = c2[1] - c1[1]
                                len_sq = line_vec_x ** 2 + line_vec_y ** 2
                                
                                for u, neighbors in adj_list.items():
                                    if u not in nodes:
                                        continue
                                    for edge in neighbors:
                                        v = edge[0]
                                        if v not in nodes:
                                            continue
                                        ep1 = nodes[u]
                                        ep2 = nodes[v]
                                        mid_x = (ep1[0] + ep2[0]) / 2
                                        mid_y = (ep1[1] + ep2[1]) / 2
                                        
                                        if len_sq == 0:
                                            closest_x, closest_y = c1
                                        else:
                                            dot = (mid_x - c1[0]) * line_vec_x + (mid_y - c1[1]) * line_vec_y
                                            t = max(0, min(1, dot / len_sq))
                                            closest_x = c1[0] + t * line_vec_x
                                            closest_y = c1[1] + t * line_vec_y
                                            
                                        dist = math.hypot(mid_x - closest_x, mid_y - closest_y) * 111000
                                        if dist < 15.0:
                                            affected_edges_by_type[v_type].append((u, v))
                                        
                    affected_edges_by_type[v_type] = list(set(affected_edges_by_type[v_type]))
                return affected_edges_by_type


        # Fallback to default projection (e.g., rain or if points are missing)
        if scenario_type == "metro-block":
            v_types = ["metro"]
        else:
            v_types = ["car", "foot", "motorbike"]

        affected_edges_by_type = {v_type: [] for v_type in v_types}

        line_vec_x = line_p2[0] - line_p1[0]
        line_vec_y = line_p2[1] - line_p1[1]
        len_sq = line_vec_x ** 2 + line_vec_y ** 2

        for v_type in v_types:
            graph = pathfinding_service.graphs[v_type]
            nodes = graph["nodes"]
            adj_list = graph["adj_list"]

            for u, neighbors in adj_list.items():
                if u not in nodes:
                    continue
                for edge in neighbors:
                    v = edge[0]
                    if v not in nodes:
                        continue

                    p1 = nodes[u]
                    p2 = nodes[v]
                    mid_x = (p1[0] + p2[0]) / 2
                    mid_y = (p1[1] + p2[1]) / 2

                    if len_sq == 0:
                        closest_x, closest_y = line_p1
                    else:
                        dot = (mid_x - line_p1[0]) * line_vec_x + (mid_y - line_p1[1]) * line_vec_y
                        t = max(0, min(1, dot / len_sq))
                        closest_x = line_p1[0] + t * line_vec_x
                        closest_y = line_p1[1] + t * line_vec_y

                    dist = math.hypot(mid_x - closest_x, mid_y - closest_y) * 111000
                    if dist < threshold:
                        affected_edges_by_type[v_type].append((u, v))

        return affected_edges_by_type

    def add_scenario(self, scenario_data: Dict[str, Any], affected_edges_map: Dict[str, List[Tuple[int, int]]]):
        total_edges = sum(len(edges) for edges in affected_edges_map.values())
        new_scenario = {
            "id": self.counter_id,
            "active": True,
            **scenario_data,
            "affected_edges_map": affected_edges_map,
            "affected_edges": total_edges,
        }
        self.active_scenarios.append(new_scenario)
        self.counter_id += 1
        return new_scenario

    def remove_scenario(self, scenario_id: int):
        scenario = next((s for s in self.active_scenarios if s["id"] == scenario_id), None)
        if scenario:
            self.active_scenarios.remove(scenario)
            return True
        return False

    def clear_all(self):
        self.active_scenarios = []


_scenario_service = None
_scenario_lock = threading.Lock()


def get_scenario_service() -> ScenarioService:
    global _scenario_service
    if _scenario_service is None:
        with _scenario_lock:
            if _scenario_service is None:
                _scenario_service = ScenarioService()
    return _scenario_service
