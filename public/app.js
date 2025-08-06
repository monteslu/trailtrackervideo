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
        await this.loadBikeIcon();
        this.initializeMaps();
        await this.loadSessions();
        this.setupEventListeners();
        await this.loadCacheStats();
    }

    initializeMaps() {
        // Initialize route overview map with local proxy tiles
        this.routeMap = L.map('routeMap').setView([33.4484, -112.0740], 10);
        L.tileLayer('/api/tiles/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.routeMap);

        // Initialize detail view map with local proxy tiles
        this.detailMap = L.map('detailMap').setView([33.4484, -112.0740], 15);
        L.tileLayer('/api/tiles/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.detailMap);

        // Get canvas references
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
        
        // Show loading spinner
        loadBtn.innerHTML = '<span class="spinner"></span> Loading...';
        loadBtn.disabled = true;

        try {
            const response = await fetch(`/api/session/${sessionName}`);
            const data = await response.json();
            
            this.currentSession = sessionName;
            this.images = data.images;
            this.currentIndex = 0;
            
            // Calculate altitude range for the entire dataset
            this.calculateAltitudeRange();
            
            // Update maps with route data
            this.updateMapsWithRoute();
            
            document.getElementById('imageCount').textContent = data.count;
            document.getElementById('sessionInfo').style.display = 'block';
            
            console.log(`Loaded ${data.count} images from ${sessionName}`);
            
            // Reset button
            loadBtn.innerHTML = 'Load Session';
            loadBtn.disabled = false;
        } catch (error) {
            console.error('Failed to load session:', error);
            
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
        
        await this.processImages();
    }

    pauseProcessing() {
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById('pauseBtn');
        pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
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
            
            // Update detail map position
            this.updateDetailMapPosition(imageData);
            
            // Wait a moment for map to update and capture to canvases
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Capture maps to hidden canvases
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
        
        // Map dimensions (3:2 aspect ratio) - twice as big
        const mapWidth = overlaySize * 2;
        const mapHeight = Math.floor(mapWidth * 2/3);
        
        const bottomLeft = { x: margin, y: this.canvas.height - mapHeight - margin };
        const bottomRight = { x: this.canvas.width - mapWidth - margin, y: this.canvas.height - mapHeight - margin };
        const topRight = { x: this.canvas.width - altitudeWidth - margin, y: margin, width: altitudeWidth, height: altitudeHeight };
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(bottomLeft.x, bottomLeft.y, mapWidth, mapHeight);
        this.ctx.fillRect(bottomRight.x, bottomRight.y, mapWidth, mapHeight);
        this.ctx.fillRect(topRight.x, topRight.y, altitudeWidth, altitudeHeight);
        
        this.ctx.strokeRect(bottomLeft.x, bottomLeft.y, mapWidth, mapHeight);
        this.ctx.strokeRect(bottomRight.x, bottomRight.y, mapWidth, mapHeight);
        this.ctx.strokeRect(topRight.x, topRight.y, altitudeWidth, altitudeHeight);
        
        this.ctx.fillStyle = '#fff';
        this.ctx.fillText('Route Map', bottomLeft.x + 10, bottomLeft.y + 20);
        this.ctx.fillText('Detail View', bottomRight.x + 10, bottomRight.y + 20);
        
        await this.drawRoutePreview(bottomLeft, mapWidth, mapHeight, imageData, index);
        await this.drawDetailView(bottomRight, mapWidth, mapHeight, imageData);
        this.drawAltitudeChart(topRight, altitudeWidth, altitudeHeight, index);
        
        this.drawBikeIcon(bottomLeft.x + overlaySize/2, bottomLeft.y + overlaySize/2);
        this.drawBikeIcon(bottomRight.x + overlaySize/2, bottomRight.y + overlaySize/2);
    }

    async drawRoutePreview(pos, width, height, imageData, index) {
        if (!this.routeMapCanvas) return;
        
        // Draw the captured route map canvas
        this.ctx.drawImage(this.routeMapCanvas, pos.x, pos.y, width, height);
    }

    async drawDetailView(pos, width, height, imageData) {
        if (!this.detailMapCanvas) return;
        
        // Draw the captured detail map canvas
        this.ctx.drawImage(this.detailMapCanvas, pos.x, pos.y, width, height);
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
                    ctx.strokeStyle = '#3498db';
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
        if (!this.images.length || !this.routeMap || !this.detailMap) return;

        // Filter images with valid GPS data
        const gpsImages = this.images.filter(img => img.lat && img.lon);
        if (gpsImages.length === 0) return;

        // Create polyline for the route
        const routeCoords = gpsImages.map(img => [img.lat, img.lon]);
        
        // Update route overview map
        const routeBounds = L.latLngBounds(routeCoords);
        this.routeMap.fitBounds(routeBounds, { padding: [10, 10] });
        
        if (this.routePolyline) this.routeMap.removeLayer(this.routePolyline);
        this.routePolyline = L.polyline(routeCoords, { color: '#3498db', weight: 3 }).addTo(this.routeMap);
        
        // Set detail map to first GPS point
        const firstPoint = gpsImages[0];
        this.detailMap.setView([firstPoint.lat, firstPoint.lon], 15);
    }

    updateDetailMapPosition(currentImage) {
        if (!currentImage || !currentImage.lat || !currentImage.lon || !this.detailMap) return;
        
        this.detailMap.setView([currentImage.lat, currentImage.lon], 15);
        
        // Remove existing marker
        if (this.currentMarker) this.detailMap.removeLayer(this.currentMarker);
        
        // Create custom Luis bike icon for the map
        const bikeIcon = L.icon({
            iconUrl: '/images/luis_bike_100.png',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15]
        });
        
        // Add current position marker with Luis's bike
        this.currentMarker = L.marker([currentImage.lat, currentImage.lon], {
            icon: bikeIcon
        }).addTo(this.detailMap);
        
        // Also add marker to route overview map
        if (this.routeMarker) this.routeMap.removeLayer(this.routeMarker);
        this.routeMarker = L.marker([currentImage.lat, currentImage.lon], {
            icon: L.icon({
                iconUrl: '/images/luis_bike_100.png',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(this.routeMap);
    }

    async captureMapToCanvas() {
        if (!this.routeMapCanvas || !this.detailMapCanvas) return;
        
        try {
            // Now that tiles are served from same domain, we can use html2canvas safely
            const routeContainer = this.routeMap.getContainer();
            const detailContainer = this.detailMap.getContainer();
            
            // Capture route map div
            const routeCanvas = await html2canvas(routeContainer, {
                width: 300,
                height: 200,
                useCORS: true,  // Now safe since tiles are same-origin
                allowTaint: false,  // Should be clean now
                ignoreElements: (element) => {
                    return element.classList.contains('leaflet-control-attribution');
                }
            });
            
            // Capture detail map div
            const detailCanvas = await html2canvas(detailContainer, {
                width: 300,
                height: 200,
                useCORS: true,
                allowTaint: false,
                ignoreElements: (element) => {
                    return element.classList.contains('leaflet-control-attribution');
                }
            });
            
            // Copy to our hidden canvases
            const routeCtx = this.routeMapCanvas.getContext('2d');
            const detailCtx = this.detailMapCanvas.getContext('2d');
            
            routeCtx.clearRect(0, 0, 600, 400);
            detailCtx.clearRect(0, 0, 600, 400);
            
            routeCtx.drawImage(routeCanvas, 0, 0, 600, 400);
            detailCtx.drawImage(detailCanvas, 0, 0, 600, 400);
            
        } catch (error) {
            console.error('Error capturing map divs:', error);
            // Fallback to simple placeholders if capture fails
            const routeCtx = this.routeMapCanvas.getContext('2d');
            const detailCtx = this.detailMapCanvas.getContext('2d');
            
            routeCtx.fillStyle = '#e5e3df';
            routeCtx.fillRect(0, 0, 600, 400);
            detailCtx.fillStyle = '#e5e3df';
            detailCtx.fillRect(0, 0, 600, 400);
        }
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