require('dotenv').config();
const app = require('./app');
const { startCronJobs } = require('./jobs/scheduler');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Bizdak API running on port ${PORT} [${process.env.NODE_ENV}]`);

  // Start scheduled background jobs (deal expiry, etc.)
  if (process.env.NODE_ENV !== 'test') {
    startCronJobs();
  }
});
