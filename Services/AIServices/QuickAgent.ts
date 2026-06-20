import { AgentType } from "Enums/AgentType";
import { BaseAgent } from "./BaseAgent";
import { Conversation } from "Conversations/Conversation";
import { Exception } from "Helpers/Exception";
import { AIToolUsageMode } from "Enums/AIToolUsageMode";
import type { IChatServiceCallbacks } from "Services/ChatService";
import { ConversationContent } from "Conversations/ConversationContent";
import { Role } from "Enums/Role";
import type { IOpenClawModelSelection } from "Services/SettingsService";

export class QuickAgent extends BaseAgent {

    public async quickAction(action: string, context: string, modelSelection?: IOpenClawModelSelection): Promise<string | null> {
        
        const previousModelSelectionOverride = this.ai?.modelSelectionOverride;
        this.setAgentPromptAndTools(action, modelSelection);

        try {
            const conversation = new Conversation();
            const conversationContent = new ConversationContent({
                role: Role.User,
                content: context,
            });
            conversation.contents.push(conversationContent);

            const result = await this.requestAgentResponse(AgentType.QuickAction, conversation, this.callbacks());
            if (conversation.contents.last()?.errorType) {
                return null;
            }
            return result;
        } finally {
            if (this.ai) {
                this.ai.modelSelectionOverride = previousModelSelectionOverride;
            }
        }
    }

    private setAgentPromptAndTools(instruction: string, modelSelection?: IOpenClawModelSelection): void {
        if (!this.ai) {
            Exception.throw("Error: No AI provider has been set!");
        }
        this.ai.agentType = AgentType.QuickAction;
        this.ai.aiToolUsageMode = AIToolUsageMode.Disabled;
        this.ai.systemPrompt = instruction;
        this.ai.userInstruction = ""; // do not include user instruction for quick agent
        this.ai.aiToolDefinitions = []; // no tools for quick agent
        this.ai.modelSelectionOverride = modelSelection;
    }

    private callbacks(): IChatServiceCallbacks {
        return {
            onSubmit: () => {},
            onStreamingUpdate: () => {},
            onThoughtUpdate: () => {},
            onToolCallStarted: () => {},
            onPlanningStarted: () => {},
            onPlanningFinished: () => {},
            onUserQuestion: async () => new Promise<string>(() => {}),
            onPlanUpdate: () => {},
            onPlanStepUpdate: () => {},
            onPlanReset: () => {},
            onComplete: () => {},
        };
    }

}
