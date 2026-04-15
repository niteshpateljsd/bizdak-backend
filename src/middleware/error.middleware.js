function notFound(req, res, next) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  console.error(err);

  // Prisma known errors
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with this value already exists.' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error.';
  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
