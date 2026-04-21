/**
 * Pure data/domain layer for mods.
 * No UI, no render, no event handlers.
 * character-details-panel.js imports from here for generation prompts.
 * character-details-mod-panel.js imports from here for all shared domain logic.
 */
import { getContext, extension_settings } from "../../../../extensions.js";
import {
  cleanupModsLocalState,
  applyLocalModsState,
  isCharacterModVisibleInCurrentChat,
} from "./character-details-mod-local-state.js";
import {
  compactWhitespace,
  normalizeInlineModSegment,
  findCharacterByName,
} from "./character-details-shared-utils.js";

const extensionName = "st-charmander";

export const MOD_POSITION_START = "start";
export const MOD_POSITION_AFTER_CHAR = "after-char";
export const MOD_POSITION_MIDDLE = "middle";
export const MOD_POSITION_END = "end";
export const MOD_ENTRY_TYPE_SINGLE = "single";
export const MOD_ENTRY_TYPE_GROUP = "group";
export const MODS_PANEL_FILTER_ALL = "all";
export const MOD_STATE_SCOPE_GLOBAL = "global";
export const MOD_STATE_SCOPE_LOCAL = "local";
export const MOD_SHORTNAME_MAX_LENGTH = 50;

export const MOD_POSITION_DEFINITIONS = [
  { key: MOD_POSITION_START, label: "Beginning", icon: "fa-hourglass-start" },
  { key: MOD_POSITION_AFTER_CHAR, label: "After char X", icon: "fa-user-tag" },
  { key: MOD_POSITION_MIDDLE, label: "After chars", icon: "fa-person-circle-plus" },
  { key: MOD_POSITION_END, label: "End", icon: "fa-hourglass-end" },
];

export const MOD_IMAGE_TYPE_DEFINITIONS = [
  { key: "portrait", label: "Portrait", icon: "fa-user" },
  { key: "fullbody", label: "Full body", icon: "fa-person" },
  { key: "free", label: "Free", icon: "fa-pen-to-square" },
  { key: "background", label: "Background", icon: "fa-mountain-sun" },
  { key: "scene", label: "Scene", icon: "fa-people-group" },
  { key: "viewpoint", label: "Viewpoint", icon: "fa-eye" },
];

export function normalizeModPosition(value) {
  if (value === MOD_POSITION_START || value === MOD_POSITION_AFTER_CHAR || value === MOD_POSITION_END) {
    return value;
  }

  return MOD_POSITION_MIDDLE;
}

export function normalizeModsPanelPositionFilter(value) {
  const normalized = normalizeModPosition(value);
  if (
    value === MOD_POSITION_START
    || value === MOD_POSITION_AFTER_CHAR
    || value === MOD_POSITION_MIDDLE
    || value === MOD_POSITION_END
  ) {
    return normalized;
  }

  return MODS_PANEL_FILTER_ALL;
}

export function getModPositionDefinition(value) {
  const normalized = normalizeModPosition(value);
  return MOD_POSITION_DEFINITIONS.find((definition) => definition.key === normalized)
    || MOD_POSITION_DEFINITIONS.find((definition) => definition.key === MOD_POSITION_MIDDLE)
    || MOD_POSITION_DEFINITIONS[0];
}

export function getModsPanelFilterLabel(value) {
  const normalized = normalizeModsPanelPositionFilter(value);
  if (normalized === MODS_PANEL_FILTER_ALL) {
    return "All";
  }

  return getModPositionDefinition(normalized).label;
}

export function createDefaultModImageTypes() {
  return {
    portrait: true,
    fullbody: true,
    free: true,
    background: true,
    scene: true,
    viewpoint: true,
  };
}

export function normalizeModImageTypes(value) {
  const normalized = createDefaultModImageTypes();
  if (!value || typeof value !== "object") {
    return normalized;
  }

  for (const definition of MOD_IMAGE_TYPE_DEFINITIONS) {
    if (Object.prototype.hasOwnProperty.call(value, definition.key)) {
      normalized[definition.key] = value[definition.key] !== false;
    }
  }

  return normalized;
}

