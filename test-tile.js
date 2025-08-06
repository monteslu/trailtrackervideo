// Test local tile generation
const { createCanvas } = require('canvas');

async function generateTestTile() {
  console.log('Generating test tile...');
  
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  
  // Background color
  ctx.fillStyle = '#f2efe9';
  ctx.fillRect(0, 0, 256, 256);
  
  // Add some test content
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(50, 50, 156, 156);
  
  ctx.fillStyle = '#000000';
  ctx.font = '20px Arial';
  ctx.fillText('LOCAL TILE', 80, 130);
  
  return canvas.toBuffer('image/png');
}

generateTestTile().then(buffer => {
  require('fs').writeFileSync('/Users/monteslu/code/mine/ttvideo/test-tile.png', buffer);
  console.log('Test tile saved to test-tile.png');
}).catch(console.error);