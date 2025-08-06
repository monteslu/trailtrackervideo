const fs = require('fs').promises;
const path = require('path');
const { createCanvas } = require('canvas');
const { renderTile } = require('mapgl-tile-renderer');

class TileGenerator {
  constructor(osmDataPath = null) {
    this.osmDataPath = osmDataPath || path.join(__dirname, '..', 'osm-data', 'arizona-latest.osm.pbf');
    this.tileSize = 256;
    this.osmCache = new Map(); // Cache parsed OSM features
  }

  // Convert lat/lon to tile coordinates
  deg2tile(lat, lon, zoom) {
    const latRad = lat * Math.PI / 180;
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
    return { x, y };
  }

  // Convert tile coordinates to lat/lon bounds
  tile2deg(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lonDeg = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const latDeg = latRad * 180 / Math.PI;
    return { lat: latDeg, lon: lonDeg };
  }

  // Get tile bounds
  getTileBounds(x, y, zoom) {
    const nw = this.tile2deg(x, y, zoom);
    const se = this.tile2deg(x + 1, y + 1, zoom);
    return {
      north: nw.lat,
      west: nw.lon,
      south: se.lat,
      east: se.lon
    };
  }

  // Simple tile generation using Canvas (fallback when no OSM data)
  async generateSimpleTile(x, y, zoom, routeData = null) {
    const canvas = createCanvas(this.tileSize, this.tileSize);
    const ctx = canvas.getContext('2d');
    
    // Background color
    ctx.fillStyle = '#f2efe9'; // OSM-like background
    ctx.fillRect(0, 0, this.tileSize, this.tileSize);
    
    // Get tile bounds
    const bounds = this.getTileBounds(x, y, zoom);
    
    // Draw more visible grid lines
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    
    // Draw grid every 32 pixels
    for (let i = 0; i <= 8; i++) {
      const pos = i * 32;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, this.tileSize);
      ctx.moveTo(0, pos);
      ctx.lineTo(this.tileSize, pos);
      ctx.stroke();
    }
    
    // Add tile coordinates for debugging
    ctx.fillStyle = '#666666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${zoom}/${x}/${y}`, this.tileSize / 2, this.tileSize / 2 - 10);
    
    // Add bounds for reference
    ctx.font = '10px Arial';
    ctx.fillText(`${bounds.north.toFixed(4)}`, this.tileSize / 2, 15);
    ctx.fillText(`${bounds.south.toFixed(4)}`, this.tileSize / 2, this.tileSize - 5);
    ctx.fillText(`${bounds.west.toFixed(4)}`, 5, this.tileSize / 2);
    ctx.fillText(`${bounds.east.toFixed(4)}`, this.tileSize - 35, this.tileSize / 2);
    
    // Draw route data if provided
    if (routeData && routeData.length > 0) {
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = Math.max(1, zoom / 4);
      ctx.beginPath();
      
      let hasPath = false;
      
      for (let i = 0; i < routeData.length; i++) {
        const point = routeData[i];
        if (!point.lat || !point.lon) continue;
        
        // Check if point is within tile bounds
        if (point.lat >= bounds.south && point.lat <= bounds.north &&
            point.lon >= bounds.west && point.lon <= bounds.east) {
          
          // Convert lat/lon to pixel coordinates within tile
          const pixelX = ((point.lon - bounds.west) / (bounds.east - bounds.west)) * this.tileSize;
          const pixelY = ((bounds.north - point.lat) / (bounds.north - bounds.south)) * this.tileSize;
          
          if (!hasPath) {
            ctx.moveTo(pixelX, pixelY);
            hasPath = true;
          } else {
            ctx.lineTo(pixelX, pixelY);
          }
        }
      }
      
      if (hasPath) {
        ctx.stroke();
      }
    }
    
