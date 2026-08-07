import type { Request, Response } from "express";
import {
  createShortUrl,
  resolveForRedirect,
  getUrlStats,
  updateUrl,
  listShortUrls,
  deleteShortUrl,
} from "@/services/url.service";
import type { CreateUrlBody, UpdateUrlBody } from "@/types/url.schema";
import { listQuerySchema } from "@/types/url.schema";
import { ValidationError } from "@/errors/ValidationError";

// Controllers now only handle the SUCCESS path. Any error case (not found,
// conflict, expired, validation) is thrown by the service/middleware and
// formatted by the central error handler. Express 5 forwards async throws.

/** POST /urls — create a short link. */
export async function createUrl(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateUrlBody;

  const url = await createShortUrl({
    originalUrl: body.originalUrl,
    alias: body.alias,
    expiresAt: body.expiresAt ?? null,
  });

  res.status(201).json({
    code: url.code,
    originalUrl: url.originalUrl,
    shortUrl: `${req.protocol}://${req.get("host")}/${url.code}`,
    expiresAt: url.expiresAt,
    createdAt: url.createdAt,
  });
}

/** GET /:code — redirect to the original URL and count the click. */
export async function redirectToCode(
  req: Request,
  res: Response,
): Promise<void> {
  const { code } = req.params as { code: string };
  const originalUrl = await resolveForRedirect(code);
  // 302 (NOT 301) so browsers don't cache the redirect — every click counts.
  res.redirect(302, originalUrl);
}

/** GET /urls/:code/stats — click analytics for a link. */
export async function getStats(req: Request, res: Response): Promise<void> {
  const { code } = req.params as { code: string };
  const stats = await getUrlStats(code);
  res.json(stats);
}

/** PATCH /urls/:code — update a link's alias and/or expiry. */
export async function updateUrlHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { code } = req.params as { code: string };
  const body = req.body as UpdateUrlBody;

  const url = await updateUrl(code, {
    alias: body.alias,
    expiresAt: body.expiresAt,
  });

  res.json({
    code: url.code,
    originalUrl: url.originalUrl,
    shortUrl: `${req.protocol}://${req.get("host")}/${url.code}`,
    expiresAt: url.expiresAt,
    createdAt: url.createdAt,
  });
}

/** GET /urls?page=&pageSize= — a paginated list of links, newest first. */
export async function listUrls(req: Request, res: Response): Promise<void> {
  // Parse the query here (not via validate middleware): Express 5 query is
  // read-only, so coerced numbers wouldn't survive. safeParse coerces + applies
  // defaults; invalid input (page=abc, page=-1) becomes a 400 ValidationError.
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(
      "Request validation failed",
      parsed.error.flatten(),
    );
  }
  const { page, pageSize } = parsed.data;

  const result = await listShortUrls({ page, pageSize });

  res.json({
    items: result.items.map((url) => ({
      code: url.code,
      originalUrl: url.originalUrl,
      shortUrl: `${req.protocol}://${req.get("host")}/${url.code}`,
      createdAt: url.createdAt,
      expiresAt: url.expiresAt,
    })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
}

/** DELETE /urls/:code — remove a link. Returns 204 No Content on success. */
export async function deleteUrlHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { code } = req.params as { code: string };
  await deleteShortUrl(code);
  res.status(204).send();
}
