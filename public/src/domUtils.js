/**
 * DOM utility functions
 */

/**
 * Get an element by ID with error checking
 * @param {string} id - The element ID
 * @returns {HTMLElement|null} The element or null if not found
 */
export function getElementById(id) {
    return document.getElementById(id);
}

/**
 * Get an element by ID and throw error if not found
 * @param {string} id - The element ID
 * @returns {HTMLElement} The element
 * @throws {Error} If element is not found
 */
export function getRequiredElementById(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Required element with id '${id}' not found`);
    }
    return element;
}

/**
 * Set text content of an element by ID
 * @param {string} id - The element ID
 * @param {string} text - The text to set
 */
export function setElementText(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
    }
}

/**
 * Set innerHTML of an element by ID
 * @param {string} id - The element ID
 * @param {string} html - The HTML to set
 */
export function setElementHtml(id, html) {
    const element = document.getElementById(id);
    if (element) {
        element.innerHTML = html;
    }
}

/**
 * Show an element by ID
 * @param {string} id - The element ID
 */
export function showElement(id) {
    const element = document.getElementById(id);
    if (element) {
        element.style.display = '';
    }
}

/**
 * Hide an element by ID
 * @param {string} id - The element ID
 */
export function hideElement(id) {
    const element = document.getElementById(id);
    if (element) {
        element.style.display = 'none';
    }
}