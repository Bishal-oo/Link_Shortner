import { AppError } from "@/errors/AppError";

export class GoneError extends AppError {
  constructor(message = "Gone") {
    super(message, 410, "Gone");
  }
}
