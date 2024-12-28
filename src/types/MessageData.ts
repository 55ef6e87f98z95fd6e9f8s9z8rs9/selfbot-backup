import { MessageEmbed } from 'discord.js-selfbot-v13';

export interface MessageData {
    username: string;
    avatar?: string;
    content?: string;
    embeds?: MessageEmbed[];
    files?: {
        name: string;
        attachment: string;
    }[];
    pinned?: boolean;
    sentAt: string;
}
