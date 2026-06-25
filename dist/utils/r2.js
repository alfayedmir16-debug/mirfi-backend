"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.r2Client = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const node_http_handler_1 = require("@smithy/node-http-handler");
const https_1 = __importDefault(require("https"));
// OpenSSL 3.x + Cloudflare R2 compatibility
// Uses intermediate cipher suite compatible with both
const agent = new https_1.default.Agent({
    rejectUnauthorized: true,
    secureProtocol: "TLSv1_2_method",
    ciphers: "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384",
    ecdhCurve: "auto",
    honorCipherOrder: true,
});
exports.r2Client = new client_s3_1.S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "",
    },
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: new node_http_handler_1.NodeHttpHandler({ httpsAgent: agent }),
});
