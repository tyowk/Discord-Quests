import { fetchJson } from '../utils/fetcher';
import { QuestEntry } from '../types/quest';

const QUESTS_ENDPOINT = 'https://api.discordquest.com/api/quests';
const REGIONS_ENDPOINT = 'https://api.discordquest.com/api/regions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required field: ${fieldName}`);
  }

  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is string | number =>
        (typeof entry === 'string' && entry.length > 0) ||
        (typeof entry === 'number' && Number.isFinite(entry)),
    )
    .map(String);
}

function readRegionCodeArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) => typeof entry === 'string' && entry.trim().length > 0,
    )
  ) {
    return undefined;
  }

  return value.map((entry: string) => entry.trim().toUpperCase());
}

function readNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is number =>
      typeof entry === 'number' && Number.isFinite(entry),
  );
}

function normalizeQuest(item: unknown): QuestEntry {
  if (!isRecord(item)) {
    throw new Error('Quest entry must be an object');
  }

  /*
   * Discord Quest API changed its structure.
   *
   * Old format:
   * {
   *   id: "...",
   *   config: {
   *     starts_at: "...",
   *     expires_at: "...",
   *     application: {...}
   *   }
   * }
   *
   * New format:
   * {
   *   id: "...",
   *   starts_at: "...",
   *   expires_at: "...",
   *   application: {...}
   * }
   *
   * Support both formats.
   */
  const config = isRecord(item.config) ? item.config : item;

  const application = isRecord(config.application)
    ? config.application
    : {};

  const assets = isRecord(config.assets)
    ? config.assets
    : {};

  const messages = isRecord(config.messages)
    ? config.messages
    : {};

  const taskConfigV2 = isRecord(config.task_config_v2)
    ? config.task_config_v2
    : undefined;

  const rewardsConfig = isRecord(config.rewards_config)
    ? config.rewards_config
    : undefined;

  const tasksRaw =
    taskConfigV2 && isRecord(taskConfigV2.tasks)
      ? taskConfigV2.tasks
      : {};

  const tasks: Record<
    string,
    {
      type: string;
      target: number;
      assets?: any;
    }
  > = {};

  for (const [key, value] of Object.entries(tasksRaw)) {
    if (!isRecord(value)) {
      continue;
    }

    const typeValue =
      readOptionalString(value.type) ?? key;

    const targetValue =
      typeof value.target === 'number'
        ? value.target
        : 0;

    const assetsValue =
      isRecord(value.assets)
        ? value.assets
        : undefined;

    tasks[key] = {
      type: typeValue,
      target: targetValue,
      assets: assetsValue,
    };
  }

  const rewardsRaw =
    rewardsConfig &&
    Array.isArray(rewardsConfig.rewards)
      ? rewardsConfig.rewards
      : [];

  const questId = readString(item.id, 'id');

  /*
   * New API does not have config.id.
   * Use the quest ID as the internal config ID.
   */
  const configId =
    readOptionalString(config.id) ?? questId;

  return {
    id: questId,

    config: {
      id: configId,

      starts_at: readString(
        config.starts_at,
        'starts_at',
      ),

      expires_at: readString(
        config.expires_at,
        'expires_at',
      ),

      features: readStringArray(
        config.features,
      ),

      application: {
        id: readString(
          application.id,
          'application.id',
        ),

        name: readString(
          application.name,
          'application.name',
        ),

        link: readOptionalString(
          application.link,
        ),
      },

      assets: {
        hero: readOptionalString(
          assets.hero,
        ),

        quest_bar_hero: readOptionalString(
          assets.quest_bar_hero,
        ),

        hero_video:
          readOptionalString(
            assets.hero_video,
          ) ?? null,

        quest_bar_hero_video:
          readOptionalString(
            assets.quest_bar_hero_video,
          ) ?? null,
      },

      messages: {
        quest_name: readString(
          messages.quest_name,
          'messages.quest_name',
        ),

        game_title:
          readOptionalString(
            messages.game_title,
          ),

        game_publisher:
          readOptionalString(
            messages.game_publisher,
          ),
      },

      task_config_v2: {
        tasks,
      },

      rewards_config: {
        rewards: rewardsRaw
          .map((reward) => {
            if (!isRecord(reward)) {
              return undefined;
            }

            const rewardMessages =
              isRecord(reward.messages)
                ? reward.messages
                : undefined;

            return {
              type:
                typeof reward.type === 'number'
                  ? reward.type
                  : 0,

              sku_id:
                readOptionalString(
                  reward.sku_id,
                ),

              asset:
                readOptionalString(
                  reward.asset,
                ),

              asset_video:
                readOptionalString(
                  reward.asset_video,
                ) ?? null,

              messages: rewardMessages
                ? {
                    name:
                      readOptionalString(
                        rewardMessages.name,
                      ),
                  }
                : undefined,

              orb_quantity:
                typeof reward.orb_quantity === 'number'
                  ? reward.orb_quantity
                  : undefined,

              premium_orb_quantity:
                reward.premium_orb_quantity ?? null,
            };
          })
          .filter(
            (
              reward,
            ): reward is NonNullable<typeof reward> =>
              Boolean(reward),
          ),

        rewards_expire_at:
          rewardsConfig
            ? readOptionalString(
                rewardsConfig.rewards_expire_at,
              )
            : undefined,

        platforms:
          rewardsConfig
            ? readNumberArray(
                rewardsConfig.platforms,
              )
            : [],
      },
    },
  };
}

