import { Resolve } from "Services/DependencyService";
import { Services } from "Services/Services";
import type { SettingsService, ICustomSkill, IOpenClawModelSelection } from "Services/SettingsService";
import type { QuickAgent } from "Services/AIServices/QuickAgent";
import type { FileSystemService } from "Services/FileSystemService";
import { splitFrontmatter } from "Helpers/Helpers";
import { Copy } from "Enums/Copy";
import { Notice } from "obsidian";

function builtInSkills(): ICustomSkill[] {
    return [
        {
            id: "builtin-proofread",
            name: Copy.QuickActionProofread,
            icon: "scan-text",
            prompt: Copy.SettingBuiltInSkillPromptManaged,
            outputMode: "replace_selection",
            enabled: true,
            builtIn: true,
            chatEnabled: false,
            pinned: false
        },
        {
            id: "builtin-beautify",
            name: Copy.QuickActionBeautify,
            icon: "palette",
            prompt: Copy.SettingBuiltInSkillPromptManaged,
            outputMode: "replace_selection",
            enabled: true,
            builtIn: true,
            chatEnabled: false,
            pinned: false
        },
        {
            id: "builtin-apply-template",
            name: Copy.QuickActionApplyTemplate,
            icon: "notepad-text-dashed",
            prompt: Copy.SettingBuiltInSkillPromptManaged,
            outputMode: "replace_body",
            enabled: true,
            builtIn: true,
            chatEnabled: false,
            pinned: false
        },
        {
            id: "builtin-apply-links",
            name: Copy.QuickActionApplyLinks,
            icon: "link",
            prompt: Copy.SettingBuiltInSkillPromptManaged,
            outputMode: "replace_selection",
            enabled: true,
            builtIn: true,
            chatEnabled: false,
            pinned: false
        },
        {
            id: "builtin-apply-tags",
            name: Copy.QuickActionApplyTags,
            icon: "tag",
            prompt: Copy.SettingBuiltInSkillPromptManaged,
            outputMode: "replace_body",
            enabled: true,
            builtIn: true,
            chatEnabled: false,
            pinned: false
        },
        {
            id: "builtin-suggest-tags",
            name: Copy.QuickActionSuggestTags,
            icon: "tags",
            prompt: Copy.SettingBuiltInSkillPromptManaged,
            outputMode: "replace_body",
            enabled: true,
            builtIn: true,
            chatEnabled: false,
            pinned: false
        },
        {
            id: "builtin-generate-frontmatter",
            name: Copy.QuickActionGenerateFrontmatter,
            icon: "list-plus",
            prompt: Copy.SettingBuiltInSkillPromptManaged,
            outputMode: "replace_body",
            enabled: true,
            builtIn: true,
            chatEnabled: false,
            pinned: false
        }
    ];
}

export class CustomSkillService {
    private readonly settingsService: SettingsService;
    private readonly fileSystemService: FileSystemService;

    public constructor() {
        this.settingsService = Resolve<SettingsService>(Services.SettingsService);
        this.fileSystemService = Resolve<FileSystemService>(Services.FileSystemService);
    }

    public getAllSkills(): ICustomSkill[] {
        return [...this.getBuiltInSkills(), ...(this.settingsService.settings.customSkills ?? [])];
    }

    public getEnabledSkills(): ICustomSkill[] {
        return this.getAllSkills().filter(s => s.enabled);
    }

    public getBuiltInSkills(): ICustomSkill[] {
        const settings = this.settingsService.settings.builtInSkillSettings ?? {};
        return builtInSkills().map(skill => ({
            ...skill,
            enabled: settings[skill.id]?.enabled ?? true,
            modelSelection: settings[skill.id]?.modelSelection,
            chatEnabled: settings[skill.id]?.chatEnabled ?? false,
            pinned: settings[skill.id]?.pinned ?? false
        }));
    }

    public getEnabledBuiltInSkills(): ICustomSkill[] {
        return this.getBuiltInSkills().filter(skill => skill.enabled);
    }

    public getChatSkills(): ICustomSkill[] {
        return this.getAllSkills().filter(skill => skill.enabled && !skill.builtIn && skill.chatEnabled !== false);
    }

    public getPinnedChatSkills(): ICustomSkill[] {
        return this.getChatSkills().filter(skill => skill.pinned === true);
    }

    public getSkill(id: string): ICustomSkill | undefined {
        return this.getAllSkills().find(skill => skill.id === id);
    }

    public async addSkill(skill: Omit<ICustomSkill, "id">): Promise<ICustomSkill> {
        const newSkill: ICustomSkill = {
            ...skill,
            chatEnabled: skill.chatEnabled ?? !skill.builtIn,
            pinned: skill.pinned ?? false,
            id: this.generateSkillId()
        };
        await this.settingsService.updateSettings(settings => {
            settings.customSkills = [...(settings.customSkills ?? []), newSkill];
        });
        return newSkill;
    }

