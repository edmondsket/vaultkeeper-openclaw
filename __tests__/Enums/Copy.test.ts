import { afterEach, describe, expect, it } from "vitest";
import { Copy, setCopyLanguage } from "../../Enums/Copy";

describe("localized display copy", () => {
    afterEach(() => setCopyLanguage("en"));

    it("switches user-facing strings between English and Chinese", () => {
        setCopyLanguage("en");
        expect(Copy.SettingLanguage).toBe("Language");
        expect(Copy.ButtonSendMessage).toBe("Send Message");

        setCopyLanguage("zh-CN");
        expect(Copy.SettingLanguage).toBe("语言");
        expect(Copy.ButtonSendMessage).toBe("发送消息");
    });

    it("keeps model-facing protocol copy in English", () => {
        setCopyLanguage("zh-CN");
        expect(Copy.DirectiveChatModeReadOnly).toContain("READ-ONLY");
    });
});
