/**
 * Base class for all *expected* application errors. Carries the HTTP status and
 * a machine-readable code, so the central error handler can format any AppError
 * uniformly. `isOperational` distinguishes "expected" errors (bad input, not
 * found) from programmer bugs.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, new.target);
  }
}
