import type { ConversationMedia } from "Conversations/ConversationMedia";

export interface IResponseMedia {
    fileName?: string;
    mimeType?: string;
    base64?: string;
    url?: string;
    fileId?: string;
    providerResponsesUrl: string;
    apiKey: string;
}

export interface IPersistedResponseMedia {
    media: ConversationMedia[];
    bytesStored: number;
}
