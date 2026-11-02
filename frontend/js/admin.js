/**
 * Admin Dashboard JavaScript
 * Handles map initialization and scenario management
 * Auth is handled by login.html — redirects if not authenticated
 */

// DOM Elements
const adminDashboard = document.getElementById('adminDashboard');
const welcomeMessage = document.getElementById('welcomeMessage');
const logoutBtn = document.getElementById('logoutBtn');
const statusMessage = document.getElementById('statusMessage');
const scenarioButtons = document.querySelectorAll('.btn-scenario');
const clearAllBtn = document.getElementById('clearAllBtn');
const toggleDeleteBtn = document.getElementById('toggleDeleteBtn');
const applyScenarioBtn = document.getElementById('applyScenarioBtn');

// State
let map;
let currentScenario = null;
let clickPoints = [];
let tempMarkers = [];
let scenarioHistory = [];
let isDeleteMode = false;
let tempLine = null;

/**
 * Draw blocked roads/metro with hatched style and red prohibition signs at both ends
 */
function createBlockedBarrier(p1_or_points, p2_or_scenarioType, scenarioType_or_null, clickedStart, clickedEnd) {
    let segments = [];
    let scenarioType = '';
    
    // Helper to normalize any latlng representation to [lat, lng]
    const norm = (pt) => {
        if (!pt) return [0, 0];
        if (Array.isArray(pt)) return [pt[0], pt[1]];
        if (pt.lat !== undefined && pt.lng !== undefined) return [pt.lat, pt.lng];
        return [0, 0];
    };
    
    if (Array.isArray(p1_or_points[0])) {
        // First element is an array. Is it a point [lat, lng] or a segment [[lat, lng], [lat, lng]]?
        if (Array.isArray(p1_or_points[0][0]) || (p1_or_points[0][0] && typeof p1_or_points[0][0] === 'object')) {
            // It is an array of segments: blocked_path
            segments = p1_or_points.map(seg => [norm(seg[0]), norm(seg[1])]);
            scenarioType = p2_or_scenarioType;
        } else {
            // It is an array of clicked points
            const points = p1_or_points.map(norm);
            for (let i = 0; i < points.length - 1; i++) {
                segments.push([points[i], points[i+1]]);
            }
            scenarioType = p2_or_scenarioType;
        }
    } else {
        // Form: createBlockedBarrier(p1, p2, scenarioType)
        const p1 = norm(p1_or_points);
        const p2 = norm(p2_or_scenarioType);
        segments = [[p1, p2]];
        scenarioType = scenarioType_or_null;
    }
    
    const group = L.layerGroup();
    if (!segments || segments.length === 0) return group;
    
    // Determine colors
    let mainColor = '#000000';
    let slashColor = scenarioType === 'metro-block' ? '#ff0055' : '#facc15';
    
    // Draw hatched line segments for each segment in the list
    segments.forEach(seg => {
        const pt1 = seg[0];
        const pt2 = seg[1];
        const latlngs = [pt1, pt2];
        
        // Draw main black line
        const mainLine = L.polyline(latlngs, {
            color: mainColor,
            weight: 6,
            opacity: 0.9
        });
        group.addLayer(mainLine);
        
        // Calculate slashes along the line
        const startLatLng = L.latLng(pt1[0], pt1[1]);
        const endLatLng = L.latLng(pt2[0], pt2[1]);
        const distMeters = startLatLng.distanceTo(endLatLng);
        const numSlashes = Math.floor(distMeters / 25);
        const steps = Math.max(3, numSlashes);
        
        const dLat = pt2[0] - pt1[0];
        const dLng = pt2[1] - pt1[1];
        
        // Approximate longitude scale factor
        const cosLat = Math.cos(pt1[0] * Math.PI / 180);
        const dLngScaled = dLng * cosLat;
        
        const angle = Math.atan2(dLat, dLngScaled);
        const slashAngle = angle + Math.PI / 4; // 45 degrees relative to line
        
        // Slash length: about 10 meters
        const slashLenLat = (10 / 111000) * Math.sin(slashAngle);
        const slashLenLng = (10 / (111000 * cosLat)) * Math.cos(slashAngle);
        
        for (let k = 1; k < steps; k++) {
            const t = k / steps;
            const cLat = pt1[0] + t * dLat;
            const cLng = pt1[1] + t * dLng;
            
            const slash = L.polyline([
                [cLat - slashLenLat, cLng - slashLenLng],
                [cLat + slashLenLat, cLng + slashLenLng]
            ], {
                color: slashColor,
                weight: 3,
                opacity: 0.9
            });
            group.addLayer(slash);
        }
    });
    
    // Add No Entry warning signs at the endpoints
    const banIconHtml = `
        <div style="display: flex; align-items: center; justify-content: center; background: white; border-radius: 50%; width: 22px; height: 22px; border: 2.5px solid #ef4444; box-shadow: 0 2px 6px rgba(0,0,0,0.4); box-sizing: border-box;">
            <div style="width: 12px; height: 3px; background: #ef4444; border-radius: 1px;"></div>
        </div>
    `;
    
    const banIcon = L.divIcon({
        className: 'custom-ban-marker',
        html: banIconHtml,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
    
    // Determine the startPoint and endPoint to place warning signs.
    // We deduplicate undirected segments to correctly identify path endpoints (leaf nodes of degree 1)
    const uniqueSegments = [];
    const seenSegs = new Set();
    
    segments.forEach(seg => {
        const pt1 = seg[0];
        const pt2 = seg[1];
        const k1 = `${pt1[0].toFixed(6)},${pt1[1].toFixed(6)}`;
        const k2 = `${pt2[0].toFixed(6)},${pt2[1].toFixed(6)}`;
        const segKey = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
        
        if (!seenSegs.has(segKey)) {
            seenSegs.add(segKey);
            uniqueSegments.push(seg);
        }
    });
    
    const nodeDegrees = {};
    const nodeCoords = {};
    
    uniqueSegments.forEach(seg => {
        const pt1 = seg[0];
        const pt2 = seg[1];
        
        // Group coordinates using a high-precision string key
        const key1 = `${pt1[0].toFixed(6)},${pt1[1].toFixed(6)}`;
        const key2 = `${pt2[0].toFixed(6)},${pt2[1].toFixed(6)}`;
        
        nodeDegrees[key1] = (nodeDegrees[key1] || 0) + 1;
        nodeDegrees[key2] = (nodeDegrees[key2] || 0) + 1;
        
        nodeCoords[key1] = pt1;
        nodeCoords[key2] = pt2;
    });
    
    // Leaf nodes have degree 1 (endpoints of paths)
    const leafKeys = Object.keys(nodeDegrees).filter(key => nodeDegrees[key] === 1);
    const leafNodes = leafKeys.map(key => nodeCoords[key]);
    
    // Fallback to all nodes if the blockage is a closed loop or has no leaf nodes
    const candidateNodes = leafNodes.length > 0 ? leafNodes : Object.values(nodeCoords);
    
    let startPoint = segments[0][0];
    let endPoint = segments[segments.length - 1][1];
    
    if (clickedStart && clickedEnd) {
        const normStart = norm(clickedStart);
        const normEnd = norm(clickedEnd);
        
        let minStartDist = Infinity;
        let minEndDist = Infinity;
        
        candidateNodes.forEach(node => {
            const distStart = Math.hypot(node[0] - normStart[0], node[1] - normStart[1]);
            if (distStart < minStartDist) {
                minStartDist = distStart;
                startPoint = node;
            }
            
            const distEnd = Math.hypot(node[0] - normEnd[0], node[1] - normEnd[1]);
            if (distEnd < minEndDist) {
                minEndDist = distEnd;
                endPoint = node;
            }
        });
    } else if (leafNodes.length === 2) {
        // If clicked points are not provided but we have exactly 2 leaf nodes, use them directly
        startPoint = leafNodes[0];
        endPoint = leafNodes[1];
    }
    
    const markerStart = L.marker(startPoint, { icon: banIcon });
    const markerEnd = L.marker(endPoint, { icon: banIcon });
    
    group.addLayer(markerStart);
    group.addLayer(markerEnd);
    
    return group;
}

/**
 * Initialize the application
 */
async function init() {
    // Check if user is authenticated
    if (authManager.isAuthenticated()) {
        const isValid = await authManager.verifyToken();
        if (isValid) {
            showDashboard();
            return;
        }
    }
    
    // Not authenticated — redirect to login page
    window.location.href = 'login.html?redirect=admin';
}

/**
 * Show admin dashboard
 */
function showDashboard() {
    adminDashboard.style.display = 'block';
    
    // Update welcome message
    welcomeMessage.textContent = `Welcome, ${authManager.getUsername()}`;
    
    // Initialize map if not already done
    if (!map) {
        initMap();
    }

    // Load existing scenarios from the backend
    loadAndDrawScenarios();
}

/**
 * Initialize Leaflet map with local image
 */
/*
function initMap() {
    // Create map with CRS.Simple for pixel coordinates
    map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -3,
        maxZoom: 2,
        zoomSnap: 0.25,
        zoomDelta: 0.25
    });
    
    // Calculate bounds for the image
    // Leaflet uses [y, x] format, so [height, width]
    const bounds = [[0, 0], [AppConfig.MAP_HEIGHT, AppConfig.MAP_WIDTH]];
    
    // Set the map bounds to prevent dragging outside the image
    map.setMaxBounds(bounds);
    map.on('drag', function() {
        map.panInsideBounds(bounds, { animate: false });
    });

    // Add the local map image
    L.imageOverlay(AppConfig.MAP_IMAGE_URL_ADMIN, bounds).addTo(map);
    
    // Set the map bounds
    map.fitBounds(bounds);
    
    // Set initial view to center of map
    map.setView([AppConfig.MAP_HEIGHT / 2, AppConfig.MAP_WIDTH / 2], -1);
    
    // Add click handler for scenario drawing
    map.on('click', onMapClick);
    
    updateStatus('Map initialized. Select a scenario to begin.');
}
*/

function getOriginalColorForFeature(feature) {
    let lineColor = feature.properties.stroke || 
                    feature.properties.color || 
                    feature.properties.colour || 
                    feature.properties.hex || 
                    feature.properties.route_color;
    
    if (!lineColor) {
        const lineName = (feature.properties.name || feature.properties.line || feature.properties.layer || "").toLowerCase();
        
        if (lineName.includes('kelana') || lineName.includes('kj') || lineName.includes('line 5')) {
            lineColor = '#e84c88'; // Hồng - Tuyến Kelana Jaya
        } else if (lineName.includes('ampang') || lineName.includes('ag') || lineName.includes('line 3')) {
            lineColor = '#f37023'; // Màu Cam - Tuyến Ampang
        } else if (lineName.includes('sri petaling') || lineName.includes('sp') || lineName.includes('line 4')) {
            lineColor = '#b32025'; // Đỏ đô - Tuyến Sri Petaling
        } else if (lineName.includes('kajang') || lineName.includes('kg') || lineName.includes('line 9')) {
            lineColor = '#00843d'; // Xanh lá - Tuyến Kajang
        } else if (lineName.includes('putrajaya') || lineName.includes('py') || lineName.includes('line 12')) {
            lineColor = '#fdb913'; // Vàng nghệ - Tuyến Putrajaya
        } else if (lineName.includes('monorail') || lineName.includes('mr') || lineName.includes('line 8')) {
            lineColor = '#78be20'; // Xanh đọt chuối - Tuyến Monorail
        } else if (lineName.includes('ekspres') || lineName.includes('line 6')) {
            lineColor = '#5c0632'; // Tím đậm - KLIA Ekspres
        } else if (lineName.includes('transit') || lineName.includes('line 7')) {
            lineColor = '#00a3e0'; // Xanh coban - KLIA Transit
        } else if (lineName.includes('brt') || lineName.includes('sunway')) {
            lineColor = '#006241'; // Xanh lá đậm (Forest Green) - Tuyến BRT Sunway
        } else {
            lineColor = '#4b5563'; // Màu xám mặc định nếu hoàn toàn không nhận diện được tuyến
        }
    }
    
    if (lineColor && !lineColor.startsWith('#') && lineColor.length === 6) {
        lineColor = '#' + lineColor;
    }
    
    return lineColor;
}

/**
 * Calculate the convex hull of N points using Andrew's Monotone Chain algorithm
 */
function getConvexHull(points) {
    if (points.length <= 2) return points;
    
    // Copy and sort points by latitude, then longitude
    const pts = points.map(p => [p[0], p[1]]).sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
    
    const crossProduct = (o, a, b) => {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    };
    
    const lower = [];
    for (let i = 0; i < pts.length; i++) {
        while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
            lower.pop();
        }
        lower.push(pts[i]);
    }
    
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
            upper.pop();
        }
        upper.push(pts[i]);
    }
    
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

