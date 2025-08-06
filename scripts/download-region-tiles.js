const https = require('https');
const fs = require('fs').promises;
const path = require('path');

class RegionTileDownloader {
  constructor() {
    this.cacheDir = path.join(__dirname, '..', 'tile-cache');
    this.delay = 500; // 500ms between requests to be respectful
    this.lastRequestTime = 0;
    this.userAgent = 'BikeTrailTileDownloader/1.0.0 (Educational/Personal Project - Batch Download)';
  }

  // Phoenix metro area bounds (adjust for your region)
  getPhoenixBounds() {
    return {
      north: 33.7,
      south: 33.2,
      east: -111.6,
      west: -112.4,
      name: 'Phoenix Metro'
    };
  }

  deg2tile(lat, lon, zoom) {
    const latRad = lat * Math.PI / 180;
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
    return { x, y };
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

  async downloadTile(z, x, y) {
    const cacheDir = path.join(this.cacheDir, z.toString(), x.toString());
    const cachePath = path.join(cacheDir, `${y}.png`);
    
    // Check if already exists
    try {
      await fs.access(cachePath);
      return { cached: true };
    } catch {
      // Doesn't exist, download it
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.delay) {
      await new Promise(resolve => setTimeout(resolve, this.delay - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();

    const subdomain = ['a', 'b', 'c'][Math.floor(Math.random() * 3)];
    const tileUrl = `https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`;

    return new Promise((resolve, reject) => {
      const request = https.get(tileUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'image/png,image/*,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        timeout: 10000
      }, async (response) => {
        if (response.statusCode === 200) {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', async () => {
            try {
              const buffer = Buffer.concat(chunks);
              await fs.mkdir(cacheDir, { recursive: true });
              await fs.writeFile(cachePath, buffer);
              resolve({ downloaded: true, size: buffer.length });
            } catch (error) {
              reject(error);
            }
          });
        } else if (response.statusCode === 403) {
          reject(new Error('Access blocked by OSM'));
        } else if (response.statusCode === 429) {
          reject(new Error('Rate limited'));
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      });

      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  async downloadRegion(bounds, minZoom = 10, maxZoom = 15) {
    console.log(`Downloading tiles for ${bounds.name}`);
    console.log(`Bounds: ${bounds.south}, ${bounds.west} to ${bounds.north}, ${bounds.east}`);
    console.log(`Zoom levels: ${minZoom} to ${maxZoom}`);

    const tiles = this.getTilesInBounds(bounds, minZoom, maxZoom);
    console.log(`Total tiles to download: ${tiles.length}`);

    let downloaded = 0;
    let cached = 0;
    let failed = 0;
    let totalSize = 0;

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      
      try {
        const result = await this.downloadTile(tile.z, tile.x, tile.y);
        
        if (result.cached) {
          cached++;
        } else if (result.downloaded) {
          downloaded++;
          totalSize += result.size;
        }

        if ((i + 1) % 10 === 0) {
          console.log(`Progress: ${i + 1}/${tiles.length} (${downloaded} downloaded, ${cached} cached, ${failed} failed)`);
        }

      } catch (error) {
        failed++;
        console.error(`Failed to download tile ${tile.z}/${tile.x}/${tile.y}: ${error.message}`);
        
        if (error.message.includes('Access blocked')) {
          console.error('OSM access blocked. Try again later or use a different approach.');
          break;
        }
      }
    }

    console.log('\n=== Download Complete ===');
    console.log(`Downloaded: ${downloaded} tiles (${this.formatBytes(totalSize)})`);
    console.log(`Already cached: ${cached} tiles`);
    console.log(`Failed: ${failed} tiles`);
    console.log(`Total: ${tiles.length} tiles`);

    return { downloaded, cached, failed, total: tiles.length, totalSize };
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async downloadFromBikeRoutes(sessionDir) {
    // TODO: Read GPS data from your bike sessions and calculate bounds
    console.log('Feature not implemented yet. Use downloadRegion() with manual bounds.');
  }
}

// Usage
async function main() {
  const downloader = new RegionTileDownloader();
  
  // Download Phoenix metro area (adjust coordinates for your region)
  const bounds = downloader.getPhoenixBounds();
  
  try {
    await downloader.downloadRegion(bounds, 10, 15);
  } catch (error) {
    console.error('Download failed:', error);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = RegionTileDownloader;