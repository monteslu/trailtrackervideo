/**
 * Shared Cover Effects Module
 * Provides consistent rendering of blur, infill, blackout, and other privacy effects
 * Used by both main processor and detection editor
 */

export class CoverEffects {
    constructor() {
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
    }

    /**
     * Apply cover effect to detection regions on a canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context to draw on
     * @param {HTMLImageElement} baseImage - Original image
     * @param {Array} detections - Array of detection objects with cover property
     */
    applyCoverEffects(ctx, baseImage, detections) {
        if (!detections || !detections.length) return;

        // Process each detection
        detections.forEach(detection => {
            if (!detection.cover || detection.cover === 'none') return;

            const { x, y, width, height, cover } = detection;

            // Ensure coordinates are within image bounds
            const clampedX = Math.max(0, Math.min(x, baseImage.width - 1));
            const clampedY = Math.max(0, Math.min(y, baseImage.height - 1));
            const clampedWidth = Math.max(1, Math.min(width, baseImage.width - clampedX));
            const clampedHeight = Math.max(1, Math.min(height, baseImage.height - clampedY));

            switch (cover) {
                case 'blur':
                    this.applyBlur(ctx, clampedX, clampedY, clampedWidth, clampedHeight);
                    break;
                case 'blackout':
                    this.applyBlackout(ctx, clampedX, clampedY, clampedWidth, clampedHeight, detection.color || '#000000');
                    break;
                case 'ellipse':
                    this.applyEllipse(ctx, clampedX, clampedY, clampedWidth, clampedHeight, detection.color || '#000000');
                    break;
                case 'infill':
                    this.applyInfill(ctx, baseImage, clampedX, clampedY, clampedWidth, clampedHeight);
                    break;
                case 'pixelate':
                    this.applyPixelate(ctx, clampedX, clampedY, clampedWidth, clampedHeight);
                    break;
            }
        });
    }

    /**
     * Apply Gaussian-style blur to a region using CSS filters for performance
     */
    applyBlur(ctx, x, y, width, height) {
        const blurRadius = Math.max(2, Math.min(width, height) / 10);
        
        // Use a temporary canvas with CSS filter for much better performance
        this.tempCanvas.width = width;
        this.tempCanvas.height = height;
        
        // Copy the region to temp canvas
        const regionData = ctx.getImageData(x, y, width, height);
        this.tempCtx.putImageData(regionData, 0, 0);
        
        // Apply CSS filter blur
        this.tempCtx.filter = `blur(${Math.min(blurRadius, 20)}px)`;
        this.tempCtx.drawImage(this.tempCanvas, 0, 0);
        
        // Reset filter
        this.tempCtx.filter = 'none';
        
        // Copy blurred result back to main canvas
        ctx.drawImage(this.tempCanvas, 0, 0, width, height, x, y, width, height);
    }

    /**
     * Apply solid color rectangle
     */
    applyBlackout(ctx, x, y, width, height, color = '#000000') {
        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(x, y, width, height);
        ctx.restore();
    }

    /**
     * Apply solid color ellipse
     */
    applyEllipse(ctx, x, y, width, height, color = '#000000') {
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        
        // Draw ellipse centered in the rectangle
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const radiusX = width / 2;
        const radiusY = height / 2;
        
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
    }

    /**
     * Apply pixelation effect
     */
    applyPixelate(ctx, x, y, width, height) {
        const pixelSize = Math.max(8, Math.min(width, height) / 20);
        
        // Get original image data
        const imageData = ctx.getImageData(x, y, width, height);
        
        // Apply pixelation
        const pixelated = this.pixelateImageData(imageData, pixelSize);
        
        // Put back pixelated data
        ctx.putImageData(pixelated, x, y);
    }

    /**
     * Apply basic inpainting/infill effect
     * Uses a simple content-aware approach by sampling surrounding pixels
     */
    applyInfill(ctx, baseImage, x, y, width, height) {
        // Get surrounding context (expand region)
        const padding = 20;
        const contextX = Math.max(0, x - padding);
        const contextY = Math.max(0, y - padding);
        const contextWidth = Math.min(baseImage.width - contextX, width + padding * 2);
        const contextHeight = Math.min(baseImage.height - contextY, height + padding * 2);

        // Get context image data
        const contextData = ctx.getImageData(contextX, contextY, contextWidth, contextHeight);
        
        // Apply simple inpainting algorithm
        const inpainted = this.simpleInpaint(
            contextData, 
            x - contextX, 
            y - contextY, 
            width, 
            height
        );
        
        // Put back the inpainted region
        ctx.putImageData(inpainted, contextX, contextY);
    }

