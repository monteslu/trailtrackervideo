#!/bin/bash

echo "🚀 Setting up OSM Docker tile server..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# Check if OSM data exists
if [ ! -f "./osm-data/arizona-latest.osm.pbf" ]; then
    echo "❌ OSM data not found. Please ensure arizona-latest.osm.pbf is in ./osm-data/"
    exit 1
fi

echo "📦 Starting PostgreSQL database..."
docker-compose up -d postgres

echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 10

echo "🗺️  Starting tile server (this will import OSM data - takes 10-30 minutes)..."
echo "You can monitor progress with: docker-compose logs -f tile-server"

docker-compose up -d tile-server

echo ""
echo "✅ OSM tile server is starting up!"
echo ""
echo "📍 Once ready, tiles will be available at: http://localhost:8080/tile/{z}/{x}/{y}.png"
echo "📊 Monitor progress: docker-compose logs -f tile-server"
echo "🛠️  Manage: docker-compose down (to stop), docker-compose up -d (to start)"
echo ""
echo "⏱️  Initial import will take 10-30 minutes depending on your machine..."
echo "💡 Once you see 'mod_tile: tile generation complete' you're ready to go!"