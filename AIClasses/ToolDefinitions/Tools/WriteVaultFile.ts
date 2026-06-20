import { AITool } from "Enums/AITool";
import type { IAIToolDefinition } from "../IAIToolDefinition";

export const WriteVaultFile: IAIToolDefinition = {
    name: AITool.WriteVaultFile,
    description: `Writes content to a file, creating it if it doesn't exist or replacing its contents if it does.

Call this function:
- When creating new notes, documents, or files from scratch
- When completely rewriting a file's contents (when most/all content needs to change)
- When generating new files from templates or structured data

Do NOT use this function:
- When making small, targeted edits to existing files
- Before reading existing file content to avoid accidentally overwriting important data

Illustrated Markdown documents:
- To embed available user-uploaded or model-generated images, put placeholders in the Markdown content such as {{image:hero}}, {{image:diagram-1}}, or {{image:photo}}.
- Do NOT invent vault image paths. The plugin replaces image placeholders with real Obsidian embeds after saving media locally.
- If no matching key exists, placeholders are replaced with available images in order when possible.`,
    parameters: {
        type: "object",
        properties: {
            file_path: {
                type: "string",
                description: "The full path to the file within the vault. Example: 'folder/note.md'"
            },
            content: {
                type: "string",
                description: "The complete content to write to the file. This will replace any existing content."
            },
            user_message: {
                type: "string",
                description: "A short message to be displayed to the user explaining what you're writing and why. Example: 'Creating your daily note for today'"
            }
        },
        required: ["file_path", "content", "user_message"]
    }
}
