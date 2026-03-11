const STORAGE_KEY = "characterDetails";
const FORBIDDEN_NAME_CHARS = /[\[\]\/|]/g;
const SHORT_ID_REGEX = /^[a-z0-9]{3}$/i;

const DEFAULT_DATA = {
  version: 1,
  activeCharacterId: null,
  viewerCharacterId: null,
  mainCharacterId: null,
  lastGenDescriptionsTarget: null,
  customFieldGeneratorToggles: {},
  characters: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeForbiddenText(value) {
  return String(value ?? "").replace(FORBIDDEN_NAME_CHARS, ".");
}

function normalizeShortId(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  return SHORT_ID_REGEX.test(trimmed) ? trimmed : "";
}

function normalizeCustomFieldGeneratorToggles(input, characters) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const knownCharacterIds = new Set(
    (Array.isArray(characters) ? characters : [])
      .map((character) => normalizeShortId(character?.id))
      .filter(Boolean),
  );

  const normalized = {};
  for (const [varNameRaw, rawEntry] of Object.entries(input)) {
    const varName = String(varNameRaw || "").trim();
    if (!varName) {
      continue;
    }

    if (typeof rawEntry === "boolean") {
      normalized[varName] = rawEntry;
      continue;
    }

    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }

    const byCharacterIdRaw = rawEntry.byCharacterId && typeof rawEntry.byCharacterId === "object"
      ? rawEntry.byCharacterId
      : {};
    const byCharacterId = {};

    for (const [characterIdRaw, value] of Object.entries(byCharacterIdRaw)) {
      const characterId = normalizeShortId(characterIdRaw);
      if (!characterId || (knownCharacterIds.size > 0 && !knownCharacterIds.has(characterId))) {
        continue;
      }

      byCharacterId[characterId] = value === true;
    }

    normalized[varName] = {
      linkedForAll: rawEntry.linkedForAll === true,
      byCharacterId,
    };
  }

  return normalized;
}

