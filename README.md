# 🚴‍♂️ Bike Trail Image Processor

A web-based application that processes timestamped JPEG images from bike rides, extracts GPS metadata, and adds visual overlays (route maps, altitude charts) to create video-ready frames.

## Features

- **Session Management**: Browse and select bike ride image folders
- **GPS Data Extraction**: Reads XMP/EXIF metadata for location, altitude, speed, compass
- **Visual Overlays**: Adds route maps, detail views, and altitude charts
- **Video Processing**: Outputs 1440p images ready for FFmpeg compilation
- **Real-time Preview**: Canvas-based rendering with progress tracking
- **Tile Caching**: Local OSM tile caching with throttling detection and preloading

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Add your bike ride images**:
   - Create folders in `sessions/` (e.g., `sessions/ride_20250101/`)
   - Add timestamped JPEG images with GPS metadata

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Open browser**: http://localhost:3000

5. **Process images**:
   - Select a session
   - Click "Load Session" 
   - Click "Start Processing"
   - Processed images save to `output/[session]/`

6. **Create video** (optional):
   ```bash
   ffmpeg -framerate 30 -i output/[session]/%d.jpg -c:v libx264 -pix_fmt yuv420p output.mp4
   ```

## Project Structure

```
ttvideo/
├── server.js           # Express server
├── config.js           # Configuration
├── public/             # Frontend files
│   ├── index.html      # Main UI
│   ├── style.css       # Styling
│   └── app.js          # Canvas processing
├── routes/             # API endpoints
│   └── process.js      # Session & upload routes
├── utils/              # Utilities
│   └── xmp.js          # Metadata extraction
├── sessions/           # Input image folders
└── output/             # Processed results
```

## API Endpoints

- `GET /api/sessions` - List available sessions
- `GET /api/session/:name` - Get session images with metadata
- `POST /api/upload/:session/:timestamp` - Save processed image
- `GET /api/tiles/:z/:x/:y.png` - Cached OSM tile proxy
- `GET /api/cache/stats` - Get tile cache statistics
- `DELETE /api/cache` - Clear all cached tiles
- `POST /api/cache/preload` - Preload tiles for route bounds

## Tile Caching

The app includes a local OpenStreetMap tile caching system that:

- **Automatically caches** tiles as you browse maps to improve performance
- **Detects throttling** from OSM servers with proper headers and rate limiting
- **Provides cache management** UI to view stats, clear cache, and preload routes
- **Respects OSM usage policy** with proper User-Agent and request headers

### Cache Management

Access the cache management interface from the main page:

1. **View Stats**: See total cached tiles, storage usage, and breakdown by zoom level
2. **Clear Cache**: Remove all cached tiles to free up space
3. **Preload Routes**: Pre-download tiles for your loaded bike route at multiple zoom levels

Cache files are stored in `tile-cache/` and organized by `z/x/y.png` structure.

### Throttling Detection

The tile proxy monitors OSM response headers for:
- `X-RateLimit-Remaining` - Remaining requests in current window
- `X-RateLimit-Limit` - Total requests allowed per window  
- `Retry-After` - Seconds to wait if rate limited (HTTP 429)
- Response status codes and timing

All requests include proper identification headers per OSM usage policy.

## Requirements

- Node.js 16+
- JPEG images with GPS/XMP metadata
- Modern browser with Canvas API support
- Internet connection for initial tile downloads