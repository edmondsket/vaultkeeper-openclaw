with open('Services/ServiceRegistration.ts', 'r') as f:
    content = f.read()

# Add imports
import_additions = '''import { CustomSkillService } from "./CustomSkills/CustomSkillService";
import { S3FileService } from "./S3Storage/S3FileService";
'''

# Insert after the QuickActionsService import
content = content.replace(
    'import { QuickActionsService } from "./QuickActions/QuickActionsService";',
    'import { QuickActionsService } from "./QuickActions/QuickActionsService";\n' + import_additions
)

# Add registrations
registration_additions = '''    RegisterSingleton<CustomSkillService>(Services.CustomSkillService, new CustomSkillService());
    RegisterSingleton<S3FileService>(Services.S3FileService, new S3FileService());
'''

# Insert after QuickActionsService registration
content = content.replace(
    'RegisterSingleton<QuickActionsService>(Services.QuickActionsService, new QuickActionsService());',
    'RegisterSingleton<QuickActionsService>(Services.QuickActionsService, new QuickActionsService());\n' + registration_additions
)

with open('Services/ServiceRegistration.ts', 'w') as f:
    f.write(content)

print("ServiceRegistration.ts updated")
