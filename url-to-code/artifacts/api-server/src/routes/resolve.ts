import { Router, json, type IRouter } from "express";
import { resolveDocument, type ResolveRequest } from "../lib/resolve-capture";

/**
 * POST /api/clone/resolve — stateless resolve pass (computed geometry/styles
 * for every [data-mae-id] in a studio-composed screen document). Lives under
 * /api/clone/ so the studio's existing proxy route can forward it.
 *
 * Screen documents from website clones can be large — this route gets its own
 * body-size limit instead of the app-wide default.
 */
const router: IRouter = Router();

router.post("/clone/resolve", json({ limit: "32mb" }), async (req, res) => {
  const body = req.body as Partial<ResolveRequest> | undefined;
  if (!body || typeof body.documentHtml !== "string" || !body.documentHtml.trim()) {
    res.status(400).json({ error: "documentHtml is required." });
    return;
  }
  const width = Number(body.viewport?.width);
  const height = Number(body.viewport?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    res.status(400).json({ error: "viewport { width, height } is required." });
    return;
  }

  try {
    const result = await resolveDocument({
      documentHtml: body.documentHtml,
      viewport: { width, height },
      waitMs: typeof body.waitMs === "number" ? body.waitMs : undefined,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "resolve failed");
    res.status(500).json({
      error: err instanceof Error ? err.message : "Resolve pass failed.",
    });
  }
});

export default router;
