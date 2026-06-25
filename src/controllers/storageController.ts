import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client } from "../utils/r2";

import multer from "multer";

// Multer memory storage configuration
const storage = multer.memoryStorage();
export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

export const getPresignedUploadUrl = async (req: any, res: any) => {
  try {
    const { fileName, fileType } = req.query;

    if (!fileName || !fileType) {
      return res.status(400).json({ error: "fileName and fileType parameters are required" });
    }

    // Generate unique storage name to prevent conflicts
    const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}_${fileName}`;
    const key = `uploads/${uniqueName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
    });

    // Generate link valid for 15 minutes
    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 900 });

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
  } catch (e: any) {
    console.error("Presigned URL Generation Error:", e);
    res.status(500).json({ error: e.message || "Failed to generate upload URL" });
  }
};


export const directUpload = async (req: any, res: any) => {
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
    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
      Body: file.buffer,
    });

    await r2Client.send(command);

    const fileUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${key}`;

    console.log("=== R2 Upload Complete ===");
    console.log("Hosted at:", fileUrl);
    console.log("========================");

    res.json({
      fileUrl,
      key
    });
  } catch (e: any) {
    console.error("Direct Upload Controller Error:", e);
    res.status(500).json({ error: e.message || "Failed to upload file directly" });
  }
};
