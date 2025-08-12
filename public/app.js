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
        this.lastValidBearing = 90; // Default to east
        this.detailMap = null;
        this.routeMapCanvas = null;
        this.detailMapCanvas = null;
        this.altitudeUnit = localStorage.getItem('altitudeUnit') || 'ft'; // Load from localStorage or default to feet
        this.frameInterval = parseInt(localStorage.getItem('frameInterval') || '1'); // Load from localStorage or default to every frame
        
        // Worker readiness state
        this.workerDetectionReady = false;
        
        // Initialize web worker
        this.initializeWorker();
        
        this.init();
    }

    initializeWorker() {
        try {
            // Create web worker
            this.worker = new Worker('worker.js');
            
            // Create Rawr RPC peer to communicate with worker
            this.workerRpc = window.Rawr({
                transport: window.Rawr.transports.worker(this.worker),
                
                // Methods that worker can call back to main thread
                methods: {
                    // Worker readiness notifications
                    onWorkerReady: (notification) => {
                        
                        if (notification.type === 'detection-ready') {
                            this.workerDetectionReady = true;
                            
                            // Update UI to show detection is available
                            this.updateDetectionStatus('ready');
                            
                        } else if (notification.type === 'detection-error') {
                            this.workerDetectionReady = false;
                            console.warn('❌ Worker detection failed:', notification.error);
                            
                            // Update UI to show detection error
                            this.updateDetectionStatus('error', notification.error);
                            
                        } else if (notification.type === 'detection-unavailable') {
                            this.workerDetectionReady = false;
                            
                            // Update UI to show detection is disabled
                            this.updateDetectionStatus('disabled', 'MediaPipe not available in worker');
                        }
                        
                        return { received: true, timestamp: Date.now() };
                    },
                    
                    // Progress updates from worker
                    updateProgress: (progress) => {
                        return { received: true };
                    },
                    
                    logMessage: (message) => {
                        return { logged: true };
                    }
                }
            });
            
            // Set up worker error handler
            this.worker.addEventListener('error', (error) => {
                console.error('Worker error:', error);
            });
            
            // Initialize worker with Rawr RPC
            this.initializeWorkerRpc();
                
        } catch (error) {
            console.error('Failed to create worker:', error);
            this.worker = null;
            this.workerRpc = null;
        }
    }

    async initializeWorkerRpc() {
        try {
            // Test RPC connection and initialize worker
            const result = await this.workerRpc.methods.init();
            // Worker RPC initialized successfully
            
        } catch (error) {
            console.error('Worker RPC initialization failed:', error);
        }
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
        this.initializeAltitudeUnit();
        await this.loadCacheStats();
    }
    
    setupUnloadCleanup() {
        window.addEventListener('beforeunload', () => {
            this.stopScreenCapture();
            this.cleanupPopup();
            this.cleanupCanvas();
            this.cleanupWorker();
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

    cleanupWorker() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        
        if (this.workerRpc) {
            this.workerRpc = null;
        }
    }
    
    cleanupExistingPopups() {
        try {
            // Try to find and close any existing mapCapture popups
            if (window.mapCapturePopup && !window.mapCapturePopup.closed) {
                window.mapCapturePopup.close();
            }
            
            // Also check our instance variable
            if (this.mapPopup && !this.mapPopup.closed) {
                this.mapPopup.close();
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
            this.bikeIcon.src = '/images/luis_bike_100_east.png';
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
        document.getElementById('altitudeUnit').addEventListener('change', (e) => {
            this.altitudeUnit = e.target.value;
            localStorage.setItem('altitudeUnit', this.altitudeUnit);
        });
        document.getElementById('frameInterval').addEventListener('change', (e) => {
            this.frameInterval = parseInt(e.target.value);
            localStorage.setItem('frameInterval', this.frameInterval.toString());
            // Update the process count display when interval changes
            this.updateProcessCount();
        });
        
        // Cache management event listeners
        document.getElementById('refreshCacheBtn').addEventListener('click', () => this.loadCacheStats());
        document.getElementById('clearCacheBtn').addEventListener('click', () => this.clearCache());
        document.getElementById('preloadBtn').addEventListener('click', () => this.preloadCurrentRoute());
    }
    
    initializeAltitudeUnit() {
        // Set the dropdown to the loaded/default value
        const altitudeUnitSelect = document.getElementById('altitudeUnit');
        if (altitudeUnitSelect) {
            altitudeUnitSelect.value = this.altitudeUnit;
        }
        
        // Set the frame interval dropdown to the loaded/default value
        const frameIntervalSelect = document.getElementById('frameInterval');
        if (frameIntervalSelect) {
            frameIntervalSelect.value = this.frameInterval.toString();
        }
    }
    
    updateProcessCount() {
        if (this.images && this.images.length > 0) {
            const totalToProcess = Math.ceil(this.images.length / this.frameInterval);
            document.getElementById('processCount').textContent = totalToProcess;
        }
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
            
            // Calculate altitude range for the entire dataset
            this.calculateAltitudeRange();
            
            // Initialize popup maps after data is loaded
            await this.initializePopupMaps();
            
            document.getElementById('imageCount').textContent = data.count;
            this.updateProcessCount();
            document.getElementById('sessionInfo').style.display = 'block';
            
            
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
            this.stopScreenCapture();
        }
    }

    async processImages() {
        // Calculate total frames to be processed with the current interval
        const totalFramesToProcess = Math.ceil(this.images.length / this.frameInterval);
        let processedFrames = 0;
        
        for (let i = this.currentIndex; i < this.images.length; i += this.frameInterval) {
            if (!this.isProcessing) break;
            
            while (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            this.currentIndex = i;
            const image = this.images[i];
            
            await this.processImage(image, i);
            processedFrames++;
            this.updateProgress(processedFrames, totalFramesToProcess);
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
            
            // Detect people and faces using worker for privacy blurring
            const detectionResult = await this.detectPeopleAndFaces(img, imageData.timestamp);
            
            // Apply privacy blurring to detected people and faces
            if (detectionResult && !detectionResult.fallback) {
                this.applyPrivacyBlurring(detectionResult, img);
            }
            
            // Draw date/time in upper left corner
            this.drawDateTime(imageData.timestamp);
            
            // Draw speed in bottom right corner
            this.drawSpeed(imageData.speed);
            
            // Update detail map position (maps are now in popup)
            this.updateDetailMapPosition(imageData);
            
            
            // Capture iframe maps to hidden canvases
            await this.captureMapToCanvas();
            
            await this.addOverlays(imageData, index);
            
            // Save all processed images
            const blob = await new Promise(resolve => {
                this.canvas.toBlob(resolve, 'image/jpeg', 0.9);
            });
            
            this.uploadImage(blob, imageData.timestamp).catch(error => {
                console.error('Upload failed for timestamp', imageData.timestamp, error);
            });
            
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
        
        // Define altitude meter dimensions: taller height, 3x width
        const altitudeWidth = overlaySize * 3;
        const altitudeHeight = overlaySize * 0.75;
        
        // Map dimensions to match captured map size (600x400 -> scale to fit overlay size)
        const mapWidth = overlaySize * 2;
        const mapHeight = Math.floor(mapWidth * 400/600); // Exact 600:400 aspect ratio
        
        // Account for 125% scaling - maps will be 25% larger
        // Maps are now 900x600, so position them accordingly
        const actualMapWidth = 900;
        const actualMapHeight = 600;
        
        const upperLeft = { x: margin - 30, y: margin - 24 };
        const topRight = { x: this.canvas.width - altitudeWidth - margin, y: margin, width: altitudeWidth, height: altitudeHeight };
        
        // Skip black rectangle backgrounds - just draw altitude meter background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        this.ctx.fillRect(topRight.x, topRight.y, altitudeWidth, altitudeHeight);
        this.ctx.strokeRect(topRight.x, topRight.y, altitudeWidth, altitudeHeight);
        
        // Draw detail map in upper left corner
        await this.drawDetailView(upperLeft, mapWidth, mapHeight, imageData);
        this.drawAltitudeChart(topRight, altitudeWidth, altitudeHeight, index);
        
        // Luis bike icons are already rendered inside the captured maps
    }


    async drawDetailView(pos, width, height, imageData) {
        if (!this.detailMapCanvas) return;
        
        // Stretch the 450x300 crop to 900x600 on the big canvas
        const scaledWidth = 900;
        const scaledHeight = 600;
        
        // Create an off-screen canvas to apply the fade effect
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = scaledWidth;
        tempCanvas.height = scaledHeight;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Apply rounded corner clipping to temp canvas first
        const radius = 50;
        this.createRoundedRectPathOnContext(tempCtx, 0, 0, scaledWidth, scaledHeight, radius);
        tempCtx.clip();
        
        // Draw the map to the temp canvas, stretching from 450x300 to scaledWidth x scaledHeight
        tempCtx.drawImage(
            this.detailMapCanvas,       // source canvas (450x300)
            0, 0, 450, 300,            // source rectangle (full 450x300)
            0, 0, scaledWidth, scaledHeight  // destination rectangle (stretch to 900x600)
        );
        
        // Apply fade effect to the temp canvas
        this.applyFadeToCanvas(tempCtx, scaledWidth, scaledHeight);
        
        // Draw the faded map to the main canvas (already rounded and faded)
        this.ctx.drawImage(tempCanvas, pos.x, pos.y);
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
    
    createRoundedRectPathOnContext(ctx, x, y, width, height, radius) {
        // Create rounded rectangle path on any canvas context
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(x, y, width, height, radius);
        } else {
            // Manual rounded rectangle path
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            
            // Top side and top-right corner
            ctx.lineTo(x + width - radius, y);
            ctx.arcTo(x + width, y, x + width, y + radius, radius);
            
            // Right side and bottom-right corner
            ctx.lineTo(x + width, y + height - radius);
            ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
            
            // Bottom side and bottom-left corner
            ctx.lineTo(x + radius, y + height);
            ctx.arcTo(x, y + height, x, y + height - radius, radius);
            
            // Left side and top-left corner
            ctx.lineTo(x, y + radius);
            ctx.arcTo(x, y, x + radius, y, radius);
            
            ctx.closePath();
        }
    }
    
    applyFadeToCanvas(ctx, width, height) {
        // Apply transparency gradient to an isolated canvas
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        
        const fadeWidth = width * 0.07; // Fade zone width
        const fadeHeight = height * 0.07; // Fade zone height
        
        // Left edge fade
        const leftGradient = ctx.createLinearGradient(0, 0, fadeWidth, 0);
        leftGradient.addColorStop(0, 'rgba(0, 0, 0, 1)'); // Remove at edge
        leftGradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Keep at center
        ctx.fillStyle = leftGradient;
        ctx.fillRect(0, 0, fadeWidth, height);
        
        // Right edge fade
        const rightGradient = ctx.createLinearGradient(width - fadeWidth, 0, width, 0);
        rightGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        rightGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.fillStyle = rightGradient;
        ctx.fillRect(width - fadeWidth, 0, fadeWidth, height);
        
        // Top edge fade
        const topGradient = ctx.createLinearGradient(0, 0, 0, fadeHeight);
        topGradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        topGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = topGradient;
        ctx.fillRect(0, 0, width, fadeHeight);
        
        // Bottom edge fade
        const bottomGradient = ctx.createLinearGradient(0, height - fadeHeight, 0, height);
        bottomGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        bottomGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.fillStyle = bottomGradient;
        ctx.fillRect(0, height - fadeHeight, width, fadeHeight);
        
        ctx.restore();
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
                        ctx.drawImage(this.bikeIcon, markerX - iconSize/2, markerY - iconSize, iconSize, iconSize);
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
        
    }

    updateMapsWithRoute() {
        if (!this.images.length || !this.mapPopup) return;

        // Filter images with valid GPS data
        const gpsImages = this.images.filter(img => img.lat && img.lon);
        if (gpsImages.length === 0) return;

        const routeCoords = gpsImages.map(img => [img.lat, img.lon]);
        
        
        // Send route data to popup via postMessage
        this.mapPopup.postMessage({
            type: 'updateRoute',
            routeCoords: routeCoords
        }, '*');
        
        // Set detail map to first GPS point with bearing
        const firstPoint = gpsImages[0];
        
        // Calculate bearing for first point
        let bearing = 90; // Default to east
        if (firstPoint.compass !== null && firstPoint.compass !== undefined) {
            let rawBearing = firstPoint.compass;
            bearing = (rawBearing + 180) % 360;
        }
        
        
        this.mapPopup.postMessage({
            type: 'updateDetailPosition',
            lat: firstPoint.lat,
            lon: firstPoint.lon,
            bearing: bearing,
            rawCompass: firstPoint.compass
        }, '*');
    }

    updateDetailMapPosition(currentImage) {
        if (!currentImage || !currentImage.lat || !currentImage.lon || !this.mapPopup) return;
        
        
        const currentIndex = this.images.indexOf(currentImage);
        let bearing = 90; // Default east
        
        if (currentIndex === 0) {
            // First frame: use its bearing
            
            if (currentImage.compass !== null && currentImage.compass !== undefined) {
                bearing = currentImage.compass;
            } else {
                bearing = 90; // fallback
            }
        } else {
            // Subsequent frames: check velocity and find next GPS-significant frame
            const speedMPS = currentImage.speed || 0;
            const MIN_SPEED_MPS = 1.39; // 5 km/h = 1.39 m/s
            const MIN_TIME_DIFF_MS = 100; // 100ms minimum between GPS points
            
            if (speedMPS > MIN_SPEED_MPS) {
                // Jump ahead ~45 frames (assuming 30fps, ~1.5 seconds)
                const targetIndex = currentIndex + 45;
                const nextImage = this.images[targetIndex];
                
                if (nextImage && nextImage.lat && nextImage.lon) {
                    bearing = this.calculateBearing(currentImage.lat, currentImage.lon, nextImage.lat, nextImage.lon);
                } else {
                    bearing = this.lastValidBearing || 90;
                }
            } else {
                bearing = this.lastValidBearing || 90;
            }
        }
        
        this.lastValidBearing = bearing;
        
        
        // Send position update to popup
        this.mapPopup.postMessage({
            type: 'updateDetailPosition',
            lat: currentImage.lat,
            lon: currentImage.lon,
            bearing: bearing,
            rawCompass: currentIndex === 0 ? currentImage.compass || null : null
        }, '*');
        
        // Also update route marker position
        this.mapPopup.postMessage({
            type: 'updateRouteMarker', 
            lat: currentImage.lat,
            lon: currentImage.lon,
            bearing: bearing,
            rawCompass: currentIndex === 0 ? currentImage.compass || null : null
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
        return (bearing + 360) % 360;
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
                
                // Try to manually trigger coordinate sending
                try {
                    if (this.mapPopup && !this.mapPopup.closed) {
                        if (typeof this.mapPopup.sendMapCoordinates === 'function') {
                            this.mapPopup.sendMapCoordinates();
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
            
            if (event.data && event.data.type === 'mapCoordinates') {
                this.mapCoordinates = event.data.coordinates;
                
                // Store globally for debugging
                window.debugMapCoordinates = this.mapCoordinates;
            }
            
            if (event.data && event.data.type === 'mapReady') {
                
                // Resolve pending map update if we're waiting for it
                if (this.mapUpdateResolver) {
                    this.mapUpdateResolver();
                    this.mapUpdateResolver = null;
                }
            }
        };
        
        window.addEventListener('message', this.popupMessageListener);
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
        
    }

    async captureMapToCanvas() {
        if (!this.routeMapCanvas || !this.detailMapCanvas || !this.mapPopup) return;
        
        try {
            // Capture individual map areas using precise coordinates
            const routeCanvas = await this.captureSpecificMapArea('routeMap');
            const detailCanvas = await this.captureSpecificMapArea('detailMap');
            
            
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
            
            
            // Create smaller canvas for center crop - maintain 1.5:1 aspect ratio like original
            const cropWidth = 450;
            const cropHeight = 300;
            const canvas = document.createElement('canvas');
            canvas.width = cropWidth;
            canvas.height = cropHeight;
            const ctx = canvas.getContext('2d');
            
            // Try different decoration calculations
            const halfDecorationTop = Math.round(decorationTop / 2);
            
            // Calculate center crop area - crop from center of the map element
            const centerOffsetX = (mapCoords.width - cropWidth) / 2;
            const centerOffsetY = (mapCoords.height - cropHeight) / 2;
            
            const sourceX = Math.round((decorationLeft + mapCoords.left + centerOffsetX) * pixelRatio);
            const sourceY = Math.round((halfDecorationTop + mapCoords.top + centerOffsetY) * pixelRatio);
            const sourceWidth = Math.round(cropWidth * pixelRatio);
            const sourceHeight = Math.round(cropHeight * pixelRatio);
            
            // Alternative coordinates for comparison
            const sourceXWithLeftDecoration = Math.round((decorationLeft + mapCoords.left) * pixelRatio);
            const sourceYNoDecoration = Math.round(mapCoords.top * pixelRatio);
            const sourceYFullDecoration = Math.round((decorationTop + mapCoords.top) * pixelRatio);
            
            
            // Capture center crop area from screen capture using device pixels
            ctx.drawImage(
                this.captureVideo,
                sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle (center crop)
                0, 0, cropWidth, cropHeight                    // Destination rectangle
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
            return devicePixelRatio;
        } else if (platform.name === 'Mac') {
            // Mac typically has clean 1x or 2x scaling
            return devicePixelRatio;
        } else if (platform.name === 'Linux') {
            // Linux can vary widely depending on desktop environment
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

    // Convert meters to feet
    metersToFeet(meters) {
        return Math.round(meters * 3.28084);
    }
    
    // Get altitude value in the selected unit
    getAltitudeInUnit(altitudeInMeters) {
        if (this.altitudeUnit === 'ft') {
            return this.metersToFeet(altitudeInMeters);
        }
        return Math.round(altitudeInMeters);
    }
    
    // Get the unit label
    getUnitLabel() {
        return this.altitudeUnit === 'ft' ? ' ft' : ' m';
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
        
        // Convert altitude range to selected unit for display
        const displayedAltRange = this.getAltitudeInUnit(this.altitudeRange.max) - this.getAltitudeInUnit(this.altitudeRange.min);
        
        // Draw altitude bar graph for ALL frames (smooth detailed chart)
        this.ctx.fillStyle = 'rgba(52, 152, 219, 0.3)';
        const barWidth = Math.max(1, chartWidth / this.images.length);
        
        for (let i = 0; i < this.images.length; i++) {
            const alt = this.images[i]?.alt || 0;
            if (alt === 0) continue;
            
            // Relative altitude: 0 = min altitude, max = total elevation gain
            const relativeAlt = alt - this.altitudeRange.min;
            const normalizedHeight = (relativeAlt / altRange) * chartHeight;
            const barHeight = Math.max(1, normalizedHeight);
            const x = chartX + (i / this.images.length) * chartWidth;
            const y = chartY + chartHeight - barHeight;
            
            this.ctx.fillRect(x, y, barWidth, barHeight);
        }
        
        // Draw bike marker at current position (accounts for frame interval)
        if (currentAlt > 0) {
            // Position bike marker based on actual currentIndex in the full dataset
            const markerX = chartX + (currentIndex / this.images.length) * chartWidth;
            const relativeCurrentAlt = currentAlt - this.altitudeRange.min;
            const markerHeight = (relativeCurrentAlt / altRange) * chartHeight;
            const markerY = chartY + chartHeight - markerHeight;
            
            // Draw bike icon just above the current bar (bike bottom at bar top)
            this.drawBikeIconAtPosition(markerX, markerY);
        }
        
        // Labels with larger font - show relative altitude in selected unit
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `${Math.floor(this.canvas.width / 80)}px Arial`; // Larger font for labels
        
        // Total elevation gain (top)
        this.ctx.fillText(`${displayedAltRange}${this.getUnitLabel()}`, pos.x + 15, pos.y + 40);
        
        // Base level (bottom)  
        this.ctx.fillText(`0`, pos.x + 15, pos.y + height - 20);
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
        
        // Draw the bike icon with bottom center at position
        this.ctx.drawImage(
            this.bikeIcon, 
            x - iconSize/2, 
            y - iconSize, 
            iconSize, 
            iconSize
        );
        
        // Reset shadow
        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;
    }

    drawDateTime(timestamp) {
        if (!timestamp) return;
        
        // Create date object from timestamp
        const date = new Date(timestamp);
        
        // Format: dd-MMM-yyyy hh:mm am/pm TZ
        const day = date.getDate().toString().padStart(2, '0');
        const month = date.toLocaleDateString('en-US', { month: 'short' });
        const year = date.getFullYear();
        
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'pm' : 'am';
        
        // Convert to 12-hour format
        if (hours === 0) hours = 12;
        else if (hours > 12) hours = hours - 12;
        
        const dateTimeString = `${day}-${month}-${year} ${hours}:${minutes} ${ampm}`;
        
        // Set up text styling
        const fontSize = Math.floor(this.canvas.width / 40); // Double the font size
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        
        // Position in bottom left corner with padding
        const x = 20;
        const y = this.canvas.height - 20;
        
        // Draw text with black outline for visibility
        this.ctx.strokeText(dateTimeString, x, y);
        this.ctx.fillText(dateTimeString, x, y);
    }

    drawSpeed(speedMPS) {
        if (!speedMPS && speedMPS !== 0) return;
        
        // Convert speed based on altitude unit preference
        let speed, units;
        if (this.altitudeUnit === 'ft') {
            // Convert m/s to mph: multiply by 2.237
            speed = speedMPS * 2.237;
            units = 'mph';
        } else {
            // Convert m/s to km/h: multiply by 3.6
            speed = speedMPS * 3.6;
            units = 'km/h';
        }
        
        // Format speed to 1 decimal place
        const speedString = `bike ${speed.toFixed(1)} ${units}`;
        
        // Set up text styling (same size as date/time)
        const fontSize = Math.floor(this.canvas.width / 40);
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        
        // Measure text width for right alignment
        const textMetrics = this.ctx.measureText(speedString);
        const textWidth = textMetrics.width;
        
        // Position in bottom right corner with padding
        const x = this.canvas.width - textWidth - 20;
        const y = this.canvas.height - 20;
        
        // Draw text with black outline for visibility
        this.ctx.strokeText(speedString, x, y);
        this.ctx.fillText(speedString, x, y);
    }

    applyPrivacyBlurring(detectionResult, img) {
        // Scale factors to convert from detection coordinates to main canvas
        const scaleX = this.canvas.width / img.width;
        const scaleY = this.canvas.height / img.height;
        
        // Log only when multiple people are detected
        if (detectionResult.people?.length > 1) {
            console.log(`🎯 Processing ${detectionResult.people.length} people for blurring`);
        }
        
        // Blur detected people
        detectionResult.people.forEach((person, index) => {
            if (person.boundingBox) {
                const x = person.boundingBox.x * scaleX;
                const y = person.boundingBox.y * scaleY;
                const width = person.boundingBox.width * scaleX;
                const height = person.boundingBox.height * scaleY;
                
                console.log(`🫥 Blurring person ${index}: x=${x.toFixed(0)}, y=${y.toFixed(0)}, w=${width.toFixed(0)}, h=${height.toFixed(0)} (confidence: ${(person.confidence * 100).toFixed(1)}%)`);
                
                this.blurEllipticalArea(x, y, width, height);
            }
        });
        
        // Blur detected faces
        detectionResult.faces.forEach((face, index) => {
            if (face.boundingBox) {
                const x = face.boundingBox.x * scaleX;
                const y = face.boundingBox.y * scaleY;
                const width = face.boundingBox.width * scaleX;
                const height = face.boundingBox.height * scaleY;
                
                console.log(`😶‍🌫️ Blurring face ${index}: x=${x.toFixed(0)}, y=${y.toFixed(0)}, w=${width.toFixed(0)}, h=${height.toFixed(0)} (confidence: ${(face.confidence * 100).toFixed(1)}%)`);
                
                this.blurEllipticalArea(x, y, width, height);
            }
        });
    }
    
    blurEllipticalArea(x, y, width, height) {
        // Make ellipse 5% bigger for softer edges
        const sizeIncrease = 0.05;
        const expandedWidth = width * (1 + sizeIncrease);
        const expandedHeight = height * (1 + sizeIncrease);
        const expandedX = x - (expandedWidth - width) / 2;
        const expandedY = y - (expandedHeight - height) / 2;
        
        // Create a temporary canvas for the blur effect
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        // Scale padding and blur relative to detection size
        const avgSize = (expandedWidth + expandedHeight) / 2;
        const padding = Math.max(20, avgSize * 0.15);  // 15% of detection size, minimum 20px
        const blurRadius = Math.max(8, avgSize * 0.08); // 8% of detection size, minimum 8px
        
        const blurX = Math.max(0, expandedX - padding);
        const blurY = Math.max(0, expandedY - padding);
        const blurWidth = expandedWidth + (padding * 2);
        const blurHeight = expandedHeight + (padding * 2);
        
        tempCanvas.width = blurWidth;
        tempCanvas.height = blurHeight;
        
        // Copy the area to be blurred
        tempCtx.drawImage(
            this.canvas,
            blurX, blurY, blurWidth, blurHeight,
            0, 0, blurWidth, blurHeight
        );
        
        // Apply blur scaled to detection size
        tempCtx.filter = `blur(${blurRadius}px)`;
        tempCtx.drawImage(tempCanvas, 0, 0);
        tempCtx.filter = 'none';
        
        // Create an alpha mask for soft edges
        const maskCanvas = document.createElement('canvas');
        const maskCtx = maskCanvas.getContext('2d');
        maskCanvas.width = blurWidth;
        maskCanvas.height = blurHeight;
        
        // Create radial gradient from center
        const centerX = (expandedX - blurX) + expandedWidth/2;
        const centerY = (expandedY - blurY) + expandedHeight/2;
        const radiusX = expandedWidth/2;
        const radiusY = expandedHeight/2;
        
        // Use manual ellipse drawing with gradient
        maskCtx.save();
        maskCtx.translate(centerX, centerY);
        maskCtx.scale(1, radiusY/radiusX);
        
        // Create circular gradient (will become elliptical due to scale)
        const gradient = maskCtx.createRadialGradient(0, 0, radiusX * 0.6, 0, 0, radiusX);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');    // Full opacity at center
        gradient.addColorStop(0.8, 'rgba(255, 255, 255, 1)');  // Full opacity until 80%
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');    // Fade to transparent
        
        maskCtx.fillStyle = gradient;
        maskCtx.beginPath();
        maskCtx.arc(0, 0, radiusX, 0, 2 * Math.PI);
        maskCtx.fill();
        maskCtx.restore();
        
        // Apply mask to blurred content
        tempCtx.globalCompositeOperation = 'destination-in';
        tempCtx.drawImage(maskCanvas, 0, 0);
        
        // Draw the masked blur back to main canvas
        this.ctx.drawImage(tempCanvas, blurX, blurY);
    }

    async detectPeopleAndFaces(img, timestamp = null) {
        // Skip detection entirely if worker isn't available
        if (!this.workerRpc) {
            return { people: [], faces: [], error: 'Worker not available' };
        }
        
        try {
            // Create offscreen canvas 960x540
            const offscreenCanvas = new OffscreenCanvas(960, 540);
            const offscreenCtx = offscreenCanvas.getContext('2d');
            
            // Draw scaled image to offscreen canvas
            offscreenCtx.drawImage(img, 0, 0, 960, 540);
            
            // Get image data for worker
            const imageData = offscreenCtx.getImageData(0, 0, 960, 540);
            
            // Calculate scale factor (original image size vs 960x540)
            const scaleX = img.width / 960;
            const scaleY = img.height / 540;
            const scale = { x: scaleX, y: scaleY };
            
            // Send to worker for detection with transferable objects
            const detectionResult = await this.workerRpc.methodsExt.detectPeople(imageData, scale, timestamp, { postMessageOptions: { transfer: [imageData.data.buffer] } });
            
            // Only show detections if we got actual results, not fallback responses
            if (!detectionResult.fallback && (detectionResult.people.length > 0 || detectionResult.faces.length > 0)) {
                this.displayDetectedCrops(img, detectionResult);
            } else if (detectionResult.fallback) {
                // MediaPipe not available, silently continue without detection
                return { people: [], faces: [], disabled: true };
            }
            
            return detectionResult;
            
        } catch (error) {
            console.warn('People detection failed:', error.message);
            return { people: [], faces: [], error: error.message };
        }
    }

    updateDetectionStatus(status, error = null) {
        // Update UI to show detection readiness
        const statusElement = document.getElementById('detection-status');
        if (!statusElement) {
            // Create status element if it doesn't exist
            const statusDiv = document.createElement('div');
            statusDiv.id = 'detection-status';
            statusDiv.style.cssText = `
                position: fixed;
                bottom: 10px;
                left: 10px;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: bold;
                z-index: 1001;
            `;
            document.body.appendChild(statusDiv);
        }
        
        const statusEl = document.getElementById('detection-status');
        
        switch (status) {
            case 'ready':
                statusEl.textContent = '🔍 Detection Ready';
                statusEl.style.backgroundColor = '#4CAF50';
                statusEl.style.color = 'white';
                break;
            case 'error':
                statusEl.textContent = `❌ Detection Error: ${error}`;
                statusEl.style.backgroundColor = '#f44336';
                statusEl.style.color = 'white';
                break;
            case 'disabled':
                statusEl.textContent = '🚫 Detection Disabled';
                statusEl.style.backgroundColor = '#607d8b';
                statusEl.style.color = 'white';
                break;
            case 'initializing':
                statusEl.textContent = '⏳ Loading Detection Models...';
                statusEl.style.backgroundColor = '#ff9800';
                statusEl.style.color = 'white';
                break;
            default:
                statusEl.textContent = '🔍 Detection Status Unknown';
                statusEl.style.backgroundColor = '#9e9e9e';
                statusEl.style.color = 'white';
        }
    }

    displayDetectedCrops(img, detectionResult) {
        // Create or get the detections container
        let container = document.getElementById('detections-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'detections-container';
            container.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                max-width: 300px;
                max-height: 80vh;
                overflow-y: auto;
                background: rgba(0, 0, 0, 0.8);
                border-radius: 8px;
                padding: 10px;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                gap: 10px;
            `;
            document.body.appendChild(container);
        }

        // Process face detections
        detectionResult.faces.forEach((face, index) => {
            if (face.boundingBox) {
                const croppedImage = this.cropDetection(img, face.boundingBox, `face-${index}`, 'red', face.confidence);
                if (croppedImage) {
                    container.appendChild(croppedImage);
                }
            }
        });

        // Process people detections
        detectionResult.people.forEach((person, index) => {
            if (person.boundingBox) {
                const croppedImage = this.cropDetection(img, person.boundingBox, `person-${index}`, 'green', person.confidence);
                if (croppedImage) {
                    container.appendChild(croppedImage);
                }
            }
        });

        // Limit container to last 10 detections to prevent overflow
        while (container.children.length > 10) {
            container.removeChild(container.firstChild);
        }
    }

    cropDetection(img, boundingBox, label, borderColor = 'green', confidence = 1.0) {
        try {
            // Add padding around the bounding box
            const padding = 20;
            const x = Math.max(0, boundingBox.x - padding);
            const y = Math.max(0, boundingBox.y - padding);
            const width = Math.min(img.width - x, boundingBox.width + (padding * 2));
            const height = Math.min(img.height - y, boundingBox.height + (padding * 2));

            // Create a canvas to crop the detection
            const cropCanvas = document.createElement('canvas');
            const cropCtx = cropCanvas.getContext('2d');
            
            // Set canvas size to cropped area
            cropCanvas.width = width;
            cropCanvas.height = height;
            
            // Draw the cropped portion of the image
            cropCtx.drawImage(
                img,
                x, y, width, height,  // Source rectangle
                0, 0, width, height   // Destination rectangle
            );
            
            // Draw confidence percentage overlay (50% of image width)
            const confidenceText = `${(confidence * 100).toFixed(0)}%`;
            const fontSize = Math.max(width * 0.5, 20); // 50% of image width, minimum 20px
            cropCtx.font = `bold ${fontSize}px Arial`;
            
            // Center the text
            const textMetrics = cropCtx.measureText(confidenceText);
            const textX = (width - textMetrics.width) / 2;
            const textY = (height + fontSize) / 2;
            
            // Draw white text with black outline
            cropCtx.strokeStyle = 'black';
            cropCtx.lineWidth = 3;
            cropCtx.strokeText(confidenceText, textX, textY);
            
            cropCtx.fillStyle = 'white';
            cropCtx.fillText(confidenceText, textX, textY);

            // Create img element to display
            const croppedImg = document.createElement('img');
            croppedImg.src = cropCanvas.toDataURL();
            croppedImg.style.cssText = `
                max-width: 150px;
                max-height: 100px;
                border: 2px solid ${borderColor};
                border-radius: 4px;
                display: block;
            `;
            croppedImg.title = `${label} - ${boundingBox.width.toFixed(0)}x${boundingBox.height.toFixed(0)}`;

            return croppedImg;

        } catch (error) {
            console.error('Error cropping detection:', error);
            return null;
        }
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