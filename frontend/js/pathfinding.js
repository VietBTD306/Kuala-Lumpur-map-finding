/**
 * Pathfinding UI Logic
 * Handles user interactions and API calls
 */

const API_BASE_URL = AppConfig.API_BASE_URL;

// DOM Elements
const startXInput = document.getElementById('startX');
const startYInput = document.getElementById('startY');
const endXInput = document.getElementById('endX');
const endYInput = document.getElementById('endY');
const selectStartBtn = document.getElementById('selectStartBtn');
const selectEndBtn = document.getElementById('selectEndBtn');
const findPathBtn = document.getElementById('findPathBtn');
const findRoadBtn = document.getElementById('findRoadBtn');
const clearBtn = document.getElementById('clearBtn');
const pathInfo = document.getElementById('pathInfo');
const statusMessage = document.getElementById('statusMessage');
const loadingOverlay = document.getElementById('loadingOverlay');
const btnFoot = document.getElementById('btnFoot');
const btnMotorbike = document.getElementById('btnMotorbike');
const btnCar = document.getElementById('btnCar');

// NEW: DOM Element for the Show Nodes button
const showNodesBtn = document.getElementById('showNodesBtn'); 

// State
let selectingMode = null; // 'start' or 'end'
let currentPath = null;
let nodesShown = false; // <-- NEW: State to track node visibility
let selectedVehicle = 'foot'; // Default vehicle
let activeRouteType = 'multimodal'; // Default route type to display
let currentSearchMode = 'metro'; // Default search mode ('metro' or 'road')

function loadAndDrawScenarios() {
    MapModule.loadAndDrawActiveScenarios();
}

const SPEED_CAR = 11.1; // ~40 km/h in m/s
const SPEED_MOTORBIKE = 8.3; // ~30 km/h in m/s
const SPEED_FOOT = 1.4; // ~5 km/h in m/s

function formatCoordinate(value) {
    return Number.parseFloat(value);
}

/**
 * Initialize the application
 */
function init() {
    // Initialize map
    MapModule.init(AppConfig.GEOJSON_URL);
    
    // Setup event listeners
    setupEventListeners();
    
    // Tải và vẽ kịch bản
    loadAndDrawScenarios();
    
    updateStatus('Ready. Click on the map or enter coordinates to begin.');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Select start button
    selectStartBtn.addEventListener('click', () => {
        selectingMode = 'start';
        selectStartBtn.classList.add('active');
        selectEndBtn.classList.remove('active');
        updateStatus('Click on the map to select START point.');
    });
    
    // Select end button
    selectEndBtn.addEventListener('click', () => {
        selectingMode = 'end';
        selectEndBtn.classList.add('active');
        selectStartBtn.classList.remove('active');
        updateStatus('Click on the map to select END point.');
    });
    
    // Find path button
    findPathBtn.addEventListener('click', () => findPath('metro'));

    // Find road path button
    if (findRoadBtn) {
        findRoadBtn.addEventListener('click', () => findPath('road'));
    }
    
    // Clear button
    clearBtn.addEventListener('click', clearAll);
    
    // Vehicle buttons
    btnCar.addEventListener('click', () => toggleVehicle('car', btnCar, [btnFoot, btnMotorbike]));
    btnFoot.addEventListener('click', () => toggleVehicle('foot', btnFoot, [btnCar, btnMotorbike]));
    btnMotorbike.addEventListener('click', () => toggleVehicle('motorbike', btnMotorbike, [btnCar, btnFoot]));

    // NEW: Toggle Nodes button
    // showNodesBtn.addEventListener('click', toggleShowNodes); 
    
    // Map click handler
    MapModule.onMapClick((x, y) => {
        History.save(); // Save state before changing it
        if (selectingMode === 'start') {
            startXInput.value = formatCoordinate(x);
            startYInput.value = formatCoordinate(y);
            MapModule.addMarker(x, y, 'start');
            selectStartBtn.classList.remove('active');
            selectingMode = null;
            updateStatus('Start point selected. Now select END point.');
        } else if (selectingMode === 'end') {
            endXInput.value = formatCoordinate(x);
            endYInput.value = formatCoordinate(y);
            MapModule.addMarker(x, y, 'end');
            selectEndBtn.classList.remove('active');
            selectingMode = null;
            updateStatus('End point selected. Click "Find Optimal Path" to calculate route.');
        }
    });

    // Listen for storage changes to auto-refresh path on scenario updates
    window.addEventListener('storage', (e) => {
        if (e.key === 'scenarios_updated') {
            loadAndDrawScenarios();
            if (currentPath) {
                updateStatus('🔄 Scenarios updated by admin. Recalculating path...');
                findPath();
            }
        }
    });
}

