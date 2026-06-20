import re

# Read the file
with open('Services/SettingsService.ts', 'r') as f:
    content = f.read()

# 1. Add new interfaces before IVaultkeeperAISettings
new_interfaces = '''
export interface IS3Config {
    enabled: boolean;
    endpoint: string;
    bucket: string;
    region: string;
    accessKey: string;
    secretKey: string;
    pathPrefix?: string;
    publicUrlBase?: string;
}

export interface ICustomSkill {
    id: string;
    name: string;
    icon: string;
    prompt: string;
    modelSelection?: IOpenClawModelSelection;
    outputMode: "replace_selection" | "replace_body" | "insert_at_cursor" | "copy_to_clipboard";
    enabled: boolean;
}

'''

# Insert before IVaultkeeperAISettings
content = content.replace(
    'export interface IVaultkeeperAISettings {',
    new_interfaces + 'export interface IVaultkeeperAISettings {'
)

# 2. Add new fields to IVaultkeeperAISettings
# Find the last field before the closing brace
settings_fields = '''
    s3Config?: IS3Config;
    customSkills?: ICustomSkill[];
'''

# Insert before hideDrawerElements: boolean;
content = content.replace(
    'hideDrawerElements: boolean;',
    settings_fields + '    hideDrawerElements: boolean;'
)

# 3. Add defaults to DEFAULT_SETTINGS
defaults = '''
    s3Config: undefined,
    customSkills: [],
'''

content = content.replace(
    'hideDrawerElements: true',
    defaults + '    hideDrawerElements: true'
)

with open('Services/SettingsService.ts', 'w') as f:
    f.write(content)

print("SettingsService.ts updated")
