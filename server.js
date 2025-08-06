const express = require('express');
const path = require('path');
const config = require('./config');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use('/sessions', express.static('sessions'));

app.use('/api', require('./routes/process'));

app.listen(config.PORT, () => {
  console.log(`Bike Trail Processor running at http://localhost:${config.PORT}`);
});