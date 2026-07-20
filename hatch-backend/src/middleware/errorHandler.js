// Global error handler middleware

export function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Duplicate entry',
      field: err.meta?.target?.[0],
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Record not found',
    });
  }

  // Foreign-key violation: the payload references a record that doesn't exist
  // (e.g. an unknown supplierId/sku), or the record still has dependents.
  if (err.code === 'P2003') {
    return res.status(409).json({
      error: 'Related record not found or still referenced',
      field: err.meta?.field_name,
    });
  }

  // Validation errors (Zod)
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid token',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expired',
    });
  }

  // Default error. Errors that set their own status are intentional messages
  // (e.g. 400/409 thrown by route logic) and safe to pass through; anything
  // else is an unexpected 500 — log it above but don't leak internals
  // (Prisma/driver messages can contain table names and query fragments).
  if (err.status) {
    return res.status(err.status).json({ error: err.message || 'Request failed' });
  }
  res.status(500).json({
    error: 'Something went wrong on the server. Try again — if it keeps happening, check the server logs.',
  });
}

// Async handler wrapper to catch errors
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
