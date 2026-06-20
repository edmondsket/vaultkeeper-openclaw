import { AIProvider, AIProviderModel, fromModel, isValidProviderModel } from "Enums/ApiProvider";
import { Copy, setCopyLanguage, type DisplayLanguage } from "Enums/Copy";
import { Selector } from "Enums/Selector";
import type VaultkeeperAIPlugin from "main";
import { HelpModal } from "Modals/HelpModal";
import { DropdownComponent, PluginSettingTab, Setting, ToggleComponent, setIcon, setTooltip, Notice } from "obsidian";
import { Resolve } from "Services/DependencyService";
import type { EventService } from "Services/EventService";
import type { IOpenClawModelSelection, IOpenClawProvider, SettingsService } from "Services/SettingsService";
import { Services } from "Services/Services";
import { S3FileService } from "Services/S3Storage/S3FileService";
import { CustomSkillsSetting } from "Components/Settings/CustomSkillsSetting";
import { PromptOverridesSetting } from "Components/Settings/PromptOverridesSetting";
import { closePluginSettings } from "Helpers/Helpers";
import type { MemoriesService } from "Services/MemoriesService";
import { RegisterAiProvider } from "Services/ServiceRegistration";

export class VaultkeeperAISettingTab extends PluginSettingTab {
	private readonly plugin: VaultkeeperAIPlugin;
	private readonly settingsService: SettingsService;
	private readonly memoriesService: MemoriesService;
	private readonly eventService: EventService;
	private readonly s3FileService: S3FileService;

	private apiKeySetting: Setting | null = null;
	private apiKeyInputEl: HTMLInputElement | null = null;
	private fileDisclaimerSetting: Setting | null = null;
	private mainModelDropdown: DropdownComponent | null = null;
	private planningModelDropdown: DropdownComponent | null = null;
	private quickActionModelDropdown: DropdownComponent | null = null;
	private allowUpdatingMemoriesSetting: Setting | null = null;
	private allowUpdatingMemoriesToggleComponent: ToggleComponent | null = null;

	constructor() {
		const plugin = Resolve<VaultkeeperAIPlugin>(Services.VaultkeeperAIPlugin);
		
		super(plugin.app, plugin);
		this.plugin = plugin;

		this.settingsService = Resolve<SettingsService>(Services.SettingsService);
		this.memoriesService = Resolve<MemoriesService>(Services.MemoriesService);
		this.eventService = Resolve<EventService>(Services.EventService);
		this.s3FileService = Resolve<S3FileService>(Services.S3FileService);
	}

