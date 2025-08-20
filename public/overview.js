import { calculateTotalDistance } from './src/gpsUtils.js';
import { formatDistance } from './src/altitudeUtils.js';
import { getStorageItem } from './src/storageUtils.js';

class BikeTrailOverview {
    constructor() {
        this.sessions = [];
        this.images = [];
        this.map = null;
        this.pathLayer = null;
        this.animatedLayer = null;
        this.isAnimating = false;
        this.currentZoom = parseInt(localStorage.getItem('overviewZoomLevel') || '12');
        this.altitudeUnit = getStorageItem('altitudeUnit', 'ft'); // Load from localStorage or default to feet
        
        this.initializeEventListeners();
        this.loadSessions();
    }

    initializeEventListeners() {
        document.getElementById('loadBtn').addEventListener('click', () => {
            this.loadSession();
        });
        
        document.getElementById('zoomLevel').addEventListener('input', (e) => {
            this.currentZoom = parseInt(e.target.value);
            document.getElementById('zoomLevelValue').textContent = this.currentZoom;
            localStorage.setItem('overviewZoomLevel', this.currentZoom.toString());
            if (this.map) {
                this.map.setZoom(this.currentZoom);
            }
        });
        
        document.getElementById('animateBtn').addEventListener('click', () => {
            if (this.isAnimating) {
                this.finishAnimation();
            } else {
                this.animatePath();
            }
        });
        
        document.getElementById('zoomMinus').addEventListener('click', () => {
            this.changeZoom(-1);
        });
        
        document.getElementById('zoomPlus').addEventListener('click', () => {
            this.changeZoom(1);
        });
        
        document.getElementById('greyPathBtn').addEventListener('click', () => {
            this.setPathToGrey();
        });
        
        document.getElementById('redPathBtn').addEventListener('click', () => {
            this.setPathToRed();
        });
    }

    async loadSessions() {
        try {
            console.log('Loading sessions...');
            const response = await fetch('/api/sessions');
            this.sessions = await response.json();
            
            const sessionSelect = document.getElementById('sessionSelect');
            sessionSelect.innerHTML = '<option value="">Choose a session...</option>';
            
            this.sessions.forEach(session => {
                const option = document.createElement('option');
                option.value = session;
                option.textContent = session;
                sessionSelect.appendChild(option);
            });
            
            console.log(`Loaded ${this.sessions.length} sessions`);
        } catch (error) {
            console.error('Error loading sessions:', error);
        }
    }

    async loadSession() {
        const sessionName = document.getElementById('sessionSelect').value;
        if (!sessionName) return;

        try {
            console.log(`Loading session: ${sessionName}`);
            const response = await fetch(`/api/session/${encodeURIComponent(sessionName)}`);
            const data = await response.json();
            
            this.images = data.images;
            console.log(`Loaded session with ${this.images.length} images`);
            
            document.getElementById('imageCount').textContent = data.count;
            document.getElementById('sessionInfo').style.display = 'inline';
            document.getElementById('mapControls').style.display = 'block';
            
            // Initialize and show the map
            this.initializeMap();
            this.displayPath();
            
        } catch (error) {
            console.error('Error loading session:', error);
        }
    }

    initializeMap() {
        if (this.map) {
            this.map.remove();
        }

        // Initialize map without zoom control
        this.map = L.map('overviewMap', {
            zoomControl: false,
            zoom: this.currentZoom,
            center: [0, 0]
        });

        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Show map container
        document.getElementById('mapContainer').style.display = 'block';
        
        // Refresh map size after showing
        setTimeout(() => {
            this.map.invalidateSize();
        }, 100);
    }

