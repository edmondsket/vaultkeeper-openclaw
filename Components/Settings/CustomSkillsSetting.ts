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

    constructor(containerEl: HTMLElement) {
        this.containerEl = containerEl;
        this.settingsService = Resolve<SettingsService>(Services.SettingsService);
        this.customSkillService = Resolve<CustomSkillService>(Services.CustomSkillService);
    }

    public render() {
        const { containerEl } = this;

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
            .setName(skill.name)
            .setDesc(skill.prompt.substring(0, 50) + "...")
            .addToggle(toggle => toggle
                .setValue(skill.enabled)
                .onChange(async value => {
                    await this.customSkillService.updateSkill(skill.id, { enabled: value });
                }))
            .addButton(button => button
                .setIcon("pencil")
                .setTooltip(Copy.SettingSkillEdit)
                .onClick(() => {
                    new SkillEditModal(skill, async (updates) => {
                        await this.customSkillService.updateSkill(skill.id, updates);
                        this.render();
                    }).open();
                }))
            .addButton(button => button
                .setIcon("trash")
                .setTooltip(Copy.SettingSkillDelete)
                .onClick(async () => {
                    if (confirm(Copy.SettingSkillDeleteConfirm)) {
                        await this.customSkillService.deleteSkill(skill.id);
                        this.render();
                    }
                }));
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
                        enabled: enabledValue
                    });
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
