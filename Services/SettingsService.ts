import type VaultkeeperAIPlugin from "main";
import { Resolve } from "./DependencyService";
import { Services } from "./Services";
import { ChatMode } from "Enums/ChatMode";
import {
    AIProvider,
    AIProviderModel,
    DEFAULT_MODEL_BY_PROVIDER,
    DEFAULT_PLANNING_MODEL_BY_PROVIDER,
    DEFAULT_QUICK_MODEL_BY_PROVIDER,
    fromModel,
    isvalidProvider,
    isValidProviderModel,
    modelMatchesProvider
} from "Enums/ApiProvider";

const DEFAULT_SETTINGS: IVaultkeeperAISettings = {
    firstTimeStart: true,

    chatMode: ChatMode.ReadOnly,
    userInstruction: "",

    provider: AIProvider.OpenAI,
    model: AIProviderModel.GPT_5_5,
    planningModel: AIProviderModel.GPT_5_5,
    quickActionModel: AIProviderModel.GPT_5_4_Nano,

    openClawResponsesUrl: "http://127.0.0.1:18789/v1/responses",
    openClawModel: "openclaw/default",
    openClawPlanningModel: "",
    openClawQuickActionModel: "",
    
    apiKeys: {
        claude: "",
        openai: "",
        gemini: "",
        mistral: ""
    },
    exclusions: [],

    searchResultsLimit: 30,
    snippetSizeLimit: 100,

    enableMemories: false,
    allowUpdatingMemories: true,

    enableWebSearch: false,
    enableWebViewer: false,

    enableContextMenuActions: true,
    enableToolbarActions: true,

    hideDrawerElements: true
}

export interface IVaultkeeperAISettings {
    firstTimeStart: boolean;

    chatMode: ChatMode;
    userInstruction: string;

    provider: AIProvider;
    model: AIProviderModel;
    planningModel: AIProviderModel;
    quickActionModel: AIProviderModel;

    /** Optional for compatibility with settings saved by upstream Vaultkeeper AI. */
    openClawResponsesUrl?: string;
    openClawModel?: string;
    openClawPlanningModel?: string;
    openClawQuickActionModel?: string;

    apiKeys: {
        claude: string;
        openai: string;
        gemini: string;
        mistral: string;
    };
    exclusions: string[];

    searchResultsLimit: number;
    snippetSizeLimit: number;

    enableMemories: boolean;
    allowUpdatingMemories: boolean;

    enableWebSearch: boolean;
    enableWebViewer: boolean;

    enableContextMenuActions: boolean;
    enableToolbarActions: boolean;

    hideDrawerElements: boolean;
}

type SettingKey = keyof IVaultkeeperAISettings;
type SettingsChangedCallback = ((changedKeys: SettingKey[]) => void) | ((changedKeys: SettingKey[]) => Promise<void>);

export class SettingsService {

    public readonly settings: Readonly<IVaultkeeperAISettings>;

    private readonly plugin: VaultkeeperAIPlugin;
    private readonly subscribers: WeakMap<object, SettingsChangedCallback> = new WeakMap();
    private readonly subscriberRefs: Set<WeakRef<object>> = new Set();

    private settingsSnapshot: string;

    public constructor(loadedSettings: Partial<IVaultkeeperAISettings>) {
        this.plugin = Resolve<VaultkeeperAIPlugin>(Services.VaultkeeperAIPlugin);
        const migratedSettings = { ...loadedSettings };
        // Older Vaultkeeper settings may contain a model without the redundant
        // provider field. Infer it so migration does not replace the chosen model.
        if (!migratedSettings.provider && migratedSettings.model && isValidProviderModel(migratedSettings.model)) {
            migratedSettings.provider = fromModel(migratedSettings.model);
        }
        this.settings = Object.assign({}, DEFAULT_SETTINGS, migratedSettings);
        this.settingsSnapshot = JSON.stringify(this.settings);
        this.ensureValidModels();
    }

    public subscribeToSettingsChanged(callback: SettingsChangedCallback): object {
        const token = {};
        this.subscribers.set(token, callback);
        this.subscriberRefs.add(new WeakRef(token));
        return token;
    }

    public unsubscribe(subscriber: object): void {
        this.subscribers.delete(subscriber);
    }

    public async updateSettings(updateAction: ((settings: IVaultkeeperAISettings) => void) | ((settings: IVaultkeeperAISettings) => Promise<void>)) {
        await updateAction(this.settings);
        await this.saveSettings();
    }

    public getApiKeyForCurrentModel(): string {
        const provider = fromModel(this.settings.model);
        return this.getApiKeyForProvider(provider);
    }

    public getApiKeyForProvider(provider: AIProvider): string {
        switch (provider) {
            case AIProvider.Claude:
                return this.settings.apiKeys.claude;
            case AIProvider.OpenAI:
                return this.settings.apiKeys.openai;
            case AIProvider.Gemini:
                return this.settings.apiKeys.gemini;
            case AIProvider.Mistral:
                return this.settings.apiKeys.mistral;
        }
    }

    public async setApiKeyForProvider(provider: AIProvider, key: string) {
        switch (provider) {
            case AIProvider.Claude:
                await this.updateSettings(settings => settings.apiKeys.claude = key);
                break;
            case AIProvider.OpenAI:
                await this.updateSettings(settings => settings.apiKeys.openai = key);                
                break;
            case AIProvider.Gemini:
                await this.updateSettings(settings => settings.apiKeys.gemini = key);                
                break;
            case AIProvider.Mistral:
                await this.updateSettings(settings => settings.apiKeys.mistral = key);
                break;
        }
    }

    private async saveSettings() {
        const oldSettings = JSON.parse(this.settingsSnapshot) as IVaultkeeperAISettings;
        await this.plugin.saveData(this.settings);
        const changedKeys = (Object.keys(this.settings) as SettingKey[])
            .filter(key => JSON.stringify(this.settings[key]) !== JSON.stringify(oldSettings[key]));
        if (changedKeys.length > 0) {
            this.settingsSnapshot = JSON.stringify(this.settings);
            for (const ref of this.subscriberRefs) {
                const subscriber = ref.deref();
                if (!subscriber) {
                    this.subscriberRefs.delete(ref);
                    continue;
                }
                await this.subscribers.get(subscriber)?.(changedKeys);
            }
        }
    }

    private ensureValidModels(): void {
        void this.updateSettings(settings => {
            let provider = settings.provider;

            if (!isvalidProvider(provider)) {
                provider = DEFAULT_SETTINGS.provider;
            }
    
            if (!isValidProviderModel(this.settings.model) || !modelMatchesProvider(this.settings.model, provider)) {
                settings.model = DEFAULT_MODEL_BY_PROVIDER[provider];
            }
    
            if (!isValidProviderModel(this.settings.planningModel) || !modelMatchesProvider(this.settings.planningModel, provider)) {
                settings.planningModel = DEFAULT_PLANNING_MODEL_BY_PROVIDER[provider];
            }
    
            if (!isValidProviderModel(this.settings.quickActionModel) || !modelMatchesProvider(this.settings.quickActionModel, provider)) {
                settings.quickActionModel = DEFAULT_QUICK_MODEL_BY_PROVIDER[provider];
            }
        });
    }

}
