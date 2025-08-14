/**
 * Time utility functions
 */

/**
 * Format milliseconds into a human-readable time estimate
 * @param {number} milliseconds - Time in milliseconds
 * @returns {string} Formatted time string (e.g., "2h 15m", "45m 30s", "23s")
 */
export function formatTimeEstimate(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Format video duration from frame count (assuming 30fps = 33.33ms per frame)
 * @param {number} frameCount - Number of frames
 * @returns {string} Formatted duration string (e.g., "1m 30s", "45s")
 */
export function formatVideoDuration(frameCount) {
    const totalMs = frameCount * 33.33; // 30fps = 33.33ms per frame
    const totalSeconds = Math.floor(totalMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}