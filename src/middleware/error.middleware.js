function notFound(req, res, next) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  // Handle CORS violations — cors() throws an Error with no status
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: 'CORS: request origin not allowed.' });
  }

  // Handle Multer-specific errors with clean user-facing messages
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Images max 5 MB, videos max 500 MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  // Handle custom Multer fileFilter rejections
  if (err.message === 'Only image files are allowed.' || err.message === 'Only video files are allowed.') {
    return res.status(415).json({ error: err.message });
  }

  // Prisma known errors — handle before logging to avoid noisy stack traces for expected errors
  if (err.code === 'P2002') {
    const fields = err.meta?.target?.join(', ') || 'field';
    return res.status(409).json({ error: `A record with this ${fields} already exists.` });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }

  // Log unexpected errors — after known Prisma errors so those don't pollute logs
  if (process.env.NODE_ENV === 'production') {
    console.error(`[${new Date().toISOString()}] ${err.status || 500} ${err.message}`);
  } else {
    console.error(err);
  }

  const status = err.status || err.statusCode || 500;
  // Don't expose internal error details in production for server errors (5xx)
  const message = (status < 500 || process.env.NODE_ENV !== 'production')
    ? (err.message || 'Internal server error.')
    : 'Internal server error.';
  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
