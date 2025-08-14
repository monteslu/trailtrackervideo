/**
 * UI state management utilities
 */

/**
 * Update progress bar with current progress
 * @param {number} current - Current progress value
 * @param {number} total - Total progress value
 * @param {string} timeEstimate - Optional time estimate string
 */
export function updateProgress(current, total, timeEstimate = null) {
    const percentage = (current / total) * 100;
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
        progressFill.style.width = `${percentage}%`;
    }
    
    let progressText = `${current} / ${total}`;
    if (timeEstimate) {
        progressText += ` - Est. time remaining: ${timeEstimate}`;
    }
    
    const progressTextElement = document.getElementById('progressText');
    if (progressTextElement) {
        progressTextElement.textContent = progressText;
    }
}

/**
 * Set button to loading state with spinner
 * @param {string} buttonId - The button element ID
 * @param {string} loadingText - Text to show while loading
 */
export function setButtonLoading(buttonId, loadingText = 'Loading...') {
    const button = document.getElementById(buttonId);
    if (button) {
        button.innerHTML = `<span class="spinner"></span> ${loadingText}`;
        button.disabled = true;
    }
}

/**
 * Reset button from loading state
 * @param {string} buttonId - The button element ID
 * @param {string} normalText - Normal button text
 */
export function setButtonNormal(buttonId, normalText) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.innerHTML = normalText;
        button.disabled = false;
    }
}

/**
 * Show processing UI elements (hide start, show pause/progress)
 */
export function showProcessingUI() {
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const progressContainer = document.getElementById('progressContainer');
    const fpsInfoContainer = document.getElementById('fpsInfoContainer');
    
    if (startBtn) startBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = 'inline-block';
    if (progressContainer) progressContainer.style.display = 'block';
    if (fpsInfoContainer) fpsInfoContainer.style.display = 'block';
}

/**
 * Hide processing UI elements (show start, hide pause/progress)
 */
export function hideProcessingUI() {
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const progressContainer = document.getElementById('progressContainer');
    const fpsInfoContainer = document.getElementById('fpsInfoContainer');
    
    if (startBtn) startBtn.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (progressContainer) progressContainer.style.display = 'none';
    if (fpsInfoContainer) fpsInfoContainer.style.display = 'none';
}

/**
 * Update pause/resume button text and state
 * @param {boolean} isPaused - Whether processing is currently paused
 */
export function updatePauseButton(isPaused) {
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
        pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    }
}