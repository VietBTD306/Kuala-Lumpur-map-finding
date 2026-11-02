/**
 * Map Module for User View
 * Handles map initialization and path visualization
 */

// Map configuration
let map;
let pathLayer;
let startMarker;
let endMarker;
let nodeLayer; // <-- added to hold all nodes layer
let stationIndex = [];
let linesLayer;
let stationsLayer;
let allStationMarkers = [];
let activeScenariosLayer;

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
        } else if (lineName.includes('kajang') || lineName.includes('kg') || lineName.includes('line 9')) {
            lineColor = '#00843d'; // Xanh lá - Tuyến Kajang
        } else if (lineName.includes('putrajaya') || lineName.includes('py') || lineName.includes('line 12')) {
            lineColor = '#fdb913'; // Vàng nghệ - Tuyến Putrajaya
        } else if (lineName.includes('ampang') || lineName.includes('ag') || lineName.includes('line 3')) {
            lineColor = '#f37023'; // Màu Cam - Tuyến Ampang
        } else if (lineName.includes('sri petaling') || lineName.includes('sp') || lineName.includes('line 4')) {
            lineColor = '#b32025'; // Đỏ đô - Tuyến Sri Petaling
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

function getMetroSegmentColor(segment) {
    if (!segment || !segment.details || !segment.details.path || segment.details.path.length === 0) {
        return '#e11d48'; // Fallback to rose/red
    }
    
    const midIdx = Math.floor(segment.details.path.length / 2);
    const node = segment.details.path[midIdx];
    const nodeLat = node.x;
    const nodeLon = node.y;
    
    let closestColor = '#e11d48';
    let minDistance = Infinity;
    
    if (linesLayer) {
        linesLayer.eachLayer(layer => {
            const feature = layer.feature;
            if (!feature || !feature.geometry) return;
            
            const type = feature.geometry.type;
            const coords = feature.geometry.coordinates;
            
            const checkDist = (lon, lat) => {
                const d = Math.hypot(lat - nodeLat, lon - nodeLon);
                if (d < minDistance) {
                    minDistance = d;
                    closestColor = getOriginalColorForFeature(feature);
                }
            };
            
            if (type === 'LineString') {
                coords.forEach(pt => checkDist(pt[0], pt[1]));
            } else if (type === 'MultiLineString') {
                coords.forEach(sub => sub.forEach(pt => checkDist(pt[0], pt[1])));
            }
        });
    }
    
    if (minDistance < 0.005) {
        return closestColor;
    }
    
    return '#e11d48';
}

function isFeatureOnRoute(feature, activeMetroCoords) {
    if (!feature || !feature.geometry) return false;
    const type = feature.geometry.type;
    const coords = feature.geometry.coordinates;
    
    if (type === 'LineString') {
        for (let i = 0; i < coords.length; i++) {
            const lat = coords[i][1];
            const lon = coords[i][0];
            if (activeMetroCoords.has(`${lat.toFixed(4)},${lon.toFixed(4)}`)) {
                return true;
            }
        }
    } else if (type === 'MultiLineString') {
        for (let i = 0; i < coords.length; i++) {
            const sub = coords[i];
            for (let j = 0; j < sub.length; j++) {
                const lat = sub[j][1];
                const lon = sub[j][0];
                if (activeMetroCoords.has(`${lat.toFixed(4)},${lon.toFixed(4)}`)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function isStationNearRoute(latlng, activeMetroCoords) {
    if (activeMetroCoords.size === 0) return true;
    for (let coordStr of activeMetroCoords) {
        const [latStr, lonStr] = coordStr.split(',');
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        const d = Math.hypot(latlng.lat - lat, latlng.lng - lon) * 111000;
        if (d < 150) {
            return true;
        }
    }
    return false;
}

function updateBaseMetroLayers(pathData) {
    const activeMetroCoords = new Set();
    if (pathData && pathData.segments) {
        pathData.segments.forEach(seg => {
            if (seg.mode === 'metro' && seg.details && seg.details.path) {
                seg.details.path.forEach(node => {
                    activeMetroCoords.add(`${node.x.toFixed(4)},${node.y.toFixed(4)}`);
                });
            }
        });
    }
    
    if (linesLayer) {
        linesLayer.setStyle(function(feature) {
            let lineColor = getOriginalColorForFeature(feature);
            if (activeMetroCoords.size > 0) {
                return {
                    color: '#475569', // Dark Slate Gray (does not blend with light map tiles)
                    weight: 3,
                    opacity: 0.75 // Grey out all base lines (active segments drawn on top in original color)
                };
            } else {
                return {
                    color: lineColor,
                    weight: 5,
                    opacity: 0.9
                };
            }
        });
    }
    
    if (stationsLayer) {
        stationsLayer.clearLayers();
        allStationMarkers.forEach(marker => {
            const latlng = marker.getLatLng();
            if (activeMetroCoords.size === 0 || isStationNearRoute(latlng, activeMetroCoords)) {
                stationsLayer.addLayer(marker);
            }
        });
    }
}

function resetBaseMetroLayers() {
    if (linesLayer) {
        linesLayer.setStyle(function(feature) {
            let lineColor = getOriginalColorForFeature(feature);
            return {
                color: lineColor,
                weight: 5,
                opacity: 0.9
            };
        });
    }
    
    if (stationsLayer) {
        stationsLayer.clearLayers();
        allStationMarkers.forEach(marker => {
            stationsLayer.addLayer(marker);
        });
    }
}

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

function buildStationIndex(geoJsonData) {
    if (!geoJsonData || !Array.isArray(geoJsonData.features)) {
        stationIndex = [];
        return;
    }

    const seen = new Set();
    stationIndex = geoJsonData.features
        .filter(feature => feature.geometry && feature.geometry.type === 'Point')
        .map(feature => {
            const name = getStationDisplayName(feature);
            const [lng, lat] = feature.geometry.coordinates;
            return { name, lng, lat, feature };
        })
        .filter(station => {
            if (!station.name || !Number.isFinite(station.lng) || !Number.isFinite(station.lat)) {
                return false;
            }

            const key = `${station.name.trim().toLowerCase()}|${station.lng.toFixed(5)},${station.lat.toFixed(5)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function findNearestStation(x, y) {
    if (!stationIndex.length) return null;

    let nearest = null;
    let bestDistance = Infinity;

    stationIndex.forEach(station => {
        const dx = station.lat - x;
        const dy = station.lng - y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < bestDistance) {
            bestDistance = distance;
            nearest = station;
        }
    });

    return nearest ? { ...nearest, distance: bestDistance } : null;
}

function findStationByName(name) {
    if (!name || !stationIndex.length) return null;
    const cleanTarget = name.trim().toLowerCase();
    
    // 1. Try exact match
    let found = stationIndex.find(s => s.name.trim().toLowerCase() === cleanTarget);
    if (found) return found;
    
    // 2. Try matching the reference code (e.g. "KJ14")
    const refMatch = name.match(/[a-z0-9]+/i);
    if (refMatch) {
        const refStr = refMatch[0].toLowerCase();
        found = stationIndex.find(s => {
            const sRef = (s.feature && s.feature.properties && s.feature.properties.ref || "").toLowerCase();
            return sRef === refStr || sRef.split(';').includes(refStr);
        });
        if (found) return found;
    }
    
    // 3. Try partial name matching
    const cleanNameOnly = (str) => str.replace(/^[a-z0-9\s;\/]+/i, "").trim().toLowerCase();
    const targetNameOnly = cleanNameOnly(name);
    
    found = stationIndex.find(s => {
        const sNameOnly = cleanNameOnly(s.name);
        return sNameOnly && (sNameOnly.includes(targetNameOnly) || targetNameOnly.includes(sNameOnly));
    });
    
    return found || null;
}

function createColoredStationIcon(bgColor, borderColor, iconColor) {
    const trainSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; display: block;">
        <path d="M4 4c0-1.1.9-2 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" fill="${iconColor}" fill-opacity="0.15"/>
        <path d="M4 9h16"/>
        <circle cx="7" cy="14" r="1" fill="${iconColor}"/>
        <circle cx="17" cy="14" r="1" fill="${iconColor}"/>
        <path d="M7 22l2-4"/>
        <path d="M17 22l-2-4"/>
    </svg>`;

    return L.divIcon({
        className: 'station-icon-highlighted',
        html: `<div style="display: flex; justify-content: center; align-items: center; background: ${bgColor}; border: 2.5px solid ${borderColor}; border-radius: 50%; width: 32px; height: 32px; box-sizing: border-box; box-shadow: 0 4px 8px rgba(0,0,0,0.35); outline: 2px dashed ${borderColor}66; outline-offset: -6px;">${trainSvg}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });
}

/**
 * Initialize the map with local image

function initializeMap(imageUrl) {
    // Create map with CRS.Simple for pixel coordinates
    map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -3,
        maxZoom: 2,
        zoomSnap: 0.25,
        zoomDelta: 0.25,
        attributionControl: false
    });
    
    // Calculate bounds for the image
    const bounds = [[0, 0], [AppConfig.MAP_HEIGHT, AppConfig.MAP_WIDTH]];
    
    // Set the map bounds to prevent dragging outside the image
    map.setMaxBounds(bounds);
    map.on('drag', function() {
        map.panInsideBounds(bounds, { animate: false });
    });

    // Add the local map image
    L.imageOverlay(imageUrl, bounds).addTo(map);
    
    // Set the map bounds
    map.fitBounds(bounds);
    
    // Set initial view to center
    map.setView([AppConfig.MAP_HEIGHT / 2, AppConfig.MAP_WIDTH / 2], -1);
    
    // Add attribution
    L.control.attribution({
        position: 'bottomright',
        prefix: 'PathFinding App - Hoàn Kiếm'
    }).addTo(map);
    
    console.log('Map initialized successfully');

}
    */

/**
 * Initialize the map with OpenStreetMap and GeoJSON
 */
function initializeMap() {
    // 1. ĐỊNH NGHĨA CÁC LỚP BẢN ĐỒ NỀN (BASE MAPS)
    
    // Lớp chi tiết (OpenStreetMap - Nhiều màu sắc)
    const detailLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    });

    // Lớp đơn giản (CartoDB Light - Nền xám nhạt giúp nổi bật Metro)
    const cleanLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB'
    });

    // 2. KHỞI TẠO MAP VÀ GÁN LỚP MẶC ĐỊNH
    map = L.map('map', {
        minZoom: 10,
        maxZoom: 18, 
        attributionControl: false,
        layers: [cleanLayer] // <-- Chọn cleanLayer làm mặc định khi vừa mở web
    }).setView([3.1390, 101.6869], 11); 

    activeScenariosLayer = L.layerGroup().addTo(map); 

    // Create custom panes for routing visualization to ensure they stay on top of base layers and base metro layers
    map.createPane('routePane');
    map.getPane('routePane').style.zIndex = 450; // Above base tile layers and metro line polylines (which are at 400)

    map.createPane('routeMarkerPane');
    map.getPane('routeMarkerPane').style.zIndex = 620; // Above default markerPane (600) 

    // Tạo nhóm lớp Metro (mặc định hiện trên bản đồ)
    const metroLayerGroup = L.layerGroup().addTo(map);

    // Tạo nút Toggle Metro tùy chỉnh riêng biệt đặt phía trên Layer Control
    const MetroToggleControl = L.Control.extend({
        options: {
            position: 'topright'
        },
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-control custom-metro-toggle');
            container.innerHTML = `
                <button id="metroToggleBtn" class="metro-toggle-btn active" title="Ẩn/Hiện Tuyến Metro">
                    <i data-lucide="train"></i>
                    <span>Metro</span>
                    <span class="indicator-dot"></span>
                </button>
            `;
            
            const btn = container.querySelector('#metroToggleBtn');
            L.DomEvent.on(btn, 'click', function(e) {
                L.DomEvent.stopPropagation(e);
                
                const isActive = btn.classList.contains('active');
                if (isActive) {
                    btn.classList.remove('active');
                    map.removeLayer(metroLayerGroup);
                } else {
                    btn.classList.add('active');
                    map.addLayer(metroLayerGroup);
                }
            });

            L.DomEvent.disableClickPropagation(container);

            // Tự động quét và vẽ icon Lucide sau khi button được thêm vào DOM
            setTimeout(() => {
                if (window.lucide) {
                    window.lucide.createIcons();
                }
            }, 0);

            return container;
        }
    });
    new MetroToggleControl().addTo(map);

    // 3. TẠO NÚT MENU CHUYỂN LỚP (LAYER CONTROL) ĐẸP ĐẼ KIỂU GOOGLE MAPS
    const LayerSwitcherControl = L.Control.extend({
        options: {
            position: 'topright'
        },
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-control custom-layer-switcher');
            container.innerHTML = `
                <button class="layer-trigger" title="Thay đổi bản đồ nền">
                    <i data-lucide="layers"></i>
                    <span>Bản đồ</span>
                </button>
                <div class="layer-options">
                    <div class="layer-card active" id="layerSimple" data-layer="simple" title="Bản đồ Sáng">
                        <div class="layer-thumbnail simple-thumb">
                            <span class="layer-label">Bản đồ Sáng</span>
                        </div>
                    </div>
                    <div class="layer-card" id="layerDetail" data-layer="detail" title="Bản đồ Chi tiết">
                        <div class="layer-thumbnail detail-thumb">
                            <span class="layer-label">Chi tiết</span>
                        </div>
                    </div>
                </div>
            `;

            const simpleCard = container.querySelector('#layerSimple');
            const detailCard = container.querySelector('#layerDetail');

            L.DomEvent.on(simpleCard, 'click', function(e) {
                L.DomEvent.stopPropagation(e);
                if (map.hasLayer(detailLayer)) {
                    map.removeLayer(detailLayer);
                }
                if (!map.hasLayer(cleanLayer)) {
                    map.addLayer(cleanLayer);
                }
                simpleCard.classList.add('active');
                detailCard.classList.remove('active');
            });

            L.DomEvent.on(detailCard, 'click', function(e) {
                L.DomEvent.stopPropagation(e);
                if (map.hasLayer(cleanLayer)) {
                    map.removeLayer(cleanLayer);
                }
                if (!map.hasLayer(detailLayer)) {
                    map.addLayer(detailLayer);
                }
                detailCard.classList.add('active');
                simpleCard.classList.remove('active');
            });

            L.DomEvent.disableClickPropagation(container);

            // Tự động quét và vẽ icon Lucide sau khi control được thêm vào DOM
            setTimeout(() => {
                if (window.lucide) {
                    window.lucide.createIcons();
                }
            }, 0);

            return container;
        }
    });

    new LayerSwitcherControl().addTo(map);

    // 4. TẢI ĐỒNG THỜI CẢ 2 FILE DỮ LIỆU GEOJSON
    Promise.all([
        fetch('map/1.geojson').then(res => res.json()),
        fetch('map/railways.geojson').then(res => res.json())
    ])
    .then(([linesData, stationsData]) => {
        buildStationIndex(stationsData);
        
        // --- LỚP 1: VẼ CÁC TUYẾN ĐƯỜNG RAY PHÂN MÀU (TỪ FILE 1.GEOJSON) ---
        linesLayer = L.geoJSON(linesData, {
            style: function(feature) {
                let lineColor = getOriginalColorForFeature(feature);
                return { 
                    color: lineColor, 
                    weight: 5,        // Độ dày đường ray tương tự ảnh mẫu
                    opacity: 0.9 
                };
            }
        }).addTo(metroLayerGroup);

        // --- LỚP 2: VẼ CÁC CHẤM NHÀ GA (TỰ ĐỘNG ẨN/HIỆN THEO MỨC ZOOM) ---
        // 1. Dùng LayerGroup thông thường (đảm bảo khi hiện icon sẽ đứng im một chỗ, không bị bung chân rết)
        // --- LỚP 2: VẼ CÁC CHẤM NHÀ GA (DÙNG LAYERGROUP THÔNG THƯỜNG) ---
        stationsLayer = L.layerGroup(); 

        const seenStationNames = new Set();
        const seenStations = new Set();

        L.geoJSON(stationsData, {
            filter: function(feature) {
                if (feature.geometry && feature.geometry.type === 'Point') {
                    // Đọc trường tên từ DB chuyển sang (thử cả name, Name hoặc title)
                    const rawName = getStationNameFromFeature(feature);
                    const stationName = rawName.trim().toLowerCase();
                    
                    if (stationName) {
                        if (seenStationNames.has(stationName)) return false; // Lọc trùng
                        seenStationNames.add(stationName);
                        return true;
                    }
                    
                    // Lọc trùng theo tọa độ nếu không tìm thấy tên
                    const [lng, lat] = feature.geometry.coordinates;
                    const coordKey = `${lng.toFixed(4)},${lat.toFixed(4)}`;
                    if (seenStations.has(coordKey)) return false;
                    seenStations.add(coordKey);
                    return true;
                }
                return false;
            },
            pointToLayer: function(feature, latlng) {
                // Đọc thông tin cơ bản
                const stationName = getStationNameFromFeature(feature);
                let displayName = stationName;
                const stationType = feature.properties.type || "Ga Metro"; 
                
                // --- BỔ SUNG ĐẦY ĐỦ THÔNG TIN TỪ RAILWAYS.GEOJSON ---
                // Thu thập thông tin từ hệ thống quản lý hoặc quan hệ tuyến (@relations) nếu có
                let network = feature.properties.network || "Hệ thống Metro";
                let routeRef = feature.properties.ref || ""; 
                let lineName = "";

                // Nếu thông tin nằm trong mảng @relations (đặc trưng dữ liệu từ Overpass/OSM)
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
                
                // Hiện tên ga nhỏ khi hover chuột qua
                marker.bindTooltip(displayName, {
                    permanent: false, 
                    direction: 'top',
                    className: 'station-label',
                    offset: [0, -10]
                });

                // Hiện Popup chi tiết định dạng đẹp khi click vào icon ga (đã bổ sung thông tin chi tiết)
                const popupContent = `
                    <div style="font-family: 'Roboto', sans-serif; padding: 5px; min-width: 180px; max-width: 240px;">
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
                allStationMarkers.push(marker);
                return marker;
            }
        }).addTo(stationsLayer); // Chỉ add vào stationsLayer để quản lý bật tắt, không add thẳng vào map.

        // 3. Logic kiểm tra và bật/tắt hiển thị theo mức zoom thực tế
        function checkZoomAndToggleStations() {
            const currentZoom = map.getZoom();
            
            // Ngưỡng zoom tối ưu: >= 13 thì hiện icon, nhỏ hơn 13 (10, 11, 12) ẩn hoàn toàn
            if (currentZoom >= 13) {
                if (!metroLayerGroup.hasLayer(stationsLayer)) {
                    metroLayerGroup.addLayer(stationsLayer);
                }
            } else {
                if (metroLayerGroup.hasLayer(stationsLayer)) {
                    metroLayerGroup.removeLayer(stationsLayer);
                }
            }
        }

        // Lắng nghe sự kiện kết thúc thay đổi zoom của bản đồ
        map.on('zoomend', checkZoomAndToggleStations);

        // Chạy kiểm tra ngay lần đầu load trang dữ liệu xong
        checkZoomAndToggleStations();
        
        // Tự động căn chỉnh ống kính camera bao trọn toàn bộ mạng lưới Metro sau khi load xong
        map.fitBounds(linesLayer.getBounds());
        console.log("Đã kích hoạt bản đồ phân tầng tuyến kết hợp chấm nhà ga thành công!");
        
    })
    .catch(err => {
        console.error('Lỗi tải dữ liệu bản đồ:', err);
        alert("Không thể tải bản đồ! Hãy kiểm tra chắc chắn file '1.geojson' và 'railways.geojson' đều nằm trong thư mục mang tên 'map'.");
    });

    // 5. THÊM THÔNG TIN BẢN QUYỀN VÀO GÓC DƯỚI BÊN PHẢI
    L.control.attribution({
        position: 'bottomright',
        prefix: 'PathFinding App'
    }).addTo(map);
    
    // Start auto-polling active scenarios every 3 seconds to keep user map in sync
    setInterval(loadAndDrawActiveScenarios, 3000);

    console.log('Dynamic Map initialized successfully');
}
/**
 * Convert database coordinates (x, y) to Leaflet coordinates [y, x]
 * Không cần trừ chiều cao ảnh nữa vì giờ ta dùng Kinh độ/Vĩ độ thực
 */


/**
 * Convert database coordinates (x, y) to Leaflet coordinates [y, x]
 */
/**
 * Convert database coordinates (x, y) to Leaflet coordinates [y, x]
 * KHẮC PHỤC: Đảo ngược tọa độ Y bằng cách trừ đi chiều cao của bản đồ.
 */
function dbToLeaflet(x, y) {
    return [x, y]
}
function createMapPinIcon(color) {
    const pinSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 32px; height: 32px; display: block; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.35));">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3.5" fill="#ffffff"/>
    </svg>`;

    return L.divIcon({
        className: 'custom-map-pin',
        html: pinSvg,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });
}

/**
 * Draw a marker on the map
 */
function addMarker(x, y, type = 'start') {
    const position = dbToLeaflet(x, y);
    if (type === 'start' && startMarker) {
        map.removeLayer(startMarker);
    } else if (type === 'end' && endMarker) {
        map.removeLayer(endMarker);
    }
    
    const color = type === 'start' ? '#22c55e' : '#ef4444';
    const pinIcon = createMapPinIcon(color);
    
    const marker = L.marker(position, { icon: pinIcon, pane: 'routeMarkerPane' }).addTo(map);
    if (type === 'start') {
        startMarker = marker; // Gán marker mới vào biến startMarker
    } else if (type === 'end') {
        endMarker = marker; // Gán marker mới vào biến endMarker
    }
    // Add popup
    const label = type === 'start' ? 'Start' : 'End';
    const station = findNearestStation(x, y);
    const stationLine = station
        ? `<br><b>Ga gần nhất:</b> ${station.name}`
        : '';

    marker.bindPopup(`<b>${label} Point</b>${stationLine}<br>Tọa độ: (${x}, ${y})`);
    return marker;
}

/**
 * Draw the path on the map
 */
function drawPath(pathData) {
    // Clear existing path (this resets base layers to default first)
    clearPath();

    // Update base metro lines and stations to focus mode (highlight active segments, grey out other segments, hide other stations)
    updateBaseMetroLayers(pathData);
    
    if (!pathData) {
        console.warn('No path data to draw');
        return;
    }
    
    // Create layer group for the path
    pathLayer = L.layerGroup().addTo(map);
    
    // Check if we have a plan object (with segments)
    if (pathData.segments) {
        pathData.segments.forEach(segment => {
            if (!segment.details || !segment.details.path || segment.details.path.length === 0) {
                return;
            }
            
            let coordinates = segment.details.path.map(node => dbToLeaflet(node.x, node.y));
            let color = '#3b82f6';
            let weight = 5;
            let dashArray = null;
            let opacity = 0.9;
            
            if (segment.mode === 'foot') {
                color = '#10b981'; // Green for walking
                weight = 4;
                dashArray = '5, 8';
            } else if (segment.mode === 'motorbike') {
                color = '#f59e0b'; // Amber/Orange for Motorbike
                weight = 5;
            } else if (segment.mode === 'car') {
                color = '#2563eb'; // Blue for car
                weight = 5;
            } else if (segment.mode === 'metro') {
                color = getMetroSegmentColor(segment); // Use original color of the metro line
                weight = 7;
                opacity = 0.95;
            } else if (segment.mode === 'transfer') {
                color = '#d97706'; // Amber/Orange for Metro Transfer
                weight = 4;
                dashArray = '3, 6'; // Dashed line for walking transfer
                
                // Add blue and red markers at transfer endpoints
                if (coordinates && coordinates.length >= 2) {
                    const startPos = coordinates[0];
                    const endPos = coordinates[coordinates.length - 1];
                    
                    let fromStation = null;
                    let toStation = null;
                    
                    if (segment.details && segment.details.from_station_name) {
                        fromStation = findStationByName(segment.details.from_station_name);
                    }
                    if (!fromStation) {
                        fromStation = findNearestStation(startPos[0], startPos[1]);
                    }
                    
                    if (segment.details && segment.details.to_station_name) {
                        toStation = findStationByName(segment.details.to_station_name);
                    }
                    if (!toStation) {
                        toStation = findNearestStation(endPos[0], endPos[1]);
                    }
                    
                    if (fromStation && toStation) {
                        // Snap the dashed transfer line to connect the physical station coordinates exactly
                        coordinates = [
                            [fromStation.lat, fromStation.lng],
                            [toStation.lat, toStation.lng]
                        ];
                        
                        // Blue marker for transfer-departure station
                        const fromIcon = createColoredStationIcon('#2563eb', '#1e40af', '#ffffff'); // Blue
                        L.marker([fromStation.lat, fromStation.lng], { icon: fromIcon, pane: 'routeMarkerPane' })
                            .bindTooltip(`Ga chuyển đi: ${fromStation.name}`, { direction: 'top', permanent: true, offset: [0, -10], className: 'station-label' })
                            .addTo(pathLayer);
                            
                        // Red marker for transfer-arrival station
                        const toIcon = createColoredStationIcon('#ef4444', '#b91c1c', '#ffffff'); // Red
                        L.marker([toStation.lat, toStation.lng], { icon: toIcon, pane: 'routeMarkerPane' })
                            .bindTooltip(`Ga chuyển đến: ${toStation.name}`, { direction: 'top', permanent: true, offset: [0, -10], className: 'station-label' })
                            .addTo(pathLayer);
                    } else {
                        // Fallback to circle markers at nodes if station not matched
                        const startMarker = L.circleMarker(startPos, {
                            radius: 8,
                            fillColor: '#2563eb',
                            color: '#ffffff',
                            weight: 2.5,
                            opacity: 1,
                            fillOpacity: 0.95,
                            className: 'transfer-marker-start',
                            pane: 'routeMarkerPane'
                        }).addTo(pathLayer);
                        
                        const endMarker = L.circleMarker(endPos, {
                            radius: 8,
                            fillColor: '#ef4444',
                            color: '#ffffff',
                            weight: 2.5,
                            opacity: 1,
                            fillOpacity: 0.95,
                            className: 'transfer-marker-end',
                            pane: 'routeMarkerPane'
                        }).addTo(pathLayer);

                        startMarker.bindTooltip(segment.description + " (Bắt đầu)", { direction: 'top' });
                        endMarker.bindTooltip(segment.description + " (Kết thúc)", { direction: 'top' });
                    }
                }
            }
            
            const line = L.polyline(coordinates, {
                color: color,
                weight: weight,
                opacity: opacity,
                dashArray: dashArray,
                pane: 'routePane'
            });
            
            line.bindTooltip(segment.description, { sticky: true });
            pathLayer.addLayer(line);
        });
        
        // Add markers for start and end using the first/last nodes found
        const activeSegments = pathData.segments.filter(s => s.details && s.details.path && s.details.path.length > 0);
        if (activeSegments.length > 0) {
            const firstNode = activeSegments[0].details.path[0];
            const lastSegment = activeSegments[activeSegments.length - 1];
            const lastNode = lastSegment.details.path[lastSegment.details.path.length - 1];
            
            startMarker = addMarker(firstNode.x, firstNode.y, 'start');
            endMarker = addMarker(lastNode.x, lastNode.y, 'end');
            
            // Highlight Start Station in Pink
            if (pathData.start_metro_name) {
                const startStation = findStationByName(pathData.start_metro_name);
                if (startStation) {
                    const startIcon = createColoredStationIcon('#ec4899', '#be185d', '#ffffff'); // Pink
                    L.marker([startStation.lat, startStation.lng], { icon: startIcon, pane: 'routeMarkerPane' })
                        .bindTooltip(`Ga xuất phát: ${startStation.name}`, { direction: 'top', permanent: true, offset: [0, -10], className: 'station-label' })
                        .addTo(pathLayer);
                }
            }
            
            // Highlight End Station in Pink
            if (pathData.end_metro_name) {
                const endStation = findStationByName(pathData.end_metro_name);
                if (endStation) {
                    const endIcon = createColoredStationIcon('#ec4899', '#be185d', '#ffffff'); // Pink
                    L.marker([endStation.lat, endStation.lng], { icon: endIcon, pane: 'routeMarkerPane' })
                        .bindTooltip(`Ga đích: ${endStation.name}`, { direction: 'top', permanent: true, offset: [0, -10], className: 'station-label' })
                        .addTo(pathLayer);
                }
            }
        }
    }
    // Check if we have edges: [{from: {x, y}, to: {x, y}}, ...]
    else if (Array.isArray(pathData) && pathData.length > 0 && pathData[0].from && pathData[0].to) {
        // Draw edges
        pathData.forEach(edge => {
            const line = L.polyline([
                dbToLeaflet(edge.from.x, edge.from.y),
                dbToLeaflet(edge.to.x, edge.to.y)
            ], {
                color: '#3b82f6',
                weight: 4,
                opacity: 0.8,
                pane: 'routePane'
            });
            pathLayer.addLayer(line);
        });
        
        // Add markers for start and end
        const firstEdge = pathData[0];
        const lastEdge = pathData[pathData.length - 1];
        
        startMarker = addMarker(firstEdge.from.x, firstEdge.from.y, 'start');
        endMarker = addMarker(lastEdge.to.x, lastEdge.to.y, 'end');
        
    } else if (Array.isArray(pathData) && pathData.length > 0 && pathData[0].x !== undefined && pathData[0].y !== undefined) {
        // Draw path from nodes
        const coordinates = pathData.map(node => dbToLeaflet(node.x, node.y));
        
        const line = L.polyline(coordinates, {
            color: '#3b82f6',
            weight: 4,
            opacity: 0.8,
            pane: 'routePane'
        });
        pathLayer.addLayer(line);
        
        // Add markers
        const firstNode = pathData[0];
        const lastNode = pathData[pathData.length - 1];
        
        startMarker = addMarker(firstNode.x, firstNode.y, 'start');
        endMarker = addMarker(lastNode.x, lastNode.y, 'end');
    }
    
    // Fit map to show the entire path
    if (pathLayer && pathLayer.getBounds && pathLayer.getLayers().length > 0) {
        map.fitBounds(pathLayer.getBounds(), { padding: [50, 50] });
    }
}

/**
 * Draw all nodes (points) on the map
 * nodes: array of { id, x, y, ... }
 */
function showAllNodes(nodes) {
    // Clear existing node layer if any
    if (nodeLayer) {
        map.removeLayer(nodeLayer);
        nodeLayer = null;
    }

    if (!nodes || nodes.length === 0) {
        console.warn('No nodes to display');
        return;
    }

    nodeLayer = L.layerGroup().addTo(map);

    nodes.forEach(n => {
        const pos = dbToLeaflet(n.x, n.y);
        const marker = L.circleMarker(pos, {
            radius: 4,
            fillColor: '#f97316',
            color: '#fff',
            weight: 1,
            fillOpacity: 0.9
        }).bindPopup(`<b>ID:</b> ${n.id}<br><b>Coords:</b> (${n.x.toFixed(0)}, ${n.y.toFixed(0)})`);
        nodeLayer.addLayer(marker);
    });

    // Optionally fit bounds to nodes if many
    if (nodeLayer && nodeLayer.getBounds && nodeLayer.getLayers().length) {
        try {
            map.fitBounds(nodeLayer.getBounds(), { padding: [40, 40] });
        } catch (e) {
            // ignore if single point or error
        }
    }
}

/**
 * Clear the current path from the map
 */

function clearPath() {
    // Reset base metro lines and stations styling (restores all colors and all stations)
    resetBaseMetroLayers();

    if (pathLayer) {
        map.removeLayer(pathLayer);
        pathLayer = null;
    }
    
    if (startMarker) { // <-- Logic xóa Start Marker
        map.removeLayer(startMarker);
        startMarker = null;
    }
    
    if (endMarker) { // <-- Logic xóa End Marker
        map.removeLayer(endMarker);
        endMarker = null;
    }
}
/**
 * Clear nodes layer
 */
function clearNodes() {
    if (nodeLayer) {
        map.removeLayer(nodeLayer);
        nodeLayer = null;
    }
}

/**
 * Highlight a specific node on the map
 */
function highlightNode(x, y) {
    const position = dbToLeaflet(x, y);
    
    const marker = L.circleMarker(position, {
        radius: 8,
        fillColor: '#fbbf24',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8,
        pane: 'routeMarkerPane'
    }).addTo(map);
    
    // Pulse animation
    marker.bindPopup('Selected Node');
    marker.openPopup();
    
    return marker;
}

/**
 * Get map click coordinates
 */
function onMapClick(callback) {
    map.on('click', (e) => {
        // Keep the UI order as latitude, longitude.
        const x = e.latlng.lat;
        const y = e.latlng.lng;
        
        callback(x, y);
    });
}

function setStartMarker(marker) {
    startMarker = marker;
}

function setEndMarker(marker) {
    endMarker = marker;
}

/**
 * Calculate the convex hull of N points using Andrew's Monotone Chain algorithm
 */
function getConvexHull(points) {
    if (points.length <= 2) return points;
    
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
 * Draw a soft, smooth enclosing shape for the rain area based on points
 */
function createRainPolygon(points, scenarioData) {
    if (!points || points.length === 0) return null;
    
    let layer;
    if (points.length === 1) {
        const radius = scenarioData.threshold || 50;
        layer = L.circle(points[0], {
            radius: radius,
            color: scenarioData.color,
            fillColor: scenarioData.color,
            fillOpacity: 0.35,
            weight: 2
        });
    } else if (points.length === 2) {
        const p1 = points[0];
        const p2 = points[1];
        const radiusMeters = scenarioData.threshold || 50;
        const R = radiusMeters / 111000;
        
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
            
            for (let angle = theta - Math.PI / 2; angle <= theta + Math.PI / 2; angle += Math.PI / 16) {
                const lat = p2[0] + R * Math.sin(angle);
                const lng = p2[1] + R * Math.cos(angle);
                pointsList.push([lat, lng]);
            }
            
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
        const hull = getConvexHull(points);
        const smoothed = getCatmullRomSplineClosed(hull, 12);
        
        layer = L.polygon(smoothed, {
            color: scenarioData.color,
            fillColor: scenarioData.color,
            fillOpacity: 0.35,
            weight: 3,
            lineJoin: 'round'
        });
    }
    return layer;
}

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
 * Get configuration
 */
function getScenarioData(scenario) {
    const scenarios = {
        'rain-light': { name: 'Light Rain', type: 'rain', penalty: 1.2, threshold: 30, color: '#60a5fa' },
        'rain-medium': { name: 'Medium Rain', type: 'rain', penalty: 1.5, threshold: 50, color: '#2563eb' },
        'rain-heavy': { name: 'Heavy Rain', type: 'rain', penalty: 2.0, threshold: 70, color: '#14358eff' },
        'rain-extreme': { name: 'Extreme Rain', type: 'rain', penalty: 3.0, threshold: 100, color: '#663adfff' },
        'metro-block': { name: 'Metro Block', type: 'metro-block', penalty: 10000, threshold: 50, color: '#ff0055' }
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
    const scenarios = getScenarioData();
    for (const key in scenarios) {
        if (scenarios[key].type === type && scenarios[key].penalty === penalty) {
            return key;
        }
    }
    if (type === 'metro-block') return 'metro-block';
    return 'rain-light'; 
}

/**
 * Load and draw active scenarios from the backend API onto the map
 */
async function loadAndDrawActiveScenarios() {
    if (!map || !activeScenariosLayer) return;
    
    try {
        const response = await fetch(`${AppConfig.API_BASE_URL}/api/scenarios/`);
        if (!response.ok) throw new Error('Could not fetch scenarios.');
        
        const scenarios = await response.json();
        
        // Clear old visual layers
        activeScenariosLayer.clearLayers();
        
        scenarios.forEach(scenario => {
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
                visualLayer = createRainPolygon(clickPoints, customScenarioData);
            } else { // block or metro-block
                const drawPath = (scenario.blocked_path && scenario.blocked_path.length > 0) ? scenario.blocked_path : clickPoints;
                const clickedStart = [scenario.line_start.lat, scenario.line_start.lng];
                const clickedEnd = [scenario.line_end.lat, scenario.line_end.lng];
                visualLayer = createBlockedBarrier(drawPath, scenario.scenario_type, null, clickedStart, clickedEnd);
            }
            
            if (visualLayer) {
                activeScenariosLayer.addLayer(visualLayer);
            }
        });
        
    } catch (error) {
        console.error('Error loadAndDrawActiveScenarios:', error);
    }
}

// Window local storage synchronization listener to auto-refresh scenarios
window.addEventListener('storage', (e) => {
    if (e.key === 'scenarios_updated') {
        loadAndDrawActiveScenarios();
    }
});

// Export functions for use in other modules
window.MapModule = {
    init: initializeMap,
    drawPath: drawPath,
    clearPath: clearPath,
    addMarker: addMarker,
    highlightNode: highlightNode,
    onMapClick: onMapClick,
    dbToLeaflet: dbToLeaflet,
    findNearestStation: findNearestStation,
    showAllNodes: showAllNodes, // <-- exported
    clearNodes: clearNodes,      // <-- exported
    getMap: () => map,
    getStartMarker: () => startMarker,
    getEndMarker: () => endMarker,
    getPathLayer: () => pathLayer,
    setPathLayer: (layer) => pathLayer = layer,
    setStartMarker,
    setEndMarker,
    loadAndDrawActiveScenarios: loadAndDrawActiveScenarios
};
