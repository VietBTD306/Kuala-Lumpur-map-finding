from typing import Dict
from app.Services.pathfinding import get_pathfinding_service

METRO_CACHE = {}

def clear_metro_cache():
    """Clear the cached metro paths, called when graph weights reload"""
    global METRO_CACHE
    METRO_CACHE.clear()

def _split_metro_path(service, path_metro, metro_speed) -> list:
    """
    Splits a metro path into alternating 'metro' and 'transfer' segments
    based on the presence of transfer edges in the graph.
    """
    path_coords = path_metro.get('path', [])
    node_ids = path_metro.get('node_ids', [])
    
    if not path_coords or len(node_ids) < 2:
        return [{
            "mode": "metro",
            "description": "Take Metro",
            "time_seconds": path_metro.get('cost', 0),
            "distance_meters": path_metro.get('distance', 0),
            "details": path_metro
        }]
        
    transfer_edges = service.graphs['metro'].get('transfer_edges', set())
    transfer_details = service.graphs['metro'].get('transfer_details', {})
    metro_graph = service.graphs['metro']
    
    segments = []
    
    current_segment_nodes = [path_coords[0]]
    current_segment_node_ids = [node_ids[0]]
    current_segment_distance = 0
    current_segment_cost = 0
    
    for i in range(len(node_ids) - 1):
        u = node_ids[i]
        v = node_ids[i+1]
        
        is_transfer = (u, v) in transfer_edges
        
        edge_dist = 0
        edge_cost = 0
        for edge in metro_graph['adj_list'].get(u, []):
            if edge[0] == v:
                edge_cost = edge[1]
                edge_dist = edge[2]
                break
        
        if is_transfer:
            # Close the current metro segment if it has elements
            if len(current_segment_nodes) > 1:
                segments.append({
                    "mode": "metro",
                    "description": "Take Metro",
                    "time_seconds": round((current_segment_cost / metro_speed), 2),
                    "distance_meters": round(current_segment_distance, 2),
                    "details": {
                        "path": current_segment_nodes,
                        "node_ids": current_segment_node_ids,
                        "distance": round(current_segment_distance, 2),
                        "cost": round((current_segment_cost / metro_speed), 2),
                        "nodes": len(current_segment_node_ids)
                    }
                })
            
            # Add the transfer segment (convert penalty meters back to seconds)
            transfer_time_seconds = round(edge_cost / metro_speed, 2)
            
            details = transfer_details.get((u, v), {
                'from_station_name': 'Ga Metro',
                'from_station_ref': '',
                'to_station_name': 'Ga Metro',
                'to_station_ref': '',
                'distance': edge_dist
            })
            
            from_name = details['from_station_name']
            from_ref = f" ({details['from_station_ref']})" if details['from_station_ref'] else ""
            to_name = details['to_station_name']
            to_ref = f" ({details['to_station_ref']})" if details['to_station_ref'] else ""
            real_dist = details.get('distance', edge_dist)
            
            if from_name == to_name:
                description = f"Chuyển tuyến tại ga {from_name}{from_ref}"
            else:
                description = f"Đi bộ chuyển tuyến từ ga {from_name}{from_ref} sang ga {to_name}{to_ref}"
            
            segments.append({
                "mode": "transfer",
                "description": description,
                "time_seconds": transfer_time_seconds,
                "distance_meters": round(real_dist, 2),
                "details": {
                    "path": [path_coords[i], path_coords[i+1]],
                    "node_ids": [u, v],
                    "distance": round(real_dist, 2),
                    "cost": transfer_time_seconds,
                    "nodes": 2,
                    "from_station_name": from_name,
                    "from_station_ref": details.get('from_station_ref', ''),
                    "to_station_name": to_name,
                    "to_station_ref": details.get('to_station_ref', '')
                }
            })
            
            # Reset current segment for next metro part starting at v
            current_segment_nodes = [path_coords[i+1]]
            current_segment_node_ids = [v]
            current_segment_distance = 0
            current_segment_cost = 0
        else:
            # Continue the current metro segment
            current_segment_nodes.append(path_coords[i+1])
            current_segment_node_ids.append(v)
            current_segment_distance += edge_dist
            current_segment_cost += edge_cost
            
    # Add final metro segment if it has nodes
    if len(current_segment_nodes) > 1:
        segments.append({
            "mode": "metro",
            "description": "Take Metro",
            "time_seconds": round((current_segment_cost / metro_speed), 2),
            "distance_meters": round(current_segment_distance, 2),
            "details": {
                "path": current_segment_nodes,
                "node_ids": current_segment_node_ids,
                "distance": round(current_segment_distance, 2),
                "cost": round((current_segment_cost / metro_speed), 2),
                "nodes": len(current_segment_node_ids)
            }
        })
        
    return segments

