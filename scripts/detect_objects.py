#!/usr/bin/env python3

"""
Multi-class Object Detection Script
Detects people, traffic lights, stop signs, and other street furniture
Outputs detection metadata without modifying images
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

class MultiObjectDetector:
    def __init__(self, use_gpu=True):
        self.use_gpu = use_gpu
        self.net = None
        self.output_layers = None
        self.class_names = []
        self.backend = cv2.dnn.DNN_BACKEND_OPENCV
        self.target = cv2.dnn.DNN_TARGET_CPU
        
        # Classes we care about (from COCO dataset)
        # These are the indices in the COCO class list
        self.target_classes = {
            0: ('person', 'blur'),           # person - blur
            9: ('traffic light', 'none'),    # traffic light - no cover
            11: ('stop sign', 'none'),       # stop sign - no cover  
            12: ('parking meter', 'none'),   # parking meter - no cover
            13: ('bench', 'none'),           # bench - no cover
            2: ('car', 'none'),              # car - no cover
            3: ('motorcycle', 'none'),       # motorcycle - no cover
            5: ('bus', 'none'),              # bus - no cover
            7: ('truck', 'none'),            # truck - no cover
            1: ('bicycle', 'none'),          # bicycle - no cover
            24: ('backpack', 'none'),        # backpack - common on trails
            16: ('dog', 'blur'),             # dog - blur for privacy
            17: ('horse', 'none'),           # horse - equestrians on trails
            67: ('cell phone', 'none'),     # cell phone - people taking photos
            39: ('bottle', 'none'),          # bottle - water bottles
        }
        
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
            return
        except Exception as e:
            pass
    
    def _download_model(self, url, filename):
        """Download model files if they don't exist"""
        if not os.path.exists(filename):
            print(f"Downloading {filename}...")
            urllib.request.urlretrieve(url, filename)
            print(f"Downloaded {filename}")
    
    def _load_model(self):
        """Load YOLOv4-tiny model"""
        script_dir = Path(__file__).parent
        models_dir = script_dir / "models"
        models_dir.mkdir(exist_ok=True)
        
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
    
    def detect_objects(self, image):
        """Detect all objects in the image"""
        height, width = image.shape[:2]
        
        # Create blob from image
        blob = cv2.dnn.blobFromImage(image, 1/255.0, (416, 416), swapRB=True, crop=False)
        self.net.setInput(blob)
        
        # Run inference
        outputs = self.net.forward(self.output_layers)
        
        # Parse detections
        boxes = []
        confidences = []
        class_ids = []
        
        for output in outputs:
            for detection in output:
                scores = detection[5:]
                class_id = np.argmax(scores)
                confidence = scores[class_id]
                
                # Check if this is a class we care about (no confidence threshold)
                if class_id in self.target_classes:
                    # Get bounding box coordinates
                    center_x = int(detection[0] * width)
                    center_y = int(detection[1] * height)
                    w = int(detection[2] * width)
                    h = int(detection[3] * height)
                    
                    x = int(center_x - w/2)
                    y = int(center_y - h/2)
                    
                    boxes.append([x, y, w, h])
                    confidences.append(float(confidence))
                    class_ids.append(class_id)
        
        # Apply non-maximum suppression (with very low threshold to keep most detections)
        indices = cv2.dnn.NMSBoxes(boxes, confidences, 0.01, 0.4)
        
        detections = []
        if len(indices) > 0:
            for i in indices.flatten():
                x, y, w, h = boxes[i]
                class_id = class_ids[i]
                class_name, cover_type = self.target_classes[class_id]
                
                detections.append({
                    'x': max(0, x),
                    'y': max(0, y),
                    'width': min(w, width - x),
                    'height': min(h, height - y),
                    'class': class_name,
                    'confidence': confidences[i],
                    'cover': cover_type
                })
        
        return detections

def process_single_frame(input_path, output_path, detector):
    """Process a single frame for object detection"""
    try:
        # Read image
        image = cv2.imread(input_path)
        if image is None:
            raise ValueError(f"Could not read image: {input_path}")
        
        # Extract timestamp from filename (assuming format: 1755525299929.jpg)
        frame_name = os.path.basename(input_path)
        timestamp = int(Path(frame_name).stem)
        
        # Detect objects
        start_time = time.time()
        detections = detector.detect_objects(image)
        detection_time = time.time() - start_time
        
        # Create frame result
        result = {
            'timestamp': timestamp,
            'detections': detections
        }
        
        # Write result to output file
        with open(output_path, 'w') as f:
            json.dump(result, f)
        
        return True
        
    except Exception as e:
        print(f"Error processing {input_path}: {str(e)}", file=sys.stderr)
        # Write empty result on error
        try:
            timestamp = int(Path(os.path.basename(input_path)).stem)
            result = {'timestamp': timestamp, 'detections': []}
            with open(output_path, 'w') as f:
                json.dump(result, f)
        except:
            pass
        return False

def main():
    parser = argparse.ArgumentParser(description='Detect objects in images')
    parser.add_argument('input', help='Input image path')
    parser.add_argument('output', help='Output JSON path')
    parser.add_argument('--cpu', action='store_true',
                       help='Force CPU processing (disable GPU)')
    
    args = parser.parse_args()
    
    # Initialize detector
    try:
        detector = MultiObjectDetector(use_gpu=not args.cpu)
        
        # Process frame
        success = process_single_frame(args.input, args.output, detector)
        
        if success:
            sys.exit(0)
        else:
            sys.exit(1)
            
    except Exception as e:
        print(f"Failed to initialize detector: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()