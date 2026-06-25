import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { deleteNote, getMyNote, getNotesFeed, upsertNote } from "../controllers/noteController";

const router = Router();

// Feed of notes from people I follow
router.get("/feed", authenticateJWT as any, getNotesFeed as any);

// My own note
router.get("/my", authenticateJWT as any, getMyNote as any);

// Create/update my note
router.post("/", authenticateJWT as any, upsertNote as any);

// Delete my note
router.delete("/", authenticateJWT as any, deleteNote as any);

export default router;