def _find_best_multimodal_plan(
    service,
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    type: str,
    speed: float,
    metro_speed: float,
    allow_transfers: bool
) -> Dict:
    """Helper to find the best multimodal plan (with or without transfers)"""
    WAITING_TIME_PENALTY = 240  # thời gian chờ tàu tại ga

    # Get up to 4 nearest station candidates
    start_metros = service.find_nearest_metro_nodes(start_x, start_y, n=4)
    end_metros = service.find_nearest_metro_nodes(end_x, end_y, n=4)

    # Dynamic filter: if the 4th nearest station is > 20% further than the 3rd, drop it
    if len(start_metros) == 4:
        if start_metros[3]['distance_meter'] > start_metros[2]['distance_meter'] * 1.20:
            start_metros.pop()
    if len(end_metros) == 4:
        if end_metros[3]['distance_meter'] > end_metros[2]['distance_meter'] * 1.20:
            end_metros.pop()

    best_plan = None
    best_time = float('inf')

    to_metro_cache = {}
    from_metro_cache = {}

    for s_metro in start_metros:
        s_coord = (s_metro['x'], s_metro['y'])

        if s_coord not in to_metro_cache:
            to_metro_cache[s_coord] = service.find_path(
                start_x, start_y, s_coord[0], s_coord[1], type, speed
            )

        path_to_start = to_metro_cache[s_coord]
        if not path_to_start or path_to_start['cost'] == "Blocked":
            continue

        time_to_station = path_to_start['cost']

        # prune level 1
        if time_to_station + WAITING_TIME_PENALTY >= best_time:
            continue

        for e_metro in end_metros:
            if s_metro['node_id'] == e_metro['node_id']:
                continue

            e_coord = (e_metro['x'], e_metro['y'])

            if e_coord not in from_metro_cache:
                from_metro_cache[e_coord] = service.find_path(
                    e_coord[0], e_coord[1], end_x, end_y, type, speed
                )

            path_to_end = from_metro_cache[e_coord]
            if not path_to_end or path_to_end['cost'] == "Blocked":
                continue

            time_to_dest = path_to_end['cost']
            
            if time_to_station + WAITING_TIME_PENALTY + time_to_dest >= best_time:
                continue

            # Cache key includes allow_transfers to prevent direct vs transfer collisions
            key = (s_metro['node_id'], e_metro['node_id'], metro_speed, allow_transfers)

            if key not in METRO_CACHE:
                METRO_CACHE[key] = service.find_path(
                    s_coord[0], s_coord[1],
                    e_coord[0], e_coord[1],
                    'metro', metro_speed,
                    allow_transfers=allow_transfers
                )

            path_metro = METRO_CACHE[key]

            if not path_metro or path_metro['cost'] == "Blocked":
                continue

            time_on_metro = path_metro['cost']

            if time_to_station + WAITING_TIME_PENALTY + time_on_metro + time_to_dest >= best_time:
                continue

            total_time = (
                time_to_station +
                WAITING_TIME_PENALTY +
                time_on_metro +
                time_to_dest
            )

            if total_time < best_time:
                best_time = total_time
                
                # Split metro path into sub-segments if transfers are allowed
                if allow_transfers:
                    metro_segments = _split_metro_path(service, path_metro, metro_speed)
                else:
                    metro_segments = [
                        {
                            "mode": "metro",
                            "description": "Take Metro",
                            "time_seconds": time_on_metro,
                            "distance_meters": path_metro['distance'],
                            "details": path_metro
                        }
                    ]
                
                best_plan = {
                    "routing_type": f"multimodal_{type}",
                    "total_time_seconds": round(total_time, 2),
                    "total_time_minutes": round(total_time / 60, 2),
                    "total_distance_meters": round(
                        path_to_start['distance'] +
                        path_metro['distance'] +
                        path_to_end['distance'], 2
                    ),
                    "start_metro_id": s_metro['node_id'],
                    "end_metro_id": e_metro['node_id'],
                    "start_metro_name": s_metro.get('name', 'Ga Metro'),
                    "end_metro_name": e_metro.get('name', 'Ga Metro'),
                    "segments": [
                        {
                            "mode": type,
                            "description": f"{type.capitalize()} to {s_metro.get('name', 'Metro Station')}",
                            "time_seconds": time_to_station,
                            "distance_meters": path_to_start['distance'],
                            "details": path_to_start
                        },
                        {
                            "mode": "transfer",
                            "description": "Wait for Metro",
                            "time_seconds": WAITING_TIME_PENALTY,
                            "distance_meters": 0
                        }
                    ] + metro_segments + [
                        {
                            "mode": type,
                            "description": f"{type.capitalize()} to Destination",
                            "time_seconds": time_to_dest,
                            "distance_meters": path_to_end['distance'],
                            "details": path_to_end
                        }
                    ]
                }

    return best_plan

def find_multimodal_path(
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    type: str,
    speed: float = 1.5,
    metro_speed: float = 10.0,
    mode: str = "all"
) -> Dict:
    
    service = get_pathfinding_service()

    result = {
        "direct": None,
        "multimodal": None,
        "multimodal_direct_metro": None
    }

    # ==========================================
    # 1. DIRECT
    # Tìm đường thẳng đi trực tiếp mà không cần qua metro
    # ==========================================
    if mode in ("all", "road"):
        direct = service.find_path(start_x, start_y, end_x, end_y, type, speed)

        if direct and direct['cost'] != "Blocked":
            result["direct"] = {
                "routing_type": f"direct_{type}",
                "total_time_seconds": direct['cost'],
                "total_time_minutes": round(direct['cost'] / 60, 2),
                "total_distance_meters": direct['distance'],
                "segments": [
                    {
                        "mode": type,
                        "description": f"{type.capitalize()} directly to destination",
                        "time_seconds": direct['cost'],
                        "distance_meters": direct['distance'],
                        "details": direct
                    }
                ]
            }

    # ==========================================
    # 2. MULTIMODAL (With Transfers Allowed)
    # ==========================================
    if mode in ("all", "metro"):
        result["multimodal"] = _find_best_multimodal_plan(
            service, start_x, start_y, end_x, end_y, type, speed, metro_speed, allow_transfers=True
        )

    # ==========================================
    # 3. MULTIMODAL DIRECT METRO (No Transfers)
    # ==========================================
        result["multimodal_direct_metro"] = _find_best_multimodal_plan(
            service, start_x, start_y, end_x, end_y, type, speed, metro_speed, allow_transfers=False
        )

    return result