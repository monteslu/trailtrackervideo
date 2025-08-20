#!/usr/bin/env node

/**
 * Fast GPMF GPS parser for GoPro videos
 * Usage: node parse_gpmf.js <binary_file> [video_start_timestamp] [video_duration]
 */

const fs = require('fs');

if (process.argv.length < 3) {
    console.error('Usage: node parse_gpmf.js <binary_file> [video_start_timestamp] [video_duration]');
    process.exit(1);
}

const binaryFile = process.argv[2];
const videoStartTimestamp = parseInt(process.argv[3]) || 0; // Unix timestamp when video started
const videoDuration = parseFloat(process.argv[4]) || 85.285; // Video duration in seconds
const buffer = fs.readFileSync(binaryFile);

const gpsData = [];
let offset = 0;

// Look for GPS9 markers which contain the actual coordinate data
while (offset < buffer.length - 8) {
    // Look for "GPS9" marker (0x47505339)
    if (buffer.readUInt32BE(offset) === 0x47505339) {
        // Found GPS9 marker, GPS data follows after size info
        try {
            // Skip GPS9 header and size bytes to get to actual coordinate data
            let dataOffset = offset + 8; // Skip "GPS9" + typical size bytes
            
            if (dataOffset + 36 < buffer.length) { // 9 floats * 4 bytes each
                // Read 9 GPS values as signed 32-bit integers (GPMF uses scaled integers)
                const latRaw = buffer.readInt32BE(dataOffset);
                const lonRaw = buffer.readInt32BE(dataOffset + 4);
                const altRaw = buffer.readInt32BE(dataOffset + 8);
                const speed2dRaw = buffer.readInt32BE(dataOffset + 12);
                const speed3dRaw = buffer.readInt32BE(dataOffset + 16);
                
                // Convert from GPMF scaled integers to decimal degrees
                // Typical GPMF scaling: divide by 10000000 for lat/lon
                const lat = latRaw / 10000000;
                const lon = lonRaw / 10000000;
                const alt = altRaw / 1000; // altitude usually in mm, convert to meters
                const speed2d = speed2dRaw / 1000; // speed in mm/s, convert to m/s
                
                // Basic sanity check for valid GPS coordinates
                if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && lat !== 0 && lon !== 0) {
                    gpsData.push({
                        lat: parseFloat(lat.toFixed(8)),
                        lon: parseFloat(lon.toFixed(8)),
                        alt: parseFloat(alt.toFixed(2)),
                        speed: parseFloat(speed2d.toFixed(3)),
                        offset: offset.toString(16),
                        byteOffset: offset
                    });
                }
            }
        } catch (e) {
            // Skip if can't read data
        }
    }
    offset++;
}

// Calculate timestamps for each GPS sample
if (gpsData.length > 0 && videoStartTimestamp > 0) {
    // GPS samples are evenly distributed over video duration
    const timePerSample = videoDuration / gpsData.length;
    
    gpsData.forEach((sample, index) => {
        // Calculate video time offset for this sample
        const videoTimeOffset = index * timePerSample;
        
        // Convert to millisecond timestamp that matches JPEG filenames
        const timestampMs = (videoStartTimestamp * 1000) + (videoTimeOffset * 1000);
        
        sample.timestamp = Math.round(timestampMs);
        sample.videoTimeOffset = parseFloat(videoTimeOffset.toFixed(3));
    });
}

// Output JSON
console.log(JSON.stringify({
    gps_samples: gpsData.length,
    video_start_timestamp: videoStartTimestamp,
    video_duration: videoDuration,
    coordinates: gpsData, // Return all samples with timestamps
    parsing_time: Date.now()
}, null, 2));