import type { RequestHandler } from "express";
import type { ZodType } from "zod";

/**
 * Generic Zod validation middleware.
 *
 * Give it a schema shaped like `z.object({ body?, params?, query? })`. It runs
 * the matching parts of the request through Zod:
 *   - on FAILURE  -> responds 400 with the collected issues (safeParse, so we
 *                    control the response instead of throwing)
 *   - on SUCCESS  -> replaces req.body with the PARSED value (so coercions like
 *                    string->Date reach the controller) and calls next()
 *
 * Note: in Express 5, req.query and req.params are read-only getters, so we only
 * reassign req.body. Query/params are still validated — just not overwritten.
 */
export function validate(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      res.status(400).json({
        error: "ValidationError",
        details: result.error.flatten(),
      });
      return;
    }

    const data = result.data as { body?: unknown };
    if (data && typeof data === "object" && "body" in data) {
      req.body = data.body;
    }

    next();
  };
}
