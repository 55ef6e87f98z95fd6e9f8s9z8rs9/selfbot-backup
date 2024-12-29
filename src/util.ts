import type {
    CategoryData,
    ChannelPermissionsData,
    CreateOptions,
    LoadOptions,
    MessageData,
    TextChannelData,
    ThreadChannelData,
    VoiceChannelData
} from './types';
import {
    CategoryChannel,
    Collection,
    Guild,
    DefaultMessageNotificationLevel, 
    GuildChannelCreateOptions,
    Message,
    OverwriteData,
    Snowflake,
    TextChannel,
    VoiceChannel,
    NewsChannel,
    ThreadChannel,
    Webhook,
    PremiumTier,
    MessageAttachment,
    ChannelLogsQueryOptions,
    ThreadAutoArchiveDuration
} from 'discord.js-selfbot-v13';
import nodeFetch from 'node-fetch';

const MaxBitratePerTier: Record<PremiumTier, number> = {//" | "TIER_1" | "TIER_2" | "TIER_3"
    ["NONE"]:64000,
    ["TIER_1"]:  128000,
    [ "TIER_2"]:256000,
    ["TIER_3"]: 384000
};

/**
 * Gets the permissions for a channel
 */
export function fetchChannelPermissions(channel: TextChannel | VoiceChannel | CategoryChannel | NewsChannel) {
    const permissions: ChannelPermissionsData[] = [];
    channel.permissionOverwrites.cache
        .filter((p) => p.type === "role")
        .forEach((perm) => {
            // For each overwrites permission
            const role = channel.guild.roles.cache.get(perm.id);
            if (role) {
                permissions.push({
                    id: role.id,
                    roleName: role.name,
                    allow: perm.allow.bitfield.toString(),
                    deny: perm.deny.bitfield.toString()
                });
            }
        });
    return permissions;
}

/**
 * Fetches the voice channel data that is necessary for the backup
 */
export async function fetchVoiceChannelData(channel: VoiceChannel) {
    return new Promise<VoiceChannelData>(async (resolve) => {
        const channelData: VoiceChannelData = {
            type: "GUILD_STAGE_VOICE",
            name: channel.name,
            bitrate: channel.bitrate,
            userLimit: channel.userLimit,
            parent: channel.parent ? channel.parent.name : undefined,
            permissions: fetchChannelPermissions(channel)
        };
        /* Return channel data */
        resolve(channelData);
    });
}

/**
 * Fetches the text channel data that is necessary for the backup
 */
export async function fetchTextChannelData(channel: TextChannel | NewsChannel, options: CreateOptions) {
    return new Promise<TextChannelData>(async (resolve) => {
        const channelData: TextChannelData = {
            type: channel.type,
            name: channel.name,
            nsfw: channel.nsfw,
            rateLimitPerUser: channel.type === "GUILD_TEXT" ? channel.rateLimitPerUser : undefined,
            parent: channel.parent ? channel.parent.name : undefined,
            topic: channel.topic || undefined,
            permissions: fetchChannelPermissions(channel),
            isNews: channel.type === "GUILD_NEWS",
            threads: []
        };
        /* Fetch channel threads */
        if (channel.threads.cache.size > 0) {
            await Promise.all(channel.threads.cache.map(async (thread) => {
                const threadData: ThreadChannelData = {
                    type: thread.type,
                    name: thread.name,
                    archived: thread.archived ? thread.archived : false,
                    autoArchiveDuration: thread.autoArchiveDuration as ThreadAutoArchiveDuration,
                    locked: thread.locked || false,
                    rateLimitPerUser: thread.rateLimitPerUser as number,
                };
                try {
                    /* Return thread data */
                    channelData.threads.push(threadData);
                } catch {
                    channelData.threads.push(threadData);
                }
            }));
        }
        /* Fetch channel messages */
        try {
            /* Return channel data */
            resolve(channelData);
        } catch {
            resolve(channelData);
        }
    });
}

/**
 * Creates a category for the guild
 */
export async function loadCategory(categoryData: CategoryData, guild: Guild) {
    return new Promise<CategoryChannel>((resolve) => {
        guild.channels.create(categoryData.name,{
            type: "GUILD_CATEGORY"
        }).then(async (category) => {
            // When the category is created
            const finalPermissions: OverwriteData[] = [];
            categoryData.permissions.forEach((perm) => {
                const role = guild.roles.cache.find((r) => r.name === perm.roleName);
                if (role) {
                    finalPermissions.push({
                        id: role.id,
                        allow: BigInt(perm.allow),
                        deny: BigInt(perm.deny)
                    });
                }
            });
            await category.permissionOverwrites.set(finalPermissions);
            resolve(category); // Return the category
        });
    });
}