    /**
     * Box blur implementation for canvas
     */
    boxBlur(data, width, height, radius) {
        const output = new Uint8ClampedArray(data.length);
        const radiusInt = Math.round(radius);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, a = 0;
                let count = 0;

                // Sample surrounding pixels
                for (let dy = -radiusInt; dy <= radiusInt; dy++) {
                    for (let dx = -radiusInt; dx <= radiusInt; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;

                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const idx = (ny * width + nx) * 4;
                            r += data[idx];
                            g += data[idx + 1];
                            b += data[idx + 2];
                            a += data[idx + 3];
                            count++;
                        }
                    }
                }

                const idx = (y * width + x) * 4;
                output[idx] = r / count;
                output[idx + 1] = g / count;
                output[idx + 2] = b / count;
                output[idx + 3] = a / count;
            }
        }

        return output;
    }

    /**
     * Pixelation effect
     */
    pixelateImageData(imageData, pixelSize) {
        const { data, width, height } = imageData;
        const output = new Uint8ClampedArray(data.length);

        for (let y = 0; y < height; y += pixelSize) {
            for (let x = 0; x < width; x += pixelSize) {
                // Sample center pixel of the block
                const centerX = Math.min(x + Math.floor(pixelSize / 2), width - 1);
                const centerY = Math.min(y + Math.floor(pixelSize / 2), height - 1);
                const centerIdx = (centerY * width + centerX) * 4;

                const r = data[centerIdx];
                const g = data[centerIdx + 1];
                const b = data[centerIdx + 2];
                const a = data[centerIdx + 3];

                // Fill the entire block with the center pixel color
                for (let dy = 0; dy < pixelSize && y + dy < height; dy++) {
                    for (let dx = 0; dx < pixelSize && x + dx < width; dx++) {
                        const idx = ((y + dy) * width + (x + dx)) * 4;
                        output[idx] = r;
                        output[idx + 1] = g;
                        output[idx + 2] = b;
                        output[idx + 3] = a;
                    }
                }
            }
        }

        const result = new ImageData(output, width, height);
        return result;
    }

    /**
     * Simple inpainting algorithm
     * Uses edge-based sampling and diffusion
     */
    simpleInpaint(imageData, maskX, maskY, maskWidth, maskHeight) {
        const { data, width, height } = imageData;
        const output = new Uint8ClampedArray(data.length);
        output.set(data); // Start with original data

        const iterations = 3; // Number of diffusion iterations
        
        for (let iter = 0; iter < iterations; iter++) {
            // For each pixel in the mask region
            for (let y = maskY; y < maskY + maskHeight && y < height; y++) {
                for (let x = maskX; x < maskX + maskWidth && x < width; x++) {
                    let r = 0, g = 0, b = 0, a = 0;
                    let count = 0;

                    // Sample from surrounding pixels (3x3 kernel)
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;

                            // Skip center pixel and ensure bounds
                            if ((dx === 0 && dy === 0) || nx < 0 || nx >= width || ny < 0 || ny >= height) {
                                continue;
                            }

                            // Only sample from outside the mask region or edge pixels
                            const isOutsideMask = (nx < maskX || nx >= maskX + maskWidth || 
                                                 ny < maskY || ny >= maskY + maskHeight);
                            const isEdgePixel = (x === maskX || x === maskX + maskWidth - 1 || 
                                               y === maskY || y === maskY + maskHeight - 1);

                            if (isOutsideMask || (iter > 0 && isEdgePixel)) {
                                const idx = (ny * width + nx) * 4;
                                r += output[idx];
                                g += output[idx + 1];
                                b += output[idx + 2];
                                a += output[idx + 3];
                                count++;
                            }
                        }
                    }

                    // Apply averaged color if we found surrounding pixels
                    if (count > 0) {
                        const idx = (y * width + x) * 4;
                        output[idx] = r / count;
                        output[idx + 1] = g / count;
                        output[idx + 2] = b / count;
                        output[idx + 3] = a / count;
                    }
                }
            }
        }

        return new ImageData(output, width, height);
    }

    /**
     * Create a preview of the image with all cover effects applied
     * @param {HTMLImageElement} image - Base image
     * @param {Array} detections - Detection objects with cover properties
     * @param {HTMLCanvasElement} canvas - Canvas to render to
     * @returns {Promise} - Resolves when rendering is complete
     */
    async renderPreview(image, detections, canvas) {
        return new Promise((resolve) => {
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');

            // Draw base image
            ctx.drawImage(image, 0, 0);

            // Apply cover effects
            this.applyCoverEffects(ctx, image, detections);

            resolve();
        });
    }

    /**
     * Create a temporary canvas with effects applied (useful for processing)
     * @param {HTMLImageElement} image - Base image
     * @param {Array} detections - Detection objects
     * @returns {HTMLCanvasElement} - Canvas with effects applied
     */
    createEffectsCanvas(image, detections) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = image.width;
        canvas.height = image.height;
        
        // Draw base image
        ctx.drawImage(image, 0, 0);
        
        // Apply effects
        this.applyCoverEffects(ctx, image, detections);
        
        return canvas;
    }
}