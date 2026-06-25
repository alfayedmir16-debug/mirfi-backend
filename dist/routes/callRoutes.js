"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const callController_1 = require("../controllers/callController");
const router = (0, express_1.Router)();
router.get('/token', auth_1.authenticateJWT, callController_1.generateAgoraToken);
exports.default = router;
