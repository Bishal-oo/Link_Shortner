import { AppError } from "@/errors/AppError"

export class QuotaExhaustedError extends AppError {
    constructor (nextRefillAt: Date|null) {
        const when = nextRefillAt
        ? `It rifills at ${nextRefillAt.toISOString()}`:
        ""
        super(
            `You've used all your link generations.${when} Ask a friend to create and share one with you.`,
            429,
            "QuotaExhausted"
        )
    }
}