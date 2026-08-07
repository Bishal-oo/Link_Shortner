import { AppError } from "./AppError";

export class UnauthorizedError extends AppError {
    constructor(message = "Authentication required") {
        super(message, 401, "Unauthorized" )
    }
}