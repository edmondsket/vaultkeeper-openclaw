import { AIProvider, fromModel } from "Enums/ApiProvider";
import { Claude } from "AIClasses/Claude/Claude";
import { Gemini } from "AIClasses/Gemini/Gemini";
import { Mistral } from "AIClasses/Mistral/Mistral";
import { OpenAI } from "AIClasses/OpenAI/OpenAI";
import type { IAIClass } from "AIClasses/IAIClass";
import { Resolve } from "./DependencyService";
import type { SettingsService } from "./SettingsService";
import { Services } from "./Services";

export function createAIProviderForCurrentMainModel(): IAIClass {
    const settingsService = Resolve<SettingsService>(Services.SettingsService);
    const provider = fromModel(settingsService.settings.model);

    switch (provider) {
        case AIProvider.Claude:
            return new Claude();
        case AIProvider.Gemini:
            return new Gemini();
        case AIProvider.Mistral:
            return new Mistral();
        case AIProvider.OpenAI:
            return new OpenAI();
    }
}
