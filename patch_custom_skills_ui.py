with open('Views/VaultkeeperAISettingTab.ts', 'r') as f:
    content = f.read()

# Add import for CustomSkillsSetting
import_section = 'import { S3FileService } from "Services/S3Storage/S3FileService";'
content = content.replace(
    import_section,
    import_section + '\nimport { CustomSkillsSetting } from "Components/Settings/CustomSkillsSetting";'
)

# Find a good place to add custom skills settings - after the S3 settings
# Look for the Context header
skills_settings = '''
\t\t/* Custom Skills */
\t\tnew CustomSkillsSetting(containerEl).render();

'''

# Insert before the Context header
content = content.replace(
    '\t\t/* Context Header */',
    skills_settings + '\t\t/* Context Header */'
)

with open('Views/VaultkeeperAISettingTab.ts', 'w') as f:
    f.write(content)

print("VaultkeeperAISettingTab.ts updated with Custom Skills settings")
