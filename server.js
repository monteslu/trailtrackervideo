const express = require('express');
const path = require('path');
const config = require('./config');

const app = express();

// Add request timeout and size limits to prevent memory leaks
app.use((req, res, next) => {
  // Set request timeout to 5 minutes
  req.setTimeout(5 * 60 * 1000, () => {
    console.error('Request timeout, destroying connection');
    req.destroy();
  });
  next();
});

app.use(express.json({ 
  limit: '10mb',  // Reduced from 50mb to prevent memory exhaustion
  strict: true   // Only accept arrays and objects
})); 

app.use(express.static('public'));
app.use('/sessions', express.static('sessions'));

app.use('/api', require('./routes/process'));

// Global error handler to prevent crashes
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.PORT, () => {
  console.log(`Bike Trail Processor running at http://localhost:${config.PORT}`);
});