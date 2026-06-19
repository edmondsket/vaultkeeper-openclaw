import { BaseAIClass } from "AIClasses/BaseAIClass";
import type { IStreamChunk } from "Services/StreamingService";
import type { Conversation } from "Conversations/Conversation";
import type { ConversationContent } from "Conversations/ConversationContent";
import type { Attachment } from "Conversations/Attachment";
import { AIProvider } from "Enums/ApiProvider";
import { AIToolCall } from "AIClasses/AIToolCall";
import { fromString as aiToolFromString } from "Enums/AITool";
import type { IAIToolDefinition } from "AIClasses/ToolDefinitions/IAIToolDefinition";
import type { ResponseEvent, ResponseOutputTextDelta, ResponseOutputItemAdded, ResponseOutputItemDone, ResponseErrorEvent, ResponseFailedEvent, OpenAIToolTool, ResponsesAPIInput, ResponsesAPINonStreamingResponse } from "./OpenAITypes";
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

export class OpenAI extends BaseAIClass {

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
    }

    public async* streamRequest(conversation: Conversation): AsyncGenerator<IStreamChunk, void, unknown> {

        // Refresh file cache only if conversation has attachments
        if (conversation.hasAttachments()) {
            await this.aiFileService.refreshCache();
        }

        const input = await this.extractContents(conversation.contents);

        const tools = this.getTools();
        const toolRoutingInstruction = tools.length > 0 ? this.CLIENT_TOOL_ROUTING_INSTRUCTION : "";
        const systemPrompt = toolRoutingInstruction
            ? `${this.systemPrompt}\n\n${this.userInstruction}\n\n${toolRoutingInstruction}`
            : `${this.systemPrompt}\n\n${this.userInstruction}`;

        const compatibilityMode = this.settingsService.settings.openClawCompatibilityMode === true;
        const requestBody = {
            model: this.openClawModel(),
            instructions: systemPrompt,
            input: input,
            tools: tools,
            tool_choice: this.buildOpenAIToolChoice(),
            stream: !compatibilityMode
        };

        const headers = {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
        };

        const url = this.settingsService.settings.openClawResponsesUrl?.trim() || "http://127.0.0.1:18789/v1/responses";

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

        for (const item of data.output ?? []) {
            if (item.type === "message") {
                    const text = item.content
                        .filter(part => part.type === "output_text" && part.text)
                        .map(part => part.text)
                        .join("");
                    if (text) {
                    chunks.push({ content: text, isComplete: false });
                    }
                continue;
            }

            if (item.type === "function_call") {
                chunks.push({ content: "", isComplete: false, toolCallStarted: item.name });
                    try {
                        const toolCall = new AIToolCall(
                            aiToolFromString(item.name),
                            JSON.parse(item.arguments) as Record<string, unknown>,
                            item.call_id || item.id,
                            undefined
                        );
                    chunks.push({ content: "", isComplete: false, toolCall, shouldContinue: true });
                    } catch (error) {
                        Exception.log(error);
                    }
            }
        }

        return chunks;
    }

    private openClawModel(): string {
        const mainModel = this.settingsService.settings.openClawModel?.trim() || "openclaw/default";

        switch (this.agentType) {
            case AgentType.Planning:
            case AgentType.Orchestration:
                return this.settingsService.settings.openClawPlanningModel?.trim() || mainModel;
            case AgentType.QuickAction:
                return this.settingsService.settings.openClawQuickActionModel?.trim() || mainModel;
            case AgentType.Main:
            case AgentType.Execution:
                return mainModel;
        }
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
                            const args = JSON.parse(itemDoneEvent.item.arguments) as Record<string, unknown>;
                            toolCall = new AIToolCall(
                                aiToolFromString(itemDoneEvent.item.name),
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
                    break;
                }

                case "response.created":
                case "response.in_progress":
                case "response.content_part.added":
                case "response.content_part.done":
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
                const { formattedParts, uploadErrors } = await this.processAttachments<ResponsesAPIInput>(
                    content.attachments,
                    (attachments) => this.formatBinaryFiles(attachments)
                );

                results.push(...formattedParts);

                for (const uploadError of uploadErrors) {
                    // OpenAI formatBinaryFiles returns array with role wrapper, so add as separate message
                    results.push({
                        type: "message",
                        role: "user",
                        content: Exception.messageFrom(uploadError)
                    });
                }
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
