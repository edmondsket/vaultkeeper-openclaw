export type ConversationMediaStatus = "ready" | "error";

export class ConversationMedia {
    public constructor(
        public readonly fileName: string,
        public readonly mimeType: string,
        public readonly sizeBytes: number,
        public readonly filePath?: string,
        public readonly status: ConversationMediaStatus = "ready",
        public readonly error?: string
    ) {}

    public get sizeMB(): number {
        return Math.round((this.sizeBytes / 1_000_000) * 100) / 100;
    }

    public get isPreviewableImage(): boolean {
        return ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(this.mimeType);
    }

    public static isData(data: unknown): data is {
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        filePath?: string;
        status?: ConversationMediaStatus;
        error?: string;
    } {
        return data !== null && typeof data === "object"
            && "fileName" in data && typeof data.fileName === "string"
            && "mimeType" in data && typeof data.mimeType === "string"
            && "sizeBytes" in data && typeof data.sizeBytes === "number"
            && (!("filePath" in data) || typeof data.filePath === "string")
            && (!("status" in data) || data.status === "ready" || data.status === "error")
            && (!("error" in data) || typeof data.error === "string");
    }
}
