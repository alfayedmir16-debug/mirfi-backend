"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const storageController_1 = require("../controllers/storageController");
const router = (0, express_1.Router)();
router.get("/presigned-url", auth_1.authenticateJWT, storageController_1.getPresignedUploadUrl);
router.post("/upload", auth_1.authenticateJWT, storageController_1.uploadMiddleware.single("file"), storageController_1.directUpload);
exports.default = router;
