import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "@/errors/ValidationError";

/**
 * Generic Zod validation middleware. Runs a schema against { body, params,
 * query }; on failure it THROWS a ValidationError (the central handler turns it
 * into a 400 with details); on success it replaces req.body with the parsed
 * value. Only req.body is reassigned (Express 5 query/params are read-only).
 */
export function validate(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      throw new ValidationError(
        "Request validation failed",
        result.error.flatten(),
      );
    }

    const data = result.data as { body?: unknown };
    if (data && typeof data === "object" && "body" in data) {
      req.body = data.body;
    }

    next();
  };
}