function getAlphanumericSeed(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function createRandomShortId(usedIds) {
  const used = usedIds instanceof Set ? usedIds : new Set();
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

  for (let index = 0; index < 5000; index += 1) {
    const next = [
      alphabet[Math.floor(Math.random() * alphabet.length)],
      alphabet[Math.floor(Math.random() * alphabet.length)],
      alphabet[Math.floor(Math.random() * alphabet.length)],
    ].join("");

    if (!used.has(next)) {
      return next;
    }
  }

  return `x${Math.floor(Math.random() * 10)}${Math.floor(Math.random() * 10)}`;
}

function createShortIdFromName(name, usedIds) {
  const used = usedIds instanceof Set ? usedIds : new Set();
  const seed = getAlphanumericSeed(name);

  if (seed.length >= 3) {
    for (let start = 0; start <= seed.length - 3; start += 1) {
      const candidate = seed.slice(start, start + 3);
      if (!used.has(candidate)) {
        return candidate;
      }
    }
  }

  if (seed.length > 0 && seed.length < 3) {
    const padded = (seed + "xxx").slice(0, 3);
    if (!used.has(padded)) {
      return padded;
    }
  }

  return createRandomShortId(used);
}

function createId(context) {
  if (context?.uuidv4) {
    return context.uuidv4();
  }

  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createCharacter(context) {
  return {
    id: createRandomShortId(new Set()),
    name: "New character",
    presence: true,
    appearance: "",
    activeGroupId: null,
    clothingGroups: [],
  };
}

function createGroup(context) {
  return {
    id: createRandomShortId(new Set()),
    name: "New outfit",
    collapsed: false,
    locked: false,
    layers: [],
  };
}

function createLayer(context) {
  return {
    id: createId(context),
    name: "",
    state: "on",
    visibilityOverride: false,
    locked: false,
    children: [],
  };
}

function normalizeLayer(input, context) {
  const layer = createLayer(context);
  if (!input || typeof input !== "object") {
    return layer;
  }

  layer.id = input.id || layer.id;
  layer.name = typeof input.name === "string" ? sanitizeForbiddenText(input.name) : "";
  layer.state = ["on", "partial", "off"].includes(input.state) ? input.state : "on";
  layer.visibilityOverride = Boolean(input.visibilityOverride);
  layer.locked = Boolean(input.locked);
  layer.children = Array.isArray(input.children) ? input.children.map((child) => normalizeLayer(child, context)) : [];
  return layer;
}

function normalizeGroup(input, context) {
  const group = createGroup(context);
  if (!input || typeof input !== "object") {
    return group;
  }

  group.id = input.id || group.id;
  group.name = typeof input.name === "string" ? sanitizeForbiddenText(input.name) : group.name;
  group.collapsed = Boolean(input.collapsed);
  group.locked = Boolean(input.locked);
  group.layers = Array.isArray(input.layers) ? input.layers.map((layer) => normalizeLayer(layer, context)) : [];
  return group;
}

function normalizePresence(value) {
  if (value === undefined) {
    return true;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
  }

  return Boolean(value);
}

function normalizeCharacter(input, context) {
  const character = createCharacter(context);
  if (!input || typeof input !== "object") {
    return character;
  }

  character.id = input.id || character.id;
  character.name = typeof input.name === "string" ? sanitizeForbiddenText(input.name) : character.name;
  character.presence = normalizePresence(input.presence);
  character.appearance = typeof input.appearance === "string" ? sanitizeForbiddenText(input.appearance) : "";
  character.activeGroupId = typeof input.activeGroupId === "string" ? input.activeGroupId : null;
  
  // Normalize clothing groups
  const normalizedGroups = Array.isArray(input.clothingGroups)
    ? input.clothingGroups.map((group) => normalizeGroup(group, context))
    : [];
  
  // Merge groups with duplicate names
  const groupsByName = new Map();
  for (const group of normalizedGroups) {
    const groupName = group.name.trim().toLowerCase();
    if (groupsByName.has(groupName)) {
      // Merge layers into existing group
      const existingGroup = groupsByName.get(groupName);
      existingGroup.layers.push(...group.layers);
    } else {
      groupsByName.set(groupName, group);
    }
  }
  
  character.clothingGroups = Array.from(groupsByName.values());

  if (character.clothingGroups.length > 0) {
    const activeMatch = character.clothingGroups.find((group) => group.id === character.activeGroupId);
    if (!activeMatch) {
      character.activeGroupId = character.clothingGroups[0].id;
    }
  } else {
    character.activeGroupId = null;
  }

  return character;
}

function normalizeCharacterDetails(input, context) {
  const data = clone(DEFAULT_DATA);
  if (!input || typeof input !== "object") {
    return data;
  }

  data.version = 1;
  data.activeCharacterId = input.activeCharacterId || null;
  data.viewerCharacterId = input.viewerCharacterId || null;
  data.mainCharacterId = input.mainCharacterId || null;
  data.lastGenDescriptionsTarget = input.lastGenDescriptionsTarget || null;
  data.customFieldGeneratorToggles = {};
  data.characters = Array.isArray(input.characters)
    ? input.characters.map((character) => normalizeCharacter(character, context))
    : [];

  const usedCharacterIds = new Set();
  for (const character of data.characters) {
    const normalizedCharacterId = normalizeShortId(character.id);
    if (!normalizedCharacterId || usedCharacterIds.has(normalizedCharacterId)) {
      character.id = createShortIdFromName(character.name, usedCharacterIds);
    } else {
      character.id = normalizedCharacterId;
    }
    usedCharacterIds.add(character.id);

    const usedGroupIds = new Set();
    const usedLayerIds = new Set();

    for (const group of character.clothingGroups || []) {
      const normalizedGroupId = normalizeShortId(group.id);
      if (!normalizedGroupId || usedGroupIds.has(normalizedGroupId)) {
        group.id = createShortIdFromName(group.name, usedGroupIds);
      } else {
        group.id = normalizedGroupId;
      }
      usedGroupIds.add(group.id);

      ensureUniqueLayerIds(group.layers, usedLayerIds, context);
    }

    if (character.activeGroupId && !character.clothingGroups.some((group) => group.id === character.activeGroupId)) {
      character.activeGroupId = character.clothingGroups[0]?.id || null;
    }
  }

  if (data.activeCharacterId && !data.characters.some((character) => character.id === data.activeCharacterId)) {
    data.activeCharacterId = data.characters[0]?.id || null;
  }

  if (data.viewerCharacterId && !data.characters.some((character) => character.id === data.viewerCharacterId)) {
    data.viewerCharacterId = null;
  }

  if (data.mainCharacterId && !data.characters.some((character) => character.id === data.mainCharacterId)) {
    data.mainCharacterId = null;
  }

  data.customFieldGeneratorToggles = normalizeCustomFieldGeneratorToggles(input.customFieldGeneratorToggles, data.characters);

  return data;
}

function ensureUniqueLayerIds(layers, usedIds, context) {
  for (const layer of Array.isArray(layers) ? layers : []) {
    if (!layer.id || usedIds.has(layer.id)) {
      layer.id = createId(context);
    }
    usedIds.add(layer.id);
    ensureUniqueLayerIds(layer.children, usedIds, context);
  }
}

function loadCharacterDetails(context) {
  if (!context?.getCurrentChatId?.()) {
    return clone(DEFAULT_DATA);
  }

  const raw = context.variables?.local?.get?.(STORAGE_KEY);
  if (!raw) {
    return clone(DEFAULT_DATA);
  }

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") {
      return clone(DEFAULT_DATA);
    }

    return normalizeCharacterDetails(parsed, context);
  } catch (error) {
    return clone(DEFAULT_DATA);
  }
}

function saveCharacterDetails(context, data) {
  if (!context?.getCurrentChatId?.()) {
    return;
  }

  context.variables?.local?.set?.(STORAGE_KEY, JSON.stringify(data));
}

export {
  STORAGE_KEY,
  loadCharacterDetails,
  saveCharacterDetails,
  createCharacter,
  createGroup,
  createLayer,
  normalizeCharacterDetails,
};
