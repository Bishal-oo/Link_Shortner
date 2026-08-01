import { AppError } from "./AppError.js";

export class ValidationError extends AppError {
  readonly details: unknown;

  constructor(message = "Validation failed", details?: unknown) {
    super(message, 400, "ValidationError");
    this.details = details;
  }
}
