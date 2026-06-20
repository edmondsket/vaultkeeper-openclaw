import { Modal, Notice } from 'obsidian';
import ConversationHistoryModalSvelte from './ConversationHistoryModalSvelte.svelte';
import { mount, unmount } from 'svelte';
import { Resolve } from 'Services/DependencyService';
import { Services } from 'Services/Services';
import type { ConversationFileSystemService } from 'Services/ConversationFileSystemService';
import type { FileSystemService } from 'Services/FileSystemService';
import { StringTools } from "Helpers/StringTools";
import { conversationStore } from 'Stores/ConversationStore';
import { Selector } from 'Enums/Selector';
import type { ChatService } from 'Services/ChatService';
import type VaultkeeperAIPlugin from 'main';
import { Copy } from 'Enums/Copy';
import { replaceCopy } from 'Helpers/Helpers';

interface IListItem {
    id: string;
    date: string;
    updated: Date;
    title: string;
    selected: boolean;
    filePath: string;
}

export class ConversationHistoryModal extends Modal {

    private readonly conversationFileSystemService: ConversationFileSystemService = Resolve<ConversationFileSystemService>(Services.ConversationFileSystemService);
    private readonly fileSystemService: FileSystemService = Resolve<FileSystemService>(Services.FileSystemService);
    private readonly chatService: ChatService = Resolve<ChatService>(Services.ChatService);

    private component: ReturnType<typeof mount> | null = null;
    private items: IListItem[] = [];
    public onModalClose?: () => void;

    constructor() {
        const plugin = Resolve<VaultkeeperAIPlugin>(Services.VaultkeeperAIPlugin);
        super(plugin.app);
    }

    onOpen() {
        const { contentEl, modalEl, containerEl } = this;

        containerEl.addClass(Selector.ConversationHistoryModal);
        modalEl.addClass(Selector.ConversationHistoryModal);

        this.component = mount(ConversationHistoryModalSvelte, {
            target: contentEl,
            props: {
                items: [],
                loading: true,
                error: "",
                onClose: () => this.close(),
                onDelete: (itemIds: string[]) => this.handleDelete(itemIds),
                onSelect: (itemId: string) => this.handleSelect(itemId)
            }
        });
        void this.initializeContent();
    }

    private async initializeContent() {
        try {
            const summaries = await this.conversationFileSystemService.getConversationSummaries();
            this.items = summaries
                .sort((a, b) => b.updated.getTime() - a.updated.getTime())
                .map((summary) => ({
                    id: summary.filePath,
                    date: StringTools.dateToString(summary.created, false),
                    updated: summary.updated,
                    title: summary.title,
                    selected: false,
                    filePath: summary.filePath
                }));
            if (this.component) {
                this.component.items = this.items;
                this.component.loading = false;
                this.component.error = "";
            }
        } catch (error) {
            if (this.component) {
                this.component.loading = false;
                this.component.error = `${Copy.ConversationHistoryLoadFailed}: ${String(error)}`;
            }
        }
    }

    async handleSelect(itemId: string) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;

        const conversation = await this.conversationFileSystemService.loadConversation(item.filePath);
        if (conversation instanceof Error) {
            new Notice(replaceCopy(Copy.ErrorLoadConversation, [item.title]));
            return;
        }

        this.chatService.stop();
        conversationStore.loadConversation(conversation, item.filePath);
        this.close();
    }

    async handleDelete(itemIds: string[]) {
        const itemsToDelete = this.items.filter(item => itemIds.includes(item.id));

        let shouldResetChat = false;
        const currentPath = this.conversationFileSystemService.getCurrentConversationPath();

        const deletedIds: string[] = [];
        for (const item of itemsToDelete) {
            const result = await this.fileSystemService.deleteFile(item.filePath, true, false);
            if (result instanceof Error) {
                new Notice(replaceCopy(Copy.ErrorDeleteConversation, [item.title]));
                continue;
            }
            deletedIds.push(item.id);

            if (currentPath === item.filePath) {
                shouldResetChat = true;
            }
        }

        this.items = this.items.filter(item => !deletedIds.includes(item.id));

        if (this.component) {
            this.component.items = this.items;
        }

        if (shouldResetChat) {
            this.chatService.stop();
            this.conversationFileSystemService.resetCurrentConversation();
            conversationStore.reset();
        }
    }

    onClose() {
        if (this.component) {
            void unmount(this.component);
            this.component = null;
        }

        const { contentEl } = this;
        contentEl.empty();

        if (this.conversationFileSystemService.getCurrentConversationPath() === null) {
            this.onModalClose?.();
        }
    }
}
