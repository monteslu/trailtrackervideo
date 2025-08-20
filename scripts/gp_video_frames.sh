#!/bin/bash

# GoPro Video Frame Extraction Script
# Extracts frames from GoPro MP4 videos and names them with unix timestamps
# Usage: ./gp_video_frames.sh <session_name>

if [ $# -eq 0 ]; then
    echo "Usage: $0 <session_name>"
    echo "Example: $0 TrailSync_Mesa_17-08-2025_20_19_20250817_202517"
    exit 1
fi

SESSION_NAME="$1"
GOPRO_DIR="gopro/${SESSION_NAME}"
OUTPUT_DIR="sessions/${SESSION_NAME}"

# Check if gopro directory exists
if [ ! -d "$GOPRO_DIR" ]; then
    echo "Error: GoPro directory '$GOPRO_DIR' does not exist"
    exit 1
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

echo "Processing GoPro videos from: $GOPRO_DIR"
echo "Output directory: $OUTPUT_DIR"

# Process each MP4 file in the gopro session directory
for video_file in "$GOPRO_DIR"/*.MP4 "$GOPRO_DIR"/*.mp4; do
    # Check if file exists (handles case where no MP4 files are found)
    if [ ! -f "$video_file" ]; then
        continue
    fi
    
    echo "Processing: $(basename "$video_file")"
    
    # Extract creation time from video metadata using ffprobe
    # Try different metadata fields that GoPro might use
    creation_time=$(ffprobe -v quiet -select_streams v:0 -show_entries stream_tags=creation_time -of csv=p=0 "$video_file" 2>/dev/null)
    
    if [ -z "$creation_time" ]; then
        # Try format-level creation time
        creation_time=$(ffprobe -v quiet -show_entries format_tags=creation_time -of csv=p=0 "$video_file" 2>/dev/null)
    fi
    
    if [ -z "$creation_time" ]; then
        echo "Warning: Could not extract creation time from $(basename "$video_file"), using file modification time"
        # Fallback to file modification time
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            creation_time=$(stat -f "%Sm" -t "%Y-%m-%dT%H:%M:%SZ" "$video_file")
        else
            # Linux
            creation_time=$(stat -c "%y" "$video_file" | sed 's/ /T/' | sed 's/\.[0-9]* /Z/')
        fi
    fi
    
    # Convert creation time to unix timestamp
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS date command
        start_timestamp=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$creation_time" "+%s" 2>/dev/null)
    else
        # Linux date command  
        start_timestamp=$(date -d "$creation_time" "+%s" 2>/dev/null)
    fi
    
    if [ -z "$start_timestamp" ]; then
        echo "Error: Could not parse creation time '$creation_time' for $(basename "$video_file")"
        continue
    fi
    
    echo "Video start time: $creation_time (timestamp: $start_timestamp)"
    
    # Get video duration for precise timestamp calculation
    video_duration=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$video_file")
    echo "Video duration: ${video_duration} seconds"
    
    # Get video frame rate
    frame_rate=$(ffprobe -v quiet -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$video_file")
    
    # Convert fraction to decimal (e.g., "30/1" to "30")
    if [[ "$frame_rate" == *"/"* ]]; then
        frame_rate=$(echo "$frame_rate" | awk -F'/' '{printf "%.6f", $1/$2}')
    fi
    
    echo "Frame rate: ${frame_rate} fps"
    
    # Check if frames already exist
    existing_frames=$(find "${OUTPUT_DIR}" -name "temp_frame_*.jpg" -type f 2>/dev/null | wc -l)
    if [ "$existing_frames" -gt 0 ]; then
        echo "Found $existing_frames existing temp frames, skipping extraction..."
        final_count=$existing_frames
    else
        echo "Extracting frames..."
        
        # Extract frames directly to output directory to avoid temp space issues
        echo "Extracting directly to: $OUTPUT_DIR"
        echo "Running: ffmpeg -i \"$video_file\" -vf \"fps=${frame_rate}\" -q:v 2 \"${OUTPUT_DIR}/temp_frame_%08d.jpg\""
    
        # Capture ffmpeg stderr to a file for debugging
        ffmpeg_log="${OUTPUT_DIR}/ffmpeg.log"
        ffmpeg -i "$video_file" -vf "fps=${frame_rate}" -q:v 2 "${OUTPUT_DIR}/temp_frame_%08d.jpg" -y 2>"$ffmpeg_log" &
        ffmpeg_pid=$!
        
        # Monitor progress by counting files
        frame_count=0
        last_displayed=0
        while kill -0 $ffmpeg_pid 2>/dev/null; do
            # Use find with -maxdepth to count files more efficiently
            current_count=$(find "${OUTPUT_DIR}" -maxdepth 1 -name "temp_frame_*.jpg" -type f 2>/dev/null | wc -l)
            if [ $current_count -gt $frame_count ]; then
                frame_count=$current_count
                # Update display every 100 frames
                if [ $((frame_count - last_displayed)) -ge 100 ]; then
                    echo -ne "\rExtracting: $frame_count frames"
                    last_displayed=$frame_count
                fi
            fi
            sleep 0.5
        done
        
        # Wait for ffmpeg to complete
        wait $ffmpeg_pid
        ffmpeg_exit_code=$?
        
        # Give filesystem a moment to sync
        sleep 1
        
        # Final count
        final_count=$(find "${OUTPUT_DIR}" -maxdepth 1 -name "temp_frame_*.jpg" -type f 2>/dev/null | wc -l)
        echo -e "\rExtracting: $final_count frames - Complete!"
        
        # Check if ffmpeg failed
        if [ $ffmpeg_exit_code -ne 0 ]; then
            echo "FFmpeg extraction failed with exit code $ffmpeg_exit_code. Checking error log..."
            if [ -f "$ffmpeg_log" ]; then
                echo "FFmpeg error output:"
                tail -20 "$ffmpeg_log"
            fi
            # Clean up temp files
            rm -f "${OUTPUT_DIR}"/temp_frame_*.jpg
            continue
        fi
        
        if [ $final_count -eq 0 ]; then
            echo "No frames found in output directory. Checking if ffmpeg wrote elsewhere..."
            echo "Output directory contents:"
            ls -la "$OUTPUT_DIR"
            if [ -f "$ffmpeg_log" ]; then
                echo "FFmpeg log:"
                tail -10 "$ffmpeg_log"
            fi
            continue
        fi
    fi
    
    echo -e "\nRenaming frames with timestamps..."
    
    # Count actual extracted frames
    total_extracted=$(find "${OUTPUT_DIR}" -name "temp_frame_*.jpg" -type f 2>/dev/null | wc -l)
    echo "Total frames extracted: $total_extracted"
    
    # Check if frames were extracted
    if [ "$total_extracted" -eq 0 ]; then
        echo "Error: No frames were extracted from the video"
        continue
    fi
    
    # Calculate precise time per frame based on actual frame count and video duration
    # This ensures the last frame aligns with video end time
    ms_per_frame=$(echo "$video_duration $total_extracted" | awk '{printf "%.10f", ($1 * 1000) / $2}')
    echo "Milliseconds per frame: ${ms_per_frame}"
    
    # Rename frames with unix timestamps and show progress
    # Process files by number to avoid shell limitations with large file counts
    frame_count=0
    for ((i=1; i<=total_extracted; i++)); do
        frame_file="${OUTPUT_DIR}/temp_frame_$(printf "%08d" $i).jpg"
        
        if [ ! -f "$frame_file" ]; then
            continue
        fi
        
        # Calculate timestamp for this frame using precise timing
        # timestamp_ms = start_timestamp * 1000 + (frame_count * ms_per_frame)
        # Using higher precision to avoid cumulative rounding errors
        frame_timestamp_ms=$(echo "$start_timestamp $frame_count $ms_per_frame" | \
            awk '{printf "%.0f", $1 * 1000 + $2 * $3}')
        
        # Rename frame with timestamp
        mv "$frame_file" "${OUTPUT_DIR}/${frame_timestamp_ms}.jpg"
        
        frame_count=$((frame_count + 1))
        
        # Show rename progress every 1000 frames
        if [ $((frame_count % 1000)) -eq 0 ]; then
            percentage=$(echo "$frame_count $total_extracted" | awk '{printf "%.1f", ($1/$2)*100}')
            echo -ne "\rRenaming: $frame_count/$total_extracted (${percentage}%)"
        fi
    done
    
    echo -e "\nExtracted $frame_count frames from $(basename "$video_file")"
    
    # Extract GPS data from the video file
    echo "Extracting GPS data from $(basename "$video_file")..."
    
    # Check for GoPro telemetry streams
    telemetry_streams=$(ffprobe -v quiet -show_streams "$video_file" 2>/dev/null | grep -E "codec_name=bin_data|codec_tag_string=gpmd|codec_name=gpmd")
    
    if [ ! -z "$telemetry_streams" ]; then
        echo "Found GoPro telemetry streams"
        
        # Create GPS JSON file for this video in the sessions directory
        video_basename=$(basename "$video_file" | sed 's/\.[^.]*$//')
        gps_file="${OUTPUT_DIR}/${video_basename}_gps.json"
        
        # Try extracting all streams to see what we have
        echo "Available streams:"
        ffprobe -v quiet -show_streams "$video_file" 2>/dev/null | grep -E "index=|codec_name=|codec_tag_string="
        
        # Extract the raw GPMF data from stream 3
        ffmpeg -i "$video_file" -map 0:3 -f data -c copy "${gps_file%.json}.bin" 2>/dev/null
        
        if [ -s "${gps_file%.json}.bin" ]; then
            echo "Raw GPMF data extracted, parsing GPS coordinates..."
            
            # Fast GPMF GPS parser using Node.js
            echo "Parsing GPS coordinates from GPMF data..."
            
            # Use Node.js script for fast binary parsing with video timing info
            script_dir=$(dirname "$0")
            video_duration=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$video_file" 2>/dev/null)
            gps_parsed=$(node "$script_dir/parse_gpmf.js" "${gps_file%.json}.bin" "$start_timestamp" "$video_duration" 2>/dev/null)
            
            if [ $? -eq 0 ] && [ ! -z "$gps_parsed" ]; then
                echo "GPS coordinates parsed successfully"
                gps_entries="$gps_parsed"
            else
                echo "GPS parsing failed, creating basic info"
                gps_count=$(grep -aboP "GPS " "${gps_file%.json}.bin" | wc -l)
                gps_entries="{\"gps_markers_found\": $gps_count, \"parsing_status\": \"failed\"}"
            fi
            
            # Create GPS JSON with parsed data
            cat > "$gps_file" << EOF
{
  "format": "GPMF",
  "video_file": "$(basename "$video_file")",
  "raw_data_size": $(stat -c%s "${gps_file%.json}.bin"),
  "gps_data": $gps_entries
}
EOF
            
            echo "Basic GPMF parsing completed"
        else
            echo "Failed to extract GPMF data"
            ffprobe -v quiet -print_format json -show_streams "$video_file" > "$gps_file" 2>/dev/null
        fi
        
        if [ -s "$gps_file" ]; then
            echo "Stream data saved to: ${video_basename}_gps.json"
        else
            echo "Warning: No data could be extracted from $(basename "$video_file")"
            rm -f "$gps_file"
        fi
    else
        echo "No GoPro telemetry streams found. Available streams:"
        ffprobe -v quiet -show_streams "$video_file" 2>/dev/null | grep -E "index=|codec_name=|codec_tag_string="
    fi
    
    # Clean up ffmpeg log (frames should already be renamed at this point)
    rm -f "${OUTPUT_DIR}/ffmpeg.log"
done

echo "Frame extraction completed!"
echo "Total frames in output directory:"
ls -1 "$OUTPUT_DIR"/*.jpg 2>/dev/null | wc -l

# Combine all GPS files into a single goprogps.json
gps_files=("$OUTPUT_DIR"/*_gps.json)
if [ -f "${gps_files[0]}" ]; then
    echo "Combining GPS data files..."
    
    combined_gps_file="${OUTPUT_DIR}/goprogps.json"
    echo "{" > "$combined_gps_file"
    echo "  \"videos\": [" >> "$combined_gps_file"
    
    first_file=true
    for gps_file in "${gps_files[@]}"; do
        if [ -f "$gps_file" ]; then
            if [ "$first_file" = false ]; then
                echo "," >> "$combined_gps_file"
            fi
            
            video_name=$(basename "$gps_file" "_gps.json")
            echo "    {" >> "$combined_gps_file"
            echo "      \"filename\": \"$video_name\"," >> "$combined_gps_file"
            echo "      \"gps_data\":" >> "$combined_gps_file"
            cat "$gps_file" | sed 's/^/      /' >> "$combined_gps_file"
            echo "    }" >> "$combined_gps_file"
            
            first_file=false
        fi
    done
    
    echo "  ]" >> "$combined_gps_file"
    echo "}" >> "$combined_gps_file"
    
    echo "Combined GPS data saved to: goprogps.json"
    
    # Clean up individual GPS files
    rm -f "$OUTPUT_DIR"/*_gps.json
else
    echo "No GPS data files found to combine"
fi