#!/bin/bash

# Usage: ./scripts/add_music_to_vid.sh <video_file> <music_file> <output_file>
# Example: ./scripts/add_music_to_vid.sh "ride.mp4" "songsout/my_mix.mp3" "ride_with_music.mp4"

if [ $# -ne 3 ]; then
    echo "Usage: $0 <video_file> <music_file> <output_file>"
    echo "Example: $0 \"ride.mp4\" \"songsout/my_mix.mp3\" \"ride_with_music.mp4\""
    exit 1
fi

VIDEO_FILE="$1"
MUSIC_FILE="$2"
OUTPUT_FILE="$3"

# Check if input files exist
if [ ! -f "$VIDEO_FILE" ]; then
    echo "Error: Video file '$VIDEO_FILE' not found"
    exit 1
fi

if [ ! -f "$MUSIC_FILE" ]; then
    echo "Error: Music file '$MUSIC_FILE' not found"
    exit 1
fi

echo "🎬 Adding music to video..."
echo "📹 Video: $(basename "$VIDEO_FILE")"
echo "🎵 Music: $(basename "$MUSIC_FILE")"
echo "📁 Output: $(basename "$OUTPUT_FILE")"

# Get video and audio durations
VIDEO_DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$VIDEO_FILE" 2>/dev/null)
MUSIC_DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$MUSIC_FILE" 2>/dev/null)

if [ -z "$VIDEO_DURATION" ] || [ -z "$MUSIC_DURATION" ]; then
    echo "Error: Could not determine file durations"
    exit 1
fi

VIDEO_MINUTES=$(echo "$VIDEO_DURATION" | awk '{print int($1/60)}')
VIDEO_SECONDS=$(echo "$VIDEO_DURATION" | awk '{print int($1%60)}')
MUSIC_MINUTES=$(echo "$MUSIC_DURATION" | awk '{print int($1/60)}')
MUSIC_SECONDS=$(echo "$MUSIC_DURATION" | awk '{print int($1%60)}')

echo "⏱️  Video duration: ${VIDEO_MINUTES}m ${VIDEO_SECONDS}s"
echo "⏱️  Music duration: ${MUSIC_MINUTES}m ${MUSIC_SECONDS}s"

# Determine strategy based on duration comparison
if (( $(echo "$MUSIC_DURATION >= $VIDEO_DURATION" | bc -l) )); then
    echo "🎵 Music is longer than video - will trim music to match video"
    STRATEGY="trim_music"
else
    echo "🎵 Music is shorter than video - will loop music to match video"
    STRATEGY="loop_music"
fi

# Create the output
echo "🔄 Processing..."

if [ "$STRATEGY" = "trim_music" ]; then
    # Music is longer - trim music to video length
    ffmpeg -i "$VIDEO_FILE" \
           -i "$MUSIC_FILE" \
           -c:v copy \
           -c:a aac \
           -b:a 128k \
           -map 0:v:0 \
           -map 1:a:0 \
           -t "$VIDEO_DURATION" \
           -avoid_negative_ts make_zero \
           -y \
           "$OUTPUT_FILE" 2>/dev/null
else
    # Music is shorter - loop music to match video length
    ffmpeg -stream_loop -1 \
           -i "$MUSIC_FILE" \
           -i "$VIDEO_FILE" \
           -c:v copy \
           -c:a aac \
           -b:a 128k \
           -map 1:v:0 \
           -map 0:a:0 \
           -t "$VIDEO_DURATION" \
           -avoid_negative_ts make_zero \
           -y \
           "$OUTPUT_FILE" 2>/dev/null
fi

# Check if output was created successfully
if [ -f "$OUTPUT_FILE" ]; then
    OUTPUT_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo "✅ Video with music created successfully!"
    echo "📁 Output: $OUTPUT_FILE"
    echo "💾 Size: $OUTPUT_SIZE"
    
    # Verify the output has both video and audio
    VIDEO_STREAMS=$(ffprobe -v quiet -select_streams v -show_entries stream=codec_type -of csv=p=0 "$OUTPUT_FILE" 2>/dev/null | wc -l)
    AUDIO_STREAMS=$(ffprobe -v quiet -select_streams a -show_entries stream=codec_type -of csv=p=0 "$OUTPUT_FILE" 2>/dev/null | wc -l)
    
    if [ "$VIDEO_STREAMS" -ge 1 ] && [ "$AUDIO_STREAMS" -ge 1 ]; then
        echo "✅ Output verified: Contains video and audio streams"
    else
        echo "⚠️  Warning: Output may be missing video or audio streams"
    fi
else
    echo "❌ Error creating video with music"
    exit 1
fi