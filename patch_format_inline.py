import re

with open('AIClasses/OpenAI/OpenAI.ts', 'r') as f:
    content = f.read()

# Find the formatInlineAttachments method and replace it
old_method = r'''    private async formatInlineAttachments\(attachments: Attachment\[\]\): Promise<ResponsesAPIInput> \{
        const blocks: ResponsesAPIContentBlock\[\] = \[\];

        for \(const attachment of attachments\) \{
            const mimeType = toMimeType\(attachment\.getMimeType\(\)\);
            blocks\.push\(\{ type: "input_text", text: replaceCopy\(Copy\.AttachedFile, \[attachment\.fileName\]\) \}\);

            if \(MimeTypeToFileTypes\[mimeType\]\.some\(fileType => isTextFile\(fileType\)\)\) \{
                const text = new TextDecoder\(\)\.decode\(StringTools\.toBytes\(attachment\.base64\)\);
                blocks\.push\(\{ type: "input_text", text \}\);
            \} else if \(mimeType === MimeType\.IMAGE_JPEG \|\| mimeType === MimeType\.IMAGE_PNG \|\| mimeType === MimeType\.IMAGE_WEBP\) \{
                const imageBase64 = await attachment\.getBase64\(\);
                blocks\.push\(\{
                    type: "input_image",
                    image_url: `data:\$\{mimeType\};base64,\$\{imageBase64\}`,
                    detail: "auto"
                \}\);
            \} else if \(mimeType === MimeType\.APPLICATION_PDF\) \{
                blocks\.push\(\{
                    type: "input_file",
                    filename: attachment\.fileName,
                    file_data: `data:\$\{mimeType\};base64,\$\{attachment\.base64\}`
                \}\);
            \} else \{
                blocks\.push\(\{ type: "input_text", text: `Unsupported mime type '\$\{mimeType\}': \$\{attachment\.fileName\}` \}\);
            \}
        \}

        return \{ type: "message", role: "user", content: blocks \};
    \}'''

new_method = '''    private async formatInlineAttachments(attachments: Attachment[]): Promise<ResponsesAPIInput> {
        const blocks: ResponsesAPIContentBlock[] = [];

        for (const attachment of attachments) {
            const mimeType = toMimeType(attachment.getMimeType());
            blocks.push({ type: "input_text", text: replaceCopy(Copy.AttachedFile, [attachment.fileName]) });

            if (MimeTypeToFileTypes[mimeType].some(fileType => isTextFile(fileType))) {
                const text = new TextDecoder().decode(StringTools.toBytes(attachment.base64));
                blocks.push({ type: "input_text", text });
            } else if (mimeType === MimeType.IMAGE_JPEG || mimeType === MimeType.IMAGE_PNG || mimeType === MimeType.IMAGE_WEBP) {
                // Try S3 upload first if enabled
                if (this.s3FileService.isEnabled()) {
                    try {
                        const imageUrl = await this.s3FileService.uploadFile(attachment.fileName, mimeType, attachment.base64);
                        blocks.push({
                            type: "input_image",
                            image_url: imageUrl,
                            detail: "auto"
                        });
                        continue;
                    } catch (error) {
                        // Fall back to base64 if S3 upload fails
                    }
                }
                const imageBase64 = await attachment.getBase64();
                blocks.push({
                    type: "input_image",
                    image_url: `data:${mimeType};base64,${imageBase64}`,
                    detail: "auto"
                });
            } else if (mimeType === MimeType.APPLICATION_PDF) {
                // Try S3 upload first if enabled
                if (this.s3FileService.isEnabled()) {
                    try {
                        const fileUrl = await this.s3FileService.uploadFile(attachment.fileName, mimeType, attachment.base64);
                        blocks.push({ type: "input_text", text: `File uploaded to: ${fileUrl}` });
                        continue;
                    } catch (error) {
                        // Fall back to base64 if S3 upload fails
                    }
                }
                blocks.push({
                    type: "input_file",
                    filename: attachment.fileName,
                    file_data: `data:${mimeType};base64,${attachment.base64}`
                });
            } else {
                // For other file types, try S3 upload
                if (this.s3FileService.isEnabled()) {
                    try {
                        const fileUrl = await this.s3FileService.uploadFile(attachment.fileName, mimeType, attachment.base64);
                        blocks.push({ type: "input_text", text: `File uploaded to: ${fileUrl}` });
                        continue;
                    } catch (error) {
                        // Fall back to error message
                    }
                }
                blocks.push({ type: "input_text", text: `Unsupported mime type '${mimeType}': ${attachment.fileName}` });
            }
        }

        return { type: "message", role: "user", content: blocks };
    }'''

content = re.sub(old_method, new_method, content)

with open('AIClasses/OpenAI/OpenAI.ts', 'w') as f:
    f.write(content)

print("formatInlineAttachments updated")
