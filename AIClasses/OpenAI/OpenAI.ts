import { BaseAIClass } from "AIClasses/BaseAIClass";
import type { IStreamChunk } from "Services/StreamingService";
import type { Conversation } from "Conversations/Conversation";
import type { ConversationContent } from "Conversations/ConversationContent";
import type { Attachment } from "Conversations/Attachment";
import { AIProvider } from "Enums/ApiProvider";
import { AIToolCall } from "AIClasses/AIToolCall";
import { AITool, fromString as aiToolFromString } from "Enums/AITool";
import type { IAIToolDefinition } from "AIClasses/ToolDefinitions/IAIToolDefinition";
import type { ResponseEvent, ResponseOutputTextDelta, ResponseOutputItemAdded, ResponseOutputItemDone, ResponseErrorEvent, ResponseFailedEvent, OpenAIToolTool, ResponsesAPIInput, ResponsesAPIContentBlock, ResponsesAPINonStreamingResponse } from "./OpenAITypes";
import { Exception } from "Helpers/Exception";
import { ApiError, ApiErrorType } from "Types/ApiError";
import { MimeType, toMimeType } from "Enums/MimeType";
import { isTextFile } from "Enums/FileType";
import { MimeTypeToFileTypes } from "Enums/FileTypeMimeTypeMapping";
import { parseToolCall, parseFunctionResponse } from "Helpers/ResponseHelper";
import { AIToolUsageMode } from "Enums/AIToolUsageMode";
import { replaceCopy } from 'Helpers/Helpers';
import { Copy } from "Enums/Copy";
import { AgentType } from "Enums/AgentType";
import { requestUrl } from "obsidian";
import { AbortService } from "Services/AbortService";
import type { IResponseMedia } from "Types/ResponseMedia";
import { S3FileService } from "Services/S3Storage/S3FileService";
import { StringTools } from "Helpers/StringTools";

export class OpenAI extends BaseAIClass {
    private readonly s3FileService: S3FileService;

    private mediaProviderResponsesUrl = "";
    private mediaProviderApiKey = "";
    private readonly receivedMediaKeys = new Set<string>();

    private readonly CLIENT_TOOL_ROUTING_INSTRUCTION = `
## Obsidian client tool routing
The function tools included with this request execute in the user's active Obsidian client and access the real vault. For any vault operation, use these client tools exclusively. OpenClaw's own read/write/edit/exec/workspace tools operate on the server and must never be used as substitutes. Only report success after a client vault tool returns success.`;

    private readonly SUPPORTED_MIMETYPES = [
        MimeType.TEXT_PLAIN,
        MimeType.APPLICATION_PDF,
        MimeType.IMAGE_JPEG,
        MimeType.IMAGE_PNG,
        MimeType.IMAGE_WEBP
    ];

    public constructor() {
        super(AIProvider.OpenAI);
        this.s3FileService = new S3FileService();
    }

    public async* streamRequest(conversation: Conversation): AsyncGenerator<IStreamChunk, void, unknown> {

        const input = await this.extractContents(conversation.contents);

        const tools = this.getTools();
        const toolRoutingInstruction = tools.length > 0 ? this.CLIENT_TOOL_ROUTING_INSTRUCTION : "";
        const systemPrompt = toolRoutingInstruction
            ? `${this.systemPrompt}\n\n${this.userInstruction}\n\n${toolRoutingInstruction}`
            : `${this.systemPrompt}\n\n${this.userInstruction}`;

        const endpoint = this.openClawEndpoint();
        this.mediaProviderResponsesUrl = endpoint.url;
        this.mediaProviderApiKey = endpoint.apiKey;
        this.receivedMediaKeys.clear();
        const compatibilityMode = !endpoint.streamingEnabled;
        const requestBody = {
            model: endpoint.model,
            instructions: systemPrompt,
            input: input,
            tools: tools,
            tool_choice: this.buildOpenAIToolChoice(),
            stream: !compatibilityMode
        };

        const headers = {
            "Authorization": `Bearer ${endpoint.apiKey}`,
            "Content-Type": "application/json"
        };

        const url = endpoint.url;

        if (compatibilityMode) {
            yield* this.nonStreamingRequest(url, requestBody, headers);
            return;
        }

        yield* this.streamingService.streamRequest(
            url,
            requestBody,
            (chunk: string) => this.parseStreamChunk(chunk),
            headers,
            (error) => this.extractRetryDelay(error)
        );
    }

