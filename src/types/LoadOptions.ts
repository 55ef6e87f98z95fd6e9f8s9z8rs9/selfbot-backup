import { MessageMentionOptions } from "discord.js-selfbot-v13";

export interface LoadOptions {
    clearGuildBeforeRestore: boolean;
    allowedMentions?: MessageMentionOptions;
}
