import { Conversation } from "Conversations/Conversation";
import { ConversationContent } from "Conversations/ConversationContent";
import { Role } from "Enums/Role";
import { ChatMode } from "Enums/ChatMode";
import { Notice, normalizePath } from "obsidian";
import { MainAgent } from "./AIServices/MainAgent";
import { createAIProviderForCurrentMainModel } from "./AIProviderFactory";
import { ConversationFileSystemService } from "./ConversationFileSystemService";
import { Resolve } from "./DependencyService";
import type { FileSystemService } from "./FileSystemService";
import { Services } from "./Services";
import type { WorkSpaceService } from "./WorkSpaceService";
import type { AbortService } from "./AbortService";
import { Exception } from "Helpers/Exception";
import { Copy } from "Enums/Copy";
import { replaceCopy } from "Helpers/Helpers";

interface IClippingJob {
    url: string;
    placeholderPath: string;
    conversation: Conversation;
}

export class ClippingJobService {
    private readonly fileSystemService: FileSystemService;
    private readonly workSpaceService: WorkSpaceService;
    private readonly abortService: AbortService;
    private readonly queue: IClippingJob[] = [];
    private running = false;

    public constructor() {
        this.fileSystemService = Resolve<FileSystemService>(Services.FileSystemService);
        this.workSpaceService = Resolve<WorkSpaceService>(Services.WorkSpaceService);
        this.abortService = Resolve<AbortService>(Services.AbortService);
    }

    public extractUrls(text: string): string[] {
        const matches = text.match(/https?:\/\/[^\s<>"'，。！？、)）\]]+/g) ?? [];
        return Array.from(new Set(matches.map(url => url.replace(/&amp;/g, "&"))));
    }

    public async enqueueFromText(text: string): Promise<number> {
        const urls = this.extractUrls(text);
        for (const url of urls) {
            const placeholderPath = await this.createPlaceholder(url);
            this.queue.push({
                url,
                placeholderPath,
                conversation: this.createConversation(url, placeholderPath)
            });
        }
        if (urls.length > 0) {
            new Notice(replaceCopy(Copy.ClippingQueued, [urls.length.toString()]));
            void this.runQueue();
        }
        return urls.length;
    }

    private async runQueue(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const job = this.queue.shift();
                if (!job) continue;
                await this.runJob(job);
            }
        } finally {
            this.running = false;
        }
    }

    private async runJob(job: IClippingJob): Promise<void> {
        const conversationFileSystemService = new ConversationFileSystemService();
        conversationFileSystemService.resolveAIFileService();
        const agent = new MainAgent();
        agent.useAIProvider(createAIProviderForCurrentMainModel());
        agent.setSaveCallback(async conversation => {
            await conversationFileSystemService.saveConversation(conversation);
        });

        try {
            this.abortService.initialiseAbortController();
            await conversationFileSystemService.saveConversation(job.conversation);
            await agent.runMainAgent(job.conversation, ChatMode.Edit, this.callbacks(), this.instruction(job));
            const finalPath = await this.finalisePlaceholder(job.placeholderPath);
            this.showCompleteNotice(finalPath);
        } catch (error) {
            Exception.log(error);
            const message = Exception.messageFrom(error);
            await this.markFailed(job.placeholderPath, job.url, message);
            job.conversation.contents.push(new ConversationContent({
                role: Role.Assistant,
                content: replaceCopy(Copy.ClippingFailed, [message])
            }));
            await conversationFileSystemService.saveConversation(job.conversation);
            new Notice(replaceCopy(Copy.ClippingFailed, [message]));
        }
    }

    private createConversation(url: string, placeholderPath: string): Conversation {
        const conversation = new Conversation();
        conversation.title = this.safeConversationTitle(url);
        conversation.contents.push(new ConversationContent({
            role: Role.User,
            content: this.userRequest(url, placeholderPath),
            displayContent: replaceCopy(Copy.ClippingConversationDisplay, [url])
        }));
        return conversation;
    }

    private userRequest(url: string, placeholderPath: string): string {
        return [
            `请后台剪藏这个网页：${url}`,
            `占位笔记路径：${placeholderPath}`,
            "请提取网页标题、作者、正文、来源链接和重要媒体链接，生成 Obsidian Markdown。",
            "必须通过客户端工具更新占位笔记，不要创建其他副本。"
        ].join("\n");
    }

