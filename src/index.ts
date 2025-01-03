import type { BackupData, BackupInfos, CreateOptions, LoadOptions } from './types/';
import type { Guild } from 'discord.js-selfbot-v13';
import { sep } from 'path';

import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { writeFile, readdir } from 'fs/promises';
import nodeFetch from "node-fetch"
import * as createMaster from './create';
import * as loadMaster from './load';
import * as utilMaster from './util';

let backups = `${__dirname}/backups`;
if (!existsSync(backups)) {
    mkdirSync(backups);
}

/**
 * Checks if a backup exists and returns its data
 */
const getBackupData = async (clientID: string, backupID: string) => {
    return new Promise<BackupData>(async (resolve, reject) => {
        const files = await readdir(backups); // Read "backups" directory
        // Try to get the json file
        const file = files.filter((f: string) => f.split('.').pop() === 'json').find((f: string) => backupID.includes(clientID) && f === `${backupID}.json`);
        if (file) {
            // If the file exists
            const backupData: BackupData = require(`${backups}${sep}${file}`);
            // Returns backup informations
            resolve(backupData);
        } else {
            // If no backup was found, return an error message
            reject('No backup found');
        }
    });
};

/**
 * Fetches a backyp and returns the information about it
 */
export const fetch = (clientID: string, backupID: string) => {
    return new Promise<BackupInfos>(async (resolve, reject) => {
        getBackupData(clientID, backupID)
            .then((backupData) => {
                const size = statSync(`${backups}${sep}${backupID}.json`).size; // Gets the size of the file using fs
                const backupInfos: BackupInfos = {
                    data: backupData,
                    id: backupID,
                    size: Number((size / 1024).toFixed(2))
                };
                // Returns backup informations
                resolve(backupInfos);
            })
            .catch(() => {
                reject('No backup found');
            });
    });
};

/**
 * Creates a new backup and saves it to the storage
 */
export const create = async (
    guild: Guild,
    options: CreateOptions = {
        backupID: undefined,
        jsonSave: true,
        jsonBeautify: true,
        doNotBackup: [],
        backupMembers: false,
        saveImages: '',
        clientID: ''
    }
) => {
    return new Promise<BackupData>(async (resolve, reject) => {
        try {
            const backupData: BackupData = {
                name: guild.name,
                verificationLevel: guild.verificationLevel,
                explicitContentFilter: guild.explicitContentFilter,
                defaultMessageNotifications: guild.defaultMessageNotifications,
                afk: guild.afkChannel ? { name: guild.afkChannel.name, timeout: guild.afkTimeout } : undefined,
                widget: {
                    enabled: guild.widgetEnabled as boolean,
                    channel: guild.widgetChannel ? guild.widgetChannel.name : undefined
                },
                channels: { categories: [], others: [] },
                roles: [],
                bans: [],
                emojis: [],
                members: [],
                createdTimestamp: Date.now(),
                guildID: guild.id,
                id: options.backupID ?? `${(await list(options.clientID)).length + 1}${options.clientID}`,
            };
            if (guild.iconURL()) {
                if (options && options.saveImages && options.saveImages === 'base64') {
                    backupData.iconBase64 = (
                        await nodeFetch(guild.iconURL() as string).then((res: { arrayBuffer: () => any; }) => res.arrayBuffer())
                    ).toString();
                }
                backupData.iconURL = guild.iconURL() as string;
            }
            if (guild.splashURL()) {
                if (options && options.saveImages && options.saveImages === 'base64') {
                    backupData.splashBase64 = (await nodeFetch(guild.splashURL() as string).then((res: { arrayBuffer: () => any; }) => res.arrayBuffer())).toString(
                    );
                }
                backupData.splashURL = guild.splashURL() as string;
            }
            if (guild.bannerURL()) {
                if (options && options.saveImages && options.saveImages === 'base64') {
                    backupData.bannerBase64 = (await nodeFetch(guild.bannerURL() as string).then((res: { arrayBuffer: () => any; }) => res.arrayBuffer())).toString(
                    );
                }
                backupData.bannerURL = guild.bannerURL() as string;
            }
            if (options && options.backupMembers) {
                // Backup members
                backupData.members = await createMaster.getMembers(guild);
            }
            if (!options || !(options.doNotBackup || []).includes('bans')) {
                // Backup bans
                backupData.bans = await createMaster.getBans(guild);
            }
            if (!options || !(options.doNotBackup || []).includes('roles')) {
                // Backup roles
                backupData.roles = await createMaster.getRoles(guild);
            }
            if (!options || !(options.doNotBackup || []).includes('emojis')) {
                // Backup emojis
                backupData.emojis = await createMaster.getEmojis(guild, options);
            }
            if (!options || !(options.doNotBackup || []).includes('channels')) {
                // Backup channels
                backupData.channels = await createMaster.getChannels(guild, options);
            }
            if (!options || options.jsonSave === undefined || options.jsonSave) {
                // Convert Object to JSON
                const backupJSON = options.jsonBeautify
                    ? JSON.stringify(backupData, null, 4)
                    : JSON.stringify(backupData);
                // Save the backup
                await writeFile(`${backups}${sep}${backupData.id}.json`, backupJSON, 'utf-8');
            }
            // Returns ID
            resolve(backupData);
        } catch (e) {
            return reject(e);
        }
    });
};

