import re

with open('Views/VaultkeeperAISettingTab.ts', 'r') as f:
    content = f.read()

# Add import for S3FileService
import_section = 'import { Services } from "Services/Services";'
content = content.replace(
    import_section,
    'import { Services } from "Services/Services";\nimport { S3FileService } from "Services/S3Storage/S3FileService";'
)

# Add S3FileService as class property
class_prop = 'private readonly eventService: EventService;'
content = content.replace(
    class_prop,
    class_prop + '\n\tprivate readonly s3FileService: S3FileService;'
)

# Add S3FileService initialization in constructor
constructor_init = 'this.eventService = Resolve<EventService>(Services.EventService);'
content = content.replace(
    constructor_init,
    constructor_init + '\n\t\tthis.s3FileService = Resolve<S3FileService>(Services.S3FileService);'
)

# Find where to insert S3 settings - after the model assignments section
# Look for the exclusions setting
s3_settings = '''
\t\t/* S3 Storage */
\t\tnew Setting(containerEl)
\t\t\t.setHeading()
\t\t\t.setName(Copy.SettingS3Storage)
\t\t\t.setDesc(Copy.SettingS3StorageDesc);

\t\tconst s3Config = this.settingsService.settings.s3Config;
\t\tnew Setting(containerEl)
\t\t\t.setName(Copy.SettingS3Enabled)
\t\t\t.addToggle(toggle => toggle
\t\t\t\t.setValue(s3Config?.enabled ?? false)
\t\t\t\t.onChange(async value => {
\t\t\t\t\tawait this.settingsService.updateSettings(settings => {
\t\t\t\t\t\tsettings.s3Config = { ...(settings.s3Config ?? {}), enabled: value } as any;
\t\t\t\t\t});
\t\t\t\t\tthis.display();
\t\t\t\t}));

\t\tif (s3Config?.enabled) {
\t\t\tnew Setting(containerEl)
\t\t\t\t.setName(Copy.SettingS3Endpoint)
\t\t\t\t.setDesc(Copy.SettingS3EndpointDesc)
\t\t\t\t.addText(text => text
\t\t\t\t\t.setPlaceholder("https://s3.amazonaws.com")
\t\t\t\t\t.setValue(s3Config?.endpoint ?? "")
\t\t\t\t\t.onChange(async value => {
\t\t\t\t\t\tawait this.settingsService.updateSettings(settings => {
\t\t\t\t\t\t\tsettings.s3Config = { ...(settings.s3Config ?? {}), endpoint: value } as any;
\t\t\t\t\t\t});
\t\t\t\t\t}));

\t\t\tnew Setting(containerEl)
\t\t\t\t.setName(Copy.SettingS3Bucket)
\t\t\t\t.setDesc(Copy.SettingS3BucketDesc)
\t\t\t\t.addText(text => text
\t\t\t\t\t.setPlaceholder("my-bucket")
\t\t\t\t\t.setValue(s3Config?.bucket ?? "")
\t\t\t\t\t.onChange(async value => {
\t\t\t\t\t\tawait this.settingsService.updateSettings(settings => {
\t\t\t\t\t\t\tsettings.s3Config = { ...(settings.s3Config ?? {}), bucket: value } as any;
\t\t\t\t\t\t});
\t\t\t\t\t}));

\t\t\tnew Setting(containerEl)
\t\t\t\t.setName(Copy.SettingS3Region)
\t\t\t\t.setDesc(Copy.SettingS3RegionDesc)
\t\t\t\t.addText(text => text
\t\t\t\t\t.setPlaceholder("us-east-1")
\t\t\t\t\t.setValue(s3Config?.region ?? "")
\t\t\t\t\t.onChange(async value => {
\t\t\t\t\t\tawait this.settingsService.updateSettings(settings => {
\t\t\t\t\t\t\tsettings.s3Config = { ...(settings.s3Config ?? {}), region: value } as any;
\t\t\t\t\t\t});
\t\t\t\t\t}));

\t\t\tnew Setting(containerEl)
\t\t\t\t.setName(Copy.SettingS3AccessKey)
\t\t\t\t.setDesc(Copy.SettingS3AccessKeyDesc)
\t\t\t\t.addText(text => {
\t\t\t\t\ttext.inputEl.type = "password";
\t\t\t\t\ttext.setPlaceholder("AKIA...")
\t\t\t\t\t\t.setValue(s3Config?.accessKey ?? "")
\t\t\t\t\t\t.onChange(async value => {
\t\t\t\t\t\t\tawait this.settingsService.updateSettings(settings => {
\t\t\t\t\t\t\t\tsettings.s3Config = { ...(settings.s3Config ?? {}), accessKey: value } as any;
\t\t\t\t\t\t\t});
\t\t\t\t\t\t});
\t\t\t\t});

\t\t\tnew Setting(containerEl)
\t\t\t\t.setName(Copy.SettingS3SecretKey)
\t\t\t\t.setDesc(Copy.SettingS3SecretKeyDesc)
\t\t\t\t.addText(text => {
\t\t\t\t\ttext.inputEl.type = "password";
\t\t\t\t\ttext.setPlaceholder("...")
\t\t\t\t\t\t.setValue(s3Config?.secretKey ?? "")
\t\t\t\t\t\t.onChange(async value => {
\t\t\t\t\t\t\tawait this.settingsService.updateSettings(settings => {
\t\t\t\t\t\t\t\tsettings.s3Config = { ...(settings.s3Config ?? {}), secretKey: value } as any;
\t\t\t\t\t\t\t});
\t\t\t\t\t\t});
\t\t\t\t});

\t\t\tnew Setting(containerEl)
\t\t\t\t.setName(Copy.SettingS3PathPrefix)
\t\t\t\t.setDesc(Copy.SettingS3PathPrefixDesc)
\t\t\t\t.addText(text => text
\t\t\t\t\t.setPlaceholder("vaultkeeper-ai")
\t\t\t\t\t.setValue(s3Config?.pathPrefix ?? "")
\t\t\t\t\t.onChange(async value => {
\t\t\t\t\t\tawait this.settingsService.updateSettings(settings => {
\t\t\t\t\t\t\tsettings.s3Config = { ...(settings.s3Config ?? {}), pathPrefix: value } as any;
\t\t\t\t\t\t});
\t\t\t\t\t}));

\t\t\tnew Setting(containerEl)
\t\t\t\t.setName(Copy.SettingS3PublicUrlBase)
\t\t\t\t.setDesc(Copy.SettingS3PublicUrlBaseDesc)
\t\t\t\t.addText(text => text
\t\t\t\t\t.setPlaceholder("https://cdn.example.com")
\t\t\t\t\t.setValue(s3Config?.publicUrlBase ?? "")
\t\t\t\t\t.onChange(async value => {
\t\t\t\t\t\tawait this.settingsService.updateSettings(settings => {
\t\t\t\t\t\t\tsettings.s3Config = { ...(settings.s3Config ?? {}), publicUrlBase: value } as any;
\t\t\t\t\t\t});
\t\t\t\t\t}));

\t\t\tnew Setting(containerEl)
\t\t\t\t.setName(Copy.SettingS3TestConnection)
\t\t\t\t.addButton(button => button
\t\t\t\t\t.setButtonText(Copy.SettingS3TestConnection)
\t\t\t\t\t.onClick(async () => {
\t\t\t\t\t\tconst result = await this.s3FileService.testConnection();
\t\t\t\t\t\tnew Notice(result.message);
\t\t\t\t\t}));
\t\t}

'''

# Insert before the exclusions setting
content = content.replace(
    '\t\t/* Exclusions Setting */',
    s3_settings + '\t\t/* Exclusions Setting */'
)

with open('Views/VaultkeeperAISettingTab.ts', 'w') as f:
    f.write(content)

print("VaultkeeperAISettingTab.ts updated with S3 settings")
