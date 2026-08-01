import { AppError } from "./AppError.js";

export class RateLimitError extends AppError {
  readonly retryAfter: number; // seconds until the caller may retry

  constructor(retryAfter: number, message = "Too many requests") {
    super(message, 429, "TooManyRequests");
    this.retryAfter = retryAfter;
  }
}
