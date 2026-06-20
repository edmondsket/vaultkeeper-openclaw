declare const app: import("obsidian").App;
import { Setting, Modal, ButtonComponent, DropdownComponent, TextComponent, TextAreaComponent, ToggleComponent, Notice } from "obsidian";
import { Copy } from "Enums/Copy";
import type { SettingsService, ICustomSkill, IOpenClawModelSelection } from "Services/SettingsService";
import type { CustomSkillService } from "Services/CustomSkills/CustomSkillService";
import { Resolve } from "Services/DependencyService";
import { Services } from "Services/Services";

export class CustomSkillsSetting {
    private readonly settingsService: SettingsService;
    private readonly customSkillService: CustomSkillService;
    private containerEl: HTMLElement;
    private listEl: HTMLElement | null = null;

    constructor(containerEl: HTMLElement) {
        this.containerEl = containerEl;
        this.settingsService = Resolve<SettingsService>(Services.SettingsService);
        this.customSkillService = Resolve<CustomSkillService>(Services.CustomSkillService);
    }

    public render() {
        if (!this.listEl) {
            this.listEl = this.containerEl.createDiv({ cls: "vaultkeeper-skills-setting-list" });
        }
        const containerEl = this.listEl;
        containerEl.empty();

        new Setting(containerEl)
            .setHeading()
            .setName(Copy.SettingCustomSkills)
            .setDesc(Copy.SettingCustomSkillsDesc);

        const skills = this.customSkillService.getAllSkills();
        for (const skill of skills) {
            this.renderSkillItem(containerEl, skill);
        }

        new Setting(containerEl)
            .addButton(button => button
                .setButtonText(Copy.SettingAddSkill)
                .setCta()
                .onClick(() => {
                    new SkillEditModal(null, async (skill) => {
                        await this.customSkillService.addSkill(skill as Omit<ICustomSkill, "id">);
                        this.render();
                    }).open();
                }));
    }

    private renderSkillItem(containerEl: HTMLElement, skill: ICustomSkill) {
        const setting = new Setting(containerEl)
            .setName(skill.builtIn ? `${skill.name} · ${Copy.SettingBuiltInSkill}` : skill.name)
            .setDesc(skill.builtIn ? Copy.SettingBuiltInSkillNotEditable : skill.prompt.substring(0, 50) + "...")
            .addToggle(toggle => toggle
                .setValue(skill.enabled)
                .onChange(async value => {
                    await this.customSkillService.updateSkill(skill.id, { enabled: value });
                }));

        if (!skill.builtIn) {
            setting.addToggle(toggle => toggle
                .setTooltip(Copy.SettingSkillChatEnabled)
                .setValue(skill.chatEnabled !== false)
                .onChange(async value => {
                    await this.customSkillService.updateSkill(skill.id, { chatEnabled: value });
                    this.render();
                }));

            setting.addToggle(toggle => toggle
                .setTooltip(Copy.SettingSkillPinned)
                .setValue(skill.pinned === true)
                .setDisabled(skill.chatEnabled === false)
                .onChange(async value => {
                    await this.customSkillService.updateSkill(skill.id, { pinned: value });
                    this.render();
                }));
        }

        this.addSkillModelDropdown(setting, skill);

        if (skill.builtIn) {
            return;
        }

        setting.addButton(button => button
                .setIcon("pencil")
                .setTooltip(Copy.SettingSkillEdit)
                .onClick(() => {
                    new SkillEditModal(skill, async (updates) => {
                        await this.customSkillService.updateSkill(skill.id, updates);
                        this.render();
                    }).open();
                }));

        setting.addButton(button => button
                .setIcon("trash")
                .setTooltip(Copy.SettingSkillDelete)
                .onClick(async () => {
                    if (confirm(Copy.SettingSkillDeleteConfirm)) {
                        await this.customSkillService.deleteSkill(skill.id);
                        this.render();
                    }
                }));
    }

