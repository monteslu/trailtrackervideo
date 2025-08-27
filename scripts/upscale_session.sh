#!/bin/bash

# Usage: ./scripts/upscale_session.sh <session_name>
# Example: ./scripts/upscale_session.sh "stadcon"

if [ $# -ne 1 ]; then
    echo "Usage: $0 <session_name>"
    echo "Example: $0 \"stadcon\""
    exit 1
fi

SESSION_NAME="$1"
SOURCE_DIR="sessions/$SESSION_NAME"
OUTPUT_DIR="sessions1440p/$SESSION_NAME"
TEMP_DIR="/tmp/upscale_$$"

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Session directory '$SOURCE_DIR' not found"
    exit 1
fi

# Check if Real-ESRGAN is installed
if ! command -v realesrgan-ncnn-vulkan &> /dev/null; then
    echo "Error: Real-ESRGAN not found. Install it with:"
    echo "  sudo apt install ffmpeg"
    exit 1
fi

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg not found. Install it with:"
    echo "  sudo apt install ffmpeg"
    exit 1
fi

# Check if models are available
MODEL_PATHS=(
    "/usr/local/share/realesrgan-models"
    "/usr/local/bin/models" 
    "./models"
)

MODEL_FOUND=false
for model_path in "${MODEL_PATHS[@]}"; do
    if [ -f "$model_path/realesrgan-x4plus.param" ] && [ -f "$model_path/realesrgan-x4plus.bin" ]; then
        MODEL_FOUND=true
        MODEL_DIR="$model_path"
        break
    fi
done

if [ "$MODEL_FOUND" = false ]; then
    echo "Error: Real-ESRGAN models not found"
    exit 1
fi

echo "🤖 Using AI models from: $MODEL_DIR"

# Create output directory
mkdir -p "$OUTPUT_DIR"
mkdir -p "$TEMP_DIR"

echo "🎬 Upscaling session: $SESSION_NAME"
echo "📁 Source: $SOURCE_DIR"
echo "📁 Output: $OUTPUT_DIR"

# Count JPEG files
TOTAL_FILES=$(find "$SOURCE_DIR" -maxdepth 1 -name "*.jpg" -o -name "*.jpeg" | wc -l)

if [ "$TOTAL_FILES" -eq 0 ]; then
    echo "Error: No JPEG files found in $SOURCE_DIR"
    exit 1
fi

echo "🖼️  Found $TOTAL_FILES images to upscale"

# Determine number of parallel jobs
# Check available GPU memory to determine safe parallel count
GPU_MEM=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1)
if [ -n "$GPU_MEM" ] && [ "$GPU_MEM" -gt 8000 ]; then
    # If more than 8GB free, can do 4 parallel
    PARALLEL_JOBS=4
elif [ -n "$GPU_MEM" ] && [ "$GPU_MEM" -gt 4000 ]; then
    # If more than 4GB free, can do 2 parallel
    PARALLEL_JOBS=2
else
    # AMD GPU or low memory - test with 2 parallel, adjust if needed
    PARALLEL_JOBS=2
fi

# Allow override via environment variable
if [ -n "$UPSCALE_PARALLEL" ]; then
    PARALLEL_JOBS=$UPSCALE_PARALLEL
fi

echo "🚀 Starting high-quality upscaling (1920x1080 → 2560x1440)"
echo "⚡ Using $PARALLEL_JOBS parallel jobs"

# Performance tracking
START_TIME=$(date +%s)
PROCESSED=0

# Function to process a single image
process_image() {
    local img="$1"
    local basename=$(basename "$img")
    local output_file="$OUTPUT_DIR/$basename"
    
    # Skip if already processed
    if [ -f "$output_file" ]; then
        echo "  ⏭️  Skipping $basename (already exists)"
        return 0
    fi
    
    # Track per-image time
    local img_start=$(date +%s.%N)
    
    # High-quality upscaling using ffmpeg Lanczos (best balance of speed/quality for 1.33x scale)
    ffmpeg -i "$img" \
        -vf "scale=2560:1440:flags=lanczos" \
        -q:v 2 \
        -y \
        "$output_file" \
        2>/dev/null
    
    local result=$?
    local img_end=$(date +%s.%N)
    local img_time=$(echo "$img_end - $img_start" | bc -l | cut -d. -f1-2)
    
    if [ $result -eq 0 ]; then
        local orig_size=$(du -h "$img" | cut -f1)
        local new_size=$(du -h "$output_file" | cut -f1)
        echo "  ✅ $basename done in ${img_time}s (${orig_size} → ${new_size})"
        return 0
    else
        echo "  ❌ $basename failed"
        return 1
    fi
}