    private async* nonStreamingRequest(
        url: string,
        requestBody: object,
        headers: Record<string, string>
    ): AsyncGenerator<IStreamChunk, void, unknown> {
        try {
            if (this.abortService.signal().aborted) {
                this.abortService.throw();
            }
            const response = await requestUrl({
                url,
                method: "POST",
                headers,
                body: JSON.stringify(requestBody),
                throw: false
            });
            if (this.abortService.signal().aborted) {
                this.abortService.throw();
            }

            if (response.status < 200 || response.status >= 300) {
                const error = ApiError.fromResponse(response.status, "Request failed", response.text);
                yield { content: "", isComplete: true, error: error.info.userMessage, errorType: error.info.type };
                return;
            }

            const data = response.json as ResponsesAPINonStreamingResponse;
            for (const chunk of this.parseNonStreamingResponse(data)) {
                yield chunk;
            }
            yield { content: "", isComplete: true };
        } catch (error) {
            if (this.abortService.signal().aborted && AbortService.isAbortError(error)) {
                throw error;
            }
            const networkError = ApiError.fromNetworkError(Exception.new(error));
            yield {
                content: "",
                isComplete: true,
                error: networkError.info.userMessage,
                errorType: networkError.info.type
            };
        }
    }

    private parseNonStreamingResponse(data: ResponsesAPINonStreamingResponse): IStreamChunk[] {
        const chunks: IStreamChunk[] = [];

        const outputText = this.extractOutputText(data);
        if (outputText) {
            chunks.push({ content: outputText, isComplete: false });
        }

        for (const item of data.output ?? []) {
            if (item.type === "message") {
                    const text = this.extractOutputText(item);
                    if (text && text !== outputText) {
                    chunks.push({ content: text, isComplete: false });
                    }
                    const media = this.uniqueResponseMedia(this.extractResponseMedia(item));
                    if (media.length > 0) chunks.push({ content: "", isComplete: false, media });
                continue;
            }

            if (item.type === "function_call") {
                chunks.push({ content: "", isComplete: false, toolCallStarted: item.name });
                    try {
                        const toolName = aiToolFromString(item.name);
                        if (toolName === AITool.Unknown) {
                            throw new Error(`Unsupported tool call from OpenClaw: ${item.name}`);
                        }
                        const toolCall = new AIToolCall(
                            toolName,
                            JSON.parse(item.arguments) as Record<string, unknown>,
                            item.call_id || item.id,
                            undefined
                        );
                    chunks.push({ content: "", isComplete: false, toolCall, shouldContinue: true });
                    } catch (error) {
                        Exception.log(error);
                    }
            }

            const media = this.uniqueResponseMedia(this.extractResponseMedia(item));
            if (media.length > 0) chunks.push({ content: "", isComplete: false, media });
        }

        return chunks;
    }

