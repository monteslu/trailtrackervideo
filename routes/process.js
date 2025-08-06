const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const { extractMetadata, getTimestampFromFilename } = require('../utils/xmp');
const https = require('https');
const http = require('http');
const TileCache = require('../utils/tile-cache');
const TileGenerator = require('../utils/tile-generator');

const router = express.Router();
const tileCache = new TileCache();
const tileGenerator = new TileGenerator();

// Rate limiting for OSM requests
const tileRequestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 200; // 200ms between requests (max 5/sec)

// Process tile request queue with rate limiting
async function processQueuedRequest(requestInfo) {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const delay = Math.max(0, MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    
    setTimeout(() => {
      lastRequestTime = Date.now();
      fetchTileFromOSM(requestInfo).then(resolve).catch(reject);
    }, delay);
  });
}

async function fetchTileFromOSM({ z, x, y, tileUrl, cacheDir, cachePath }) {
  return new Promise((resolve, reject) => {
    console.log(`Fetching tile: ${tileUrl} (after rate limiting)`);
    
    // More compliant headers
    const request = https.get(tileUrl, {
      headers: {
        'User-Agent': 'BikeTrailImageProcessor/1.0.0 Contact: biketrails@localhost (Educational/Personal Project)',
        'Accept': 'image/png,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'DNT': '1',
        'Pragma': 'no-cache',
        'Referer': 'https://localhost:3000/'
      },
      timeout: 15000
    }, (osmResponse) => {
      console.log(`OSM Response: ${osmResponse.statusCode} for ${z}/${x}/${y}`);
      
      // Log important headers for debugging
      const headers = osmResponse.headers;
      if (headers['x-ratelimit-remaining'] || headers['retry-after'] || osmResponse.statusCode === 429) {
        console.log('Rate limit info:', {
          'x-ratelimit-remaining': headers['x-ratelimit-remaining'],
          'x-ratelimit-limit': headers['x-ratelimit-limit'], 
          'retry-after': headers['retry-after'],
          'server': headers['server']
        });
      }
      
      if (osmResponse.statusCode === 200) {
        const chunks = [];
        
        osmResponse.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        osmResponse.on('end', async () => {
          try {
            const tileBuffer = Buffer.concat(chunks);
            
            // Save to cache
            await fs.mkdir(cacheDir, { recursive: true });
            await fs.writeFile(cachePath, tileBuffer);
            console.log(`Cached tile: ${cachePath}`);
            
            resolve(tileBuffer);
          } catch (cacheError) {
            console.error('Cache write error:', cacheError);
            resolve(Buffer.concat(chunks));
          }
        });
        
      } else if (osmResponse.statusCode === 429) {
        const retryAfter = headers['retry-after'] || 60;
        console.warn(`RATE LIMITED for tile ${z}/${x}/${y}. Retry after: ${retryAfter} seconds`);
        reject(new Error(`Rate limited. Retry after ${retryAfter} seconds`));
      } else if (osmResponse.statusCode === 403) {
        console.error(`ACCESS BLOCKED for tile ${z}/${x}/${y}. Check usage policy compliance.`);
        reject(new Error('Access blocked by OSM tile server'));
      } else if (osmResponse.statusCode === 404) {
        reject(new Error('Tile not found'));
      } else {
        console.warn(`Unexpected status ${osmResponse.statusCode} for tile ${z}/${x}/${y}`);
        reject(new Error(`HTTP ${osmResponse.statusCode}`));
      }
    });
    
    request.on('error', (error) => {
      console.error('Tile request error:', error);
      reject(error);
    });
    
    request.on('timeout', () => {
      console.warn(`Timeout fetching tile ${z}/${x}/${y}`);
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

router.get('/sessions', async (req, res) => {
  try {
    const sessionDir = config.ROOT_DIR;
    const sessions = await fs.readdir(sessionDir);
    const validSessions = sessions.filter(session => {
      return session !== '.DS_Store';
    });
    res.json(validSessions);
  } catch (error) {
    console.error('Error reading sessions:', error);
    res.status(500).json({ error: 'Failed to read sessions' });
  }
});

router.get('/session/:name', async (req, res) => {
  try {
    const sessionName = req.params.name;
    const sessionPath = path.join(config.ROOT_DIR, sessionName);
    
    const files = await fs.readdir(sessionPath);
    const imageFiles = files.filter(file => 
      file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg')
    );

    console.log(`Found ${imageFiles.length} image files in session ${sessionName}`);

    const images = [];
    let processedCount = 0;
    
    for (const file of imageFiles) {
      const imagePath = path.join(sessionPath, file);
      const timestamp = getTimestampFromFilename(file) || Date.now() + processedCount;
      const metadata = await extractMetadata(imagePath);
      
      processedCount++;
      
      // Include image even if no GPS metadata, but log the issue
      if (!metadata || (!metadata.lat && !metadata.lon)) {
        console.log(`No GPS data for ${file}`);
      }
      
      images.push({
        timestamp,
        filename: file,
        lat: metadata?.lat || null,
        lon: metadata?.lon || null,
        alt: metadata?.alt || null,
        speed: metadata?.speed || null,
        compass: metadata?.compass || null
      });
    }

    images.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Returning ${images.length} images with metadata`);

    res.json({
      count: images.length,
      images
    });
  } catch (error) {
    console.error('Error processing session:', error);
    res.status(500).json({ error: 'Failed to process session' });
  }
});

router.post('/upload/:session/:timestamp', async (req, res) => {
  try {
    const { session, timestamp } = req.params;
    const outputDir = path.join(config.OUTPUT_DIR, session);
    
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `${timestamp}.jpg`);
    
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        await fs.writeFile(outputPath, buffer);
        res.json({ success: true, path: outputPath });
      } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).json({ error: 'Failed to save file' });
      }
    });
  } catch (error) {
    console.error('Error in upload:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});


// Local Tile Generation Route with Caching
router.get('/tiles/:z/:x/:y.png', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    
    // Validate tile coordinates
    const zNum = parseInt(z);
    const xNum = parseInt(x);
    const yNum = parseInt(y);
    
    if (zNum < 0 || zNum > 18 || xNum < 0 || yNum < 0) {
      return res.status(400).send('Invalid tile coordinates');
    }
    
    // Create cache path
    const cacheDir = path.join(__dirname, '..', 'tile-cache', z, x);
    const cachePath = path.join(cacheDir, `${y}.png`);
    
    // Set headers - prevent all browser caching
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': 'Thu, 01 Jan 1970 00:00:00 GMT',
      'Last-Modified': new Date().toUTCString(),
      'ETag': `"${Date.now()}-${Math.random()}"`
    });
    
    // Check cache first
    try {
      const cachedTile = await fs.readFile(cachePath);
      console.log(`Local tile cache HIT: ${z}/${x}/${y}`);
      return res.send(cachedTile);
    } catch (error) {
      console.log(`Local tile cache MISS: ${z}/${x}/${y} - generating...`);
    }
    
    // Try local Docker tile server first
    try {
      const tileBuffer = await fetchFromLocalTileServer(zNum, xNum, yNum);
      
      if (tileBuffer) {
        // Cache the tile
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(cachePath, tileBuffer);
        console.log(`Fetched and cached tile from local Docker server: ${z}/${x}/${y}`);
        
        res.send(tileBuffer);
        return;
      }
    } catch (error) {
      console.log(`Local Docker server failed for ${z}/${x}/${y}, trying alternatives`);
    }

    // Fallback to alternative tile sources
    try {
      const tileBuffer = await fetchFromAlternativeSource(zNum, xNum, yNum);
      
      if (tileBuffer) {
        // Cache the tile
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(cachePath, tileBuffer);
        console.log(`Fetched and cached tile from alternative source: ${z}/${x}/${y}`);
        
        res.send(tileBuffer);
        return;
      }
    } catch (error) {
      console.log(`Alternative sources failed for ${z}/${x}/${y}, generating locally`);
    }

    // Fallback to local generation
    try {
      const routeData = null;
      const tileBuffer = await tileGenerator.generateTile(xNum, yNum, zNum, routeData);
      
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cachePath, tileBuffer);
      console.log(`Generated and cached tile: ${z}/${x}/${y}`);
      
      res.send(tileBuffer);
      
    } catch (error) {
      console.error(`All tile sources failed for ${z}/${x}/${y}:`, error.message);
      res.status(500).send('Tile generation failed');
    }
    
  } catch (error) {
    console.error('Tile route error:', error);
    res.status(500).send('Tile route error');
  }
});

// Fetch from local Docker tile server
async function fetchFromLocalTileServer(z, x, y) {
  const url = `http://localhost:8080/tile/${z}/${x}/${y}.png`;
  
  try {
    const response = await new Promise((resolve, reject) => {
      const request = http.get(url, {
        timeout: 10000
      }, resolve);
      
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });

    if (response.statusCode === 200) {
      const chunks = [];
      
      response.on('data', chunk => chunks.push(chunk));
      
      return new Promise((resolve) => {
        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      });
    }
    
    return null;
  } catch (error) {
    console.log(`Local tile server error: ${error.message}`);
    return null;
  }
}

// Alternative tile sources that don't block access
async function fetchFromAlternativeSource(z, x, y) {
  const sources = [
    // OpenTopoMap (colorful, hiking focused)
    `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
    // CyclOSM (bike-focused, colorful)
    `https://dev.{s}.tile.cyclosm.org/${z}/${x}/${y}.png`.replace('{s}', ['a','b','c'][Math.floor(Math.random()*3)]),
    // WikiMedia tiles (full color OSM)
    `https://maps.wikimedia.org/osm-intl/${z}/${x}/${y}.png`,
    // CartoDB Positron as fallback
    `https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/${z}/${x}/${y}.png`
  ];

  for (const url of sources) {
    try {
      console.log(`Trying: ${url}`);
      
      const response = await new Promise((resolve, reject) => {
        const request = https.get(url, {
          headers: {
            'User-Agent': 'BikeTrailProcessor/1.0 (Educational use)',
            'Accept': 'image/png,image/*,*/*'
          },
          timeout: 5000
        }, resolve);
        
        request.on('error', reject);
        request.on('timeout', () => {
          request.destroy();
          reject(new Error('Request timeout'));
        });
      });

      if (response.statusCode === 200) {
        const chunks = [];
        
        response.on('data', chunk => chunks.push(chunk));
        
        return new Promise((resolve) => {
          response.on('end', () => {
            resolve(Buffer.concat(chunks));
          });
        });
      }
    } catch (error) {
      console.log(`Failed to fetch from ${url}: ${error.message}`);
      continue;
    }
  }
  
  return null;
}

// Cache management routes
router.get('/cache/stats', async (req, res) => {
  try {
    const stats = await tileCache.getCacheStats();
    res.json(stats);
  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});

router.delete('/cache', async (req, res) => {
  try {
    const result = await tileCache.clearCache();
    res.json(result);
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

router.delete('/cache/zoom/:level', async (req, res) => {
  try {
    const zoom = parseInt(req.params.level);
    if (isNaN(zoom) || zoom < 0 || zoom > 18) {
      return res.status(400).json({ error: 'Invalid zoom level' });
    }
    
    const result = await tileCache.clearZoomLevel(zoom);
    res.json(result);
  } catch (error) {
    console.error('Cache zoom clear error:', error);
    res.status(500).json({ error: 'Failed to clear zoom level' });
  }
});

router.post('/cache/preload', async (req, res) => {
  try {
    const { bounds, minZoom = 10, maxZoom = 15 } = req.body;
    
    if (!bounds || !bounds.north || !bounds.south || !bounds.east || !bounds.west) {
      return res.status(400).json({ error: 'Invalid bounds. Required: north, south, east, west' });
    }
    
    // Start preload in background
    tileCache.preloadBounds(bounds, minZoom, maxZoom)
      .then(result => console.log('Preload completed:', result))
      .catch(error => console.error('Preload failed:', error));
    
    res.json({ message: 'Preload started in background' });
  } catch (error) {
    console.error('Preload error:', error);
    res.status(500).json({ error: 'Failed to start preload' });
  }
});

module.exports = router;