# Export function and variables for parallel to use
export -f process_image
export OUTPUT_DIR
export TEMP_DIR
export MODEL_DIR

# Process images in parallel
echo "Processing images..."

# Use GNU parallel if available, otherwise use xargs
if command -v parallel &> /dev/null; then
    echo "Using GNU parallel for processing..."
    find "$SOURCE_DIR" -maxdepth 1 \( -name "*.jpg" -o -name "*.jpeg" \) -type f | \
        parallel -j $PARALLEL_JOBS --progress --eta process_image {}
    PROCESSED=$(find "$OUTPUT_DIR" -maxdepth 1 \( -name "*.jpg" -o -name "*.jpeg" \) -type f | wc -l)
else
    echo "Using xargs for parallel processing (install GNU parallel for better progress tracking)"
    find "$SOURCE_DIR" -maxdepth 1 \( -name "*.jpg" -o -name "*.jpeg" \) -type f | \
        xargs -P $PARALLEL_JOBS -I {} bash -c 'process_image "$@"' _ {}
    PROCESSED=$(find "$OUTPUT_DIR" -maxdepth 1 \( -name "*.jpg" -o -name "*.jpeg" \) -type f | wc -l)
fi

# Copy non-image files (json, etc)
echo "📄 Copying metadata files..."
for file in "$SOURCE_DIR"/*.json "$SOURCE_DIR"/*.txt; do
    [ -f "$file" ] || continue
    cp "$file" "$OUTPUT_DIR/"
    echo "  📋 Copied $(basename "$file")"
done

# Calculate total time and performance
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
MINUTES=$((TOTAL_TIME / 60))
SECONDS=$((TOTAL_TIME % 60))

if [ "$PROCESSED" -gt 0 ]; then
    AVG_TIME=$((TOTAL_TIME / PROCESSED))
    FPS=$(echo "scale=2; $PROCESSED / $TOTAL_TIME" | bc -l)
else
    AVG_TIME=0
    FPS=0
fi

# Check output
OUTPUT_COUNT=$(find "$OUTPUT_DIR" -maxdepth 1 -name "*.jpg" -o -name "*.jpeg" | wc -l)

# Get sample image dimensions to verify upscaling
if [ "$OUTPUT_COUNT" -gt 0 ]; then
    SAMPLE_IMG=$(find "$OUTPUT_DIR" -maxdepth 1 -name "*.jpg" -o -name "*.jpeg" | head -1)
    DIMENSIONS=$(identify -format "%wx%h" "$SAMPLE_IMG" 2>/dev/null || echo "unknown")
else
    DIMENSIONS="unknown"
fi

# Clean up
rm -rf "$TEMP_DIR"

echo ""
echo "=========================================="
echo "✅ Upscaling Complete!"
echo "=========================================="
echo "📁 Output directory: $OUTPUT_DIR"
echo "🖼️  Images processed: $PROCESSED/$TOTAL_FILES"
echo "📐 Output resolution: $DIMENSIONS"
echo "⏱️  Total time: ${MINUTES}m ${SECONDS}s"
echo "⚡ Average per image: ${AVG_TIME}s"
echo "🔥 Processing speed: ${FPS} images/sec"
echo ""

# Performance recommendations
if [ "$AVG_TIME" -gt 2 ]; then
    echo "💡 Performance tip: ffmpeg scaling should be very fast"
    echo "   If slow, check system CPU/disk performance"
elif [ "$AVG_TIME" -lt 1 ]; then
    echo "🚀 Great performance! ffmpeg scaling is working efficiently."
fi

echo ""
echo "Next steps:"
echo "  1. Review quality: ls $OUTPUT_DIR"
echo "  2. Process video: ./process_frames.sh $OUTPUT_DIR"
echo "  3. Add music: ./scripts/add_music_to_vid.sh output.mp4 music.mp3 final.mp4"