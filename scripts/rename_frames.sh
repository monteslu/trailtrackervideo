#!/bin/bash
cd sessions/stadcon

start_timestamp=1755525205
video_duration=2430.144
total_extracted=72831

# Calculate milliseconds per frame
ms_per_frame=$(echo "$video_duration $total_extracted" | awk '{printf "%.10f", ($1 * 1000) / $2}')
echo "Milliseconds per frame: $ms_per_frame"
echo "Starting renaming process..."

frame_count=0
for frame_file in temp_frame_*.jpg; do
    if [ ! -f "$frame_file" ]; then
        break
    fi
    
    # Calculate timestamp for this frame
    frame_timestamp_ms=$(echo "$start_timestamp $frame_count $ms_per_frame" | awk '{printf "%.0f", $1 * 1000 + $2 * $3}')
    
    # Rename the frame
    mv "$frame_file" "${frame_timestamp_ms}.jpg"
    
    frame_count=$((frame_count + 1))
    
    # Show progress every 5000 frames
    if [ $((frame_count % 5000)) -eq 0 ]; then
        percentage=$(echo "$frame_count $total_extracted" | awk '{printf "%.1f", ($1/$2)*100}')
        echo "Renamed: $frame_count/$total_extracted (${percentage}%)"
    fi
done

echo "Renaming complete: $frame_count frames"