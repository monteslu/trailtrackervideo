// Web Worker for Bike Trail Processing
// Uses Rawr for RPC communication

// Import Rawr from CDN
importScripts('https://unpkg.com/rawr@0.19.0/dist/bundle.js');

// MediaPipe Tasks Vision loading state
let mediaPipeLoaded = false;
let mediaReady = false;

// Function to load MediaPipe dynamically using ES modules
async function loadMediaPipe() {
    try {
        // Use dynamic import instead of importScripts
        const taskVision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21');
        
        // Store the imported module on global scope for compatibility
        self.MediaPipeVision = taskVision;
        
        mediaPipeLoaded = true;
        console.log('✅ MediaPipe Tasks Vision loaded via dynamic import');
        return true;
    } catch (error) {
        console.warn('Dynamic import failed, MediaPipe not available in worker:', error.message);
        mediaPipeLoaded = false;
        return false;
    }
}

// Initialize MediaPipe detectors
let faceDetector = null;
let poseDetector = null;
let objectDetector = null;
let visionInitialized = false;

async function initializeMediaPipeVision() {
    if (visionInitialized) return;
    
    // Try to load MediaPipe if not already loaded
    if (!mediaPipeLoaded) {
        const loaded = await loadMediaPipe();
        if (!loaded) {
            throw new Error('MediaPipe Tasks Vision library failed to load - not available in web worker');
        }
    }
    
    try {
        console.log('📸 Initializing MediaPipe Tasks Vision...');
        
        if (!self.MediaPipeVision) {
            throw new Error('MediaPipeVision not available on global scope');
        }
        
        const { FaceDetector, PoseLandmarker, ObjectDetector, FilesetResolver } = self.MediaPipeVision;
        
        // Initialize the MediaPipe Vision Fileset
        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
        );
        
        // Initialize Face Detector
        faceDetector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
                delegate: 'CPU'
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.5
        });
        
        // Initialize Object Detector with settings optimized for multiple person detection
        objectDetector = await ObjectDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
                delegate: 'CPU'
            },
            runningMode: 'IMAGE',
            scoreThreshold: 0.2,        // Lower threshold to catch more detections
            maxResults: 50,             // Allow more total results
            categoryAllowlistLabels: ['person']  // Focus only on person detection
        });
        
        visionInitialized = true;
        console.log('✅ MediaPipe Vision initialized (faces and people detection)');
        
        // Notify main thread that we're ready for detection
        if (self.peer && self.peer.methods && self.peer.methods.onWorkerReady) {
            try {
                await self.peer.methods.onWorkerReady({
                    type: 'detection-ready',
                    models: ['face-detector', 'object-detector'],
                    timestamp: Date.now()
                });
            } catch (e) {
                // Main thread might not have this method yet, that's ok
                console.log('Could not notify main thread (not ready yet)');
            }
        }
        
    } catch (error) {
        console.warn('MediaPipe Vision initialization failed:', error.message);
        
        // Notify main thread of initialization failure
        if (self.peer && self.peer.methods && self.peer.methods.onWorkerReady) {
            try {
                await self.peer.methods.onWorkerReady({
                    type: 'detection-unavailable',
                    error: error.message,
                    timestamp: Date.now()
                });
            } catch (e) {
                console.log('Could not notify main thread of unavailability');
            }
        }
        
        // Don't throw error - let worker continue without MediaPipe
        console.log('👌 Worker continuing without MediaPipe detection capabilities');
    }
}

// Worker methods that can be called from main thread
async function init() {
    console.log('🔧 Worker RPC initialized with Rawr');
    
    return {
        ready: true,
        rawrVersion: self.Rawr?.version || 'unknown',
        detectionStatus: visionInitialized ? 'ready' : 'initializing',
        timestamp: Date.now()
    };
}

function processImageData(imageData) {
    console.log('📸 Processing image data in worker');
    
    // Example processing - replace with actual image processing
    const result = {
        processed: true,
        timestamp: Date.now(),
        width: imageData.width || 0,
        height: imageData.height || 0,
        // Add your processing logic here
        processedData: 'Image processed in worker'
    };
    
    return result;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
             Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360;
    
    return bearing;
}

function processAltitudeData(altitudes) {
    if (!altitudes || altitudes.length === 0) return null;
    
    const validAltitudes = altitudes.filter(alt => alt > 0);
    if (validAltitudes.length === 0) return null;
    
    return {
        min: Math.min(...validAltitudes),
        max: Math.max(...validAltitudes),
        avg: validAltitudes.reduce((sum, alt) => sum + alt, 0) / validAltitudes.length,
        count: validAltitudes.length
    };
}

function convertUnits(value, fromUnit, toUnit) {
    const conversions = {
        'm_to_ft': (m) => m * 3.28084,
        'ft_to_m': (ft) => ft / 3.28084,
        'mps_to_mph': (mps) => mps * 2.237,
        'mps_to_kmh': (mps) => mps * 3.6,
        'mph_to_mps': (mph) => mph / 2.237,
        'kmh_to_mps': (kmh) => kmh / 3.6
    };
    
    const conversionKey = `${fromUnit}_to_${toUnit}`;
    const converter = conversions[conversionKey];
    
    if (!converter) {
        throw new Error(`Unsupported conversion: ${fromUnit} to ${toUnit}`);
    }
    
    return converter(value);
}

function ping() {
    return {
        pong: true,
        timestamp: Date.now(),
        status: 'Worker alive'
    };
}

