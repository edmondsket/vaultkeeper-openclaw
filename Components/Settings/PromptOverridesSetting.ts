declare const app: import("obsidian").App;
import { Modal, Setting } from "obsidian";
import { SystemInstruction } from "AIPrompts/SystemPrompt";
import { PlanningPrompt } from "AIPrompts/PlanningPrompt";
import { OrchestrationPrompt } from "AIPrompts/OrchestrationPrompt";
import { ExecutionPrompt } from "AIPrompts/ExecutionPrompt";
import { ProofreadPrompt } from "AIPrompts/QuickActionPrompts/ProofreadPrompt";
import { BeautifyPrompt } from "AIPrompts/QuickActionPrompts/BeautifyPrompt";
import { ApplyTemplatePrompt } from "AIPrompts/QuickActionPrompts/ApplyTemplatePrompt";
import { ApplyLinksPrompt } from "AIPrompts/QuickActionPrompts/ApplyLinksPrompt";
import { ApplyTagsPrompt } from "AIPrompts/QuickActionPrompts/ApplyTagsPrompt";
import { SuggestTagsPrompt } from "AIPrompts/QuickActionPrompts/SuggestTagsPrompt";
import { GenerateFrontmatterPrompt } from "AIPrompts/QuickActionPrompts/GenerateFrontmatterPrompt";
import { Copy } from "Enums/Copy";
import { Resolve } from "Services/DependencyService";
import type { PromptOverrideKey, SettingsService } from "Services/SettingsService";
import { Services } from "Services/Services";

interface IPromptOverrideItem {
    key: PromptOverrideKey;
    name: string;
    description: string;
    fallback: string;
}

const QUICK_ACTION_BASE_DEFAULT = `{{action}}`;

export class PromptOverridesSetting {
    private readonly settingsService: SettingsService;
    private readonly containerEl: HTMLElement;
    private readonly redraw: () => void;

    public constructor(containerEl: HTMLElement, redraw: () => void) {
        this.containerEl = containerEl;
        this.redraw = redraw;
        this.settingsService = Resolve<SettingsService>(Services.SettingsService);
    }

    public render(): void {
        new Setting(this.containerEl)
            .setHeading()
            .setName(Copy.SettingPromptOverrides)
            .setDesc(Copy.SettingPromptOverridesDesc);

        for (const item of this.items()) {
            const value = this.settingsService.settings.promptOverrides?.[item.key]?.trim() ?? "";
            new Setting(this.containerEl)
                .setName(item.name)
                .setDesc(value ? Copy.SettingPromptOverrideEnabled : Copy.SettingPromptOverrideDefault)
                .addButton(button => button
                    .setButtonText(Copy.SettingPromptOverrideEdit)
                    .onClick(() => {
                        new PromptOverrideModal(item, value, async nextValue => {
                            await this.settingsService.updateSettings(settings => {
                                settings.promptOverrides = {
                                    ...(settings.promptOverrides ?? {}),
                                    [item.key]: nextValue.trim()
                                };
                                if (!settings.promptOverrides[item.key]) {
                                    delete settings.promptOverrides[item.key];
                                }
                            });
                            this.renderAllSettings();
                        }).open();
                    }));
        }
    }

    private renderAllSettings(): void {
        this.redraw();
    }

    private items(): IPromptOverrideItem[] {
        return [
            { key: "mainSystem", name: Copy.SettingPromptMainSystem, description: Copy.SettingPromptMainSystemDesc, fallback: SystemInstruction },
            { key: "planning", name: Copy.SettingPromptPlanning, description: Copy.SettingPromptPlanningDesc, fallback: PlanningPrompt },
            { key: "orchestration", name: Copy.SettingPromptOrchestration, description: Copy.SettingPromptOrchestrationDesc, fallback: OrchestrationPrompt },
            { key: "execution", name: Copy.SettingPromptExecution, description: Copy.SettingPromptExecutionDesc, fallback: ExecutionPrompt },
            { key: "quickActionBase", name: Copy.SettingPromptQuickActionBase, description: Copy.SettingPromptQuickActionBaseDesc, fallback: QUICK_ACTION_BASE_DEFAULT },
            { key: "builtin-proofread", name: Copy.QuickActionProofread, description: Copy.SettingPromptBuiltinQuickActionDesc, fallback: ProofreadPrompt },
            { key: "builtin-beautify", name: Copy.QuickActionBeautify, description: Copy.SettingPromptBuiltinQuickActionDesc, fallback: BeautifyPrompt },
            { key: "builtin-apply-template", name: Copy.QuickActionApplyTemplate, description: Copy.SettingPromptBuiltinQuickActionDesc, fallback: ApplyTemplatePrompt },
            { key: "builtin-apply-links", name: Copy.QuickActionApplyLinks, description: Copy.SettingPromptBuiltinQuickActionDesc, fallback: ApplyLinksPrompt },
            { key: "builtin-apply-tags", name: Copy.QuickActionApplyTags, description: Copy.SettingPromptBuiltinQuickActionDesc, fallback: ApplyTagsPrompt },
            { key: "builtin-suggest-tags", name: Copy.QuickActionSuggestTags, description: Copy.SettingPromptBuiltinQuickActionDesc, fallback: SuggestTagsPrompt },
            { key: "builtin-generate-frontmatter", name: Copy.QuickActionGenerateFrontmatter, description: Copy.SettingPromptBuiltinQuickActionDesc, fallback: GenerateFrontmatterPrompt }
        ];
    }
}

class PromptOverrideModal extends Modal {
    private readonly item: IPromptOverrideItem;
    private readonly currentValue: string;
    private readonly onSave: (value: string) => Promise<void>;

    public constructor(item: IPromptOverrideItem, currentValue: string, onSave: (value: string) => Promise<void>) {
        super(app);
        this.item = item;
        this.currentValue = currentValue;
        this.onSave = onSave;
    }

    public onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.item.name });
        contentEl.createEl("p", { text: this.item.description });

        let value = this.currentValue || this.item.fallback;
        new Setting(contentEl)
            .setName(Copy.SettingPromptOverrideValue)
            .setDesc(this.currentValue ? Copy.SettingPromptOverrideValueDesc : Copy.SettingPromptOverrideEditingDefaultDesc)
            .addTextArea(text => {
                text.setValue(value).onChange(next => value = next);
                text.inputEl.rows = 18;
                text.inputEl.style.width = "100%";
            });

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText(Copy.SettingPromptOverrideReset)
                .onClick(async () => {
                    await this.onSave("");
                    this.close();
                }))
            .addButton(button => button
                .setButtonText(Copy.SettingPromptOverrideSave)
                .setCta()
                .onClick(async () => {
                    await this.onSave(value);
                    this.close();
                }));
    }

    public onClose(): void {
        this.contentEl.empty();
    }
}
