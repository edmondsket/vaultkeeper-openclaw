with open('Enums/Copy.zh.ts', 'r') as f:
    content = f.read()

# Add new Chinese translations
new_entries = '''
    // S3 存储
    SettingS3Storage: "S3 存储",
    SettingS3StorageDesc: "配置文件附件的 S3 兼容存储。",
    SettingS3Enabled: "启用 S3 存储",
    SettingS3Endpoint: "终端节点",
    SettingS3EndpointDesc: "S3 终端节点 URL，例如 https://s3.amazonaws.com",
    SettingS3Bucket: "存储桶",
    SettingS3BucketDesc: "S3 存储桶名称",
    SettingS3Region: "区域",
    SettingS3RegionDesc: "S3 区域，例如 us-east-1",
    SettingS3AccessKey: "访问密钥",
    SettingS3AccessKeyDesc: "AWS 访问密钥 ID",
    SettingS3SecretKey: "秘密密钥",
    SettingS3SecretKeyDesc: "AWS 秘密访问密钥",
    SettingS3PathPrefix: "路径前缀",
    SettingS3PathPrefixDesc: "上传文件的可选路径前缀",
    SettingS3PublicUrlBase: "公开 URL 基础",
    SettingS3PublicUrlBaseDesc: "可选的自定义公开 URL 基础（用于 CDN）",
    SettingS3TestConnection: "测试连接",
    SettingS3ConnectionSuccess: "连接成功",
    SettingS3ConnectionFailed: "连接失败",

    // 自定义技能
    SettingCustomSkills: "自定义技能",
    SettingCustomSkillsDesc: "使用自定义提示词定义你自己的快速操作。",
    SettingAddSkill: "添加技能",
    SettingSkillName: "技能名称",
    SettingSkillIcon: "图标",
    SettingSkillPrompt: "提示词",
    SettingSkillPromptDesc: "使用 {{selection}}、{{file_content}}、{{file_name}}、{{tags}}、{{title}} 作为占位符。",
    SettingSkillModel: "模型",
    SettingSkillModelDesc: "可选：留空以使用默认快速操作模型。",
    SettingSkillOutputMode: "输出模式",
    SettingSkillOutputModeReplaceSelection: "替换选中文本",
    SettingSkillOutputModeReplaceBody: "替换正文",
    SettingSkillOutputModeInsertAtCursor: "在光标处插入",
    SettingSkillOutputModeCopyToClipboard: "复制到剪贴板",
    SettingSkillEnabled: "已启用",
    SettingSkillEdit: "编辑",
    SettingSkillDelete: "删除",
    SettingSkillDeleteConfirm: "确定要删除此技能吗？",
    SkillResultCopiedToClipboard: "结果已复制到剪贴板",
    SkillExecuting: "执行中...",
'''

# Find the last entry and add after it
# We need to find the last entry in ChineseCopy and add before the closing brace
last_brace = content.rfind('};')
if last_brace != -1:
    content = content[:last_brace] + new_entries + '\n' + content[last_brace:]

with open('Enums/Copy.zh.ts', 'w') as f:
    f.write(content)

print("Copy.zh.ts updated")
