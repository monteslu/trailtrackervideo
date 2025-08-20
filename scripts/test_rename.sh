#!/bin/bash
cd /home/monteslu/code/mine/trailtrackervideo/sessions/stadcon

start_timestamp=1755525205
video_duration=2430.144
total_extracted=72831

ms_per_frame=$(echo "$video_duration $total_extracted" | awk '{printf "%.10f", ($1 * 1000) / $2}')
echo "Starting test rename of first 10 frames..."
echo "ms_per_frame: $ms_per_frame"

frame_count=0
for ((i=1; i<=10; i++)); do
    frame_file="temp_frame_$(printf "%08d" $i).jpg"
    
    if [ ! -f "$frame_file" ]; then
        echo "Frame $frame_file not found"
        continue
    fi
    
    frame_timestamp_ms=$(echo "$start_timestamp $frame_count $ms_per_frame" | awk '{printf "%.0f", $1 * 1000 + $2 * $3}')
    
    echo "Renaming $frame_file to ${frame_timestamp_ms}.jpg"
    mv "$frame_file" "${frame_timestamp_ms}.jpg"
    
    frame_count=$((frame_count + 1))
done

echo "Test rename complete. Renamed $frame_count frames."