    private openClawEndpoint(): { url: string; model: string; apiKey: string; streamingEnabled: boolean } {
        let kind: "main" | "planning" | "quickAction";
        switch (this.agentType) {
            case AgentType.Planning:
            case AgentType.Orchestration:
                kind = "planning";
                break;
            case AgentType.QuickAction:
                kind = "quickAction";
                break;
            case AgentType.Main:
            case AgentType.Execution:
                kind = "main";
                break;
        }

        // Retain compatibility with partially mocked/legacy settings services.
        if (typeof this.settingsService.getOpenClawSelection !== "function") {
            const mainModel = this.settingsService.settings.openClawModel?.trim() || "openclaw/default";
            const model = kind === "planning"
                ? this.settingsService.settings.openClawPlanningModel?.trim() || mainModel
                : kind === "quickAction"
                    ? this.settingsService.settings.openClawQuickActionModel?.trim() || mainModel
                    : mainModel;
            return {
                url: this.settingsService.settings.openClawResponsesUrl?.trim() || "http://127.0.0.1:18789/v1/responses",
                model,
                apiKey: this.apiKey,
                streamingEnabled: this.settingsService.settings.openClawCompatibilityMode !== true
            };
        }

        const selection = this.modelSelectionOverride ?? this.settingsService.getOpenClawSelection(kind);
        const provider = this.settingsService.getOpenClawProvider(selection);
        if (!selection || !provider) {
            return {
                url: this.settingsService.settings.openClawResponsesUrl?.trim() || "http://127.0.0.1:18789/v1/responses",
                model: this.settingsService.settings.openClawModel?.trim() || "openclaw/default",
                apiKey: this.apiKey,
                streamingEnabled: this.settingsService.settings.openClawCompatibilityMode !== true
            };
        }
        return {
            url: this.settingsService.getOpenClawResponsesUrl(provider),
            model: selection.modelId,
            apiKey: provider.apiKey,
            streamingEnabled: provider.streamingEnabled === true
        };
    }

    protected parseStreamChunk(chunk: string): IStreamChunk {
        try {
            // OpenAI Responses API sends "[DONE]" as the final message, which is not valid JSON
            if (chunk.trim() === "[DONE]") {
                return { content: "", isComplete: true };
            }

            const event = JSON.parse(chunk) as ResponseEvent;

            let text = "";
            let toolCall: AIToolCall | undefined = undefined;
            let isComplete = false;
            let shouldContinue = false;

            // Handle different event types
            switch (event.type) {
                case "response.output_text.delta": {
                    // Text content streaming
                    const deltaEvent = event as ResponseOutputTextDelta;
                    text = deltaEvent.delta;
                    break;
                }

                case "response.refusal.delta": {
                    // Model refused to respond - treat as text for now
                    const refusalEvent = event as ResponseOutputTextDelta;
                    text = refusalEvent.delta;
                    break;
                }

                case "error":
                case "response.error": {
                    const errorEvent = event as ResponseErrorEvent;
                    this.throwRetryableError(
                        errorEvent.message,
                        errorEvent.code || undefined,
                        ApiErrorType.SERVER_ERROR
                    );
                    break;
                }

                case "response.failed": {
                    const errorEvent = event as ResponseFailedEvent;
                    this.throwRetryableError(
                        errorEvent.response?.error?.message || "Response failed",
                        errorEvent.response?.error?.code || undefined,
                        ApiErrorType.SERVER_ERROR
                    );
                    break;
                }

                case "response.function_call_arguments.delta": {
                    // Function call arguments streaming - we can ignore these
                    // as we'll get the complete call in the "done" event
                    break;
                }

                case "response.function_call_arguments.done": {
                    // Function call arguments streaming - we can ignore these
                    // The complete function call info comes in response.output_item.done
                    break;
                }

                case "response.completed":
                case "response.done": {
                    // Response completed
                    isComplete = true;
                    const media = this.uniqueResponseMedia(this.extractResponseMedia(event));
                    if (media.length > 0) {
                        return { content: "", isComplete: true, media };
                    }
                    text = this.extractOutputText(event);
                    break;
                }

                case "response.output_item.added": {
                    // Function call starting - get name immediately for early UI feedback
                    const itemAddedEvent = event as ResponseOutputItemAdded;

                    // Check if this is a function call and return tool name immediately
                    if (itemAddedEvent.item.type === "function_call" && itemAddedEvent.item.name) {
                        return {
                            content: "",
                            isComplete: false,
                            toolCallStarted: itemAddedEvent.item.name
                        };
                    }
                    break;
                }

                case "response.output_item.done": {
                    // Complete output item received - this includes function calls with name
                    const itemDoneEvent = event as ResponseOutputItemDone;

                    // Check if this is a function call
                    if (itemDoneEvent.item.type === "function_call" &&
                        itemDoneEvent.item.name &&
                        itemDoneEvent.item.arguments) {
                        try {
                            const toolName = aiToolFromString(itemDoneEvent.item.name);
                            if (toolName === AITool.Unknown) {
                                throw new Error(`Unsupported tool call from OpenClaw: ${itemDoneEvent.item.name}`);
                            }
                            const args = JSON.parse(itemDoneEvent.item.arguments) as Record<string, unknown>;
                            toolCall = new AIToolCall(
                                toolName,
                                args,
                                itemDoneEvent.item.call_id || itemDoneEvent.item_id,
                                undefined  // thoughtSignature not used by OpenAI
                            );
                            // When we receive a function call, we should continue the conversation
                            shouldContinue = true;
                        } catch (error) {
                            Exception.log(error);
                        }
                    }
                    const media = this.uniqueResponseMedia(this.extractResponseMedia(itemDoneEvent.item));
                    if (media.length > 0) {
                        return { content: "", isComplete: false, media };
                    }
                    break;
                }

                case "response.image_generation_call.completed":
                case "response.content_part.done": {
                    const media = this.uniqueResponseMedia(this.extractResponseMedia(event));
                    if (media.length > 0) return { content: "", isComplete: false, media };
                    break;
                }

                case "response.created":
                case "response.in_progress":
                case "response.content_part.added":
                case "response.output_text.done":
                case "response.web_search_call.in_progress":
                case "response.web_search_call.searching":
                case "response.web_search_call.completed":
                    // These events can be used for more granular tracking if needed
                    // For now, we handle content through the delta events
                    break;

                default:
                    // log in dev but just ignore unhandled cases in prod
                    Exception.log(`Unknown event type: ${event.type}`);
                    break;
            }

            return {
                content: text,
                isComplete: isComplete,
                toolCall: toolCall,
                shouldContinue: shouldContinue,
            };
        } catch (error) {
            return this.createErrorChunk(error);
        }
    }

