import { AppError } from "@/errors/AppError";

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, 409, "Conflict");
  }
}
