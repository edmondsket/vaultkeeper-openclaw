import { Path } from "Enums/Path";
import { Resolve } from "./DependencyService";
import { FileSystemService } from "./FileSystemService";
import { Services } from "./Services";
import { Conversation } from "Conversations/Conversation";
import { ConversationContent } from "Conversations/ConversationContent";
import { Attachment } from "Conversations/Attachment";
import { Exception } from "Helpers/Exception";
import type { IAIFileService } from "AIClasses/IAIFileService";
import { Reference } from "Conversations/Reference";
import { arrayBufferToBase64 } from "obsidian";
import { StringTools } from "Helpers/StringTools";
import { requestUrl } from "obsidian";
import { ConversationMedia } from "Conversations/ConversationMedia";
import type { IPersistedResponseMedia, IResponseMedia } from "Types/ResponseMedia";

export class ConversationFileSystemService {

    public static readonly MAX_MEDIA_ITEM_BYTES = 20_000_000;
    public static readonly MAX_MEDIA_RESPONSE_BYTES = 50_000_000;
    private static readonly MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;
    private static readonly SUMMARY_READ_TIMEOUT_MS = 2_000;

    private fileSystemService: FileSystemService;
    private aiFileService: IAIFileService | undefined;

    private currentConversationPath: string | null = null;
    private deletionQueue: Promise<void> = Promise.resolve();
    private isDeleted: boolean = false;

    public constructor() {
        this.fileSystemService = Resolve<FileSystemService>(Services.FileSystemService);
    }

    public resolveAIFileService() {
        this.aiFileService = Resolve<IAIFileService>(Services.IAIFileService);
    }

    public async persistResponseMedia(items: IResponseMedia[], byteBudget: number): Promise<IPersistedResponseMedia> {
        const media: ConversationMedia[] = [];
        let bytesStored = 0;

        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const fallbackName = item.mimeType?.startsWith("image/") ? `generated-image-${index + 1}` : `generated-file-${index + 1}`;
            try {
                const resolved = await this.resolveResponseMedia(item);
                if (resolved.bytes.byteLength > ConversationFileSystemService.MAX_MEDIA_ITEM_BYTES) {
                    throw new Error("Media exceeds the 20 MB item limit");
                }
                if (bytesStored + resolved.bytes.byteLength > byteBudget) {
                    throw new Error("Media exceeds the 50 MB response limit");
                }

                const mimeType = item.mimeType || resolved.mimeType || "application/octet-stream";
                const originalName = item.fileName || resolved.fileName || fallbackName;
                const extension = this.mediaExtension(originalName, mimeType);
                const hash = await StringTools.computeSHA256Bytes(new Uint8Array(resolved.bytes));
                const filePath = `${Path.Attachments}/${hash}.${extension}`;
                const result = await this.fileSystemService.writeBinaryFile(filePath, resolved.bytes, true);
                if (result instanceof Error) throw result;

                bytesStored += resolved.bytes.byteLength;
                media.push(new ConversationMedia(
                    this.ensureFileExtension(originalName, extension),
                    mimeType,
                    resolved.bytes.byteLength,
                    filePath.replace(`${Path.Conversations}/`, "")
                ));
            } catch (error) {
                media.push(new ConversationMedia(
                    item.fileName || fallbackName,
                    item.mimeType || "application/octet-stream",
                    0,
                    undefined,
                    "error",
                    Exception.messageFrom(error)
                ));
            }
        }