/**
 * Smooth a closed polygon using Catmull-Rom spline interpolation
 */
function getCatmullRomSplineClosed(points, segmentsPerStep = 10) {
    if (points.length < 3) return points;
    
    const count = points.length;
    const interpolated = [];
    
    for (let i = 0; i < count; i++) {
        const p0 = points[(i - 1 + count) % count];
        const p1 = points[i];
        const p2 = points[(i + 1) % count];
        const p3 = points[(i + 2) % count];
        
        for (let step = 0; step < segmentsPerStep; step++) {
            const t = step / segmentsPerStep;
            const t2 = t * t;
            const t3 = t2 * t;
            
            const lat = 0.5 * (
                (2 * p1[0]) +
                (-p0[0] + p2[0]) * t +
                (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            );
            
            const lng = 0.5 * (
                (2 * p1[1]) +
                (-p0[1] + p2[1]) * t +
                (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            );
            
            interpolated.push([lat, lng]);
        }
    }
    
    return interpolated;
}

/**
 * Draw a soft, smooth enclosing shape for the rain area based on clicked points
 */
function createRainPolygon(points, scenarioData, onClick) {
    if (!points || points.length === 0) return null;
    
    let layer;
    if (points.length === 1) {
        // If 1 point, draw a circle with the default threshold radius
        const radius = scenarioData.threshold || 50;
        layer = L.circle(points[0], {
            radius: radius,
            color: scenarioData.color,
            fillColor: scenarioData.color,
            fillOpacity: 0.35,
            weight: 2
        });
    } else if (points.length === 2) {
        // If 2 points, construct a capsule with perfectly rounded circular ends
        const p1 = points[0];
        const p2 = points[1];
        const radiusMeters = scenarioData.threshold || 50;
        const R = radiusMeters / 111000; // Convert radius to degrees approx
        
        const dx = p2[1] - p1[1];
        const dy = p2[0] - p1[0];
        const len = Math.sqrt(dx * dx + dy * dy);
        
        if (len === 0) {
            layer = L.circle(p1, {
                radius: radiusMeters,
                color: scenarioData.color,
                fillColor: scenarioData.color,
                fillOpacity: 0.35,
                weight: 2
            });
        } else {
            const pointsList = [];
            const theta = Math.atan2(p2[0] - p1[0], p2[1] - p1[1]);
            
            // Semi-circle at p2 (ends)
            for (let angle = theta - Math.PI / 2; angle <= theta + Math.PI / 2; angle += Math.PI / 16) {
                const lat = p2[0] + R * Math.sin(angle);
                const lng = p2[1] + R * Math.cos(angle);
                pointsList.push([lat, lng]);
            }
            
            // Semi-circle at p1 (start)
            for (let angle = theta + Math.PI / 2; angle <= theta + 3 * Math.PI / 2; angle += Math.PI / 16) {
                const lat = p1[0] + R * Math.sin(angle);
                const lng = p1[1] + R * Math.cos(angle);
                pointsList.push([lat, lng]);
            }
            
            layer = L.polygon(pointsList, {
                color: scenarioData.color,
                fillColor: scenarioData.color,
                fillOpacity: 0.35,
                weight: 3,
                lineJoin: 'round'
            });
        }
    } else {
        // For N >= 3 points, calculate the convex hull and smooth it using Catmull-Rom spline
        const hull = getConvexHull(points);
        const smoothed = getCatmullRomSplineClosed(hull, 12); // 12 points per segment for very smooth curves
        
        layer = L.polygon(smoothed, {
            color: scenarioData.color,
            fillColor: scenarioData.color,
            fillOpacity: 0.35,
            weight: 3,
            lineJoin: 'round'
        });
    }
    
    if (layer && onClick) {
        layer.on('click', onClick);
    }
    return layer;
}

/**
 * Initialize Leaflet map with TileLayer and GeoJSON
 */
function initMap() {
    // 1. Định nghĩa các lớp bản đồ nền
    const detailLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    });

    const cleanLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB'
    });

    // 2. Khởi tạo map
    map = L.map('map', {
        minZoom: 10,
        maxZoom: 18,
        layers: [cleanLayer] // Mặc định là bản đồ đơn giản cho nhẹ mắt
    }).setView([3.1390, 101.6869], 11);

    // 3. Thêm nút chuyển đổi lớp bản đồ
    const baseMaps = {
        "Bản đồ Sáng": cleanLayer,
        "Bản đồ Chi tiết": detailLayer
    };
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

    // 4. Load và vẽ các tuyến metro có màu (từ file 1.geojson)
    fetch('map/1.geojson')
        .then(response => response.json())
        .then(data => {
            const linesLayer = L.geoJSON(data, {
                style: function(feature) {
                    let lineColor = getOriginalColorForFeature(feature);
                    return {
                        color: lineColor,
                        weight: 5,        // Độ dày đường ray
                        opacity: 0.9 
                    };
                }
            }).addTo(map);
            // Tự động căn chỉnh ống kính camera bao trọn toàn bộ mạng lưới Metro sau khi load xong
            map.fitBounds(linesLayer.getBounds());
        });

    // 5. Load và vẽ các chấm nhà ga tự động hiển thị/ẩn theo mức zoom (giống giao diện người dùng)
    const stationsLayer = L.layerGroup();
    const seenStationNames = new Set();
    const seenStations = new Set();

    fetch('map/railways.geojson')
        .then(response => response.json())
        .then(stationsData => {
            L.geoJSON(stationsData, {
                filter: function(feature) {
                    if (feature.geometry && feature.geometry.type === 'Point') {
                        const rawName = getStationNameFromFeature(feature);
                        const stationName = rawName.trim().toLowerCase();
                        
                        if (stationName) {
                            if (seenStationNames.has(stationName)) return false;
                            seenStationNames.add(stationName);
                            return true;
                        }
                        
                        const [lng, lat] = feature.geometry.coordinates;
                        const coordKey = `${lng.toFixed(4)},${lat.toFixed(4)}`;
                        if (seenStations.has(coordKey)) return false;
                        seenStations.add(coordKey);
                        return true;
                    }
                    return false;
                },
                pointToLayer: function(feature, latlng) {
                    const stationName = getStationNameFromFeature(feature);
                    let displayName = stationName;
                    const stationType = feature.properties.type || "Ga Metro"; 
                    
                    // Thu thập thông tin từ hệ thống quản lý hoặc quan hệ tuyến (@relations) nếu có
                    let network = feature.properties.network || "Hệ thống Metro";
                    let routeRef = feature.properties.ref || ""; 
                    let lineName = "";

                    if (feature.properties["@relations"] && feature.properties["@relations"].length > 0) {
                        const relation = feature.properties["@relations"][0]; // Lấy quan hệ đầu tiên gắn với ga này
                        if (relation.reltags) {
                            network = relation.reltags.network || relation.reltags["network:metro"] || network;
                            routeRef = relation.reltags.ref || routeRef;
                            lineName = relation.reltags["name:en"] || relation.reltags.name || "";
                        }
                    }

                    if (!displayName) {
                        const cleanLineName = lineName.replace(/\s*\(.*\)\s*$/, "");
                        displayName = routeRef && cleanLineName
                            ? `${routeRef} - ${cleanLineName}`
                            : (cleanLineName || (routeRef ? `Tuyến ${routeRef}` : "Chưa có tên ga trong GeoJSON"));
                    }

                    // Tạo chuỗi hiển thị mã tuyến / ký hiệu nếu có (ví dụ: [Tuyến số 12])
                    const routeSymbol = routeRef || feature.properties.ref || feature.properties.local_ref || "Chưa có";
                    const routeSymbolBadge = `<span style="background: #1e3a8a; color: white; padding: 1px 5px; border-radius: 3px; font-size: 10px;">${routeSymbol}</span>`;

                    const trainSvg = `
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;">
                        <path d="M4 4c0-1.1.9-2 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" fill="currentColor" fill-opacity="0.1"/>
                        <path d="M4 9h16"/>
                        <circle cx="7" cy="14" r="1" fill="currentColor"/>
                        <circle cx="17" cy="14" r="1" fill="currentColor"/>
                        <path d="M7 22l2-4"/>
                        <path d="M17 22l-2-4"/>
                    </svg>`;

                    const customIcon = L.divIcon({
                        className: 'station-icon',
                        html: trainSvg,
                        iconSize: [26, 26],
                        iconAnchor: [13, 13]
                    });

                    const marker = L.marker(latlng, { icon: customIcon });
                    
                    marker.bindTooltip(displayName, {
                        permanent: false,
                        direction: 'top',
                        className: 'station-label',
                        offset: [0, -10]
                    });

                    // Hiện Popup chi tiết định dạng đẹp khi click vào icon ga
                    const popupContent = `
                        <div style="font-family: 'Roboto', sans-serif; padding: 5px; min-width: 180px; max-width: 240px; color: #1e293b;">
                            <h4 style="margin: 0 0 6px 0; color: #1e3a8a; font-size: 14px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
                                <span>🚉 ${displayName}</span>
                            </h4>
                            <p style="margin: 3px 0; color: #475569; font-size: 12px;"><b>Hệ thống:</b> ${network}</p>
                            <p style="margin: 3px 0; color: #475569; font-size: 12px;"><b>Ký hiệu:</b> ${routeSymbolBadge}</p>
                            ${lineName ? `<p style="margin: 3px 0; color: #0369a1; font-size: 11px; background: #f0f9ff; padding: 3px; border-radius: 4px;"><b>Tuyến:</b> ${lineName}</p>` : ''}
                            ${!stationName ? `<p style="margin: 3px 0; color: #b45309; font-size: 11px; background: #fffbeb; padding: 3px; border-radius: 4px;"><b>Tên ga:</b> Chưa có trường name trong GeoJSON cho điểm này</p>` : ''}
                            <p style="margin: 3px 0; color: #475569; font-size: 12px;"><b>Loại trạm:</b> ${stationType}</p>
                            <p style="margin: 5px 0 0 0; color: #94a3b8; font-size: 10px; font-style: italic; border-top: 1px dashed #e2e8f0; padding-top: 4px;">Tọa độ: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</p>
                        </div>
                    `;
                    marker.bindPopup(popupContent);
                    
                    return marker;
                }
            }).addTo(stationsLayer);

            function checkZoomAndToggleStations() {
                const currentZoom = map.getZoom();
                if (currentZoom >= 15) {
                    if (!map.hasLayer(stationsLayer)) {
                        map.addLayer(stationsLayer);
                    }
                } else {
                    if (map.hasLayer(stationsLayer)) {
                        map.removeLayer(stationsLayer);
                    }
                }
            }

            map.on('zoomend', checkZoomAndToggleStations);
            checkZoomAndToggleStations();
        });

    function getStationNameFromFeature(feature) {
        const properties = feature.properties || {};
        return properties.name || properties.Name || properties["name:en"] || properties.title || "";
    }

    function getRouteInfoFromFeature(feature) {
        const relations = feature.properties && feature.properties["@relations"];
        const info = { refs: [], lineName: "" };

        if (!Array.isArray(relations)) return info;

        relations.forEach(relation => {
            const tags = relation.reltags || {};
            if (tags.ref && !info.refs.includes(tags.ref)) {
                info.refs.push(tags.ref);
            }
            if (!info.lineName) {
                info.lineName = tags["name:en"] || tags.name || "";
            }
        });

        return info;
    }

    function getStationDisplayName(feature) {
        const stationName = getStationNameFromFeature(feature);
        if (stationName) return stationName;

        const routeInfo = getRouteInfoFromFeature(feature);
        const lineName = routeInfo.lineName.replace(/\s*\(.*\)\s*$/, "");
        const routeRef = routeInfo.refs.join("/");

        if (routeRef && lineName) return `${routeRef} - ${lineName}`;
        if (lineName) return lineName;
        if (routeRef) return `Tuyến ${routeRef}`;
        return "Chưa có tên ga trong GeoJSON";
    }

    // Sự kiện click để lấy tọa độ nếu Admin cần tạo điểm mới
    map.on('click', onMapClick);
    
    updateStatus('Bản đồ đã khởi tạo. Vui lòng chọn một kịch bản để bắt đầu.');
}
/**
 * Handle logout
 */
logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to logout?')) {
        await authManager.logout();
        window.location.href = 'login.html';
    }
});

/**
 * Handle toggle delete mode button
 */
toggleDeleteBtn.addEventListener('click', () => {
    isDeleteMode = !isDeleteMode;

    if (isDeleteMode) {
        // De-select any active scenario when entering delete mode
        currentScenario = null;
        scenarioButtons.forEach(b => b.classList.remove('active'));
        clearTempMarkers();
        clickPoints = [];
    }

    updateDeleteModeUI();
});

/**
 * Handle scenario button clicks
 */
scenarioButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        // PREVENT SCENARIO SELECTION IF IN DELETE MODE
        if (isDeleteMode) {
            updateStatus('Không thể thêm kịch bản mới khi ở Chế độ Xóa. Vui lòng tắt nó trước.');
            // Ensure no scenario is active
            scenarioButtons.forEach(b => b.classList.remove('active'));
            currentScenario = null;
            return; // Stop further execution
        }

        const isAlreadyActive = btn.classList.contains('active');
        const scenarioKey = btn.dataset.scenario;
        const scenarioData = getScenarioData(scenarioKey);

        // Luôn xóa các điểm và marker tạm thời khi chuyển kịch bản hoặc hủy chọn kịch bản
        clickPoints = [];
        clearTempMarkers();

        // Xóa trạng thái active khỏi tất cả các nút
        scenarioButtons.forEach(b => b.classList.remove('active'));

        if (isAlreadyActive) {
            // Nếu nút đã được chọn, hủy chọn nó
            currentScenario = null;
            updateStatus('Đã hủy chọn kịch bản. Chọn một kịch bản để bắt đầu.');
        } else {
            // Nếu nút chưa được chọn, hãy kích hoạt nó
            btn.classList.add('active');
            currentScenario = scenarioKey;

            if (scenarioData.type === 'rain') {
                updateStatus(`Đã chọn kịch bản ${scenarioData.name}. Nhấp chuột chọn các điểm trên bản đồ để tạo vùng mưa, sau đó nhấp nút "Tạo Kịch Bản" ở thanh bên để hoàn tất.`);
            } else if (scenarioData.type === 'metro-block') {
                updateStatus(`Đã chọn kịch bản ${scenarioData.name}. Nhấp chọn các điểm dọc theo tuyến metro để xác định khu vực chặn tàu, sau đó nhấp nút "Tạo Kịch Bản" ở thanh bên để hoàn tất.`);
            }
        }
    });
});

