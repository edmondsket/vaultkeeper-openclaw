import { Resolve } from "Services/DependencyService";
import { Services } from "Services/Services";
import type { SettingsService } from "Services/SettingsService";
import { StringTools } from "Helpers/StringTools";
import { requestUrl } from "obsidian";
import { Exception } from "Helpers/Exception";

export class S3FileService {
    private readonly settingsService: SettingsService;

    public constructor() {
        this.settingsService = Resolve<SettingsService>(Services.SettingsService);
    }

    public isEnabled(): boolean {
        return this.settingsService.settings.s3Config?.enabled ?? false;
    }

    public async uploadFile(fileName: string, mimeType: string, base64Data: string): Promise<string> {
        const config = this.settingsService.settings.s3Config;
        if (!config || !config.enabled) {
            Exception.throw("S3 storage is not configured or disabled");
        }

        const bytes = StringTools.toBytes(base64Data);
        const key = this.generateObjectKey(fileName);
        const payloadHash = await this.hashSha256Bytes(bytes);

        // Build the S3 URL
        const endpoint = config.endpoint.replace(/\/$/, "");
        const url = `${endpoint}/${config.bucket}/${key}`;

        // Create the date and signature for AWS Signature Version 4
        const date = new Date();
        const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, "");
        const amzDate = date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
        const region = config.region;
        const service = "s3";
        const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

        // Build canonical headers
        const host = new URL(endpoint).host;
        const canonicalHeaders = `host:${host}\n` +
            `x-amz-content-sha256:${payloadHash}\n` +
            `x-amz-date:${amzDate}\n`;
        const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

        // Build canonical request
        const canonicalRequest = `PUT\n/${config.bucket}/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

        // Build string to sign
        const algorithm = "AWS4-HMAC-SHA256";
        const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await this.hashSha256Async(canonicalRequest)}`;

        // Calculate signature
        const signingKey = await this.getSignatureKey(config.secretKey, dateStamp, region, service);
        const signature = await this.hmacSha256Hex(signingKey, stringToSign);

        // Build authorization header
        const authorizationHeader = `${algorithm} Credential=${config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        // Upload
        const response = await requestUrl({
            url,
            method: "PUT",
            headers: {
                "Authorization": authorizationHeader,
                "x-amz-date": amzDate,
                "x-amz-content-sha256": payloadHash,
                "Content-Type": mimeType,
                "Content-Length": String(bytes.length)
            },
            body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            throw: false
        });

        if (response.status !== 200 && response.status !== 201) {
            Exception.throw(`S3 upload failed: ${response.status} ${response.text}`);
        }

        // Return public URL
        if (config.publicUrlBase) {
            return `${config.publicUrlBase.replace(/\/$/, "")}/${key}`;
        }
        return `${endpoint}/${config.bucket}/${key}`;
    }

    public async testConnection(): Promise<{ success: boolean; message: string }> {
        const config = this.settingsService.settings.s3Config;
        if (!config || !config.enabled) {
            return { success: false, message: "S3 is not enabled" };
        }

        try {
            // Try to list bucket (GET on bucket)
            const endpoint = config.endpoint.replace(/\/$/, "");
            const url = `${endpoint}/${config.bucket}?max-keys=1`;

            const date = new Date();
            const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, "");
            const amzDate = date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
            const region = config.region;
            const service = "s3";
            const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

            const host = new URL(endpoint).host;
            const canonicalHeaders = `host:${host}\n` +
                `x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n` +
                `x-amz-date:${amzDate}\n`;
            const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

            const canonicalRequest = `GET\n/${config.bucket}\nmax-keys=1\n${canonicalHeaders}\n${signedHeaders}\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;

            const algorithm = "AWS4-HMAC-SHA256";
            const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await this.hashSha256Async(canonicalRequest)}`;

            const signingKey = await this.getSignatureKey(config.secretKey, dateStamp, region, service);
            const signature = await this.hmacSha256Hex(signingKey, stringToSign);
            const authorizationHeader = `${algorithm} Credential=${config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

            const response = await requestUrl({
                url,
                method: "GET",
                headers: {
                    "Authorization": authorizationHeader,
                    "x-amz-date": amzDate,
                    "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                },
                throw: false
            });

            if (response.status === 200 || response.status === 403) {
                // 403 means credentials work but permissions may be limited
                return { success: true, message: `Connected (status ${response.status})` };
            }
            return { success: false, message: `Connection failed: ${response.status} ${response.text}` };
        } catch (error) {
            return { success: false, message: `Connection error: ${Exception.messageFrom(error)}` };
        }
    }

    private generateObjectKey(fileName: string): string {
        const config = this.settingsService.settings.s3Config;
        const prefix = config?.pathPrefix?.replace(/\/$/, "") ?? "vaultkeeper-ai";
        const timestamp = Date.now();
        const hash = Math.random().toString(36).substring(2, 10);
        const ext = fileName.split(".").pop() ?? "bin";
        return `${prefix}/${timestamp}-${hash}.${ext}`;
    }

    private async getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
        const kDate = await this.hmacSha256(this.encode("AWS4" + secretKey), this.encode(dateStamp));
        const kRegion = await this.hmacSha256(kDate, this.encode(region));
        const kService = await this.hmacSha256(kRegion, this.encode(service));
        const kSigning = await this.hmacSha256(kService, this.encode("aws4_request"));
        return kSigning;
    }

    private async hmacSha256(key: ArrayBuffer, message: ArrayBuffer): Promise<ArrayBuffer> {
        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            key,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        return crypto.subtle.sign("HMAC", cryptoKey, message);
    }

    private async hmacSha256Hex(key: ArrayBuffer, message: string): Promise<string> {
        const msgBuffer = this.encode(message);
        const signature = await this.hmacSha256(key, msgBuffer);
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    private async hashSha256Bytes(data: Uint8Array): Promise<string> {
        const buffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(buffer).set(data);
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    private async hashSha256Async(data: string): Promise<string> {
        const encoder = new TextEncoder();
        const buffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    private encode(str: string): ArrayBuffer {
        return new TextEncoder().encode(str).buffer;
    }
}