        return { media, bytesStored };
    }

    private async resolveResponseMedia(item: IResponseMedia): Promise<{ bytes: ArrayBuffer; mimeType?: string; fileName?: string }> {
        let base64 = item.base64?.trim();
        if (!base64 && item.url?.startsWith("data:")) {
            base64 = item.url;
        }
        if (base64) {
            const dataUrl = /^data:([^;,]+)?;base64,(.*)$/s.exec(base64);
            if (dataUrl) {
                base64 = dataUrl[2];
                item.mimeType ||= dataUrl[1];
            }
            const approximateBytes = Math.ceil(base64.length * 3 / 4);
            if (approximateBytes > ConversationFileSystemService.MAX_MEDIA_ITEM_BYTES) {
                throw new Error("Media exceeds the 20 MB item limit");
            }
            const bytes = StringTools.toBytes(base64);
            return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mimeType: item.mimeType };
        }

        let url = item.url?.trim();
        if (!url && item.fileId) {
            const filesBase = item.providerResponsesUrl.replace(/\/responses\/?$/, "");
            url = `${filesBase}/files/${encodeURIComponent(item.fileId)}/content`;
        }
        if (!url || !/^https?:\/\//i.test(url)) {
            throw new Error("Media response did not contain data, an HTTP URL, or a file ID");
        }

        const includeAuthorization = item.apiKey && this.sameOrigin(url, item.providerResponsesUrl);
        const response = await Promise.race([
            requestUrl({
                url,
                method: "GET",
                headers: includeAuthorization ? { Authorization: `Bearer ${item.apiKey}` } : undefined,
                throw: false
            }),
            new Promise<never>((_, reject) => setTimeout(
                () => reject(new Error("Media download timed out")),
                ConversationFileSystemService.MEDIA_DOWNLOAD_TIMEOUT_MS
            ))
        ]);
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Media download failed with HTTP ${response.status}`);
        }
        const contentLength = Number(this.responseHeader(response.headers, "content-length") ?? 0);
        if (contentLength > ConversationFileSystemService.MAX_MEDIA_ITEM_BYTES) {
            throw new Error("Media exceeds the 20 MB item limit");
        }
        const disposition = this.responseHeader(response.headers, "content-disposition") ?? "";
        const fileName = /filename\*?=(?:UTF-8''|\")?([^";]+)/i.exec(disposition)?.[1];
        return {
            bytes: response.arrayBuffer,
            mimeType: this.responseHeader(response.headers, "content-type")?.split(";")[0],
            fileName: fileName ? decodeURIComponent(fileName.trim()) : undefined
        };
    }

    private sameOrigin(left: string, right: string): boolean {
        try {
            return new URL(left).origin === new URL(right).origin;
        } catch {
            return false;
        }
    }

    private responseHeader(headers: Record<string, string>, name: string): string | undefined {
        const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : undefined;
    }

    private mediaExtension(fileName: string, mimeType: string): string {
        const nameExtension = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1];
        if (nameExtension) return nameExtension.toLowerCase();
        const extensions: Record<string, string> = {
            "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
            "image/avif": "avif", "image/svg+xml": "svg", "application/pdf": "pdf",
            "text/plain": "txt", "application/json": "json", "text/csv": "csv",
            "application/zip": "zip"
        };
        return extensions[mimeType] ?? "bin";
    }

    private ensureFileExtension(fileName: string, extension: string): string {
        const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_").trim() || "generated-file";
        return /\.[a-z0-9]{1,10}$/i.test(safeName) ? safeName : `${safeName}.${extension}`;
    }

    public generateConversationPath(conversation: Conversation): string {
        return `${Path.Conversations}/${conversation.title}.json`;
    }

    public async saveConversation(conversation: Conversation): Promise<string | Error> {
        if (this.isDeleted) {
            return ""; // Return empty string to indicate silent skip (not an error)
        }

        if (!this.currentConversationPath) {
            this.currentConversationPath = this.generateConversationPath(conversation);
        } else {
            // can happen if the conversation is deleted during an active request
            const fileExists = await this.fileSystemService.exists(this.currentConversationPath, true);
            if (!fileExists) {
                return this.currentConversationPath;
            }
        }

        conversation.updated = new Date();

        // Save attachment files and update filePaths
        for (const content of conversation.contents) {
            for (const attachment of content.attachments) {
                if (!attachment.filePath && attachment.base64) {
                    const filePath = await this.saveAttachmentFile(attachment);
                    if (!(filePath instanceof Error)) {
                        attachment.filePath = filePath.replace(`${Path.Conversations}/`, '');
                    }
                }
            }
        }

        const conversationData = {
            title: conversation.title,
            created: conversation.created.toISOString(),
            updated: conversation.updated.toISOString(),
            contents: conversation.contents
                .map(content => ({
                    role: content.role,
                    timestamp: content.timestamp.toISOString(),
                    content: content.content,
                    displayContent: content.displayContent,
                    toolCall: content.toolCall,
                    functionResponse: content.functionResponse,
                    attachments: content.attachments.map(att => ({
                        fileName: att.fileName,
                        mimeType: att.mimeType,
                        filePath: att.filePath,
                        fileID: att.fileID
                    })),
                    media: content.media.map(item => ({
                        fileName: item.fileName,
                        mimeType: item.mimeType,
                        sizeBytes: item.sizeBytes,
                        filePath: item.filePath,
                        status: item.status,
                        error: item.error
                    })),
                    references: content.references,
                    shouldDisplayContent: content.shouldDisplayContent,
                    toolId: content.toolId,
                    thoughtSignature: content.thoughtSignature,
                    errorType: content.errorType
                }))
        };

        const result = await this.fileSystemService.writeObjectToFile(this.currentConversationPath, conversationData, true, false);

        if (result instanceof Error) {
            return result;
        }

        return this.currentConversationPath;
    }

    public resetCurrentConversation() {
        this.currentConversationPath = null;
        this.isDeleted = false;
    }

    public getCurrentConversationPath(): string | null {
        return this.currentConversationPath;
    }

    public setCurrentConversationPath(filePath: string) {
        this.currentConversationPath = filePath;
        this.isDeleted = false;
    }

    public async deleteCurrentConversation(): Promise<void | Error> {
        if (!this.currentConversationPath) {
            return;
        }

        const readResult = await this.readConversation(this.currentConversationPath);

        if (readResult instanceof Error) {
            return readResult;
        }

        // Queue this to execute silently in the background - it's just a best effort
        this.deletionQueue = this.deletionQueue.then(() => this.attemptAIFileDeletion(readResult));

        const deleteResult = await this.fileSystemService.deleteFile(this.currentConversationPath, true, false);

        if (deleteResult instanceof Error) {
            return deleteResult;
        }

        // Mark as deleted to prevent subsequent saves during ongoing operations
        this.isDeleted = true;
        this.currentConversationPath = null;

        // Queue garbage collection after AI file deletion
        this.deletionQueue = this.deletionQueue.then(async () => {
            await this.garbageCollectAttachments();
        });
    }

    public async getAllConversations(): Promise<Conversation[]> {
        const files = await this.fileSystemService.listFilesInDirectory(Path.Conversations, false, true);
        const conversations: Conversation[] = [];

        for (const file of files) {
            const result = await this.readConversation(file.path);
            if (result instanceof Conversation) {
                conversations.push(result);
            }
        }

        return conversations;
    }

    public async getConversationSummaries(): Promise<Array<{ title: string; created: Date; updated: Date; filePath: string }>> {
        const files = await this.fileSystemService.listFilesInDirectory(Path.Conversations, false, true);
        const summaries = await Promise.all(files
            .filter(file => file.extension === "json")
            .map(async file => {
            try {
                const content = await Promise.race([
                    this.fileSystemService.readFilePath(file.path, true),
                    new Promise<Error>(resolve => window.setTimeout(
                        () => resolve(Exception.new(`Timed out reading conversation summary: ${file.path}`)),
                        ConversationFileSystemService.SUMMARY_READ_TIMEOUT_MS
                    ))
                ]);
                if (content instanceof Error) {
                    Exception.log(content);
                    return null;
                }
                const data = JSON.parse(content) as Record<string, unknown>;
                if (typeof data.title !== "string" || typeof data.created !== "string" || typeof data.updated !== "string") {
                    Exception.warn(`Skipping invalid conversation summary: ${file.path}`);
                    return null;
                }
                return {
                    title: data.title,
                    created: new Date(data.created),
                    updated: new Date(data.updated),
                    filePath: file.path
                };
            } catch (error) {
                Exception.log(error);
                return null;
            }
        }));

        return summaries.filter(summary => summary !== null);
    }

    public async loadConversation(filePath: string): Promise<Conversation | Error> {
        return this.readConversation(filePath);
    }

    public async garbageCollectAttachments(): Promise<void | Error> {
        try {
            // 1. Get all attachment files
            const attachmentFiles = await this.fileSystemService.listFilesInDirectory(
                Path.Attachments,
                false,
                true
            );

            if (attachmentFiles.length === 0) {
                return;
            }

            // 2. Build reference count map
            const referenceCount = new Map<string, number>();

            const conversations = await this.getAllConversations();
            for (const conversation of conversations) {
                for (const content of conversation.contents) {
                    for (const attachment of content.attachments) {
                        if (attachment.filePath) {
                            const count = referenceCount.get(attachment.filePath) || 0;
                            referenceCount.set(attachment.filePath, count + 1);
                        }
                    }
                    for (const media of content.media) {
                        if (media.filePath) {
                            const count = referenceCount.get(media.filePath) || 0;
                            referenceCount.set(media.filePath, count + 1);
                        }
                    }
                }
            }

            // 3. Delete unreferenced files
            for (const file of attachmentFiles) {
                const relativePath = file.path.replace(`${Path.Conversations}/`, '');
                const refCount = referenceCount.get(relativePath) || 0;

                if (refCount === 0) {
                    const deleteResult = await this.fileSystemService.deleteFile(
                        file.path,
                        true,
                        false
                    );

                    if (deleteResult instanceof Error) {
                        Exception.log(deleteResult);
                    }
                }
            }
        } catch (error) {
            Exception.log(error);
            return Exception.new(error);
        }
    }

    public async updateConversationTitle(oldPath: string, newTitle: string): Promise<void | Error> {
        const newPath = `${Path.Conversations}/${newTitle}.json`;

        const result = await this.fileSystemService.moveFile(oldPath, newPath, true);

        if (result instanceof Error) {
            return result;
        }

        if (this.currentConversationPath === oldPath) {
            this.currentConversationPath = newPath;
        }
    }

    private async saveAttachmentFile(attachment: Attachment): Promise<string | Error> {
        const hash = await StringTools.computeSHA256Hash(attachment.base64);
        const fileName = `${hash}.bin`;
        const filePath = `${Path.Attachments}/${fileName}`;

        const exists = await this.fileSystemService.exists(filePath, true);
        if (exists) {
            return filePath;
        }

        const bytes = StringTools.toBytes(attachment.base64);
        const arrayBuffer = bytes.buffer;

        const result = await this.fileSystemService.writeBinaryFile(filePath, arrayBuffer, true);

        if (result instanceof Error) {
            Exception.log(result);
            return filePath;
        }

        return filePath;
    }

    private async loadAttachmentFile(filePath: string): Promise<string> {
        const fullPath = `${Path.Conversations}/${filePath}`;
        const arrayBuffer = await this.fileSystemService.readBinaryFile(fullPath, true);

        if (arrayBuffer instanceof Error) {
            Exception.log(arrayBuffer);
            return "";
        }

        return arrayBufferToBase64(arrayBuffer);
    }

    private async readConversation(path: string): Promise<Conversation | Error> {
        const result = await this.fileSystemService.readObjectFromFile(path, true);
        
        if (result instanceof Error) {
            Exception.log(result);
            return result;
        }
        
        const conversation: Conversation = new Conversation();

        if (Conversation.isConversationData(result)) {
            conversation.title = result.title;
            conversation.created = new Date(result.created);
            conversation.updated = new Date(result.updated);

            const contentPromises = result.contents.map(async content => {
                const attachments = await this.deserializeAttachments(content.attachments);
                const references = this.deserializeReferences(content.references);
                const media = this.deserializeMedia(content.media);

                return new ConversationContent({
                    role: content.role,
                    timestamp: new Date(content.timestamp),
                    content: content.content,
                    displayContent: content.displayContent,
                    toolCall: content.toolCall,
                    functionResponse: content.functionResponse,
                    attachments: attachments,
                    media,
                    references: references,
                    shouldDisplayContent: content.shouldDisplayContent,
                    toolId: content.toolId,
                    thoughtSignature: content.thoughtSignature,
                    errorType: content.errorType
                });
            });

            conversation.contents = await Promise.all(contentPromises);
        }
        
        return conversation;
    }

    private async deserializeAttachments(attachmentsData: unknown): Promise<Attachment[]> {
        if (!Array.isArray(attachmentsData)) {
            return [];
        }

        const attachments: Attachment[] = [];

        for (const attachmentData of attachmentsData) {
            if (!Attachment.isAttachmentData(attachmentData)) {
                continue;
            }

            const base64 = await this.loadAttachmentFile(attachmentData.filePath);

            if (!base64) {
                Exception.warn(`Skipping attachment with missing file: ${attachmentData.fileName} (${attachmentData.filePath})`);
                continue;
            }

            const attachment = new Attachment(
                attachmentData.fileName,
                attachmentData.mimeType,
                base64,
                attachmentData.fileID || {},
                attachmentData.filePath
            );

            attachments.push(attachment);
        }

        return attachments;
    }

    private deserializeReferences(referencesData: unknown): Reference[] {
        if (!Array.isArray(referencesData)) {
            return [];
        }

        return referencesData
            .filter(Reference.isReferenceData)
            .map(referenceData => new Reference(
                referenceData.fileName,
                referenceData.size
            ));
    }

    private deserializeMedia(mediaData: unknown): ConversationMedia[] {
        if (!Array.isArray(mediaData)) return [];
        return mediaData
            .filter(ConversationMedia.isData)
            .map(item => new ConversationMedia(
                item.fileName,
                item.mimeType,
                item.sizeBytes,
                item.filePath,
                item.status ?? "ready",
                item.error
            ));
    }

    private async attemptAIFileDeletion(conversation: Conversation) {
        try {
            await this.aiFileService?.refreshCache();
        } catch (error) {
            Exception.log(error);
        }

        const attachments = conversation.contents.map(c => c.attachments).flat();
        for (const attachment of attachments) {
            try {
                await this.aiFileService?.deleteFile(attachment);
            } catch (error) {
                Exception.log(error);
            }
        }
    }

}