    private extractOutputText(value: unknown): string {
        if (!value || typeof value !== "object") return "";

        const record = value as Record<string, unknown>;
        const type = typeof record.type === "string" ? record.type : "";
        const texts: string[] = [];

        if (typeof record.output_text === "string" && record.output_text.trim()) {
            return record.output_text;
        }

        if ((type === "output_text" || type === "text" || type === "input_text") && typeof record.text === "string") {
            return record.text;
        }

        if (type === "message") {
            const content = record.content;
            if (typeof content === "string") {
                texts.push(content);
            }
        }

        for (const key of ["content", "output", "item", "part", "message", "response", "choices"]) {
            const child = record[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    const text = this.extractOutputText(item);
                    if (text) texts.push(text);
                }
            } else if (child && typeof child === "object") {
                const text = this.extractOutputText(child);
                if (text) texts.push(text);
            }
        }

        return texts.join("");
    }

    private extractResponseMedia(value: unknown): IResponseMedia[] {
        if (!value || typeof value !== "object") return [];
        const record = value as Record<string, unknown>;
        const type = typeof record.type === "string" ? record.type : "";
        const mediaTypes = new Set([
            "image_generation_call", "output_image", "image", "output_file", "file",
            "output_audio", "audio", "output_video", "video"
        ]);
        const results: IResponseMedia[] = [];

        if (mediaTypes.has(type)) {
            const nestedImage = typeof record.image_url === "object" && record.image_url
                ? record.image_url as Record<string, unknown>
                : undefined;
            const nestedFile = typeof record.file === "object" && record.file
                ? record.file as Record<string, unknown>
                : undefined;
            const source = nestedFile ?? nestedImage ?? record;
            const resultBase64 = type === "image_generation_call" && typeof record.result === "string" ? record.result : undefined;
            const base64 = resultBase64
                ?? this.firstString(source, ["base64", "b64_json", "data", "file_data", "image_base64"]);
            const url = this.firstString(source, ["url", "download_url", "file_url", "image_url"]);
            const fileId = this.firstString(source, ["file_id"])
                ?? ((type === "file" || type === "output_file") ? this.firstString(source, ["id"]) : undefined);
            if (base64 || url || fileId) {
                results.push({
                    fileName: this.firstString(source, ["filename", "file_name", "name"]),
                    mimeType: this.firstString(source, ["mime_type", "content_type"])
                        ?? (type.includes("image") ? "image/png" : undefined),
                    base64,
                    url,
                    fileId,
                    providerResponsesUrl: this.mediaProviderResponsesUrl,
                    apiKey: this.mediaProviderApiKey
                });
            }
        }

        for (const key of ["content", "output", "item", "part", "response"]) {
            const child = record[key];
            if (Array.isArray(child)) {
                for (const item of child) results.push(...this.extractResponseMedia(item));
            } else if (child && typeof child === "object") {
                results.push(...this.extractResponseMedia(child));
            }
        }
        return results;
    }

    private firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
        for (const key of keys) {
            const value = record[key];
            if (typeof value === "string" && value.trim()) return value;
        }
        return undefined;
    }

    private uniqueResponseMedia(items: IResponseMedia[]): IResponseMedia[] {
        return items.filter(item => {
            const source = item.fileId ?? item.url ?? item.base64;
            if (!source) return false;
            const key = `${item.fileName ?? ""}:${source.length}:${source.slice(0, 128)}`;
            if (this.receivedMediaKeys.has(key)) return false;
            this.receivedMediaKeys.add(key);
            return true;
        });
    }

    protected async extractContents(conversationContent: ConversationContent[]): Promise<ResponsesAPIInput[]> {
        const results: ResponsesAPIInput[] = [];

        for (const content of this.filterConversationContents(conversationContent)) {
            const contentToExtract = content.content ?? "";

            // Case 1: Assistant message with function call
            if (content.toolCall) {
                const parsedContent = parseToolCall(content.toolCall);

                if (parsedContent) {
                    // Check if function call has required id field (for OpenAI Responses API)
                    if (parsedContent.toolCall.id && parsedContent.toolCall.id.trim() !== "") {
                        // Add assistant text message if present
                        if (contentToExtract.trim() !== "") {
                            results.push({
                                type: "message",
                                role: content.role as "user" | "assistant",
                                content: contentToExtract
                            });
                        }

                        // Add function call as separate input item
                        results.push({
                            type: "function_call",
                            call_id: parsedContent.toolCall.id,
                            name: parsedContent.toolCall.name,
                            arguments: JSON.stringify(parsedContent.toolCall.args)
                        });
                    } else {
                        // No id (from other provider or legacy) - convert to text message
                        const legacyText = this.convertToolCallToText(parsedContent);
                        const messageContent = contentToExtract.trim();
                        const combinedContent = messageContent !== ""
                            ? `${messageContent}\n\n${legacyText}`
                            : legacyText;

                        results.push({
                            type: "message",
                            role: content.role as "user" | "assistant",
                            content: combinedContent
                        });
                    }
                } else {
                    // Fall back to regular message if parsing fails
                    results.push({
                        type: "message",
                        role: content.role as "user" | "assistant",
                        content: contentToExtract.trim() !== "" ? contentToExtract : "Error parsing function call"
                    });
                }
                continue;
            }

            // Case 2: Binary file attachments
            if (content.attachments && content.attachments.length > 0) {
                results.push(await this.formatInlineAttachments(content.attachments));
                continue;
            }

            // Case 3: Function call response
            if (content.functionResponse) {
                const parsedContent = parseFunctionResponse(content.functionResponse);

                if (parsedContent) {
                    // Check if response has required id field (for OpenAI Responses API)
                    if (parsedContent.id && parsedContent.id.trim() !== "") {
                        results.push({
                            type: "function_call_output",
                            call_id: parsedContent.id,
                            output: JSON.stringify(parsedContent.functionResponse.response)
                        });
                    } else {
                        // No id (from Gemini or legacy) - convert to text message
                        const legacyText = this.convertFunctionResponseToText(parsedContent);
                        results.push({
                            type: "message",
                            role: content.role as "user" | "assistant",
                            content: legacyText
                        });
                    }
                } else {
                    // Fall back to regular user message if parsing fails
                    results.push({
                        type: "message",
                        role: content.role as "user" | "assistant",
                        content: content.functionResponse
                    });
                }
                continue;
            }

            // Case 4: Regular text message (user or assistant)
            if (contentToExtract.trim() !== "") {
                results.push({
                    type: "message",
                    role: content.role as "user" | "assistant",
                    content: contentToExtract
                });
            }
        }

        return results;
    }

    private async formatInlineAttachments(attachments: Attachment[]): Promise<ResponsesAPIInput> {
        const blocks: ResponsesAPIContentBlock[] = [];

        for (const attachment of attachments) {
            const mimeType = toMimeType(attachment.getMimeType());
            blocks.push({ type: "input_text", text: replaceCopy(Copy.AttachedFile, [attachment.fileName]) });

            if (MimeTypeToFileTypes[mimeType].some(fileType => isTextFile(fileType))) {
                const text = new TextDecoder().decode(StringTools.toBytes(attachment.base64));
                blocks.push({ type: "input_text", text });
            } else if (mimeType === MimeType.IMAGE_JPEG || mimeType === MimeType.IMAGE_PNG || mimeType === MimeType.IMAGE_WEBP) {
                // Keep images inline so vision models and OpenAI-compatible
                // relays that do not fetch remote image URLs still work.
                const imageBase64 = await attachment.getBase64();
                blocks.push({
                    type: "input_image",
                    image_url: `data:${mimeType};base64,${imageBase64}`,
                    detail: "auto"
                });
            } else if (mimeType === MimeType.APPLICATION_PDF) {
                // Try S3 upload first if enabled
                if (this.s3FileService.isEnabled()) {
                    try {
                        const fileUrl = await this.s3FileService.uploadFile(attachment.fileName, mimeType, attachment.base64);
                        blocks.push({ type: "input_text", text: `File uploaded to: ${fileUrl}` });
                        continue;
                    } catch (error) {
                        // Fall back to base64 if S3 upload fails
                    }
                }
                blocks.push({
                    type: "input_file",
                    filename: attachment.fileName,
                    file_data: `data:${mimeType};base64,${attachment.base64}`
                });
            } else {
                // For other file types, try S3 upload
                if (this.s3FileService.isEnabled()) {
                    try {
                        const fileUrl = await this.s3FileService.uploadFile(attachment.fileName, mimeType, attachment.base64);
                        blocks.push({ type: "input_text", text: `File uploaded to: ${fileUrl}` });
                        continue;
                    } catch (error) {
                        // Fall back to error message
                    }
                }
                blocks.push({ type: "input_text", text: `Unsupported mime type '${mimeType}': ${attachment.fileName}` });
            }
        }

        return { type: "message", role: "user", content: blocks };
    }

    protected mapFunctionDefinitions(aiToolDefinitions: IAIToolDefinition[]): OpenAIToolTool[] {
        return aiToolDefinitions.map((functionDefinition) => ({
            type: "function",
            name: functionDefinition.name,
            description: `CLIENT-SIDE OBSIDIAN VAULT TOOL: Executes in the user's active Obsidian client and real vault, not in the OpenClaw server workspace. ${functionDefinition.description}`,
            parameters: functionDefinition.parameters
        }));
    }

    protected formatBinaryFiles(attachments: Attachment[]): string {
        const contentBlocks: unknown[] = [];

        for (const attachment of attachments) {
            const fileID = attachment.getFileID(this.provider);
            if (!fileID) {
                continue; // Skip - upload failed, error message added in extractContents()
            }

            const mimeType = toMimeType(attachment.getMimeType());

            let isPlainText = false;

            //This content can be sent up with the 'MimeType.TEXT_PLAIN' mime type
            if (MimeTypeToFileTypes[mimeType].some(fileType => isTextFile(fileType))) {
                isPlainText = true;
            }

            if (!isPlainText && !this.isSupportedMimeType(mimeType)) {
                contentBlocks.push({ type: "input_text", text: `Unsupported mime type '${mimeType}': ${attachment.fileName}` });
                continue;
            }

            contentBlocks.push(
                { type: "input_text", text: replaceCopy(Copy.AttachedFile, [attachment.fileName]) },
                {
                    type: isPlainText || mimeType === MimeType.APPLICATION_PDF ? "input_file" : "input_image",
                    file_id: fileID
                }
            );
        }

        return JSON.stringify([{
            type: "message",
            role: "user",
            content: contentBlocks
        }]);
    }

    private getTools(): (OpenAIToolTool | { type: string })[] {
        // OpenClaw supplies its own server-side tools. Only send Vaultkeeper's
        // client-side note tools through the Responses API.
        return this.mapFunctionDefinitions(this.aiToolDefinitions);
    }
    
    private buildOpenAIToolChoice(): string {
        // If no tools defined, fall back to auto
        if (this.aiToolDefinitions.length === 0) {
            return "auto";
        }

        switch (this.aiToolUsageMode) {
            case AIToolUsageMode.Auto:
                return "auto";
            case AIToolUsageMode.Enabled:
                return "required";
            case AIToolUsageMode.Disabled:
                return "none";
        }
    }

    private extractRetryDelay(error: ApiError): number | undefined {
        if (error.info.type !== ApiErrorType.RATE_LIMIT || !error.info.responseHeaders) {
            return undefined;
        }

        const headers = error.info.responseHeaders;

        // 1. Prefer standard Retry-After header (seconds or HTTP-date)
        const retryAfter = headers.get('retry-after');
        if (retryAfter) {
            const seconds = Number(retryAfter);
            if (!Number.isNaN(seconds)) {
                return Math.max(0, seconds);
            }
        }

        // 2. Fallback to provider-specific headers (e.g., OpenAI)
        const resetHeader =
            headers.get('x-ratelimit-reset-requests') ??
            headers.get('x-ratelimit-reset-tokens');

        if (resetHeader) {
            return this.parseDurationToSeconds(resetHeader);
        }

        return undefined;
    }

    /**
     * Parses duration strings (e.g., "15s", "600ms", "2m", "1h") into seconds.
     * Returns undefined if parsing fails.
     */
    private parseDurationToSeconds(value: string): number | undefined {
        const trimmed = value.trim();
        const numericValue = parseFloat(trimmed);
        
        if (Number.isNaN(numericValue)) {
            return undefined;
        }
        
        // Parse based on suffix
        if (trimmed.endsWith('ms')) {
            return Math.max(0, Math.ceil(numericValue / 1000));
        }
        if (trimmed.endsWith('s')) {
            return Math.max(0, numericValue);
        }
        if (trimmed.endsWith('m')) {
            return Math.max(0, numericValue * 60);
        }
        if (trimmed.endsWith('h')) {
            return Math.max(0, numericValue * 3600);
        }
        
        // Fallback: treat as raw seconds
        return Math.max(0, numericValue);
    }

    private isSupportedMimeType(mimeType: MimeType): boolean {
        return this.SUPPORTED_MIMETYPES.includes(mimeType);
    }
}
