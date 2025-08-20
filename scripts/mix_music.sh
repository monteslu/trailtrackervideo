#!/bin/bash

# Usage: ./scripts/mix_music.sh <output_name> <num_songs>
# Example: ./scripts/mix_music.sh "my_mix" 5

if [ $# -ne 2 ]; then
    echo "Usage: $0 <output_name> <num_songs>"
    echo "Example: $0 \"my_mix\" 5"
    exit 1
fi

OUTPUT_NAME="$1"
NUM_SONGS="$2"
SONGS_DIR="./songs"
OUTPUT_DIR="./songsout"
OUTPUT_FILE="${OUTPUT_DIR}/${OUTPUT_NAME}.mp3"
TEMP_DIR="/tmp/music_mix_$$"

# Check if songs directory exists
if [ ! -d "$SONGS_DIR" ]; then
    echo "Error: Songs directory '$SONGS_DIR' not found"
    exit 1
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Create temp directory
mkdir -p "$TEMP_DIR"

echo "🎵 Creating music mix: $OUTPUT_NAME with $NUM_SONGS songs"

# Get all MP3 files and shuffle them
mapfile -t ALL_SONGS < <(find "$SONGS_DIR" -name "*.mp3" -type f | shuf)

if [ ${#ALL_SONGS[@]} -eq 0 ]; then
    echo "Error: No MP3 files found in $SONGS_DIR"
    exit 1
fi

# Take only the requested number of songs
SELECTED_SONGS=("${ALL_SONGS[@]:0:$NUM_SONGS}")

if [ ${#SELECTED_SONGS[@]} -lt $NUM_SONGS ]; then
    echo "Warning: Only ${#SELECTED_SONGS[@]} songs available, requested $NUM_SONGS"
    NUM_SONGS=${#SELECTED_SONGS[@]}
fi

echo "Selected songs:"
for i in "${!SELECTED_SONGS[@]}"; do
    echo "  $((i+1)). $(basename "${SELECTED_SONGS[$i]}")"
done

# Step 1: Normalize volume and detect/trim quiet endings
echo "🔊 Normalizing volume and analyzing endings..."
NORMALIZED_SONGS=()
for i in "${!SELECTED_SONGS[@]}"; do
    song="${SELECTED_SONGS[$i]}"
    normalized_file="$TEMP_DIR/normalized_$(printf "%02d" $i).mp3"
    
    echo "  Processing $(basename "$song")..."
    
    # Simple approach - just detect obvious silence at start and end
    # Get total duration first
    TOTAL_DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$song" 2>/dev/null)
    
    # Detect silence periods
    SILENCE_DETECT=$(ffmpeg -i "$song" -af "silencedetect=noise=-40dB:d=0.5" -f null - 2>&1)
    
    # Find start trim point (end of first silence if it starts at 0)
    START_TRIM=0
    if echo "$SILENCE_DETECT" | grep -q "silence_start: 0"; then
        START_TRIM=$(echo "$SILENCE_DETECT" | grep "silence_start: 0" -A1 | grep "silence_end" | head -1 | grep -oP "(?<=silence_end: )[0-9.]+" || echo "0")
        if [ -n "$START_TRIM" ] && [ "$START_TRIM" != "0" ]; then
            echo "    Trimming ${START_TRIM}s of silence from beginning"
        fi
    fi
    
    # Find end trim point (start of last silence if near end)
    END_DURATION=""
    LAST_SILENCE=$(echo "$SILENCE_DETECT" | grep "silence_start" | tail -1 | grep -oP "(?<=silence_start: )[0-9.]+")
    if [ -n "$LAST_SILENCE" ] && [ -n "$TOTAL_DURATION" ]; then
        # Check if this silence is near the end (last 20% of song)
        EIGHTY_PERCENT=$(echo "$TOTAL_DURATION * 0.8" | bc -l)
        if (( $(echo "$LAST_SILENCE > $EIGHTY_PERCENT" | bc -l) )); then
            END_DURATION=$(echo "$LAST_SILENCE - $START_TRIM" | bc -l)
            echo "    Trimming silence at end (${LAST_SILENCE}s)"
        fi
    fi
    
    # Build ffmpeg command
    FFMPEG_CMD="ffmpeg -i \"$song\""
    
    # Add start trim if needed
    if [ "$START_TRIM" != "0" ] && [ -n "$START_TRIM" ]; then
        FFMPEG_CMD="$FFMPEG_CMD -ss $START_TRIM"
    fi
    
    # Add duration limit if needed
    if [ -n "$END_DURATION" ]; then
        FFMPEG_CMD="$FFMPEG_CMD -t $END_DURATION"
    fi
    
    # Add normalization and output
    FFMPEG_CMD="$FFMPEG_CMD -af \"loudnorm=I=-16:TP=-1.5:LRA=11\" -c:a libmp3lame -b:a 192k -y \"$normalized_file\""
    
    # Execute the command
    eval $FFMPEG_CMD 2>/dev/null
    
    if [ $? -eq 0 ]; then
        NORMALIZED_SONGS+=("$normalized_file")
    else
        echo "Error processing $(basename "$song"), skipping..."
    fi
done

if [ ${#NORMALIZED_SONGS[@]} -eq 0 ]; then
    echo "Error: No songs were successfully normalized"
    exit 1
fi

echo "Successfully normalized ${#NORMALIZED_SONGS[@]} songs"

# Step 2: Create crossfaded mix
echo "🎛️  Creating seamless mix with crossfades..."

if [ ${#NORMALIZED_SONGS[@]} -eq 1 ]; then
    # Only one song, just copy it
    cp "${NORMALIZED_SONGS[0]}" "$OUTPUT_FILE"
else
    # Build ffmpeg command for crossfading
    INPUTS=""
    FILTERS=""
    
    # Add input files
    for song in "${NORMALIZED_SONGS[@]}"; do
        INPUTS="$INPUTS -i \"$song\""
    done
    
    # Create crossfade filter chain
    # 3 second crossfade between songs
    CROSSFADE_DURATION=3
    
    if [ ${#NORMALIZED_SONGS[@]} -eq 2 ]; then
        # Simple case: 2 songs
        FILTERS="[0][1]acrossfade=d=$CROSSFADE_DURATION[out]"
        OUTPUT_MAP="[out]"
    else
        # Multiple songs: chain crossfades
        FILTERS="[0][1]acrossfade=d=$CROSSFADE_DURATION[a1];"
        
        for (( i=2; i<${#NORMALIZED_SONGS[@]}; i++ )); do
            if [ $i -eq $((${#NORMALIZED_SONGS[@]}-1)) ]; then
                # Last crossfade
                FILTERS="${FILTERS}[a$((i-1))][$i]acrossfade=d=$CROSSFADE_DURATION[out]"
            else
                FILTERS="${FILTERS}[a$((i-1))][$i]acrossfade=d=$CROSSFADE_DURATION[a$i];"
            fi
        done
        OUTPUT_MAP="[out]"
    fi
    
    # Execute ffmpeg command
    eval "ffmpeg $INPUTS -filter_complex \"$FILTERS\" -map \"$OUTPUT_MAP\" -c:a libmp3lame -b:a 192k -y \"$OUTPUT_FILE\"" 2>/dev/null
fi

# Step 3: Create tracklist file
echo "📝 Creating tracklist..."
TRACKLIST_FILE="${OUTPUT_DIR}/${OUTPUT_NAME}.txt"

{
    echo "Music Mix: $OUTPUT_NAME"
    echo "Created: $(date)"
    echo "Songs: ${#NORMALIZED_SONGS[@]}"
    echo ""
    echo "Tracklist:"
    echo "=========="
    
    for i in "${!SELECTED_SONGS[@]}"; do
        song="${SELECTED_SONGS[$i]}"
        song_name=$(basename "$song" .mp3)
        
        # Get duration of original song
        song_duration=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$song" 2>/dev/null)
        if [ -n "$song_duration" ]; then
            song_minutes=$(echo "$song_duration" | awk '{print int($1/60)}')
            song_seconds=$(echo "$song_duration" | awk '{printf "%02d", int($1%60)}')
            duration_str="${song_minutes}:${song_seconds}"
        else
            duration_str="--:--"
        fi
        
        echo "$((i+1)). $song_name [$duration_str]"
    done
    
    echo ""
    echo "Mix Details:"
    echo "============"
    echo "Crossfade: 3 seconds between tracks"
    echo "Volume: Normalized to broadcast standard"
    echo "Quality: 192kbps MP3"
    
} > "$TRACKLIST_FILE"

# Clean up temp files
rm -rf "$TEMP_DIR"

if [ -f "$OUTPUT_FILE" ]; then
    # Get duration of final mix
    DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$OUTPUT_FILE" 2>/dev/null | cut -d. -f1)
    MINUTES=$((DURATION / 60))
    SECONDS=$((DURATION % 60))
    
    # Add final mix duration to tracklist
    echo "" >> "$TRACKLIST_FILE"
    echo "Final Mix Duration: ${MINUTES}m ${SECONDS}s" >> "$TRACKLIST_FILE"
    
    echo "✅ Music mix created successfully!"
    echo "📁 Output: $OUTPUT_FILE"
    echo "📝 Tracklist: $TRACKLIST_FILE"
    echo "⏱️  Duration: ${MINUTES}m ${SECONDS}s"
    echo "🎵 Songs: ${#NORMALIZED_SONGS[@]}"
else
    echo "❌ Error creating music mix"
    exit 1
fi