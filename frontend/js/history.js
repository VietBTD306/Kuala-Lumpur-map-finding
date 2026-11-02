/**
 * History Module for Undo/Redo
 * Manages application state history.
 */

const History = (function() {
    const undoStack = [];
    const redoStack = [];

    // Function to get the current state of the application
    function getCurrentState() {
        const startMarker = MapModule.getStartMarker();
        const endMarker = MapModule.getEndMarker();
        const pathLayer = MapModule.getPathLayer();

        const startMarkerData = startMarker ? {
            latlng: startMarker.getLatLng(),
            x: document.getElementById('startX').value,
            y: document.getElementById('startY').value
        } : null;

        const endMarkerData = endMarker ? {
            latlng: endMarker.getLatLng(),
            x: document.getElementById('endX').value,
            y: document.getElementById('endY').value
        } : null;

        const pathLayerData = pathLayer ? pathLayer.toGeoJSON() : null;

        return {
            startMarkerData: startMarkerData,
            endMarkerData: endMarkerData,
            pathLayerData: pathLayerData,
            pathInfoHTML: document.getElementById('pathInfo').innerHTML,
        };
    }

    // Function to restore a given state
    function restoreState(state) {
        // Clear the current map state
        MapModule.clearPath();
        
        // Restore start marker
        if (state.startMarkerData) {
            const { x, y } = state.startMarkerData;
            const newStartMarker = MapModule.addMarker(parseFloat(x), parseFloat(y), 'start');
            MapModule.setStartMarker(newStartMarker);
            document.getElementById('startX').value = x;
            document.getElementById('startY').value = y;
        } else {
            MapModule.setStartMarker(null);
            document.getElementById('startX').value = '';
            document.getElementById('startY').value = '';
        }

        // Restore end marker
        if (state.endMarkerData) {
            const { x, y } = state.endMarkerData;
            const newEndMarker = MapModule.addMarker(parseFloat(x), parseFloat(y), 'end');
            MapModule.setEndMarker(newEndMarker);
            document.getElementById('endX').value = x;
            document.getElementById('endY').value = y;
        } else {
            MapModule.setEndMarker(null);
            document.getElementById('endX').value = '';
            document.getElementById('endY').value = '';
        }

        // Restore path layer
        if (state.pathLayerData) {
            const restoredLayer = L.geoJSON(state.pathLayerData, {
                style: {
                    color: '#3b82f6',
                    weight: 4,
                    opacity: 0.8
                }
            });
            
            const newPathLayer = L.layerGroup();
            restoredLayer.getLayers().forEach(layer => {
                newPathLayer.addLayer(layer);
            });
            
            const map = MapModule.getMap();
            if (map) {
                newPathLayer.addTo(map);
            }
            MapModule.setPathLayer(newPathLayer);
        } else {
            MapModule.setPathLayer(null);
        }

        // Restore path info
        document.getElementById('pathInfo').innerHTML = state.pathInfoHTML;
    }

    function save() {
        // Clear the redo stack whenever a new action is taken
        redoStack.length = 0;
        const state = getCurrentState();
        undoStack.push(state);
        // Add a limit to the undo stack to prevent memory issues
        if (undoStack.length > 50) {
            undoStack.shift(); // Remove the oldest state
        }
        console.log('State saved. Undo stack size:', undoStack.length);
    }

    function undo() {
        if (undoStack.length > 0) {
            // Push current state to redo stack BEFORE undoing
            const currentState = getCurrentState();
            redoStack.push(currentState);

            const stateToRestore = undoStack.pop();
            restoreState(stateToRestore);
            console.log('Undo complete. Redo stack size:', redoStack.length);
        } else {
            console.log('Nothing to undo.');
        }
    }

    function redo() {
        if (redoStack.length > 0) {
            // Push current state to undo stack BEFORE redoing
            const currentState = getCurrentState();
            undoStack.push(currentState);
            
            const stateToRestore = redoStack.pop();
            restoreState(stateToRestore);
            console.log('Redo complete. Undo stack size:', undoStack.length);
        } else {
            console.log('Nothing to redo.');
        }
    }

    return {
        save,
        undo,
        redo
    };
})();

// Add keyboard listeners for Ctrl+Z (undo) and Ctrl+Shift+Z (redo)
document.addEventListener('keydown', function(event) {
    if (event.ctrlKey && event.key === 'z' && event.shiftKey) {
        event.preventDefault();
        History.redo();
    } else if (event.ctrlKey && event.key === 'z') {
        event.preventDefault();
        History.undo();
    }
});
