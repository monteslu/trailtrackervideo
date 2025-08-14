/**
 * Altitude and unit conversion utilities
 */

/**
 * Convert meters to feet
 * @param {number} meters - Altitude in meters
 * @returns {number} Altitude in feet (rounded)
 */
export function metersToFeet(meters) {
    return Math.round(meters * 3.28084);
}

/**
 * Get altitude value in the specified unit
 * @param {number} altitudeInMeters - Altitude in meters
 * @param {string} unit - Unit type ('ft' or 'm')
 * @returns {number} Altitude in the specified unit (rounded)
 */
export function getAltitudeInUnit(altitudeInMeters, unit) {
    if (unit === 'ft') {
        return metersToFeet(altitudeInMeters);
    }
    return Math.round(altitudeInMeters);
}

/**
 * Get the unit label for display
 * @param {string} unit - Unit type ('ft' or 'm')
 * @returns {string} Unit label with space prefix (' ft' or ' m')
 */
export function getUnitLabel(unit) {
    return unit === 'ft' ? ' ft' : ' m';
}

/**
 * Convert meters to miles
 * @param {number} meters - Distance in meters
 * @returns {number} Distance in miles
 */
export function metersToMiles(meters) {
    return meters * 0.000621371;
}

/**
 * Convert meters to kilometers
 * @param {number} meters - Distance in meters
 * @returns {number} Distance in kilometers
 */
export function metersToKilometers(meters) {
    return meters / 1000;
}

/**
 * Format distance in appropriate units based on altitude unit preference
 * @param {number} meters - Distance in meters
 * @param {string} unit - Unit preference ('ft' or 'm')
 * @returns {string} Formatted distance string (e.g., "2.5 mi", "4.1 km")
 */
export function formatDistance(meters, unit) {
    if (unit === 'ft') {
        // Use miles for imperial
        const miles = metersToMiles(meters);
        return `${miles.toFixed(1)} mi`;
    } else {
        // Use kilometers for metric
        const km = metersToKilometers(meters);
        return `${km.toFixed(1)} km`;
    }
}

/**
 * Calculate virtual speed from distance and video duration
 * @param {number} distanceMeters - Total distance in meters
 * @param {number} frameCount - Number of frames in video
 * @param {string} unit - Unit preference ('ft' for mph, 'm' for km/h)
 * @returns {string} Formatted speed string (e.g., "15.2 mph", "24.5 km/h")
 */
export function calculateVirtualSpeed(distanceMeters, frameCount, unit) {
    if (frameCount === 0) return unit === 'ft' ? '0.0 mph' : '0.0 km/h';
    
    // Calculate video duration in hours (30fps = 33.33ms per frame)
    const videoDurationMs = frameCount * 33.33;
    const videoDurationHours = videoDurationMs / (1000 * 60 * 60);
    
    if (unit === 'ft') {
        // Imperial: miles per hour
        const miles = metersToMiles(distanceMeters);
        const mph = miles / videoDurationHours;
        return `${mph.toFixed(1)} mph`;
    } else {
        // Metric: kilometers per hour
        const km = metersToKilometers(distanceMeters);
        const kmh = km / videoDurationHours;
        return `${kmh.toFixed(1)} km/h`;
    }
}