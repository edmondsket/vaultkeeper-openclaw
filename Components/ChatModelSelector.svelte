<script lang="ts">
  import { onDestroy } from "svelte";
  import { Copy } from "Enums/Copy";
  import { Resolve } from "Services/DependencyService";
  import { RegisterAiProvider } from "Services/ServiceRegistration";
  import { Services } from "Services/Services";
  import type { IOpenClawModelSelection, IOpenClawProvider, SettingsService } from "Services/SettingsService";

  export let disabled = false;

  const settingsService = Resolve<SettingsService>(Services.SettingsService);

  let providers: IOpenClawProvider[] = [];
  let selectedValue = "";

  function selectionValue(selection: IOpenClawModelSelection): string {
    return JSON.stringify(selection);
  }

  function refresh() {
    providers = (settingsService.settings.openClawProviders ?? [])
      .filter(provider => provider.models.length > 0)
      .map(provider => ({ ...provider, models: [...provider.models] }));
    const selection = settingsService.getOpenClawSelection("main");
    selectedValue = selection ? selectionValue(selection) : "";
  }

  const settingsSubscription: object = settingsService.subscribeToSettingsChanged(changed => {
    if (changed.includes("openClawProviders") || changed.includes("openClawMainSelection")) {
      refresh();
    }
  });

  onDestroy(() => settingsService.unsubscribe(settingsSubscription));

  async function changeModel(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!value) return;

    const selection = JSON.parse(value) as IOpenClawModelSelection;
    await settingsService.updateSettings(settings => {
      settings.openClawMainSelection = selection;
    });
    selectedValue = value;
    RegisterAiProvider();
  }

  refresh();
</script>

<div class="chat-model-selector">
  <span>{Copy.SettingMainModel}</span>
  <select
    bind:value={selectedValue}
    on:change={changeModel}
    disabled={disabled || providers.length === 0}
    aria-label={Copy.SettingMainModel}
    title={Copy.SettingMainModelDesc}
  >
    {#if providers.length === 0}
      <option value="">{Copy.NoModelsConfigured}</option>
    {:else}
      {#each providers as provider}
        <optgroup label={provider.name || Copy.UnnamedProvider}>
          {#each provider.models as model}
            <option value={selectionValue({ providerId: provider.id, modelId: model })}>{provider.name || Copy.UnnamedProvider} · {model}</option>
          {/each}
        </optgroup>
      {/each}
    {/if}
  </select>
</div>

<style>
  .chat-model-selector {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    min-width: 0;
    padding: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smallest);
    justify-content: flex-start;
  }

  .chat-model-selector span {
    flex: 0 0 auto;
  }

  .chat-model-selector select {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    max-width: min(18rem, 100%);
    height: 1.65rem;
    margin-left: 0;
    font-size: var(--font-ui-smallest);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @container vaultkeeper-chat (max-width: 420px) {
    .chat-model-selector {
      align-items: center;
      flex-direction: row;
      gap: var(--size-2-1);
    }

    .chat-model-selector select {
      max-width: 100%;
      margin-left: 0;
    }
  }
</style>