function parseQuestRegions(payload: unknown): {
  regionsByQuestId: Map<string, QuestEntry['regions']>;
  skippedRecords: number;
} {
  if (!isRecord(payload) || !Array.isArray(payload.quests)) {
    throw new Error('regions API response must contain a quests array');
  }

  const regionsByQuestId = new Map<string, QuestEntry['regions']>();
  let skippedRecords = 0;

  for (const item of payload.quests) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      skippedRecords += 1;
      continue;
    }

    const rawRegions = item.regions;
    let regionList:
      | { include: string[]; exclude: string[] }
      | undefined;

    if (Array.isArray(rawRegions)) {
      const include = readRegionCodeArray(rawRegions);
      if (include) {
        regionList = { include, exclude: [] };
      }
    } else if (isRecord(rawRegions)) {
      const hasInclude = Object.hasOwn(rawRegions, 'include');
      const hasExclude = Object.hasOwn(rawRegions, 'exclude');
      const include = hasInclude
        ? readRegionCodeArray(rawRegions.include)
        : [];
      const exclude = hasExclude
        ? readRegionCodeArray(rawRegions.exclude)
        : [];

      if (
        (hasInclude || hasExclude) &&
        include !== undefined &&
        exclude !== undefined
      ) {
        regionList = { include, exclude };
      }
    }

    if (!regionList) {
      skippedRecords += 1;
      continue;
    }

    regionsByQuestId.set(item.id, {
      include: regionList.include,
      exclude: regionList.exclude,
      is_global: item.is_global === true,
    });
  }

  if (payload.quests.length > 0 && regionsByQuestId.size === 0) {
    throw new Error(
      'regions API response did not contain any supported quest region records',
    );
  }

  return { regionsByQuestId, skippedRecords };
}

async function fetchQuestRegions(): Promise<Map<string, QuestEntry['regions']>> {
  try {
    const payload = await fetchJson<unknown>(REGIONS_ENDPOINT);
    const { regionsByQuestId, skippedRecords } = parseQuestRegions(payload);

    if (skippedRecords > 0) {
      console.warn(
        `Regions API returned ${skippedRecords} unsupported quest region record(s); some quests may be missing flags information.`,
      );
    }

    return regionsByQuestId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not fetch quest regions; quests will be posted without region data: ${message}`);
    return new Map();
  }
}

export async function fetchQuests(): Promise<QuestEntry[]> {
  const [payload, regionsByQuestId] = await Promise.all([
    fetchJson<unknown>(QUESTS_ENDPOINT),
    fetchQuestRegions(),
  ]);

  if (!Array.isArray(payload)) {
    throw new Error(
      'Quests API response must be an array',
    );
  }

  const normalized: QuestEntry[] = [];

  for (const item of payload) {
    try {
      const quest = normalizeQuest(item);
      quest.regions = regionsByQuestId.get(quest.id);
      normalized.push(quest);
    } catch {
      continue;
    }
  }

  if (normalized.length === 0) {
    throw new Error(
      'Quests API did not return any valid quest entries',
    );
  }

  return normalized;
}
