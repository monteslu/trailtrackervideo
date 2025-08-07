class BikeTrailProcessor {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentSession = null;
        this.images = [];
        this.currentIndex = 0;
        this.isProcessing = false;
        this.isPaused = false;
        this.altitudeRange = { min: 0, max: 0 };
        this.bikeIcon = null;
        this.routeMap = null;
        this.detailMap = null;
        this.routeMapCanvas = null;
        this.detailMapCanvas = null;
        
        this.init();
    }

    async init() {
        // Clean up any existing popups from previous sessions
        this.cleanupExistingPopups();
        
        // Add cleanup on page unload to prevent memory leaks
        this.setupUnloadCleanup();
        
        await this.loadBikeIcon();
        this.initializeMaps();
        await this.loadSessions();
        this.setupEventListeners();
        await this.loadCacheStats();
    }
    
    setupUnloadCleanup() {
        window.addEventListener('beforeunload', () => {
            console.log('🧹 Cleaning up resources before page unload');
            this.stopScreenCapture();
            this.cleanupPopup();
            this.cleanupCanvas();
        });
    }
    
    cleanupCanvas() {
        // Clean up any canvas references
        if (this.routeMapCanvas) {
            this.routeMapCanvas.width = 1;
            this.routeMapCanvas.height = 1;
            this.routeMapCanvas = null;
        }
        if (this.detailMapCanvas) {
            this.detailMapCanvas.width = 1;
            this.detailMapCanvas.height = 1;
            this.detailMapCanvas = null;
        }
        if (this.canvas) {
            this.canvas.width = 1;
            this.canvas.height = 1;
        }
        if (this.ctx) {
            this.ctx = null;
        }
    }
    
    cleanupExistingPopups() {
        try {
            // Try to find and close any existing mapCapture popups
            if (window.mapCapturePopup && !window.mapCapturePopup.closed) {
                window.mapCapturePopup.close();
                console.log('Closed existing popup from previous session');
            }
            
            // Also check our instance variable
            if (this.mapPopup && !this.mapPopup.closed) {
                this.mapPopup.close();
                console.log('Closed existing instance popup');
            }
            
            // Reset popup references
            this.mapPopup = null;
            this.mapCoordinates = null;
            window.mapCapturePopup = null;
            
        } catch (error) {
            console.warn('Error cleaning up existing popups:', error);
        }
    }

    initializeMaps() {
        // Get canvas references (maps are in iframe now)
        this.routeMapCanvas = document.getElementById('routeMapCanvas');
        this.detailMapCanvas = document.getElementById('detailMapCanvas');
    }

    async loadBikeIcon() {
        return new Promise((resolve) => {
            this.bikeIcon = new Image();
            this.bikeIcon.onload = resolve;
            this.bikeIcon.onerror = resolve; // Continue even if image fails to load
            this.bikeIcon.src = '/images/luis_bike_100.png';
        });
    }

    async loadSessions() {
        try {
            const response = await fetch('/api/sessions');
            const sessions = await response.json();
            
            const select = document.getElementById('sessionSelect');
            select.innerHTML = '<option value="">Choose a session...</option>';
            
            sessions.forEach(session => {
                const option = document.createElement('option');
                option.value = session;
                option.textContent = session;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }

    setupEventListeners() {
        const sessionSelect = document.getElementById('sessionSelect');
        const loadBtn = document.getElementById('loadBtn');
        
        // Disable load button initially
        loadBtn.disabled = true;
        
        // Enable/disable load button based on selection
        sessionSelect.addEventListener('change', () => {
            loadBtn.disabled = !sessionSelect.value;
        });
        
        loadBtn.addEventListener('click', () => this.loadSession());
        document.getElementById('startBtn').addEventListener('click', () => this.startProcessing());
        document.getElementById('pauseBtn').addEventListener('click', () => this.pauseProcessing());
        
        // Cache management event listeners
        document.getElementById('refreshCacheBtn').addEventListener('click', () => this.loadCacheStats());
        document.getElementById('clearCacheBtn').addEventListener('click', () => this.clearCache());
        document.getElementById('preloadBtn').addEventListener('click', () => this.preloadCurrentRoute());
    }

    async loadSession() {
        const sessionName = document.getElementById('sessionSelect').value;
        if (!sessionName) return;

        const loadBtn = document.getElementById('loadBtn');
        
        // Create popup window FIRST while we have user gesture
        try {
            this.mapPopup = window.open(
                '/map-capture.html',
                'mapCapture', 
                'width=1240,height=520,scrollbars=no,resizable=no,menubar=no,toolbar=no,location=no'
            );
            
            // Store global reference for cleanup on reload
            window.mapCapturePopup = this.mapPopup;
            
            if (!this.mapPopup) {
                alert('Popup was blocked. Please allow popups for this site and try again.');
                return;
            }
        } catch (error) {
            alert('Failed to create popup window. Please allow popups for this site.');
            return;
        }
        
        // Show loading spinner
        loadBtn.innerHTML = '<span class="spinner"></span> Loading...';
        loadBtn.disabled = true;

        try {
            const response = await fetch(`/api/session/${sessionName}`);
            const data = await response.json();
            
            this.currentSession = sessionName;
            this.images = data.images;
            this.currentIndex = 0;
            
            // Reset iframe route flag for new session
            this.iframeRouteUpdated = false;
            console.log('Reset iframe for new session');
            
            // Calculate altitude range for the entire dataset
            this.calculateAltitudeRange();
            
            // Initialize popup maps after data is loaded
            await this.initializePopupMaps();
            
            document.getElementById('imageCount').textContent = data.count;
            document.getElementById('sessionInfo').style.display = 'block';
            
            console.log(`Loaded ${data.count} images from ${sessionName}`);
            
            // Reset button
            loadBtn.innerHTML = 'Load Session';
            loadBtn.disabled = false;
        } catch (error) {
            console.error('Failed to load session:', error);
            
            // Close popup if session loading failed
            if (this.mapPopup && !this.mapPopup.closed) {
                this.mapPopup.close();
            }
            this.cleanupPopup();
            
            // Reset button on error
            loadBtn.innerHTML = 'Load Session';
            loadBtn.disabled = false;
        }
    }

    async startProcessing() {
        if (!this.images.length) return;
        
        this.isProcessing = true;
        this.isPaused = false;
        
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('pauseBtn').style.display = 'inline-block';
        document.getElementById('progressContainer').style.display = 'block';
        
        // Initialize screen capture once at the start (or reinitialize if needed)
        if (!this.captureStream) {
            await this.initializeScreenCapture();
        }
        
        await this.processImages();
    }

    pauseProcessing() {
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById('pauseBtn');
        pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
        
        // If pausing for a long time, clean up screen capture to save resources
        if (this.isPaused) {
            console.log('Processing paused, cleaning up screen capture to save memory');
            this.stopScreenCapture();
        }
    }

    async processImages() {
        for (let i = this.currentIndex; i < this.images.length; i++) {
            if (!this.isProcessing) break;
            
            while (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            this.currentIndex = i;
            const image = this.images[i];
            
            await this.processImage(image, i);
            this.updateProgress(i + 1, this.images.length);
        }
        
        if (this.currentIndex >= this.images.length) {
            this.finishProcessing();
        }
    }

    async processImage(imageData, index) {
        try {
            const imagePath = `/sessions/${this.currentSession}/${imageData.filename}`;
            
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = imagePath;
            });
            
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
            
            // Update detail map position (maps are now in popup)
            this.updateDetailMapPosition(imageData);
            
            // Wait for maps to settle and be ready for screenshot
            await this.waitForMapReady();
            
            console.log(`Processing image ${index}: lat=${imageData.lat}, lon=${imageData.lon}`);
            
            // Capture iframe maps to hidden canvases
            await this.captureMapToCanvas();
            
            await this.addOverlays(imageData, index);
            
            const blob = await new Promise(resolve => {
                this.canvas.toBlob(resolve, 'image/jpeg', 0.9);
            });
            
            await this.uploadImage(blob, imageData.timestamp);
            
        } catch (error) {
            console.error('Error processing image:', error);
        }
    }

    async addOverlays(imageData, index) {
        const overlaySize = Math.floor(this.canvas.width * 0.12); // Scale to 12% of canvas width
        const margin = Math.floor(this.canvas.width * 0.015); // Scale margin proportionally
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = Math.ceil(this.canvas.width / 800); // Thicker lines
        this.ctx.font = `${Math.floor(this.canvas.width / 80)}px Arial`; // Much larger font
        this.ctx.fillStyle = '#fff';
        
        // Define altitude meter dimensions: half height, double width
        const altitudeWidth = overlaySize * 2;
        const altitudeHeight = overlaySize / 2;
        
        // Map dimensions to match captured map size (600x400 -> scale to fit overlay size)
        const mapWidth = overlaySize * 2;
        const mapHeight = Math.floor(mapWidth * 400/600); // Exact 600:400 aspect ratio
        
        // Account for 125% scaling - maps will be 25% larger
        const scaledMapWidth = Math.floor(mapWidth * 1.25);
        const scaledMapHeight = Math.floor(mapHeight * 1.25);
        
        const bottomLeft = { x: margin, y: this.canvas.height - scaledMapHeight - margin };
        const bottomRight = { x: this.canvas.width - scaledMapWidth - margin, y: this.canvas.height - scaledMapHeight - margin };
        const topRight = { x: this.canvas.width - altitudeWidth - margin, y: margin, width: altitudeWidth, height: altitudeHeight };
        
        // Skip black rectangle backgrounds - just draw altitude meter background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(topRight.x, topRight.y, altitudeWidth, altitudeHeight);
        this.ctx.strokeRect(topRight.x, topRight.y, altitudeWidth, altitudeHeight);
        
        this.ctx.fillStyle = '#fff';
        this.ctx.fillText('Route Map', bottomLeft.x + 10, bottomLeft.y + 20);
        this.ctx.fillText('Detail View', bottomRight.x + 10, bottomRight.y + 20);
        
        await this.drawRoutePreview(bottomLeft, mapWidth, mapHeight, imageData, index);
        await this.drawDetailView(bottomRight, mapWidth, mapHeight, imageData);
        this.drawAltitudeChart(topRight, altitudeWidth, altitudeHeight, index);
        
        // Position bike icons for scaled maps
        this.drawBikeIcon(bottomLeft.x + scaledMapWidth/2, bottomLeft.y + scaledMapHeight/2);
        this.drawBikeIcon(bottomRight.x + scaledMapWidth/2, bottomRight.y + scaledMapHeight/2);
    }

    async drawRoutePreview(pos, width, height, imageData, index) {
        if (!this.routeMapCanvas) return;
        
        // Scale to 125% of the calculated size (25% bigger)
        const scaledWidth = Math.floor(width * 1.25);
        const scaledHeight = Math.floor(height * 1.25);
        
        // Apply rounded corners with clipping
        this.ctx.save();
        const radius = Math.min(scaledWidth, scaledHeight) * 0.05;
        this.createRoundedRectPath(pos.x, pos.y, scaledWidth, scaledHeight, radius);
        this.ctx.clip();
        
        // Debug: Draw captured canvas actual size first to see what we're getting
        console.log(`Route map canvas size: ${this.routeMapCanvas.width}x${this.routeMapCanvas.height}`);
        console.log(`Drawing at position: ${pos.x}, ${pos.y} with size: ${scaledWidth}x${scaledHeight}`);
        
        // Draw the captured route map canvas at 125% scale
        this.ctx.drawImage(this.routeMapCanvas, pos.x, pos.y, scaledWidth, scaledHeight);
        
        this.ctx.restore();
    }

    async drawDetailView(pos, width, height, imageData) {
        if (!this.detailMapCanvas) return;
        
        // Scale to 125% of the calculated size (25% bigger)
        const scaledWidth = Math.floor(width * 1.25);
        const scaledHeight = Math.floor(height * 1.25);
        
        // Apply rounded corners with clipping
        this.ctx.save();
        const radius = Math.min(scaledWidth, scaledHeight) * 0.05;
        this.createRoundedRectPath(pos.x, pos.y, scaledWidth, scaledHeight, radius);
        this.ctx.clip();
        
        // Debug: Draw captured canvas actual size first to see what we're getting
        console.log(`Detail map canvas size: ${this.detailMapCanvas.width}x${this.detailMapCanvas.height}`);
        console.log(`Drawing at position: ${pos.x}, ${pos.y} with size: ${scaledWidth}x${scaledHeight}`);
        
        // Draw the captured detail map canvas at 125% scale
        this.ctx.drawImage(this.detailMapCanvas, pos.x, pos.y, scaledWidth, scaledHeight);
        
        this.ctx.restore();
    }
    
    createRoundedRectPath(x, y, width, height, radius) {
        // Use the modern roundRect method if available, fallback to manual path
        if (this.ctx.roundRect) {
            this.ctx.beginPath();
            this.ctx.roundRect(x, y, width, height, radius);
        } else {
            // Manual rounded rectangle path
            this.ctx.beginPath();
            this.ctx.moveTo(x + radius, y);
            
            // Top side and top-right corner
            this.ctx.lineTo(x + width - radius, y);
            this.ctx.arcTo(x + width, y, x + width, y + radius, radius);
            
            // Right side and bottom-right corner
            this.ctx.lineTo(x + width, y + height - radius);
            this.ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
            
            // Bottom side and bottom-left corner
            this.ctx.lineTo(x + radius, y + height);
            this.ctx.arcTo(x, y + height, x, y + height - radius, radius);
            
            // Left side and top-left corner
            this.ctx.lineTo(x, y + radius);
            this.ctx.arcTo(x, y, x + radius, y, radius);
            
            this.ctx.closePath();
        }
    }
    
    addTransparencyGradient(x, y, width, height) {
        // Create radial gradient from center to edges for smooth blending
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const maxRadius = Math.max(width, height) * 0.7;
        
        const gradient = this.ctx.createRadialGradient(
            centerX, centerY, 0,           // Inner circle (fully opaque)
            centerX, centerY, maxRadius    // Outer circle (transparent)
        );
        
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');      // Transparent center
        gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0)');   // Still transparent  
        gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.1)'); // Slight fade
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');   // More transparent edges
        
        // Apply gradient overlay using multiply blend mode for subtle effect
        this.ctx.globalCompositeOperation = 'multiply';
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x, y, width, height);
        
        // Reset blend mode
        this.ctx.globalCompositeOperation = 'source-over';
    }

    async captureMapAsImage(map, width, height) {
        return new Promise((resolve) => {
            // Create a clean canvas for the map
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            // Get map bounds and center
            const bounds = map.getBounds();
            const center = map.getCenter();
            const zoom = map.getZoom();
            
            // Draw background
            ctx.fillStyle = '#e5e3df'; // OSM-like background color
            ctx.fillRect(0, 0, width, height);
            
            // Draw simple map representation
            if (this.images.length > 0) {
                // Draw route as a simple line
                const gpsImages = this.images.filter(img => img.lat && img.lon);
                if (gpsImages.length > 1) {
                    ctx.strokeStyle = '#e74c3c';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    
                    // Convert lat/lng to canvas coordinates
                    const mapBounds = {
                        north: bounds.getNorth(),
                        south: bounds.getSouth(),
                        east: bounds.getEast(),
                        west: bounds.getWest()
                    };
                    
                    gpsImages.forEach((img, i) => {
                        const x = ((img.lon - mapBounds.west) / (mapBounds.east - mapBounds.west)) * width;
                        const y = height - ((img.lat - mapBounds.south) / (mapBounds.north - mapBounds.south)) * height;
                        
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    });
                    
                    ctx.stroke();
                    
                    // Draw current position if we have a route marker
                    if (this.routeMarker && this.bikeIcon) {
                        const markerPos = this.routeMarker.getLatLng();
                        const markerX = ((markerPos.lng - mapBounds.west) / (mapBounds.east - mapBounds.west)) * width;
                        const markerY = height - ((markerPos.lat - mapBounds.south) / (mapBounds.north - mapBounds.south)) * height;
                        
                        // Draw bike icon at marker position
                        const iconSize = map === this.detailMap ? 30 : 20;
                        ctx.drawImage(this.bikeIcon, markerX - iconSize/2, markerY - iconSize/2, iconSize, iconSize);
                    }
                }
            }
            
            // Add map attribution
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(0, height - 20, width, 20);
            ctx.fillStyle = '#333';
            ctx.font = '10px Arial';
            ctx.fillText('© OpenStreetMap', 5, height - 8);
            
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = canvas.toDataURL();
        });
    }

    calculateAltitudeRange() {
        if (!this.images.length) return;
        
        const altitudes = this.images.map(img => img.alt || 0).filter(alt => alt > 0);
        if (altitudes.length === 0) return;
        
        this.altitudeRange.min = Math.min(...altitudes);
        this.altitudeRange.max = Math.max(...altitudes);
        
        console.log(`Altitude range: ${this.altitudeRange.min.toFixed(0)}m - ${this.altitudeRange.max.toFixed(0)}m`);
    }

    updateMapsWithRoute() {
        if (!this.images.length || !this.mapPopup) return;

        // Filter images with valid GPS data
        const gpsImages = this.images.filter(img => img.lat && img.lon);
        if (gpsImages.length === 0) return;

        const routeCoords = gpsImages.map(img => [img.lat, img.lon]);
        
        console.log('Sending route data to popup:', routeCoords.length, 'points');
        
        // Send route data to popup via postMessage
        this.mapPopup.postMessage({
            type: 'updateRoute',
            routeCoords: routeCoords
        }, '*');
        
        // Set detail map to first GPS point
        const firstPoint = gpsImages[0];
        console.log('Setting initial detail position:', firstPoint.lat, firstPoint.lon);
        
        this.mapPopup.postMessage({
            type: 'updateDetailPosition',
            lat: firstPoint.lat,
            lon: firstPoint.lon
        }, '*');
    }

    updateDetailMapPosition(currentImage) {
        if (!currentImage || !currentImage.lat || !currentImage.lon || !this.mapPopup) return;
        
        // Use compass data from XMP metadata if available, otherwise calculate bearing
        let bearing = 90; // Default to east (90 degrees)
        
        if (currentImage.compass !== null && currentImage.compass !== undefined) {
            // Use actual compass bearing from XMP metadata
            let rawBearing = currentImage.compass;
            // Add 180° if camera was facing opposite direction (flip bearing)
            bearing = (rawBearing + 180) % 360;
            console.log(`Using XMP compass bearing: ${rawBearing}° → flipped to ${bearing}°`);
        } else {
            // Fallback: calculate bearing from previous position
            const currentIndex = this.images.indexOf(currentImage);
            if (currentIndex > 0) {
                const prevImage = this.images[currentIndex - 1];
                if (prevImage && prevImage.lat && prevImage.lon) {
                    bearing = this.calculateBearing(prevImage.lat, prevImage.lon, currentImage.lat, currentImage.lon);
                    console.log(`Calculated bearing from GPS: ${bearing.toFixed(1)}°`);
                }
            }
        }
        
        console.log(`Updating popup maps to: ${currentImage.lat}, ${currentImage.lon}, bearing: ${bearing}°`);
        
        // Send position update to popup via postMessage
        this.mapPopup.postMessage({
            type: 'updateDetailPosition',
            lat: currentImage.lat,
            lon: currentImage.lon,
            bearing: bearing
        }, '*');
        
        // Also update route marker position
        this.mapPopup.postMessage({
            type: 'updateRouteMarker', 
            lat: currentImage.lat,
            lon: currentImage.lon,
            bearing: bearing
        }, '*');
    }
    
    // Calculate bearing between two GPS points (in degrees)
    calculateBearing(lat1, lon1, lat2, lon2) {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const lat1Rad = lat1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        
        const y = Math.sin(dLon) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
        
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360; // Normalize to 0-360 degrees
    }
    
    // Wait for maps to be ready after an update
    waitForMapReady() {
        return new Promise((resolve) => {
            this.mapUpdateResolver = resolve;
            
            // Fallback timeout in case message is missed
            setTimeout(() => {
                if (this.mapUpdateResolver) {
                    console.warn('⚠️ Map ready timeout, proceeding anyway');
                    this.mapUpdateResolver();
                    this.mapUpdateResolver = null;
                }
            }, 1000);
        });
    }

    async initializePopupMaps() {
        if (!this.mapPopup) return;
        
        // Set up message listener for popup coordinates
        this.setupPopupMessageListener();
        
        return new Promise((resolve) => {
            // Listen for popup ready message
            const readyListener = (event) => {
                if (event.data && event.data.type === 'popupReady') {
                    console.log('✅ Popup is ready, sending route data...');
                    window.removeEventListener('message', readyListener);
                    
                    // Send current route data to popup if we have it
                    if (this.images.length > 0) {
                        this.updateMapsWithRoute();
                    }
                    
                    resolve();
                }
            };
            
            window.addEventListener('message', readyListener);
            
            // Timeout fallback in case message is missed
            setTimeout(() => {
                window.removeEventListener('message', readyListener);
                console.log('Timeout fallback - trying to manually trigger popup');
                
                // Try to manually trigger coordinate sending
                try {
                    if (this.mapPopup && !this.mapPopup.closed) {
                        console.log('Popup exists, trying to send coordinates manually...');
                        if (typeof this.mapPopup.sendMapCoordinates === 'function') {
                            this.mapPopup.sendMapCoordinates();
                            console.log('✅ Manually triggered coordinate sending');
                        } else {
                            console.warn('sendMapCoordinates function not available on popup');
                        }
                    } else {
                        console.warn('Popup window not available or closed');
                    }
                } catch (e) {
                    console.warn('Manual coordinate sending failed:', e);
                }
                
                if (this.images.length > 0) {
                    this.updateMapsWithRoute();
                }
                resolve();
            }, 2000);
            
            // Handle popup being closed - store interval reference for cleanup
            this.popupCheckInterval = setInterval(() => {
                if (this.mapPopup.closed) {
                    clearInterval(this.popupCheckInterval);
                    this.popupCheckInterval = null;
                    this.cleanupPopup();
                }
            }, 1000);
        });
    }
    
    setupPopupMessageListener() {
        // Listen for messages from popup window
        this.popupMessageListener = (event) => {
            console.log('🔍 All messages received:', {
                data: event.data,
                origin: event.origin,
                type: event.data?.type,
                fullData: JSON.stringify(event.data)
            });
            
            if (event.data && event.data.type === 'mapCoordinates') {
                this.mapCoordinates = event.data.coordinates;
                console.log('✅ Successfully received map coordinates from popup:', this.mapCoordinates);
                
                // Store globally for debugging
                window.debugMapCoordinates = this.mapCoordinates;
            }
            
            if (event.data && event.data.type === 'mapReady') {
                console.log('🎯 Maps are ready for screenshot after:', event.data.updateType);
                
                // Resolve pending map update if we're waiting for it
                if (this.mapUpdateResolver) {
                    this.mapUpdateResolver();
                    this.mapUpdateResolver = null;
                }
            }
        };
        
        window.addEventListener('message', this.popupMessageListener);
        console.log('🎯 Message listener set up, waiting for popup coordinates...');
    }
    
    cleanupPopup() {
        // Clear popup check interval
        if (this.popupCheckInterval) {
            clearInterval(this.popupCheckInterval);
            this.popupCheckInterval = null;
        }
        
        // Remove message listener
        if (this.popupMessageListener) {
            window.removeEventListener('message', this.popupMessageListener);
            this.popupMessageListener = null;
        }
        
        // Clear map update resolver
        if (this.mapUpdateResolver) {
            this.mapUpdateResolver();
            this.mapUpdateResolver = null;
        }
        
        // Clear references
        this.mapPopup = null;
        this.mapCoordinates = null;
        window.mapCapturePopup = null;
        
        console.log('Popup cleanup completed');
    }

    async captureMapToCanvas() {
        if (!this.routeMapCanvas || !this.detailMapCanvas || !this.mapPopup) return;
        
        try {
            // Capture individual map areas using precise coordinates
            const routeCanvas = await this.captureSpecificMapArea('routeMap');
            const detailCanvas = await this.captureSpecificMapArea('detailMap');
            
            console.log('Captured canvases:', { 
                routeCanvas: !!routeCanvas, 
                detailCanvas: !!detailCanvas,
                routeSize: routeCanvas ? `${routeCanvas.width}x${routeCanvas.height}` : 'null',
                detailSize: detailCanvas ? `${detailCanvas.width}x${detailCanvas.height}` : 'null'
            });
            
            if (routeCanvas && detailCanvas) {
                const routeCtx = this.routeMapCanvas.getContext('2d');
                const detailCtx = this.detailMapCanvas.getContext('2d');
                
                routeCtx.clearRect(0, 0, 600, 400);
                detailCtx.clearRect(0, 0, 600, 400);
                
                // Draw captured maps to target canvases (1:1 scale, no stretching)
                routeCtx.drawImage(routeCanvas, 0, 0);
                detailCtx.drawImage(detailCanvas, 0, 0);
            }
            
        } catch (error) {
            console.error('Error capturing maps from popup:', error);
            // Fallback placeholders
            const routeCtx = this.routeMapCanvas.getContext('2d');
            const detailCtx = this.detailMapCanvas.getContext('2d');
            
            routeCtx.fillStyle = '#e5e3df';
            routeCtx.fillRect(0, 0, 600, 400);
            detailCtx.fillStyle = '#e5e3df'; 
            detailCtx.fillRect(0, 0, 600, 400);
        }
    }
    
    async captureSpecificMapArea(mapType) {
        console.log(`🎬 Attempting to capture ${mapType}:`, {
            captureVideo: !!this.captureVideo,
            mapCoordinates: !!this.mapCoordinates,
            mapCoords: this.mapCoordinates?.[mapType]
        });
        
        if (!this.captureVideo || !this.mapCoordinates) {
            console.warn(`❌ Cannot capture ${mapType}: captureVideo=${!!this.captureVideo}, mapCoordinates=${!!this.mapCoordinates}`);
            return null;
        }
        
        try {
            // Get platform info for debugging
            const platform = this.getPlatformInfo();
            
            // Get device pixel ratio (varies by platform and display)
            const pixelRatio = this.getEffectivePixelRatio();
            
            // Get popup window decoration offsets (platform-specific)
            const popupOuterWidth = this.mapPopup.outerWidth;
            const popupInnerWidth = this.mapPopup.innerWidth;
            const popupOuterHeight = this.mapPopup.outerHeight;
            const popupInnerHeight = this.mapPopup.innerHeight;
            
            // Calculate decoration sizes
            const decorationLeft = Math.round((popupOuterWidth - popupInnerWidth) / 2);
            const decorationTop = popupOuterHeight - popupInnerHeight;
            
            // Get specific map coordinates (these are in CSS pixels)
            const mapCoords = this.mapCoordinates[mapType];
            if (!mapCoords) return null;
            
            console.log(`🖥️  Platform: ${platform.name} (${platform.os})`);
            console.log(`📐 Device pixel ratio: ${pixelRatio}`);
            console.log(`🏠 Window decorations - Left: ${decorationLeft}px, Top: ${decorationTop}px`);
            console.log(`📍 ${mapType} CSS coords:`, mapCoords);
            
            const canvas = document.createElement('canvas');
            canvas.width = mapCoords.width;
            canvas.height = mapCoords.height;
            const ctx = canvas.getContext('2d');
            
            // Try different decoration calculations
            const halfDecorationTop = Math.round(decorationTop / 2);
            
            // Use exact coordinates provided by popup instead of adding arbitrary buffers
            const sourceX = Math.round(mapCoords.left * pixelRatio);
            const sourceY = Math.round((halfDecorationTop + mapCoords.top) * pixelRatio);
            const sourceWidth = Math.round(mapCoords.width * pixelRatio);
            const sourceHeight = Math.round(mapCoords.height * pixelRatio);
            
            // Alternative coordinates for comparison
            const sourceXWithLeftDecoration = Math.round((decorationLeft + mapCoords.left) * pixelRatio);
            const sourceYNoDecoration = Math.round(mapCoords.top * pixelRatio);
            const sourceYFullDecoration = Math.round((decorationTop + mapCoords.top) * pixelRatio);
            
            console.log(`🎯 ${mapType} coordinates comparison:`, { 
                current: { sourceX, sourceY, sourceWidth, sourceHeight },
                alternatives: { 
                    xWithLeftDecoration: sourceXWithLeftDecoration,
                    yNoDecoration: sourceYNoDecoration,
                    yHalfDecoration: (halfDecorationTop + mapCoords.top) * pixelRatio,
                    yFullDecoration: sourceYFullDecoration 
                },
                decorationOffsets: { left: decorationLeft, top: decorationTop, half: halfDecorationTop },
                pixelRatio,
                platform: platform.name
            });
            
            // Capture specific map area from screen capture using device pixels
            ctx.drawImage(
                this.captureVideo,
                sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle in device pixels
                0, 0, canvas.width, canvas.height              // Destination rectangle
            );
            
            return canvas;
        } catch (error) {
            console.warn(`Failed to capture ${mapType}:`, error);
            return null;
        }
    }
    
    getPlatformInfo() {
        const userAgent = navigator.userAgent.toLowerCase();
        
        if (userAgent.includes('mac')) {
            return { name: 'Mac', os: 'macOS' };
        } else if (userAgent.includes('win')) {
            return { name: 'Windows', os: 'Windows' };
        } else if (userAgent.includes('linux')) {
            return { name: 'Linux', os: 'Linux' };
        } else {
            return { name: 'Unknown', os: userAgent };
        }
    }
    
    getEffectivePixelRatio() {
        // Get base device pixel ratio
        const devicePixelRatio = window.devicePixelRatio || 1;
        
        // Platform-specific handling
        const platform = this.getPlatformInfo();
        
        if (platform.name === 'Windows') {
            // Windows can have fractional scaling (1.25, 1.5, etc.)
            // Screen capture might behave differently
            console.log(`Windows detected, devicePixelRatio: ${devicePixelRatio}`);
            return devicePixelRatio;
        } else if (platform.name === 'Mac') {
            // Mac typically has clean 1x or 2x scaling
            console.log(`Mac detected, devicePixelRatio: ${devicePixelRatio}`);
            return devicePixelRatio;
        } else if (platform.name === 'Linux') {
            // Linux can vary widely depending on desktop environment
            console.log(`Linux detected, devicePixelRatio: ${devicePixelRatio}`);
            return devicePixelRatio;
        }
        
        return devicePixelRatio;
    }

    // Maps are now in iframe, so updates happen automatically via existing methods

    async initializeScreenCapture() {
        if (this.captureStream) return; // Already initialized
        
        try {
            console.log('Requesting screen capture permission...');
            this.captureStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    mediaSource: 'window'
                }
            });

            // Create video element for capturing frames
            this.captureVideo = document.createElement('video');
            this.captureVideo.srcObject = this.captureStream;
            this.captureVideo.play();
            
            // Wait for video to be ready
            await new Promise((resolve) => {
                this.captureVideo.addEventListener('loadedmetadata', resolve);
            });
            
            console.log('Screen capture initialized');
        } catch (error) {
            console.warn('Screen capture initialization failed:', error);
            this.captureStream = null;
            this.captureVideo = null;
        }
    }

    async captureIframeToCanvas() {
        // Initialize screen capture if not already done
        if (!this.captureStream) {
            await this.initializeScreenCapture();
        }
        
        if (!this.captureVideo || !this.mapPopup) {
            // Fallback: create placeholder canvas
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 500;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#e5e3df';
            ctx.fillRect(0, 0, 800, 500);
            ctx.fillStyle = '#666';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Maps (Screen Capture Required)', 400, 250);
            return canvas;
        }

        try {
            // Get popup window position and size
            const popupX = this.mapPopup.screenX || this.mapPopup.screenLeft || 0;
            const popupY = this.mapPopup.screenY || this.mapPopup.screenTop || 0;
            
            // Get the content area dimensions (excluding OS decorations)
            const popupInnerWidth = this.mapPopup.innerWidth;
            const popupInnerHeight = this.mapPopup.innerHeight;
            const popupOuterWidth = this.mapPopup.outerWidth;
            const popupOuterHeight = this.mapPopup.outerHeight;
            
            // Calculate OS decoration offsets
            const decorationLeft = 0; // Usually no left decoration
            const decorationTop = popupOuterHeight - popupInnerHeight; // Title bar height
            
            console.log('Popup dimensions:', {
                position: [popupX, popupY],
                inner: [popupInnerWidth, popupInnerHeight],
                outer: [popupOuterWidth, popupOuterHeight],
                decorations: [decorationLeft, decorationTop]
            });
            
            // Get the map container bounds within the popup
            let mapContainerBounds = null;
            try {
                const mapContainer = this.mapPopup.document.querySelector('.map-previews');
                if (mapContainer) {
                    mapContainerBounds = mapContainer.getBoundingClientRect();
                    console.log('Map container bounds:', mapContainerBounds);
                }
            } catch (e) {
                console.warn('Could not get map container bounds:', e);
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 500;
            const ctx = canvas.getContext('2d');
            
            // Calculate the source rectangle to crop from the screen capture
            let sourceX = decorationLeft;
            let sourceY = decorationTop;
            let sourceWidth = popupInnerWidth;
            let sourceHeight = popupInnerHeight;
            
            // If we have map container bounds, crop to just the maps area
            if (mapContainerBounds) {
                sourceX += mapContainerBounds.left;
                sourceY += mapContainerBounds.top;
                sourceWidth = mapContainerBounds.width;
                sourceHeight = mapContainerBounds.height;
            }
            
            console.log('Cropping source:', { sourceX, sourceY, sourceWidth, sourceHeight });
            
            // Capture and crop the video frame
            ctx.drawImage(
                this.captureVideo, 
                sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle (what to crop)
                0, 0, canvas.width, canvas.height              // Destination rectangle (scale to fit)
            );
            
            return canvas;
        } catch (error) {
            console.warn('Frame capture failed:', error);
            // Return fallback canvas
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 500;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#e5e3df';
            ctx.fillRect(0, 0, 800, 500);
            return canvas;
        }
    }

    stopScreenCapture() {
        if (this.captureStream) {
            this.captureStream.getTracks().forEach(track => {
                track.stop();
                console.log(`Stopped track: ${track.kind}, state: ${track.readyState}`);
            });
            this.captureStream = null;
        }
        
        if (this.captureVideo) {
            this.captureVideo.srcObject = null;
            this.captureVideo.pause();
            this.captureVideo.removeAttribute('src');
            this.captureVideo.load();
            this.captureVideo = null;
        }
        
        console.log('Screen capture stopped and cleaned up');
    }

    drawAltitudeChart(pos, width, height, currentIndex) {
        if (!this.images.length || this.altitudeRange.max === 0) return;
        
        // Better margins for the wider, shorter rectangle
        const chartWidth = width - 80;
        const chartHeight = height - 50;
        const chartX = pos.x + 60; // More left margin for labels
        const chartY = pos.y + 30;
        
        const altRange = this.altitudeRange.max - this.altitudeRange.min || 1;
        const currentAlt = this.images[currentIndex]?.alt || 0;
        
        // Draw altitude bar graph for entire dataset
        this.ctx.fillStyle = 'rgba(52, 152, 219, 0.3)';
        const barWidth = Math.max(1, chartWidth / this.images.length);
        
        for (let i = 0; i < this.images.length; i++) {
            const alt = this.images[i]?.alt || 0;
            if (alt === 0) continue;
            
            const normalizedHeight = ((alt - this.altitudeRange.min) / altRange) * chartHeight;
            const barHeight = Math.max(1, normalizedHeight);
            const x = chartX + (i / this.images.length) * chartWidth;
            const y = chartY + chartHeight - barHeight;
            
            this.ctx.fillRect(x, y, barWidth, barHeight);
        }
        
        // Draw bike marker at current position
        if (currentAlt > 0) {
            const markerX = chartX + (currentIndex / this.images.length) * chartWidth;
            const markerHeight = ((currentAlt - this.altitudeRange.min) / altRange) * chartHeight;
            const markerY = chartY + chartHeight - markerHeight;
            
            // Draw bike icon at the top of the current bar
            this.drawBikeIconAtPosition(markerX, markerY - 25);
        }
        
        // Labels with larger font
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `${Math.floor(this.canvas.width / 120)}px Arial`; // Larger font for labels
        
        // Max altitude (top)
        this.ctx.fillText(`${this.altitudeRange.max.toFixed(0)}m`, pos.x + 10, pos.y + 25);
        
        // Min altitude (bottom)  
        this.ctx.fillText(`${this.altitudeRange.min.toFixed(0)}m`, pos.x + 10, pos.y + height - 5);
    }

    drawBikeIcon(x, y) {
        this.ctx.fillStyle = '#f39c12';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 8, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('🚴', x, y + 4);
        this.ctx.textAlign = 'left';
    }

    drawBikeIconAtPosition(x, y) {
        if (!this.bikeIcon) return;
        
        // Scale the icon size based on canvas resolution
        const iconSize = Math.floor(this.canvas.width / 35); // Much larger size
        
        // Draw glowing green outline
        this.ctx.shadowColor = '#00ff00';
        this.ctx.shadowBlur = 8;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 0;
        
        // Draw the bike icon centered at position
        this.ctx.drawImage(
            this.bikeIcon, 
            x - iconSize/2, 
            y - iconSize/2, 
            iconSize, 
            iconSize
        );
        
        // Reset shadow
        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;
    }

    async uploadImage(blob, timestamp) {
        try {
            const response = await fetch(`/api/upload/${this.currentSession}/${timestamp}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'image/jpeg'
                },
                body: blob
            });
            
            if (!response.ok) {
                throw new Error('Upload failed');
            }
        } catch (error) {
            console.error('Upload error:', error);
        }
    }

    updateProgress(current, total) {
        const percentage = (current / total) * 100;
        document.getElementById('progressFill').style.width = `${percentage}%`;
        document.getElementById('progressText').textContent = `${current} / ${total}`;
    }

    finishProcessing() {
        this.isProcessing = false;
        document.getElementById('startBtn').style.display = 'inline-block';
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('startBtn').textContent = 'Processing Complete';
        document.getElementById('startBtn').disabled = true;
        
        // Clean up screen capture
        this.stopScreenCapture();
        
        console.log('Processing complete!');
    }

    // Cache Management Methods
    async loadCacheStats() {
        try {
            const response = await fetch('/api/cache/stats');
            const stats = await response.json();
            
            const cacheStatsDiv = document.getElementById('cacheStats');
            if (stats.error) {
                cacheStatsDiv.innerHTML = `<p style="color: red;">Error: ${stats.error}</p>`;
            } else {
                let html = `
                    <p><strong>Total Tiles:</strong> ${stats.totalTiles.toLocaleString()}</p>
                    <p><strong>Total Size:</strong> ${stats.totalSizeHuman}</p>
                    <p><strong>Zoom Levels:</strong></p>
                `;
                
                const sortedZooms = Object.keys(stats.zoomLevels).sort((a, b) => parseInt(a) - parseInt(b));
                for (const zoom of sortedZooms) {
                    const level = stats.zoomLevels[zoom];
                    html += `<p>&nbsp;&nbsp;Zoom ${zoom}: ${level.tiles} tiles (${level.sizeHuman})</p>`;
                }
                
                if (sortedZooms.length === 0) {
                    html += '<p>No cached tiles found.</p>';
                }
                
                cacheStatsDiv.innerHTML = html;
            }
        } catch (error) {
            console.error('Failed to load cache stats:', error);
            document.getElementById('cacheStats').innerHTML = `<p style="color: red;">Failed to load cache stats</p>`;
        }
    }

    async clearCache() {
        if (!confirm('Are you sure you want to clear all cached tiles? This cannot be undone.')) {
            return;
        }
        
        try {
            const response = await fetch('/api/cache', { method: 'DELETE' });
            const result = await response.json();
            
            if (result.success) {
                alert('Cache cleared successfully!');
                await this.loadCacheStats();
            } else {
                alert(`Failed to clear cache: ${result.error}`);
            }
        } catch (error) {
            console.error('Failed to clear cache:', error);
            alert('Failed to clear cache');
        }
    }

    async preloadCurrentRoute() {
        if (!this.images.length) {
            alert('Please load a session first');
            return;
        }
        
        // Calculate bounds from current route
        const gpsImages = this.images.filter(img => img.lat && img.lon);
        if (gpsImages.length === 0) {
            alert('No GPS data found in current session');
            return;
        }
        
        const lats = gpsImages.map(img => img.lat);
        const lons = gpsImages.map(img => img.lon);
        
        const bounds = {
            north: Math.max(...lats),
            south: Math.min(...lats),
            east: Math.max(...lons),
            west: Math.min(...lons)
        };
        
        // Add some padding to bounds
        const latPadding = (bounds.north - bounds.south) * 0.1;
        const lonPadding = (bounds.east - bounds.west) * 0.1;
        
        bounds.north += latPadding;
        bounds.south -= latPadding;
        bounds.east += lonPadding;
        bounds.west -= lonPadding;
        
        try {
            const response = await fetch('/api/cache/preload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    bounds,
                    minZoom: 10,
                    maxZoom: 16
                })
            });
            
            const result = await response.json();
            alert(`Preload started! Check the console for progress. ${result.message}`);
            
            // Refresh stats after a delay to show progress
            setTimeout(() => this.loadCacheStats(), 2000);
        } catch (error) {
            console.error('Failed to start preload:', error);
            alert('Failed to start preload');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BikeTrailProcessor();
});