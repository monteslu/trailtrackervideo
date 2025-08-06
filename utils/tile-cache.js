const fs = require('fs').promises;
const path = require('path');

class TileCache {
  constructor(cacheDir = path.join(__dirname, '..', 'tile-cache')) {
    this.cacheDir = cacheDir;
  }

  async getCacheStats() {
    try {
      const stats = {
        totalTiles: 0,
        totalSize: 0,
        zoomLevels: {}
      };

      const zoomDirs = await fs.readdir(this.cacheDir).catch(() => []);
      
      for (const zoomDir of zoomDirs) {
        if (isNaN(parseInt(zoomDir))) continue;
        
        const zoomPath = path.join(this.cacheDir, zoomDir);
        const xDirs = await fs.readdir(zoomPath).catch(() => []);
        
        let zoomTiles = 0;
        let zoomSize = 0;
        
        for (const xDir of xDirs) {
          const xPath = path.join(zoomPath, xDir);
          const tiles = await fs.readdir(xPath).catch(() => []);
          
          for (const tile of tiles) {
            if (!tile.endsWith('.png')) continue;
            
            const tilePath = path.join(xPath, tile);
            const stat = await fs.stat(tilePath);
            zoomTiles++;
            zoomSize += stat.size;
          }
        }
        
        stats.zoomLevels[zoomDir] = {
          tiles: zoomTiles,
          size: zoomSize,
          sizeHuman: this.humanFileSize(zoomSize)
        };
        
        stats.totalTiles += zoomTiles;
        stats.totalSize += zoomSize;
      }
      
      stats.totalSizeHuman = this.humanFileSize(stats.totalSize);
      return stats;
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return { error: error.message };
    }
  }

  async clearCache() {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      await fs.mkdir(this.cacheDir, { recursive: true });
      return { success: true, message: 'Cache cleared successfully' };
    } catch (error) {
      console.error('Error clearing cache:', error);
      return { success: false, error: error.message };
    }
  }

  async clearZoomLevel(zoom) {
    try {
      const zoomPath = path.join(this.cacheDir, zoom.toString());
      await fs.rm(zoomPath, { recursive: true, force: true });
      return { success: true, message: `Zoom level ${zoom} cleared successfully` };
    } catch (error) {
      console.error(`Error clearing zoom level ${zoom}:`, error);
      return { success: false, error: error.message };
    }
  }

  humanFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async preloadBounds(bounds, minZoom = 10, maxZoom = 15) {
    const tiles = this.getTilesInBounds(bounds, minZoom, maxZoom);
    console.log(`Preloading ${tiles.length} tiles for bounds`, bounds);
    
    let loaded = 0;
    let failed = 0;
    
    // Add delay between preload requests to be respectful to OSM
    const PRELOAD_DELAY = 300; // 300ms between preload requests
    
    for (const tile of tiles) {
      try {
        const response = await fetch(`http://localhost:3000/api/tiles/${tile.z}/${tile.x}/${tile.y}.png`);
        if (response.ok) {
          loaded++;
        } else {
          failed++;
          if (response.status === 403) {
            console.warn(`Access blocked during preload. Stopping preload operation.`);
            break;
          }
        }
      } catch (error) {
        failed++;
        console.error(`Failed to preload tile ${tile.z}/${tile.x}/${tile.y}:`, error.message);
      }
      
      if ((loaded + failed) % 5 === 0) {
        console.log(`Preload progress: ${loaded + failed}/${tiles.length} (${loaded} loaded, ${failed} failed)`);
      }
      
      // Add delay between requests during preload
      if (loaded + failed < tiles.length) {
        await new Promise(resolve => setTimeout(resolve, PRELOAD_DELAY));
      }
    }
    
    console.log(`Preload completed: ${loaded} loaded, ${failed} failed, ${tiles.length} total`);
    return { loaded, failed, total: tiles.length };
  }

  getTilesInBounds(bounds, minZoom, maxZoom) {
    const tiles = [];
    
    for (let z = minZoom; z <= maxZoom; z++) {
      const nwTile = this.deg2tile(bounds.north, bounds.west, z);
      const seTile = this.deg2tile(bounds.south, bounds.east, z);
      
      for (let x = Math.min(nwTile.x, seTile.x); x <= Math.max(nwTile.x, seTile.x); x++) {
        for (let y = Math.min(nwTile.y, seTile.y); y <= Math.max(nwTile.y, seTile.y); y++) {
          tiles.push({ x, y, z });
        }
      }
    }
    
    return tiles;
  }

  deg2tile(lat, lon, zoom) {
    const latRad = lat * Math.PI / 180;
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
    return { x, y };
  }
}

module.exports = TileCache;