with open('Enums/Copy.ts', 'r') as f:
    content = f.read()

# Add new copy entries after ThankYouMessage
new_entries = '''    // S3 Storage
    SettingS3Storage = "S3 Storage",
    SettingS3StorageDesc = "Configure S3-compatible storage for file attachments.",
    SettingS3Enabled = "Enable S3 storage",
    SettingS3Endpoint = "Endpoint",
    SettingS3EndpointDesc = "S3 endpoint URL, e.g. https://s3.amazonaws.com",
    SettingS3Bucket = "Bucket",
    SettingS3BucketDesc = "S3 bucket name",
    SettingS3Region = "Region",
    SettingS3RegionDesc = "S3 region, e.g. us-east-1",
    SettingS3AccessKey = "Access Key",
    SettingS3AccessKeyDesc = "AWS Access Key ID",
    SettingS3SecretKey = "Secret Key",
    SettingS3SecretKeyDesc = "AWS Secret Access Key",
    SettingS3PathPrefix = "Path Prefix",
    SettingS3PathPrefixDesc = "Optional path prefix for uploaded files",
    SettingS3PublicUrlBase = "Public URL Base",
    SettingS3PublicUrlBaseDesc = "Optional custom public URL base (for CDN)",
    SettingS3TestConnection = "Test Connection",
    SettingS3ConnectionSuccess = "Connection successful",
    SettingS3ConnectionFailed = "Connection failed",

    // Custom Skills
    SettingCustomSkills = "Custom Skills",
    SettingCustomSkillsDesc = "Define your own quick actions with custom prompts.",
    SettingAddSkill = "Add Skill",
    SettingSkillName = "Skill Name",
    SettingSkillIcon = "Icon",
    SettingSkillPrompt = "Prompt",
    SettingSkillPromptDesc = "Use {{selection}}, {{file_content}}, {{file_name}}, {{tags}}, {{title}} as placeholders.",
    SettingSkillModel = "Model",
    SettingSkillModelDesc = "Optional: leave empty to use the default quick action model.",
    SettingSkillOutputMode = "Output Mode",
    SettingSkillOutputModeReplaceSelection = "Replace selection",
    SettingSkillOutputModeReplaceBody = "Replace body",
    SettingSkillOutputModeInsertAtCursor = "Insert at cursor",
    SettingSkillOutputModeCopyToClipboard = "Copy to clipboard",
    SettingSkillEnabled = "Enabled",
    SettingSkillEdit = "Edit",
    SettingSkillDelete = "Delete",
    SettingSkillDeleteConfirm = "Are you sure you want to delete this skill?",
    SkillResultCopiedToClipboard = "Result copied to clipboard",
    SkillExecuting = "Executing...",

'''

content = content.replace(
    '    ThankYouMessage = "Thanks for using the Vaultkeeper AI plugin!",',
    '    ThankYouMessage = "Thanks for using the Vaultkeeper AI plugin!",\n' + new_entries
)

with open('Enums/Copy.ts', 'w') as f:
    f.write(content)

print("Copy.ts updated")
