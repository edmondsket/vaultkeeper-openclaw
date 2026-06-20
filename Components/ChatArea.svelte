<script lang="ts">
  import { Resolve } from "Services/DependencyService";
  import { Services } from "Services/Services";
  import type { StreamingMarkdownService } from "Services/StreamingMarkdownService";
	import ThoughtIndicator from "./ThoughtIndicator.svelte";
	import StreamingIndicator from "./StreamingIndicator.svelte";
	import { Greeting } from "Enums/Greeting";
	import { Role } from "Enums/Role";
  import type { ConversationContent } from "Conversations/ConversationContent";
	import { tick } from "svelte";
	import { getOuterHeight, setElementIcon } from "Helpers/ElementHelper";
	import { setIcon, TFile } from "obsidian";
	import { fade } from "svelte/transition";
	import { Copy } from "Enums/Copy";
	import { Path } from "Enums/Path";
	import type { ConversationMedia } from "Conversations/ConversationMedia";
	import type VaultkeeperAIPlugin from "main";

  export let messages: ConversationContent[] = [];
  export let currentThought: string | null = null;
  export let isSubmitting: boolean = false;
  export let chatContainer: HTMLDivElement;

  export function resetChatArea() {
    messageElements = [];
    if (chatAreaPaddingElement) {
      chatAreaPaddingElement.style.padding = "0px";
    }
    chatContainer.scroll({ top: 0, behavior: "instant" });
  }

  export async function updateChatAreaLayout(behavior: ScrollBehavior | undefined = undefined, shouldSettle: boolean = false) {
    await tick();

    if (!chatAreaPaddingElement) {
      return;
    }

    if (messageElements.length <= 0) {
      chatAreaPaddingElement.style.paddingBottom = "0px";
      return;
    }

    requestAnimationFrame(() => {
      applyLayout(behavior, shouldSettle);
      updateScrolledState();
    });
  }

  function applyLayout(behavior: ScrollBehavior | undefined, shouldSettle: boolean) {
    if (!chatAreaPaddingElement || messageElements.length <= 0) {
      return;
    }

    const styles = getComputedStyle(chatContainer);
    const gap = parseFloat(styles.gap) || 0;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const paddingBottom = parseFloat(styles.paddingBottom) || 0;

    const sortedMessages = messageElements.sort((a, b) => a.index - b.index);
    
    let result = calculateMessageHeight(sortedMessages);
    let contentHeight = result.height + (gap * (result.count - 1));

    if (!shouldSettle) {
      if (thoughtIndicatorElement) {
        contentHeight += getOuterHeight(thoughtIndicatorElement) + gap;
      }
      if (streamingIndicatorElement) {
        contentHeight += getOuterHeight(streamingIndicatorElement) + gap;
      }
    }

    const availableHeight = chatContainer.offsetHeight - paddingTop - paddingBottom;
    let padding = shouldSettle
      ? Math.max(0, availableHeight - contentHeight)
      : Math.max(25, availableHeight - contentHeight);

    chatAreaPaddingElement.style.paddingBottom = `${padding}px`;

    if (behavior) {
      chatContainer.scroll({ top: chatContainer.scrollHeight, behavior });
    }
  }

  function calculateMessageHeight(sortedMessages: { element: HTMLElement, index: number, role: Role }[]): { count: number, height: number } {
    const lastMessage = sortedMessages[sortedMessages.length - 1];
    if (lastMessage.role === Role.User) {
      return { count: 1, height: getOuterHeight(lastMessage.element) };
    }

    let count = 0;
    let height = 0;

    for (const message of sortedMessages.reverse()) {
      if (message.role === Role.User) {
        break;
      }
      height += getOuterHeight(message.element);
      count++;
    }
    return { count: count, height: height };
  }

  function updateScrolledState() {
    scrolledToBottom = chatContainer && Math.abs(chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight) < 100;
  }

  let scrolledToBottom: boolean = true;

  let scrollToBottomButton: HTMLButtonElement;
  let chatAreaPaddingElement: HTMLElement | undefined;
  let thoughtIndicatorElement: HTMLElement | undefined;
  let streamingIndicatorElement: HTMLElement | undefined;

  let streamingMarkdownService: StreamingMarkdownService = Resolve<StreamingMarkdownService>(Services.StreamingMarkdownService);
  const plugin = Resolve<VaultkeeperAIPlugin>(Services.VaultkeeperAIPlugin);

  let messageElements: { element: HTMLElement, index: number, role: Role }[] = [];

  function getMediaFile(media: ConversationMedia): TFile | null {
    if (!media.filePath) return null;
    const file = plugin.app.vault.getAbstractFileByPath(`${Path.Conversations}/${media.filePath}`);
    return file instanceof TFile ? file : null;
  }

  function getMediaResourceUrl(media: ConversationMedia): string {
    const file = getMediaFile(media);
    return file ? plugin.app.vault.getResourcePath(file) : "";
  }

  async function openMedia(media: ConversationMedia) {
    const file = getMediaFile(media);
    if (!file) return;
    try {
      await plugin.app.workspace.getLeaf("tab").openFile(file);
    } catch {
      const link = document.createElement("a");
      link.href = plugin.app.vault.getResourcePath(file);
      link.download = media.fileName;
      link.click();
    }
  }

  function getMediaError(media: ConversationMedia): string {
    const error = media.error?.toLowerCase() ?? "";
    if (error.includes("limit") || error.includes("too large") || error.includes("exceeds")) return Copy.MediaTooLarge;
    if (error.includes("download") || error.includes("http") || error.includes("timed out")) return Copy.MediaDownloadFailed;
    return Copy.MediaFailed;
  }

  function getGreetingByTime(): string {
    const hour = new Date().getHours();

    // Morning: 5am - 11:59am
    if (hour >= 5 && hour < 12) {
      return Greeting.Morning;
    }
    // Midday: 12pm - 4:59pm
    else if (hour >= 12 && hour < 17) {
      return Greeting.Midday;
    }
    // Evening: 5pm - 8:59pm
    else if (hour >= 17 && hour < 21) {
      return Greeting.Evening;
    }
    // Night: 9pm - 4:59am
    else {
      return Greeting.Night;
    }
  }

  function messageRenderAction(element: HTMLElement, message: ConversationContent) {
    streamingMarkdownService.render(message.getDisplayContent(), element);
    return {
      update(newMessage: ConversationContent) {
        streamingMarkdownService.render(newMessage.getDisplayContent(), element, !isSubmitting);
      }
    };
  }

  function trackingAction(element: HTMLElement, { index, role }: { index: number, role: Role }) {
    messageElements.push({ index: index, element: element, role: role });
  }

  $: if (scrollToBottomButton) {
    setIcon(scrollToBottomButton, "arrow-down");
  }

  $: {
    if (messages.length === 0 && chatAreaPaddingElement) {
      chatAreaPaddingElement.style.padding = "0px";
    }
  }
