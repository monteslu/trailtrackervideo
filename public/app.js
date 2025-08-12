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
        this.processingDelegate = localStorage.getItem('processingDelegate') || 'cpu'; // Load from localStorage or default to CPU
        
        // Worker readiness state
        this.workerDetectionReady = false;
        
        // Time tracking for estimation
        this.processingStartTime = null;
        this.frameTimes = [];
        
        // FPS tracking for 10% intervals
        this.fpsIntervals = [];
        this.currentIntervalFrameTimes = [];
        this.lastFrameEndTime = null;
        
        // Debug mode for map capture
        this.debugMapCapture = false;
        this.debugPanel = document.getElementById('debugPanel');
        this.debugOutput = [];
        this.debugLogged = false;
        
        // Crop area selector
        this.cropAreaOverride = null;
        this.cropPreviewCanvas = document.getElementById('cropPreviewCanvas');
        this.cropPreviewCtx = this.cropPreviewCanvas.getContext('2d');
        
        // Popup capture canvas
        this.popupCanvas = null;
        
        
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
        
        document.getElementById('processingDelegate').addEventListener('change', (e) => {
            this.processingDelegate = e.target.value;
            localStorage.setItem('processingDelegate', this.processingDelegate);
        });
        
        // Cache management event listeners
        document.getElementById('refreshCacheBtn').addEventListener('click', () => this.loadCacheStats());
        document.getElementById('clearCacheBtn').addEventListener('click', () => this.clearCache());
        document.getElementById('preloadBtn').addEventListener('click', () => this.preloadCurrentRoute());
        
        // Debug mode toggle
        document.getElementById('debugMapBtn').addEventListener('click', () => {
            this.debugMapCapture = !this.debugMapCapture;
            const btn = document.getElementById('debugMapBtn');
            btn.textContent = this.debugMapCapture ? 'Disable Map Debug' : 'Enable Map Debug';
            btn.style.backgroundColor = this.debugMapCapture ? '#ff6b6b' : '';
            
            // Show/hide debug panel
            this.debugPanel.style.display = this.debugMapCapture ? 'block' : 'none';
            if (!this.debugMapCapture) {
                this.debugOutput = [];
                this.debugPanel.textContent = 'Debug output will appear here...';
            } else {
                // Reset debug logging when enabling
                this.debugLogged = false;
                this.debugOutput = [];
            }
            
            console.log('Map capture debug mode:', this.debugMapCapture ? 'ENABLED' : 'DISABLED');
        });
        
        // Crop area selector event listeners
        this.initializeCropSelector();
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
        
        // Set the processing delegate dropdown to the loaded/default value
        const processingDelegateSelect = document.getElementById('processingDelegate');
        if (processingDelegateSelect) {
            processingDelegateSelect.value = this.processingDelegate;
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
        document.getElementById('fpsInfoContainer').style.display = 'block';
        
        // Hide detection ready message after processing starts
        const statusElement = document.getElementById('detection-status');
        if (statusElement) {
            statusElement.style.display = 'none';
        }
        
        // Configure worker with processing delegate preference
        if (this.workerRpc) {
            try {
                await this.workerRpc.methods.setProcessingDelegate(this.processingDelegate);
                console.log(`Processing delegate set to: ${this.processingDelegate}`);
            } catch (error) {
                console.warn('Failed to set processing delegate:', error);
            }
        }
        
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
        
        // Reset time tracking at start
        this.processingStartTime = Date.now();
        this.frameTimes = [];
        
        // Reset FPS tracking
        this.fpsIntervals = [];
        this.currentIntervalFrameTimes = [];
        this.lastFrameEndTime = null;
        
        // Reset debug logging for new session
        this.debugLogged = false;
        
        for (let i = this.currentIndex; i < this.images.length; i += this.frameInterval) {
            if (!this.isProcessing) break;
            
            while (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            this.currentIndex = i;
            const image = this.images[i];
            
            const frameStartTime = Date.now();
            await this.processImage(image, i);
            const frameEndTime = Date.now();
            
            processedFrames++;
            
            // Track frame processing time
            const frameProcessingTime = frameEndTime - frameStartTime;
            this.frameTimes.push(frameProcessingTime);
            
            // Track FPS data with pause detection
            this.trackFrameFPS(frameStartTime, frameEndTime, processedFrames, totalFramesToProcess);
            
            // Calculate and show time estimate after 2 frames
            let timeEstimate = null;
            if (this.frameTimes.length >= 2) {
                const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
                const remainingFrames = totalFramesToProcess - processedFrames;
                const estimatedMs = remainingFrames * avgFrameTime;
                timeEstimate = this.formatTimeEstimate(estimatedMs);
            }
            
            this.updateProgress(processedFrames, totalFramesToProcess, timeEstimate);
        }
        
        if (this.currentIndex >= this.images.length) {
            this.finishProcessing();
        }
    }
    
    formatTimeEstimate(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            const remainingMinutes = minutes % 60;
            return `${hours}h ${remainingMinutes}m`;
        } else if (minutes > 0) {
            const remainingSeconds = seconds % 60;
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            return `${seconds}s`;
        }
    }
    
    trackFrameFPS(frameStartTime, frameEndTime, processedFrames, totalFramesToProcess) {
        // Calculate delta since last frame (for pause detection)
        let frameDelta = frameEndTime - frameStartTime;
        if (this.lastFrameEndTime) {
            const timeSinceLastFrame = frameStartTime - this.lastFrameEndTime;
            // If gap > 50ms, assume pause was hit - use 33ms instead (30 FPS)
            if (timeSinceLastFrame > 50) {
                frameDelta = 33;
            }
        }
        
        this.lastFrameEndTime = frameEndTime;
        this.currentIntervalFrameTimes.push(frameDelta);
        
        // Check if we've completed a 10% interval
        const intervalSize = Math.ceil(totalFramesToProcess / 10);
        if (processedFrames % intervalSize === 0 || processedFrames === totalFramesToProcess) {
            // Calculate average FPS for this interval
            const totalTime = this.currentIntervalFrameTimes.reduce((sum, time) => sum + time, 0);
            const avgTime = totalTime / this.currentIntervalFrameTimes.length;
            const avgFPS = 1000 / avgTime; // Convert ms to FPS
            
            const intervalNumber = Math.ceil(processedFrames / intervalSize);
            this.fpsIntervals.push({
                interval: intervalNumber,
                fps: avgFPS,
                frames: this.currentIntervalFrameTimes.length,
                avgTime: avgTime
            });
            
            // Reset for next interval
            this.currentIntervalFrameTimes = [];
            
            // Update display
            this.updateFPSDisplay();
        }
    }
    
    updateFPSDisplay() {
        const fpsDisplay = document.getElementById('fpsDisplay');
        if (!fpsDisplay) return;
        
        let display = '';
        this.fpsIntervals.forEach((interval, index) => {
            const percentStart = (index * 10);
            const percentEnd = Math.min(percentStart + 10, 100);
            display += `${percentStart}%-${percentEnd}%: ${interval.fps.toFixed(1)} FPS (${interval.frames} frames, ${interval.avgTime.toFixed(1)}ms avg)\n`;
        });
        
        if (display === '') {
            display = 'Calculating FPS...';
        }
        
        fpsDisplay.textContent = display;
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
        
        // Update detailMapCanvas dimensions from crop selector values
        const cropWidth = parseInt(localStorage.getItem('cropWidth') || '600');
        const cropHeight = parseInt(localStorage.getItem('cropHeight') || '400');
        
        if (this.detailMapCanvas.width !== cropWidth || this.detailMapCanvas.height !== cropHeight) {
            this.detailMapCanvas.width = cropWidth;
            this.detailMapCanvas.height = cropHeight;
        }
        
        // Get paint zoom multiplier
        const paintZoom = parseFloat(localStorage.getItem('detailPaintZoom') || '1.0');
        
        // Calculate zoomed dimensions
        const zoomedWidth = this.detailMapCanvas.width * paintZoom;
        const zoomedHeight = this.detailMapCanvas.height * paintZoom;
        
        // Draw the detail map canvas with zoom applied (position stays same, size changes)
        this.ctx.drawImage(
            this.detailMapCanvas, 
            pos.x, pos.y, 
            zoomedWidth, zoomedHeight
        );
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

    async capturePopupToCanvas() {
        if (!this.captureVideo || !this.mapPopup) return null;
        
        try {
            // Create popupCanvas if it doesn't exist or size changed
            const videoWidth = this.captureVideo.videoWidth;
            const videoHeight = this.captureVideo.videoHeight;
            
            if (!this.popupCanvas || 
                this.popupCanvas.width !== videoWidth || 
                this.popupCanvas.height !== videoHeight) {
                
                this.popupCanvas = document.createElement('canvas');
                this.popupCanvas.width = videoWidth;
                this.popupCanvas.height = videoHeight;
            }
            
            const ctx = this.popupCanvas.getContext('2d');
            
            // Capture the entire screen to popupCanvas
            ctx.drawImage(this.captureVideo, 0, 0, videoWidth, videoHeight);
            
            return this.popupCanvas;
            
        } catch (error) {
            console.error('Error capturing popup to canvas:', error);
            return null;
        }
    }

    async cropFromPopupCanvas() {
        if (!this.popupCanvas || !this.detailMapCanvas) return;
        
        try {
            // Get crop coordinates from localStorage
            const cropX = parseInt(localStorage.getItem('cropX') || '200');
            const cropY = parseInt(localStorage.getItem('cropY') || '100');
            const cropWidth = parseInt(localStorage.getItem('cropWidth') || '600');
            const cropHeight = parseInt(localStorage.getItem('cropHeight') || '400');
            
            // Update detailMapCanvas size to match crop dimensions
            this.detailMapCanvas.width = cropWidth;
            this.detailMapCanvas.height = cropHeight;
            
            const detailCtx = this.detailMapCanvas.getContext('2d');
            
            // Clear the canvas first
            detailCtx.clearRect(0, 0, cropWidth, cropHeight);
            
            // Crop from popupCanvas to detailMapCanvas
            detailCtx.drawImage(
                this.popupCanvas,
                cropX, cropY, cropWidth, cropHeight,  // Source rectangle from popup
                0, 0, cropWidth, cropHeight           // Fill entire detail canvas
            );
            
            // Apply transparent gradient around edges
            this.applyFadeToCanvas(detailCtx, cropWidth, cropHeight);
            
        } catch (error) {
            console.error('Error cropping from popup canvas:', error);
        }
    }

    async captureMapToCanvas() {
        if (!this.routeMapCanvas || !this.detailMapCanvas || !this.mapPopup) return;
        
        try {
            // First capture the full popup to popupCanvas
            await this.capturePopupToCanvas();
            
            // Then crop from popupCanvas to detail map
            await this.cropFromPopupCanvas();
            
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
            
            // Get specific map coordinates (these are in CSS pixels relative to popup content)
            const mapCoords = this.mapCoordinates[mapType];
            if (!mapCoords) return null;
            
            // Get actual div dimensions and account for pixel density
            let actualDivWidth = 450;
            let actualDivHeight = 300;
            
            try {
                const popupDoc = this.mapPopup.document;
                const mapDiv = popupDoc.querySelector(`#${mapType}`);
                if (mapDiv) {
                    const rect = mapDiv.getBoundingClientRect();
                    actualDivWidth = rect.width;
                    actualDivHeight = rect.height;
                }
            } catch (e) {
                // Use defaults
            }
            
            // Account for pixel density - multiply by device pixel ratio
            const pixelRatio = window.devicePixelRatio || 1;
            let cropWidth = actualDivWidth * pixelRatio;
            let cropHeight = actualDivHeight * pixelRatio;
            
            // Calculate the scale between video capture and popup content
            const videoWidth = this.captureVideo.videoWidth;
            const videoHeight = this.captureVideo.videoHeight;
            
            // Your debug shows the video is 2724x1430, but popup reports negative decorations
            // This suggests the video is capturing content area only, not full window
            // Let's use direct scaling from video to popup content
            
            // Get actual popup content dimensions
            let actualPopupWidth, actualPopupHeight;
            try {
                const popupDoc = this.mapPopup.document;
                const mapContainer = popupDoc.querySelector('.map-previews');
                if (mapContainer) {
                    const containerRect = mapContainer.getBoundingClientRect();
                    // Use the container's parent dimensions as reference
                    actualPopupWidth = containerRect.width || this.mapPopup.innerWidth;
                    actualPopupHeight = containerRect.height || this.mapPopup.innerHeight;
                } else {
                    actualPopupWidth = this.mapPopup.innerWidth;
                    actualPopupHeight = this.mapPopup.innerHeight;
                }
            } catch (e) {
                actualPopupWidth = this.mapPopup.innerWidth;
                actualPopupHeight = this.mapPopup.innerHeight;
            }
            
            // Calculate scale factors
            const scaleX = videoWidth / actualPopupWidth;
            const scaleY = videoHeight / actualPopupHeight;
            
            // Calculate center crop area - crop from center of the map element
            const centerOffsetX = (mapCoords.width - cropWidth) / 2;
            const centerOffsetY = (mapCoords.height - cropHeight) / 2;
            
            // Get actual div coordinates from popup and account for window position
            let divLeft = 0;
            let divTop = 0;
            
            try {
                const popupDoc = this.mapPopup.document;
                const mapDiv = popupDoc.querySelector(`#${mapType}`);
                if (mapDiv) {
                    const rect = mapDiv.getBoundingClientRect();
                    // These coordinates are relative to the popup viewport
                    divLeft = rect.left;
                    divTop = rect.top;
                }
            } catch (e) {
                // Use stored coordinates as fallback
                if (mapCoords) {
                    divLeft = mapCoords.left;
                    divTop = mapCoords.top;
                }
            }
            
            // Use the pixel ratio already defined above
            
            // Use crop area override if available, otherwise calculate from div position
            let sourceX, sourceY, sourceWidth, sourceHeight;
            
            if (this.cropAreaOverride) {
                // Use manual crop values and update canvas size
                sourceX = this.cropAreaOverride.x;
                sourceY = this.cropAreaOverride.y;
                sourceWidth = this.cropAreaOverride.width;
                sourceHeight = this.cropAreaOverride.height;
                
                // Update crop size to match crop area
                cropWidth = sourceWidth;
                cropHeight = sourceHeight;
            } else {
                // Calculate from div position * pixel ratio
                sourceX = Math.round(divLeft * pixelRatio);
                sourceY = Math.round(divTop * pixelRatio);
                sourceWidth = cropWidth;  // Already adjusted for pixel ratio
                sourceHeight = cropHeight; // Already adjusted for pixel ratio
            }
            
            // Create canvas with final dimensions
            const canvas = document.createElement('canvas');
            canvas.width = cropWidth;
            canvas.height = cropHeight;
            const ctx = canvas.getContext('2d');
            
            // Linux adjustment: if the vertical offset is still wrong, try adding a title bar offset
            // This is a heuristic based on your debug showing consistent -320 vertical offset
            if (platform.name === 'Linux') {
                // Try to detect if we need a title bar offset
                // If the crop would be in the top portion of the video, add an offset
                const videoTopThird = videoHeight / 3;
                if (sourceY < videoTopThird) {
                    // Estimate title bar height and add it
                    const estimatedTitleBarHeight = Math.round(40 * scaleY); // ~40px title bar
                    sourceY += estimatedTitleBarHeight;
                }
            }
            
            // Check if coordinates seem unreasonable and try to center them
            const cropCenterX = sourceX + sourceWidth / 2;
            const cropCenterY = sourceY + sourceHeight / 2;
            const videoCenterX = videoWidth / 2;
            const videoCenterY = videoHeight / 2;
            
            // Apply small adjustments instead of full centering
            let adjustedSourceX = sourceX;
            let adjustedSourceY = sourceY;
            
            // Small horizontal adjustment - just nudge towards center
            const horizontalOffset = cropCenterX - videoCenterX;
            if (Math.abs(horizontalOffset) > 200) {
                const adjustmentAmount = Math.round(horizontalOffset * 0.3); // Move 30% towards center
                adjustedSourceX = sourceX - adjustmentAmount;
            }
            
            // Small vertical adjustment
            const verticalOffset = cropCenterY - videoCenterY;
            if (Math.abs(verticalOffset) > 50) {
                const adjustmentAmount = Math.round(verticalOffset * 0.5); // Move 50% towards center
                adjustedSourceY = sourceY - adjustmentAmount;
            }
            
            // Use adjusted coordinates if they changed
            if (adjustedSourceX !== sourceX || adjustedSourceY !== sourceY) {
                return this.captureWithCoords(mapType, adjustedSourceX, adjustedSourceY, sourceWidth, sourceHeight, cropWidth, cropHeight);
            }
            
            // Ensure coordinates are within video bounds
            const clampedSourceX = Math.max(0, Math.min(sourceX, videoWidth - sourceWidth));
            const clampedSourceY = Math.max(0, Math.min(sourceY, videoHeight - sourceHeight));
            
            
            // Capture crop area from screen capture and fill entire canvas
            ctx.drawImage(
                this.captureVideo,
                clampedSourceX, clampedSourceY, sourceWidth, sourceHeight,  // Source rectangle from video
                0, 0, canvas.width, canvas.height                          // Fill entire canvas
            );
            
            // Add debug info to text panel (easy to copy/paste) - only once per session
            if (this.debugMapCapture && !this.debugLogged) {
                this.logDebugInfo(mapType, clampedSourceX, clampedSourceY, sourceWidth, sourceHeight);
            }
            
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
    
    initializeCropSelector() {
        const sliders = ['cropX', 'cropY', 'cropWidth', 'cropHeight', 'detailPaintZoom'];
        const defaults = { cropX: 200, cropY: 100, cropWidth: 600, cropHeight: 400, detailPaintZoom: 1.0 };
        
        // Load values from localStorage and update sliders
        sliders.forEach(id => {
            const slider = document.getElementById(id);
            const valueSpan = document.getElementById(id + 'Value');
            
            // Load from localStorage or use default
            const savedValue = localStorage.getItem(id) || defaults[id];
            slider.value = savedValue;
            valueSpan.textContent = savedValue;
            
            slider.addEventListener('input', () => {
                valueSpan.textContent = slider.value;
                // Save to localStorage on change
                localStorage.setItem(id, slider.value);
                this.updateCropPreview();
            });
        });
        
        // Capture preview button
        document.getElementById('capturePreviewBtn').addEventListener('click', () => {
            this.capturePopupPreview();
        });
        
        // Auto-enable crop area override on slider change
        sliders.forEach(id => {
            const slider = document.getElementById(id);
            slider.addEventListener('input', () => {
                this.updateCropAreaOverride();
            });
        });
        
        // Initialize crop area override
        this.updateCropAreaOverride();
        
        // Crop values now apply automatically - no button needed
    }
    
    updateCropAreaOverride() {
        const x = parseInt(document.getElementById('cropX').value);
        const y = parseInt(document.getElementById('cropY').value);
        const w = parseInt(document.getElementById('cropWidth').value);
        const h = parseInt(document.getElementById('cropHeight').value);
        
        this.cropAreaOverride = { x, y, width: w, height: h };
    }
    
    async capturePopupPreview() {
        if (!this.captureVideo || !this.mapPopup) {
            alert('Need active screen capture and popup window');
            return;
        }
        
        try {
            const videoWidth = this.captureVideo.videoWidth;
            const videoHeight = this.captureVideo.videoHeight;
            
            // Scale down for preview (fit to 400x300 canvas)
            const scale = Math.min(400 / videoWidth, 300 / videoHeight);
            const previewWidth = videoWidth * scale;
            const previewHeight = videoHeight * scale;
            
            this.cropPreviewCanvas.width = previewWidth;
            this.cropPreviewCanvas.height = previewHeight;
            this.cropPreviewCanvas.style.display = 'block';
            
            // Draw full video capture scaled down
            this.cropPreviewCtx.drawImage(
                this.captureVideo,
                0, 0, videoWidth, videoHeight,
                0, 0, previewWidth, previewHeight
            );
            
            this.updateCropPreview();
            
        } catch (error) {
            console.error('Preview capture failed:', error);
        }
    }
    
    updateCropPreview() {
        if (!this.cropPreviewCanvas.style.display || this.cropPreviewCanvas.style.display === 'none') return;
        
        const x = parseInt(document.getElementById('cropX').value);
        const y = parseInt(document.getElementById('cropY').value);
        const w = parseInt(document.getElementById('cropWidth').value);
        const h = parseInt(document.getElementById('cropHeight').value);
        
        // Use popupCanvas if available, otherwise fall back to captureVideo
        const sourceCanvas = this.popupCanvas || this.captureVideo;
        if (!sourceCanvas) return;
        
        const sourceWidth = sourceCanvas.width || sourceCanvas.videoWidth;
        const sourceHeight = sourceCanvas.height || sourceCanvas.videoHeight;
        
        // Calculate scale factor for preview
        const scale = this.cropPreviewCanvas.width / sourceWidth;
        
        // Clear previous rectangle
        this.cropPreviewCtx.save();
        this.cropPreviewCtx.globalCompositeOperation = 'source-over';
        
        // Redraw the popup/video 
        this.cropPreviewCtx.drawImage(
            sourceCanvas,
            0, 0, sourceWidth, sourceHeight,
            0, 0, this.cropPreviewCanvas.width, this.cropPreviewCanvas.height
        );
        
        // Draw red crop rectangle
        this.cropPreviewCtx.strokeStyle = 'red';
        this.cropPreviewCtx.lineWidth = 2;
        this.cropPreviewCtx.strokeRect(x * scale, y * scale, w * scale, h * scale);
        
        this.cropPreviewCtx.restore();
    }
    
    captureWithCoords(mapType, sourceX, sourceY, sourceWidth, sourceHeight, cropWidth, cropHeight) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = cropWidth;
            canvas.height = cropHeight;
            const ctx = canvas.getContext('2d');
            
            ctx.drawImage(
                this.captureVideo,
                sourceX, sourceY, sourceWidth, sourceHeight,
                0, 0, cropWidth, cropHeight
            );
            
            return canvas;
        } catch (error) {
            console.warn(`Failed to capture ${mapType} with coords:`, error);
            return null;
        }
    }
    
    logDebugInfo(mapType, sourceX, sourceY, sourceWidth, sourceHeight) {
        if (!this.captureVideo) return;
        
        const videoWidth = this.captureVideo.videoWidth;
        const videoHeight = this.captureVideo.videoHeight;
        
        // Get window info
        const popupInnerWidth = this.mapPopup ? this.mapPopup.innerWidth : 'N/A';
        const popupInnerHeight = this.mapPopup ? this.mapPopup.innerHeight : 'N/A';
        const popupOuterWidth = this.mapPopup ? this.mapPopup.outerWidth : 'N/A';
        const popupOuterHeight = this.mapPopup ? this.mapPopup.outerHeight : 'N/A';
        const devicePixelRatio = window.devicePixelRatio || 1;
        
        // Calculate scales
        const scaleToInner = popupInnerWidth !== 'N/A' ? (videoWidth / popupInnerWidth).toFixed(3) : 'N/A';
        const scaleToOuter = popupOuterWidth !== 'N/A' ? (videoWidth / popupOuterWidth).toFixed(3) : 'N/A';
        
        const debugInfo = `
=== MAP CAPTURE DEBUG: ${mapType.toUpperCase()} ===
Timestamp: ${new Date().toLocaleTimeString()}

SYSTEM INFO:
- OS: ${navigator.platform}
- User Agent: ${navigator.userAgent.split(' ').slice(-2).join(' ')}
- Device Pixel Ratio: ${devicePixelRatio}

VIDEO CAPTURE:
- Video Dimensions: ${videoWidth} x ${videoHeight}

POPUP WINDOW:
- Inner Dimensions: ${popupInnerWidth} x ${popupInnerHeight}
- Outer Dimensions: ${popupOuterWidth} x ${popupOuterHeight}
- Decorations: ${popupOuterWidth - popupInnerWidth} x ${popupOuterHeight - popupInnerHeight}

SCALING:
- Video/Inner Scale: ${scaleToInner}x
- Video/Outer Scale: ${scaleToOuter}x

CROP COORDINATES:
- Source X: ${sourceX}
- Source Y: ${sourceY}
- Source Width: ${sourceWidth}
- Source Height: ${sourceHeight}
- Crop Center: ${sourceX + sourceWidth/2}, ${sourceY + sourceHeight/2}
- Video Center: ${videoWidth/2}, ${videoHeight/2}
- Horizontal Offset: ${(sourceX + sourceWidth/2) - (videoWidth/2)}
- Vertical Offset: ${(sourceY + sourceHeight/2) - (videoHeight/2)}

===============================================
`;

        this.debugOutput.push(debugInfo);
        
        // Update debug panel
        this.debugPanel.textContent = this.debugOutput.join('\n');
        
        // Mark as logged so we don't spam
        if (this.debugOutput.length >= 2) { // Both routeMap and detailMap
            this.debugLogged = true;
        }
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
            // Get the actual video dimensions from the capture stream
            const videoWidth = this.captureVideo.videoWidth;
            const videoHeight = this.captureVideo.videoHeight;
            
            // Get device pixel ratio for both windows
            const mainPixelRatio = window.devicePixelRatio || 1;
            const popupPixelRatio = this.mapPopup.devicePixelRatio || 1;
            
            // Get the popup window's dimensions
            const popupInnerWidth = this.mapPopup.innerWidth;
            const popupInnerHeight = this.mapPopup.innerHeight;
            const popupOuterWidth = this.mapPopup.outerWidth;
            const popupOuterHeight = this.mapPopup.outerHeight;
            
            console.log('Screen capture dimensions:', {
                video: [videoWidth, videoHeight],
                popupInner: [popupInnerWidth, popupInnerHeight],
                popupOuter: [popupOuterWidth, popupOuterHeight],
                decorations: [popupOuterWidth - popupInnerWidth, popupOuterHeight - popupInnerHeight],
                devicePixelRatios: { main: mainPixelRatio, popup: popupPixelRatio }
            });
            
            // Get the map container bounds within the popup
            let mapContainerBounds = null;
            try {
                const mapContainer = this.mapPopup.document.querySelector('.map-previews');
                if (mapContainer) {
                    mapContainerBounds = mapContainer.getBoundingClientRect();
                    console.log('Map container bounds relative to viewport:', mapContainerBounds);
                }
            } catch (e) {
                console.warn('Could not get map container bounds:', e);
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 500;
            const ctx = canvas.getContext('2d');
            
            // Calculate the actual scale between video and window
            // Don't assume pixel ratio - calculate it directly
            const actualScaleX = videoWidth / popupOuterWidth;
            const actualScaleY = videoHeight / popupOuterHeight;
            
            console.log('Scale calculation:', {
                videoSize: [videoWidth, videoHeight],
                windowOuter: [popupOuterWidth, popupOuterHeight],
                windowInner: [popupInnerWidth, popupInnerHeight],
                actualScale: [actualScaleX, actualScaleY],
                devicePixelRatios: { main: mainPixelRatio, popup: popupPixelRatio }
            });
            
            // Calculate window decoration sizes
            const decorationHeight = popupOuterHeight - popupInnerHeight;
            const decorationWidth = popupOuterWidth - popupInnerWidth;
            
            // Default crop area - will be refined based on what we detect
            let sourceX = 0;
            let sourceY = 0;
            let sourceWidth = videoWidth;
            let sourceHeight = videoHeight;
            
            if (mapContainerBounds) {
                console.log('Container bounds in popup:', {
                    left: mapContainerBounds.left,
                    top: mapContainerBounds.top,  
                    width: mapContainerBounds.width,
                    height: mapContainerBounds.height,
                    windowInner: [popupInnerWidth, popupInnerHeight]
                });
                
                // The most reliable approach: use the ratio of video to window inner dimensions
                // This works regardless of DPI scaling
                const scaleX = videoWidth / popupInnerWidth;
                const scaleY = videoHeight / popupInnerHeight;
                
                // Try direct mapping first (assumes video captures content area)
                sourceX = mapContainerBounds.left * scaleX;
                sourceY = mapContainerBounds.top * scaleY;
                sourceWidth = mapContainerBounds.width * scaleX;
                sourceHeight = mapContainerBounds.height * scaleY;
                
                // Check if we're capturing the whole window (with decorations) by comparing aspect ratios
                const videoAspect = videoWidth / videoHeight;
                const innerAspect = popupInnerWidth / popupInnerHeight;
                const outerAspect = popupOuterWidth / popupOuterHeight;
                
                const matchesInner = Math.abs(videoAspect - innerAspect) < 0.05;
                const matchesOuter = Math.abs(videoAspect - outerAspect) < 0.05;
                
                // If aspect ratio matches outer better than inner, we have decorations
                if (!matchesInner && matchesOuter) {
                    // Recalculate with outer dimensions and decoration offset
                    const outerScaleX = videoWidth / popupOuterWidth;
                    const outerScaleY = videoHeight / popupOuterHeight;
                    
                    sourceX = mapContainerBounds.left * outerScaleX;
                    sourceY = (mapContainerBounds.top + decorationHeight) * outerScaleY;
                    sourceWidth = mapContainerBounds.width * outerScaleX;
                    sourceHeight = mapContainerBounds.height * outerScaleY;
                    
                    console.log('Using outer window scaling (includes decorations)');
                } else {
                    console.log('Using inner window scaling (content only)');
                }
                
                console.log('Scaling calculation:', {
                    scale: [scaleX, scaleY],
                    videoAspect,
                    innerAspect,
                    outerAspect,
                    matchesInner,
                    matchesOuter,
                    source: { x: sourceX, y: sourceY, w: sourceWidth, h: sourceHeight }
                });
                
                // Ensure we stay within video bounds
                sourceX = Math.max(0, Math.min(sourceX, videoWidth - 1));
                sourceY = Math.max(0, Math.min(sourceY, videoHeight - 1));
                sourceWidth = Math.min(sourceWidth, videoWidth - sourceX);
                sourceHeight = Math.min(sourceHeight, videoHeight - sourceY);
            }
            
            console.log('Final crop area:', { 
                sourceX, sourceY, sourceWidth, sourceHeight,
                actualScale: [actualScaleX, actualScaleY],
                decorations: [decorationWidth, decorationHeight]
            });
            
            // Capture and crop the video frame
            ctx.drawImage(
                this.captureVideo, 
                sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle (what to crop)
                0, 0, canvas.width, canvas.height              // Destination rectangle (scale to fit)
            );
            
            // Add debug overlay if debug mode is enabled
            if (this.debugMapCapture) {
                // Draw the full video scaled down in corner for reference
                const debugScale = 0.2;
                const debugWidth = videoWidth * debugScale;
                const debugHeight = videoHeight * debugScale;
                
                ctx.globalAlpha = 0.8;
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, debugWidth + 10, debugHeight + 10);
                
                // Draw full video
                ctx.drawImage(this.captureVideo, 0, 0, debugWidth, debugHeight);
                
                // Draw red rectangle showing what we cropped
                ctx.strokeStyle = 'red';
                ctx.lineWidth = 2;
                ctx.strokeRect(
                    sourceX * debugScale,
                    sourceY * debugScale,
                    sourceWidth * debugScale,
                    sourceHeight * debugScale
                );
                
                ctx.globalAlpha = 1;
                
                // Add text info
                ctx.fillStyle = 'black';
                ctx.font = '10px monospace';
                ctx.fillText(`Video: ${videoWidth}x${videoHeight}`, 5, debugHeight + 20);
                ctx.fillText(`Crop: ${Math.round(sourceX)},${Math.round(sourceY)} ${Math.round(sourceWidth)}x${Math.round(sourceHeight)}`, 5, debugHeight + 32);
                ctx.fillText(`Scale: ${actualScaleX.toFixed(2)}x${actualScaleY.toFixed(2)}`, 5, debugHeight + 44);
            }
            
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
        
        // Create 20 smoothed segments with averaged altitudes
        const segments = 20;
        const segmentSize = Math.ceil(this.images.length / segments);
        const smoothedAltitudes = [];
        
        for (let seg = 0; seg < segments; seg++) {
            const startIdx = seg * segmentSize;
            const endIdx = Math.min(startIdx + segmentSize, this.images.length);
            
            // Calculate average altitude for this segment
            let altSum = 0;
            let altCount = 0;
            
            for (let i = startIdx; i < endIdx; i++) {
                const alt = this.images[i]?.alt || 0;
                if (alt > 0) {
                    altSum += alt;
                    altCount++;
                }
            }
            
            if (altCount > 0) {
                smoothedAltitudes.push(altSum / altCount);
            }
        }
        
        // Draw smooth altitude line chart with averaged segments
        this.ctx.strokeStyle = 'rgba(52, 152, 219, 0.8)';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        
        // Also fill area under the curve
        this.ctx.fillStyle = 'rgba(52, 152, 219, 0.2)';
        const fillPath = new Path2D();
        
        let firstPoint = true;
        smoothedAltitudes.forEach((alt, segmentIndex) => {
            // Relative altitude: 0 = min altitude, max = total elevation gain
            const relativeAlt = alt - this.altitudeRange.min;
            const normalizedHeight = (relativeAlt / altRange) * chartHeight;
            const x = chartX + (segmentIndex / (segments - 1)) * chartWidth;
            const y = chartY + chartHeight - normalizedHeight;
            
            if (firstPoint) {
                this.ctx.moveTo(x, y);
                fillPath.moveTo(x, chartY + chartHeight);
                fillPath.lineTo(x, y);
                firstPoint = false;
            } else {
                this.ctx.lineTo(x, y);
                fillPath.lineTo(x, y);
            }
        });
        
        // Complete fill path
        if (!firstPoint) {
            const lastX = chartX + chartWidth;
            fillPath.lineTo(lastX, chartY + chartHeight);
            fillPath.closePath();
            
            // Draw fill and stroke
            this.ctx.fill(fillPath);
            this.ctx.stroke();
        }
        
        // Draw bike marker at current position following the smoothed curve
        if (currentAlt > 0 && smoothedAltitudes.length > 0) {
            // Find which smoothed segment the current index falls into
            const progressThroughData = currentIndex / this.images.length;
            const segmentFloat = progressThroughData * (segments - 1);
            const segmentIndex = Math.min(Math.floor(segmentFloat), smoothedAltitudes.length - 1);
            
            // Interpolate between segments for smooth bike movement
            let smoothedAlt;
            if (segmentIndex < smoothedAltitudes.length - 1) {
                const t = segmentFloat - segmentIndex;
                const alt1 = smoothedAltitudes[segmentIndex];
                const alt2 = smoothedAltitudes[segmentIndex + 1];
                smoothedAlt = alt1 + (alt2 - alt1) * t;
            } else {
                smoothedAlt = smoothedAltitudes[segmentIndex];
            }
            
            // Position bike marker on smoothed curve
            const markerX = chartX + progressThroughData * chartWidth;
            const relativeSmoothedAlt = smoothedAlt - this.altitudeRange.min;
            const markerHeight = (relativeSmoothedAlt / altRange) * chartHeight;
            const markerY = chartY + chartHeight - markerHeight;
            
            // Draw bike icon without tilt (looks better)
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
                
                this.blurRoundedRectArea(x, y, width, height);
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
                
                this.blurRoundedRectArea(x, y, width, height);
            }
        });
    }
    
    blurRoundedRectArea(x, y, width, height) {
        // Make blur area 25% bigger for better privacy coverage
        const sizeIncrease = 0.25;
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
        
        // Calculate rounded rectangle parameters
        const rectX = expandedX - blurX;
        const rectY = expandedY - blurY;
        const rectWidth = expandedWidth;
        const rectHeight = expandedHeight;
        const cornerRadius = Math.min(rectWidth, rectHeight) * 0.15; // 15% of smaller dimension
        
        // Create rounded rectangle with gradient for soft edges
        maskCtx.save();
        
        // Create gradient from center outward for soft edges
        const centerX = rectX + rectWidth/2;
        const centerY = rectY + rectHeight/2;
        const maxRadius = Math.max(rectWidth, rectHeight) / 2;
        const gradient = maskCtx.createRadialGradient(centerX, centerY, maxRadius * 0.6, centerX, centerY, maxRadius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');    // Full opacity at center
        gradient.addColorStop(0.8, 'rgba(255, 255, 255, 1)');  // Full opacity until 80%
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');    // Fade to transparent
        
        maskCtx.fillStyle = gradient;
        
        // Draw rounded rectangle
        maskCtx.beginPath();
        maskCtx.roundRect(rectX, rectY, rectWidth, rectHeight, cornerRadius);
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

    updateProgress(current, total, timeEstimate = null) {
        const percentage = (current / total) * 100;
        document.getElementById('progressFill').style.width = `${percentage}%`;
        
        let progressText = `${current} / ${total}`;
        if (timeEstimate) {
            progressText += ` - Est. time remaining: ${timeEstimate}`;
        }
        document.getElementById('progressText').textContent = progressText;
    }

    finishProcessing() {
        this.isProcessing = false;
        document.getElementById('startBtn').style.display = 'inline-block';
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('startBtn').textContent = 'Processing Complete';
        document.getElementById('startBtn').disabled = true;
        
        // Keep FPS info visible after completion for review
        // document.getElementById('fpsInfoContainer').style.display = 'none';
        
        // Show detection ready message again if worker is ready
        const statusElement = document.getElementById('detection-status');
        if (statusElement && this.workerDetectionReady) {
            statusElement.style.display = 'block';
        }
        
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