<script lang="ts">
  import { onDestroy } from "svelte";
  import { Copy } from "Enums/Copy";
  import { Resolve } from "Services/DependencyService";
  import { Services } from "Services/Services";
  import type { ICustomSkill, SettingsService } from "Services/SettingsService";
  import type { CustomSkillService } from "Services/CustomSkills/CustomSkillService";

  export let disabled = false;
  export let selectedSkillId = "";

  const settingsService: SettingsService = Resolve<SettingsService>(Services.SettingsService);
  const customSkillService: CustomSkillService = Resolve<CustomSkillService>(Services.CustomSkillService);

  let skills: ICustomSkill[] = [];

  function refresh() {
    skills = customSkillService.getChatSkills();
    if (selectedSkillId && !skills.some(skill => skill.id === selectedSkillId)) {
      selectedSkillId = "";
    }
  }

  const settingsSubscription: object = settingsService.subscribeToSettingsChanged(changed => {
    if (changed.includes("customSkills") || changed.includes("builtInSkillSettings") || changed.includes("displayLanguage")) {
      refresh();
    }
  });

  onDestroy(() => settingsService.unsubscribe(settingsSubscription));

  refresh();
</script>

<div class="chat-skill-selector">
  <span>{Copy.SettingChatSkill}</span>
  <select
    bind:value={selectedSkillId}
    disabled={disabled || skills.length === 0}
    aria-label={Copy.SettingChatSkill}
    title={Copy.SettingChatSkillDesc}
  >
    <option value="">{Copy.SettingChatSkillNone}</option>
    {#each skills as skill}
      <option value={skill.id}>{skill.name}</option>
    {/each}
  </select>
</div>

<style>
  .chat-skill-selector {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    min-width: 0;
    padding: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smallest);
    justify-content: flex-end;
  }

  .chat-skill-selector span {
    flex: 0 0 auto;
  }

  .chat-skill-selector select {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    max-width: min(18rem, 100%);
    height: 1.65rem;
    margin-left: auto;
    font-size: var(--font-ui-smallest);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @container vaultkeeper-chat (max-width: 420px) {
    .chat-skill-selector {
      align-items: center;
      flex-direction: row;
      gap: var(--size-2-1);
    }

    .chat-skill-selector select {
      max-width: 100%;
      margin-left: 0;
    }
  }
</style>
