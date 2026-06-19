import { Resolve } from "Services/DependencyService";
import { Services } from "Services/Services";
import type { IConversationNamingService } from "AIClasses/IConversationNamingService";
import { AIProvider } from "Enums/ApiProvider";
import { Role } from "Enums/Role";
import { NamePrompt } from "AIPrompts/NamePrompt";
import type { SettingsService } from "Services/SettingsService";
import { Exception } from "Helpers/Exception";
import type { AbortService } from "Services/AbortService";
import type { ResponsesAPINonStreamingResponse } from "./OpenAITypes";

export class OpenAIConversationNamingService implements IConversationNamingService {
    private readonly apiKey: string;
    private readonly responsesUrl: string;
    private readonly model: string;
    private readonly abortService: AbortService;

    public constructor() {
        const settingsService = Resolve<SettingsService>(Services.SettingsService);
        this.apiKey = settingsService.getApiKeyForProvider(AIProvider.OpenAI);
        this.responsesUrl = settingsService.settings.openClawResponsesUrl?.trim() || "http://127.0.0.1:18789/v1/responses";
        this.model = settingsService.settings.openClawQuickActionModel?.trim()
            || settingsService.settings.openClawModel?.trim()
            || "openclaw/default";
        this.abortService = Resolve<AbortService>(Services.AbortService);
    }

    public async generateName(userPrompt: string): Promise<string> {
        return await this.abortService.abortableOperation(async () => {
            const requestBody = {
                model: this.model,
                instructions: NamePrompt,
                input: [
                    {
                        type: "message",
                        role: Role.User,
                        content: userPrompt
                    }
                ],
                stream: false
            };

            const response = await fetch(this.responsesUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: this.abortService.signal()
            });

            if (!response.ok) {
                Exception.throw(`OpenClaw API error: ${response.status} ${response.statusText} - ${await response.text()}`);
            }

            const data = await response.json() as ResponsesAPINonStreamingResponse;

            // Find text from any message-type output
            let generatedName: string | undefined;

            for (const item of data.output ?? []) {
                if (item.type === 'message' && Array.isArray(item.content)) {
                    for (const content of item.content) {
                        if (content.type === 'output_text' && content.text) {
                            generatedName = content.text.trim();
                            break;
                        }
                    }
                }
                if (generatedName) break;
            }

            if (!generatedName) {
                Exception.throw("Failed to generate conversation name");
            }

            return generatedName;
        });
    }
}