	public display() {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName(Copy.SettingLanguage)
			.setDesc(Copy.SettingLanguageDesc)
			.addDropdown(dropdown => dropdown
				.addOption("en", Copy.LanguageEnglish)
				.addOption("zh-CN", Copy.LanguageChinese)
				.setValue(this.settingsService.settings.displayLanguage ?? "en")
				.onChange(async value => {
					const language = value as DisplayLanguage;
					await this.settingsService.updateSettings(settings => settings.displayLanguage = language);
					setCopyLanguage(language);
					this.display();
				}));

		new Setting(containerEl)
			.setHeading()
			.setName(Copy.SettingModelProviders)
			.setDesc(Copy.SettingModelProvidersDesc);

		for (const provider of this.settingsService.settings.openClawProviders ?? []) {
			this.renderOpenClawProvider(containerEl, provider);
		}

		new Setting(containerEl)
			.setName(Copy.SettingAddProvider)
			.setDesc(Copy.SettingAddProviderDesc)
			.addButton(button => button
				.setButtonText(Copy.SettingAddProvider)
				.setCta()
				.onClick(async () => {
					await this.settingsService.updateSettings(settings => {
						(settings.openClawProviders ??= []).push({
							id: this.newProviderId(),
							name: `Provider ${settings.openClawProviders.length + 1}`,
							baseUrl: "https://example.com/v1",
							apiKey: "",
							models: ["model-id"],
							streamingEnabled: false
						});
					});
					this.display();
				}));

		new Setting(containerEl)
			.setHeading()
			.setName(Copy.SettingModelAssignments)
			.setDesc(Copy.SettingModelAssignmentsDesc);

		this.renderOpenClawModelSelector(containerEl, Copy.SettingMainModel, Copy.SettingMainModelDesc, "main");
		this.renderOpenClawModelSelector(containerEl, Copy.SettingPlanningRoleModel, Copy.SettingPlanningRoleModelDesc, "planning");
		this.renderOpenClawModelSelector(containerEl, Copy.SettingQuickRoleModel, Copy.SettingQuickRoleModelDesc, "quickAction");


		/* S3 Storage */
		new Setting(containerEl)
			.setHeading()
			.setName(Copy.SettingS3Storage)
			.setDesc(Copy.SettingS3StorageDesc);

		const s3Config = this.settingsService.settings.s3Config;
		new Setting(containerEl)
			.setName(Copy.SettingS3Enabled)
			.addToggle(toggle => toggle
				.setValue(s3Config?.enabled ?? false)
				.onChange(async value => {
					await this.settingsService.updateSettings(settings => {
						settings.s3Config = { ...(settings.s3Config ?? {}), enabled: value } as any;
					});
					this.display();
				}));

		if (s3Config?.enabled) {
			new Setting(containerEl)
				.setName(Copy.SettingS3Endpoint)
				.setDesc(Copy.SettingS3EndpointDesc)
				.addText(text => text
					.setPlaceholder("https://s3.amazonaws.com")
					.setValue(s3Config?.endpoint ?? "")
					.onChange(async value => {
						await this.settingsService.updateSettings(settings => {
							settings.s3Config = { ...(settings.s3Config ?? {}), endpoint: value } as any;
						});
					}));

			new Setting(containerEl)
				.setName(Copy.SettingS3Bucket)
				.setDesc(Copy.SettingS3BucketDesc)
				.addText(text => text
					.setPlaceholder("my-bucket")
					.setValue(s3Config?.bucket ?? "")
					.onChange(async value => {
						await this.settingsService.updateSettings(settings => {
							settings.s3Config = { ...(settings.s3Config ?? {}), bucket: value } as any;
						});
					}));

			new Setting(containerEl)
				.setName(Copy.SettingS3Region)
				.setDesc(Copy.SettingS3RegionDesc)
				.addText(text => text
					.setPlaceholder("us-east-1")
					.setValue(s3Config?.region ?? "")
					.onChange(async value => {
						await this.settingsService.updateSettings(settings => {
							settings.s3Config = { ...(settings.s3Config ?? {}), region: value } as any;
						});
					}));

			new Setting(containerEl)
				.setName(Copy.SettingS3AccessKey)
				.setDesc(Copy.SettingS3AccessKeyDesc)
				.addText(text => {
					text.inputEl.type = "password";
					text.setPlaceholder("AKIA...")
						.setValue(s3Config?.accessKey ?? "")
						.onChange(async value => {
							await this.settingsService.updateSettings(settings => {
								settings.s3Config = { ...(settings.s3Config ?? {}), accessKey: value } as any;
							});
						});
				});

			new Setting(containerEl)
				.setName(Copy.SettingS3SecretKey)
				.setDesc(Copy.SettingS3SecretKeyDesc)
				.addText(text => {
					text.inputEl.type = "password";
					text.setPlaceholder("...")
						.setValue(s3Config?.secretKey ?? "")
						.onChange(async value => {
							await this.settingsService.updateSettings(settings => {
								settings.s3Config = { ...(settings.s3Config ?? {}), secretKey: value } as any;
							});
						});
				});

			new Setting(containerEl)
				.setName(Copy.SettingS3PathPrefix)
				.setDesc(Copy.SettingS3PathPrefixDesc)
				.addText(text => text
					.setPlaceholder("vaultkeeper-ai")
					.setValue(s3Config?.pathPrefix ?? "")
					.onChange(async value => {
						await this.settingsService.updateSettings(settings => {
							settings.s3Config = { ...(settings.s3Config ?? {}), pathPrefix: value } as any;
						});
					}));

			new Setting(containerEl)
				.setName(Copy.SettingS3PublicUrlBase)
				.setDesc(Copy.SettingS3PublicUrlBaseDesc)
				.addText(text => text
					.setPlaceholder("https://cdn.example.com")
					.setValue(s3Config?.publicUrlBase ?? "")
					.onChange(async value => {
						await this.settingsService.updateSettings(settings => {
							settings.s3Config = { ...(settings.s3Config ?? {}), publicUrlBase: value } as any;
						});
					}));

			new Setting(containerEl)
				.setName(Copy.SettingS3TestConnection)
				.addButton(button => button
					.setButtonText(Copy.SettingS3TestConnection)
					.onClick(async () => {
						const result = await this.s3FileService.testConnection();
						new Notice(result.message);
					}));
		}

		/* Exclusions Setting */
		new Setting(containerEl)
			.setName(Copy.SettingFileExclusions)
			.setDesc(Copy.SettingFileExclusionsDesc)
			.addTextArea(text => {
				text.setPlaceholder(Copy.PlaceholderFileExclusions)
					.setValue(this.settingsService.settings.exclusions.join("\n"))
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.exclusions = value.split("\n").map(line => line.trim()).filter(line => line.length > 0);
						});
					});
				text.inputEl.classList.add(Selector.AIExclusionsInput);
			});


		/* Custom Skills */
		new CustomSkillsSetting(containerEl).render();

		/* Prompt Overrides */
		new PromptOverridesSetting(containerEl, () => this.display()).render();

		/* Context Header */
		new Setting(containerEl)
			.setHeading()
			.setName(Copy.SettingContext);

		/* Search Results Limit Setting */
		new Setting(containerEl)
			.setName(Copy.SettingSearchResultsLimit)
			.setDesc(Copy.SettingSearchResultsLimitDesc)
			.addSlider(slider => {
				slider
					.setLimits(5, 40, 1)
					.setValue(this.settingsService.settings.searchResultsLimit)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.searchResultsLimit = value;
						});
					});
			});

		/* Snippet Size Limit Setting */
		new Setting(containerEl)
			.setName(Copy.SettingSnippetSizeLimit)
			.setDesc(Copy.SettingSnippetSizeLimitDesc)
			.addSlider(slider => {
				slider
					.setLimits(50, 1000, 10)
					.setValue(this.settingsService.settings.snippetSizeLimit)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.snippetSizeLimit = value;
						});
					});
			});

		/* Web Access Header */
		new Setting(containerEl)
			.setHeading()
			.setName(Copy.SettingWebViewerAccess);

		/* Enable Web Viewer Setting */
		new Setting(containerEl)
			.setName(Copy.SettingEnableWebViewer)
			.setDesc(Copy.SettingEnableWebViewerDesc)
			.addToggle(toggle => {
				toggle
					.setValue(this.settingsService.settings.enableWebViewer)
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.enableWebViewer = value;
						});
					});
			});

		/* Memories Header */
		new Setting(containerEl)
			.setHeading()
			.setName(Copy.SettingMemories);

		/* Enable Memories Setting */
		new Setting(containerEl)
			.setName(Copy.SettingEnableMemories)
			.setDesc(Copy.SettingEnableMemoriesDesc)
			.addToggle(toggle => {
				toggle
					.setValue(this.settingsService.settings.enableMemories)
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.enableMemories = value;
						});
						this.updateAllowUpdatingMemoriesSetting();
					});
			});

		/* Allow Updating Memories Setting */
		this.allowUpdatingMemoriesSetting = new Setting(containerEl)
			.setName(Copy.SettingAllowUpdatingMemories)
			.setDesc(Copy.SettingAllowUpdatingMemoriesDesc)
			.addToggle(toggle => {
				this.allowUpdatingMemoriesToggleComponent = toggle;
				toggle
					.setValue(this.settingsService.settings.allowUpdatingMemories)
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.allowUpdatingMemories = value;
						});
					})
			});
		this.updateAllowUpdatingMemoriesSetting();

		/* Access Memories banner */
		new Setting(containerEl)
		.setDesc(Copy.SettingAccessMemories)
		.addExtraButton(button => {
			button
				.setTooltip(Copy.TooltipAccessMemories)
				.onClick(async () => {
					await this.memoriesService.openMemories();
					closePluginSettings(this.plugin);
				});
			setIcon(button.extraSettingsEl, "clipboard-clock");
		});
		this.updateFileDisclaimer();

		/* Quick Actions Header */
		new Setting(containerEl)
			.setHeading()
			.setName(Copy.SettingQuickActions);

		/* Enable Context Menu Actions */
		new Setting(containerEl)
			.setName(Copy.SettingEnableContextMenuActions)
			.setDesc(Copy.SettingEnableContextMenuActionsDesc)
			.addToggle(toggle => {
				toggle
					.setValue(this.settingsService.settings.enableContextMenuActions)
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.enableContextMenuActions = value;
						});
					});
			});

		/* Enable Toolbar Actions */
		new Setting(containerEl)
			.setName(Copy.SettingEnableToolbarActions)
			.setDesc(Copy.SettingEnableToolbarActionsDesc)
			.addToggle(toggle => {
				toggle
					.setValue(this.settingsService.settings.enableToolbarActions)
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.enableToolbarActions = value;
						});
					});
			});

		/* Advanced Settings Header */
		new Setting(containerEl)
			.setHeading()
			.setName(Copy.SettingAdvancedSettings);

		/* Hide Drawer Elements */
		new Setting(containerEl)
			.setName(Copy.SettingHideDrawerElements)
			.setDesc(Copy.SettingHideDrawerElementsDesc)
			.addToggle(toggle => {
				toggle
					.setValue(this.settingsService.settings.hideDrawerElements)
					.onChange(async (value) => {
						await this.settingsService.updateSettings(settings => {
							settings.hideDrawerElements = value;
						});
					});
			});
	}

	private renderOpenClawProvider(containerEl: HTMLElement, provider: IOpenClawProvider): void {
		new Setting(containerEl)
			.setName(Copy.SettingProviderName)
			.setDesc(Copy.SettingProviderNameDesc)
			.addText(text => text
				.setPlaceholder(Copy.PlaceholderProviderName)
				.setValue(provider.name)
				.onChange(async value => {
					await this.updateOpenClawProvider(provider.id, item => item.name = value.trim());
					this.refreshOpenClawModelDropdowns();
				}))
			.addExtraButton(button => {
				button.setIcon("trash").setTooltip(Copy.TooltipDeleteProvider);
				button.extraSettingsEl.toggleAttribute("disabled", (this.settingsService.settings.openClawProviders?.length ?? 0) <= 1);
				button.onClick(async () => {
					if ((this.settingsService.settings.openClawProviders?.length ?? 0) <= 1) return;
					await this.settingsService.updateSettings(settings => {
						settings.openClawProviders = (settings.openClawProviders ?? []).filter(item => item.id !== provider.id);
					});
					this.display();
				});
			});

		new Setting(containerEl)
			.setName(Copy.SettingBaseUrl)
			.setDesc(Copy.SettingBaseUrlDesc)
			.addText(text => text
				.setPlaceholder("https://example.com/v1")
				.setValue(provider.baseUrl)
				.onChange(async value => {
					await this.updateOpenClawProvider(provider.id, item => item.baseUrl = value.trim());
					RegisterAiProvider();
				}));

		let tokenInput: HTMLInputElement;
		new Setting(containerEl)
			.setName(Copy.SettingProviderToken)
			.setDesc(Copy.SettingProviderTokenDesc)
			.addText(text => {
				text.setPlaceholder(Copy.PlaceholderProviderToken)
					.setValue(provider.apiKey)
					.onChange(async value => {
						await this.updateOpenClawProvider(provider.id, item => item.apiKey = value);
						RegisterAiProvider();
					});
				text.inputEl.type = "password";
				tokenInput = text.inputEl;
			})
			.addExtraButton(button => {
				button.setIcon("eye").setTooltip(Copy.TooltipShowToken).onClick(() => {
					tokenInput.type = tokenInput.type === "password" ? "text" : "password";
					setIcon(button.extraSettingsEl, tokenInput.type === "password" ? "eye" : "eye-off");
				});
			});

		new Setting(containerEl)
			.setName(Copy.SettingModelIds)
			.setDesc(Copy.SettingModelIdsDesc)
			.addTextArea(text => {
				text.setPlaceholder("model-a\nmodel-b")
					.setValue(provider.models.join("\n"))
					.onChange(async value => {
						const models = Array.from(new Set(value.split("\n").map(item => item.trim()).filter(Boolean)));
						await this.updateOpenClawProvider(provider.id, item => item.models = models);
						this.refreshOpenClawModelDropdowns();
					});
				text.inputEl.rows = 3;
			});

		new Setting(containerEl)
			.setName(Copy.SettingStreamingResponses)
			.setDesc(Copy.SettingStreamingResponsesDesc)
			.addToggle(toggle => toggle
				.setValue(provider.streamingEnabled === true)
				.onChange(async value => {
					await this.updateOpenClawProvider(provider.id, item => item.streamingEnabled = value);
					RegisterAiProvider();
				}));
	}

	private renderOpenClawModelSelector(
		containerEl: HTMLElement,
		name: string,
		description: string,
		kind: "main" | "planning" | "quickAction"
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(description)
			.addDropdown(dropdown => {
				if (kind === "main") this.mainModelDropdown = dropdown;
				if (kind === "planning") this.planningModelDropdown = dropdown;
				if (kind === "quickAction") this.quickActionModelDropdown = dropdown;
				this.populateOpenClawModelDropdown(dropdown);
				const selection = this.settingsService.getOpenClawSelection(kind);
				if (selection) dropdown.setValue(this.openClawSelectionKey(selection));
				dropdown.onChange(async value => {
					const selection = this.parseOpenClawSelectionKey(value);
					if (!selection) return;
					await this.settingsService.updateSettings(settings => {
						if (kind === "main") settings.openClawMainSelection = selection;
						if (kind === "planning") settings.openClawPlanningSelection = selection;
						if (kind === "quickAction") settings.openClawQuickActionSelection = selection;
					});
					RegisterAiProvider();
				});
			});
	}

	private populateOpenClawModelDropdown(dropdown: DropdownComponent): void {
		dropdown.selectEl.empty();
		let modelCount = 0;
		for (const provider of this.settingsService.settings.openClawProviders ?? []) {
			if (provider.models.length === 0) continue;
			const group = dropdown.selectEl.createEl("optgroup", { attr: { label: provider.name || Copy.UnnamedProvider } });
			for (const model of provider.models) {
				const selection = { providerId: provider.id, modelId: model };
				group.createEl("option", { value: this.openClawSelectionKey(selection), text: model });
				modelCount++;
			}
		}
		if (modelCount === 0) {
			dropdown.addOption("", Copy.NoModelsConfigured);
			dropdown.setDisabled(true);
		}
	}

	private refreshOpenClawModelDropdowns(): void {
		const dropdowns: Array<[DropdownComponent | null, "main" | "planning" | "quickAction"]> = [
			[this.mainModelDropdown, "main"],
			[this.planningModelDropdown, "planning"],
			[this.quickActionModelDropdown, "quickAction"]
		];
		for (const [dropdown, kind] of dropdowns) {
			if (!dropdown) continue;
			this.populateOpenClawModelDropdown(dropdown);
			const selection = this.settingsService.getOpenClawSelection(kind);
			if (selection) dropdown.setValue(this.openClawSelectionKey(selection));
		}
	}

	private async updateOpenClawProvider(id: string, update: (provider: IOpenClawProvider) => void): Promise<void> {
		await this.settingsService.updateSettings(settings => {
			const provider = (settings.openClawProviders ?? []).find(item => item.id === id);
			if (provider) update(provider);
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

	private newProviderId(): string {
		return globalThis.crypto?.randomUUID?.() ?? `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	private populateModelDropdown(dropdown: DropdownComponent, providerFilter?: AIProvider): void {
		const select = dropdown.selectEl;

		// Claude models
		if (!providerFilter || providerFilter === AIProvider.Claude) {
			const claudeGroup = select.createEl("optgroup", { attr: { label: Copy.ProviderClaude } });
			claudeGroup.createEl("option", { value: AIProviderModel.ClaudeSonnet_4_6, text: Copy.ClaudeSonnet_4_6 });
			claudeGroup.createEl("option", { value: AIProviderModel.ClaudeOpus_4_8, text: Copy.ClaudeOpus_4_8 });
			claudeGroup.createEl("option", { value: AIProviderModel.ClaudeHaiku_4_5, text: Copy.ClaudeHaiku_4_5 });
		}

		// OpenAI models
		if (!providerFilter || providerFilter === AIProvider.OpenAI) {
			const openaiGroup = select.createEl("optgroup", { attr: { label: Copy.ProviderOpenAI } });
			openaiGroup.createEl("option", { value: AIProviderModel.GPT_5_5, text: Copy.GPT_5_5 });
			openaiGroup.createEl("option", { value: AIProviderModel.GPT_5_4_Mini, text: Copy.GPT_5_4_Mini });
			openaiGroup.createEl("option", { value: AIProviderModel.GPT_5_4_Nano, text: Copy.GPT_5_4_Nano });
		}

		// Gemini models
		if (!providerFilter || providerFilter === AIProvider.Gemini) {
			const geminiGroup = select.createEl("optgroup", { attr: { label: Copy.ProviderGemini } });
			geminiGroup.createEl("option", { value: AIProviderModel.GeminiFlash_3_1_Lite, text: Copy.GeminiPro_3_1_Preview });
			geminiGroup.createEl("option", { value: AIProviderModel.GeminiFlash_3_Flash, text: Copy.GeminiPro_3_1_Preview });
			geminiGroup.createEl("option", { value: AIProviderModel.GeminiFlash_3_5_Flash, text: Copy.GeminiPro_3_1_Preview });
			geminiGroup.createEl("option", { value: AIProviderModel.GeminiPro_3_1_Preview, text: Copy.GeminiPro_3_1_Preview });
		}

		// Mistral models
		if (!providerFilter || providerFilter === AIProvider.Mistral) {
			const mistralGroup = select.createEl("optgroup", { attr: { label: Copy.ProviderMistral } });
			mistralGroup.createEl("option", { value: AIProviderModel.MistralMedium, text: Copy.MistralMedium });
			mistralGroup.createEl("option", { value: AIProviderModel.MistralSmall, text: Copy.MistralSmall });
		}
	}

	private async updateModelDropdowns(): Promise<void> {
		await this.settingsService.updateSettings(settings => {
			const currentProvider = fromModel(settings.model);

			if (this.planningModelDropdown) {
				const planningProvider = fromModel(settings.planningModel);
				this.planningModelDropdown.selectEl.empty();
				this.populateModelDropdown(this.planningModelDropdown, currentProvider);
	
				if (planningProvider !== currentProvider) {
					settings.planningModel = settings.model;
				}
	
				this.planningModelDropdown.setValue(settings.planningModel);
			}

			if (this.quickActionModelDropdown) {
				const quickActionProvider = fromModel(settings.quickActionModel);
				this.quickActionModelDropdown.selectEl.empty();
				this.populateModelDropdown(this.quickActionModelDropdown);
	
				if (quickActionProvider !== currentProvider) {
					settings.quickActionModel = settings.model;
				}
	
				this.quickActionModelDropdown.setValue(settings.quickActionModel);
			}
		});
	}

	private highlightApiKey() {
		if (this.apiKeySetting) {
			const currentApiKey = this.settingsService.getApiKeyForCurrentModel();
			if (currentApiKey.trim() === "") {
				this.apiKeySetting.settingEl.removeClass(Selector.ApiKeySettingOk);
				this.apiKeySetting.settingEl.addClass(Selector.ApiKeySettingError);
			} else {
				this.apiKeySetting.settingEl.removeClass(Selector.ApiKeySettingError);
				this.apiKeySetting.settingEl.addClass(Selector.ApiKeySettingOk);
			}
		}
	}

	private updateAllowUpdatingMemoriesSetting() {
		if (this.allowUpdatingMemoriesToggleComponent && this.allowUpdatingMemoriesSetting) {
			const enabled = this.settingsService.settings.enableMemories;
			const updateEnabled = this.settingsService.settings.allowUpdatingMemories;
			this.allowUpdatingMemoriesToggleComponent.disabled = !enabled;
			this.allowUpdatingMemoriesSetting.settingEl.toggleClass("setting-item-memories-disabled-accent", !enabled && updateEnabled);
			this.allowUpdatingMemoriesSetting.settingEl.toggleClass("setting-item-memories-disabled", !enabled && !updateEnabled);
		}
	}

	private updateFileDisclaimer() {
		if (this.fileDisclaimerSetting) {
			const provider = fromModel(this.settingsService.settings.model);
			let disclaimerText;

			switch(provider) {
				case AIProvider.Gemini:
					disclaimerText = Copy.SettingFileMonitoringGemini;
					break;
				case AIProvider.Claude:
					disclaimerText = Copy.SettingFileMonitoringClaude;
					break;
				case AIProvider.OpenAI:
					disclaimerText = Copy.SettingFileMonitoringOpenAI;
					break;
				case AIProvider.Mistral:
					disclaimerText = Copy.SettingFileMonitoringMistral;
					break;
			}

			this.fileDisclaimerSetting.setDesc(disclaimerText);
		}
	}
}