</script>

<div class="chat-area-wrapper">
  {#if messages.length > 0}
    <div class="top-fade"></div>
  {/if}
  <div class="chat-area" bind:this={chatContainer} on:scroll={updateScrolledState}>
    {#each messages as message, index}
      {@const content = message.getDisplayContent()}
      {#if message.shouldDisplayContent && (content.trim() !== "" || message.media.length > 0)}
        {#if message.role === Role.User}
          <div class="message-container {Role.User}" use:trackingAction={{ index, role: Role.User }}>
            <div class="message-bubble {Role.User}">
              <div class="message-text-user-container" contenteditable="false">
                <div class="message-text-user">
                  {@html content}
                </div>
              </div>
              {#if message.references.length > 0}
                <hr class="message-attachment-break"/>
                <div class="message-attachments-container">
                  {#each message.references as reference}
                    <div class="message-attachmanet" aria-label="{reference.fileName}">
                      <div
                        class="message-attachment-icon"
                        use:setElementIcon={reference.getIconName()}
                      ></div>
                      <div class="message-attachment-info">
                        <div class="message-attachment-name">{reference.fileName}</div>
                        <div class="message-attachment-size">{reference.size}MB</div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {:else}
          {@const messageId = message.timestamp.getTime().toString()}
          <div class="message-container {Role.Assistant}" use:trackingAction={{ index, role: Role.Assistant }}>
            <div class="message-bubble {Role.Assistant}">
              {#if content.trim() !== ""}
                <div class="markdown-content">
                  <div use:messageRenderAction={message} class="streaming-content"></div>
                </div>
              {/if}
              {#if message.media.length > 0}
                <div class="response-media-grid">
                  {#each message.media as media}
                    {#if media.status === "error" || !media.filePath}
                      <div class="response-media-card response-media-error">
                        <div class="response-media-name">{media.fileName}</div>
                        <div class="response-media-meta" title={media.error}>{getMediaError(media)}</div>
                      </div>
                    {:else if media.isPreviewableImage}
                      <button class="response-media-image" aria-label={`${Copy.MediaOpen} ${media.fileName}`} on:click={() => openMedia(media)}>
                        <img src={getMediaResourceUrl(media)} alt={media.fileName} loading="lazy" />
                        <span>{media.fileName} · {media.sizeMB} MB</span>
                      </button>
                    {:else}
                      <button class="response-media-card" on:click={() => openMedia(media)}>
                        <div class="response-media-name">{media.fileName}</div>
                        <div class="response-media-meta">{media.mimeType} · {media.sizeMB} MB</div>
                        <div class="response-media-open">{Copy.MediaOpen}</div>
                      </button>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    {/each}

    <ThoughtIndicator thought={currentThought} bind:thoughtIndicatorElement={thoughtIndicatorElement}/>
    {#if isSubmitting}
      <StreamingIndicator bind:streamingIndicatorElement={streamingIndicatorElement}/>
    {/if}

    <div bind:this={chatAreaPaddingElement} style:user-select=none></div>

    {#if messages.length === 0}
      <div class="conversation-empty-state">
        <div class="typing-in">{getGreetingByTime()}</div>
      </div>
    {/if}

  </div>

  {#if messages.length > 0}
    <div class="bottom-fade"></div>
  {/if}

  {#if !scrolledToBottom}
    <div class="scroll-to-bottom-container" transition:fade>
      <button
        id="scroll-to-bottom-button"
        bind:this={scrollToBottomButton}
        on:click={() => updateChatAreaLayout("smooth")}
        aria-label={Copy.ButtonScrollToBottom}>
      </button>
    </div>
  {/if}
</div>

<style>
  .scroll-to-bottom-container {
    background-color: color-mix(in srgb, var(--background-primary) 70%, transparent);
    border-radius: var(--radius-l);
    padding: var(--size-4-2);
    position: absolute;
    bottom: var(--size-4-2);
    right: 0px;
  }

  #scroll-to-bottom-button {
    background-color: var(--interactive-accent);
  }

  .chat-area-wrapper {
    position: relative;
    height: 100%;
    width: 100%;
  }

  .top-fade {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: var(--size-4-4);
    background-image: linear-gradient(to bottom, var(--background-secondary), transparent);
    z-index: 10;
    pointer-events: none;
  }

  .bottom-fade {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--size-4-4);
    background-image: linear-gradient(to top, var(--background-secondary), transparent);
    z-index: 10;
    pointer-events: none;
  }

  .chat-area {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
    padding: var(--size-4-4) var(--size-4-3) var(--size-4-3) var(--size-4-3);
    gap: var(--size-4-2);
    scroll-behavior: smooth;
  }

  .chat-area::-webkit-scrollbar {
    display: none;
  }

  .message-container {
    display: flex;
    text-align: left;
    margin: 0;
  }
  
  .message-container.user {
    justify-content: flex-end;
  }
  
  .message-container.assistant {
    justify-content: flex-start;
  }

  .message-container {
    animation: fadeIn 0.5s ease-out forwards;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .message-bubble {
    word-wrap: break-word;
  }

  .message-bubble.user {
    word-wrap: break-word;
    max-width: 70%;
    border: var(--border-width) solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    padding: 0px var(--size-4-2);
  }

  .message-bubble.assistant {
    word-wrap: break-word;
    max-width: 100%;
  }

  .message-text-user-container {
    max-height: 15vh;
    overflow: scroll;
    padding-top: var(--size-4-2);
    white-space: pre-wrap;
  }

  .message-text-user-container::-webkit-scrollbar {
    display: none;
  }

  .message-text-user-container {
    padding-bottom: var(--size-4-2);
  }
  
  .conversation-empty-state {
    margin: auto;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0 var(--size-4-3);
    text-align: center;
    font-style: italic;
    font-size: var(--font-ui-medium);
    color: var(--text-muted);
    pointer-events: none;
  }

  .conversation-empty-state .typing-in {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    overflow: visible;
    white-space: normal;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  @container vaultkeeper-chat (max-width: 620px) {
    .conversation-empty-state {
      padding-inline: var(--size-4-4);
    }

    .conversation-empty-state .typing-in {
      animation: fadeIn 0.5s ease-out forwards;
      white-space: normal;
    }
  }

  .streaming-content {
    justify-content: left;
    min-height: 1em; /* Ensure the element exists for binding */
  }

  /* Streaming message styles */
  .content-fade-in {
    animation: reveal-fade 0.5s ease-in-out forwards;
  }

  @keyframes reveal-fade {
    0% {
      opacity: 0;
      transform: translateY(10px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Message attachments styles */
  .message-attachment-break {
    color: var(--background-secondary-alt);
    margin: 0 0 var(--size-4-2) 0;
    opacity: 0.5;
  }

  .message-attachments-container {
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-behavior: smooth;
		gap: var(--size-4-2);
    margin-bottom: var(--size-4-2);
	}

  .message-attachments-container::-webkit-scrollbar {
		display: none;
	}

	.message-attachmanet {
		display: grid;
		grid-template-rows: var(--size-4-2) auto var(--size-4-2);
		grid-template-columns: var(--size-4-2) auto var(--size-4-2) auto var(--size-4-2);
    background-color: var(--background-secondary-alt);
		border: var(--border-width) solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		flex-shrink: 0;
	}

  .message-attachment-icon {
		grid-row: 2;
		grid-column: 2;
		display: flex;
		align-items: center;
		justify-content: center;
	}

  .message-attachment-info {
		grid-row: 2;
		grid-column: 4;
		min-width: 40px;
		overflow: hidden;
	}

  .message-attachment-name {
      display: inline-block;
      white-space: nowrap;
      width: 100%;
      padding: 0;
      font-size: var(--font-smaller);
  }

  .message-attachment-size {
      padding: 0;
      font-size: var(--font-smallest);
      color: var(--text-muted);
  }

  .response-media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--size-4-2);
    margin-top: var(--size-4-2);
  }

  .response-media-image,
  .response-media-card {
    appearance: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background: var(--background-secondary);
    color: var(--text-normal);
    padding: var(--size-4-2);
    text-align: left;
    overflow: hidden;
  }

  .response-media-image img {
    display: block;
    width: 100%;
    max-height: 360px;
    object-fit: contain;
    border-radius: var(--radius-s);
    background: var(--background-primary);
  }

  .response-media-image span,
  .response-media-meta {
    display: block;
    margin-top: var(--size-4-1);
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }

  .response-media-name {
    font-weight: var(--font-semibold);
    overflow-wrap: anywhere;
  }

  .response-media-open {
    margin-top: var(--size-4-2);
    color: var(--interactive-accent);
  }

  .response-media-error {
    border-color: var(--text-error);
  }
</style>