export function normalizeModStateScope(value) {
  return String(value || "").trim() === MOD_STATE_SCOPE_LOCAL
    ? MOD_STATE_SCOPE_LOCAL
    : MOD_STATE_SCOPE_GLOBAL;
}

export function normalizeModCharacterCardId(value) {
  return String(value || "").trim();
}

export function normalizeModAfterCharName(value) {
  return String(value || "").trim();
}

export function normalizeRequiredModShortname(value) {
  return compactWhitespace(value).slice(0, MOD_SHORTNAME_MAX_LENGTH);
}

export function deriveModShortname(shortnameValue, fullContentValue) {
  const shortname = compactWhitespace(shortnameValue).slice(0, MOD_SHORTNAME_MAX_LENGTH);
  if (shortname) {
    return shortname;
  }

  const fromContent = compactWhitespace(fullContentValue).slice(0, MOD_SHORTNAME_MAX_LENGTH);
  if (fromContent) {
    return fromContent;
  }

  return "New mod";
}

export function deriveModGroupName(value) {
  const groupName = compactWhitespace(value).slice(0, MOD_SHORTNAME_MAX_LENGTH);
  return groupName || "New group";
}

export function createModId() {
  return `mod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createModItemId() {
  return `moditem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeModItemEntry(item) {
  const fullContent = String(item?.fullContent || "").replace(/\r\n?/g, "\n").trim();
  return {
    id: String(item?.id || "").trim() || createModItemId(),
    shortname: deriveModShortname(item?.shortname, fullContent),
    fullContent,
  };
}

export function normalizeSingleModEntry(mod, baseEntry) {
  const fullContent = String(mod?.fullContent || "").replace(/\r\n?/g, "\n").trim();
  return {
    ...baseEntry,
    type: MOD_ENTRY_TYPE_SINGLE,
    shortname: deriveModShortname(mod?.shortname, fullContent),
    fullContent,
  };
}

export function normalizeGroupModEntry(mod, baseEntry) {
  const rawItems = Array.isArray(mod?.items) ? mod.items : [];
  const items = rawItems.map((item) => normalizeModItemEntry(item));

  if (!items.length) {
    items.push(normalizeModItemEntry({
      shortname: mod?.shortname,
      fullContent: mod?.fullContent,
    }));
  }

  const selectedItemId = String(mod?.selectedItemId || mod?.selectedModId || "").trim();
  const selectedExists = items.some((item) => item.id === selectedItemId);

  return {
    ...baseEntry,
    type: MOD_ENTRY_TYPE_GROUP,
    groupName: deriveModGroupName(mod?.groupName || mod?.shortname),
    selectedItemId: selectedExists ? selectedItemId : items[0].id,
    items,
  };
}

export function isModGroup(mod) {
  return mod?.type === MOD_ENTRY_TYPE_GROUP;
}

export function getSelectedModItem(mod) {
  if (!isModGroup(mod)) {
    return null;
  }

  const items = Array.isArray(mod.items) ? mod.items : [];
  if (!items.length) {
    return null;
  }

  const selected = items.find((item) => item.id === mod.selectedItemId);
  return selected || items[0];
}

export function getModPromptContent(mod) {
  if (isModGroup(mod)) {
    const selectedItem = getSelectedModItem(mod);
    const content = String(selectedItem?.fullContent || "").trim();
    if (content) {
      return content;
    }

    return String(selectedItem?.shortname || "").trim();
  }

  const content = String(mod?.fullContent || "").trim();
  if (content) {
    return content;
  }

  return String(mod?.shortname || "").trim();
}

export function normalizeModEntry(mod) {
  const baseEntry = {
    id: String(mod?.id || "").trim() || createModId(),
    enabled: mod?.enabled !== false,
    position: normalizeModPosition(mod?.position),
    imageTypes: normalizeModImageTypes(mod?.imageTypes),
    stateScope: normalizeModStateScope(mod?.stateScope),
    characterId: normalizeModCharacterCardId(mod?.characterId),
    afterCharName: normalizeModAfterCharName(mod?.afterCharName),
  };

  const type = String(mod?.type || "").trim().toLowerCase();
  if (type === MOD_ENTRY_TYPE_GROUP || Array.isArray(mod?.items)) {
    return normalizeGroupModEntry(mod, baseEntry);
  }

  return normalizeSingleModEntry(mod, baseEntry);
}

export function getModsSettingsRaw() {
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (!Array.isArray(extension_settings[extensionName].mods)) {
    extension_settings[extensionName].mods = [];
  }

  return extension_settings[extensionName].mods;
}

export function getNormalizedModsSettings() {
  return getModsSettingsRaw().map((mod) => normalizeModEntry(mod));
}

export function getModsSettings(context = null) {
  const sourceContext = context || getContext();
  const mods = getNormalizedModsSettings();
  const localState = cleanupModsLocalState(sourceContext, mods);
  return applyLocalModsState(mods, localState);
}

export function getVisibleModsForCurrentChat(mods, context = null) {
  const sourceContext = context || getContext();
  return (Array.isArray(mods) ? mods : []).filter((mod) => isCharacterModVisibleInCurrentChat(mod, sourceContext));
}

export function getModById(modId) {
  return getModsSettings().find((mod) => mod.id === modId) || null;
}

export function getModImageTypeForGenerationMode(mode) {
  if (mode === "viewer-eyes") {
    return "viewpoint";
  }

  if (mode === "portrait" || mode === "fullbody" || mode === "free" || mode === "background" || mode === "scene") {
    return mode;
  }

  return null;
}

export function buildAfterCharModsByCharacterId(data, imageType, context = null) {
  if (!imageType) {
    return new Map();
  }

  const sourceContext = context || getContext();
  const result = new Map();
  const visibleMods = getVisibleModsForCurrentChat(getModsSettings(sourceContext), sourceContext);

  for (const mod of visibleMods) {
    if (!mod?.enabled) {
      continue;
    }

    if (normalizeModPosition(mod.position) !== MOD_POSITION_AFTER_CHAR) {
      continue;
    }

    if (mod.imageTypes?.[imageType] === false) {
      continue;
    }

    const targetCharacter = findCharacterByName(data, mod.afterCharName);
    if (!targetCharacter?.id) {
      continue;
    }

    const inlineSegment = normalizeInlineModSegment(getModPromptContent(mod));
    if (!inlineSegment) {
      continue;
    }

    const key = String(targetCharacter.id || "").trim();
    if (!key) {
      continue;
    }

    if (!result.has(key)) {
      result.set(key, []);
    }

    result.get(key).push(inlineSegment);
  }

  return result;
}

export function buildModsPromptForPosition(position, imageType, context = null) {
  if (!imageType) {
    return "";
  }

  const ensureTrailingComma = (value) => {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }

    return /,\s*$/.test(text) ? text : `${text},`;
  };

  const sourceContext = context || getContext();
  const mods = getVisibleModsForCurrentChat(getModsSettings(sourceContext), sourceContext);
  const matchingMods = mods
    .filter((mod) => mod.enabled)
    .filter((mod) => mod.position === position)
    .filter((mod) => mod.imageTypes?.[imageType] !== false)
    .map((mod) => getModPromptContent(mod))
    .map((modText) => normalizeInlineModSegment(modText))
    .map((modText) => ensureTrailingComma(modText))
    .filter(Boolean);

  return matchingMods.join(" ");
}

export function getModsForGeneration(data, generationType, context = null) {
  const imageType = getModImageTypeForGenerationMode(generationType);
  const afterCharModsByCharacterId = buildAfterCharModsByCharacterId(data, imageType, context);
  const start = buildModsPromptForPosition(MOD_POSITION_START, imageType, context);
  const middle = buildModsPromptForPosition(MOD_POSITION_MIDDLE, imageType, context);
  const end = buildModsPromptForPosition(MOD_POSITION_END, imageType, context);

  return {
    imageType,
    afterCharModsByCharacterId,
    start,
    middle,
    end,
  };
}