/**
 * Handle map clicks for scenario drawing
 */
function onMapClick(e) {
    if (isDeleteMode) return; // Do nothing if in delete mode

    if (!currentScenario) {
        updateStatus('Vui lòng chọn một kịch bản trước.');
        return;
    }
    
    const scenarioData = getScenarioData(currentScenario);
    
    // Tất cả kịch bản (mưa, chặn tàu, chặn đường) đều cho phép chọn N điểm để vẽ đúng cung đường chặn
    clickPoints.push([e.latlng.lat, e.latlng.lng]);
    
    // Vẽ điểm marker tạm thời
    let markerColor = '#3b82f6'; // Mặc định mưa
    if (scenarioData.type === 'metro-block') markerColor = '#ff0055';
    
    const marker = L.circleMarker(e.latlng, {
        radius: 6,
        fillColor: markerColor,
        color: '#fff',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.8
    }).addTo(map);
    tempMarkers.push(marker);
    
    // Vẽ hình bao / đường tạm thời trên bản đồ theo thời gian thực
    if (clickPoints.length > 0) {
        if (tempLine) {
            map.removeLayer(tempLine);
        }
        if (scenarioData.type === 'rain') {
            tempLine = createRainPolygon(clickPoints, scenarioData, null);
            if (tempLine) {
                tempLine.setStyle({
                    dashArray: '5, 5',
                    fillOpacity: 0.15
                });
                tempLine.addTo(map);
            }
        } else {
            // Chặn metro: vẽ đường gấp khúc nét đứt để hiển thị hướng chặn tạm thời
            const color = '#ff0055';
            tempLine = L.polyline(clickPoints, {
                color: color,
                weight: 3,
                opacity: 0.7,
                dashArray: '5, 5'
            }).addTo(map);
        }
    }
    
    updateStatus(`Đã chọn ${clickPoints.length} điểm cho kịch bản ${scenarioData.name}. Chấm tiếp các điểm khác hoặc nhấp nút "Tạo Kịch Bản" ở thanh bên để hoàn tất.`);
}

