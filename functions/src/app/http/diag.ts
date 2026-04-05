import type { Request, Response } from "express";
import { db } from "../../infra/config/firebase";

/**
 * Handler para diagnÃ³sticos do sistema.
 */
export async function diagHttpHandler(_req: Request, res: Response) {
  try {
    const snap = await db.collection("platform").doc("diag").get();
    res.json({
      ok: true,
      data: snap.data() || {},
      timestamp: Date.now(),
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
}
