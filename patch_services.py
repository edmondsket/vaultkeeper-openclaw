with open('Services/Services.ts', 'r') as f:
    content = f.read()

# Add new services
content = content.replace(
    'static QuickActionsDefinitionsService = Symbol("QuickActionsDefinitionsService");',
    'static QuickActionsDefinitionsService = Symbol("QuickActionsDefinitionsService");\n    static CustomSkillService = Symbol("CustomSkillService");\n    static S3FileService = Symbol("S3FileService");'
)

with open('Services/Services.ts', 'w') as f:
    f.write(content)

print("Services.ts updated")