function updateDeleteModeUI() {
    const activeClass = 'active'; // A class to indicate active state
    
    if (isDeleteMode) {
        toggleDeleteBtn.innerHTML = '<i data-lucide="trash-2" style="width:16px;height:16px"></i> Tắt chế độ xóa';
        lucide.createIcons();
        toggleDeleteBtn.classList.add(activeClass);
        map.getContainer().style.cursor = 'crosshair';
        
        // Update style of existing layers to indicate they are deletable
        scenarioHistory.forEach(scenario => {
            if (scenario.layer) {
                if (scenario.layer.setStyle) {
                    scenario.layer.setStyle({ dashArray: '5, 5', color: '#e53e3e' });
                } else {
                    scenario.layer.eachLayer(layer => {
                        if (layer.setStyle && !layer.options.icon) {
                            layer.setStyle({ dashArray: '5, 5', color: '#e53e3e' });
                        }
                    });
                }
            }
        });
        
        updateStatus('Đã bật Chế độ Xóa. Nhấp vào kịch bản trên bản đồ để xóa.');
    } else {
        toggleDeleteBtn.innerHTML = '<i data-lucide="trash-2" style="width:16px;height:16px"></i> Xóa từng kịch bản';
        lucide.createIcons();
        toggleDeleteBtn.classList.remove(activeClass);
        map.getContainer().style.cursor = '';
        
        // Revert style for existing layers
        scenarioHistory.forEach(scenario => {
            if (scenario.layer) {
                const scenarioData = getScenarioData(scenario.scenarioKey);
                if (scenario.layer.setStyle) {
                    scenario.layer.setStyle({
                        dashArray: null,
                        color: scenarioData.color
                    });
                } else {
                    let mainColor = '#000000';
                    let slashColor = '#ff0055';
                    scenario.layer.eachLayer(layer => {
                        if (layer.setStyle && !layer.options.icon) {
                            if (layer.options.weight > 4) {
                                layer.setStyle({ dashArray: null, color: mainColor });
                            } else {
                                layer.setStyle({ dashArray: null, color: slashColor });
                            }
                        }
                    });
                }
            }
        });
        
        updateStatus('Đã tắt Chế độ Xóa.');
    }
}

