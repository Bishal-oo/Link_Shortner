import { AppError } from "@/errors/AppError";

export class RateLimitError extends AppError {
  readonly retryAfter: number; // seconds until the caller may retry

  constructor(retryAfter: number, message = "Too many requests") {
    super(message, 429, "TooManyRequests");
    this.retryAfter = retryAfter;
  }
}
