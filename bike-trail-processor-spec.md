# 🛠️ Bike Trail Image Processor — Software Specification

## 📋 Overview

This is a local-use, web-based application built with Node.js and plain HTML/JS (no build step). It processes a directory of timestamped JPEG images captured during bike rides, extracts GPS/XMP metadata, renders overlays (map views, altitude graph), and outputs each image at 1440p resolution into a separate folder. Processed images can be compiled into a video using FFmpeg.

## 📁 Project Structure

bike-processor/
├── server.js                # Express web server (UI + APIs)
├── public/                  # Static frontend (no build tools)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── routes/
│   └── process.js           # API route handlers
├── utils/
│   └── xmp.js               # XMP data extraction
├── config.js                # Root and output config
├── sessions/                # Input image folders
└── output/                  # Processed result folders

## ⚙️ Functionality

### 1. App Initialization

- Node.js serves static frontend files from `/public`
- On load, frontend fetches available sessions via:

GET /api/sessions
→ Returns: [ "ride_20250801", "ride_20250802", ... ]

- When a session is selected, the frontend calls:

GET /api/session/:name
→ Returns: { count, images[] }

- Each image in `images[]` includes:
  - timestamp (from filename)
  - latitude / longitude
  - altitude
  - compass bearing
  - velocity (speed)

Example:

{
  "timestamp": 1754419666486,
  "lat": 33.4212,
  "lon": -111.9383,
  "alt": 354.2,
  "speed": 4.7,
  "compass": 182.5
}

### 2. Image Processing Workflow

- Canvas is shown in UI with fixed dimensions: 1440×1080
  - CSS scales to ~90% of the screen width
- On "Start", the app:
  1. Loads each image one at a time
  2. Draws the base image stretched to fit 1440p
  3. Adds three visual overlays:
     - Bottom Left: Full ride route with current position (OpenStreetMap)
     - Bottom Right: Zoomed-in view with street names and landmarks
     - Top Right: Altitude chart showing progress
  4. Marks current position with a bike icon on all overlays
  5. Converts canvas to JPEG blob
  6. Sends it to backend:

POST /api/upload/:session/:timestamp
Body: image/jpeg blob
→ Saves to: output/:session/:timestamp.jpg

- A progress bar is updated after each image

### 3. Output & Video Export

- All processed images are saved in:

output/<session_name>/<timestamp>.jpg

- To generate a video:

ffmpeg -framerate 30 -i output/<session>/%d.jpg -c:v libx264 -pix_fmt yuv420p output.mp4

## 🔌 API Endpoints

### GET /api/sessions

Returns a list of session folders inside `sessions/`.

Example response:

["ride_20250801", "ride_20250802"]

### GET /api/session/:name

Scans the session folder, reads XMP metadata from each image, returns:

{
  "count": 352,
  "images": [
    {
      "timestamp": 1754419666486,
      "lat": 33.4212,
      "lon": -111.9383,
      "alt": 354.2,
      "speed": 4.7,
      "compass": 182.5
    }
  ]
}

### POST /api/upload/:session/:timestamp

Receives a JPEG blob and writes it to:

output/:session/:timestamp.jpg

Returns: 200 OK

## 📦 Dependencies

### Node.js

- express - API + static file server
- exifr - for XMP and GPS data parsing
- fs, path - native filesystem utils

### Frontend

- Plain HTML/CSS/JS
- Canvas API
- fetch() for upload/metadata
- Optional: Leaflet.js or custom tile rendering for OpenStreetMap overlays

## 🖼️ Visualization Layout

| Region         | Description                                       |
|----------------|---------------------------------------------------|
| Bottom Left    | Global ride map with full route + current point   |
| Bottom Right   | Zoomed-in map with streets/landmarks              |
| Top Right      | Altitude chart showing current ride progress      |
| Center         | Base photo, stretched to 1440×1080                |
| All overlays   | Include a bike icon marking current GPS location  |

## ⚙️ config.js

module.exports = {
  ROOT_DIR: './sessions',
  OUTPUT_DIR: './output',
  PORT: 3000
};

## ✅ Future Enhancements

- Pause/resume processing
- Display estimated time remaining
- Export ride metadata to a single JSON file
- Tile caching for faster OpenStreetMap rendering
- CLI wrapper for batch sessions

## ✅ Status Summary

| Component              | Status     |
|------------------------|------------|
| No-build static UI     | ✅ Planned |
| Session list API       | ✅ Planned |
| XMP metadata API       | ✅ Planned |
| Canvas rendering       | ✅ Planned |
| Image upload + save    | ✅ Planned |
| OpenStreetMap overlay  | ✅ Pending |
| Altitude chart overlay | ✅ Pending |
| Video export via ffmpeg| ✅ Manual  |

## 🧪 Testing Plan

1. Start server:
   node server.js

2. Open browser at:
   http://localhost:3000

3. Select a session → Load metadata

4. Start processing → Watch canvas render and upload

5. Verify output files in:
   output/<session>/

6. Generate video:
   ffmpeg -framerate 30 -i output/<session>/%d.jpg -c:v libx264 -pix_fmt yuv420p output.mp4
