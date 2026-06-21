import { Modal, Notice, Setting } from "obsidian";
import { Resolve } from "Services/DependencyService";
import type { ClippingJobService } from "Services/ClippingJobService";
import { Services } from "Services/Services";
import type VaultkeeperAIPlugin from "main";
import { Copy } from "Enums/Copy";

export class ClippingModal extends Modal {
    private readonly clippingJobService: ClippingJobService;

    public constructor() {
        const plugin = Resolve<VaultkeeperAIPlugin>(Services.VaultkeeperAIPlugin);
        super(plugin.app);
        this.clippingJobService = Resolve<ClippingJobService>(Services.ClippingJobService);
    }

    public onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: Copy.ClippingModalTitle });
        contentEl.createEl("p", { text: Copy.ClippingModalDesc });

        let input = "";
        new Setting(contentEl)
            .setName(Copy.ClippingModalInput)
            .setDesc(Copy.ClippingModalInputDesc)
            .addTextArea(text => {
                text.setPlaceholder("https://www.xiaohongshu.com/...")
                    .onChange(value => input = value);
                text.inputEl.rows = 8;
                text.inputEl.style.width = "100%";
                window.setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText(Copy.ButtonCancel)
                .onClick(() => this.close()))
            .addButton(button => button
                .setButtonText(Copy.ClippingModalSubmit)
                .setCta()
                .onClick(async () => {
                    const count = await this.clippingJobService.enqueueFromText(input);
                    if (count === 0) {
                        new Notice(Copy.ClippingNoUrlFound);
                        return;
                    }
                    this.close();
                }));
    }

    public onClose(): void {
        this.contentEl.empty();
    }
}