/**
 * Handle click on a scenario layer to delete it
 */
function onScenarioClick(e) {
    // Only allow deletion if delete mode is active
    if (!isDeleteMode) return;

    // Stop the click from propagating to the map, which would trigger onMapClick
    L.DomEvent.stopPropagation(e);

    // `this` refers to the layer that was clicked. It could be a component of a group.
    const clickedComponent = this;
    const clickedLayer = clickedComponent.parentGroup || clickedComponent;

    // Use a confirmation dialog
    if (!confirm('Are you sure you want to delete this specific scenario?')) {
        return;
    }

    // Find the index of the scenario in our history array
    const scenarioIndex = scenarioHistory.findIndex(scenario => scenario.layer === clickedLayer);

    if (scenarioIndex > -1) {
        // Remove the layer from the map
        map.removeLayer(clickedLayer);

        // Remove the scenario from our history array
        scenarioHistory.splice(scenarioIndex, 1);

        // Resynchronize the backend state
        updateStatus('Đang xóa kịch bản và đồng bộ lại...');
        resyncBackendScenarios(); // This function will clear the backend and re-add the remaining scenarios
    } else {
        console.error("Could not find the clicked scenario in the history.");
        updateStatus("Lỗi: Không thể xóa kịch bản.");
    }
}

/**
 * Apply selected scenario
 */
