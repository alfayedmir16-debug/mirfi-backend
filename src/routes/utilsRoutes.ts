import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { getLinkPreview } from "../controllers/utilsController";

const router = Router();

router.get("/link-preview", authenticateJWT as any, getLinkPreview as any);

export default router;
