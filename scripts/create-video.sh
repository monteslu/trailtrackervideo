#!/bin/bash

# Bike Trail Video Creator
# Converts processed images from a session folder into an MP4 video using ffmpeg

# Usage: ./create-video.sh <session_name> [framerate] [quality] [size]
# Example: ./create-video.sh h1 30 23 1080p

# Default values
DEFAULT_FRAMERATE=30
DEFAULT_QUALITY=23  # Lower is better quality (18-28 range)
DEFAULT_SIZE="original"  # original, 1080p, 720p, 4k

# Check if session name is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <session_name> [framerate] [quality] [size]"
    echo ""
    echo "Arguments:"
    echo "  session_name  - Name of the session folder in output/ directory"
    echo "  framerate     - Video framerate (default: $DEFAULT_FRAMERATE fps)"
    echo "  quality       - Video quality 18-28, lower=better (default: $DEFAULT_QUALITY)"
    echo "  size          - Video size: original, 1080p, 720p, 4k (default: $DEFAULT_SIZE)"
    echo ""
    echo "Examples:"
    echo "  $0 h1                    # Create video with default settings (2560x1440)"
    echo "  $0 h1 24                 # Create video at 24fps"
    echo "  $0 h1 30 20              # Create video at 30fps with quality 20"
    echo "  $0 h1 30 23 1080p        # Create 1080p video (1920x1080)"
    echo ""
    exit 1
fi

SESSION_NAME="$1"
FRAMERATE="${2:-$DEFAULT_FRAMERATE}"
QUALITY="${3:-$DEFAULT_QUALITY}"
SIZE="${4:-$DEFAULT_SIZE}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INPUT_DIR="$PROJECT_DIR/output/$SESSION_NAME"
OUTPUT_DIR="$PROJECT_DIR/videos"
OUTPUT_FILE="$OUTPUT_DIR/${SESSION_NAME}_${FRAMERATE}fps_q${QUALITY}_${SIZE}.mp4"

# Set video dimensions based on size parameter
case "$SIZE" in
    "1080p")
        VIDEO_SIZE="1920x1080"
        ;;
    "720p")
        VIDEO_SIZE="1280x720"
        ;;
    "4k")
        VIDEO_SIZE="3840x2160"
        ;;
    "original")
        VIDEO_SIZE=""  # Use original image dimensions
        ;;
    *)
        echo "❌ Error: Invalid size '$SIZE'. Use: original, 1080p, 720p, or 4k"
        exit 1
        ;;
esac

echo "🚴‍♂️ Bike Trail Video Creator"
echo "================================"
echo "Session:     $SESSION_NAME"
echo "Input Dir:   $INPUT_DIR"
echo "Output File: $OUTPUT_FILE"
echo "Framerate:   ${FRAMERATE}fps"
echo "Quality:     $QUALITY (lower=better)"
echo "Size:        ${SIZE}${VIDEO_SIZE:+ ($VIDEO_SIZE)}"
echo ""

# Check if input directory exists
if [ ! -d "$INPUT_DIR" ]; then
    echo "❌ Error: Session directory '$INPUT_DIR' not found!"
    echo "Available sessions:"
    ls -la "$PROJECT_DIR/output/" 2>/dev/null | grep "^d" | awk '{print "  " $NF}' || echo "  (no sessions found)"
    exit 1
fi

# Count images in the directory
IMAGE_COUNT=$(find "$INPUT_DIR" -name "*.jpg" | wc -l)
if [ "$IMAGE_COUNT" -eq 0 ]; then
    echo "❌ Error: No .jpg images found in '$INPUT_DIR'"
    exit 1
fi

echo "📸 Found $IMAGE_COUNT images"

# Create videos directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Check if ffmpeg is available
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ Error: ffmpeg is not installed!"
    echo "Install ffmpeg:"
    echo "  macOS: brew install ffmpeg"
    echo "  Ubuntu: sudo apt install ffmpeg"
    echo "  Other: https://ffmpeg.org/download.html"
    exit 1
fi

echo "🎬 Starting video creation..."

# Calculate estimated duration
DURATION=$(echo "scale=1; $IMAGE_COUNT / $FRAMERATE" | bc -l)
echo "📊 Estimated video duration: ${DURATION}s"

# Create the video using ffmpeg
# -pattern_type glob: Use glob pattern for input
# -framerate: Input framerate
# -i: Input pattern (sorted by filename)
# -vf scale: Scale video to specified size (if not original)
# -c:v libx264: Use H.264 codec
# -crf: Constant Rate Factor (quality)
# -pix_fmt yuv420p: Pixel format for compatibility
# -movflags +faststart: Optimize for web streaming
# -y: Overwrite output file if exists

if [ -n "$VIDEO_SIZE" ]; then
    # Scale video to specified size
    ffmpeg \
        -pattern_type glob \
        -framerate "$FRAMERATE" \
        -i "$INPUT_DIR/*.jpg" \
        -vf "scale=$VIDEO_SIZE" \
        -c:v libx264 \
        -crf "$QUALITY" \
        -pix_fmt yuv420p \
        -movflags +faststart \
        -y \
        "$OUTPUT_FILE"
else
    # Use original image dimensions
    ffmpeg \
        -pattern_type glob \
        -framerate "$FRAMERATE" \
        -i "$INPUT_DIR/*.jpg" \
        -c:v libx264 \
        -crf "$QUALITY" \
        -pix_fmt yuv420p \
        -movflags +faststart \
        -y \
        "$OUTPUT_FILE"
fi

# Check if ffmpeg succeeded
if [ $? -eq 0 ]; then
    # Get output file size
    FILE_SIZE=$(ls -lh "$OUTPUT_FILE" | awk '{print $5}')
    
    echo ""
    echo "✅ Video created successfully!"
    echo "📁 Output: $OUTPUT_FILE"
    echo "📏 Size: $FILE_SIZE"
    echo "🎯 Settings: ${FRAMERATE}fps, quality $QUALITY"
    echo ""
    echo "🎬 You can now play your bike trail video:"
    echo "   open '$OUTPUT_FILE'"
    
else
    echo ""
    echo "❌ Error: Video creation failed!"
    echo "Check the ffmpeg output above for details."
    exit 1
fi