#!/usr/bin/env python3

"""
People Detection and Blurring Script
Uses OpenCV DNN with YOLO or MobileNet models for CPU-based people detection
Works on Linux and Mac without GPU requirements
"""

import cv2
import numpy as np
import argparse
import sys
import os
import json
from pathlib import Path
import urllib.request
import time

class PeopleDetector:
    def __init__(self, model_type='yolo', confidence_threshold=0.3, use_gpu=True):
        self.confidence_threshold = confidence_threshold
        self.model_type = model_type
        self.use_gpu = use_gpu
        self.net = None
        self.output_layers = None
        self.class_names = []
        self.backend = cv2.dnn.DNN_BACKEND_OPENCV
        self.target = cv2.dnn.DNN_TARGET_CPU
        
        # Try to use GPU if available
        if self.use_gpu:
            self._detect_gpu_backend()
        
        # Initialize the model
        self._load_model()
    
    def _detect_gpu_backend(self):
        """Detect and set the best available GPU backend"""
        try:
            # Test OpenCL (works with AMD GPUs)
            test_net = cv2.dnn.readNet("")
            test_net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
            test_net.setPreferableTarget(cv2.dnn.DNN_TARGET_OPENCL)
            self.backend = cv2.dnn.DNN_BACKEND_OPENCV
            self.target = cv2.dnn.DNN_TARGET_OPENCL
            print("🚀 Using OpenCL backend for AMD GPU acceleration")
            return
        except Exception as e:
            pass
        
        # Try CUDA if available
        try:
            test_net = cv2.dnn.readNet("")
            test_net.setPreferableBackend(cv2.dnn.DNN_BACKEND_CUDA)
            test_net.setPreferableTarget(cv2.dnn.DNN_TARGET_CUDA)
            self.backend = cv2.dnn.DNN_BACKEND_CUDA
            self.target = cv2.dnn.DNN_TARGET_CUDA
            print("🚀 Using CUDA backend for GPU acceleration")
            return
        except Exception as e:
            pass
        
        # Fallback to CPU
        print("🖥️  Using CPU backend (GPU acceleration not available)")
    
    def _download_model(self, url, filename):
        """Download model files if they don't exist"""
        if not os.path.exists(filename):
            print(f"Downloading {filename}...")
            urllib.request.urlretrieve(url, filename)
            print(f"Downloaded {filename}")
    
    def _load_model(self):
        """Load the detection model"""
        script_dir = Path(__file__).parent
        models_dir = script_dir / "models"
        models_dir.mkdir(exist_ok=True)
        
        if self.model_type == 'yolo':
            self._load_yolo_model(models_dir)
        elif self.model_type == 'mobilenet':
            self._load_mobilenet_model(models_dir)
        else:
            raise ValueError(f"Unsupported model type: {self.model_type}")
    
    def _load_yolo_model(self, models_dir):
        """Load YOLOv4-tiny model (lightweight, CPU-friendly)"""
        config_path = models_dir / "yolov4-tiny.cfg"
        weights_path = models_dir / "yolov4-tiny.weights"
        names_path = models_dir / "coco.names"
        
        # Download model files if needed
        base_url = "https://github.com/AlexeyAB/darknet/releases/download/darknet_yolo_v4_pre/"
        
        if not config_path.exists():
            self._download_model(
                "https://raw.githubusercontent.com/AlexeyAB/darknet/master/cfg/yolov4-tiny.cfg",
                str(config_path)
            )
        
        if not weights_path.exists():
            self._download_model(
                f"{base_url}yolov4-tiny.weights",
                str(weights_path)
            )
        
        if not names_path.exists():
            self._download_model(
                "https://raw.githubusercontent.com/AlexeyAB/darknet/master/data/coco.names",
                str(names_path)
            )
        
        # Load class names
        with open(names_path, 'r') as f:
            self.class_names = [line.strip() for line in f.readlines()]
        
        # Load network with detected backend
        self.net = cv2.dnn.readNet(str(weights_path), str(config_path))
        self.net.setPreferableBackend(self.backend)
        self.net.setPreferableTarget(self.target)
        
        # Get output layer names
        layer_names = self.net.getLayerNames()
        self.output_layers = [layer_names[i - 1] for i in self.net.getUnconnectedOutLayers()]
        
        print("✅ YOLOv4-tiny model loaded successfully")
    
    def _load_mobilenet_model(self, models_dir):
        """Load MobileNet-SSD model (alternative lightweight option)"""
        config_path = models_dir / "MobileNetSSD_deploy.prototxt"
        weights_path = models_dir / "MobileNetSSD_deploy.caffemodel"
        
        # Download model files if needed
        base_url = "https://github.com/chuanqi305/MobileNet-SSD/raw/master/"
        
        if not config_path.exists():
            self._download_model(
                f"{base_url}MobileNetSSD_deploy.prototxt",
                str(config_path)
            )
        
        if not weights_path.exists():
            self._download_model(
                f"{base_url}MobileNetSSD_deploy.caffemodel",
                str(weights_path)
            )
        
        # MobileNet class names (COCO format)
        self.class_names = [
            "background", "aeroplane", "bicycle", "bird", "boat",
            "bottle", "bus", "car", "cat", "chair", "cow", "diningtable",
            "dog", "horse", "motorbike", "person", "pottedplant", "sheep",
            "sofa", "train", "tvmonitor"
        ]
        
        # Load network with detected backend
        self.net = cv2.dnn.readNetFromCaffe(str(config_path), str(weights_path))
        self.net.setPreferableBackend(self.backend)
        self.net.setPreferableTarget(self.target)
        
        print("✅ MobileNet-SSD model loaded successfully")
    
    def detect_people(self, image):
        """Detect people in the image and return bounding boxes"""
        height, width = image.shape[:2]
        
        if self.model_type == 'yolo':
            return self._detect_yolo(image, width, height)
        elif self.model_type == 'mobilenet':
            return self._detect_mobilenet(image, width, height)
    
    def _detect_yolo(self, image, width, height):
        """YOLO detection implementation"""
        # Create blob from image
        blob = cv2.dnn.blobFromImage(image, 1/255.0, (416, 416), swapRB=True, crop=False)
        self.net.setInput(blob)
        
        # Run inference
        outputs = self.net.forward(self.output_layers)
        
        # Parse detections
        boxes = []
        confidences = []
        
        for output in outputs:
            for detection in output:
                scores = detection[5:]
                class_id = np.argmax(scores)
                confidence = scores[class_id]
                
                # Only process 'person' class (class_id = 0 in COCO)
                if class_id == 0 and confidence > self.confidence_threshold:
                    # Get bounding box coordinates
                    center_x = int(detection[0] * width)
                    center_y = int(detection[1] * height)
                    w = int(detection[2] * width)
                    h = int(detection[3] * height)
                    
                    x = int(center_x - w/2)
                    y = int(center_y - h/2)
                    
                    boxes.append([x, y, w, h])
                    confidences.append(float(confidence))
        
        # Apply non-maximum suppression
        indices = cv2.dnn.NMSBoxes(boxes, confidences, self.confidence_threshold, 0.4)
        
        people_boxes = []
        if len(indices) > 0:
            for i in indices.flatten():
                x, y, w, h = boxes[i]
                people_boxes.append({
                    'x': max(0, x),
                    'y': max(0, y),
                    'width': min(w, width - x),
                    'height': min(h, height - y),
                    'confidence': confidences[i]
                })
        
        return people_boxes
    
    def _detect_mobilenet(self, image, width, height):
        """MobileNet detection implementation"""
        # Create blob from image
        blob = cv2.dnn.blobFromImage(image, 0.007843, (300, 300), 127.5)
        self.net.setInput(blob)
        
        # Run inference
        detections = self.net.forward()
        
        people_boxes = []
        for i in range(detections.shape[2]):
            confidence = detections[0, 0, i, 2]
            class_id = int(detections[0, 0, i, 1])
            
            # Only process 'person' class (class_id = 15 in MobileNet)
            if class_id == 15 and confidence > self.confidence_threshold:
                x1 = int(detections[0, 0, i, 3] * width)
                y1 = int(detections[0, 0, i, 4] * height)
                x2 = int(detections[0, 0, i, 5] * width)
                y2 = int(detections[0, 0, i, 6] * height)
                
                people_boxes.append({
                    'x': max(0, x1),
                    'y': max(0, y1),
                    'width': min(x2 - x1, width - x1),
                    'height': min(y2 - y1, height - y1),
                    'confidence': float(confidence)
                })
        
        return people_boxes
    
    def inpaint_regions(self, image, detections):
        """Apply inpainting to make people disappear entirely"""
        if not detections:
            return image
        
        # Create mask for all detected people
        mask = np.zeros(image.shape[:2], np.uint8)
        
        for detection in detections:
            x = detection['x']
            y = detection['y']
            w = detection['width']
            h = detection['height']
            
            # Expand bounding box by 15% for better infilling
            expand = 0.15
            expand_w = int(w * expand)
            expand_h = int(h * expand)
            
            x1 = max(0, x - expand_w // 2)
            y1 = max(0, y - expand_h // 2)
            x2 = min(image.shape[1], x + w + expand_w // 2)
            y2 = min(image.shape[0], y + h + expand_h // 2)
            
            # Add this region to the mask (white = inpaint this area)
            cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
        
        # Apply inpainting to remove people entirely
        # Using TELEA algorithm (fast and good for natural scenes)
        inpaint_radius = 5  # Radius for inpainting algorithm
        inpainted = cv2.inpaint(image, mask, inpaint_radius, cv2.INPAINT_TELEA)
        
        return inpainted
    
    def blur_regions(self, image, detections, blur_factor=25):
        """Legacy blur method - use inpaint_regions instead"""
        return self.inpaint_regions(image, detections)

def save_detection_json(output_dir, frame_name, detections, processing_time):
    """Save detection data to JSON file"""
    try:
        json_dir = Path(output_dir) / "detections"
        json_dir.mkdir(exist_ok=True)
        
        detection_data = {
            "frame": frame_name,
            "timestamp": int(time.time() * 1000),  # Current time in milliseconds
            "processing_time_seconds": round(processing_time, 3),
            "people_count": len(detections),
            "detections": []
        }
        
        for i, det in enumerate(detections):
            detection_data["detections"].append({
                "person_id": i + 1,
                "confidence": round(det['confidence'], 4),
                "confidence_percent": round(det['confidence'] * 100, 1),
                "bounding_box": {
                    "x": int(det['x']),
                    "y": int(det['y']),
                    "width": int(det['width']),
                    "height": int(det['height'])
                },
                "center": {
                    "x": int(det['x'] + det['width'] / 2),
                    "y": int(det['y'] + det['height'] / 2)
                },
                "area_pixels": int(det['width'] * det['height'])
            })
        
        # Save JSON file
        json_file = json_dir / f"{Path(frame_name).stem}_detections.json"
        with open(json_file, 'w') as f:
            json.dump(detection_data, f, indent=2)
        
        return str(json_file)
        
    except Exception as e:
        print(f"⚠️ Warning: Could not save detection JSON: {e}")
        return None

def process_single_frame(input_path, output_path, detector, save_json=True):
    """Process a single frame for people detection and blurring"""
    try:
        # Read image
        image = cv2.imread(input_path)
        if image is None:
            raise ValueError(f"Could not read image: {input_path}")
        
        # Detect people
        start_time = time.time()
        detections = detector.detect_people(image)
        detection_time = time.time() - start_time
        
        frame_name = os.path.basename(input_path)
        output_dir = os.path.dirname(output_path)
        
        # Save detection data to JSON if requested
        json_file = None
        if save_json and detections:
            json_file = save_detection_json(output_dir, frame_name, detections, detection_time)
        
        # Apply blurring if people detected
        if detections:
            print(f"🔍🚨 DETECTION ALERT: {frame_name}")
            print(f"   📍 Found {len(detections)} people in {frame_name} (detection took {detection_time:.2f}s)")
            
            for i, det in enumerate(detections):
                conf_pct = det['confidence'] * 100
                print(f"   👤 Person {i+1}: {det['width']}x{det['height']} bbox @ ({det['x']}, {det['y']}) - {conf_pct:.1f}% confidence")
            
            print(f"   🎨 Applying inpainting to remove {len(detections)} people from {frame_name}")
            image = detector.inpaint_regions(image, detections)
            print(f"   ✅ Inpainting applied to {frame_name} - people removed, check sessions/ vs pre_infill/ to compare")
            print(f"   🔗 Compare: pre_infill/stadcon/{frame_name} → sessions/stadcon/{frame_name}")
            
            if json_file:
                print(f"   📄 Detection data saved: {json_file}")
            print("")  # Empty line for readability
        
        # Save processed image
        cv2.imwrite(output_path, image, [cv2.IMWRITE_JPEG_QUALITY, 95])
        
        return {
            'success': True,
            'detections': len(detections),
            'processing_time': detection_time,
            'json_file': json_file
        }
        
    except Exception as e:
        print(f"❌ Error processing {input_path}: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }

def main():
    parser = argparse.ArgumentParser(description='Detect and blur people in images')
    parser.add_argument('input', help='Input image path')
    parser.add_argument('output', help='Output image path')
    parser.add_argument('--model', choices=['yolo', 'mobilenet'], default='yolo', 
                       help='Detection model to use (default: yolo)')
    parser.add_argument('--confidence', type=float, default=0.3,
                       help='Confidence threshold (default: 0.3)')
    parser.add_argument('--blur', type=int, default=25,
                       help='Blur strength (default: 25)')
    parser.add_argument('--cpu', action='store_true',
                       help='Force CPU processing (disable GPU)')
    parser.add_argument('--benchmark', action='store_true',
                       help='Show timing information')
    
    args = parser.parse_args()
    
    # Initialize detector
    try:
        import time
        print(f"🚀 Initializing {args.model} detector...")
        
        start_time = time.time()
        detector = PeopleDetector(
            model_type=args.model, 
            confidence_threshold=args.confidence,
            use_gpu=not args.cpu
        )
        init_time = time.time() - start_time
        
        # Process frame
        process_start = time.time()
        result = process_single_frame(args.input, args.output, detector)
        process_time = time.time() - process_start
        
        if result['success']:
            if args.benchmark:
                print(f"⏱️  Timing: init={init_time:.3f}s, process={process_time:.3f}s, total={init_time+process_time:.3f}s")
            print(f"✅ Processed successfully: {result['detections']} people detected")
            sys.exit(0)
        else:
            print(f"❌ Processing failed: {result['error']}")
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ Failed to initialize detector: {str(e)}")
        sys.exit(1)

if __name__ == '__main__':
    main()