async function applyScenario() {
    updateStatus('Đang áp dụng kịch bản...');
    
    try {
        const scenarioData = getScenarioData(currentScenario);
        
        let apiStart, apiEnd, apiThreshold;
        let visualCenter, visualRadius;
        
        if (scenarioData.type === 'rain') {
            // Tính toán đường tròn bao cho N điểm đã chọn
            let sumLat = 0;
            let sumLng = 0;
            clickPoints.forEach(pt => {
                sumLat += pt[0];
                sumLng += pt[1];
            });
            const centerLat = sumLat / clickPoints.length;
            const centerLng = sumLng / clickPoints.length;
            const centerLatLng = L.latLng(centerLat, centerLng);
            
            // Tính bán kính lớn nhất (bằng mét) từ tâm đến bất kỳ điểm nào đã chọn
            let maxDistMeters = 0;
            clickPoints.forEach(pt => {
                const ptLatLng = L.latLng(pt[0], pt[1]);
                const dist = centerLatLng.distanceTo(ptLatLng);
                if (dist > maxDistMeters) {
                    maxDistMeters = dist;
                }
            });
            
            // Đảm bảo bán kính tối thiểu bằng giá trị threshold mặc định của kịch bản
            const defaultThreshold = scenarioData.threshold || 50;
            if (maxDistMeters < defaultThreshold) {
                maxDistMeters = defaultThreshold;
            }
            
            apiStart = { lat: centerLat, lng: centerLng };
            apiEnd = { lat: centerLat, lng: centerLng };
            apiThreshold = maxDistMeters;
            
            visualCenter = [centerLat, centerLng];
            visualRadius = maxDistMeters;
        } else if (scenarioData.type === 'metro-block') {
            // Chặn metro: lấy toạ độ điểm đầu và cuối làm đại diện cho line_start/line_end
            const p1 = { lat: clickPoints[0][0], lng: clickPoints[0][1] };
            const p2 = { lat: clickPoints[clickPoints.length - 1][0], lng: clickPoints[clickPoints.length - 1][1] };
            
            apiStart = p1;
            apiEnd = p2;
            apiThreshold = scenarioData.threshold || 50;
        }

        // Chuẩn bị dữ liệu gửi đi
        const requestData = {
            scenario_type: scenarioData.type,
            line_start: apiStart,
            line_end: apiEnd,
            penalty_weight: scenarioData.penalty,
            threshold: apiThreshold,
            points: clickPoints.map(pt => ({ lat: pt[0], lng: pt[1] }))
        };
        
        // Gọi API
        const response = await authManager.request('/api/scenarios/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) throw new Error('Failed to apply scenario');
        const data = await response.json();
        
        // --- LOGIC 2: VẼ LẠI (VISUALIZATION) ---
        let visualLayer;
        
        if (scenarioData.type === 'rain') {
            // Vẽ Mưa: Hình bao mềm mại (convex hull hoặc capsule) bao quanh các nút đã vẽ
            visualLayer = createRainPolygon(clickPoints, scenarioData, onScenarioClick);
            visualLayer.addTo(map);
        } else {
            // Vẽ Chặn đường hoặc Chặn Metro: Rào chắn đen gạch chéo có biển báo cấm ở 2 đầu
            const drawPath = (data.blocked_path && data.blocked_path.length > 0) ? data.blocked_path : clickPoints;
            const clickedStart = clickPoints[0];
            const clickedEnd = clickPoints[clickPoints.length - 1];
            visualLayer = createBlockedBarrier(drawPath, scenarioData.type, null, clickedStart, clickedEnd);
            visualLayer.eachLayer(layer => {
                layer.parentGroup = visualLayer;
                layer.on('click', onScenarioClick);
            });
            visualLayer.addTo(map);
        }

        // If in delete mode, apply the deletable style immediately
        if (isDeleteMode) {
            if (visualLayer.setStyle) {
                visualLayer.setStyle({ dashArray: '5, 5', color: '#e53e3e' });
            } else {
                visualLayer.eachLayer(layer => {
                    if (layer.setStyle && !layer.options.icon) {
                        layer.setStyle({ dashArray: '5, 5', color: '#e53e3e' });
                    }
                });
            }
        }
        scenarioHistory.push({
            layer: visualLayer,
            request: requestData,
            response: data,
            scenarioKey: currentScenario
        });
        
        updateStatus(`Đã áp dụng kịch bản ${scenarioData.name}! Ảnh hưởng ${data.affected_edges} cung đường.`);
        
        // Dọn dẹp các điểm vẽ tạm thời
        clearTempMarkers();
        clickPoints = [];
        
        // Hủy kích hoạt kịch bản
        scenarioButtons.forEach(b => b.classList.remove('active'));
        currentScenario = null;

        // Gửi tín hiệu thông báo cho các tab khác biết kịch bản đã đổi
        localStorage.setItem('scenarios_updated', new Date().toISOString());
        
    } catch (error) {
        console.error('Error applying scenario:', error);
        updateStatus('Lỗi khi áp dụng kịch bản. Vui lòng thử lại.');
    }
}

/**
 * Get configuration
 */
function getScenarioData(scenario) {
    const scenarios = {
        'rain-light': {
            name: 'Mưa nhỏ',
            type: 'rain',
            penalty: 1.2,
            threshold: 30,
            color: '#60a5fa' 
        },
        'rain-medium': {
            name: 'Mưa vừa',
            type: 'rain',
            penalty: 1.5,
            threshold: 50,
            color: '#2563eb' 
        },
        'rain-heavy': {
            name: 'Mưa lớn',
            type: 'rain',
            penalty: 2.0,
            threshold: 70,
            color: '#14358eff' 
        },
        'rain-extreme': {
            name: 'Bão',
            type: 'rain',
            penalty: 3.0,
            threshold: 100,
            color: '#663adfff' 
        },
        'metro-block': {
            name: 'Chặn tuyến metro',
            type: 'metro-block',
            penalty: 10000,
            threshold: 50,
            color: '#ff0055'
        }
    };
    
    if (scenario) {
        return scenarios[scenario] || scenarios['rain-light'];
    }
    return scenarios; 
}

/**
 * Helper function to find scenario key by penalty and type
 */
function findScenarioKey(penalty, type) {
    const scenarios = getScenarioData(); // Get all scenarios
    for (const key in scenarios) {
        if (scenarios[key].type === type && scenarios[key].penalty === penalty) {
            return key;
        }
    }
    if (type === 'metro-block') return 'metro-block';
    return 'rain-light'; 
}

/**
 * Load existing scenarios from the backend and draw them on the map
 */
async function loadAndDrawScenarios() {
    try {
        updateStatus('Đang tải các kịch bản hiện có...');
        const response = await authManager.request('/api/scenarios/');
        if (!response.ok) {
            throw new Error('Could not fetch scenarios.');
        }

        const scenarios = await response.json();

        // Clear any local scenarios before loading from backend
        clearScenarioHistory();
        
        if (scenarios.length === 0) {
            updateStatus('Không tìm thấy kịch bản nào đang hoạt động. Chọn một kịch bản để bắt đầu.');
            return;
        }

        for (const scenario of scenarios) {
            const scenarioKey = findScenarioKey(scenario.penalty_weight, scenario.scenario_type);
            const scenarioData = getScenarioData(scenarioKey);
            
            let visualLayer;
            let clickPoints = scenario.points && scenario.points.length > 0
                ? scenario.points.map(p => [p.lat, p.lng])
                : [[scenario.line_start.lat, scenario.line_start.lng], [scenario.line_end.lat, scenario.line_end.lng]];

            if (scenario.scenario_type === 'rain') {
                const customScenarioData = {
                    ...scenarioData,
                    threshold: scenario.threshold
                };
                
                visualLayer = createRainPolygon(clickPoints, customScenarioData, onScenarioClick);
                visualLayer.addTo(map);
            } else { // block or metro-block
                const drawPath = (scenario.blocked_path && scenario.blocked_path.length > 0) ? scenario.blocked_path : clickPoints;
                const clickedStart = [scenario.line_start.lat, scenario.line_start.lng];
                const clickedEnd = [scenario.line_end.lat, scenario.line_end.lng];
                visualLayer = createBlockedBarrier(drawPath, scenario.scenario_type, null, clickedStart, clickedEnd);
                visualLayer.eachLayer(layer => {
                    layer.parentGroup = visualLayer;
                    layer.on('click', onScenarioClick);
                });
                visualLayer.addTo(map);
            }
            
            // If in delete mode, apply the deletable style immediately
            if (isDeleteMode) {
                if (visualLayer.setStyle) {
                    visualLayer.setStyle({ dashArray: '5, 5', color: '#e53e3e' });
                } else {
                    visualLayer.eachLayer(layer => {
                        if (layer.setStyle && !layer.options.icon) {
                            layer.setStyle({ dashArray: '5, 5', color: '#e53e3e' });
                        }
                    });
                }
            }

            // Reconstruct the scenario object to store in history
            const historyItem = {
                layer: visualLayer,
                // The request object from the backend is what we need
                request: {
                    scenario_type: scenario.scenario_type,
                    line_start: scenario.line_start,
                    line_end: scenario.line_end,
                    penalty_weight: scenario.penalty_weight,
                    threshold: scenario.threshold,
                    points: scenario.points
                },
                response: { /* We don't have this, but it's not critical for deletion */ },
                scenarioKey: scenarioKey
            };
            scenarioHistory.push(historyItem);
        }

        updateStatus(`Đã tải ${scenarios.length} kịch bản đang hoạt động.`);

    } catch (error) {
        console.error('Error loading scenarios:', error);
        updateStatus('Không thể tải các kịch bản hiện có.');
    }
}

/**
 * Clear temporary markers and the temporary polyline
 */
function clearTempMarkers() {
    tempMarkers.forEach(marker => map.removeLayer(marker));
    tempMarkers = [];
    if (tempLine) {
        map.removeLayer(tempLine);
        tempLine = null;
    }
}



/**
 * Clear all scenario layers
 */
function clearScenarioHistory() {
    scenarioHistory.forEach(scenario => map.removeLayer(scenario.layer));
    scenarioHistory = [];
}

/**
 * Handle clear all button
 */
clearAllBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear all scenarios?')) {
        return;
    }
    
    try {
        updateStatus('Đang xóa các kịch bản...');
        
        // Bước 1: Gọi API xóa toàn bộ (Backend đã hỗ trợ endpoint DELETE /api/scenarios/)
        // Việc này nhanh hơn nhiều so với xóa từng cái vì không phải tính lại trọng số nhiều lần
        const response = await authManager.request('/api/scenarios/', { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to clear scenarios');
        
        // Bước 2: Dọn dẹp giao diện
        clearScenarioHistory();
        clearTempMarkers();
        clickPoints = [];
        currentScenario = null;
        
        scenarioButtons.forEach(b => b.classList.remove('active'));

        // If in delete mode, disable it since there's nothing left to delete
        if (isDeleteMode) {
            isDeleteMode = false;
            updateDeleteModeUI();
        }
        
        updateStatus(`Đã xóa tất cả kịch bản thành công.`);

        // Signal other tabs that scenarios have changed
        localStorage.setItem('scenarios_updated', new Date().toISOString());
    } catch (error) {
        console.error('Error clearing scenarios:', error);
        updateStatus('Lỗi khi xóa các kịch bản. Vui lòng thử lại.');
    }
});