    // Add attribution
    if (zoom >= 14) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillRect(0, this.tileSize - 16, this.tileSize, 16);
      ctx.fillStyle = '#666';
      ctx.font = '10px Arial';
      ctx.fillText('© Local OSM', 5, this.tileSize - 5);
    }
    
    return canvas.toBuffer('image/png');
  }

  // Generate tile from OSM data
  async generateFromOSMData(x, y, zoom) {
    if (!this.osmDataPath) {
      return null;
    }

    try {
      // Check if OSM file exists
      await fs.access(this.osmDataPath);
    } catch {
      console.log(`OSM data not found at ${this.osmDataPath}, using simple tiles`);
      return null;
    }

    const bounds = this.getTileBounds(x, y, zoom);
    const cacheKey = `${zoom}-${x}-${y}`;
    
    // Check cache first
    if (this.osmCache.has(cacheKey)) {
      return this.renderOSMTile(this.osmCache.get(cacheKey), bounds, zoom);
    }

    // Parse OSM data for this tile area
    const osmFeatures = await this.parseOSMForBounds(bounds);
    this.osmCache.set(cacheKey, osmFeatures);
    
    return this.renderOSMTile(osmFeatures, bounds, zoom);
  }

  // Parse OSM data for specific geographic bounds (simplified version)
  async parseOSMForBounds(bounds) {
    // For now, parsing the full 280MB file for each tile is too slow
    // Let's return a simple feature set and enhance later
    console.log(`Parsing OSM data for bounds: ${bounds.south},${bounds.west} to ${bounds.north},${bounds.east}`);
    
    // Return basic features for now - this will generate simple but functional tiles
    return {
      roads: [
        // Add some sample road data based on tile location
        {
          type: 'way',
          refs: [1, 2],
          tags: { highway: 'primary' }
        }
      ],
      buildings: [],
      water: [],
      parks: []
    };
    
    // TODO: Implement efficient OSM parsing with spatial indexing
    // For full implementation, we'd need:
    // 1. Pre-build a spatial index of the OSM data
    // 2. Query only the relevant features for each tile
    // 3. Cache parsed features more aggressively
  }

  // Render OSM features to a tile
  async renderOSMTile(features, bounds, zoom) {
    const canvas = createCanvas(this.tileSize, this.tileSize);
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#f2efe9'; // OSM beige background
    ctx.fillRect(0, 0, this.tileSize, this.tileSize);
    
    // Draw features in order (background to foreground)
    
    // 1. Parks/Green areas
    ctx.fillStyle = '#c8d7ab';
    features.parks.forEach(feature => {
      this.drawFeature(ctx, feature, bounds, zoom);
    });
    
    // 2. Water
    ctx.fillStyle = '#a5bfdd';
    features.water.forEach(feature => {
      this.drawFeature(ctx, feature, bounds, zoom);
    });
    
    // 3. Buildings  
    ctx.fillStyle = '#d9d0c9';
    ctx.strokeStyle = '#bfb7b0';
    ctx.lineWidth = 0.5;
    features.buildings.forEach(feature => {
      this.drawFeature(ctx, feature, bounds, zoom);
    });
    
    // 4. Roads
    this.drawRoads(ctx, features.roads, bounds, zoom);
    
    // Add attribution
    if (zoom >= 14) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillRect(0, this.tileSize - 16, this.tileSize, 16);
      ctx.fillStyle = '#666';
      ctx.font = '10px Arial';
      ctx.fillText('© OpenStreetMap', 5, this.tileSize - 5);
    }
    
    return canvas.toBuffer('image/png');
  }

  // Draw roads with different styles based on type
  drawRoads(ctx, roads, bounds, zoom) {
    const roadStyles = {
      motorway: { color: '#e892a2', width: 4 },
      trunk: { color: '#f9b29c', width: 3 },
      primary: { color: '#fcd6a4', width: 3 },
      secondary: { color: '#f7fabf', width: 2 },
      tertiary: { color: '#ffffff', width: 2 },
      residential: { color: '#ffffff', width: 1.5 },
      default: { color: '#ffffff', width: 1 }
    };

    // Group roads by type for efficient rendering
    const roadsByType = {};
    roads.forEach(road => {
      const roadType = road.tags.highway || 'default';
      if (!roadsByType[roadType]) {
        roadsByType[roadType] = [];
      }
      roadsByType[roadType].push(road);
    });

    // Draw roads in order of importance
    const roadOrder = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'default'];
    
    roadOrder.forEach(roadType => {
      if (roadsByType[roadType]) {
        const style = roadStyles[roadType] || roadStyles.default;
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width * (zoom / 12); // Scale with zoom
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        roadsByType[roadType].forEach(road => {
          this.drawFeature(ctx, road, bounds, zoom);
        });
      }
    });
  }

  // Draw individual feature (placeholder - would need node coordinate lookup)
  drawFeature(ctx, feature, bounds, zoom) {
    if (feature.type === 'point') {
      // Convert lat/lon to pixel coordinates
      const pixelX = ((feature.coords[0] - bounds.west) / (bounds.east - bounds.west)) * this.tileSize;
      const pixelY = ((bounds.north - feature.coords[1]) / (bounds.north - bounds.south)) * this.tileSize;
      
      // Draw point
      ctx.beginPath();
      ctx.arc(pixelX, pixelY, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (feature.type === 'way') {
      // For ways, we'd need to lookup node coordinates by refs
      // For now, draw a placeholder or skip complex ways
      // This is where we'd connect to a node coordinate cache
    }
  }

  // Main tile generation method
  async generateTile(x, y, zoom, routeData = null) {
    try {
      console.log(`Generating tile ${zoom}/${x}/${y} locally`);
      
      // For now, skip OSM parsing and just generate simple tiles
      // This ensures we never fall back to external OSM
      const tileBuffer = await this.generateSimpleTile(x, y, zoom, routeData);
      
      return tileBuffer;
    } catch (error) {
      console.error(`Error generating tile ${zoom}/${x}/${y}:`, error);
      // Return a simple error tile
      return this.generateErrorTile();
    }
  }

  async generateErrorTile() {
    const canvas = createCanvas(this.tileSize, this.tileSize);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#ffebee';
    ctx.fillRect(0, 0, this.tileSize, this.tileSize);
    
    ctx.fillStyle = '#c62828';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Tile Error', this.tileSize / 2, this.tileSize / 2);
    
    return canvas.toBuffer('image/png');
  }

  // Load route data from your sessions
  async loadRouteData(sessionDir) {
    try {
      const sessionPath = path.join(sessionDir);
      const files = await fs.readdir(sessionPath);
      const routeData = [];
      
      // This would integrate with your existing session loading logic
      // For now, return empty array
      return routeData;
    } catch (error) {
      console.error('Failed to load route data:', error);
      return [];
    }
  }
}

module.exports = TileGenerator;