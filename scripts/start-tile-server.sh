#!/bin/bash

echo "🗺️  OSM Tile Server Management Script"

# Function to check if import is complete
check_import_status() {
    docker logs osm-tile-server 2>&1 | grep -q "osm2pgsql took.*overall\|All postprocessing.*done\|external data.*complete"
}

# Function to switch to run mode
switch_to_run_mode() {
    echo "📝 Switching to run mode..."
    
    # Update docker-compose.yml to run mode
    sed -i '' 's/command: import/command: run/' docker-compose.yml
    
    # Restart the container in run mode
    docker-compose stop tile-server
    docker-compose up -d tile-server
    
    echo "✅ Tile server is now running in serve mode on http://localhost:8080"
    echo "🧪 Test with: curl -I http://localhost:8080/tile/10/200/400.png"
}

# Check current status
if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "osm-tile-server.*Up"; then
    echo "📊 Tile server is running. Checking import status..."
    
    # Show recent logs
    echo "📋 Recent logs:"
    docker logs --tail=10 osm-tile-server
    
    echo ""
    
    if check_import_status; then
        echo "✅ Import appears to be complete!"
        echo "🔄 Would you like to switch to run mode? (y/n)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            switch_to_run_mode
        else
            echo "ℹ️  Run this script again when ready to switch to run mode"
        fi
    else
        echo "⏳ Import still in progress. Monitor with: docker logs -f osm-tile-server"
        echo "🔄 Run this script again when import is complete"
    fi
else
    echo "❌ Tile server is not running. Start with: docker-compose up -d"
fi