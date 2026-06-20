import { Attachment } from "Conversations/Attachment";
import { ConversationMedia } from "Conversations/ConversationMedia";
import { Path } from "Enums/Path";
import { isImageMimeType, toMimeType } from "Enums/MimeType";
import { StringTools } from "Helpers/StringTools";
import { Resolve } from "./DependencyService";
import type { FileSystemService } from "./FileSystemService";
import { Services } from "./Services";

interface IDocumentMediaItem {
    key: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    vaultPath?: string;
    embed?: string;
}

export class DocumentMediaService {
    private readonly fileSystemService: FileSystemService;
    private readonly items: IDocumentMediaItem[] = [];

    public constructor() {
        this.fileSystemService = Resolve<FileSystemService>(Services.FileSystemService);
    }

    public clear(): void {
        this.items.length = 0;
    }

    public listForPrompt(): string {
        if (this.items.length === 0) {
            return "";
        }
        return [
            "## Available document images",
            "Use image placeholders like {{image:hero}} or {{image:diagram-1}} in Markdown documents. The plugin will replace them with these local embeds when writing notes.",
            ...this.items.map((item, index) => `- ${index + 1}. key: ${item.key}; file: ${item.fileName}`)
        ].join("\n");
    }

    public async registerUserAttachments(attachments: Attachment[]): Promise<void> {
        for (const attachment of attachments) {
            if (!this.isImageMime(attachment.mimeType)) continue;
            const base64 = await attachment.getBase64();
            const bytes = StringTools.toBytes(base64);
            await this.registerBytes(attachment.fileName, attachment.mimeType, bytes);
        }
    }

    public async registerResponseMedia(media: ConversationMedia[]): Promise<void> {
        for (const item of media) {
            if (item.status !== "ready" || !item.filePath || !this.isImageMime(item.mimeType)) continue;
            const sourcePath = `${Path.Conversations}/${item.filePath}`;
            const bytes = await this.fileSystemService.readBinaryFile(sourcePath, true);
            if (bytes instanceof Error) continue;
            await this.registerBytes(item.fileName, item.mimeType, new Uint8Array(bytes));
        }
    }

    public async prepareMarkdown(content: string): Promise<{ content: string; replacements: number; remainingPlaceholders: string[] }> {
        const remainingPlaceholders: string[] = [];
        let output = "";
        let index = 0;
        let cursor = 0;
        const regex = /\{\{image:([^}]+)\}\}/g;
        for (const match of content.matchAll(regex)) {
            const fullMatch = match[0];
            const rawKey = match[1];
            const matchIndex = match.index ?? 0;
            output += content.slice(cursor, matchIndex);
            const key = this.normaliseKey(rawKey);
            const item = this.items.find(candidate => candidate.key === key) ?? this.items[index];
            if (!item) {
                remainingPlaceholders.push(fullMatch);
                output += fullMatch;
            } else {
                index++;
                output += await this.embedFor(item);
            }
            cursor = matchIndex + fullMatch.length;
        }
        output += content.slice(cursor);

        return {
            content: output,
            replacements: index,
            remainingPlaceholders
        };
    }

    private async registerBytes(fileName: string, mimeType: string, bytes: Uint8Array): Promise<IDocumentMediaItem> {
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        const stableBytes = new Uint8Array(buffer);
        const hash = await StringTools.computeSHA256Bytes(stableBytes);
        const safeBase = this.safeBaseName(fileName) || "image";
        const storedFileName = `${safeBase}-${hash.slice(0, 10)}.${this.extension(fileName, mimeType)}`;
        const item: IDocumentMediaItem = {
            key: this.uniqueKey(this.normaliseKey(safeBase)),
            fileName: storedFileName,
            mimeType,
            bytes: stableBytes
        };
        this.items.push(item);
        return item;
    }

    private async embedFor(item: IDocumentMediaItem): Promise<string> {
        if (!item.embed) {
            const vaultPath = `${Path.DocumentAttachments}/${item.fileName}`;
            const buffer = new ArrayBuffer(item.bytes.byteLength);
            new Uint8Array(buffer).set(item.bytes);
            await this.fileSystemService.writeBinaryFile(vaultPath, buffer, true);
            item.vaultPath = vaultPath;
            item.embed = `![[${vaultPath}]]`;
        }
        return item.embed;
    }

    private isImageMime(mimeType: string): boolean {
        return isImageMimeType(toMimeType(mimeType));
    }

    private extension(fileName: string, mimeType: string): string {
        const existing = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1];
        if (existing) return existing.toLowerCase();
        const map: Record<string, string> = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "image/gif": "gif",
            "image/avif": "avif",
            "image/svg+xml": "svg"
        };
        return map[mimeType] ?? "png";
    }

    private safeBaseName(fileName: string): string {
        return fileName
            .replace(/\.[a-z0-9]{1,10}$/i, "")
            .replace(/[\\/:*?"<>|#^[\]]/g, "-")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60);
    }

    private normaliseKey(key: string): string {
        return key.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "");
    }

    private uniqueKey(base: string): string {
        const value = base || "image";
        let key = value;
        let suffix = 2;
        while (this.items.some(item => item.key === key)) {
            key = `${value}-${suffix}`;
            suffix++;
        }
        return key;
    }
}
