import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { getPresignedUploadUrl, directUpload, uploadMiddleware } from "../controllers/storageController";

const router = Router();

router.get("/presigned-url", authenticateJWT as any, getPresignedUploadUrl as any);
router.post("/upload", authenticateJWT as any, uploadMiddleware.single("file") as any, directUpload as any);

export default router;
