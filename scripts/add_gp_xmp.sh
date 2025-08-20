#!/bin/bash

# Add GPS and metadata XMP data to extracted frame JPGs
# Reads JSON metadata and embeds GPS/location/weather data into JPEG XMP
# Usage: ./add_gp_xmp.sh <session_name>

if [ $# -eq 0 ]; then
    echo "Usage: $0 <session_name>"
    echo "Example: $0 TrailSync_Mesa_17-08-2025_20_19_20250817_202517"
    exit 1
fi

SESSION_NAME="$1"
GOPRO_DIR="gopro/${SESSION_NAME}"
SESSIONS_DIR="sessions/${SESSION_NAME}"

# Check if required directories exist
if [ ! -d "$GOPRO_DIR" ]; then
    echo "Error: GoPro directory '$GOPRO_DIR' does not exist"
    exit 1
fi

if [ ! -d "$SESSIONS_DIR" ]; then
    echo "Error: Sessions directory '$SESSIONS_DIR' does not exist"
    echo "Run gp_video_frames.sh first to extract frames"
    exit 1
fi

# Find JSON file in the gopro session directory
JSON_FILE=""
for json_candidate in "$GOPRO_DIR"/*.json; do
    if [ -f "$json_candidate" ]; then
        JSON_FILE="$json_candidate"
        break
    fi
done

if [ -z "$JSON_FILE" ]; then
    echo "Error: No JSON metadata file found in '$GOPRO_DIR'"
    echo "Expected: $GOPRO_DIR/*.json"
    exit 1
fi

# Check if exiftool is available
if ! command -v exiftool &> /dev/null; then
    echo "Error: exiftool is required but not installed"
    echo "Install with: sudo apt-get install libimage-exiftool-perl"
    exit 1
fi

echo "Processing session: $SESSION_NAME"
echo "JSON metadata file: $JSON_FILE"
echo "Sessions directory: $SESSIONS_DIR"

# Parse JSON and build metadata lookup
echo "Reading metadata from JSON file..."

# Count total metadata entries for progress tracking
total_entries=$(jq '.metadata | length' "$JSON_FILE" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$total_entries" ]; then
    echo "Error: Could not parse JSON file or 'metadata' array not found"
    exit 1
fi

echo "Found $total_entries metadata entries"

# Count JPG files for comparison
jpg_count=$(ls -1 "$SESSIONS_DIR"/*.jpg 2>/dev/null | wc -l)
echo "Found $jpg_count JPG files in sessions directory"

processed_count=0
matched_count=0
progress_interval=50  # Show progress more frequently
start_time=$(date +%s)

# Process each JPG file and find closest metadata
for jpg_file in "$SESSIONS_DIR"/*.jpg; do
    if [ ! -f "$jpg_file" ]; then
        continue
    fi
    
    jpg_timestamp=$(basename "$jpg_file" .jpg)
    
    # Find closest metadata entry by timestamp
    closest_entry=""
    min_diff=999999999
    
    for i in $(seq 0 $((total_entries - 1))); do
        entry_timestamp=$(jq -r ".metadata[$i].timestamp" "$JSON_FILE")
        
        if [ "$entry_timestamp" = "null" ] || [ -z "$entry_timestamp" ]; then
            continue
        fi
        
        diff=$((jpg_timestamp - entry_timestamp))
        if [ $diff -lt 0 ]; then
            diff=$((-diff))
        fi
        
        if [ $diff -lt $min_diff ]; then
            min_diff=$diff
            closest_entry=$(jq ".metadata[$i]" "$JSON_FILE")
        fi
    done
    
    if [ -z "$closest_entry" ]; then
        processed_count=$((processed_count + 1))
        continue
    fi
    
    # Convert timestamps to ISO format
    jpg_timestamp_iso=$(date -d "@$((jpg_timestamp / 1000))" -u +"%Y:%m:%d %H:%M:%S")
    jpg_timestamp_ms=$((jpg_timestamp % 1000))
    jpg_timestamp_formatted="${jpg_timestamp_iso}.$(printf "%03d" $jpg_timestamp_ms)Z"
    
    # Extract all metadata fields
    gps_lat=$(echo "$closest_entry" | jq -r '.gps.latitude // empty')
    gps_lon=$(echo "$closest_entry" | jq -r '.gps.longitude // empty')
    gps_alt=$(echo "$closest_entry" | jq -r '.gps.altitude // empty')
    gps_speed=$(echo "$closest_entry" | jq -r '.gps.speed // empty')
    gps_accuracy=$(echo "$closest_entry" | jq -r '.gps.accuracy // empty')
    gps_direction=$(echo "$closest_entry" | jq -r '.gps.direction // empty')
    gps_timestamp=$(echo "$closest_entry" | jq -r '.gps.timestamp // empty')
    
    # Weather data
    weather_temp=$(echo "$closest_entry" | jq -r '.weather.temperature // empty')
    weather_temp_unit=$(echo "$closest_entry" | jq -r '.weather.temperatureUnit // empty')
    weather_wind_speed=$(echo "$closest_entry" | jq -r '.weather.windSpeed // empty')
    weather_wind_speed_unit=$(echo "$closest_entry" | jq -r '.weather.windSpeedUnit // empty')
    weather_wind_dir=$(echo "$closest_entry" | jq -r '.weather.windDirection // empty')
    weather_code=$(echo "$closest_entry" | jq -r '.weather.weatherCode // empty')
    weather_fetched_at=$(echo "$closest_entry" | jq -r '.weather.fetchedAt // empty')
    
    # Location data
    loc_road=$(echo "$closest_entry" | jq -r '.location.road // empty')
    loc_neighborhood=$(echo "$closest_entry" | jq -r '.location.neighborhood // empty')
    loc_city=$(echo "$closest_entry" | jq -r '.location.city // empty')
    loc_county=$(echo "$closest_entry" | jq -r '.location.county // empty')
    loc_state=$(echo "$closest_entry" | jq -r '.location.state // empty')
    loc_postcode=$(echo "$closest_entry" | jq -r '.location.postcode // empty')
    loc_country=$(echo "$closest_entry" | jq -r '.location.country // empty')
    loc_fetched_at=$(echo "$closest_entry" | jq -r '.location.fetchedAt // empty')
    loc_update_reason=$(echo "$closest_entry" | jq -r '.location.updateReason // empty')
    
    # GoPro data
    gopro_filename=$(echo "$closest_entry" | jq -r '.goPro.filename // empty')
    gopro_sync_offset=$(echo "$closest_entry" | jq -r '.goPro.syncOffset // empty')
    gopro_battery=$(echo "$closest_entry" | jq -r '.goPro.battery // empty')
    gopro_recording=$(echo "$closest_entry" | jq -r '.goPro.isRecording // empty')
    gopro_timestamp=$(echo "$closest_entry" | jq -r '.goPro.timestamp // empty')
    
    # Accelerometer data
    accel_x=$(echo "$closest_entry" | jq -r '.accelerometer.x // empty')
    accel_y=$(echo "$closest_entry" | jq -r '.accelerometer.y // empty')
    accel_z=$(echo "$closest_entry" | jq -r '.accelerometer.z // empty')
    accel_timestamp=$(echo "$closest_entry" | jq -r '.accelerometer.timestamp // empty')
    
    # Build exiftool command with XMP fields
    exif_args=()
    
    # Basic XMP metadata
    exif_args+=("-XMP-xmp:CreateDate=$jpg_timestamp_formatted")
    exif_args+=("-XMP-xmp:CreatorTool=TrailSync")
    exif_args+=("-XMP-xmp:ModifyDate=$jpg_timestamp_formatted")
    exif_args+=("-XMP-xmp:MetadataDate=$jpg_timestamp_formatted")
    
    # Camera info
    exif_args+=("-XMP-tiff:Make=Google")
    exif_args+=("-XMP-tiff:Model=Pixel 7 Pro")
    exif_args+=("-XMP-tiff:Software=TrailSync Android")
    
    # GPS data in XMP-exif format
    if [ ! -z "$gps_lat" ] && [ "$gps_lat" != "null" ]; then
        # Convert decimal degrees to DMS format
        lat_dms=$(echo "$gps_lat" | awk '{
            deg = int($1); min = int(($1 - deg) * 60); sec = (($1 - deg) * 60 - min) * 60;
            printf "%.0f deg %.0f'\'' %.2f\\\" N", (deg < 0 ? -deg : deg), min, sec
        }')
        exif_args+=("-XMP-exif:GPSLatitude=$lat_dms")
        exif_args+=("-XMP-tt:Latitude=$gps_lat")
    fi
    
    if [ ! -z "$gps_lon" ] && [ "$gps_lon" != "null" ]; then
        lon_dms=$(echo "$gps_lon" | awk '{
            deg = int($1); min = int(($1 - deg) * 60); sec = (($1 - deg) * 60 - min) * 60;
            ref = ($1 < 0 ? "W" : "E"); if (deg < 0) deg = -deg;
            printf "%.0f deg %.0f'\'' %.2f\\\" %s", deg, min, sec, ref
        }')
        exif_args+=("-XMP-exif:GPSLongitude=$lon_dms")
        exif_args+=("-XMP-tt:Longitude=$gps_lon")
    fi
    
    if [ ! -z "$gps_alt" ] && [ "$gps_alt" != "null" ]; then
        exif_args+=("-XMP-exif:GPSAltitude=$gps_alt m")
        exif_args+=("-XMP-exif:GPSAltitudeRef=Above Sea Level")
        exif_args+=("-XMP-tt:Altitude=$gps_alt")
    fi
    
    if [ ! -z "$gps_speed" ] && [ "$gps_speed" != "null" ]; then
        speed_mph=$(echo "$gps_speed" | awk '{printf "%.6f", $1 * 2.23694}')
        exif_args+=("-XMP-exif:GPSSpeed=$speed_mph")
        exif_args+=("-XMP-exif:GPSSpeedRef=mph")
        exif_args+=("-XMP-tt:Speed=$speed_mph")
    fi
    
    if [ ! -z "$gps_direction" ] && [ "$gps_direction" != "null" ]; then
        exif_args+=("-XMP-exif:GPSImgDirection=$gps_direction")
        exif_args+=("-XMP-exif:GPSImgDirectionRef=Magnetic North")
        exif_args+=("-XMP-tt:Compass=$gps_direction")
        exif_args+=("-XMP-tt:GPSCompass=$gps_direction")
    fi
    
    if [ ! -z "$gps_timestamp" ] && [ "$gps_timestamp" != "null" ]; then
        gps_iso=$(date -d "@$((gps_timestamp / 1000))" -u +"%Y:%m:%d %H:%M:%S")
        gps_ms=$((gps_timestamp % 1000))
        gps_formatted="${gps_iso}.$(printf "%03d" $gps_ms)Z"
        exif_args+=("-XMP-exif:GPSDateTime=$gps_formatted")
        exif_args+=("-XMP-tt:GPSTimestamp=$gps_timestamp")
    fi
    
    if [ ! -z "$gps_accuracy" ] && [ "$gps_accuracy" != "null" ]; then
        exif_args+=("-XMP-exif:GPSDOP=$gps_accuracy")
        exif_args+=("-XMP-tt:Accuracy=$gps_accuracy")
    fi
    
    # TrailTracker custom fields
    exif_args+=("-XMP-tt:TimestampMs=$jpg_timestamp")
    
    # Weather data
    [ ! -z "$weather_temp" ] && [ "$weather_temp" != "null" ] && exif_args+=("-XMP-tt:WeatherTemperature=$weather_temp")
    [ ! -z "$weather_temp_unit" ] && [ "$weather_temp_unit" != "null" ] && exif_args+=("-XMP-tt:WeatherTemperatureUnit=$weather_temp_unit")
    [ ! -z "$weather_wind_speed" ] && [ "$weather_wind_speed" != "null" ] && exif_args+=("-XMP-tt:WeatherWindSpeed=$weather_wind_speed")
    [ ! -z "$weather_wind_speed_unit" ] && [ "$weather_wind_speed_unit" != "null" ] && exif_args+=("-XMP-tt:WeatherWindSpeedUnit=$weather_wind_speed_unit")
    [ ! -z "$weather_wind_dir" ] && [ "$weather_wind_dir" != "null" ] && exif_args+=("-XMP-tt:WeatherWindDirection=$weather_wind_dir")
    [ ! -z "$weather_code" ] && [ "$weather_code" != "null" ] && exif_args+=("-XMP-tt:WeatherCode=$weather_code")
    [ ! -z "$weather_fetched_at" ] && [ "$weather_fetched_at" != "null" ] && exif_args+=("-XMP-tt:WeatherFetchedAtUnix=$weather_fetched_at")
    
    # Location data
    [ ! -z "$loc_road" ] && [ "$loc_road" != "null" ] && exif_args+=("-XMP-tt:LocationRoad=$loc_road")
    [ ! -z "$loc_neighborhood" ] && [ "$loc_neighborhood" != "null" ] && exif_args+=("-XMP-tt:LocationNeighborhood=$loc_neighborhood")
    [ ! -z "$loc_city" ] && [ "$loc_city" != "null" ] && exif_args+=("-XMP-tt:LocationCity=$loc_city")
    [ ! -z "$loc_county" ] && [ "$loc_county" != "null" ] && exif_args+=("-XMP-tt:LocationCounty=$loc_county")
    [ ! -z "$loc_state" ] && [ "$loc_state" != "null" ] && exif_args+=("-XMP-tt:LocationState=$loc_state")
    [ ! -z "$loc_postcode" ] && [ "$loc_postcode" != "null" ] && exif_args+=("-XMP-tt:LocationPostcode=$loc_postcode")
    [ ! -z "$loc_country" ] && [ "$loc_country" != "null" ] && exif_args+=("-XMP-tt:LocationCountry=$loc_country")
    [ ! -z "$loc_fetched_at" ] && [ "$loc_fetched_at" != "null" ] && exif_args+=("-XMP-tt:LocationFetchedAt=$loc_fetched_at")
    [ ! -z "$loc_update_reason" ] && [ "$loc_update_reason" != "null" ] && exif_args+=("-XMP-tt:LocationUpdateReason=$loc_update_reason")
    
    # GoPro data
    [ ! -z "$gopro_filename" ] && [ "$gopro_filename" != "null" ] && exif_args+=("-XMP-tt:GoProFilename=$gopro_filename")
    [ ! -z "$gopro_sync_offset" ] && [ "$gopro_sync_offset" != "null" ] && exif_args+=("-XMP-tt:GoProSyncOffset=$gopro_sync_offset")
    [ ! -z "$gopro_battery" ] && [ "$gopro_battery" != "null" ] && exif_args+=("-XMP-tt:GoProBattery=$gopro_battery")
    [ ! -z "$gopro_recording" ] && [ "$gopro_recording" != "null" ] && exif_args+=("-XMP-tt:GoProRecording=$gopro_recording")
    [ ! -z "$gopro_timestamp" ] && [ "$gopro_timestamp" != "null" ] && exif_args+=("-XMP-tt:GoProTimestamp=$gopro_timestamp")
    
    # Accelerometer data
    [ ! -z "$accel_x" ] && [ "$accel_x" != "null" ] && exif_args+=("-XMP-tt:AccelX=$accel_x")
    [ ! -z "$accel_y" ] && [ "$accel_y" != "null" ] && exif_args+=("-XMP-tt:AccelY=$accel_y")
    [ ! -z "$accel_z" ] && [ "$accel_z" != "null" ] && exif_args+=("-XMP-tt:AccelZ=$accel_z")
    [ ! -z "$accel_timestamp" ] && [ "$accel_timestamp" != "null" ] && exif_args+=("-XMP-tt:AccelTimestamp=$accel_timestamp")
    
    # Apply metadata
    exiftool -overwrite_original "${exif_args[@]}" "$jpg_file" >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        matched_count=$((matched_count + 1))
    fi
    
    processed_count=$((processed_count + 1))
    
    # Show progress every N files
    if [ $((processed_count % progress_interval)) -eq 0 ] || [ $processed_count -eq $jpg_count ]; then
        percentage=$(echo "$processed_count $jpg_count" | awk '{printf "%.1f", ($1/$2)*100}')
        
        # Calculate ETA
        current_time=$(date +%s)
        elapsed=$((current_time - start_time))
        if [ $processed_count -gt 0 ] && [ $elapsed -gt 0 ]; then
            rate=$(echo "$processed_count $elapsed" | awk '{printf "%.1f", $1/$2}')
            remaining_files=$((jpg_count - processed_count))
            eta_seconds=$(echo "$remaining_files $rate" | awk '{printf "%.0f", $1/$2}')
            
            # Format ETA
            if [ $eta_seconds -gt 3600 ]; then
                eta_formatted=$(printf "%dh %dm" $((eta_seconds / 3600)) $(((eta_seconds % 3600) / 60)))
            elif [ $eta_seconds -gt 60 ]; then
                eta_formatted=$(printf "%dm %ds" $((eta_seconds / 60)) $((eta_seconds % 60)))
            else
                eta_formatted="${eta_seconds}s"
            fi
            
            echo -ne "\rProgress: $processed_count/$jpg_count files (${percentage}%) - $matched_count updated - ${rate}/s - ETA: $eta_formatted"
        else
            echo -ne "\rProgress: $processed_count/$jpg_count files (${percentage}%) - $matched_count updated"
        fi
    fi
done

# Final timing and summary
end_time=$(date +%s)
total_elapsed=$((end_time - start_time))

if [ $total_elapsed -gt 3600 ]; then
    elapsed_formatted=$(printf "%dh %dm %ds" $((total_elapsed / 3600)) $(((total_elapsed % 3600) / 60)) $((total_elapsed % 60)))
elif [ $total_elapsed -gt 60 ]; then
    elapsed_formatted=$(printf "%dm %ds" $((total_elapsed / 60)) $((total_elapsed % 60)))
else
    elapsed_formatted="${total_elapsed}s"
fi

final_rate=$(echo "$processed_count $total_elapsed" | awk '{printf "%.1f", $1/$2}')

echo -e "\n\nMetadata embedding completed!"
echo "Processed: $processed_count JPG files"
echo "Updated: $matched_count files with GPS/metadata"
echo "Success rate: $(echo "$matched_count $processed_count" | awk '{printf "%.1f", ($1/$2)*100}')%"
echo "Total time: $elapsed_formatted"
echo "Average rate: ${final_rate} files/second"

if [ $matched_count -lt $processed_count ]; then
    failed=$((processed_count - matched_count))
    echo "Note: $failed files failed to update (possible exiftool errors)"
fi