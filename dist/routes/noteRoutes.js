"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const noteController_1 = require("../controllers/noteController");
const router = (0, express_1.Router)();
// Feed of notes from people I follow
router.get("/feed", auth_1.authenticateJWT, noteController_1.getNotesFeed);
// My own note
router.get("/my", auth_1.authenticateJWT, noteController_1.getMyNote);
// Create/update my note
router.post("/", auth_1.authenticateJWT, noteController_1.upsertNote);
// Delete my note
router.delete("/", auth_1.authenticateJWT, noteController_1.deleteNote);
exports.default = router;
