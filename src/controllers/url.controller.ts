import type { Request, Response } from "express";
import {
  createShortUrl,
  resolveForRedirect,
  getUrlStats,
} from "../services/url.service.js";
import type { CreateUrlBody } from "../schemas/url.schema.js";

/**
 * POST /urls — create a short link.
 *
 * The controller's ONLY job: read the (already-validated) request, call the
 * service, and shape the HTTP response. No business logic, no SQL.
 */
export async function createUrl(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateUrlBody;

  const url = await createShortUrl({
    originalUrl: body.originalUrl,
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

/**
 * GET /:code — redirect to the original URL and count the click.
 */
export async function redirectToCode(
  req: Request,
  res: Response,
): Promise<void> {
  const { code } = req.params as { code: string };
  const result = await resolveForRedirect(code);

  if (result.status === "not_found") {
    res.status(404).json({ error: "NotFound", message: `No link for code '${code}'` });
    return;
  }
  if (result.status === "expired") {
    res.status(410).json({ error: "Gone", message: "This link has expired" });
    return;
  }

  // 302 (NOT 301) so browsers don't cache the redirect — every click must reach
  // us to be counted.
  res.redirect(302, result.originalUrl);
}

/**
 * GET /urls/:code/stats — return click analytics for a link.
 */
export async function getStats(req: Request, res: Response): Promise<void> {
  const { code } = req.params as { code: string };
  const stats = await getUrlStats(code);

  if (!stats) {
    res.status(404).json({ error: "NotFound", message: `No link for code '${code}'` });
    return;
  }

  res.json(stats);
}
