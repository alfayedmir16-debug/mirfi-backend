"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.directUpload = exports.getPresignedUploadUrl = exports.uploadMiddleware = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const r2_1 = require("../utils/r2");
const multer_1 = __importDefault(require("multer"));
// Multer memory storage configuration
const storage = multer_1.default.memoryStorage();
exports.uploadMiddleware = (0, multer_1.default)({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});
const getPresignedUploadUrl = async (req, res) => {
    try {
        const { fileName, fileType } = req.query;
        if (!fileName || !fileType) {
            return res.status(400).json({ error: "fileName and fileType parameters are required" });
        }
        // Generate unique storage name to prevent conflicts
        const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}_${fileName}`;
        const key = `uploads/${uniqueName}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
            Key: key,
            ContentType: fileType,
        });
        // Generate link valid for 15 minutes
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(r2_1.r2Client, command, { expiresIn: 900 });
        console.log("=== GENERATED PRESIGNED URL ===");
        console.log(uploadUrl);
        console.log("===============================");
        // Build the public asset access link
        const fileUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${key}`;
        res.json({
            uploadUrl,
            fileUrl,
            key
        });
    }
    catch (e) {
        console.error("Presigned URL Generation Error:", e);
        res.status(500).json({ error: e.message || "Failed to generate upload URL" });
    }
};
exports.getPresignedUploadUrl = getPresignedUploadUrl;
const directUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded in multipart request" });
        }
        const file = req.file;
        const fileName = file.originalname || "upload.jpg";
        const fileType = file.mimetype || "image/jpeg";
        const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}_${fileName}`;
        const key = `uploads/${uniqueName}`;
        // Upload directly using r2Client S3 SDK to utilize the compatibility-optimized HTTPS agent
        const command = new client_s3_1.PutObjectCommand({
            Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
            Key: key,
            ContentType: fileType,
            Body: file.buffer,
        });
        await r2_1.r2Client.send(command);
        const fileUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${key}`;
        console.log("=== R2 Upload Complete ===");
        console.log("Hosted at:", fileUrl);
        console.log("========================");
        res.json({
            fileUrl,
            key
        });
    }
    catch (e) {
        console.error("Direct Upload Controller Error:", e);
        res.status(500).json({ error: e.message || "Failed to upload file directly" });
    }
};
exports.directUpload = directUpload;
