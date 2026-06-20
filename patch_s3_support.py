import re

with open('AIClasses/OpenAI/OpenAI.ts', 'r') as f:
    content = f.read()

# Add S3FileService import
import_section = content.find('import { StringTools }')
if import_section != -1:
    content = content[:import_section] + 'import { S3FileService } from "Services/S3Storage/S3FileService";\n' + content[import_section:]

# Add S3FileService as a class property
# Find the class declaration
class_match = re.search(r'export class OpenAI extends BaseAIClass \{', content)
if class_match:
    insert_pos = class_match.end()
    content = content[:insert_pos] + '\n    private readonly s3FileService: S3FileService;' + content[insert_pos:]

# Add S3FileService initialization in constructor
# Find where other services are initialized
constructor_match = re.search(r'super\(AIProvider\.OpenAI\);', content)
if constructor_match:
    insert_pos = constructor_match.end()
    content = content[:insert_pos] + '\n        this.s3FileService = new S3FileService();' + content[insert_pos:]

with open('AIClasses/OpenAI/OpenAI.ts', 'w') as f:
    f.write(content)

print("OpenAI.ts updated with S3 support")
