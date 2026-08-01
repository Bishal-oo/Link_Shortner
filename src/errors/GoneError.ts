import { AppError } from "./AppError.js";

export class GoneError extends AppError {
  constructor(message = "Gone") {
    super(message, 410, "Gone");
  }
}
