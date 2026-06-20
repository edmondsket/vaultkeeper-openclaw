import { Resolve } from "../DependencyService";
import { Services } from "../Services";
import type { QuickAgent } from "../AIServices/QuickAgent";
import type VaultkeeperAIPlugin from "main";
import { FuzzySuggestModal, MarkdownView, Menu, Notice, TFile, type Editor, type MarkdownFileInfo } from "obsidian";
import { FileSystemService } from "../FileSystemService";
import { BeautifyPrompt } from "AIPrompts/QuickActionPrompts/BeautifyPrompt";
import Spinner from "Components/Spinner.svelte";
import { mount } from "svelte";
import { ApplyTemplatePrompt } from "AIPrompts/QuickActionPrompts/ApplyTemplatePrompt";
import { Copy } from "Enums/Copy";
import type { SettingsService, ICustomSkill, IOpenClawModelSelection, PromptOverrideKey } from "../SettingsService";
import { openPluginSettings, replaceCopy, splitFrontmatter } from "Helpers/Helpers";
import { mergeFrontmatterFields, mergeListIntoFrontmatter, parseFrontmatterYaml } from "Helpers/FrontmatterHelpers";
import { ProofreadPrompt } from "AIPrompts/QuickActionPrompts/ProofreadPrompt";
import { VaultCacheService } from "Services/VaultCacheService";
import { ApplyLinksPrompt } from "AIPrompts/QuickActionPrompts/ApplyLinksPrompt";
import { ApplyTagsPrompt } from "AIPrompts/QuickActionPrompts/ApplyTagsPrompt";
import { GenerateFrontmatterPrompt } from "AIPrompts/QuickActionPrompts/GenerateFrontmatterPrompt";
import { Semaphore } from "Helpers/Semaphore";
import { SuggestTagsPrompt } from "AIPrompts/QuickActionPrompts/SuggestTagsPrompt";

export class QuickActionsDefinitionsService {

    private plugin: VaultkeeperAIPlugin;
    private fileSystemService: FileSystemService;
    private vaultcacheService: VaultCacheService;
    private settingsService: SettingsService;

    private semaphore: Semaphore = new Semaphore(1, true);

    public constructor() {
        this.plugin = Resolve<VaultkeeperAIPlugin>(Services.VaultkeeperAIPlugin);
        this.fileSystemService = Resolve<FileSystemService>(Services.FileSystemService);
        this.vaultcacheService = Resolve<VaultCacheService>(Services.VaultCacheService);
        this.settingsService = Resolve<SettingsService>(Services.SettingsService);
    }

    public async proofread(_menu: Menu, editor: Editor, view: MarkdownView | MarkdownFileInfo, modelSelection?: IOpenClawModelSelection) {
        await this.asSerialAction("Proofread", async () => {
            const file = view.file;
            if (!file) {
                return;
            }

            const selection = editor.getSelection();
            const content = await this.fileSystemService.readFile(file);

            if (content instanceof Error || (selection.trim() === "" && content.trim() === "")) {
                return; // Either an excluded file or nothing to proofread
            }

            const notice = this.showNotice(Copy.QuickActionProofreading);
            try {
                if (selection.length > 0) {
                    const result = await this.performAction(this.prompt("builtin-proofread", ProofreadPrompt), selection, modelSelection);
                    if (result) {
                        await this.fileSystemService.patchFile(file, [selection], [result], false, false);
                    }
                } else {
                    const { body } = splitFrontmatter(content);
                    if (body.trim() === "") {
                        return;
                    }
                    const result = await this.performAction(this.prompt("builtin-proofread", ProofreadPrompt), body, modelSelection);
                    if (result) {
                        await this.fileSystemService.patchFile(file, [body], [result], false, false);
                    }
                }
            } finally {
                notice.hide();
            }
        });
    }