    public async updateSkill(id: string, updates: Partial<ICustomSkill>): Promise<void> {
        if (id.startsWith("builtin-")) {
            await this.settingsService.updateSettings(settings => {
                const previous = settings.builtInSkillSettings?.[id] ?? {};
                settings.builtInSkillSettings = {
                    ...(settings.builtInSkillSettings ?? {}),
                    [id]: {
                        ...previous,
                        enabled: updates.enabled ?? previous.enabled,
                        modelSelection: "modelSelection" in updates ? updates.modelSelection : previous.modelSelection,
                        chatEnabled: updates.chatEnabled ?? previous.chatEnabled,
                        pinned: updates.chatEnabled === false ? false : updates.pinned ?? previous.pinned
                    }
                };
            });
            return;
        }

        await this.settingsService.updateSettings(settings => {
            settings.customSkills = (settings.customSkills ?? []).map(s =>
                s.id === id ? { ...s, ...updates, pinned: updates.chatEnabled === false ? false : updates.pinned ?? s.pinned } : s
            );
        });
    }

    public async deleteSkill(id: string): Promise<void> {
        if (id.startsWith("builtin-")) {
            return;
        }

        await this.settingsService.updateSettings(settings => {
            settings.customSkills = (settings.customSkills ?? []).filter(s => s.id !== id);
        });
    }

    public async reorderSkills(skillIds: string[]): Promise<void> {
        await this.settingsService.updateSettings(settings => {
            const skills = settings.customSkills ?? [];
            settings.customSkills = skillIds
                .map(id => skills.find(s => s.id === id))
                .filter((s): s is ICustomSkill => s !== undefined);
        });
    }

    public async executeSkill(
        skill: ICustomSkill,
        context: SkillContext
    ): Promise<string | null> {
        const agent = Resolve<QuickAgent>(Services.QuickAgent);
        
        // Resolve model selection
        const modelSelection = skill.modelSelection ?? this.settingsService.getOpenClawSelection("quickAction");
        
        // Build prompt with placeholders
        const resolvedPrompt = this.resolvePlaceholders(skill.prompt, context);
        
        // Execute
        const result = await agent.quickAction(resolvedPrompt, context.selection || context.body || "", modelSelection);
        
        if (!result) {
            return null;
        }

        // Apply output mode
        await this.applyOutput(skill.outputMode, result, context);
        
        return result;
    }

    public resolvePlaceholders(prompt: string, context: SkillContext): string {
        return prompt
            .replace(/\{\{selection\}\}/g, context.selection ?? "")
            .replace(/\{\{file_content\}\}/g, context.fileContent ?? "")
            .replace(/\{\{file_name\}\}/g, context.fileName ?? "")
            .replace(/\{\{tags\}\}/g, context.tags?.join(", ") ?? "")
            .replace(/\{\{title\}\}/g, context.title ?? "");
    }

    private async applyOutput(
        mode: ICustomSkill["outputMode"],
        result: string,
        context: SkillContext
    ): Promise<void> {
        if (!context.file) return;

        switch (mode) {
            case "replace_selection":
                if (context.selection) {
                    await this.fileSystemService.patchFile(
                        context.file,
                        [context.selection],
                        [result],
                        false,
                        false
                    );
                } else {
                    // Fallback to replace body if no selection
                    await this.replaceBody(context, result);
                }
                break;
            case "replace_body":
                await this.replaceBody(context, result);
                break;
            case "insert_at_cursor":
                if (context.editor) {
                    context.editor.replaceSelection(result);
                } else {
                    await this.replaceBody(context, result);
                }
                break;
            case "copy_to_clipboard":
                await navigator.clipboard.writeText(result);
                new Notice(Copy.SkillResultCopiedToClipboard ?? "Result copied to clipboard");
                break;
        }
    }

    private async replaceBody(context: SkillContext, result: string): Promise<void> {
        if (!context.file) return;
        const content = await this.fileSystemService.readFile(context.file);
        if (content instanceof Error) return;
        
        const { body, frontmatter } = splitFrontmatter(content);
        if (body.trim() === "") return;
        
        await this.fileSystemService.patchFile(
            context.file,
            [body],
            [result],
            false,
            false
        );
    }

    private generateSkillId(): string {
        return `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
}

export interface SkillContext {
    file?: import("obsidian").TFile;
    editor?: import("obsidian").Editor;
    selection?: string;
    body?: string;
    fileContent?: string;
    fileName?: string;
    tags?: string[];
    title?: string;
}
