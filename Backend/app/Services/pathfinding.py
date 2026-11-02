import logging
import heapq
import math 
import threading
from collections import defaultdict
from typing import List, Tuple, Dict, Optional
from scipy.spatial import KDTree
from app.database import get_db_connection
from app.config import  get_settings

logger =logging.getLogger(__name__)
settings = get_settings()

PIXEL_TO_METER_RATIO = 1.0
DEGREE_TO_METER_RATIO = 111000
BLOCKED_COST_THRESHOLD = 100000
VALID_VEHICLE_TYPES = {'car', 'foot', 'motorbike', 'metro'}

class PathfindingService :
    def __init__(self):
        self.graphs = {
            'car': {'nodes': {}, 'adj_list': {}, 'in_degrees': {}, 'main_component': None},
            'foot': {'nodes': {}, 'adj_list': {}, 'in_degrees': {}, 'main_component': None},
            'motorbike': {'nodes': {}, 'adj_list': {}, 'in_degrees': {}, 'main_component': None},
            'metro': {'nodes': {}, 'adj_list': {}, 'in_degrees': {}, 'main_component': None}
        }

        self.kd_trees = {}
        self.kd_tree_ids = {}
        self.vehicle_types = list(VALID_VEHICLE_TYPES)
        self.stations = {}
        self.station_kd_tree = None
        self.station_kd_tree_ids = []

        self.load_graph_from_db()
    
    def load_graph_from_db(self):
        try:
            logger.info("Loading graph from Disk to Memory...")
            with get_db_connection() as conn:
                cursor= conn.cursor()
                for v_type in self.vehicle_types:
                    if v_type not in VALID_VEHICLE_TYPES :
                        logger.warning("Invalid vehicle type '%s', skipping.", v_type)
                        continue 
                    
                    # Map motorbike to moto, and foot to foot tables in the DB
                    db_suffix = 'moto' if v_type == 'motorbike' else ('foot' if v_type == 'foot' else v_type)
                    table_nodes = f"nodes_{db_suffix}"
                    cursor.execute(f"SELECT id, x, y FROM {table_nodes}")
                    nodes= cursor.fetchall()
                                        
                    graphs = self.graphs[v_type]
                    
                    max_nid = 0
                    for node in nodes:
                        nid = node ['id']
                        graphs['nodes'][nid] = (node['y'], node['x'])
                        graphs['adj_list'][nid]= []
                        if nid > max_nid:
                            max_nid = nid
                    graphs['max_node_id'] = max_nid
                        
                    table_edges = f"edges_{db_suffix}"
                    cursor.execute(f"SELECT node_from, node_to, weight FROM {table_edges}")
                    edges = cursor.fetchall()
                    
                    # Store in-degrees to validate directed components (e.g. dead ends)
                    in_degrees = defaultdict(int)
                    
                    for edge in edges :
                        u = edge['node_from']
                        v = edge['node_to']
                        w = edge['weight']
                        
                        if u in graphs['nodes'] and v in graphs['nodes']:
                            if v_type == 'foot':
                                # Make walking undirected in RAM
                                graphs['adj_list'][u].append([v, w, w])
                                graphs['adj_list'][v].append([u, w, w])
                                in_degrees[u] += 1
                                in_degrees[v] += 1
                            else:
                                # Keep other modes directed
                                graphs['adj_list'][u].append([v, w, w])
                                in_degrees[v] += 1
                                
                    graphs['in_degrees'] = in_degrees
                    self._build_kd_tree(v_type)
                    self._compute_main_component(v_type)
                    
                    logger.info(
                        "Loaded %s graph: %d nodes, %d edges",
                        v_type, len(graphs['nodes']), len(edges)
                    )
            self.load_stations_from_db()
        except Exception as e:
            logger.error("Failed to load graph from database: %s", e)
            raise RuntimeError(f"Cannot load graph data: {e}") from e
    
    def _build_kd_tree(self, vehicle_type: str):
        """Build KD-Tree for fast nearest-node lookup O(log N)"""
        graph = self.graphs[vehicle_type]
        node_ids = list(graph['nodes'].keys())
        coords = [graph['nodes'][nid] for nid in node_ids]
        
        if coords:
            self.kd_trees[vehicle_type] = KDTree(coords)
            self.kd_tree_ids[vehicle_type] = node_ids
            logger.info("Built KD-Tree for %s: %d points", vehicle_type, len(coords))
    
    def update_weight_in_ram(self, u: int, v: int, penalty: float, vehicle_type: str):
        """
        Cập nhật trọng số trực tiếp trong RAM.
        Được gọi bởi ScenarioService. KHÔNG CHẠM VÀO DB.
        """
        if vehicle_type in self.graphs:
                
            # Keep weights inside adj_list in sync
            adj = self.graphs[vehicle_type]['adj_list']
            if u in adj:
                for edge in adj[u]:
                    if edge[0] == v:
                        edge[1] = edge[2] * penalty
                        break
            if v in adj:
                for edge in adj[v]:
                    if edge[0] == u:
                        edge[1] = edge[2] * penalty
                        break
                
    def reset_weights_in_ram(self):
        """
        Khôi phục trọng số về trạng thái gốc.
        Chỉ mất O(N) rất nhanh, không cần đọc lại DB.
        """
        for v_type in self.vehicle_types:
            
            # Reset weights inside adj_list
            adj = self.graphs[v_type]['adj_list']
            for u in adj:
                for edge in adj[u]:
                    edge[1] = edge[2] # current_weight = original_weight
        logger.info("Graph weights reset to original.")
        
    def heuristic(self, node_id: int, goal_id: int, nodes_map: Dict) -> float:
        if node_id not in nodes_map or goal_id not in nodes_map:
            return float('inf')
        
        x1, y1 = nodes_map[node_id]
        x2, y2 = nodes_map[goal_id]
        
        return math.hypot(x2 - x1, y2 - y1) * DEGREE_TO_METER_RATIO
    
    def _compute_main_component(self, vehicle_type: str):
        """Compute the largest connected component using DSU to filter out isolated subgraphs with minimal RAM usage"""
        if vehicle_type == 'metro':
            # Do not filter metro by LCC because metro lines are naturally disconnected raw graphs
            return
            
        graph = self.graphs[vehicle_type]
        adj = graph['adj_list']
        nodes = list(graph['nodes'].keys())
        
        if not nodes:
            graph['main_component'] = None
            return
            
        max_node_id = graph.get('max_node_id', max(nodes))
        parent = list(range(max_node_id + 1))
        
        def find_root(i: int) -> int:
            path = []
            curr = i
            while parent[curr] != curr:
                path.append(curr)
                curr = parent[curr]
            for node in path:
                parent[node] = curr
            return curr

        def union_nodes(i: int, j: int):
            root_i = find_root(i)
            root_j = find_root(j)
            if root_i != root_j:
                parent[root_i] = root_j
                
        for u in adj:
            for edge in adj[u]:
                v = edge[0]
                union_nodes(u, v)
                
        counts = defaultdict(int)
        for u in nodes:
            root = find_root(u)
            counts[root] += 1
            
        if not counts:
            graph['main_component'] = None
            return
            
        largest_root = max(counts, key=counts.get)
        
        main_comp_flags = [False] * (max_node_id + 1)
        largest_comp_size = 0
        for u in nodes:
            if find_root(u) == largest_root:
                main_comp_flags[u] = True
                largest_comp_size += 1
                
        graph['main_component'] = main_comp_flags
        logger.info(
            "Computed main component for %s: %d nodes (out of %d)",
            vehicle_type, largest_comp_size, len(nodes)
        )

    def find_nearest_node(self, x: float, y: float, vehicle_type: str, is_start: bool = True) -> Optional[int]:
        """Find nearest node using KD-Tree and filters out isolated components/dead ends"""
        if vehicle_type not in self.kd_trees:
            logger.warning("No KD-Tree for vehicle type '%s'", vehicle_type)
            return None
        
        kd_tree = self.kd_trees[vehicle_type]
        node_ids = self.kd_tree_ids[vehicle_type]
        
        if not node_ids:
            return None
            
        k_val = min(1000, len(node_ids))
        distances, indices = kd_tree.query([x, y], k=k_val)
        
        if k_val == 1:
            distances = [distances]
            indices = [indices]
            
        graph = self.graphs[vehicle_type]
        main_comp = graph.get('main_component', None)
        
        for idx in indices:
            nid = node_ids[idx]
            
            # 1. Must be part of the main connected component (if components are computed)
            if main_comp is not None:
                if nid >= len(main_comp) or not main_comp[nid]:
                    continue
                
            # 2. Check for dead ends in directed graphs (car, motorbike)
            if vehicle_type in ('car', 'motorbike'):
                if is_start:
                    # Must have at least one outgoing edge
                    if not graph['adj_list'].get(nid):
                        continue
                else:
                    # Must have at least one incoming edge
                    if graph.get('in_degrees', {}).get(nid, 0) == 0:
                        continue
                        
            return nid
            
        # Fallback to the absolute closest if none matched
        return node_ids[indices[0]]
    
    def a_star(self, start_id: int, goal_id: int, vehicle_type: str, speed: float, allow_transfers: bool = True) -> Optional[Dict]:
        if vehicle_type not in self.graphs:
            return None
            
        graph = self.graphs[vehicle_type]
        nodes = graph['nodes']
        
        if start_id not in nodes or goal_id not in nodes:
            return None
            
        max_node_id = graph.get('max_node_id', len(nodes)) + 1
        
        g_score = [float('inf')] * max_node_id
        g_score[start_id] = 0
        
        # Pre-retrieve goal coordinates
        goal_coords = nodes[goal_id]
        goal_y, goal_x = goal_coords
        
        f_score = [float('inf')] * max_node_id
        f_score[start_id] = math.hypot(goal_x - nodes[start_id][1], goal_y - nodes[start_id][0]) * DEGREE_TO_METER_RATIO
        
        visited = [False] * max_node_id
        came_from = {}
        
        open_set = [(f_score[start_id], start_id)]
        
        max_expansions = 500000
        expanded_count = 0
        
        adj_list = graph['adj_list']
        is_metro = (vehicle_type == 'metro')
        transfer_edges = graph.get('transfer_edges', set()) if is_metro else set()
        
        while open_set:
            current_f, current = heapq.heappop(open_set)
            
            if current == goal_id:
                return self._reconstruct_path(came_from, current, vehicle_type, speed)
            
            if visited[current]:
                continue
            
            visited[current] = True
            
            expanded_count += 1
            if expanded_count > max_expansions:
                logger.warning("A* search exceeded expansion limit of %d nodes", max_expansions)
                break
            
            for edge in adj_list.get(current, []):
                neighbor = edge[0]
                edge_weight = edge[1]
                
                if visited[neighbor]:
                    continue
                
                # Check transfer constraint for metro
                if is_metro and not allow_transfers:
                    if (current, neighbor) in transfer_edges:
                        continue
                
                tentative_g = g_score[current] + edge_weight
                
                if tentative_g < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    
                    # Inline heuristic computation
                    n_coords = nodes[neighbor]
                    h_val = math.hypot(goal_x - n_coords[1], goal_y - n_coords[0]) * DEGREE_TO_METER_RATIO
                    
                    f_score[neighbor] = tentative_g + h_val
                    heapq.heappush(open_set, (f_score[neighbor], neighbor))
        return None
    
    def _reconstruct_path(self, came_from: Dict, current: int, vehicle_type: str, speed: float) -> Dict:
        graph = self.graphs[vehicle_type]
        path = [current]
        while current in came_from:
            current = came_from[current]
            path.append(current)
        path.reverse()
        
        path_coords = []
        total_distance_physical = 0
        total_cost_weighted = 0
        
        for i, node_id in enumerate(path):
            x, y = graph['nodes'][node_id]
            path_coords.append({'node_id': node_id, 'x': x, 'y': y})
            
            if i < len(path) - 1:
                next_node = path[i+1]
                
                # Khoảng cách vật lý (trọng số gốc) và chi phí thực tế (trọng số hiện tại)
                w_orig = 0
                w_curr = 0
                for edge in graph['adj_list'].get(node_id, []):
                    if edge[0] == next_node:
                        w_curr = edge[1]
                        w_orig = edge[2]
                        break
                total_distance_physical += w_orig
                total_cost_weighted += w_curr
        
        if speed <= 0:
            speed = 1
        
        # Chuyển đổi pixel → mét
        total_distance_physical *= PIXEL_TO_METER_RATIO
        total_cost_weighted *= PIXEL_TO_METER_RATIO
        time_cost = round(total_cost_weighted / speed, 2)
        
        if total_cost_weighted > BLOCKED_COST_THRESHOLD:
            time_cost = "Blocked"
            
        return {
            'path': path_coords,
            'node_ids': path,
            'distance': round(total_distance_physical, 2),
            'cost': time_cost,
            'nodes': len(path)
        }
        
    def find_path(self, start_x: float, start_y: float, end_x: float, end_y: float, vehicle_type: str, speed: float, allow_transfers: bool = True) -> Optional[Dict]:

            
        if vehicle_type not in self.graphs:
            return None
            
        start_node = self.find_nearest_node(start_x, start_y, vehicle_type, is_start=True)
        end_node = self.find_nearest_node(end_x, end_y, vehicle_type, is_start=False)
        
        if start_node is None or end_node is None:
            return None
        
        if start_node == end_node:
            x, y = self.graphs[vehicle_type]['nodes'][start_node]
            return {
                'path': [{'node_id': start_node, 'x': x, 'y': y}],
                'node_ids': [start_node],
                'distance': 0, 'cost': 0, 'nodes': 1
            }
        
        return self.a_star(start_node, end_node, vehicle_type, speed, allow_transfers=allow_transfers)
    
    def reload_graph(self):
        self.graphs = {
            'car': {'nodes': {}, 'adj_list': {}, 'in_degrees': {}, 'main_component': None},
            'foot': {'nodes': {}, 'adj_list': {}, 'in_degrees': {}, 'main_component': None},
            'motorbike': {'nodes': {}, 'adj_list': {}, 'in_degrees': {}, 'main_component': None},
            'metro': {'nodes': {}, 'adj_list': {}, 'in_degrees': {}, 'main_component': None}
        }
        self.kd_trees = {}
        self.kd_tree_ids = {}
        self.stations = {}
        self.station_kd_tree = None
        self.station_kd_tree_ids = []
        self.load_graph_from_db()
        
    def load_stations_from_db(self):
        self.stations = {}
        self.graphs['metro']['transfer_edges'] = set()
        self.graphs['metro']['transfer_details'] = {}
        
        try:
            logger.info("Loading stations from nodes_station table...")
            with get_db_connection() as conn:
                cursor = conn.cursor()
                
                # Check if nodes_station table exists
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_station'")
                if not cursor.fetchone():
                    logger.warning("nodes_station table does not exist in database!")
                    return
                    
                cursor.execute("SELECT id, x, y, name, ref FROM nodes_station")
                rows = cursor.fetchall()
                
                for row in rows:
                    sid = row['id']
                    # y is latitude, x is longitude
                    self.stations[sid] = {
                        'id': sid,
                        'x': row['x'], # longitude
                        'y': row['y'], # latitude
                        'name': row['name'],
                        'ref': row['ref']
                    }
                
                # Build station KD-Tree
                station_ids = list(self.stations.keys())
                coords = [(self.stations[sid]['y'], self.stations[sid]['x']) for sid in station_ids]
                
                if coords:
                    self.station_kd_tree = KDTree(coords)
                    self.station_kd_tree_ids = station_ids
                    logger.info("Built KD-Tree for nodes_station: %d stations", len(coords))
                    
                # Build mapping from metro nodes to their parent stations using BFS
                self._build_metro_node_to_station_mapping()
                
                # Generate transfer edges
                self._generate_metro_transfer_edges()
                
        except Exception as e:
            logger.error("Failed to load stations: %s", e)

    def _find_anchor_node_for_station(self, sid: int) -> Optional[int]:
        """Find the closest metro node to a station that belongs to the same line component"""
        station = self.stations.get(sid)
        if not station:
            return None
            
        def get_station_prefixes(ref: str) -> set:
            if not ref:
                return set()
            prefixes = set()
            for part in ref.split(';'):
                part = part.strip()
                prefix = ""
                for char in part:
                    if char.isalpha():
                        prefix += char
                    else:
                        break
                if prefix:
                    prefixes.add(prefix.upper())
            return prefixes
            
        station_prefixes = get_station_prefixes(station['ref'])
        lat, lon = station['y'], station['x']
        
        graphs = self.graphs['metro']
        if self.kd_trees.get('metro') is not None and self.kd_tree_ids.get('metro'):
            kd_tree = self.kd_trees['metro']
            node_ids = self.kd_tree_ids['metro']
            
            k_val = min(15, len(node_ids))
            distances, indices = kd_tree.query([lat, lon], k=k_val)
            if k_val == 1:
                distances = [distances]
                indices = [indices]
                
            for idx in indices:
                nid = node_ids[idx]
                
                # Find the closest other station to this node
                closest_other_station = None
                min_other_dist = float('inf')
                for other_sid, other_station in self.stations.items():
                    if other_sid == sid:
                        continue
                    other_lat, other_lon = other_station['y'], other_station['x']
                    nid_coords = graphs['nodes'][nid]
                    d_other = math.hypot(nid_coords[0] - other_lat, nid_coords[1] - other_lon) * DEGREE_TO_METER_RATIO
                    if d_other < min_other_dist:
                        min_other_dist = d_other
                        closest_other_station = other_station
                        
                if closest_other_station:
                    other_prefixes = get_station_prefixes(closest_other_station['ref'])
                    if station_prefixes and other_prefixes and station_prefixes.intersection(other_prefixes):
                        return nid
                        
            # Fallback to the absolute closest node
            return node_ids[indices[0]]
            
        return None

    def _build_metro_node_to_station_mapping(self):
        """
        Associate each metro node in nodes_metro with its parent station(s) in nodes_station.
        Uses BFS traversal along the track network starting from station anchor nodes,
        constrained to a 250m radius.
        """
        self.metro_node_to_station = {}
        
        if not self.stations:
            return
            
        graphs = self.graphs['metro']
        adj = graphs['adj_list']
        nodes = graphs['nodes']
        
        # For each station, find its anchor metro node (closest metro node belonging to same line component)
        for sid, station in self.stations.items():
            anchor_node = self._find_anchor_node_for_station(sid)
            if anchor_node is None:
                continue
                
            # Perform BFS on track edges only
            queue = [(anchor_node, 0.0)]
            visited = {anchor_node: 0.0}
            
            idx = 0
            while idx < len(queue):
                curr_node, dist = queue[idx]
                idx += 1
                
                if curr_node not in self.metro_node_to_station:
                    self.metro_node_to_station[curr_node] = station
                else:
                    curr_coords = nodes[curr_node]
                    existing_station = self.metro_node_to_station[curr_node]
                    d_new = math.hypot(curr_coords[0] - station['y'], curr_coords[1] - station['x']) * DEGREE_TO_METER_RATIO
                    d_existing = math.hypot(curr_coords[0] - existing_station['y'], curr_coords[1] - existing_station['x']) * DEGREE_TO_METER_RATIO
                    if d_new < d_existing:
                        self.metro_node_to_station[curr_node] = station
                        
                for edge in adj.get(curr_node, []):
                    neighbor = edge[0]
                    n_coords = nodes.get(neighbor)
                    if n_coords is None:
                        continue
                    d_neighbor = math.hypot(n_coords[0] - station['y'], n_coords[1] - station['x']) * DEGREE_TO_METER_RATIO
                    
                    if d_neighbor <= 250.0:
                        if neighbor not in visited:
                            visited[neighbor] = d_neighbor
                            queue.append((neighbor, d_neighbor))

    def get_station_for_metro_node(self, node_id: int) -> Optional[Dict]:
        """Get the associated station for a metro node, with fallback to nearest by distance"""
        if hasattr(self, 'metro_node_to_station') and node_id in self.metro_node_to_station:
            return self.metro_node_to_station[node_id]
            
        # Fallback to absolute closest station by distance
        if not self.stations or node_id not in self.graphs['metro']['nodes']:
            return None
            
        lat, lon = self.graphs['metro']['nodes'][node_id]
        if self.station_kd_tree is not None and self.station_kd_tree_ids:
            _, index = self.station_kd_tree.query([lat, lon])
            sid = self.station_kd_tree_ids[index]
            return self.stations[sid]
            
        return None

    def _is_locally_connected(self, u: int, v: int) -> bool:
        """Check if u and v are already closely connected in the metro track graph"""
        adj_list = self.graphs['metro']['adj_list']
        if u == v:
            return True
        u_edges = adj_list.get(u, [])
        v_edges = adj_list.get(v, [])
        u_neighbors = {edge[0] for edge in u_edges}
        v_neighbors = {edge[0] for edge in v_edges}
        if v in u_neighbors or u in v_neighbors:
            return True
        if u_neighbors.intersection(v_neighbors):
            return True
        return False

    def _generate_metro_transfer_edges(self):
        """Automatically generate transfer edges between stations closer than 150m, and different tracks at same station in RAM"""
        if not self.stations:
            return
            
        stations_list = list(self.stations.values())
        graphs = self.graphs['metro']
        
        transfer_count = 0
        
        # 1. Connect different track lines passing through the same station (e.g. transfer hub like Kwasa Damansara)
        for s in stations_list:
            lat, lon = s['y'], s['x']
            # Find all metro nodes within 100m of the station coordinates
            if self.kd_trees.get('metro') is not None and self.kd_tree_ids.get('metro'):
                kd_tree = self.kd_trees['metro']
                node_ids = self.kd_tree_ids['metro']
                # 100 meters in degrees: 100 / DEGREE_TO_METER_RATIO
                indices = kd_tree.query_ball_point([lat, lon], r=100.0 / DEGREE_TO_METER_RATIO)
                nearby_nodes = [node_ids[idx] for idx in indices]
                
                # Connect pairs of nearby nodes if they are not locally connected
                for k in range(len(nearby_nodes)):
                    u = nearby_nodes[k]
                    u_coords = graphs['nodes'].get(u)
                    if u_coords is None:
                        continue
                    for l in range(k + 1, len(nearby_nodes)):
                        v = nearby_nodes[l]
                        v_coords = graphs['nodes'].get(v)
                        if v_coords is None:
                            continue
                            
                        if not self._is_locally_connected(u, v):
                            # Distance between u and v coordinates
                            d = math.hypot(v_coords[0] - u_coords[0], v_coords[1] - u_coords[1]) * DEGREE_TO_METER_RATIO
                            
                            # Add transfer edge
                            transfer_penalty_seconds = round((d / 1.0) + 120.0, 2)
                            transfer_penalty_meters = transfer_penalty_seconds * 10.0
                            
                            # Add bidirectional edges
                            added = False
                            if not any(edge[0] == v for edge in graphs['adj_list'][u]):
                                graphs['adj_list'][u].append([v, transfer_penalty_meters, transfer_penalty_meters])
                                added = True
                            if not any(edge[0] == u for edge in graphs['adj_list'][v]):
                                graphs['adj_list'][v].append([u, transfer_penalty_meters, transfer_penalty_meters])
                                added = True
                                
                            if added:
                                graphs['transfer_edges'].add((u, v))
                                graphs['transfer_edges'].add((v, u))
                            
                            # Resolve actual station for each node to correctly handle transfer markers
                            st_u = self.get_station_for_metro_node(u) or s
                            st_v = self.get_station_for_metro_node(v) or s
                            
                            # Store detailed mapping info
                            graphs['transfer_details'][(u, v)] = {
                                'from_station_name': st_u['name'],
                                'from_station_ref': st_u['ref'],
                                'to_station_name': st_v['name'],
                                'to_station_ref': st_v['ref'],
                                'distance': round(d, 2)
                            }
                            graphs['transfer_details'][(v, u)] = {
                                'from_station_name': st_v['name'],
                                'from_station_ref': st_v['ref'],
                                'to_station_name': st_u['name'],
                                'to_station_ref': st_u['ref'],
                                'distance': round(d, 2)
                            }
                            transfer_count += 1

        # 2. Connect different stations closer than 700m (station-to-station transfer at station areas)
        def get_line_prefixes(ref: str) -> set:
            if not ref:
                return set()
            prefixes = set()
            for part in ref.split(';'):
                part = part.strip()
                prefix = ""
                for char in part:
                    if char.isalpha():
                        prefix += char
                    else:
                        break
                if prefix:
                    prefixes.add(prefix.upper())
            return prefixes

        for i in range(len(stations_list)):
            s1 = stations_list[i]
            lat1, lon1 = s1['y'], s1['x']
            
            # Find all metro nodes within 100m of station s1 (these are the station nodes of s1)
            s1_nodes = []
            if self.kd_trees.get('metro') is not None and self.kd_tree_ids.get('metro'):
                kd_tree = self.kd_trees['metro']
                node_ids = self.kd_tree_ids['metro']
                s1_indices = kd_tree.query_ball_point([lat1, lon1], r=100.0 / DEGREE_TO_METER_RATIO)
                s1_nodes = [node_ids[idx] for idx in s1_indices]
            
            # Fallback to the single closest node to s1 coordinates if none are within 100m
            if not s1_nodes:
                u_near = self.find_nearest_node(lat1, lon1, 'metro')
                if u_near is not None:
                    s1_nodes = [u_near]
                    
            if not s1_nodes:
                continue
                
            for j in range(i + 1, len(stations_list)):
                s2 = stations_list[j]
                
                # Prevent connecting different stations on the same metro line
                pref1 = get_line_prefixes(s1['ref'])
                pref2 = get_line_prefixes(s2['ref'])
                if pref1 and pref2 and pref1.intersection(pref2):
                    continue
                    
                lat2, lon2 = s2['y'], s2['x']
                
                # Distance in meters between the two station hubs
                d = math.hypot(lat2 - lat1, lon2 - lon1) * DEGREE_TO_METER_RATIO
                
                if d <= 700.0:
                    # Find all metro nodes within 100m of station s2
                    s2_nodes = []
                    if self.kd_trees.get('metro') is not None and self.kd_tree_ids.get('metro'):
                        s2_indices = kd_tree.query_ball_point([lat2, lon2], r=100.0 / DEGREE_TO_METER_RATIO)
                        s2_nodes = [node_ids[idx] for idx in s2_indices]
                        
                    # Fallback to the single closest node to s2 coordinates if none are within 100m
                    if not s2_nodes:
                        v_near = self.find_nearest_node(lat2, lon2, 'metro')
                        if v_near is not None:
                            s2_nodes = [v_near]
                            
                    if not s2_nodes:
                        continue
                        
                    # Connect all station nodes of s1 to all station nodes of s2
                    for u in s1_nodes:
                        u_coords = graphs['nodes'].get(u)
                        if u_coords is None:
                            continue
                        for v in s2_nodes:
                            v_coords = graphs['nodes'].get(v)
                            if v_coords is None:
                                continue
                            if u == v:
                                continue
                            if self._is_locally_connected(u, v):
                                continue
                                
                            # Calculate distance between nodes u and v
                            d_nodes = math.hypot(v_coords[0] - u_coords[0], v_coords[1] - u_coords[1]) * DEGREE_TO_METER_RATIO
                            
                            # Calculate transfer penalty in seconds: distance / 1.0 m/s + 120s waiting time
                            transfer_penalty_seconds = round((d_nodes / 1.0) + 120.0, 2)
                            transfer_penalty_meters = transfer_penalty_seconds * 10.0
                            
                            # Add bidirectional edges
                            added = False
                            if not any(edge[0] == v for edge in graphs['adj_list'][u]):
                                graphs['adj_list'][u].append([v, transfer_penalty_meters, transfer_penalty_meters])
                                added = True
                            if not any(edge[0] == u for edge in graphs['adj_list'][v]):
                                graphs['adj_list'][v].append([u, transfer_penalty_meters, transfer_penalty_meters])
                                added = True
                                
                            if added:
                                graphs['transfer_edges'].add((u, v))
                                graphs['transfer_edges'].add((v, u))
                            
                            # Store detailed mapping info for segment generation
                            graphs['transfer_details'][(u, v)] = {
                                'from_station_name': s1['name'],
                                'from_station_ref': s1['ref'],
                                'to_station_name': s2['name'],
                                'to_station_ref': s2['ref'],
                                'distance': round(d_nodes, 2)
                            }
                            graphs['transfer_details'][(v, u)] = {
                                'from_station_name': s2['name'],
                                'from_station_ref': s2['ref'],
                                'to_station_name': s1['name'],
                                'to_station_ref': s1['ref'],
                                'distance': round(d_nodes, 2)
                            }
                            
                            transfer_count += 1
                            
        logger.info("Automatically generated %d bidirectional metro transfer edges in memory", transfer_count)

    def find_nearest_metro_nodes(self, x: float, y: float, n: int = 1) -> List[Dict]:
        """
        Find the n nearest metro stations from nodes_station.
        For each station, maps it to the closest node in nodes_metro.
        """
        # If nodes_station KDTree is built, use it to get real stations
        if self.station_kd_tree is not None and self.station_kd_tree_ids:
            distances, indices = self.station_kd_tree.query([x, y], k=min(n, len(self.station_kd_tree_ids)))
            
            if n == 1:
                distances = [distances]
                indices = [indices]
                
            results = []
            for i, idx in enumerate(indices):
                if idx >= len(self.station_kd_tree_ids):
                    continue
                    
                sid = self.station_kd_tree_ids[idx]
                station = self.stations[sid]
                
                # Map station coordinates to nearest nodes_metro ID
                metro_node_id = self.find_nearest_node(station['y'], station['x'], 'metro')
                if metro_node_id is None:
                    continue
                    
                # Warning log if distance from station to metro node is too large (> 300m)
                station_node_coords = self.graphs['metro']['nodes'][metro_node_id] # (lat, lon)
                node_dist = math.hypot(station_node_coords[0] - station['y'], station_node_coords[1] - station['x']) * DEGREE_TO_METER_RATIO
                if node_dist > 300.0:
                    logger.warning(
                        "Station '%s' (id:%d) maps to metro node %d which is %.1fm away (> 300m)!",
                        station['name'], sid, metro_node_id, node_dist
                    )
                    
                results.append({
                    'node_id': metro_node_id,
                    'station_id': sid,
                    'name': station['name'],
                    'ref': station['ref'],
                    'x': station['y'], # lat
                    'y': station['x'], # lon
                    'distance_pixel': round(distances[i], 5),
                    'distance_meter': round(distances[i] * DEGREE_TO_METER_RATIO, 2)
                })
            return results
            
        # Fallback to the old nodes_metro search if nodes_station table is empty
        logger.warning("nodes_station KDTree is not available, falling back to nodes_metro search.")
        vehicle_type = 'metro' 
        if vehicle_type not in self.kd_trees:
            return []

        kd_tree = self.kd_trees[vehicle_type]
        node_ids = self.kd_tree_ids[vehicle_type]
        graph_nodes = self.graphs[vehicle_type]['nodes']

        distances, indices = kd_tree.query([x, y], k=n)

        if n == 1:
            distances = [distances]
            indices = [indices]

        results = []
        for i, idx in enumerate(indices):
            if idx >= len(node_ids):
                continue
                
            node_id = node_ids[idx]
            node_coords = graph_nodes[node_id]
            
            results.append({
                'node_id': node_id,
                'station_id': None,
                'name': f"Ga Metro {node_id}",
                'ref': "",
                'x': node_coords[0],
                'y': node_coords[1],
                'distance_pixel': round(distances[i], 5),
                'distance_meter': round(distances[i] * DEGREE_TO_METER_RATIO, 2)
            })

        return results


# Thread-safe Singleton
_pathfinding_service = None
_pathfinding_lock = threading.Lock()

def get_pathfinding_service() -> PathfindingService:
    global _pathfinding_service
    if _pathfinding_service is None:
        with _pathfinding_lock:
            if _pathfinding_service is None:
                _pathfinding_service = PathfindingService()
    return _pathfinding_service
    
    
    
            
    
                
    


 