    displayPath() {
        if (!this.map || !this.images || this.images.length === 0) return;

        // Remove existing path layer if it exists
        if (this.pathLayer) {
            this.map.removeLayer(this.pathLayer);
        }

        // Filter images with valid GPS coordinates
        const validPoints = this.images.filter(img => 
            img.lat !== null && img.lon !== null && 
            !isNaN(img.lat) && !isNaN(img.lon)
        );

        if (validPoints.length === 0) {
            console.warn('No valid GPS coordinates found in session');
            return;
        }

        console.log(`Displaying path with ${validPoints.length} GPS points`);

        // Create polyline from GPS points
        const latLngs = validPoints.map(point => [point.lat, point.lon]);
        
        this.pathLayer = L.polyline(latLngs, {
            color: '#e74c3c',
            weight: 6,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(this.map);

        // Add start and end markers
        if (latLngs.length > 0) {
            // Start marker (green)
            L.marker(latLngs[0], {
                icon: L.divIcon({
                    className: 'start-marker',
                    html: '<div style="background-color: #27ae60; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                })
            }).addTo(this.map).bindPopup('Start');

            // End marker (checkered flag) - only if different from start
            if (latLngs.length > 1) {
                L.marker(latLngs[latLngs.length - 1], {
                    icon: L.divIcon({
                        className: 'end-marker',
                        html: '<div style="font-size: 20px;">🏁</div>',
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    })
                }).addTo(this.map).bindPopup('End');
            }
        }

        // Calculate and display total distance
        this.calculateAndDisplayDistance(validPoints);
        
        // Fit map to path bounds first
        this.map.fitBounds(this.pathLayer.getBounds(), {
            padding: [20, 20]
        });
        
        // Then set to saved zoom level
        this.map.setZoom(this.currentZoom);
    }
    
    changeZoom(delta) {
        const newZoom = Math.max(2, Math.min(17, this.currentZoom + delta));
        if (newZoom !== this.currentZoom) {
            this.currentZoom = newZoom;
            document.getElementById('zoomLevel').value = this.currentZoom;
            document.getElementById('zoomLevelValue').textContent = this.currentZoom;
            localStorage.setItem('overviewZoomLevel', this.currentZoom.toString());
            if (this.map) {
                this.map.setZoom(this.currentZoom);
            }
        }
    }
    
    animatePath() {
        if (!this.map || !this.images || this.images.length === 0 || this.isAnimating) return;
        
        // Get valid GPS points
        const validPoints = this.images.filter(img => 
            img.lat !== null && img.lon !== null && 
            !isNaN(img.lat) && !isNaN(img.lon)
        );
        
        if (validPoints.length === 0) return;
        
        const latLngs = validPoints.map(point => [point.lat, point.lon]);
        const animationDuration = 3000; // 3 seconds
        const updateInterval = 50; // Update every 50ms
        const totalSteps = animationDuration / updateInterval;
        const pointsPerStep = latLngs.length / totalSteps;
        
        // Remove existing animated layer
        if (this.animatedLayer) {
            this.map.removeLayer(this.animatedLayer);
        }
        
        // Hide the full path temporarily
        if (this.pathLayer) {
            this.pathLayer.setStyle({ opacity: 0.2 });
        }
        
        this.isAnimating = true;
        const animateBtn = document.getElementById('animateBtn');
        animateBtn.textContent = '⏸️ Stop';
        animateBtn.disabled = false;
        
        let currentPointIndex = 0;
        let animatedPoints = [];
        
        const animate = () => {
            if (!this.isAnimating) return;
            
            // Calculate how many points to show in this frame
            const targetIndex = Math.min(
                Math.floor(currentPointIndex + pointsPerStep),
                latLngs.length - 1
            );
            
            // Add points up to target index
            while (currentPointIndex <= targetIndex && currentPointIndex < latLngs.length) {
                animatedPoints.push(latLngs[currentPointIndex]);
                currentPointIndex++;
            }
            
            // Remove old animated layer and create new one with more points
            if (this.animatedLayer) {
                this.map.removeLayer(this.animatedLayer);
            }
            
            if (animatedPoints.length > 0) {
                this.animatedLayer = L.polyline(animatedPoints, {
                    color: '#e74c3c',
                    weight: 6,
                    opacity: 1.0,
                    smoothFactor: 1
                }).addTo(this.map);
            }
            
            // Continue animation or finish
            if (currentPointIndex < latLngs.length) {
                setTimeout(animate, updateInterval);
            } else {
                this.finishAnimation();
            }
        };
        
        // Start animation
        animate();
    }
    
    finishAnimation() {
        this.isAnimating = false;
        const animateBtn = document.getElementById('animateBtn');
        animateBtn.textContent = '🎬 Animate Path';
        animateBtn.disabled = false;
        
        // Restore full path opacity
        if (this.pathLayer) {
            this.pathLayer.setStyle({ opacity: 0.8 });
        }
        
        // Remove animated layer
        if (this.animatedLayer) {
            this.map.removeLayer(this.animatedLayer);
            this.animatedLayer = null;
        }
    }
    
    setPathToGrey() {
        if (this.pathLayer) {
            this.pathLayer.setStyle({ opacity: 0.2 });
        }
    }
    
    setPathToRed() {
        if (this.pathLayer) {
            this.pathLayer.setStyle({ opacity: 0.8 });
        }
    }
    
    calculateAndDisplayDistance(validPoints) {
        if (validPoints.length < 2) {
            document.getElementById('totalDistance').textContent = '0 km';
            return;
        }
        
        // Use the shared GPS utility function
        const totalDistanceMeters = calculateTotalDistance(validPoints);
        
        // Format using shared formatting utility with user's preferred altitude unit
        const formattedDistance = formatDistance(totalDistanceMeters, this.altitudeUnit);
        document.getElementById('totalDistance').textContent = formattedDistance;
    }
}

// Initialize the overview when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.bikeTrailOverview = new BikeTrailOverview();
    
    // Set initial zoom level in slider from localStorage
    document.getElementById('zoomLevel').value = window.bikeTrailOverview.currentZoom.toString();
    document.getElementById('zoomLevelValue').textContent = window.bikeTrailOverview.currentZoom;
});