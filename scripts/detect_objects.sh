#!/bin/bash

# Object Detection Script
# Analyzes frames in sessions/<session_name>/ and creates a detections.json file
# Usage: ./detect_objects.sh <session_name> [--parallel 4]

# Default values
PARALLEL_JOBS=4
SESSION_NAME=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --parallel)
            PARALLEL_JOBS="$2"
            shift 2
            ;;
        -*)
            echo "Unknown option $1"
            exit 1
            ;;
        *)
            if [ -z "$SESSION_NAME" ]; then
                SESSION_NAME="$1"
            else
                echo "Too many positional arguments"
                exit 1
            fi
            shift
            ;;
    esac
done

if [ -z "$SESSION_NAME" ]; then
    echo "Usage: $0 <session_name> [options]"
    echo "Options:"
    echo "  --parallel 1-50       Parallel processing jobs (default: 4)"
    echo "Example: $0 stadcon --parallel 25"
    exit 1
fi

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SESSION_DIR="${PROJECT_ROOT}/sessions/${SESSION_NAME}"
OUTPUT_JSON="${SESSION_DIR}/detections.json"

# Check if session directory exists
if [ ! -d "$SESSION_DIR" ]; then
    echo "Error: Session directory '$SESSION_DIR' does not exist"
    echo "Run gp_video_frames.sh first to extract frames"
    exit 1
fi

# Count frames in session directory
frame_count=$(find "$SESSION_DIR" -name "*.jpg" -type f | wc -l)
echo "🔍 Object Detection Pipeline"
echo "Session: $SESSION_NAME"
echo "Parallel jobs: $PARALLEL_JOBS"
echo "Input: $SESSION_DIR"
echo "Output: $OUTPUT_JSON"
echo "Found $frame_count frames to analyze"

if [ $frame_count -eq 0 ]; then
    echo "❌ Error: No JPEG frames found in $SESSION_DIR"
    exit 1
fi

# Check if Python3 and OpenCV are available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python3 not found. Please install Python3."
    exit 1
fi

# Test if our detection script works
echo "🔧 Testing detection script..."
if ! python3 "$SCRIPT_DIR/detect_objects.py" --help &> /dev/null; then
    echo "❌ Error: Detection script not working. Installing dependencies..."
    echo "Installing required Python packages..."
    
    # Try to install opencv-python
    if command -v pip3 &> /dev/null; then
        pip3 install opencv-python numpy --user
    elif command -v pip &> /dev/null; then
        pip install opencv-python numpy --user
    else
        echo "❌ Error: pip not found. Please install opencv-python manually:"
        echo "  pip3 install opencv-python numpy"
        exit 1
    fi
fi

# Create temporary directory for tracking progress
temp_dir=$(mktemp -d)
counter_file="$temp_dir/counter"
echo "0" > "$counter_file"

# Create temporary directory for individual frame detection results
results_dir="$temp_dir/results"
mkdir -p "$results_dir"

echo "🚀 Starting object detection..."
echo "Processing $frame_count frames with $PARALLEL_JOBS parallel jobs"

# Function to process a single frame
process_frame() {
    local frame_file="$1"
    local frame_name=$(basename "$frame_file")
    local frame_timestamp="${frame_name%.*}"
    local result_file="$results_dir/${frame_timestamp}.json"
    
    # Run detection on this frame
    if python3 "$SCRIPT_DIR/detect_objects.py" \
        "$frame_file" "$result_file" > /dev/null 2>&1; then
        
        # Increment counter atomically
        (
            flock -x 200
            count=$(cat "$counter_file")
            count=$((count + 1))
            echo "$count" > "$counter_file"
            
            # Show progress every 100 frames
            if [ $((count % 100)) -eq 0 ]; then
                percentage=$(echo "$count $frame_count" | awk '{printf "%.1f", ($1/$2)*100}')
                echo "  Progress: $count/$frame_count (${percentage}%)"
            fi
        ) 200>"$counter_file.lock"
        
        return 0
    else
        echo "⚠ Warning: Detection failed for $frame_name"
        # Create empty result for this frame
        echo "{\"timestamp\":$frame_timestamp,\"detections\":[]}" > "$result_file"
        return 1
    fi
}

# Export function for parallel execution
export -f process_frame
export results_dir SCRIPT_DIR counter_file frame_count

# Process frames in parallel using GNU parallel or xargs
start_time=$(date +%s)

if command -v parallel &> /dev/null; then
    # Use GNU parallel if available
    find "$SESSION_DIR" -name "*.jpg" -type f | \
        parallel -j "$PARALLEL_JOBS" process_frame {}
else
    # Fallback to xargs with -P
    find "$SESSION_DIR" -name "*.jpg" -type f | \
        xargs -I {} -P "$PARALLEL_JOBS" bash -c 'process_frame "$@"' _ {}
fi

end_time=$(date +%s)
processing_time=$((end_time - start_time))

# Final progress update
processed_count=$(cat "$counter_file")
echo "✅ Detection complete!"
echo "Processed: $processed_count/$frame_count frames"
echo "Processing time: ${processing_time}s"

# Combine all individual JSON files into final detections.json
echo "📝 Combining detection results..."

python3 - << 'EOF' "$results_dir" "$OUTPUT_JSON" "$SESSION_NAME"
import json
import sys
import os
from pathlib import Path

results_dir = sys.argv[1]
output_json = sys.argv[2]
session_name = sys.argv[3]

# Collect all frame results
frames = []
result_files = sorted(Path(results_dir).glob("*.json"))

for result_file in result_files:
    try:
        with open(result_file, 'r') as f:
            frame_data = json.load(f)
            frames.append(frame_data)
    except Exception as e:
        print(f"Warning: Could not read {result_file}: {e}")

# Sort frames by timestamp
frames.sort(key=lambda x: x['timestamp'])

# Create final output
output = {
    "session": session_name,
    "frame_count": len(frames),
    "processing_time_seconds": 0,  # Will be updated
    "frames": frames
}

# Add processing time
try:
    output["processing_time_seconds"] = int(sys.argv[4]) if len(sys.argv) > 4 else 0
except:
    pass

# Write final JSON
with open(output_json, 'w') as f:
    json.dump(output, f, indent=2)

print(f"✅ Created {output_json} with {len(frames)} frames")
EOF

# Clean up
rm -rf "$temp_dir"

# Calculate processing speed
if [ $processing_time -gt 0 ]; then
    fps=$(echo "$frame_count $processing_time" | awk '{printf "%.1f", $1/$2}')
    echo "📊 Processing speed: ${fps} frames/second"
fi

echo "🎉 Object detection complete: $SESSION_NAME"
echo "📄 Detection data saved to: $OUTPUT_JSON"