/**
 * Handle Vehicle Toggle Logic
 */
function toggleVehicle(type, btnClicked, otherBtns) {
    if (selectedVehicle === type) {
        // Nếu nhấn chọn thêm 1 lần nữa vào nút đang được chọn thì nút sẽ tắt
        selectedVehicle = null;
        btnClicked.classList.remove('active');
        updateStatus('⚠️ Chưa chọn phương tiện. Vui lòng chọn phương tiện.');
    } else {
        // Chọn phương tiện mới
        selectedVehicle = type;
        btnClicked.classList.add('active');
        otherBtns.forEach(btn => btn.classList.remove('active'));
        updateStatus(`Đang chọn ${type === 'car' ? 'Car' : type === 'motorbike' ? 'Xe máy' : 'Đi bộ'}`);
        
        // Nếu đã có đường đi, tự động tìm lại đường mới với phương tiện mới
        if (currentPath) {
            findPath();
        }
    }
}

/**
 * Find optimal path between start and end points
 */

async function findPath(mode) {
    if (mode === 'metro' || mode === 'road') {
        currentSearchMode = mode;
    }
    const activeMode = currentSearchMode;
    History.save(); // Save state before finding a new path
    // Validate inputs
    const startX = parseFloat(startXInput.value);
    const startY = parseFloat(startYInput.value);
    const endX = parseFloat(endXInput.value);
    const endY = parseFloat(endYInput.value);
    
    if (isNaN(startX) || isNaN(startY)) {
        updateStatus('❌ Please select or enter a valid START point.');
        return;
    }
    
    if (isNaN(endX) || isNaN(endY)) {
        updateStatus('❌ Please select or enter a valid END point.');
        return;
    }

    if (!selectedVehicle) {
        updateStatus('⚠️ Vui lòng chọn phương tiện để tìm đường.');
        return;
    }
    
    // Show loading
    showLoading(true, activeMode);
    updateStatus(activeMode === 'road' ? '🔍 Đang tìm đường đi tối ưu...' : '🔍 Đang tìm tuyến Metro tối ưu...');
    
    const speed = selectedVehicle === 'car' ? SPEED_CAR : selectedVehicle === 'motorbike' ? SPEED_MOTORBIKE : SPEED_FOOT;

    try {
        // ACTUAL API CALL: Fetch path from the backend service
        const response = await fetch(
            `${API_BASE_URL}/api/path?start_x=${startX}&start_y=${startY}&end_x=${endX}&end_y=${endY}&vehicle=${selectedVehicle}&speed=${speed}&mode=${activeMode}`
        );
        
        if (!response.ok) {
            // Attempt to read error detail from JSON response
            const errorData = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(errorData.detail || 'Failed to find path');
        }
        
        const data = await response.json();
        
        // Save current path data globally
        currentPath = data;
        
        // Set default active tab based on activeMode
        if (activeMode === 'road') {
            activeRouteType = data.direct ? 'direct' : (data.multimodal ? 'multimodal' : 'multimodal_direct_metro');
        } else {
            activeRouteType = data.multimodal ? 'multimodal' : (data.multimodal_direct_metro ? 'multimodal_direct_metro' : 'direct');
        }
        
        // Render current active route
        renderActiveRoute();
        
        updateStatus('✅ Path found successfully!');
        
    } catch (error) {
        console.error('Error finding path:', error);
        
        // Display the specific error detail if available
        const errorMessage = error.message.startsWith('Failed') 
            ? 'Could not calculate path. Make sure start/end points are near valid nodes.' 
            : error.message;
            
        updateStatus(`❌ Error finding path: ${errorMessage}`);
        showErrorInfo(errorMessage);
    } finally {
        showLoading(false);
    }
}