    private instruction(job: IClippingJob): string {
        return [
            "## Background clipping task",
            "You are running as an unattended background clipping job.",
            `Source URL: ${job.url}`,
            `Placeholder note path: ${job.placeholderPath}`,
            "",
            "Requirements:",
            "- Extract the article/post title, author if available, source URL, main body, tags/topics, and useful media links.",
            "- Write the final Obsidian Markdown into the existing placeholder note path.",
            "- Use write_vault_file or patch_vault_file exactly for the placeholder path. Do not create another note or duplicate file.",
            "- Include frontmatter with source_url and status: clipped when successful.",
            "- If you cannot access or extract the content, update the placeholder note with status: failed and the reason.",
            "- After the placeholder note is updated successfully, stop and provide a short completion summary."
        ].join("\n");
    }

    private callbacks() {
        return {
            onSubmit: () => {},
            onStreamingUpdate: () => {},
            onThoughtUpdate: () => {},
            onToolCallStarted: () => {},
            onPlanningStarted: () => {},
            onPlanningFinished: () => {},
            onUserQuestion: async () => "",
            onPlanUpdate: () => {},
            onPlanStepUpdate: () => {},
            onPlanReset: () => {},
            onComplete: () => {},
        };
    }

    private async createPlaceholder(url: string): Promise<string> {
        const path = await this.uniqueInboxPath(`剪藏中-${this.timestamp()}.md`);
        const content = [
            "---",
            "status: clipping",
            `source_url: "${url.replace(/"/g, '\\"')}"`,
            `created: "${new Date().toISOString()}"`,
            "---",
            "",
            "# 正在剪藏",
            "",
            `来源：${url}`,
            "状态：等待 AI 提取内容……"
        ].join("\n");
        const result = await this.fileSystemService.writeToFilePath(path, content, true, false);
        if (result instanceof Error) throw result;
        return path;
    }

    private async markFailed(path: string, url: string, error: string): Promise<void> {
        const content = [
            "---",
            "status: failed",
            `source_url: "${url.replace(/"/g, '\\"')}"`,
            `updated: "${new Date().toISOString()}"`,
            "---",
            "",
            "# 剪藏失败",
            "",
            `来源：${url}`,
            "",
            `失败原因：${error}`
        ].join("\n");
        await this.fileSystemService.writeToFilePath(path, content, true, false);
    }

    private async finalisePlaceholder(path: string): Promise<string> {
        const content = await this.fileSystemService.readRawTextFile(path, true);
        if (content instanceof Error) return path;

        const title = this.extractTitle(content);
        if (!title) return path;

        const targetPath = await this.uniqueInboxPath(`${this.safeFileName(title)}.md`);
        if (targetPath === path) return path;

        const moveResult = await this.fileSystemService.moveFile(path, targetPath, true);
        return moveResult instanceof Error ? path : targetPath;
    }

    private showCompleteNotice(path: string): void {
        const fragment = createFragment();
        const container = fragment.createDiv();
        container.createSpan({ text: replaceCopy(Copy.ClippingComplete, [path]) });
        container.createEl("br");
        const openLink = container.createEl("a", { text: Copy.MediaOpen });
        openLink.href = "#";
        openLink.addEventListener("click", event => {
            event.preventDefault();
            void this.workSpaceService.openNoteByPath(path);
        });
        new Notice(fragment, 10000);
    }

    private extractTitle(content: string): string {
        const frontmatterTitle = /^title:\s*["']?(.+?)["']?\s*$/m.exec(content)?.[1]?.trim();
        if (frontmatterTitle) return frontmatterTitle;
        return /^#\s+(.+)\s*$/m.exec(content)?.[1]?.trim() ?? "";
    }

    private async uniqueInboxPath(fileName: string): Promise<string> {
        const base = this.safeFileName(fileName.replace(/\.md$/i, ""));
        let candidate = normalizePath(`Inbox/${base}.md`);
        let suffix = 2;
        while (await this.fileSystemService.exists(candidate, true)) {
            candidate = normalizePath(`Inbox/${base}-${suffix}.md`);
            suffix++;
        }
        return candidate;
    }

    private safeFileName(value: string): string {
        return value
            .replace(/[\\/:*?"<>|#^[\]]/g, "-")
            .replace(/\s+/g, " ")
            .replace(/-+/g, "-")
            .trim()
            .slice(0, 80) || "剪藏";
    }

    private timestamp(): string {
        const date = new Date();
        const pad = (value: number) => value.toString().padStart(2, "0");
        return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    }

    private safeConversationTitle(url: string): string {
        let host = "url";
        try {
            host = new URL(url).hostname.replace(/^www\./, "");
        } catch {
            // keep fallback
        }
        return `剪藏 - ${host} - ${this.timestamp()}`;
    }
}
