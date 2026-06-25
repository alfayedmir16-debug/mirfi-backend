import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "https";

// OpenSSL 3.x + Cloudflare R2 compatibility
// Uses intermediate cipher suite compatible with both
const agent = new https.Agent({
  rejectUnauthorized: true,
  secureProtocol: "TLSv1_2_method" as any,
  ciphers: "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384" as any,
  ecdhCurve: "auto" as any,
  honorCipherOrder: true,
});

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "",
  },
  forcePathStyle: true,
  maxAttempts: 3,
  requestChecksumCalculation: "WHEN_REQUIRED" as any,
  responseChecksumValidation: "WHEN_REQUIRED" as any,
  requestHandler: new NodeHttpHandler({ httpsAgent: agent }),
});