/**
 * NEW: Toggle visibility of all nodes from the database
 */

function toggleShowNodes() {
    if (nodesShown) {
        // Hide nodes
        MapModule.clearNodes();
        showNodesBtn.textContent = '🟠 Toggle All Nodes';
        showNodesBtn.style.backgroundColor = '#f97316';
        updateStatus('Nodes ẩn. Sẵn sàng.');
        nodesShown = false;
    } else {
        // Show nodes
        fetchAndShowNodes();
    }
}


/**
 * NEW: Fetch all nodes from API and display them on the map
 */

async function fetchAndShowNodes() {
    showLoading(true);
    updateStatus('⏳ Đang tải dữ liệu nodes...');

    try {
        // Assuming API endpoint is /nodes as discussed
        const response = await fetch(`${API_BASE_URL}/api/nodes`); 
        
        if (!response.ok) {
            throw new Error(`API call failed with status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.nodes && data.nodes.length > 0) {
            // Use the exported function from MapModule (already in map.js)
            const correctedNodes = data.nodes.map(node => ({ ...node, y: node.y }));

            // Use the exported function from MapModule (already in map.js)
            MapModule.showAllNodes(correctedNodes);
            
            nodesShown = true;
            showNodesBtn.textContent = '✅ Hide All Nodes';
            showNodesBtn.style.backgroundColor = '#10b981'; // Green color for active state
            updateStatus(`✅ Đã tải và hiển thị ${data.nodes.length} nodes.`);
        } else {
            updateStatus('⚠️ Không tìm thấy nodes nào trong cơ sở dữ liệu.');
        }

    } catch (error) {
        console.error('Error fetching and showing nodes:', error);
        updateStatus('❌ Lỗi khi tải nodes. Vui lòng kiểm tra API server (endpoint /nodes).');
    } finally {
        showLoading(false);
    }
}


/**
 * Generate mock path data for demonstration
 */
/*
function generateMockPath(startX, startY, endX, endY) {
    // Generate some intermediate points for a curved path
    const numPoints = 5;
    const path = [];
    
    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = startX + (endX - startX) * t + Math.sin(t * Math.PI) * 200;
        const y = startY + (endY - startY) * t + Math.cos(t * Math.PI) * 200;
        
        path.push({ x, y });
    }
    
    // Calculate mock distance
    const distance = Math.sqrt(
        Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
    );
    
    return {
        path: path,
        distance: distance.toFixed(2),
        nodes: numPoints + 1,
        cost: (distance / 100).toFixed(2)
    };
}
*/
/**
 * Display path information
 */
function renderActiveRoute() {
    if (!currentPath) return;
    
    const transferPlan = currentPath.multimodal;
    const directMetroPlan = currentPath.multimodal_direct_metro;
    const directRoadPlan = currentPath.direct;
    
    let showTransfer = false;
    let showDirectMetro = false;
    
    if (currentSearchMode === 'metro') {
        if (directMetroPlan) {
            if (transferPlan) {
                const timeSaved = directMetroPlan.total_time_minutes - transferPlan.total_time_minutes;
                // Show transfer tab if it saves more than 0.1 minutes (6 seconds)
                if (timeSaved > 0.1) {
                    showTransfer = true;
                    showDirectMetro = true;
                } else {
                    showTransfer = false;
                    showDirectMetro = true;
                }
            } else {
                showDirectMetro = true;
            }
        } else if (transferPlan) {
            showTransfer = true;
        }
    }
    
    // Check if we need to adjust activeRouteType if the selected tab is now hidden
    if (currentSearchMode === 'road') {
        activeRouteType = 'direct';
    } else {
        if (activeRouteType === 'direct') {
            activeRouteType = showTransfer ? 'multimodal' : 'multimodal_direct_metro';
        } else if (activeRouteType === 'multimodal' && !showTransfer) {
            if (showDirectMetro) {
                activeRouteType = 'multimodal_direct_metro';
            }
        } else if (activeRouteType === 'multimodal_direct_metro' && !showDirectMetro) {
            if (showTransfer) {
                activeRouteType = 'multimodal';
            }
        }
    }
    
    // Select the plan again after fallback adjustments
    let plan = currentPath[activeRouteType];
    if (!plan) {
        // Absolute fallback
        if (showDirectMetro) {
            activeRouteType = 'multimodal_direct_metro';
        } else if (showTransfer) {
            activeRouteType = 'multimodal';
        } else {
            activeRouteType = 'direct';
        }
        plan = currentPath[activeRouteType];
    }
    
    if (!plan) {
        showErrorInfo("Không tìm thấy lộ trình phù hợp.");
        return;
    }
    
    // Draw path on map
    MapModule.drawPath(plan);
    
    // Nearest stations lookup for fallback labels
    const startStation = MapModule.findNearestStation(
        parseFloat(startXInput.value),
        parseFloat(startYInput.value)
    );
    const endStation = MapModule.findNearestStation(
        parseFloat(endXInput.value),
        parseFloat(endYInput.value)
    );
    
    // Build tabs selector HTML
    let tabsHtml = `<div class="route-tabs" style="display: flex; gap: 8px; margin-bottom: 15px; flex-wrap: wrap;">`;
    
    // 1. Render Transfer Metro Tab
    if (showTransfer && transferPlan) {
        const isActive = activeRouteType === 'multimodal';
        const bg = isActive ? 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)' : 'rgba(255, 255, 255, 0.03)';
        const color = isActive ? '#ffffff' : 'var(--text-muted)';
        const border = isActive ? 'none' : '1px solid var(--border)';
        const label = selectedVehicle === 'car' ? '🚗+🚇 Metro chuyển tuyến' : selectedVehicle === 'motorbike' ? '🏍️+🚇 Metro chuyển tuyến' : '🚶+🚇 Metro chuyển tuyến';
        tabsHtml += `
            <button onclick="switchRouteType('multimodal')" class="route-tab-btn" style="flex: 1; padding: 10px 8px; border: ${border}; border-radius: 8px; background: ${bg}; color: ${color}; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap;">
                ${label} (${Math.round(transferPlan.total_time_minutes)} phút)
            </button>
        `;
    }
    
    // 2. Render Direct Metro Tab
    if (showDirectMetro && directMetroPlan) {
        const isActive = activeRouteType === 'multimodal_direct_metro';
        const bg = isActive ? 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)' : 'rgba(255, 255, 255, 0.03)';
        const color = isActive ? '#ffffff' : 'var(--text-muted)';
        const border = isActive ? 'none' : '1px solid var(--border)';
        const label = selectedVehicle === 'car' ? '🚗+🚇 Metro đi thẳng' : selectedVehicle === 'motorbike' ? '🏍️+🚇 Metro đi thẳng' : '🚶+🚇 Metro đi thẳng';
        tabsHtml += `
            <button onclick="switchRouteType('multimodal_direct_metro')" class="route-tab-btn" style="flex: 1; padding: 10px 8px; border: ${border}; border-radius: 8px; background: ${bg}; color: ${color}; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap;">
                ${label} (${Math.round(directMetroPlan.total_time_minutes)} phút)
            </button>
        `;
    }
    
    // 3. Render Direct Road Tab
    if (directRoadPlan) {
        const isActive = activeRouteType === 'direct';
        const bg = isActive ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(255, 255, 255, 0.03)';
        const color = isActive ? '#ffffff' : 'var(--text-muted)';
        const border = isActive ? 'none' : '1px solid var(--border)';
        const modeLabel = selectedVehicle === 'car' ? '🚗 Ô tô đi thẳng' : selectedVehicle === 'motorbike' ? '🏍️ Xe máy đi thẳng' : '🚶 Đi bộ đi thẳng';
        tabsHtml += `
            <button onclick="switchRouteType('direct')" class="route-tab-btn" style="flex: 1; padding: 10px 8px; border: ${border}; border-radius: 8px; background: ${bg}; color: ${color}; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap;">
                ${modeLabel} (${Math.round(directRoadPlan.total_time_minutes)} phút)
            </button>
        `;
    }
    tabsHtml += `</div>`;
    
    // Build segment descriptions
    let segmentsHtml = `<div class="segments-list" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">`;
    plan.segments.forEach((segment) => {
        let icon = 'navigation';
        let color = '#3b82f6';
        let bgStyle = 'rgba(59, 130, 246, 0.06)';
        
        if (segment.mode === 'foot') {
            icon = 'person-standing';
            color = '#10b981';
            bgStyle = 'rgba(16, 185, 129, 0.06)';
        } else if (segment.mode === 'motorbike') {
            icon = 'bike';
            color = '#f59e0b';
            bgStyle = 'rgba(245, 158, 11, 0.06)';
        } else if (segment.mode === 'car') {
            icon = 'car';
            color = '#3b82f6';
            bgStyle = 'rgba(59, 130, 246, 0.06)';
        } else if (segment.mode === 'metro') {
            icon = 'train';
            color = '#e11d48';
            bgStyle = 'rgba(225, 29, 72, 0.06)';
        } else if (segment.mode === 'transfer') {
            icon = 'clock';
            color = '#d97706';
            bgStyle = 'rgba(217, 119, 6, 0.06)';
        }
        
        segmentsHtml += `
            <div class="segment-card" style="display: flex; gap: 10px; background: ${bgStyle}; border-left: 4px solid ${color}; padding: 10px 12px; border-radius: 8px; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.02); border-bottom: 1px solid rgba(0, 0, 0, 0.1);">
                <div class="segment-icon" style="color: ${color}; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: rgba(255, 255, 255, 0.05); border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                    <i data-lucide="${icon}" style="width: 14px; height: 14px;"></i>
                </div>
                <div class="segment-details" style="flex: 1;">
                    <div style="font-weight: 500; font-size: 0.85rem; color: var(--text-main);">${segment.description}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                        ${segment.distance_meters > 0 ? (segment.distance_meters >= 1000 ? `${(segment.distance_meters / 1000).toFixed(2)} km` : `${segment.distance_meters} m`) : ''} 
                        ${segment.distance_meters > 0 && segment.time_seconds > 0 ? ' • ' : ''} 
                        ${segment.time_seconds > 0 ? `${Math.round(segment.time_seconds / 60)} phút` : ''}
                    </div>
                </div>
            </div>
        `;
    });
    segmentsHtml += `</div>`;
    
    // Bind station names directly from active plan's backend data
    const startStationName = plan.start_metro_name || (startStation ? startStation.name : 'Không đi qua Metro');
    const endStationName = plan.end_metro_name || (endStation ? endStation.name : 'Không đi qua Metro');
 
    // Update pathInfo panel
    pathInfo.innerHTML = `
        ${tabsHtml}
        
        <div class="route-summary" style="background: linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(29, 78, 216, 0.05) 100%); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 10px; padding: 12px; margin-bottom: 15px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: center;">
                <div style="border-right: 1px solid rgba(59, 130, 246, 0.15);">
                    <span style="font-size: 0.75rem; color: var(--text-muted); display: block; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Khoảng cách</span>
                    <span style="font-size: 1.1rem; font-weight: 700; color: #60a5fa;">${(plan.total_distance_meters / 1000).toFixed(2)} km</span>
                </div>
                <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); display: block; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Thời gian</span>
                    <span style="font-size: 1.1rem; font-weight: 700; color: #60a5fa;">${Math.round(plan.total_time_minutes)} phút</span>
                </div>
            </div>
        </div>
 
        <div class="info-item" style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
            <span class="info-label" style="font-size: 0.8rem; color: var(--text-muted);">Ga gần xuất phát:</span>
            <span class="info-value" style="font-size: 0.8rem; font-weight: 600; color: var(--text-main);">${startStationName}</span>
        </div>
        <div class="info-item" style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); margin-bottom: 15px;">
            <span class="info-label" style="font-size: 0.8rem; color: var(--text-muted);">Ga gần điểm đích:</span>
            <span class="info-value" style="font-size: 0.8rem; font-weight: 600; color: var(--text-main);">${endStationName}</span>
        </div>
        
        <h4 style="margin-top: 15px; margin-bottom: 8px; font-size: 0.75rem; color: var(--primary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Chi tiết chặng đi:</h4>
        ${segmentsHtml}
    `;
    
    // Rerender icons
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

/**
 * Display path information (legacy entry points to keep code compatible)
 */
function displayPathInfo(data) {
    currentPath = data;
    renderActiveRoute();
}

/**
 * Switch active route type (multimodal vs direct)
 */
window.switchRouteType = function(type) {
    activeRouteType = type;
    renderActiveRoute();
};

/**
 * Show error in path info panel
 */
function showErrorInfo(message) {
    pathInfo.innerHTML = `<p style="color: #ef4444; text-align: center;">${message}</p>`;
}

/**
 * Clear all selections and path
 */
function clearAll() {
    History.save(); // Save state before clearing
    // Clear inputs
    startXInput.value = '';
    startYInput.value = '';
    endXInput.value = '';
    endYInput.value = '';
    
    // Clear map
    MapModule.clearPath();
    
    // Clear path info
    pathInfo.innerHTML = '<p class="no-data">No path calculated yet</p>';
    
    // Reset state
    selectingMode = null;
    currentPath = null;
    selectStartBtn.classList.remove('active');
    selectEndBtn.classList.remove('active');
    
    // Note: "Khi nút đã được chọn thì sẽ không tắt cho đến khi bị chọn sang phương tiện khác"
    // So we do NOT reset selectedVehicle here.
    // But if we wanted to reset to default:
    // selectedVehicle = 'foot';
    // document.getElementById('btnFoot').classList.add('active');
    // document.getElementById('btnCar').classList.remove('active');
    
    // Clear nodes if shown
    if (nodesShown) {
        MapModule.clearNodes();
        nodesShown = false;
        showNodesBtn.textContent = '🟠 Toggle All Nodes';
        showNodesBtn.style.backgroundColor = '#f97316';
    }
    
    updateStatus('Ready. Click on the map or enter coordinates to begin.');
}

/**
 * Update status message
 */
function updateStatus(message) {
    statusMessage.textContent = message;
}

/**
 * Show/hide loading overlay
 */
function showLoading(show, mode = 'metro') {
    if (show) {
        const textEl = loadingOverlay.querySelector('p');
        if (textEl) {
            textEl.textContent = mode === 'road' 
                ? 'Đang tính toán đường đi đường bộ...' 
                : 'Đang tính toán tuyến đường Metro tối ưu...';
        }
        loadingOverlay.style.display = 'flex';
    } else {
        loadingOverlay.style.display = 'none';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