    private addSkillModelDropdown(setting: Setting, skill: ICustomSkill): void {
        setting.addDropdown(dropdown => {
            dropdown.addOption("", Copy.SettingUseDefaultQuickActionModel);
            for (const provider of this.settingsService.settings.openClawProviders ?? []) {
                if (provider.models.length === 0) continue;
                const group = dropdown.selectEl.createEl("optgroup", { attr: { label: provider.name || Copy.UnnamedProvider } });
                for (const model of provider.models) {
                    const selection = { providerId: provider.id, modelId: model };
                    group.createEl("option", { value: this.openClawSelectionKey(selection), text: model });
                }
            }

            if (skill.modelSelection) {
                dropdown.setValue(this.openClawSelectionKey(skill.modelSelection));
            }

            dropdown.onChange(async value => {
                await this.customSkillService.updateSkill(skill.id, {
                    modelSelection: value ? this.parseOpenClawSelectionKey(value) : undefined
                });
            });
        });
    }

    private openClawSelectionKey(selection: IOpenClawModelSelection): string {
        return `${encodeURIComponent(selection.providerId)}|${encodeURIComponent(selection.modelId)}`;
    }

    private parseOpenClawSelectionKey(value: string): IOpenClawModelSelection | undefined {
        const separator = value.indexOf("|");
        if (separator < 0) return undefined;
        return {
            providerId: decodeURIComponent(value.slice(0, separator)),
            modelId: decodeURIComponent(value.slice(separator + 1))
        };
    }
}

class SkillEditModal extends Modal {
    private skill: ICustomSkill | null;
    private onSave: (skill: Partial<ICustomSkill>) => Promise<void>;

    constructor(skill: ICustomSkill | null, onSave: (skill: Partial<ICustomSkill>) => Promise<void>) {
        super(app);
        this.skill = skill;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: this.skill ? Copy.SettingSkillEdit : Copy.SettingAddSkill });

        // Name
        let nameValue = this.skill?.name ?? "";
        new Setting(contentEl)
            .setName(Copy.SettingSkillName)
            .addText(text => text
                .setValue(nameValue)
                .onChange(value => { nameValue = value; }));

        // Icon
        let iconValue = this.skill?.icon ?? "wand";
        new Setting(contentEl)
            .setName(Copy.SettingSkillIcon)
            .addText(text => text
                .setValue(iconValue)
                .onChange(value => { iconValue = value; }));

        // Prompt
        let promptValue = this.skill?.prompt ?? "";
        new Setting(contentEl)
            .setName(Copy.SettingSkillPrompt)
            .setDesc(Copy.SettingSkillPromptDesc)
            .addTextArea(text => {
                text.setValue(promptValue)
                    .onChange(value => { promptValue = value; });
                text.inputEl.rows = 6;
                text.inputEl.style.width = "100%";
            });

        // Output Mode
        let outputModeValue = this.skill?.outputMode ?? "replace_selection";
        new Setting(contentEl)
            .setName(Copy.SettingSkillOutputMode)
            .addDropdown(dropdown => dropdown
                .addOption("replace_selection", Copy.SettingSkillOutputModeReplaceSelection)
                .addOption("replace_body", Copy.SettingSkillOutputModeReplaceBody)
                .addOption("insert_at_cursor", Copy.SettingSkillOutputModeInsertAtCursor)
                .addOption("copy_to_clipboard", Copy.SettingSkillOutputModeCopyToClipboard)
                .setValue(outputModeValue)
                .onChange(value => { outputModeValue = value as any; }));

        // Enabled
        let enabledValue = this.skill?.enabled ?? true;
        new Setting(contentEl)
            .setName(Copy.SettingSkillEnabled)
            .addToggle(toggle => toggle
                .setValue(enabledValue)
                .onChange(value => { enabledValue = value; }));

        let chatEnabledValue = this.skill?.chatEnabled ?? true;
        let pinnedValue = this.skill?.pinned ?? false;

        new Setting(contentEl)
            .setName(Copy.SettingSkillChatEnabled)
            .addToggle(toggle => toggle
                .setValue(chatEnabledValue)
                .onChange(value => {
                    chatEnabledValue = value;
                    if (!value) pinnedValue = false;
                }));

        new Setting(contentEl)
            .setName(Copy.SettingSkillPinned)
            .addToggle(toggle => toggle
                .setValue(pinnedValue)
                .onChange(value => { pinnedValue = value; }));

        // Save button
        new Setting(contentEl)
            .addButton(button => button
                .setButtonText("Save")
                .setCta()
                .onClick(async () => {
                    await this.onSave({
                        name: nameValue,
                        icon: iconValue,
                        prompt: promptValue,
                        outputMode: outputModeValue,
                        enabled: enabledValue,
                        chatEnabled: chatEnabledValue,
                        pinned: chatEnabledValue ? pinnedValue : false
                    });
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