    public async beautify(_menu: Menu, editor: Editor, view: MarkdownView | MarkdownFileInfo, modelSelection?: IOpenClawModelSelection) {
        await this.asSerialAction("Beautify", async () => {
            const file = view.file;
            if (!file) {
                return;
            }

            const selection = editor.getSelection();
            const content = await this.fileSystemService.readFile(file);

            if (content instanceof Error || (selection.trim() === "" && content.trim() === "")) {
                return; // Either an excluded file or nothing to beautify
            }

            const notice = this.showNotice(Copy.QuickActionBeautifying);
            try {
                if (selection.length > 0) {
                    const result = await this.performAction(this.prompt("builtin-beautify", BeautifyPrompt), selection, modelSelection);
                    if (result) {
                        await this.fileSystemService.patchFile(file, [selection], [result], false, false);
                    }
                } else {
                    const { body } = splitFrontmatter(content);
                    if (body.trim() === "") {
                        return;
                    }
                    const result = await this.performAction(this.prompt("builtin-beautify", BeautifyPrompt), body, modelSelection);
                    if (result) {
                        await this.fileSystemService.patchFile(file, [body], [result], false, false);
                    }
                }
            } finally {
                notice.hide();
            }
        });
    }

    public async applyTemplate(_menu: Menu, _editor: Editor, view: MarkdownView | MarkdownFileInfo, modelSelection?: IOpenClawModelSelection) {
        const file = view.file;
        if (!file) {
            return;
        }

        const preview = await this.fileSystemService.readFile(file);
        if (preview instanceof Error || preview.trim() === "") {
            return; // Either an excluded file or nothing to apply a template to
        }

        this.userSelectFile(this.plugin, async (templateFile) => {
            await this.asSerialAction("Apply template", async () => {
                const content = await this.fileSystemService.readFile(file);
                if (content instanceof Error || content.trim() === "") {
                    return; // Either an excluded file or nothing to apply a template to
                }

                const templateContent = await this.fileSystemService.readFile(templateFile);
                if (templateContent instanceof Error || templateContent.trim() === "") {
                    return; // Either an excluded file or the template is empty
                }

                const prompt = replaceCopy(this.prompt("builtin-apply-template", ApplyTemplatePrompt),
                    [
                        new Date(file.stat.ctime).toString(),
                        new Date(file.stat.mtime).toString(),
                        file.stat.size.toString(),
                        new Date().toString()
                    ]);

                const notice = this.showNotice(Copy.QuickActionApplyingTemplate);
                try {
                    const context = `${Copy.ApplyTemplateTemplateSeparator}\n${templateContent}\n${Copy.ApplyTemplateContentSeparator}\n${content}`;
                    const result = await this.performAction(prompt, context, modelSelection);
                    if (result && result.trim() !== Copy.ApplyTemplateCancelled.toString()) {
                        await this.fileSystemService.writeToFile(file, result, false, false);
                    }
                } finally {
                    notice.hide();
                }
            });
        });
    }

    public async applyLinks(_menu: Menu, editor: Editor, view: MarkdownView | MarkdownFileInfo, modelSelection?: IOpenClawModelSelection) {
        await this.asSerialAction("Apply links", async () => {
            const file = view.file;
            if (!file) {
                return;
            }

            const selection = editor.getSelection();
            const content = await this.fileSystemService.readFile(file);

            if (content instanceof Error || (selection.trim() === "" && content.trim() === "")) {
                return; // Either an excluded file or nothing to proofread
            }

            const links = this.vaultcacheService.wikiLinks.links.join("\n");
            const prompt = replaceCopy(this.prompt("builtin-apply-links", ApplyLinksPrompt), [links]);

            const notice = this.showNotice(Copy.QuickActionApplyingLinks);
            try {
                if (selection.length > 0) {
                    const result = await this.performAction(prompt, selection, modelSelection);
                    if (result) {
                        await this.fileSystemService.patchFile(file, [selection], [result], false, false);
                    }
                } else {
                    const { body } = splitFrontmatter(content);
                    if (body.trim() === "") {
                        return;
                    }
                    const result = await this.performAction(prompt, body, modelSelection);
                    if (result) {
                        await this.fileSystemService.patchFile(file, [body], [result], false, false);
                    }
                }
            } finally {
                notice.hide();
            }
        });
    }