async function detectPeople(imageData, scale, timestamp = null) {
    
    try {
        // Initialize MediaPipe Vision if not already done
        await initializeMediaPipeVision();
        
        if (!visionInitialized || !mediaPipeLoaded) {
            return { 
                people: [], 
                faces: [],
                error: 'MediaPipe Vision not available in web worker environment',
                fallback: true
            };
        }
        
        // Create canvas from image data
        const canvas = new OffscreenCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);
        
        const results = { people: [], faces: [] };
        
        // Face detection pass
        if (faceDetector) {
            const faceResults = faceDetector.detect(canvas);
            
            if (faceResults.detections && faceResults.detections.length > 0) {
                // Filter faces above 60% confidence
                const highConfidenceFaces = faceResults.detections.filter(detection => {
                    const confidence = detection.categories[0]?.score || 0.5;
                    if (confidence >= 0.6) {
                        const timestampStr = timestamp ? ` at ${timestamp}` : '';
                        console.log(`🏷️ Detected: face (${(confidence * 100).toFixed(1)}% confidence)${timestampStr}`);
                        return true;
                    }
                    return false;
                });
                
                results.faces = highConfidenceFaces.map((detection, index) => {
                    const bbox = detection.boundingBox;
                    return {
                        id: index,
                        confidence: detection.categories[0]?.score || 0.5,
                        boundingBox: {
                            // Scale back to original image coordinates
                            x: bbox.originX * scale.x,
                            y: bbox.originY * scale.y,
                            width: bbox.width * scale.x,
                            height: bbox.height * scale.y
                        },
                        keypoints: detection.keypoints ? detection.keypoints.map(kp => ({
                            x: kp.x * scale.x,
                            y: kp.y * scale.y,
                            name: kp.label || 'unknown'
                        })) : []
                    };
                });
            }
        }
        
        // Object detection pass (filter for people only)
        if (objectDetector) {
            const objectResults = objectDetector.detect(canvas);
            
            if (objectResults.detections && objectResults.detections.length > 0) {
                // Adaptive confidence filtering: if we have one person ≥40%, allow others down to 25%
                const allPeople = objectResults.detections.filter(detection => 
                    detection.categories[0].categoryName === 'person'
                );
                
                // Check if we have at least one high-confidence person
                const hasHighConfidencePerson = allPeople.some(detection => 
                    detection.categories[0].score >= 0.4
                );
                
                const confidenceThreshold = hasHighConfidencePerson ? 0.25 : 0.4;
                
                const personDetections = allPeople.filter(detection => {
                    const category = detection.categories[0];
                    if (category.score >= confidenceThreshold) {
                        const timestampStr = timestamp ? ` at ${timestamp}` : '';
                        const thresholdNote = hasHighConfidencePerson && category.score < 0.5 ? ' (adaptive)' : '';
                        console.log(`🏷️ Detected: ${category.categoryName} (${(category.score * 100).toFixed(1)}% confidence)${thresholdNote}${timestampStr}`);
                        return true;
                    }
                    return false;
                });
                
                if (personDetections.length > 1) {
                    console.log(`👥 Found ${personDetections.length} people in frame - mapping to results`);
                    personDetections.forEach((detection, i) => {
                        const bbox = detection.boundingBox;
                        console.log(`  Person ${i}: bbox(${bbox.originX.toFixed(0)}, ${bbox.originY.toFixed(0)}, ${bbox.width.toFixed(0)}, ${bbox.height.toFixed(0)})`);
                    });
                }
                
                if (personDetections.length > 0) {
                    results.people = personDetections.map((detection, index) => {
                        const bbox = detection.boundingBox;
                        const category = detection.categories[0];
                        
                        return {
                            id: index,
                            confidence: category.score,
                            boundingBox: {
                                x: bbox.originX * scale.x,
                                y: bbox.originY * scale.y,
                                width: bbox.width * scale.x,
                                height: bbox.height * scale.y
                            }
                        };
                    });
                    
                    // Verify what we're actually returning
                    if (personDetections.length > 1) {
                        console.log(`✅ Returning ${results.people.length} people in results`);
                    }
                }
            }
        }
        
        return results;
        
    } catch (error) {
        console.error('Detection error:', error);
        return { people: [], faces: [], error: error.message };
    }
}

function calculatePoseBoundingBox(keypoints) {
    if (!keypoints || keypoints.length === 0) return null;
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    keypoints.forEach(kp => {
        if (kp.visibility > 0.3) { // Only consider visible keypoints
            if (kp.x < minX) minX = kp.x;
            if (kp.x > maxX) maxX = kp.x;
            if (kp.y < minY) minY = kp.y;
            if (kp.y > maxY) maxY = kp.y;
        }
    });
    
    // Add padding
    const padding = 20;
    return {
        x: Math.max(0, minX - padding),
        y: Math.max(0, minY - padding),
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2)
    };
}

// Create Rawr peer for the worker
const peer = self.Rawr({
    transport: self.Rawr.transports.worker(),
    methods: {
        init,
        processImageData,
        calculateBearing,
        processAltitudeData,
        convertUnits,
        ping,
        detectPeople
    }
});

console.log('🔧 Bike Trail Worker with Rawr RPC ready');

// Start MediaPipe initialization immediately when worker loads
console.log('🚀 Starting early MediaPipe initialization...');
initializeMediaPipeVision().catch(error => {
    console.warn('Early MediaPipe initialization failed:', error.message);
    console.log('👌 Worker will continue without MediaPipe detection capabilities');
});

// Store reference to peer globally for initialization callback
self.peer = peer;