/**
 * Update status message
 */
function updateStatus(message) {
    statusMessage.textContent = message;
}

/**
 * Resync all scenarios with the backend.
 * This is done by clearing all scenarios on the backend and then re-adding them.
 */
async function resyncBackendScenarios() {
    // 1. Clear all scenarios on the backend
    try {
        await authManager.request('/api/scenarios/', { method: 'DELETE' });
    } catch (error) {
        console.error('Failed to clear scenarios during resync:', error);
        updateStatus('Lỗi trong quá trình hoàn tác. Các kịch bản có thể bị lệch đồng bộ.');
        return;
    }

    // 2. Re-apply all scenarios from history
    const scenariosToReapply = [...scenarioHistory]; // Create a copy

    for (const scenario of scenariosToReapply) {
        try {
            // We don't need to do anything with the response here
            await authManager.request('/api/scenarios/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scenario.request)
            });
        } catch (error) {
            console.error('Failed to re-apply a scenario during resync:', error);
            // If one fails, we should probably stop and alert the user
            updateStatus('Lỗi khi áp dụng lại các kịch bản sau khi hoàn tác. Trạng thái có thể không nhất quán.');
            return; // Stop processing further
        }
    }

    // Signal other tabs that scenarios have changed
    localStorage.setItem('scenarios_updated', new Date().toISOString());
    updateStatus(`Hoàn tác thành công. ${scenarioHistory.length} kịch bản đang hoạt động.`);
}

/**
 * Undo the last added scenario
 */
async function undoLastScenario() {
    if (scenarioHistory.length === 0) {
        updateStatus('Không có gì để hoàn tác.');
        return;
    }

    updateStatus('Đang hoàn tác kịch bản cuối cùng...');

    // 1. Remove from history and map
    const lastScenario = scenarioHistory.pop();
    if (lastScenario && lastScenario.layer) {
        map.removeLayer(lastScenario.layer);
    }

    // 2. Resync backend
    await resyncBackendScenarios();
}


// Add keyboard listener for Ctrl+Z
document.addEventListener('keydown', function(event) {
    if (event.ctrlKey && event.key === 'z') {
        event.preventDefault();
        undoLastScenario();
    }
});

// Add click listener for shared Create button
applyScenarioBtn.addEventListener('click', () => {
    if (isDeleteMode) {
        updateStatus('Không thể thêm kịch bản khi ở Chế độ Xóa. Vui lòng tắt nó trước.');
        return;
    }

    if (!currentScenario) {
        updateStatus('Vui lòng chọn một kịch bản ở thanh bên trước.');
        alert('Vui lòng chọn một kịch bản ở thanh bên trước.');
        return;
    }

    const scenarioData = getScenarioData(currentScenario);

    if (scenarioData.type === 'rain') {
        if (clickPoints.length === 0) {
            updateStatus('Vui lòng chọn ít nhất một điểm trên bản đồ để tạo vùng mưa.');
            alert('Vui lòng chọn ít nhất một điểm trên bản đồ để tạo vùng mưa.');
            return;
        }
    } else {
        // Block (metro-block)
        if (clickPoints.length < 2) {
            updateStatus('Vui lòng chọn đủ 2 điểm trên bản đồ để tạo kịch bản chặn.');
            alert('Vui lòng chọn đủ 2 điểm trên bản đồ để tạo kịch bản chặn.');
            return;
        }
    }

    // All checks pass - execute scenario creation
    applyScenario();
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);