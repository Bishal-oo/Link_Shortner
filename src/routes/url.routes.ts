import { Router } from "express";
import { validate } from "@/middlewares/validate.middleware";
import {
  createUrlSchema,
  updateUrlSchema,
  codeParamsSchema,
} from "@/types/url.schema";
import {
  createUrl,
  redirectToCode,
  getStats,
  updateUrlHandler,
} from "@/controllers/url.controller";

export const urlRouter = Router();

urlRouter.post("/urls", validate(createUrlSchema), createUrl);

// Specific route (/urls/:code/stats) is registered before the catch-all /:code.
urlRouter.get("/urls/:code/stats", validate(codeParamsSchema), getStats);

urlRouter.patch("/urls/:code", validate(updateUrlSchema), updateUrlHandler);

// Catch-all single-segment redirect. Keep this LAST so it doesn't shadow other
// routes. (When we add /health in Phase 6, it must be registered before this.)
urlRouter.get("/:code", validate(codeParamsSchema), redirectToCode);
