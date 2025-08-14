/**
 * localStorage utility functions
 */

/**
 * Get a value from localStorage with a default fallback
 * @param {string} key - The localStorage key
 * @param {string} defaultValue - Default value if key doesn't exist
 * @returns {string} The stored value or default
 */
export function getStorageItem(key, defaultValue) {
    return localStorage.getItem(key) || defaultValue;
}

/**
 * Get a numeric value from localStorage with a default fallback
 * @param {string} key - The localStorage key
 * @param {number} defaultValue - Default numeric value if key doesn't exist
 * @returns {number} The stored value as integer or default
 */
export function getStorageInt(key, defaultValue) {
    const value = localStorage.getItem(key);
    return value ? parseInt(value) : defaultValue;
}

/**
 * Get a float value from localStorage with a default fallback
 * @param {string} key - The localStorage key
 * @param {number} defaultValue - Default float value if key doesn't exist
 * @returns {number} The stored value as float or default
 */
export function getStorageFloat(key, defaultValue) {
    const value = localStorage.getItem(key);
    return value ? parseFloat(value) : defaultValue;
}

/**
 * Set a value in localStorage
 * @param {string} key - The localStorage key
 * @param {string|number} value - The value to store
 */
export function setStorageItem(key, value) {
    localStorage.setItem(key, value.toString());
}