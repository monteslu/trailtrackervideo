const exifr = require('exifr');
const fs = require('fs');

async function extractMetadata(imagePath) {
  try {
    // Extract all metadata with comprehensive options to capture TrailTracker custom fields
    const data = await exifr.parse(imagePath, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      iptc: true,
      // Don't filter any fields - get everything to access custom TrailTracker data
      pick: undefined,
      skip: undefined,
      // Parse and revive values
      parseValues: true,
      reviveValues: true,
      // Merge all data into one object for easier access
      mergeOutput: true
    });

    if (!data) return null;

    // Extract data with priority to TrailTracker custom fields (which have more precision)
    return {
      lat: data.Latitude ||          // Custom TrailTracker field (more precise)
           data.GPSLatitude ||       // Standard EXIF field
           data.latitude ||          // GPS parsed field
           (data.gps && data.gps.latitude) || 
           null,
      
      lon: data.Longitude ||         // Custom TrailTracker field (more precise)
           data.GPSLongitude ||      // Standard EXIF field
           data.longitude ||         // GPS parsed field
           (data.gps && data.gps.longitude) || 
           null,
      
      alt: data.Altitude ||          // Custom TrailTracker field
           data.GPSAltitude ||       // Standard EXIF field
           null,
      
      speed: data.Speed ||           // Custom TrailTracker field
             data.GPSSpeed ||        // Standard EXIF field
             null,
      
      compass: data.Compass ||       // Custom TrailTracker field (main compass)
               data.GPSCompass ||    // Custom TrailTracker GPS-specific compass
               data.GPSImgDirection || // Standard EXIF field
               null,
      
      // Additional TrailTracker-specific data
      timestampMs: data.TimestampMs || null,   // High-precision timestamp
      accuracy: data.Accuracy || null,         // GPS accuracy in meters
      gpsTimestamp: data.GPSTimestamp || null, // GPS-specific timestamp
      
      // Speed in different units for convenience
      speedKmh: data.Speed ? convertSpeedToKmh(data.Speed, data.GPSSpeedRef || 'M') : null,
      speedMph: data.Speed ? convertSpeedToMph(data.Speed, data.GPSSpeedRef || 'M') : null
    };
  } catch (error) {
    console.error('Error extracting metadata from', imagePath, error);
    return null;
  }
}

/**
 * Convert GPS speed to km/h based on reference
 */
function convertSpeedToKmh(speed, speedRef) {
  if (!speed || speed === 0) return 0;
  
  switch (speedRef) {
    case 'K': // km/h
      return speed;
    case 'M': // mph  
      return speed * 1.60934;
    case 'N': // knots
      return speed * 1.852;
    default:
      return speed; // assume km/h if unknown
  }
}

/**
 * Convert GPS speed to mph based on reference
 */
function convertSpeedToMph(speed, speedRef) {
  if (!speed || speed === 0) return 0;
  
  switch (speedRef) {
    case 'K': // km/h
      return speed * 0.621371;
    case 'M': // mph
      return speed;
    case 'N': // knots
      return speed * 1.15078;
    default:
      return speed * 0.621371; // assume km/h if unknown
  }
}

function getTimestampFromFilename(filename) {
  const match = filename.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

module.exports = {
  extractMetadata,
  getTimestampFromFilename
};