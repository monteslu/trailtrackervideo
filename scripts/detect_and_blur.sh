#!/bin/bash

# People Detection and Blur Script
# Processes frames from pre_infill/ directory, runs people detection with blurring, and outputs to sessions/
# Usage: ./detect_and_blur.sh <session_name> [--model yolo|mobilenet] [--confidence 0.3] [--parallel 4]

# Default values
MODEL_TYPE="yolo"
CONFIDENCE="0.3"
PARALLEL_JOBS=4
SESSION_NAME=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --model)
            MODEL_TYPE="$2"
            shift 2
            ;;
        --confidence)
            CONFIDENCE="$2"
            shift 2
            ;;
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
    echo "  --model yolo|mobilenet    Detection model (default: yolo)"
    echo "  --confidence 0.1-1.0      Confidence threshold (default: 0.3)"
    echo "  --parallel 1-8            Parallel processing jobs (default: 4)"
    echo "Example: $0 TrailSync_Mesa_17-08-2025_20_19_20250817_202517 --model yolo --confidence 0.25 --parallel 6"
    exit 1
fi

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PRE_INFILL_DIR="${PROJECT_ROOT}/pre_infill/${SESSION_NAME}"
OUTPUT_DIR="${PROJECT_ROOT}/sessions/${SESSION_NAME}"

# Check if pre_infill directory exists
if [ ! -d "$PRE_INFILL_DIR" ]; then
    echo "Error: Pre-infill directory '$PRE_INFILL_DIR' does not exist"
    echo "Run gp_video_frames.sh first to extract frames"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "🚀 People Detection and Blur Pipeline"
echo "Session: $SESSION_NAME"
echo "Model: $MODEL_TYPE"
echo "Confidence: $CONFIDENCE"
echo "Parallel jobs: $PARALLEL_JOBS"
echo "Input: $PRE_INFILL_DIR"
echo "Output: $OUTPUT_DIR"

# Count frames in pre_infill directory
frame_count=$(find "$PRE_INFILL_DIR" -name "*.jpg" -type f | wc -l)
echo "Found $frame_count frames to process"

if [ $frame_count -eq 0 ]; then
    echo "❌ Error: No JPEG frames found in $PRE_INFILL_DIR"
    exit 1
fi

# Copy GPS data files if they exist
echo "📋 Copying metadata files..."
if [ -f "$PRE_INFILL_DIR/goprogps.json" ]; then
    cp "$PRE_INFILL_DIR/goprogps.json" "$OUTPUT_DIR/"
    echo "  ✓ Copied goprogps.json"
fi

if [ -f "$PRE_INFILL_DIR/trailsync.json" ]; then
    cp "$PRE_INFILL_DIR/trailsync.json" "$OUTPUT_DIR/"
    echo "  ✓ Copied trailsync.json"
fi

# Check if Python3 and OpenCV are available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python3 not found. Please install Python3."
    echo "Fallback: Copying frames without detection..."
    cp "$PRE_INFILL_DIR"/*.jpg "$OUTPUT_DIR/" 2>/dev/null || true
    echo "✓ Frames copied without people detection"
    exit 0
fi

# Test if our detection script works
echo "🔍 Testing detection script..."
if ! python3 "$SCRIPT_DIR/detect_people_blur.py" --help &> /dev/null; then
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
        echo "Fallback: Copying frames without detection..."
        cp "$PRE_INFILL_DIR"/*.jpg "$OUTPUT_DIR/" 2>/dev/null || true
        exit 0
    fi
fi

# Start parallel processing
echo "🔄 Starting people detection and blur processing..."
echo "Processing $frame_count frames with $PARALLEL_JOBS parallel jobs"

# Create temporary directory for tracking progress
temp_dir=$(mktemp -d)
counter_file="$temp_dir/counter"
echo "0" > "$counter_file"

# Function to process a single frame
process_frame() {
    local frame_file="$1"
    local frame_name=$(basename "$frame_file")
    local output_file="$OUTPUT_DIR/$frame_name"
    
    # Run detection on this frame
    if python3 "$SCRIPT_DIR/detect_people_blur.py" \
        --model "$MODEL_TYPE" \
        --confidence "$CONFIDENCE" \
        "$frame_file" "$output_file" > /dev/null 2>&1; then
        
        # Increment counter atomically
        (
            flock -x 200
            count=$(cat "$counter_file")
            count=$((count + 1))
            echo "$count" > "$counter_file"
            
            # Show progress every 50 frames
            if [ $((count % 50)) -eq 0 ]; then
                percentage=$(echo "$count $frame_count" | awk '{printf "%.1f", ($1/$2)*100}')
                echo "  Progress: $count/$frame_count (${percentage}%)"
            fi
        ) 200>"$counter_file.lock"
        
        return 0
    else
        echo "⚠ Warning: Detection failed for $frame_name, copying without processing..."
        cp "$frame_file" "$output_file"
        return 1
    fi
}

# Export function for parallel execution
export -f process_frame
export OUTPUT_DIR SCRIPT_DIR MODEL_TYPE CONFIDENCE counter_file frame_count

# Process frames in parallel using GNU parallel or xargs
start_time=$(date +%s)

if command -v parallel &> /dev/null; then
    # Use GNU parallel if available
    find "$PRE_INFILL_DIR" -name "*.jpg" -type f | \
        parallel -j "$PARALLEL_JOBS" process_frame {}
else
    # Fallback to xargs with -P
    find "$PRE_INFILL_DIR" -name "*.jpg" -type f | \
        xargs -I {} -P "$PARALLEL_JOBS" bash -c 'process_frame "$@"' _ {}
fi

end_time=$(date +%s)
processing_time=$((end_time - start_time))

# Final progress update
processed_count=$(cat "$counter_file")
echo "🏁 Processing complete!"
echo "Processed: $processed_count/$frame_count frames"
echo "Processing time: ${processing_time}s"

# Clean up
rm -rf "$temp_dir"

# Verify output
output_count=$(find "$OUTPUT_DIR" -name "*.jpg" -type f | wc -l)
echo "Output verification: $output_count frames in output directory"

if [ $output_count -eq $frame_count ]; then
    echo "✅ All frames processed successfully"
    
    # Calculate processing speed
    if [ $processing_time -gt 0 ]; then
        fps=$(echo "$frame_count $processing_time" | awk '{printf "%.1f", $1/$2}')
        echo "📊 Processing speed: ${fps} frames/second"
    fi
else
    echo "⚠️ Warning: Frame count mismatch (input: $frame_count, output: $output_count)"
fi

echo "🎉 Session processing complete: $SESSION_NAME"
echo "📁 Output available in: $OUTPUT_DIR"