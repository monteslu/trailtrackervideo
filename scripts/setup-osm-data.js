const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class OSMDataSetup {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'osm-data');
    this.regions = {
      'arizona': {
        name: 'Arizona',
        url: 'https://download.geofabrik.de/north-america/us/arizona-latest.osm.pbf',
        size: '~180MB'
      },
      'phoenix': {
        name: 'Phoenix Metro (from Arizona extract)',
        // We'll extract Phoenix area from Arizona data
        bounds: { north: 33.8, south: 33.0, east: -111.5, west: -112.5 }
      }
    };
  }

  async setupDataDirectory() {
    await fs.mkdir(this.dataDir, { recursive: true });
    console.log(`Created data directory: ${this.dataDir}`);
  }

  async downloadRegion(regionKey = 'arizona') {
    const region = this.regions[regionKey];
    if (!region.url) {
      throw new Error(`No download URL for region: ${regionKey}`);
    }

    console.log(`Downloading ${region.name} (${region.size})...`);
    console.log(`URL: ${region.url}`);

    const filename = path.basename(region.url);
    const filepath = path.join(this.dataDir, filename);

    // Check if already exists
    try {
      const stats = await fs.stat(filepath);
      console.log(`File already exists (${Math.round(stats.size / 1024 / 1024)}MB): ${filepath}`);
      return filepath;
    } catch {
      // Doesn't exist, download it
    }

    return new Promise((resolve, reject) => {
      const file = require('fs').createWriteStream(filepath);
      let downloadedBytes = 0;

      https.get(region.url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'], 10);
        
        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
          const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
          process.stdout.write(`\rDownloading: ${mb}MB / ${totalMB}MB (${percent}%)`);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log(`\nDownload complete: ${filepath}`);
          resolve(filepath);
        });

      }).on('error', (err) => {
        fs.unlink(filepath).catch(() => {}); // Clean up partial file
        reject(err);
      });
    });
  }

  async extractPhoenixArea(osmFile) {
    const bounds = this.regions.phoenix.bounds;
    const outputFile = path.join(this.dataDir, 'phoenix-extract.osm.pbf');

    console.log(`Extracting Phoenix area from ${osmFile}...`);
    console.log(`Bounds: ${bounds.south},${bounds.west} to ${bounds.north},${bounds.east}`);

    // Check if osmosis is available
    try {
      await this.runCommand('osmosis', ['--version']);
    } catch {
      console.log(`
⚠️  osmosis not found. To extract Phoenix area, install it:

macOS: brew install osmosis
Ubuntu: apt-get install osmosis
Windows: Download from https://wiki.openstreetmap.org/wiki/Osmosis

For now, using full Arizona data (~180MB instead of ~50MB).
`);
      return osmFile; // Return full file if osmosis not available
    }

    // Extract Phoenix area using osmosis
    const args = [
      '--read-pbf', osmFile,
      '--bounding-box',
      `top=${bounds.north}`,
      `left=${bounds.west}`, 
      `bottom=${bounds.south}`,
      `right=${bounds.east}`,
      '--write-pbf', outputFile
    ];

    try {
      await this.runCommand('osmosis', args);
      console.log(`Phoenix extract created: ${outputFile}`);
      return outputFile;
    } catch (error) {
      console.error('Osmosis extraction failed:', error.message);
      console.log('Using full Arizona data instead.');
      return osmFile;
    }
  }

  async runCommand(command, args) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args);
      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${errorOutput}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  async setupTileGeneration() {
    console.log(`
🗺️  OSM Data Setup Complete!

Next steps to generate tiles:

1. Install tile generation tools:
   npm install -g tileserver-gl-light
   # OR
   pip install TileStache

2. Convert OSM data to tiles:
   # Simple approach - convert to MBTiles format
   tippecanoe -o phoenix.mbtiles --maximum-zoom=16 ${path.join(this.dataDir, '*.osm.pbf')}

3. Serve tiles:
   tileserver-gl-light phoenix.mbtiles --port 8080

4. Update your app to use: http://localhost:8080/styles/basic/{z}/{x}/{y}.png

Alternative: Use the individual tile download script for immediate results.
    `);
  }
}

async function main() {
  const setup = new OSMDataSetup();

  try {
    console.log('🚀 Setting up OSM data for Phoenix area...\n');
    
    await setup.setupDataDirectory();
    
    const osmFile = await setup.downloadRegion('arizona');
    
    const phoenixFile = await setup.extractPhoenixArea(osmFile);
    
    await setup.setupTileGeneration();
    
    console.log('\n✅ Setup complete! Check the instructions above to start generating tiles.');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = OSMDataSetup;