#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

/**
 * Fast XMP metadata embedding for GoPro frame JPEGs
 * Usage: node scripts/add_gp_xmp.js <session_name>
 */

if (process.argv.length < 3) {
    console.log('Usage: node scripts/add_gp_xmp.js <session_name>');
    console.log('Example: node scripts/add_gp_xmp.js TrailSync_Mesa_17-08-2025_20_19_20250817_202517');
    process.exit(1);
}

const SESSION_NAME = process.argv[2];
const GOPRO_DIR = `gopro/${SESSION_NAME}`;
const SESSIONS_DIR = `sessions/${SESSION_NAME}`;
const NUM_WORKERS = 4; // Parallel processing workers

// XMP template for TrailSync metadata
function createXMPPacket(metadata) {
    const jpg_timestamp = metadata.jpg_timestamp;
    const entry = metadata.closest_entry;
    
    // Convert timestamp to ISO format
    const date = new Date(jpg_timestamp);
    const iso_timestamp = date.toISOString().replace('Z', '000Z');
    
    // GPS coordinate conversions
    let lat_dms = '', lon_dms = '';
    if (entry.gps?.latitude) {
        const lat = entry.gps.latitude;
        const deg = Math.floor(Math.abs(lat));
        const min = Math.floor((Math.abs(lat) - deg) * 60);
        const sec = ((Math.abs(lat) - deg) * 60 - min) * 60;
        lat_dms = `${deg} deg ${min}' ${sec.toFixed(2)}" N`;
    }
    
    if (entry.gps?.longitude) {
        const lon = entry.gps.longitude;
        const deg = Math.floor(Math.abs(lon));
        const min = Math.floor((Math.abs(lon) - deg) * 60);
        const sec = ((Math.abs(lon) - deg) * 60 - min) * 60;
        const ref = lon < 0 ? 'W' : 'E';
        lon_dms = `${deg} deg ${min}' ${sec.toFixed(2)}" ${ref}`;
    }
    
    // Speed conversion (m/s to mph)
    const speed_mph = entry.gps?.speed ? (entry.gps.speed * 2.23694).toFixed(6) : '';
    
    // GPS timestamp
    let gps_timestamp_iso = '';
    if (entry.gps?.timestamp) {
        const gps_date = new Date(entry.gps.timestamp);
        gps_timestamp_iso = gps_date.toISOString().replace('Z', '000Z');
    }
    
    const xmp = `<?xpacket begin="ï»¿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
        xmlns:exif="http://ns.adobe.com/exif/1.0/"
        xmlns:tt="http://trailsync.com/ns/1.0/"
        xmp:CreateDate="${iso_timestamp}"
        xmp:CreatorTool="TrailSync"
        xmp:ModifyDate="${iso_timestamp}"
        xmp:MetadataDate="${iso_timestamp}"
        tiff:Make="Google"
        tiff:Model="Pixel 7 Pro"
        tiff:Software="TrailSync Android"${entry.gps?.latitude ? `
        exif:GPSLatitude="${lat_dms}"` : ''}${entry.gps?.longitude ? `
        exif:GPSLongitude="${lon_dms}"` : ''}${entry.gps?.altitude ? `
        exif:GPSAltitude="${entry.gps.altitude} m"
        exif:GPSAltitudeRef="Above Sea Level"` : ''}${entry.gps?.speed ? `
        exif:GPSSpeed="${speed_mph}"
        exif:GPSSpeedRef="mph"` : ''}${entry.gps?.direction ? `
        exif:GPSImgDirection="${entry.gps.direction}"
        exif:GPSImgDirectionRef="Magnetic North"` : ''}${gps_timestamp_iso ? `
        exif:GPSDateTime="${gps_timestamp_iso}"` : ''}${entry.gps?.accuracy ? `
        exif:GPSDOP="${entry.gps.accuracy}"` : ''}
        tt:TimestampMs="${jpg_timestamp}"${entry.gps?.direction ? `
        tt:Compass="${entry.gps.direction}"` : ''}${entry.gps?.latitude ? `
        tt:Latitude="${entry.gps.latitude}"` : ''}${entry.gps?.longitude ? `
        tt:Longitude="${entry.gps.longitude}"` : ''}${entry.gps?.altitude ? `
        tt:Altitude="${entry.gps.altitude}"` : ''}${entry.gps?.speed ? `
        tt:Speed="${speed_mph}"` : ''}${entry.gps?.accuracy ? `
        tt:Accuracy="${entry.gps.accuracy}"` : ''}${entry.gps?.direction ? `
        tt:GPSCompass="${entry.gps.direction}"` : ''}${entry.gps?.timestamp ? `
        tt:GPSTimestamp="${entry.gps.timestamp}"` : ''}${entry.weather?.temperature ? `
        tt:WeatherTemperature="${entry.weather.temperature}"` : ''}${entry.weather?.temperatureUnit ? `
        tt:WeatherTemperatureUnit="${entry.weather.temperatureUnit}"` : ''}${entry.weather?.windSpeed ? `
        tt:WeatherWindSpeed="${entry.weather.windSpeed}"` : ''}${entry.weather?.windSpeedUnit ? `
        tt:WeatherWindSpeedUnit="${entry.weather.windSpeedUnit}"` : ''}${entry.weather?.windDirection ? `
        tt:WeatherWindDirection="${entry.weather.windDirection}"` : ''}${entry.weather?.weatherCode !== undefined ? `
        tt:WeatherCode="${entry.weather.weatherCode}"` : ''}${entry.weather?.fetchedAt ? `
        tt:WeatherFetchedAtUnix="${entry.weather.fetchedAt}"` : ''}${entry.location?.road ? `
        tt:LocationRoad="${escapeXML(entry.location.road)}"` : ''}${entry.location?.neighborhood ? `
        tt:LocationNeighborhood="${escapeXML(entry.location.neighborhood)}"` : ''}${entry.location?.city ? `
        tt:LocationCity="${escapeXML(entry.location.city)}"` : ''}${entry.location?.county ? `
        tt:LocationCounty="${escapeXML(entry.location.county)}"` : ''}${entry.location?.state ? `
        tt:LocationState="${escapeXML(entry.location.state)}"` : ''}${entry.location?.postcode ? `
        tt:LocationPostcode="${entry.location.postcode}"` : ''}${entry.location?.country ? `
        tt:LocationCountry="${escapeXML(entry.location.country)}"` : ''}${entry.location?.fetchedAt ? `
        tt:LocationFetchedAt="${entry.location.fetchedAt}"` : ''}${entry.location?.updateReason ? `
        tt:LocationUpdateReason="${entry.location.updateReason}"` : ''}${entry.goPro?.filename ? `
        tt:GoProFilename="${escapeXML(entry.goPro.filename)}"` : ''}${entry.goPro?.syncOffset !== undefined ? `
        tt:GoProSyncOffset="${entry.goPro.syncOffset}"` : ''}${entry.goPro?.battery !== undefined ? `
        tt:GoProBattery="${entry.goPro.battery}"` : ''}${entry.goPro?.isRecording !== undefined ? `
        tt:GoProRecording="${entry.goPro.isRecording}"` : ''}${entry.goPro?.timestamp ? `
        tt:GoProTimestamp="${entry.goPro.timestamp}"` : ''}${entry.accelerometer?.x !== undefined ? `
        tt:AccelX="${entry.accelerometer.x}"` : ''}${entry.accelerometer?.y !== undefined ? `
        tt:AccelY="${entry.accelerometer.y}"` : ''}${entry.accelerometer?.z !== undefined ? `
        tt:AccelZ="${entry.accelerometer.z}"` : ''}${entry.accelerometer?.timestamp ? `
        tt:AccelTimestamp="${entry.accelerometer.timestamp}"` : ''}/>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

    return xmp;
}

function escapeXML(str) {
    return str.replace(/[<>&"']/g, (char) => {
        switch (char) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '"': return '&quot;';
            case "'": return '&apos;';
            default: return char;
        }
    });
}

// JPEG segment markers
const JPEG_SOI = 0xFFD8;  // Start of Image
const JPEG_APP1 = 0xFFE1; // Application segment 1 (EXIF/XMP)
const JPEG_SOS = 0xFFDA;  // Start of Scan

async function embedXMPInJPEG(jpegPath, xmpData) {
    try {
        const jpegBuffer = await fs.readFile(jpegPath);
        
        if (jpegBuffer.length < 4 || jpegBuffer.readUInt16BE(0) !== JPEG_SOI) {
            throw new Error('Not a valid JPEG file');
        }
        
        let offset = 2; // Skip SOI marker
        const segments = [];
        let xmpInserted = false;
        
        // Parse existing segments
        while (offset < jpegBuffer.length - 1) {
            const marker = jpegBuffer.readUInt16BE(offset);
            
            if ((marker & 0xFF00) !== 0xFF00) {
                break; // Invalid marker
            }
            
            if (marker === JPEG_SOS) {
                // Start of scan - insert XMP before this if not already inserted
                if (!xmpInserted) {
                    const xmpBuffer = Buffer.from(xmpData, 'utf8');
                    const xmpHeader = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'utf8');
                    const segmentData = Buffer.concat([xmpHeader, xmpBuffer]);
                    const segmentLength = segmentData.length + 2;
                    
                    const xmpSegment = Buffer.alloc(4 + segmentData.length);
                    xmpSegment.writeUInt16BE(JPEG_APP1, 0);
                    xmpSegment.writeUInt16BE(segmentLength, 2);
                    segmentData.copy(xmpSegment, 4);
                    
                    segments.push(xmpSegment);
                    xmpInserted = true;
                }
                
                // Add remaining data (SOS marker + image data)
                segments.push(jpegBuffer.subarray(offset));
                break;
            }
            
            const segmentLength = jpegBuffer.readUInt16BE(offset + 2);
            const segmentEnd = offset + 2 + segmentLength;
            
            // Skip existing XMP segments
            const segmentData = jpegBuffer.subarray(offset + 4, segmentEnd);
            if (segmentData.indexOf('http://ns.adobe.com/xap/1.0/') === -1) {
                segments.push(jpegBuffer.subarray(offset, segmentEnd));
            }
            
            offset = segmentEnd;
        }
        
        // Combine all segments
        const resultBuffer = Buffer.concat([
            Buffer.from([0xFF, 0xD8]), // SOI marker
            ...segments
        ]);
        
        await fs.writeFile(jpegPath, resultBuffer);
        return true;
    } catch (error) {
        console.error(`Error processing ${jpegPath}:`, error.message);
        return false;
    }
}

// Worker thread function
async function processJPEGBatch(jpegPaths, metadataLookup, workerId) {
    const results = { processed: 0, updated: 0 };
    
    for (let i = 0; i < jpegPaths.length; i++) {
        const jpegPath = jpegPaths[i];
        
        try {
            const timestamp = parseInt(path.basename(jpegPath, '.jpg'));
            
            // Find closest metadata entry
            let closestEntry = null;
            let minDiff = Infinity;
            
            for (const entry of metadataLookup) {
                if (!entry.timestamp) continue;
                
                const diff = Math.abs(timestamp - entry.timestamp);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestEntry = entry;
                }
            }
            
            if (closestEntry) {
                const xmpData = createXMPPacket({
                    jpg_timestamp: timestamp,
                    closest_entry: closestEntry
                });
                
                const success = await embedXMPInJPEG(jpegPath, xmpData);
                if (success) {
                    results.updated++;
                }
            }
            
            results.processed++;
            
            // Send progress updates every 10 files for more frequent feedback
            if (results.processed % 10 === 0 || i === jpegPaths.length - 1) {
                if (!isMainThread && parentPort) {
                    parentPort.postMessage({
                        type: 'progress',
                        workerId,
                        processed: results.processed,
                        updated: results.updated,
                        total: jpegPaths.length
                    });
                }
            }
        } catch (error) {
            console.error(`Error processing ${jpegPath}:`, error.message);
        }
    }
    
    return results;
}

// Main execution (if not in worker thread)
if (isMainThread) {
    async function main() {
        try {
            console.log(`Processing session: ${SESSION_NAME}`);
            
            // Check directories
            try {
                await fs.access(GOPRO_DIR);
                await fs.access(SESSIONS_DIR);
            } catch {
                console.error(`Error: Required directories not found`);
                console.error(`GoPro dir: ${GOPRO_DIR}`);
                console.error(`Sessions dir: ${SESSIONS_DIR}`);
                process.exit(1);
            }
            
            // Find JSON file
            const goProFiles = await fs.readdir(GOPRO_DIR);
            const jsonFile = goProFiles.find(f => f.endsWith('.json'));
            
            if (!jsonFile) {
                console.error(`No JSON file found in ${GOPRO_DIR}`);
                process.exit(1);
            }
            
            console.log(`Reading metadata from: ${jsonFile}`);
            
            // Load JSON metadata
            const jsonPath = path.join(GOPRO_DIR, jsonFile);
            const jsonData = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
            
            if (!jsonData.metadata || !Array.isArray(jsonData.metadata)) {
                console.error('Invalid JSON format: missing metadata array');
                process.exit(1);
            }
            
            console.log(`Found ${jsonData.metadata.length} metadata entries`);
            
            // Get JPG files
            const sessionFiles = await fs.readdir(SESSIONS_DIR);
            const jpegFiles = sessionFiles
                .filter(f => f.endsWith('.jpg'))
                .map(f => path.join(SESSIONS_DIR, f));
            
            console.log(`Found ${jpegFiles.length} JPEG files`);
            
            // Process files with parallel workers
            const startTime = Date.now();
            const batchSize = Math.ceil(jpegFiles.length / NUM_WORKERS);
            const workers = [];
            const workerProgress = new Array(NUM_WORKERS).fill().map(() => ({ processed: 0, updated: 0, total: 0 }));
            
            console.log(`Processing with ${NUM_WORKERS} parallel workers...`);
            console.log('Starting workers...');
            
            for (let i = 0; i < NUM_WORKERS; i++) {
                const startIdx = i * batchSize;
                const endIdx = Math.min(startIdx + batchSize, jpegFiles.length);
                const batch = jpegFiles.slice(startIdx, endIdx);
                
                if (batch.length > 0) {
                    workerProgress[i].total = batch.length;
                    console.log(`Worker ${i}: processing ${batch.length} files`);
                    
                    const worker = new Worker(__filename, {
                        workerData: {
                            jpegPaths: batch,
                            metadataLookup: jsonData.metadata,
                            workerId: i
                        }
                    });
                    
                    workers.push(new Promise((resolve, reject) => {
                        worker.on('message', (message) => {
                            if (message.type === 'progress') {
                                workerProgress[message.workerId] = {
                                    processed: message.processed,
                                    updated: message.updated,
                                    total: message.total
                                };
                            } else {
                                // Final result
                                resolve(message);
                            }
                        });
                        worker.on('error', reject);
                        worker.on('exit', (code) => {
                            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
                        });
                    }));
                }
            }
            
            // Show real-time progress
            let lastUpdate = 0;
            const progressInterval = setInterval(() => {
                const totals = workerProgress.reduce((acc, worker) => ({
                    processed: acc.processed + worker.processed,
                    updated: acc.updated + worker.updated,
                    total: acc.total + worker.total
                }), { processed: 0, updated: 0, total: 0 });
                
                // Only update if there's actual progress
                if (totals.processed > lastUpdate) {
                    const elapsed = (Date.now() - startTime) / 1000;
                    const percentage = totals.total > 0 ? ((totals.processed / totals.total) * 100).toFixed(1) : '0.0';
                    const rate = elapsed > 0 ? totals.processed / elapsed : 0;
                    const eta = totals.total > totals.processed && rate > 0 ? (totals.total - totals.processed) / rate : 0;
                    
                    let etaFormatted = '';
                    if (eta > 60) {
                        etaFormatted = ` - ETA: ${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`;
                    } else if (eta > 0) {
                        etaFormatted = ` - ETA: ${Math.floor(eta)}s`;
                    }
                    
                    process.stdout.write(`\rProgress: ${totals.processed}/${totals.total} files (${percentage}%) - ${totals.updated} updated - ${rate.toFixed(1)}/s${etaFormatted}`);
                    lastUpdate = totals.processed;
                }
            }, 250);
            
            const results = await Promise.all(workers);
            clearInterval(progressInterval);
            process.stdout.write('\n');
            
            // Combine results
            const totalResults = results.reduce((acc, result) => ({
                processed: acc.processed + result.processed,
                updated: acc.updated + result.updated
            }), { processed: 0, updated: 0 });
            
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = totalResults.processed / elapsed;
            
            console.log('\nXMP embedding completed!');
            console.log(`Processed: ${totalResults.processed} files`);
            console.log(`Updated: ${totalResults.updated} files`);
            console.log(`Success rate: ${((totalResults.updated / totalResults.processed) * 100).toFixed(1)}%`);
            console.log(`Total time: ${elapsed.toFixed(1)}s`);
            console.log(`Rate: ${rate.toFixed(1)} files/second`);
            
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    }
    
    main();
} else {
    // Worker thread execution
    (async () => {
        const { jpegPaths, metadataLookup, workerId } = workerData;
        const result = await processJPEGBatch(jpegPaths, metadataLookup, workerId);
        parentPort.postMessage(result);
    })();
}