/**
 * Loads a backup for a guild
 */
export const load = async (
    backup: string | BackupData,
    guild: Guild,
    options: LoadOptions = {
        clearGuildBeforeRestore: true,
    },
    clientID: string
) => {
    return new Promise<BackupData>(async (resolve, reject) => {
        if (!guild) {
            return reject('Invalid guild');
        }
        try {
            const backupData: BackupData = typeof backup === 'string' ? await getBackupData(clientID, backup) : backup;
            try {
                if (options.clearGuildBeforeRestore === undefined || options.clearGuildBeforeRestore) {
                    // Clear the guild
                    await utilMaster.clearGuild(guild);
                }
                await Promise.all([
                    // Restore guild configuration
                    loadMaster.loadConfig(guild, backupData),
                    // Restore guild roles
                    loadMaster.loadRoles(guild, backupData),
                    // Restore guild channels
                    loadMaster.loadChannels(guild, backupData, options),
                    // Restore afk channel and timeout
                    loadMaster.loadAFK(guild, backupData),
                    // Restore guild emojis
                    loadMaster.loadEmojis(guild, backupData),
                    // Restore guild bans
                    loadMaster.loadBans(guild, backupData),
                    // Restore embed channel
                    loadMaster.loadEmbedChannel(guild, backupData)
                ]);
            } catch (e) {
                return reject(e);
            }
            // Then return the backup data
            return resolve(backupData)
        } catch (e) {
            return reject('No backup found');
        }
    });
};

/**
 * Removes a backup
 */
export const remove = async (clientID: string, backupID: string) => {
    return new Promise<void>((resolve, reject) => {
        try {
            if(!backupID.includes(clientID)) return reject('Backup not found');
            require(`${backups}${sep}${backupID}.json`);
            unlinkSync(`${backups}${sep}${backupID}.json`);
            resolve();
        } catch (error) {
            reject('Backup not found');
        }
    });
};

/**
 * Returns the list of all backup
 */
export const list = async (clientID: string) => {
    const files = await readdir(backups); // Read "backups" directory
    return files
    .filter(e=> e.split('.')[0].includes(clientID))
    .map((f: string) => f.split('.')[0]);
};

/**
 * Change the storage path
 */
export const setStorageFolder = (path: string) => {
    if (path.endsWith(sep)) {
        path = path.substr(0, path.length - 1);
    }
    backups = path;
    if (!existsSync(backups)) {
        mkdirSync(backups);
    }
};

export default {
    create,
    fetch,
    list,
    load,
    remove
};
