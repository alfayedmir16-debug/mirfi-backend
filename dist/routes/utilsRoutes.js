"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const utilsController_1 = require("../controllers/utilsController");
const router = (0, express_1.Router)();
router.get("/link-preview", auth_1.authenticateJWT, utilsController_1.getLinkPreview);
exports.default = router;
