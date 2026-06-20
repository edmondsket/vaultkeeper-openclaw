import { Resolve } from "./DependencyService";
import { Services } from "./Services";
import type { SettingsService } from "./SettingsService";
import { Exception } from "Helpers/Exception";
import { requestUrl } from "obsidian";

export class S3Service {

    private readonly settingsService: SettingsService;

    public constructor() {
        this.settingsService = Resolve<SettingsService>(Services.SettingsService);
    }

    public isEnabled(): boolean {
        const config = this.settingsService.settings.s3Config;
        return config.enabled && Boolean(config.endpoint) && Boolean(config.accessKeyId)
            && Boolean(config.secretAccessKey) && Boolean(config.bucket);
    }

    public async uploadFile(fileName: string, mimeType: string, data: Uint8Array): Promise<string> {
        const config = this.settingsService.settings.s3Config;
        if (!this.isEnabled()) {
            Exception.throw("S3 storage is not configured");
        }

        const key = `${config.pathPrefix}${Date.now()}-${this.sanitizeFileName(fileName)}`;
        const endpoint = config.endpoint.replace(/\/+$/, "");
        const region = config.region;
        const service = "s3";

        const datetime = this.getDateTime();
        const date = datetime.slice(0, 8);

        const host = this.extractHost(endpoint);
        const canonicalUri = `/${key}`;
        const canonicalQuerystring = "";
        const payloadHash = await this.sha256hex(data);

        const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${datetime}\n`;
        const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

        const canonicalRequest = [
            "PUT",
            canonicalUri,
            canonicalQuerystring,
            canonicalHeaders,
            signedHeaders,
            payloadHash
        ].join("\n");

        const credentialScope = `${date}/${region}/${service}/aws4_request`;
        const stringToSign = [
            "AWS4-HMAC-SHA256",
            datetime,
            credentialScope,
            await this.sha256hex(new TextEncoder().encode(canonicalRequest))
        ].join("\n");

        const signingKey = await this.getSigningKey(config.secretAccessKey, date, region, service);
        const signature = await this.hmacHex(signingKey, stringToSign);

        const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const url = endpoint.endsWith("/")
            ? `${endpoint}${key}`
            : `${endpoint}/${key}`;

        const response = await requestUrl({
            url,
            method: "PUT",
            headers: {
                "Host": host,
                "X-Amz-Date": datetime,
                "X-Amz-Content-Sha256": payloadHash,
                "Content-Type": mimeType,
                "Authorization": authorizationHeader
            },
            body: (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer),
            throw: false
        });

        if (response.status !== 200) {
            Exception.throw(`S3 upload failed with status ${response.status}: ${response.text}`);
        }

        return this.getPublicUrl(key);
    }

    private getPublicUrl(key: string): string {
        const config = this.settingsService.settings.s3Config;
        if (config.publicBaseUrl) {
            const base = config.publicBaseUrl.replace(/\/+$/, "");
            return `${base}/${key}`;
        }
        const endpoint = config.endpoint.replace(/\/+$/, "");
        return `${endpoint}/${config.bucket}/${key}`;
    }

    private extractHost(endpoint: string): string {
        const match = endpoint.match(/^https?:\/\/([^\/:]+)(:\d+)?/);
        if (match) {
            return match[1];
        }
        return endpoint;
    }

    private getDateTime(): string {
        const now = new Date();
        const year = now.getUTCFullYear().toString().padStart(4, "0");
        const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
        const day = now.getUTCDate().toString().padStart(2, "0");
        const hours = now.getUTCHours().toString().padStart(2, "0");
        const minutes = now.getUTCMinutes().toString().padStart(2, "0");
        const seconds = now.getUTCSeconds().toString().padStart(2, "0");
        return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
    }

    private sanitizeFileName(fileName: string): string {
        return fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    }

    private async sha256hex(data: Uint8Array): Promise<string> {
        const hash = await crypto.subtle.digest("SHA-256", data as BufferSource);
        return Array.from(new Uint8Array(hash as ArrayBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    private async hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
        const encoder = new TextEncoder();
        const cryptoKey = await crypto.subtle.importKey(
            "raw", key,
            { name: "HMAC", hash: "SHA-256" },
            false, ["sign"]
        );
        return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(msg));
    }

    private async hmacHex(key: ArrayBuffer, msg: string): Promise<string> {
        const sig = await this.hmac(key, msg);
        return Array.from(new Uint8Array(sig))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    private async getSigningKey(secretKey: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
        const encoder = new TextEncoder();
        const kDate = await this.hmac(encoder.encode("AWS4" + secretKey), date);
        const kRegion = await this.hmac(kDate, region);
        const kService = await this.hmac(kRegion, service);
        return this.hmac(kService, "aws4_request");
    }
}