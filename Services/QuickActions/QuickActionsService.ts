import type VaultkeeperAIPlugin from "main";
import { MarkdownView, Menu, setIcon, type EventRef, Notice, Platform } from "obsidian";
import { Resolve } from "Services/DependencyService";
import { Services } from "Services/Services";
import type { SettingsService } from "Services/SettingsService";
import { WorkSpaceService } from "Services/WorkSpaceService";
import type { QuickActionsDefinitionsService } from "./QuickActionsDefinitionsService";
import type { HelpModal } from "Modals/HelpModal";
import { AssetsService } from "Services/AssetsService";
import { Copy } from "Enums/Copy";
import type { CustomSkillService } from "Services/CustomSkills/CustomSkillService";
import type { ICustomSkill } from "Services/SettingsService";
import type { SkillContext } from "Services/CustomSkills/CustomSkillService";
import { splitFrontmatter } from "Helpers/Helpers";
import { parseFrontmatterYaml } from "Helpers/FrontmatterHelpers";
import { FileSystemService } from "Services/FileSystemService";

export class QuickActionsService {

    private readonly plugin: VaultkeeperAIPlugin;
    private readonly assetsService: AssetsService;
    private readonly settingsService: SettingsService;
    private readonly workSpaceService: WorkSpaceService;
    private readonly quickActionsDefinitionsService: QuickActionsDefinitionsService;
    private readonly customSkillService: CustomSkillService;
    private readonly fileSystemService: FileSystemService;

    private editorMenuEventRef: EventRef | null = null;
    private layoutChangeEventRef: EventRef | null = null;
    private commandIds: string[] = [];
    private registeredCommandIds = new Set<string>();

    private readonly settingsSubscription: object;
    
    public constructor() {
        this.plugin = Resolve<VaultkeeperAIPlugin>(Services.VaultkeeperAIPlugin);
        this.assetsService = Resolve<AssetsService>(Services.AssetsService);
        this.settingsService = Resolve<SettingsService>(Services.SettingsService);
        this.workSpaceService = Resolve<WorkSpaceService>(Services.WorkSpaceService);
        this.quickActionsDefinitionsService = Resolve<QuickActionsDefinitionsService>(Services.QuickActionsDefinitionsService);
        this.customSkillService = Resolve<CustomSkillService>(Services.CustomSkillService);
        this.fileSystemService = Resolve<FileSystemService>(Services.FileSystemService);

        this.settingsSubscription = this.settingsService.subscribeToSettingsChanged(changed => {
            if (changed.includes("enableToolbarActions") || changed.includes("enableContextMenuActions") || changed.includes("customSkills")) {
                this.updateRegistrations();
            }
        });

        this.registerEditorMenuActions();
        this.registerViewActions();
        this.registerCommands();
        this.registerCustomSkillCommands();
    }

    public dispose() {
        this.settingsService.unsubscribe(this.settingsSubscription);
        this.unregisterEditorMenuActions();
        this.unregisterViewActions();
        this.unregisterCommands();
    }

    /* Action Registration */

