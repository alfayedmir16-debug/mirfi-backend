"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const highlightController_1 = require("../controllers/highlightController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Public — view highlights for any user
router.get('/user/:userId', auth_1.authenticateJWT, highlightController_1.getUserHighlights);
router.get('/:highlightId', auth_1.authenticateJWT, highlightController_1.getHighlightDetail);
// Auth — manage own highlights
router.post('/', auth_1.authenticateJWT, highlightController_1.createHighlight);
router.put('/:highlightId', auth_1.authenticateJWT, highlightController_1.updateHighlight);
router.delete('/:highlightId', auth_1.authenticateJWT, highlightController_1.deleteHighlight);
router.post('/:highlightId/add', auth_1.authenticateJWT, highlightController_1.addToHighlight);
router.delete('/:highlightId/item/:itemId', auth_1.authenticateJWT, highlightController_1.removeFromHighlight);
exports.default = router;