    public async applyTags(_menu: Menu, _editor: Editor, view: MarkdownView | MarkdownFileInfo, modelSelection?: IOpenClawModelSelection) {
        await this.asSerialAction("Apply tags", async () => {
            const file = view.file;
            if (!file) {
                return;
            }

            const content = await this.fileSystemService.readFile(file);

            if (content instanceof Error || content.trim() === "") {
                return; // Either an excluded file or nothing to tag
            }

            const { body } = splitFrontmatter(content);
            if (body.trim() === "") {
                return; // Nothing to base tags on
            }

            const allowedTags = this.vaultcacheService.tags;
            const prompt = replaceCopy(this.prompt("builtin-apply-tags", ApplyTagsPrompt), [Array.from(allowedTags).join("\n")]);

            const notice = this.showNotice(Copy.QuickActionApplyingTags);
            try {
                const result = await this.performAction(prompt, body, modelSelection);
                if (!result || result.trim() === "") {
                    return;
                }

                const chosen = result
                    .split(/\r?\n/)
                    .map(tag => tag.trim())
                    .map(tag => tag.length > 0 && !tag.startsWith("#") ? `#${tag}` : tag)
                    .filter(tag => tag.length > 0 && allowedTags.has(tag))
                    .map(tag => tag.replace(/^#/, ""));

                if (chosen.length === 0) {
                    return;
                }

                await this.fileSystemService.updateFrontmatter(file, frontmatter => {
                    mergeListIntoFrontmatter(frontmatter, "tags", chosen);
                });
            } finally {
                notice.hide();
            }
        });
    }

    public async suggestTags(_menu: Menu, _editor: Editor, view: MarkdownView | MarkdownFileInfo, modelSelection?: IOpenClawModelSelection) {
        await this.asSerialAction("Suggest tags", async () => {
            const file = view.file;
            if (!file) {
                return;
            }

            const content = await this.fileSystemService.readFile(file);

            if (content instanceof Error || content.trim() === "") {
                return; // Either an excluded file or nothing to tag
            }

            const { body } = splitFrontmatter(content);
            if (body.trim() === "") {
                return; // Nothing to base tags on
            }

            const availableTags = this.vaultcacheService.tags;
            const prompt = replaceCopy(this.prompt("builtin-suggest-tags", SuggestTagsPrompt), [Array.from(availableTags).join("\n")]);

            const notice = this.showNotice(Copy.QuickActionSuggestingTags);
            try {
                const result = await this.performAction(prompt, body, modelSelection);
                if (!result || result.trim() === "") {
                    return;
                }

                const chosen = result
                    .split(/\r?\n/)
                    .map(tag => tag.trim())
                    .map(tag => tag.length > 0 && !tag.startsWith("#") ? `#${tag}` : tag)
                    .filter(tag => tag.length > 0)
                    .map(tag => tag.replace(/^#/, ""));

                if (chosen.length === 0) {
                    return;
                }

                await this.fileSystemService.updateFrontmatter(file, frontmatter => {
                    mergeListIntoFrontmatter(frontmatter, "tags", chosen);
                });
            } finally {
                notice.hide();
            }
        });
    }

    public async generateFrontmatter(_menu: Menu, _editor: Editor, view: MarkdownView | MarkdownFileInfo, modelSelection?: IOpenClawModelSelection) {
        await this.asSerialAction("Generate frontmatter", async () => {
            const file = view.file;
            if (!file) {
                return;
            }

            const content = await this.fileSystemService.readFile(file);

            if (content instanceof Error || content.trim() === "") {
                return; // Either an excluded file or nothing to describe
            }

            const { body } = splitFrontmatter(content);
            if (body.trim() === "") {
                return; // Nothing to base frontmatter on
            }

            const availableTags = this.vaultcacheService.tags;
            const prompt = replaceCopy(this.prompt("builtin-generate-frontmatter", GenerateFrontmatterPrompt),
                [
                    Array.from(availableTags).join("\n"),
                    new Date(file.stat.ctime).toString(),
                    new Date().toString()
                ]);

            const notice = this.showNotice(Copy.QuickActionGeneratingFrontmatter);
            try {
                const result = await this.performAction(prompt, body, modelSelection);
                if (!result || result.trim() === "") {
                    return;
                }

                const suggested = parseFrontmatterYaml(result);
                if (!suggested) {
                    return; // Model returned something that isn't a frontmatter object
                }

                await this.fileSystemService.updateFrontmatter(file, frontmatter => {
                    mergeFrontmatterFields(frontmatter, suggested);
                });
            } finally {
                notice.hide();
            }
        });
    }

    /* Custom Skills */

    public async executeCustomSkill(skill: ICustomSkill, editor: Editor, view: MarkdownView | MarkdownFileInfo) {
        await this.asSerialAction(skill.name, async () => {
            const file = view.file;
            if (!file) return;

            const content = await this.fileSystemService.readFile(file);
            if (content instanceof Error) return;

            const { body } = splitFrontmatter(content);
            const selection = editor.getSelection();

            let inputText: string;
            const isReplacingSelection = skill.outputMode === "replace_selection" || skill.outputMode === "insert_at_cursor";

            if (isReplacingSelection && selection.trim() !== "") {
                inputText = selection;
            } else if (skill.outputMode === "replace_body" || (isReplacingSelection && selection.trim() === "")) {
                if (body.trim() === "") return;
                inputText = body;
            } else {
                if (body.trim() === "") return;
                inputText = body;
            }

            const notice = this.showNotice(replaceCopy(Copy.CustomSkillRunning, [skill.name]));
            try {
                const result = await this.performAction(skill.prompt, inputText, skill.modelSelection);
                if (result && result.trim() !== "") {
                    switch (skill.outputMode) {
                        case "replace_selection":
                        case "replace_body":
                            await this.fileSystemService.patchFile(file, [inputText], [result], false, false);
                            break;
                        case "insert_at_cursor":
                            editor.replaceSelection(result);
                            break;
                        case "copy_to_clipboard":
                            await navigator.clipboard.writeText(result);
                            new Notice("Result copied to clipboard", 3000);
                            break;
                    }
                }
            } finally {
                notice.hide();
            }
        });
    }

    /* Helpers */

    private userSelectFile(plugin: VaultkeeperAIPlugin, onSelected: (file: TFile) => Promise<void>): void {
        const fileSystemService = this.fileSystemService;

        new (class extends FuzzySuggestModal<TFile> {
            getItems()             { return fileSystemService.getMarkdownFiles(); }
            getItemText(f: TFile)  { return f.path; }
            onChooseItem(f: TFile) { void onSelected(f); }
        })(plugin.app).open();
    }

    private async asSerialAction(name: string, action: () => Promise<void>): Promise<void> {
        if (!await this.semaphore.wait(30000)) {
            this.showNotice(replaceCopy(Copy.QuickActionTimedOut, [name]), 3000);
            return;
        }

        try {
            await action();
        } finally {
            this.semaphore.release();
        }
    }

    private async performAction(action: string, context: string, modelSelection?: IOpenClawModelSelection): Promise<string | null> {
        if (this.settingsService.getApiKeyForCurrentModel().trim() == "") {
            openPluginSettings(this.plugin);
            return null;
        }
        const agent = Resolve<QuickAgent>(Services.QuickAgent);
        agent.resolveAIProvider();
        return agent.quickAction(action, context, modelSelection);
    }

    private prompt(key: PromptOverrideKey, fallback: string): string {
        const value = this.settingsService.settings.promptOverrides?.[key]?.trim();
        return value ? value : fallback;
    }

    private showNotice(message: string, durationMs: number = 0): Notice {
        const fragment = createFragment();
        const container = fragment.createDiv();

        container.addClass("quick-action-notice");
        mount(Spinner, { target: container, props: {
            width: "var(--size-4-4)",
            height: "var(--size-4-4)",
            background: "var(--background-modifier-message)"
        }});

        container.createSpan({ text: message });

        return new Notice(fragment, durationMs);
    }
}