    private registerEditorMenuActions() {
        if (!this.settingsService.settings.enableContextMenuActions) {
            this.unregisterEditorMenuActions();
            return;
        }
        if (this.editorMenuEventRef) {
            return;
        }

        this.editorMenuEventRef = this.plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
            this.addBuiltInMenuItems(menu, editor, view);
            this.addCustomSkillMenuItems(menu, editor, view);
            menu.addSeparator();
            menu.addItem((item) =>
                item.setTitle(Copy.QuickActionMenu)
                    .setIcon("circle-question-mark")
                    .onClick(() => {
                        const modal = Resolve<HelpModal>(Services.HelpModal);
                        modal.open(6);
                    })
            );
        });
        this.plugin.registerEvent(this.editorMenuEventRef);
    }

    private addBuiltInMenuItems(menu: Menu, editor: import("obsidian").Editor, view: MarkdownView | import("obsidian").MarkdownFileInfo) {
        for (const skill of this.customSkillService.getEnabledBuiltInSkills()) {
            menu.addItem((item) => {
                item.setTitle(skill.name)
                    .setIcon(skill.icon as any)
                    .onClick(async () => this.executeBuiltInSkill(skill, menu, editor, view));
            });
        }
    }

    private addCustomSkillMenuItems(menu: Menu, editor: import("obsidian").Editor, view: MarkdownView | import("obsidian").MarkdownFileInfo) {
        const skills = this.customSkillService.getEnabledSkills().filter(skill => !skill.builtIn);
        if (skills.length === 0) return;

        menu.addSeparator();
        for (const skill of skills) {
            menu.addItem((item) => {
                item.setTitle(skill.name)
                    .setIcon(skill.icon as any)
                    .onClick(async () => this.executeCustomSkill(skill, editor, view));
            });
        }
    }

    private async executeCustomSkill(skill: ICustomSkill, editor: import("obsidian").Editor, view: MarkdownView | import("obsidian").MarkdownFileInfo) {
        const file = view.file;
        if (!file) return;

        const content = await this.fileSystemService.readFile(file);
        if (content instanceof Error) return;

        const selection = editor.getSelection();
        const { body, frontmatter: frontmatterText } = splitFrontmatter(content);
        const frontmatter = parseFrontmatterYaml(frontmatterText) ?? {};
        const tags = (frontmatter?.tags ?? []) as string[];

        const context: SkillContext = {
            file,
            editor,
            selection: selection || undefined,
            body: body || undefined,
            fileContent: content || undefined,
            fileName: file.name,
            tags: Array.isArray(tags) ? tags : [tags],
            title: String(frontmatter?.title ?? file.basename)
        };

        const notice = new Notice(`${skill.name}...`, 0);
        try {
            await this.customSkillService.executeSkill(skill, context);
        } finally {
            notice.hide();
        }
    }

    private async executeBuiltInSkill(skill: ICustomSkill, menu: Menu, editor: import("obsidian").Editor, view: MarkdownView | import("obsidian").MarkdownFileInfo) {
        switch (skill.id) {
            case "builtin-proofread":
                await this.quickActionsDefinitionsService.proofread(menu, editor, view, skill.modelSelection);
                break;
            case "builtin-beautify":
                await this.quickActionsDefinitionsService.beautify(menu, editor, view, skill.modelSelection);
                break;
            case "builtin-apply-template":
                await this.quickActionsDefinitionsService.applyTemplate(menu, editor, view, skill.modelSelection);
                break;
            case "builtin-apply-links":
                await this.quickActionsDefinitionsService.applyLinks(menu, editor, view, skill.modelSelection);
                break;
            case "builtin-apply-tags":
                await this.quickActionsDefinitionsService.applyTags(menu, editor, view, skill.modelSelection);
                break;
            case "builtin-suggest-tags":
                await this.quickActionsDefinitionsService.suggestTags(menu, editor, view, skill.modelSelection);
                break;
            case "builtin-generate-frontmatter":
                await this.quickActionsDefinitionsService.generateFrontmatter(menu, editor, view, skill.modelSelection);
                break;
        }
    }

    private registerViewActions() {
        if (!this.settingsService.settings.enableToolbarActions) {
            this.unregisterViewActions();
            return;
        }
        if (this.layoutChangeEventRef) {
            return;
        }

        this.layoutChangeEventRef = this.plugin.app.workspace.on("layout-change", () => {
            this.injectToolbarButton();
        });
        this.plugin.registerEvent(this.layoutChangeEventRef);
        this.injectToolbarButton();
    }

    private injectToolbarButton() {
        const leaves = this.workSpaceService.getLeavesOfType("markdown");
        for (const leaf of leaves) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) {
                continue;
            }

            const actionsEl = view.containerEl.querySelector(".view-actions");
            if (!actionsEl || actionsEl.querySelector(".vault-keeper-ai-actions")) {
                continue;
            }

            const button = createEl("button", { cls: "clickable-icon view-action vault-keeper-ai-actions" });
            button.setAttribute("aria-label", Copy.QuickActionAriaLabel);
            button.addEventListener("click", (evt) => {
                const { editor } = view;
                const menu = new Menu();
                this.addBuiltInMenuItems(menu, editor, view);
                this.addCustomSkillMenuItems(menu, editor, view);
                menu.addSeparator();
                menu.addItem((item) =>
                    item.setTitle(Copy.QuickActionMenu)
                        .setIcon("circle-question-mark")
                        .onClick(() => {
                            const modal = Resolve<HelpModal>(Services.HelpModal);
                            modal.open(6);
                        })
                );
                menu.showAtMouseEvent(evt);
            });
            setIcon(button, this.assetsService.pluginIcon);
            actionsEl.prepend(button);
        }
    }

    /* Commands for Android/Mobile */

    private registerCommands() {
        for (const skill of this.customSkillService.getEnabledBuiltInSkills()) {
            this.registerCommand(skill.id.replace("builtin-", "vaultkeeper-"), skill.name, skill.icon, async (editor, view) => {
                const currentSkill = this.customSkillService.getEnabledBuiltInSkills().find(item => item.id === skill.id);
                if (currentSkill) {
                    const menu = new Menu();
                    await this.executeBuiltInSkill(currentSkill, menu, editor, view);
                }
            });
        }
    }

    private registerCustomSkillCommands() {
        const skills = this.customSkillService.getEnabledSkills().filter(skill => !skill.builtIn);
        for (const skill of skills) {
            const commandId = `vaultkeeper-skill-${skill.id}`;
            this.registerCommand(commandId, skill.name, skill.icon as any, async (editor, view) => {
                const currentSkill = this.customSkillService.getEnabledSkills().find(item => item.id === skill.id && !item.builtIn);
                if (currentSkill) {
                    await this.executeCustomSkill(currentSkill, editor, view);
                }
            });
        }
    }

    private registerCommand(
        id: string,
        name: string,
        icon: string,
        callback: (editor: import("obsidian").Editor, view: MarkdownView | import("obsidian").MarkdownFileInfo) => Promise<void>
    ) {
        if (this.registeredCommandIds.has(id)) {
            return;
        }
        this.registeredCommandIds.add(id);
        this.commandIds.push(id);
        this.plugin.addCommand({
            id,
            name,
            icon,
            editorCallback: (editor, view) => {
                void callback(editor, view);
            }
        });
    }

    private unregisterCommands() {
        // Obsidian does not expose a command unregister API. Keep already
        // registered commands alive and avoid duplicate registration by ID.
    }

    private updateRegistrations() {
        this.registerEditorMenuActions();
        this.registerViewActions();
        this.unregisterCommands();
        this.registerCommands();
        this.registerCustomSkillCommands();
    }

    private unregisterEditorMenuActions() {
        if (this.editorMenuEventRef) {
            this.plugin.app.workspace.offref(this.editorMenuEventRef);
            this.editorMenuEventRef = null;
        }
    }

    private unregisterViewActions(){
        if (this.layoutChangeEventRef) {
            this.plugin.app.workspace.offref(this.layoutChangeEventRef);
            this.layoutChangeEventRef = null;
            this.plugin.app.workspace.containerEl
                .querySelectorAll(".vault-keeper-ai-actions")
                .forEach(element => element.remove());
        }
    }
}