/**
 * Create a channel and returns it
 */
export async function loadChannel(
    channelData: TextChannelData | VoiceChannelData,
    guild: Guild,
    category?: CategoryChannel,
    options?: LoadOptions
) {
    return new Promise(async (resolve) => {
        const createOptions: GuildChannelCreateOptions = {
            parent: category
        };
        if (channelData.type === "GUILD_TEXT" || channelData.type === "GUILD_NEWS") {
            createOptions.topic = (channelData as TextChannelData).topic;
            createOptions.nsfw = (channelData as TextChannelData).nsfw;
            createOptions.rateLimitPerUser = (channelData as TextChannelData).rateLimitPerUser;
            createOptions.type =
                (channelData as TextChannelData).isNews && guild.features.includes("NEWS") ? "GUILD_NEWS" : "GUILD_TEXT";
        } else if (channelData.type === "GUILD_VOICE") {
            // Downgrade bitrate
            let bitrate = (channelData as VoiceChannelData).bitrate;
            while (bitrate > MaxBitratePerTier[guild.premiumTier]) {
                bitrate = MaxBitratePerTier[guild.premiumTier];
            }
            createOptions.bitrate = bitrate;
            createOptions.userLimit = (channelData as VoiceChannelData).userLimit;
            createOptions.type = "GUILD_VOICE";
        }
        guild.channels.create(channelData.name, createOptions).then(async (channel) => {
            /* Update channel permissions */
            const finalPermissions: OverwriteData[] = [];
            channelData.permissions.forEach((perm) => {
                const role = guild.roles.cache.find((r) => r.name === perm.roleName);
                if (role) {
                    finalPermissions.push({
                        id: role.id,
                        allow: BigInt(perm.allow),
                        deny: BigInt(perm.deny)
                    });
                }
            });
            await channel.permissionOverwrites.set(finalPermissions);
            if (channelData.type === "GUILD_TEXT") {    
                /* Load threads */
                if ((channelData as TextChannelData).threads.length > 0) { //&& guild.features.includes('THREADS_ENABLED')) {
                    await Promise.all((channelData as TextChannelData).threads.map(async (threadData) => {
                        let autoArchiveDuration = threadData.autoArchiveDuration;
                        //if (!guild.features.includes('SEVEN_DAY_THREAD_ARCHIVE') && autoArchiveDuration === 10080) autoArchiveDuration = 4320;
                        //if (!guild.features.includes('THREE_DAY_THREAD_ARCHIVE') && autoArchiveDuration === 4320) autoArchiveDuration = 1440;
                        return (channel as TextChannel).threads.create({
                            name: threadData.name,
                            autoArchiveDuration
                        })
                    }));
                }
                resolve(channel); 
            } else {
                resolve({});
            }
        });
    });
}

/**
 * Delete all roles, all channels, all emojis, etc... of a guild
 */
export async function clearGuild(guild: Guild) {
    guild.roles.cache
        .filter((role) => !role.managed && role.editable && role.id !== guild.id)
        .forEach((role) => {
            role.delete().catch(() => {});
        });
    guild.channels.cache.forEach((channel) => {
        channel.delete().catch(() => {});
    });
    guild.emojis.cache.forEach((emoji) => {
        emoji.delete().catch(() => {});
    });
    const webhooks = await guild.fetchWebhooks();
    webhooks.forEach((webhook) => {
        webhook.delete().catch(() => {});
    });
    const bans = await guild.bans.fetch();
    bans.forEach((ban) => {
        guild.members.unban(ban.user).catch(() => {});
    });
    guild.setAFKChannel(null);
    guild.setAFKTimeout(60 * 5);
    guild.setIcon(null);
    guild.setBanner(null).catch(() => {});
    guild.setSplash(null).catch(() => {});
    guild.setDefaultMessageNotifications("ONLY_MENTIONS");
    guild.setWidgetSettings({
        enabled: false,
        channel: null
    });
    if (!guild.features.includes("COMMUNITY")) {
        guild.setExplicitContentFilter("DISABLED");
        guild.setVerificationLevel("NONE");
    }
    guild.setSystemChannel(null);
    guild.setSystemChannelFlags(["SUPPRESS_GUILD_REMINDER_NOTIFICATIONS", "SUPPRESS_JOIN_NOTIFICATIONS", "SUPPRESS_PREMIUM_SUBSCRIPTIONS"]);
    return;
}
