import { getContext, extension_settings, findExtension } from "../../../../extensions.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT, Popup } from "../../../../popup.js";
import { saveSettingsDebounced, user_avatar as globalUserAvatar } from "../../../../../script.js";
import {
  loadCharacterDetails,
  saveCharacterDetails,
  createCharacter,
  createGroup,
  createLayer,
  normalizeCharacterDetails,
} from "./character-details-store.js";
import { buildDescriptionsText, buildGenDescriptions, buildCharacterVisualDescription } from "./character-details-descriptions.js";
import { runDescriptionsGeneration, runOutfitGenerationForCharacter, runCharacterGenerationWithAI } from "./character-details-generation.js";
import { IMAGE_RESOLUTION_OPTIONS, DEFAULT_RESOLUTION_OPTION } from "./image-resolution-options.js";
import { showCharacterDetailsDiff } from "./character-details-diff-modal.js";

let state = null;
let panelRoot = null;
let footerGenerateButton = null;
let footerFreeGenerateButton = null;
let footerPortraitButton = null;
let footerFullBodyButton = null;
let footerPreviewToggle = null;
let footerGuideToggle = null;
let footerBackgroundButton = null;
let footerViewerEyesButton = null;
let footerSceneButton = null;
let footerRoot = null;
let floatingRoot = null;
let managerRoot = null;
let panelContainerRoot = null;
let modsPanelContainerRoot = null;
let mobileDrawerToggleButton = null;
let mobileDrawerLeftToggleButton = null;
let rightCompactToggleButton = null;
let rightCompactRestoreButton = null;
let modsPanelRoot = null;
let modsAddButton = null;
let modsPositionFilterRoot = null;
let customFieldRefreshTimer = null;
let draggedLayerId = null;
let draggedModId = null;
let openModImageTypesForId = null;
let openModPositionForId = null;
let openModGroupForId = null;
let modsPanelPositionFilter = "all";
let managerExpanded = false;
let mobileDrawerOpen = false;
let mobileDrawerLeftOpen = false;
let rightDrawerCompact = false;
let mobileDrawerBindingsInitialized = false;
let mobileDrawerLeftBindingsInitialized = false;
let activeImageGeneration = null;
let lastObservedPersonaSignature = null;
const extensionName = "st-charmander";
const PERSONA_CHARACTER_STORAGE_KEY = "characterDetailsPersonaCharacters";
const RIGHT_DRAWER_COMPACT_SETTING_KEY = "right_drawer_compact";
const COMPACT_EMPTY_FOOTER_MESSAGE = "Enter chat to start managing details.";
const FORBIDDEN_NAME_CHARS = /[\[\]\/|]/g;

const MOBILE_DRAWER_MEDIA_QUERY = "(max-width: 1000px)";
const MOD_SHORTNAME_MAX_LENGTH = 50;
const MOD_POSITION_START = "start";
const MOD_POSITION_AFTER_CHAR = "after-char";
const MOD_POSITION_MIDDLE = "middle";
const MOD_POSITION_END = "end";
const MOD_ENTRY_TYPE_SINGLE = "single";
const MOD_ENTRY_TYPE_GROUP = "group";
const MODS_PANEL_FILTER_ALL = "all";
const MOD_STATE_SCOPE_GLOBAL = "global";
const MOD_STATE_SCOPE_LOCAL = "local";
const MODS_LOCAL_STATE_STORAGE_KEY = "characterDetailsModsLocalState";
const PROMPT_PREVIEW_REMOVE_NEWLINES_INPUT_ID = "character-details-remove-newlines";
const GUIDE_PROMPTS_LOCAL_STORAGE_KEY = "characterDetailsGuidePrompts";
const MOD_POSITION_DEFINITIONS = [
  { key: MOD_POSITION_START, label: "Beginning", icon: "fa-hourglass-start" },
  { key: MOD_POSITION_AFTER_CHAR, label: "After char X", icon: "fa-user-tag" },
  { key: MOD_POSITION_MIDDLE, label: "After chars", icon: "fa-person-circle-plus" },
  { key: MOD_POSITION_END, label: "End", icon: "fa-hourglass-end" },
];
const MOD_IMAGE_TYPE_DEFINITIONS = [
  { key: "portrait", label: "Portrait", icon: "fa-user" },
  { key: "fullbody", label: "Full body", icon: "fa-person" },
  { key: "free", label: "Free", icon: "fa-pen-to-square" },
  { key: "background", label: "Background", icon: "fa-mountain-sun" },
  { key: "scene", label: "Scene", icon: "fa-people-group" },
  { key: "viewpoint", label: "Viewpoint", icon: "fa-eye" },
];

function hasImageGenerationExtension() {
  return Boolean(findExtension("stable-diffusion")?.enabled);
}

function shouldShowImageGenerationButtons() {
  return hasImageGenerationExtension() && extension_settings?.[extensionName]?.show_image_generation_buttons !== false;
}

function shouldPreviewImagePrompts() {
  return extension_settings?.[extensionName]?.preview_image_prompts === true;
}

function shouldAddPromptGuide() {
  return extension_settings?.[extensionName]?.add_prompt_guide === true;
}

function shouldUseCropToolForAvatars() {
  return extension_settings?.[extensionName]?.use_crop_tool_for_avatars === true;
}

function shouldShowModsPanel() {
  return extension_settings?.[extensionName]?.show_mods_panel === true;
}

function shouldUseTallModsInDesktopMode() {
  return extension_settings?.[extensionName]?.use_tall_mods_in_desktop_mode === true;
}

function shouldRemoveImagePromptNewlines() {
  return extension_settings?.[extensionName]?.remove_image_prompt_newlines !== false;
}

function setRemoveImagePromptNewlines(nextValue) {
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  const normalizedValue = Boolean(nextValue);
  extension_settings[extensionName].remove_image_prompt_newlines = normalizedValue;
  $("#remove_image_prompt_newlines").prop("checked", normalizedValue);
  saveSettingsDebounced();
}

function buildPromptPreviewPopupOptions(baseOptions = {}) {
  const currentRemoveNewlines = shouldRemoveImagePromptNewlines();
  const baseCustomInputs = Array.isArray(baseOptions.customInputs) ? baseOptions.customInputs : [];
  const baseOnClose = baseOptions.onClose;

  return {
    ...baseOptions,
    customInputs: [
      ...baseCustomInputs,
      {
        id: PROMPT_PREVIEW_REMOVE_NEWLINES_INPUT_ID,
        label: "Remove newlines",
        type: "checkbox",
        defaultState: currentRemoveNewlines,
      },
    ],
    onClose: async (popup) => {
      const removeNewlinesValue = popup?.inputResults?.get(PROMPT_PREVIEW_REMOVE_NEWLINES_INPUT_ID);
      if (removeNewlinesValue !== undefined) {
        const normalizedValue = Boolean(removeNewlinesValue);
        if (normalizedValue !== shouldRemoveImagePromptNewlines()) {
          setRemoveImagePromptNewlines(normalizedValue);
        }
      }

      if (typeof baseOnClose === "function") {
        await baseOnClose(popup);
      }
    },
  };
}

function createDefaultModImageTypes() {
  return {
    portrait: true,
    fullbody: true,
    free: true,
    background: true,
    scene: true,
    viewpoint: true,
  };
}

function normalizeModPosition(value) {
  if (value === MOD_POSITION_START || value === MOD_POSITION_AFTER_CHAR || value === MOD_POSITION_END) {
    return value;
  }

  return MOD_POSITION_MIDDLE;
}

function normalizeModsPanelPositionFilter(value) {
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

function getModPositionDefinition(value) {
  const normalized = normalizeModPosition(value);
  return MOD_POSITION_DEFINITIONS.find((definition) => definition.key === normalized)
    || MOD_POSITION_DEFINITIONS.find((definition) => definition.key === MOD_POSITION_MIDDLE)
    || MOD_POSITION_DEFINITIONS[0];
}

function getModsPanelFilterLabel(value) {
  const normalized = normalizeModsPanelPositionFilter(value);
  if (normalized === MODS_PANEL_FILTER_ALL) {
    return "All";
  }

  return getModPositionDefinition(normalized).label;
}

function normalizeModImageTypes(value) {
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

function normalizeModStateScope(value) {
  return String(value || "").trim() === MOD_STATE_SCOPE_LOCAL
    ? MOD_STATE_SCOPE_LOCAL
    : MOD_STATE_SCOPE_GLOBAL;
}

function normalizeModCharacterCardId(value) {
  return String(value || "").trim();
}

function normalizeModAfterCharName(value) {
  return String(value || "").trim();
}

function createDefaultModsLocalState() {
  return {
    enabledByModId: {},
    selectedItemByGroupModId: {},
  };
}

function readModsLocalState(context) {
  const sourceContext = context || getContext();
  const raw = sourceContext?.variables?.local?.get?.(MODS_LOCAL_STATE_STORAGE_KEY);
  if (!raw) {
    return createDefaultModsLocalState();
  }

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return createDefaultModsLocalState();
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return createDefaultModsLocalState();
  }

  const enabledByModId = {};
  const selectedItemByGroupModId = {};

  for (const [modId, value] of Object.entries(parsed.enabledByModId || {})) {
    const normalizedModId = String(modId || "").trim();
    if (!normalizedModId) {
      continue;
    }

    enabledByModId[normalizedModId] = value === true;
  }

  for (const [modId, value] of Object.entries(parsed.selectedItemByGroupModId || {})) {
    const normalizedModId = String(modId || "").trim();
    const normalizedItemId = String(value || "").trim();
    if (!normalizedModId || !normalizedItemId) {
      continue;
    }

    selectedItemByGroupModId[normalizedModId] = normalizedItemId;
  }

  return {
    enabledByModId,
    selectedItemByGroupModId,
  };
}

function writeModsLocalState(context, stateValue) {
  const sourceContext = context || getContext();
  const nextState = stateValue && typeof stateValue === "object"
    ? stateValue
    : createDefaultModsLocalState();

  sourceContext?.variables?.local?.set?.(MODS_LOCAL_STATE_STORAGE_KEY, nextState);
}

function getCurrentChatCharacterCardId(context = null) {
  const sourceContext = context || getContext();
  const chatCharacterId = sourceContext?.characterId;
  if (chatCharacterId === null || chatCharacterId === undefined) {
    return "";
  }

  return String(chatCharacterId).trim();
}

function isCharacterModVisibleInCurrentChat(mod, context = null) {
  const boundCharacterId = normalizeModCharacterCardId(mod?.characterId);
  if (!boundCharacterId) {
    return true;
  }

  const currentCharacterId = getCurrentChatCharacterCardId(context);
  return Boolean(currentCharacterId && boundCharacterId === currentCharacterId);
}

function cleanupModsLocalState(context, mods) {
  const sourceContext = context || getContext();
  const localState = readModsLocalState(sourceContext);
  const normalizedMods = Array.isArray(mods) ? mods : [];
  const localMods = normalizedMods.filter((mod) => mod?.stateScope === MOD_STATE_SCOPE_LOCAL);
  const localModIds = new Set(localMods.map((mod) => String(mod?.id || "").trim()).filter(Boolean));
  let changed = false;

  for (const modId of Object.keys(localState.enabledByModId)) {
    if (!localModIds.has(modId)) {
      delete localState.enabledByModId[modId];
      changed = true;
    }
  }

  for (const modId of Object.keys(localState.selectedItemByGroupModId)) {
    if (!localModIds.has(modId)) {
      delete localState.selectedItemByGroupModId[modId];
      changed = true;
    }
  }

  for (const mod of localMods) {
    if (!isModGroup(mod)) {
      continue;
    }

    const modId = String(mod.id || "").trim();
    if (!modId) {
      continue;
    }

    const items = Array.isArray(mod.items) ? mod.items : [];
    const firstItemId = String(items[0]?.id || "").trim();
    if (!firstItemId) {
      if (localState.selectedItemByGroupModId[modId]) {
        delete localState.selectedItemByGroupModId[modId];
        changed = true;
      }
      continue;
    }

    const selectedItemId = String(localState.selectedItemByGroupModId[modId] || "").trim();
    const exists = items.some((item) => String(item?.id || "").trim() === selectedItemId);
    if (!selectedItemId || !exists) {
      localState.selectedItemByGroupModId[modId] = firstItemId;
      changed = true;
    }
  }

  if (changed) {
    writeModsLocalState(sourceContext, localState);
  }

  return localState;
}

function applyLocalModsState(mods, localState) {
  const normalizedMods = Array.isArray(mods) ? mods : [];
  const stateValue = localState && typeof localState === "object"
    ? localState
    : createDefaultModsLocalState();

  return normalizedMods.map((mod) => {
    if (!mod || mod.stateScope !== MOD_STATE_SCOPE_LOCAL) {
      return mod;
    }

    const modId = String(mod.id || "").trim();
    const effective = { ...mod };

    // Local scope reads enabled state only from chat-local storage.
    // Missing local entry means disabled by default.
    if (Object.prototype.hasOwnProperty.call(stateValue.enabledByModId, modId)) {
      effective.enabled = stateValue.enabledByModId[modId] === true;
    } else {
      effective.enabled = false;
    }

    if (isModGroup(effective) && Object.prototype.hasOwnProperty.call(stateValue.selectedItemByGroupModId, modId)) {
      const selectedItemId = String(stateValue.selectedItemByGroupModId[modId] || "").trim();
      const itemExists = Array.isArray(effective.items)
        ? effective.items.some((item) => String(item?.id || "").trim() === selectedItemId)
        : false;
      if (selectedItemId && itemExists) {
        effective.selectedItemId = selectedItemId;
      }
    }

    return effective;
  });
}

function seedCurrentChatLocalStateFromMod(mods, mod, effectiveMod = null) {
  const modId = String(mod?.id || "").trim();
  if (!modId) {
    return;
  }

  const sourceMod = effectiveMod && typeof effectiveMod === "object"
    ? effectiveMod
    : mod;
  const context = getContext();
  const localState = cleanupModsLocalState(context, mods);

  localState.enabledByModId[modId] = sourceMod?.enabled === true;

  if (isModGroup(mod)) {
    const selectedItemId = String(sourceMod?.selectedItemId || mod?.selectedItemId || "").trim();
    const itemExists = Array.isArray(mod?.items)
      ? mod.items.some((item) => String(item?.id || "").trim() === selectedItemId)
      : false;

    if (selectedItemId && itemExists) {
      localState.selectedItemByGroupModId[modId] = selectedItemId;
    }
  }

  writeModsLocalState(context, localState);
}

function compactWhitespace(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveModShortname(shortnameValue, fullContentValue) {
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

function deriveModGroupName(value) {
  const groupName = compactWhitespace(value).slice(0, MOD_SHORTNAME_MAX_LENGTH);
  return groupName || "New group";
}

function normalizeRequiredModShortname(value) {
  return compactWhitespace(value).slice(0, MOD_SHORTNAME_MAX_LENGTH);
}

function createModId() {
  return `mod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createModItemId() {
  return `moditem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeModItemEntry(item) {
  const fullContent = String(item?.fullContent || "").replace(/\r\n?/g, "\n").trim();
  return {
    id: String(item?.id || "").trim() || createModItemId(),
    shortname: deriveModShortname(item?.shortname, fullContent),
    fullContent,
  };
}

function normalizeSingleModEntry(mod, baseEntry) {
  const fullContent = String(mod?.fullContent || "").replace(/\r\n?/g, "\n").trim();
  return {
    ...baseEntry,
    type: MOD_ENTRY_TYPE_SINGLE,
    shortname: deriveModShortname(mod?.shortname, fullContent),
    fullContent,
  };
}

function normalizeGroupModEntry(mod, baseEntry) {
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

function isModGroup(mod) {
  return mod?.type === MOD_ENTRY_TYPE_GROUP;
}

function getSelectedModItem(mod) {
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

function getModPromptContent(mod) {
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

function normalizeModEntry(mod) {
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

function getModsSettingsRaw() {
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (!Array.isArray(extension_settings[extensionName].mods)) {
    extension_settings[extensionName].mods = [];
  }

  return extension_settings[extensionName].mods;
}

function getNormalizedModsSettings() {
  return getModsSettingsRaw().map((mod) => normalizeModEntry(mod));
}

function getModsSettings(context = null) {
  const sourceContext = context || getContext();
  const mods = getNormalizedModsSettings();
  const localState = cleanupModsLocalState(sourceContext, mods);
  return applyLocalModsState(mods, localState);
}

function saveModsSettings(nextMods, options = {}) {
  const rerender = options.rerender !== false;
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  const normalizedMods = (Array.isArray(nextMods) ? nextMods : []).map((mod) => normalizeModEntry(mod));
  extension_settings[extensionName].mods = normalizedMods;
  cleanupModsLocalState(getContext(), normalizedMods);
  saveSettingsDebounced();
  renderLeftDrawerState();

  if (rerender) {
    renderModsPanel();
  }
}

function getModImageTypeForGenerationMode(mode) {
  if (mode === "viewer-eyes") {
    return "viewpoint";
  }

  if (mode === "portrait" || mode === "fullbody" || mode === "free" || mode === "background" || mode === "scene") {
    return mode;
  }

  return null;
}

function getVisibleModsForCurrentChat(mods, context = null) {
  const sourceContext = context || getContext();
  return (Array.isArray(mods) ? mods : []).filter((mod) => isCharacterModVisibleInCurrentChat(mod, sourceContext));
}

function normalizeInlineModSegment(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s,.]+$/g, "")
    .trim();
}

function findCharacterByName(data, nameValue) {
  const normalized = normalizeName(nameValue);
  if (!normalized) {
    return null;
  }

  return (Array.isArray(data?.characters) ? data.characters : [])
    .find((character) => normalizeName(character?.name) === normalized) || null;
}

function buildAfterCharModsByCharacterId(data, imageType, context = null) {
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

function buildModsPromptForPosition(position, imageType, context = null) {
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

function shouldAutoAddPersonaCharacter() {
  return extension_settings?.[extensionName]?.auto_add_persona_character_for_new_chat !== false;
}

function getLlmHistoryMessageLimit() {
  const rawValue = extension_settings?.[extensionName]?.llm_history_message_limit;
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return 5;
  }

  return Math.max(0, Math.min(200, Math.floor(numeric)));
}

function mapChatMessageToLlmRole(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const role = String(message.role || "").trim().toLowerCase();
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }

  return message.is_user ? "user" : "assistant";
}

function isMessageVisibleToAi(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  return message.is_system !== true;
}

function collectScopedChatMessages(context) {
  const fullChat = Array.isArray(context?.chat) ? context.chat : [];
  const limit = getLlmHistoryMessageLimit();

  if (limit === 0) {
    return fullChat;
  }

  let assistantSeen = 0;
  let startIndex = 0;

  for (let index = fullChat.length - 1; index >= 0; index -= 1) {
    const message = fullChat[index];
    if (!isMessageVisibleToAi(message)) {
      continue;
    }

    const role = mapChatMessageToLlmRole(message);
    if (role !== "assistant") {
      continue;
    }

    assistantSeen += 1;
    if (assistantSeen === limit) {
      startIndex = index;
      break;
    }
  }

  if (assistantSeen < limit) {
    return fullChat;
  }

  return fullChat.slice(startIndex);
}

function buildLimitedChatPrompt(context, systemPrompt) {
  const scopedChat = collectScopedChatMessages(context);
  const prompt = [];

  for (const message of scopedChat) {
    if (!isMessageVisibleToAi(message)) {
      continue;
    }

    const role = mapChatMessageToLlmRole(message);
    if (!role) {
      continue;
    }

    const content = String(message?.mes ?? message?.content ?? "").trim();
    if (!content) {
      continue;
    }

    prompt.push({ role, content });
  }

  if (systemPrompt) {
    prompt.push({ role: "system", content: String(systemPrompt) });
  }

  return prompt;
}

function serializePromptMessagesForQuietPrompt(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = String(message?.role || "system").trim().toUpperCase();
      const content = String(message?.content || "").trim();
      if (!content) {
        return "";
      }

      return `${role}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function getSwitcherCharacterLimit() {
  const rawValue = extension_settings?.[extensionName]?.switcher_character_limit;
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return 7;
  }

  return Math.max(1, Math.min(50, Math.floor(numeric)));
}

function isMobileDrawerMode() {
  return Boolean(window?.matchMedia?.(MOBILE_DRAWER_MEDIA_QUERY)?.matches);
}

function hasChatTarget(context = null) {
  const sourceContext = context || getContext();
  return (sourceContext.characterId !== undefined && sourceContext.characterId !== null) || Boolean(sourceContext.groupId);
}

function isRightDrawerCompactEnabled() {
  return extension_settings?.[extensionName]?.[RIGHT_DRAWER_COMPACT_SETTING_KEY] === true;
}

function isRightDrawerCompactActive() {
  return rightDrawerCompact === true && !managerExpanded;
}

function renderCompactEmptyFooterState(showMessage) {
  if (!footerRoot?.length) {
    return;
  }

  let message = footerRoot.find(".character-details-footer__empty-message");
  if (!message.length) {
    footerRoot.append('<div class="character-details-footer__empty-message displayNone"></div>');
    message = footerRoot.find(".character-details-footer__empty-message");
  }

  if (showMessage) {
    footerRoot.children().addClass("displayNone");
    message.text(COMPACT_EMPTY_FOOTER_MESSAGE);
    message.removeClass("displayNone");
    return;
  }

  footerRoot.children().removeClass("displayNone");
  message.addClass("displayNone");
}

function renderRightCompactControls() {
  if (!panelContainerRoot?.length || !mobileDrawerToggleButton?.length || !rightCompactToggleButton?.length || !rightCompactRestoreButton?.length) {
    return;
  }

  const compactMode = isRightDrawerCompactActive();
  const mobileMode = isMobileDrawerMode();
  const drawerVisible = mobileDrawerOpen === true;
  const showCompactButton = mobileMode
    ? drawerVisible
    : drawerVisible && !managerExpanded && !compactMode;
  const showRestoreButton = mobileMode
    ? false
    : drawerVisible && !managerExpanded && compactMode;

  panelContainerRoot.toggleClass("is-compact", compactMode);
  rightCompactToggleButton.toggleClass("displayNone", !showCompactButton);
  rightCompactRestoreButton.toggleClass("displayNone", !showRestoreButton);

  const compactIcon = rightCompactToggleButton.find("i");
  if (mobileMode) {
    compactIcon
      .removeClass("fa-angle-down fa-arrow-down fa-arrow-up")
      .addClass("fa-angle-up")
      .toggleClass("is-compact-angle-down", !compactMode);
  } else {
    compactIcon
      .removeClass("fa-angle-up fa-arrow-down fa-arrow-up is-compact-angle-down")
      .addClass("fa-angle-down");
  }

  rightCompactToggleButton.attr("title", mobileMode
    ? (compactMode ? "Show character details" : "Compact view")
    : "Compact view");
  rightCompactRestoreButton.attr("title", "Show character details");

  mobileDrawerToggleButton.toggleClass(
    "is-mobile-compact-anchor",
    mobileMode && drawerVisible && compactMode,
  );
  mobileDrawerToggleButton.toggleClass(
    "is-desktop-compact-anchor",
    !mobileMode && drawerVisible && compactMode,
  );
}

function setRightDrawerCompact(nextCompactValue, options = {}) {
  const persist = options.persist !== false;
  rightDrawerCompact = nextCompactValue === true;
  if (persist) {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName][RIGHT_DRAWER_COMPACT_SETTING_KEY] = rightDrawerCompact;
    saveSettingsDebounced();
  }
  renderPanel();
  renderMobileDrawerState();
}

function renderMobileDrawerState() {
  if (!panelContainerRoot?.length || !mobileDrawerToggleButton?.length) {
    return;
  }

  const mobileMode = isMobileDrawerMode();
  panelContainerRoot.toggleClass("is-mobile-collapsed", mobileMode && !mobileDrawerOpen);
  panelContainerRoot.toggleClass("is-desktop-collapsed", !mobileMode && !mobileDrawerOpen);

  mobileDrawerToggleButton.toggleClass("is-open", mobileDrawerOpen);

  const icon = mobileDrawerToggleButton.find("i");
  icon.removeClass("fa-angle-left fa-angle-right").addClass(mobileDrawerOpen ? "fa-angle-right" : "fa-angle-left");

  mobileDrawerToggleButton.attr("title", mobileDrawerOpen ? "Hide character panel" : "Show character panel");
  renderRightCompactControls();
}

function initializeMobileDrawer() {
  if (!panelContainerRoot?.length || !mobileDrawerToggleButton?.length) {
    return;
  }

  if (!mobileDrawerBindingsInitialized) {
    mobileDrawerBindingsInitialized = true;

    mobileDrawerToggleButton.on("click", () => {
      mobileDrawerOpen = !mobileDrawerOpen;
      renderMobileDrawerState();
    });

    const onViewportChange = () => {
      if (!isMobileDrawerMode()) {
        mobileDrawerOpen = true;
      }
      renderMobileDrawerState();
    };

    const mediaQueryList = window.matchMedia(MOBILE_DRAWER_MEDIA_QUERY);
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", onViewportChange);
    } else if (typeof mediaQueryList.addListener === "function") {
      mediaQueryList.addListener(onViewportChange);
    }
  }

  mobileDrawerOpen = !isMobileDrawerMode();
  renderMobileDrawerState();
}

function isModActiveForCurrentChat(mod) {
  if (!mod?.enabled) {
    return false;
  }

  if (normalizeModPosition(mod.position) === MOD_POSITION_AFTER_CHAR) {
    return Boolean(findCharacterByName(state || {}, mod.afterCharName));
  }

  return true;
}

function getActiveModsCountForCurrentChat() {
  const context = getContext();
  const mods = getVisibleModsForCurrentChat(getModsSettings(context), context);
  return mods.filter((mod) => isModActiveForCurrentChat(mod)).length;
}

function renderLeftDrawerState() {
  if (!modsPanelContainerRoot?.length || !mobileDrawerLeftToggleButton?.length) {
    return;
  }

  const mobileMode = isMobileDrawerMode();
  modsPanelContainerRoot.toggleClass("is-mobile-collapsed", mobileMode && !mobileDrawerLeftOpen);
  modsPanelContainerRoot.toggleClass("is-desktop-collapsed", !mobileMode && !mobileDrawerLeftOpen);

  mobileDrawerLeftToggleButton.toggleClass("is-open", mobileDrawerLeftOpen);
  const activeModsCount = getActiveModsCountForCurrentChat();
  const showActiveGlow = !mobileDrawerLeftOpen && activeModsCount > 0;
  mobileDrawerLeftToggleButton.toggleClass("has-active-mods", showActiveGlow);

  let badge = mobileDrawerLeftToggleButton.find(".st-extension-mobile-drawer-left-toggle__count");
  if (!badge.length) {
    mobileDrawerLeftToggleButton.append('<span class="st-extension-mobile-drawer-left-toggle__count displayNone"></span>');
    badge = mobileDrawerLeftToggleButton.find(".st-extension-mobile-drawer-left-toggle__count");
  }

  badge.text(String(activeModsCount));
  badge.toggleClass("displayNone", !(showActiveGlow && activeModsCount > 0));

  const icon = mobileDrawerLeftToggleButton.find("i");
  icon
    .removeClass("fa-angle-left fa-angle-right fa-gear fa-gears")
    .addClass(mobileDrawerLeftOpen ? "fa-angle-left" : (activeModsCount > 0 ? "fa-gears" : "fa-gear"));

  mobileDrawerLeftToggleButton.attr(
    "title",
    mobileDrawerLeftOpen
      ? "Hide mods panel"
      : (activeModsCount > 0 ? `Show mods panel (${activeModsCount} active mods)` : "Show mods panel"),
  );
}

function initializeLeftMobileDrawer() {
  if (!modsPanelContainerRoot?.length || !mobileDrawerLeftToggleButton?.length) {
    return;
  }

  if (!mobileDrawerLeftBindingsInitialized) {
    mobileDrawerLeftBindingsInitialized = true;

    mobileDrawerLeftToggleButton.on("click", () => {
      mobileDrawerLeftOpen = !mobileDrawerLeftOpen;
      renderLeftDrawerState();
    });

    const onViewportChange = () => {
      renderLeftDrawerState();
    };

    const mediaQueryList = window.matchMedia(MOBILE_DRAWER_MEDIA_QUERY);
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", onViewportChange);
    } else if (typeof mediaQueryList.addListener === "function") {
      mediaQueryList.addListener(onViewportChange);
    }
  }

  // Mods drawer defaults to collapsed on both desktop and mobile.
  mobileDrawerLeftOpen = false;
  renderLeftDrawerState();
}

function buildAvatarCropPopupTitle(characterName) {
  const normalizedCharacterName = String(characterName || "").trim();
  if (!normalizedCharacterName) {
    return "Set the crop position of the avatar image";
  }

  return `Set the crop position of the avatar image for ${normalizedCharacterName}`;
}

async function maybeCropAvatarDataUrl(dataUrl, characterName = "") {
  if (!shouldUseCropToolForAvatars()) {
    return dataUrl;
  }

  const croppedImage = await callGenericPopup(
    buildAvatarCropPopupTitle(characterName),
    POPUP_TYPE.CROP,
    "",
    { cropAspect: 1, cropImage: dataUrl },
  );

  if (!croppedImage) {
    return null;
  }

  return String(croppedImage);
}

function getResolutionSettingKeyForMode(mode) {
  const map = {
    portrait: "portrait",
    fullbody: "fullbody",
    background: "background",
    "viewer-eyes": "viewer_eyes",
    scene: "scene",
  };

  return map[mode] || null;
}

function getCustomResolutionForMode(mode) {
  const key = getResolutionSettingKeyForMode(mode);
  if (!key) {
    return null;
  }

  const selected = String(extension_settings?.[extensionName]?.custom_resolutions?.[key] || DEFAULT_RESOLUTION_OPTION);
  if (selected === DEFAULT_RESOLUTION_OPTION) {
    return null;
  }

  const preset = IMAGE_RESOLUTION_OPTIONS[selected];
  if (!preset || !Number.isFinite(preset.width) || !Number.isFinite(preset.height)) {
    return null;
  }

  return { width: preset.width, height: preset.height };
}

function getPresentCharacters(data, options = {}) {
  const excludeId = options.excludeId || null;
  return (Array.isArray(data?.characters) ? data.characters : [])
    .filter((character) => character?.presence)
    .filter((character) => !excludeId || character.id !== excludeId);
}

function buildCharactersVisualDescriptions(data, characters, options = {}) {
  const extraByCharacterId = options.extraByCharacterId instanceof Map
    ? options.extraByCharacterId
    : new Map();

  return (Array.isArray(characters) ? characters : [])
    .map((character) => {
      const characterId = String(character?.id || "").trim();
      const additionalWearingItems = characterId && extraByCharacterId.has(characterId)
        ? extraByCharacterId.get(characterId)
        : [];

      return buildCharacterVisualDescription(data, character.id, { additionalWearingItems });
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildCharactersPresentLine(characters) {
  const names = (Array.isArray(characters) ? characters : [])
    .map((character) => String(character?.name || "").trim())
    .filter(Boolean);
  return `Characters present: ${names.length ? names.join(", ") : "none"}.`;
}

function stripReasoningFromLlmOutput(text, context) {
  let content = String(text || "");

  const parseReasoning = context?.parseReasoningFromString;
  if (typeof parseReasoning === "function") {
    for (let index = 0; index < 20; index += 1) {
      const parsed = parseReasoning(content, { strict: false });
      if (!parsed || typeof parsed.content !== "string") {
        break;
      }

      const next = String(parsed.content || "");
      if (next === content) {
        break;
      }

      content = next;
    }
  }

  content = content
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, " ")
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, " ");

  return content.trim();
}

function isGenerationAbortError(error) {
  if (!error) {
    return false;
  }

  const errorName = String(error?.name || "").toLowerCase();
  const errorMessage = String(error?.message || error || "").toLowerCase();
  return errorName === "aborterror"
    || /abort|aborted|cancel|canceled|stopped|interrupted/.test(errorMessage);
}

function requestStopGeneration(context) {
  if (typeof context?.stopGeneration !== "function") {
    return false;
  }

  try {
    context.stopGeneration();
    return true;
  } catch (error) {
    return false;
  }
}

function setGenerationButtonStopState(button) {
  if (!button || !button.length) {
    return;
  }

  if (button.data("original-html") === undefined) {
    button.data("original-html", button.html());
  }
  if (button.data("original-title") === undefined) {
    button.data("original-title", button.attr("title") || "");
  }

  button.addClass("is-generating");
  button.html('<i class="fa-solid fa-stop"></i>');
  button.attr("title", "Stop generation");
}

function restoreGenerationButtonState(button) {
  if (!button || !button.length) {
    return;
  }

  const originalHtml = button.data("original-html");
  const originalTitle = button.data("original-title");
  if (originalHtml !== undefined) {
    button.html(String(originalHtml));
  }
  if (originalTitle !== undefined) {
    button.attr("title", String(originalTitle));
  }

  button.removeClass("is-generating");
}

function clearActiveImageGeneration(button) {
  restoreGenerationButtonState(button);
  activeImageGeneration = null;
}

function compactPromptToSingleLine(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPromptForImageGenerator(text) {
  const normalized = String(text || "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!normalized) {
    return "";
  }

  return shouldRemoveImagePromptNewlines()
    ? compactPromptToSingleLine(normalized)
    : normalized;
}

function escapeRegExpLiteral(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceViewerNameWithViewer(text, viewerName) {
  const source = String(text || "");
  const normalizedViewerName = String(viewerName || "").trim();
  if (!source || !normalizedViewerName) {
    return source;
  }

  const escapedName = escapeRegExpLiteral(normalizedViewerName);
  const viewerNamePattern = new RegExp(escapedName, "gi");
  return source.replace(viewerNamePattern, "viewer");
}

function resolvePromptMacros(context, text, data = null) {
  let value = String(text ?? "");

  if (typeof context?.substituteParamsExtended === "function") {
    try {
      return String(context.substituteParamsExtended(value));
    } catch {
      // fall through to next resolver
    }
  }

  if (typeof context?.substituteParams === "function") {
    try {
      return String(context.substituteParams(value));
    } catch {
      // fall through to raw value
    }
  }

  return value;
}

async function generateWithChatStopSemantics(context, promptText) {
  if (typeof context?.generateQuietPrompt === "function") {
    return await context.generateQuietPrompt({
      quietPrompt: promptText,
      quietToLoud: false,
      removeReasoning: false,
      trimToSentence: false,
    });
  }

  // Legacy fallback for older ST builds without generateQuietPrompt in context.
  const sendTextarea = $("#send_textarea");
  const previousInputValue = sendTextarea.length ? String(sendTextarea.val() || "") : "";

  const response = await context.generate("impersonate", {
    automatic_trigger: true,
    force_name2: true,
    quiet_prompt: promptText,
    quietToLoud: false,
  });

  if (sendTextarea.length) {
    sendTextarea.val(previousInputValue);
    const element = sendTextarea.get(0);
    element?.dispatchEvent?.(new Event("input", { bubbles: true }));
  }

  return response;
}

function normalizeGuidePromptValue(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function normalizeGuidePromptList(rawValue) {
  if (!rawValue) {
    return [];
  }

  let value = rawValue;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeGuidePromptValue(entry))
    .filter(Boolean);
}

function readGuidePromptList(context) {
  const rawValue = context?.variables?.local?.get?.(GUIDE_PROMPTS_LOCAL_STORAGE_KEY);
  return normalizeGuidePromptList(rawValue);
}

function writeGuidePromptList(context, promptList) {
  const normalizedList = normalizeGuidePromptList(promptList);
  context?.variables?.local?.set?.(GUIDE_PROMPTS_LOCAL_STORAGE_KEY, normalizedList);
}

function buildTextMeasurementFont(element) {
  if (!element || typeof window?.getComputedStyle !== "function") {
    return "16px sans-serif";
  }

  const style = window.getComputedStyle(element);
  const fontStyle = style.fontStyle || "normal";
  const fontVariant = style.fontVariant || "normal";
  const fontWeight = style.fontWeight || "400";
  const fontSize = style.fontSize || "16px";
  const fontFamily = style.fontFamily || "sans-serif";
  return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`;
}

function measureTextWidthPx(text, font) {
  if (!measureTextWidthPx.canvas) {
    measureTextWidthPx.canvas = document.createElement("canvas");
  }

  const context = measureTextWidthPx.canvas.getContext("2d");
  if (!context) {
    return String(text || "").length * 8;
  }

  context.font = font;
  return context.measureText(String(text || "")).width;
}

function truncateTextToPixelWidth(text, maxWidthPx, font) {
  const normalizedText = String(text || "");
  if (!normalizedText) {
    return "";
  }

  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
    return normalizedText;
  }

  if (measureTextWidthPx(normalizedText, font) <= maxWidthPx) {
    return normalizedText;
  }

  const ellipsis = "...";
  const ellipsisWidth = measureTextWidthPx(ellipsis, font);
  if (ellipsisWidth >= maxWidthPx) {
    return ellipsis;
  }

  let low = 0;
  let high = normalizedText.length;
  let best = ellipsis;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${normalizedText.slice(0, mid).trimEnd()}${ellipsis}`;
    const candidateWidth = measureTextWidthPx(candidate, font);

    if (candidateWidth <= maxWidthPx) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function getSelectLabelMaxWidthPx(selectElement) {
  if (!selectElement || typeof window?.getComputedStyle !== "function") {
    return Number.POSITIVE_INFINITY;
  }

  const style = window.getComputedStyle(selectElement);
  const paddingLeft = Number.parseFloat(style.paddingLeft || "0") || 0;
  const paddingRight = Number.parseFloat(style.paddingRight || "0") || 0;
  const fontSize = Number.parseFloat(style.fontSize || "16") || 16;
  const arrowReserve = Math.max(28, fontSize * 1.8);

  return Math.max(32, selectElement.clientWidth - paddingLeft - paddingRight - arrowReserve);
}

function formatGuidePromptOptionLabel(promptValue, index, selectElement = null) {
  const oneLineText = String(promptValue || "")
    .replace(/\r\n?/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!oneLineText) {
    return `Prompt ${index + 1}`;
  }

  const maxWidthPx = getSelectLabelMaxWidthPx(selectElement);
  const font = buildTextMeasurementFont(selectElement);
  return truncateTextToPixelWidth(oneLineText, maxWidthPx, font);
}

async function askGuideForPrompt() {
  if (!shouldAddPromptGuide()) {
    return "";
  }

  const context = getContext();
  let savedPromptList = readGuidePromptList(context);

  const guidePopupIdSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const guidePromptSelectId = `character-details-guide-select-${guidePopupIdSuffix}`;
  const guidePromptDeleteButtonId = `character-details-guide-delete-${guidePopupIdSuffix}`;
  const guidePromptPickerWrapperId = `character-details-guide-picker-${guidePopupIdSuffix}`;
  const guidePromptSaveCheckboxId = `character-details-guide-save-${guidePopupIdSuffix}`;
  const guidePromptOverwriteCheckboxId = `character-details-guide-overwrite-${guidePopupIdSuffix}`;

  let selectedPromptIndex = -1;

  const buildGuidePromptOptionsHtml = (selectElement = null) => {
    const options = ['<option value="">none</option>'];
    for (let index = 0; index < savedPromptList.length; index += 1) {
      const optionLabel = formatGuidePromptOptionLabel(savedPromptList[index], index, selectElement);
      options.push(`<option value="${index}">${escapeHtml(optionLabel)}</option>`);
    }

    return options.join("");
  };

  const guidePopupContent = `
    <div class="flex-container flexFlowColumn gap5" style="width:100%; box-sizing:border-box;">
      <h3>What to focus on?</h3>
      <div id="${guidePromptPickerWrapperId}" style="${savedPromptList.length ? "display:grid;" : "display:none;"} width:100%; box-sizing:border-box; grid-template-columns:minmax(0, 1fr) auto; column-gap:6px; align-items:center;">
        <select id="${guidePromptSelectId}" class="text_pole" style="width:100%; min-width:0; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${buildGuidePromptOptionsHtml()}
        </select>
        <button id="${guidePromptDeleteButtonId}" class="menu_button" type="button" title="Delete selected prompt" style="width:2.5rem; min-width:2.5rem; padding:0; display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; line-height:1;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `;

  const guidePopup = new Popup(
    guidePopupContent,
    POPUP_TYPE.INPUT,
    "",
    {
      rows: 4,
      okButton: "Apply",
      cancelButton: "Cancel",
      customInputs: [
        {
          id: guidePromptSaveCheckboxId,
          label: "Save for this chat",
          type: "checkbox",
          defaultState: false,
        },
        {
          id: guidePromptOverwriteCheckboxId,
          label: "Overwrite",
          type: "checkbox",
          defaultState: false,
        },
      ],
      onOpen: (popup) => {
        const selectElement = popup.dlg.querySelector(`#${guidePromptSelectId}`);
        const deleteButton = popup.dlg.querySelector(`#${guidePromptDeleteButtonId}`);
        const pickerWrapper = popup.dlg.querySelector(`#${guidePromptPickerWrapperId}`);
        const saveCheckbox = popup.dlg.querySelector(`#${guidePromptSaveCheckboxId}`);
        const overwriteCheckbox = popup.dlg.querySelector(`#${guidePromptOverwriteCheckboxId}`);
        const saveLabel = saveCheckbox?.closest("label");
        const overwriteLabel = overwriteCheckbox?.closest("label");

        const alignPickerToInput = () => {
          if (!pickerWrapper || !popup?.mainInput || !popup?.content || typeof window?.getComputedStyle !== "function") {
            return;
          }

          const contentStyle = window.getComputedStyle(popup.content);
          const inputStyle = window.getComputedStyle(popup.mainInput);
          const paddingLeftPx = Number.parseFloat(contentStyle.paddingLeft || "0") || 0;
          const paddingRightPx = Number.parseFloat(contentStyle.paddingRight || "0") || 0;
          const marginLeftPx = Number.parseFloat(inputStyle.marginLeft || "0") || 0;
          const marginRightPx = Number.parseFloat(inputStyle.marginRight || "0") || 0;
          const targetMarginLeftPx = marginLeftPx - paddingLeftPx;
          const targetMarginRightPx = marginRightPx - paddingRightPx;
          const widthAdjustmentPx = paddingLeftPx + paddingRightPx - marginLeftPx - marginRightPx;

          pickerWrapper.style.marginLeft = `${targetMarginLeftPx}px`;
          pickerWrapper.style.marginRight = `${targetMarginRightPx}px`;
          pickerWrapper.style.width = `calc(100% + ${widthAdjustmentPx}px)`;
          pickerWrapper.style.maxWidth = `calc(100% + ${widthAdjustmentPx}px)`;
        };

        const syncGuideControls = () => {
          const hasSelectedSavedPrompt = selectedPromptIndex >= 0 && selectedPromptIndex < savedPromptList.length;

          if (pickerWrapper) {
            pickerWrapper.style.display = savedPromptList.length ? "grid" : "none";
            if (savedPromptList.length) {
              alignPickerToInput();
            }
          }

          if (saveLabel) {
            saveLabel.classList.toggle("displayNone", hasSelectedSavedPrompt);
          }

          if (overwriteLabel) {
            overwriteLabel.classList.toggle("displayNone", !hasSelectedSavedPrompt);
          }

          if (deleteButton) {
            deleteButton.disabled = !hasSelectedSavedPrompt;
            deleteButton.classList.toggle("is-disabled", !hasSelectedSavedPrompt);
            deleteButton.style.opacity = hasSelectedSavedPrompt ? "" : "0.45";
            deleteButton.style.cursor = hasSelectedSavedPrompt ? "" : "not-allowed";
            deleteButton.setAttribute("aria-disabled", hasSelectedSavedPrompt ? "false" : "true");
            deleteButton.title = hasSelectedSavedPrompt
              ? "Delete selected prompt"
              : "Select a saved prompt to delete";

            if (selectElement) {
              const selectHeight = Math.round(selectElement.getBoundingClientRect().height);
              if (selectHeight > 0) {
                deleteButton.style.height = `${selectHeight}px`;
              }
            }
          }
        };

        const renderSelectOptions = () => {
          if (!selectElement) {
            return;
          }

          selectElement.innerHTML = buildGuidePromptOptionsHtml(selectElement);
          if (selectedPromptIndex >= 0 && selectedPromptIndex < savedPromptList.length) {
            selectElement.value = String(selectedPromptIndex);
          } else {
            selectElement.value = "";
            selectedPromptIndex = -1;
          }
        };

        syncGuideControls();
        renderSelectOptions();

        if (selectElement) {
          selectElement.addEventListener("change", () => {
            const selectedValue = String(selectElement.value || "").trim();
            const parsedIndex = selectedValue === "" ? -1 : Number(selectedValue);
            selectedPromptIndex = Number.isInteger(parsedIndex) && parsedIndex >= 0 && parsedIndex < savedPromptList.length
              ? parsedIndex
              : -1;

            if (selectedPromptIndex >= 0) {
              popup.mainInput.value = savedPromptList[selectedPromptIndex] || "";
            }

            if (saveCheckbox) {
              saveCheckbox.checked = false;
            }

            if (overwriteCheckbox) {
              overwriteCheckbox.checked = false;
            }

            syncGuideControls();
          });
        }

        if (deleteButton) {
          deleteButton.addEventListener("click", () => {
            if (deleteButton.disabled) {
              return;
            }

            if (!(selectedPromptIndex >= 0 && selectedPromptIndex < savedPromptList.length)) {
              return;
            }

            savedPromptList.splice(selectedPromptIndex, 1);
            writeGuidePromptList(context, savedPromptList);
            selectedPromptIndex = -1;

            renderSelectOptions();
            syncGuideControls();
          });
        }
      },
      onClosing: (popup) => {
        if (popup.result !== POPUP_RESULT.AFFIRMATIVE) {
          return true;
        }

        const guideText = normalizeGuidePromptValue(popup.mainInput.value);
        const shouldSaveForChat = popup.inputResults?.get(guidePromptSaveCheckboxId) === true;
        const shouldOverwrite = popup.inputResults?.get(guidePromptOverwriteCheckboxId) === true;
        const hasSelectedSavedPrompt = selectedPromptIndex >= 0 && selectedPromptIndex < savedPromptList.length;

        if (hasSelectedSavedPrompt) {
          if (shouldOverwrite && guideText) {
            savedPromptList[selectedPromptIndex] = guideText;
            writeGuidePromptList(context, savedPromptList);
          }
        } else if (shouldSaveForChat && guideText) {
          savedPromptList.push(guideText);
          writeGuidePromptList(context, savedPromptList);
        }

        return true;
      },
    },
  );

  const guide = await guidePopup.show();

  if (guide === null || guide === undefined || guide === false) {
    return null;
  }

  return String(guide || "").trim();
}

async function generateCharacterImage(mode, triggerButton = null) {
  const context = getContext();
  const button = triggerButton?.length ? triggerButton : null;

  if (activeImageGeneration?.running) {
    const isSameButton = Boolean(button && activeImageGeneration.button && activeImageGeneration.button.is(button));
    if (isSameButton) {
      activeImageGeneration.cancelRequested = true;
      activeImageGeneration.stopSignaled = requestStopGeneration(context);
      return;
    }

    toastr.info("Generation already in progress. Press stop on the active button to cancel.", "Character Details");
    return;
  }

  activeImageGeneration = {
    running: true,
    cancelRequested: false,
    stopSignaled: false,
    button,
  };

  if (button) {
    setGenerationButtonStopState(button);
  }

  if (!shouldShowImageGenerationButtons()) {
    toastr.warning("Image generation requires built-in Image Generation extension (Optional modules: sd).", "Character Details");
    clearActiveImageGeneration(button);
    return;
  }

  const data = loadCharacterDetails(context);
  const activeCharacter = getActiveCharacter(data);
  const viewerCharacter = data.viewerCharacterId
    ? (data.characters || []).find((character) => character.id === data.viewerCharacterId) || null
    : null;
  const imageType = getModImageTypeForGenerationMode(mode);
  const afterCharModsByCharacterId = buildAfterCharModsByCharacterId(data, imageType, context);

  let characterDescription = "";
  let charactersPresentLine = "";
  let scenePrompt = "";
  let modeLine = "";

  if (mode === "portrait" || mode === "fullbody") {
    if (!activeCharacter) {
      toastr.warning("Select a character first.", "Character Details");
      clearActiveImageGeneration(button);
      return;
    }

    characterDescription = buildCharacterVisualDescription(data, activeCharacter.id, {
      additionalWearingItems: afterCharModsByCharacterId.get(String(activeCharacter.id || "").trim()) || [],
    });
    if (!characterDescription) {
      toastr.warning("No active character description to generate image from.", "Character Details");
      clearActiveImageGeneration(button);
      return;
    }

    scenePrompt = String(
      mode === "portrait"
        ? extension_settings?.[extensionName]?.closeup_portrait_prompt
        : extension_settings?.[extensionName]?.full_body_portrait_prompt,
    ).trim();
    modeLine = mode === "portrait"
      ? "You are writing a CLOSE-UP PORTRAIT prompt (head and upper torso only)."
      : "You are writing a FULL BODY PORTRAIT prompt (entire body visible).";
  }

  if (mode === "background") {
    scenePrompt = String(extension_settings?.[extensionName]?.describe_background_prompt || "").trim();
    modeLine = "You are writing a BACKGROUND prompt for image generation.";
  }

  if (mode === "viewer-eyes") {
    if (!viewerCharacter) {
      toastr.warning("Set viewer character first.", "Character Details");
      clearActiveImageGeneration(button);
      return;
    }

    const presentWithoutViewer = getPresentCharacters(data, { excludeId: viewerCharacter.id });
    charactersPresentLine = buildCharactersPresentLine(presentWithoutViewer);
    characterDescription = buildCharactersVisualDescriptions(data, presentWithoutViewer, {
      extraByCharacterId: afterCharModsByCharacterId,
    });
    scenePrompt = String(extension_settings?.[extensionName]?.describe_viewer_eyes_prompt || "").trim();
    modeLine = `Viewpoint is from viewer's eyes. Viewer name is ${viewerCharacter.name || "viewer"}, but always call this person \"viewer\".`;
  }

  if (mode === "scene") {
    const presentAll = getPresentCharacters(data);
    charactersPresentLine = buildCharactersPresentLine(presentAll);
    characterDescription = buildCharactersVisualDescriptions(data, presentAll, {
      extraByCharacterId: afterCharModsByCharacterId,
    });
    scenePrompt = String(extension_settings?.[extensionName]?.describe_current_scene_prompt || "").trim();
    modeLine = "You are writing a CURRENT SCENE prompt for image generation.";
  }

  const guideText = await askGuideForPrompt();
  if (guideText === null) {
    clearActiveImageGeneration(button);
    return;
  }

  const visualCommandStart = String(extension_settings?.[extensionName]?.visual_command_start || "").trim();
  const strictSceneRules = "Never mention any other person or character unless explicitly listed in Characters present.";
  const alwaysLine = (mode === "portrait" || mode === "fullbody") && activeCharacter
    ? `Always include exact line: \"${activeCharacter.name || "Unnamed"} is looking at viewer\".`
    : "";
  const llmPrompt = [
    visualCommandStart,
    modeLine,
    charactersPresentLine,
    scenePrompt,
    strictSceneRules,
    alwaysLine,
    activeCharacter ? `Character name: ${activeCharacter.name || "Unnamed"}` : "",
    guideText ? `IMPORTANT: User wants you to focus on this during your description: ${guideText}` : "",
  ].filter(Boolean).join("\n\n");

  let promptToast = toastr.info('<i class="fa-solid fa-spinner fa-spin"></i> Preparing image prompt...', 'Character Details', {
    timeOut: 0,
    extendedTimeOut: 0,
    tapToDismiss: false,
    escapeHtml: false,
  });

  try {
    let llmVisual = "";
    const limitedPromptMessages = buildLimitedChatPrompt(context, llmPrompt);
    const quietPrompt = serializePromptMessagesForQuietPrompt(limitedPromptMessages);

    if (activeImageGeneration?.cancelRequested && activeImageGeneration?.stopSignaled) {
      throw new DOMException("Cancelled by user", "AbortError");
    }

    if (context.generate) {
      llmVisual = await generateWithChatStopSemantics(context, quietPrompt);
    } else {
      throw new Error("Generate API unavailable");
    }

    llmVisual = stripReasoningFromLlmOutput(llmVisual, context);

    if (mode === "viewer-eyes") {
      llmVisual = replaceViewerNameWithViewer(llmVisual, viewerCharacter?.name);
    }

    if (promptToast) {
      toastr.clear(promptToast);
      promptToast = null;
    }

    const modsStart = buildModsPromptForPosition(MOD_POSITION_START, imageType, context);
    const modsMiddle = buildModsPromptForPosition(MOD_POSITION_MIDDLE, imageType, context);
    const modsEnd = buildModsPromptForPosition(MOD_POSITION_END, imageType, context);

    let finalTrigger = [modsStart, characterDescription, modsMiddle, String(llmVisual || "").trim(), modsEnd]
      .filter(Boolean)
      .join("\n\n")
      .replace(/\r\n/g, "\n")
      .trim();

    // Expand macros before preview so injected mod macros are visible in the modal.
    finalTrigger = resolvePromptMacros(context, finalTrigger, data)
      .replace(/\r\n/g, "\n")
      .trim();

    if (shouldPreviewImagePrompts()) {
      const editedPrompt = await callGenericPopup(
        'Preview and optionally edit the final image prompt. Press "Cancel" to abort generation.',
        POPUP_TYPE.INPUT,
        finalTrigger,
        buildPromptPreviewPopupOptions({ rows: 12, okButton: "Generate", cancelButton: "Cancel" }),
      );

      if (editedPrompt === null || editedPrompt === undefined || editedPrompt === false) {
        return;
      }

      finalTrigger = String(editedPrompt || "").replace(/\r\n/g, "\n").trim();
    }

    // Expand macros again after preview to apply macros manually added by the user.
    finalTrigger = resolvePromptMacros(context, finalTrigger, data)
      .replace(/\r\n/g, "\n")
      .trim();

    if (!finalTrigger) {
      throw new Error("Empty image trigger");
    }

    const finalTriggerForGenerator = formatPromptForImageGenerator(finalTrigger);
    if (!finalTriggerForGenerator) {
      throw new Error("Empty image trigger");
    }

    const customResolution = getCustomResolutionForMode(mode);
    const sdCommand = customResolution
      ? `/sd width=${customResolution.width} height=${customResolution.height} ${finalTriggerForGenerator}`
      : `/sd ${finalTriggerForGenerator}`;

    if (context.executeSlashCommandsWithOptions) {
      await context.executeSlashCommandsWithOptions(sdCommand);
    } else if (context.executeSlashCommands) {
      await context.executeSlashCommands(sdCommand);
    } else {
      throw new Error("Slash commands API unavailable");
    }

    // For background generated by our process, auto-set as chat background
    if (mode === "background") {
      await setupAutoBackgroundAfterGeneration(context);
    }
  } catch (error) {
    if (isGenerationAbortError(error) || activeImageGeneration?.stopSignaled) {
      toastr.info("Image generation cancelled.", "Character Details");
    } else {
      toastr.error(`Error: ${error?.message || "Image generation failed"}`, "Character Details");
    }
  } finally {
    if (promptToast) {
      toastr.clear(promptToast);
    }

    clearActiveImageGeneration(button);
  }
}

async function generateFreeImage() {
  const context = getContext();
  if (!shouldShowImageGenerationButtons()) {
    toastr.warning("Image generation requires built-in Image Generation extension (Optional modules: sd).", "Character Details");
    return;
  }

  const data = loadCharacterDetails(context);
  const presentAll = getPresentCharacters(data);
  const imageType = getModImageTypeForGenerationMode("free");
  const afterCharModsByCharacterId = buildAfterCharModsByCharacterId(data, imageType, context);
  const characterDescription = buildCharactersVisualDescriptions(data, presentAll, {
    extraByCharacterId: afterCharModsByCharacterId,
  });
  const modsStart = buildModsPromptForPosition(MOD_POSITION_START, imageType, context);
  const modsMiddle = buildModsPromptForPosition(MOD_POSITION_MIDDLE, imageType, context);
  const modsEnd = buildModsPromptForPosition(MOD_POSITION_END, imageType, context);
  let finalTrigger = [modsStart, characterDescription, modsMiddle, modsEnd]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\r\n/g, "\n")
    .trim();

  // Expand macros before preview so user sees resolved values immediately.
  finalTrigger = resolvePromptMacros(context, finalTrigger, data)
    .replace(/\r\n/g, "\n")
    .trim();

  const editedPrompt = await callGenericPopup(
    'Write your image prompt. Press "Cancel" to abort generation.',
    POPUP_TYPE.INPUT,
    finalTrigger,
    buildPromptPreviewPopupOptions({ rows: 12, okButton: "Generate", cancelButton: "Cancel" }),
  );

  if (editedPrompt === null || editedPrompt === undefined || editedPrompt === false) {
    return;
  }

  finalTrigger = String(editedPrompt || "").replace(/\r\n/g, "\n").trim();

  // Expand macros added/edited by user in preview.
  finalTrigger = resolvePromptMacros(context, finalTrigger, data)
    .replace(/\r\n/g, "\n")
    .trim();

  if (!finalTrigger) {
    toastr.warning("Prompt is empty.", "Character Details");
    return;
  }

  const finalTriggerForGenerator = formatPromptForImageGenerator(finalTrigger);
  if (!finalTriggerForGenerator) {
    toastr.warning("Prompt is empty.", "Character Details");
    return;
  }

  const customResolution = getCustomResolutionForMode("scene");
  const sdCommand = customResolution
    ? `/sd width=${customResolution.width} height=${customResolution.height} ${finalTriggerForGenerator}`
    : `/sd ${finalTriggerForGenerator}`;

  try {
    if (context.executeSlashCommandsWithOptions) {
      await context.executeSlashCommandsWithOptions(sdCommand);
    } else if (context.executeSlashCommands) {
      await context.executeSlashCommands(sdCommand);
    } else {
      throw new Error("Slash commands API unavailable");
    }
  } catch (error) {
    toastr.error(`Error: ${error?.message || "Image generation failed"}`, "Character Details");
  }
}

function renderPreviewToggleState() {
  if (!footerPreviewToggle?.length) {
    return;
  }

  const isOn = shouldPreviewImagePrompts();
  footerPreviewToggle.toggleClass("is-on", isOn);
  const icon = footerPreviewToggle.find("i");
  icon.removeClass("fa-eye fa-eye-slash").addClass(isOn ? "fa-eye" : "fa-eye-slash");
}

function renderGuideToggleState() {
  if (!footerGuideToggle?.length) {
    return;
  }

  const isOn = shouldAddPromptGuide();
  footerGuideToggle.toggleClass("is-on", isOn);
  const icon = footerGuideToggle.find("i");
  icon.removeClass("fa-crosshairs fa-xmark").addClass(isOn ? "fa-crosshairs" : "fa-xmark");
}

function updateFooterImageButtonsVisibility() {
  const show = shouldShowImageGenerationButtons();
  if (footerPreviewToggle?.length) {
    footerPreviewToggle.toggleClass("displayNone", !show);
  }
  if (footerGuideToggle?.length) {
    footerGuideToggle.toggleClass("displayNone", !show);
  }
  if (footerFreeGenerateButton?.length) {
    footerFreeGenerateButton.toggleClass("displayNone", !show);
  }
  if (footerPortraitButton?.length) {
    footerPortraitButton.toggleClass("displayNone", !show);
  }
  if (footerFullBodyButton?.length) {
    footerFullBodyButton.toggleClass("displayNone", !show);
  }
  if (footerBackgroundButton?.length) {
    footerBackgroundButton.toggleClass("displayNone", !show);
  }
  if (footerViewerEyesButton?.length) {
    footerViewerEyesButton.toggleClass("displayNone", !show);
  }
  if (footerSceneButton?.length) {
    footerSceneButton.toggleClass("displayNone", !show);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getInitials(name) {
  const text = String(name || "").trim();
  if (!text) {
    return "?";
  }

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function readAvatarMap(context) {
  const raw = context.variables?.local?.get?.("avatars");
  if (!raw) {
    return {};
  }

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const result = {};
  for (const [name, value] of Object.entries(parsed)) {
    const key = String(name || "").trim();
    if (!key || typeof value !== "string" || !value.trim()) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

function writeAvatarMap(context, avatarMap) {
  const nextMap = avatarMap && typeof avatarMap === "object" ? avatarMap : {};
  context.variables?.local?.set?.("avatars", nextMap);
}

function getAvatarKeyForCharacterName(name) {
  return String(name || "").trim();
}

function getAvatarSourceFromContextCharacter(character, context) {
  if (!character || typeof character !== "object") {
    return "";
  }

  if (typeof character.avatar === "string" && character.avatar) {
    if (/^(data:|https?:)/i.test(character.avatar)) {
      return character.avatar;
    }
    if (context?.getThumbnailUrl) {
      return context.getThumbnailUrl("avatar", character.avatar);
    }
  }

  if (typeof character.avatar_url === "string" && character.avatar_url) {
    return character.avatar_url;
  }

  return "";
}

function getGroupCharacterAvatarSourceByName(characterName, context) {
  if (!context?.groupId || !characterName) {
    return "";
  }

  const group = (Array.isArray(context?.groups) ? context.groups : [])
    .find((item) => String(item?.id) === String(context.groupId));

  const members = Array.isArray(group?.members) ? group.members : [];
  if (!members.length) {
    return "";
  }

  const normalizedTargetName = normalizeName(characterName);
  if (!normalizedTargetName) {
    return "";
  }

  const allCharacters = Array.isArray(context?.characters) ? context.characters : [];
  for (const member of members) {
    const match = allCharacters.find((item) => item?.avatar === member || item?.name === member);
    if (!match) {
      continue;
    }

    if (normalizeName(match.name) !== normalizedTargetName) {
      continue;
    }

    const avatarSource = getAvatarSourceFromContextCharacter(match, context);
    if (avatarSource) {
      return avatarSource;
    }
  }

  return "";
}

function getChatCharacterAvatarSource(context) {
  const activeCharacterId = context?.characterId;
  const activeCharacterIndex = Number(activeCharacterId);
  if (Number.isInteger(activeCharacterIndex) && activeCharacterIndex >= 0) {
    const activeCharacter = Array.isArray(context?.characters) ? context.characters[activeCharacterIndex] : null;
    if (activeCharacter) {
      const avatarSource = getAvatarSourceFromContextCharacter(activeCharacter, context);
      if (avatarSource) {
        return avatarSource;
      }
    }
  }

  const chatName = getChatName(context);
  if (!chatName) {
    return "";
  }

  const match = (Array.isArray(context?.characters) ? context.characters : [])
    .find((character) => normalizeName(character?.name) === normalizeName(chatName));

  if (!match) {
    return "";
  }

  return getAvatarSourceFromContextCharacter(match, context);
}

function getActivePersonaAvatarSource(context) {
  const personaAvatar = String(context?.user_avatar || globalUserAvatar || "").trim();
  if (personaAvatar) {
    if (/^(data:|https?:)/i.test(personaAvatar)) {
      return personaAvatar;
    }

    if (context?.getThumbnailUrl) {
      return context.getThumbnailUrl("persona", personaAvatar);
    }
  }

  const selectors = [
    "#user_avatar img",
    "#user_avatar",
    "#user_avatar_block img",
    "#persona_avatar img",
    "#persona_avatar",
    ".persona_avatar img",
    "[id*='user_avatar'] img",
    "[id*='persona'] img",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }

    if (element instanceof HTMLImageElement && element.src) {
      return element.src;
    }

    const src = element.getAttribute?.("src");
    if (src) {
      return src;
    }
  }

  return "";
}

function getCharacterAvatarSource(character, context, avatarMap) {
  const key = getAvatarKeyForCharacterName(character?.name);
  if (key && avatarMap?.[key]) {
    return avatarMap[key];
  }

  const characterName = normalizeName(character?.name);
  if (!characterName) {
    return "";
  }

  if (context?.groupId) {
    const groupAvatar = getGroupCharacterAvatarSourceByName(character?.name, context);
    if (groupAvatar) {
      return groupAvatar;
    }
  }

  const chatName = context?.groupId ? "" : normalizeName(getChatName(context));
  if (chatName && characterName === chatName) {
    return getChatCharacterAvatarSource(context);
  }

  const personaName = normalizeName(context?.name1);
  if (personaName && characterName === personaName) {
    return getActivePersonaAvatarSource(context);
  }

  return "";
}

function buildSwitcherCharacters(data, maxItems = 7) {
  const characters = Array.isArray(data?.characters) ? data.characters : [];
  if (characters.length <= maxItems) {
    return characters;
  }

  const presentCharacters = characters.filter((character) => character?.presence);
  const notPresentCharacters = characters.filter((character) => !character?.presence);
  const viewerId = data?.viewerCharacterId || null;
  const mainCharacterId = data?.mainCharacterId || null;

  const selected = [];
  const selectedIds = new Set();
  const addCharacter = (character) => {
    if (!character?.id || selectedIds.has(character.id) || selected.length >= maxItems) {
      return;
    }
    selected.push(character);
    selectedIds.add(character.id);
  };

  if (presentCharacters.length > maxItems) {
    const viewerCharacter = viewerId
      ? presentCharacters.find((character) => character.id === viewerId)
      : null;
    const mainCharacter = mainCharacterId
      ? presentCharacters.find((character) => character.id === mainCharacterId)
      : null;

    addCharacter(viewerCharacter);
    addCharacter(mainCharacter);
  }

  for (const character of presentCharacters) {
    addCharacter(character);
  }

  if (selected.length < maxItems) {
    for (const character of notPresentCharacters) {
      addCharacter(character);
    }
  }

  return selected;
}

function renderFloatingCharacters() {
  if (!floatingRoot?.length) {
    return;
  }

  if (managerExpanded) {
    floatingRoot.addClass("hidden");
    return;
  }

  floatingRoot.removeClass("hidden");
  const context = getContext();
  const avatarMap = readAvatarMap(context);
  const characters = buildSwitcherCharacters(state, getSwitcherCharacterLimit());
  const items = characters
    .slice()
    .reverse()
    .map((character) => {
      const activeClass = character.id === state.activeCharacterId ? "is-active" : "";
      const avatarSrc = getCharacterAvatarSource(character, context, avatarMap);
      const avatarClass = avatarSrc ? "has-avatar" : "";
      const avatarHtml = avatarSrc
        ? `<img class="character-floating__avatar-image" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(character.name || "Unnamed")}" />`
        : escapeHtml(getInitials(character.name));
      return `
        <button class="character-floating__item ${activeClass} ${avatarClass}" type="button" data-action="switch-character" data-character-id="${character.id}" title="${escapeHtml(character.name || "Unnamed")}">
          ${avatarHtml}
        </button>
      `;
    })
    .join("");

  floatingRoot.html(`
    <button class="character-floating__toggle" type="button" data-action="expand-manager" title="Open character manager">
      <i class="fa-solid fa-users"></i>
    </button>
    ${items}
  `);
}

function renderManagerPanel() {
  if (!managerRoot?.length) {
    return;
  }

  if (!managerExpanded) {
    managerRoot.addClass("hidden");
    managerRoot.empty();
    return;
  }

  managerRoot.removeClass("hidden");
  const characters = Array.isArray(state?.characters) ? state.characters : [];
  const context = getContext();
  const avatarMap = readAvatarMap(context);
  const listHtml = characters.length === 0
    ? `<div class="character-manager__empty">No characters yet.</div>`
    : characters
      .map((character) => {
        const activeClass = character.id === state.activeCharacterId ? "is-active" : "";
        const mcClass = state.mainCharacterId === character.id ? "is-on" : "";
        const viewerClass = state.viewerCharacterId === character.id ? "is-on" : "";
        const presenceClass = character.presence ? "is-on" : "";
        const uploadedAvatarKey = getAvatarKeyForCharacterName(character.name);
        const hasUploadedAvatar = Boolean(uploadedAvatarKey && avatarMap?.[uploadedAvatarKey]);
        const avatarSrc = getCharacterAvatarSource(character, context, avatarMap);
        const avatarHtml = avatarSrc
          ? `<img class="character-manager__avatar-image" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(character.name || "Unnamed")}" />`
          : escapeHtml(getInitials(character.name));
        const removeAvatarButton = hasUploadedAvatar
          ? `<span class="character-manager__avatar-remove" data-action="remove-avatar-character" data-character-id="${character.id}" title="Remove uploaded avatar" role="button" tabindex="0" aria-label="Remove uploaded avatar">
              <i class="fa-solid fa-xmark"></i>
            </span>`
          : "";
        const uploadAvatarTitle = hasUploadedAvatar ? "Upload an image (overwrite)" : "Upload an image";

        return `
          <div class="character-manager__row ${activeClass}" data-character-id="${character.id}" data-action="switch-character">
            <button class="character-manager__initials" type="button" data-action="upload-avatar-character" data-character-id="${character.id}" title="${uploadAvatarTitle}">
              ${avatarHtml}
              <span class="character-manager__avatar-upload">
                <i class="fa-solid fa-upload"></i>
              </span>
              ${removeAvatarButton}
            </button>
            <div class="character-manager__name">${escapeHtml(character.name || "Unnamed")}</div>
            <button class="character-manager__action ${presenceClass}" type="button" data-action="toggle-presence-character" data-character-id="${character.id}" title="Presence">
              <i class="fa-solid ${character.presence ? "fa-user-check" : "fa-user-slash"}"></i>
            </button>
            <button class="character-manager__action ${mcClass}" type="button" data-action="toggle-mc-character" data-character-id="${character.id}" title="MC">
              <i class="fa-solid fa-star"></i>
            </button>
            <button class="character-manager__action ${viewerClass}" type="button" data-action="toggle-viewer-character" data-character-id="${character.id}" title="Viewer">
              <i class="fa-solid ${viewerClass ? "fa-eye" : "fa-eye-slash"}"></i>
            </button>
            <button class="character-manager__action" type="button" data-action="delete-character" data-character-id="${character.id}" title="Delete">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        `;
      })
      .join("");

  managerRoot.html(`
    <div class="character-manager__actions">
      <button class="character-manager__collapse" type="button" data-action="collapse-manager" title="Close character manager">
        <i class="fa-solid fa-angle-right"></i>
      </button>
      <div class="character-manager__actions-right">
        <button class="character-manager__collapse" type="button" data-action="export-character-details" title="Export JSON">
          <i class="fa-solid fa-file-export"></i>
        </button>
        <button class="character-manager__collapse" type="button" data-action="import-character-details" title="Import JSON">
          <i class="fa-solid fa-file-import"></i>
        </button>
        <button class="character-manager__collapse" type="button" data-action="save-viewer-to-persona" title="Save viewer to persona">
          <i class="fa-solid fa-floppy-disk"></i>
        </button>
        <button class="character-manager__collapse" type="button" data-action="add-character-from-persona" title="Add character from persona">
          <i class="fa-solid fa-user-plus"></i>
        </button>
        <button class="character-manager__collapse" type="button" data-action="generate-character-ai" title="Generate character with AI">
          <i class="fa-solid fa-robot"></i>
        </button>
        <button class="menu_button" type="button" data-action="add-character">Add</button>
      </div>
    </div>
    <div class="character-manager__list">
      ${listHtml}
    </div>
  `);
}

function getActiveCharacter(data) {
  if (!data.activeCharacterId) {
    return null;
  }

  return data.characters.find((character) => character.id === data.activeCharacterId) || null;
}

function ensureActiveCharacter(data) {
  if (!data.activeCharacterId && data.characters.length > 0) {
    data.activeCharacterId = data.characters[0].id;
  }
}

function ensureActiveGroup(character) {
  if (!character) {
    return;
  }

  if (!Array.isArray(character.clothingGroups) || character.clothingGroups.length === 0) {
    character.activeGroupId = null;
    return;
  }

  const match = character.clothingGroups.find((group) => group.id === character.activeGroupId);
  if (!match) {
    character.activeGroupId = character.clothingGroups[0].id;
  }
}

function ensureActiveGroups(data) {
  for (const character of data.characters || []) {
    ensureActiveGroup(character);
  }
}

function collapseOutfitsToActiveOnly(character) {
  if (!character || !Array.isArray(character.clothingGroups)) {
    return;
  }

  ensureActiveGroup(character);
  for (const group of character.clothingGroups) {
    group.collapsed = group.id !== character.activeGroupId;
  }
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeForbiddenText(value) {
  return String(value ?? "").replace(FORBIDDEN_NAME_CHARS, ".");
}

function normalizeCustomField(field) {
  const rawTarget = String(field?.target || "").trim().toLowerCase();
  const target = rawTarget === "viewer" || rawTarget === "everyone" ? rawTarget : "mc";
  return {
    label: String(field?.label || "").trim(),
    varName: String(field?.varName || "").trim(),
    target,
  };
}

function getCustomFieldsSettings() {
  const settings = extension_settings?.[extensionName];
  if (!Array.isArray(settings?.custom_fields)) {
    return [];
  }

  return settings.custom_fields
    .map(normalizeCustomField)
    .filter((field) => field.label && field.varName);
}

function formatVariableValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function normalizeCharacterIdKey(value) {
  return String(value || "").trim().toLowerCase();
}

function parseEveryoneVarMap(rawValue) {
  if (!rawValue) {
    return {};
  }

  let value = rawValue;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeCharacterIdKey(key);
    if (!normalizedKey) {
      continue;
    }

    normalized[normalizedKey] = entry;
  }

  return normalized;
}

function getCustomFieldByVarName(varName) {
  const normalizedVarName = String(varName || "").trim();
  if (!normalizedVarName) {
    return null;
  }

  const fields = getCustomFieldsSettings().filter((field) => field.varName === normalizedVarName);
  if (!fields.length) {
    return null;
  }

  return fields.find((field) => field.target === "everyone") || fields[0];
}

function getCustomFieldGeneratorToggleForCharacter(data, field, characterId) {
  const toggles = data?.customFieldGeneratorToggles || {};
  const rawToggle = toggles?.[field.varName];

  if (field.target !== "everyone") {
    return rawToggle === true;
  }

  if (typeof rawToggle === "boolean") {
    return rawToggle;
  }

  if (!rawToggle || typeof rawToggle !== "object" || Array.isArray(rawToggle)) {
    return false;
  }

  const byCharacterId = rawToggle.byCharacterId && typeof rawToggle.byCharacterId === "object"
    ? rawToggle.byCharacterId
    : {};
  const normalizedCharacterId = normalizeCharacterIdKey(characterId);

  if (rawToggle.linkedForAll === true) {
    if (normalizedCharacterId && Object.prototype.hasOwnProperty.call(byCharacterId, normalizedCharacterId)) {
      return byCharacterId[normalizedCharacterId] === true;
    }

    const firstValue = Object.values(byCharacterId)[0];
    return firstValue === true;
  }

  return normalizedCharacterId ? byCharacterId[normalizedCharacterId] === true : false;
}

function isCustomFieldGeneratorLinkedForAll(data, field) {
  if (field?.target !== "everyone") {
    return false;
  }

  const rawToggle = data?.customFieldGeneratorToggles?.[field.varName];
  return Boolean(rawToggle && typeof rawToggle === "object" && rawToggle.linkedForAll === true);
}

function setCustomFieldGeneratorLinkForAll(data, field, characterId, linkedForAll) {
  if (field?.target !== "everyone") {
    return;
  }

  data.customFieldGeneratorToggles = data.customFieldGeneratorToggles || {};
  const varName = field.varName;
  const existing = data.customFieldGeneratorToggles[varName];
  const byCharacterId = existing && typeof existing === "object" && !Array.isArray(existing) && existing.byCharacterId && typeof existing.byCharacterId === "object"
    ? { ...existing.byCharacterId }
    : {};

  const normalizedCharacterId = normalizeCharacterIdKey(characterId);
  const currentCharacterState = getCustomFieldGeneratorToggleForCharacter(data, field, normalizedCharacterId);
  const characters = Array.isArray(data?.characters) ? data.characters : [];

  if (linkedForAll) {
    for (const character of characters) {
      const nextCharacterId = normalizeCharacterIdKey(character?.id);
      if (!nextCharacterId) {
        continue;
      }
      byCharacterId[nextCharacterId] = currentCharacterState;
    }
  }

  data.customFieldGeneratorToggles[varName] = {
    linkedForAll,
    byCharacterId,
  };
}

function setCustomFieldGeneratorToggleForCharacter(data, field, characterId, enabled) {
  const varName = field?.varName;
  if (!varName) {
    return;
  }

  data.customFieldGeneratorToggles = data.customFieldGeneratorToggles || {};
  const normalizedEnabled = enabled === true;

  if (field.target !== "everyone") {
    data.customFieldGeneratorToggles[varName] = normalizedEnabled;
    return;
  }

  const existing = data.customFieldGeneratorToggles[varName];
  const linkedForAll = Boolean(existing && typeof existing === "object" && !Array.isArray(existing) && existing.linkedForAll === true);
  const byCharacterId = existing && typeof existing === "object" && !Array.isArray(existing) && existing.byCharacterId && typeof existing.byCharacterId === "object"
    ? { ...existing.byCharacterId }
    : {};

  const normalizedCharacterId = normalizeCharacterIdKey(characterId);
  if (!normalizedCharacterId) {
    return;
  }

  if (linkedForAll) {
    for (const character of Array.isArray(data?.characters) ? data.characters : []) {
      const nextCharacterId = normalizeCharacterIdKey(character?.id);
      if (!nextCharacterId) {
        continue;
      }
      byCharacterId[nextCharacterId] = normalizedEnabled;
    }
  } else {
    byCharacterId[normalizedCharacterId] = normalizedEnabled;
  }

  data.customFieldGeneratorToggles[varName] = {
    linkedForAll,
    byCharacterId,
  };
}

function getCustomFieldsForCharacter(character, context) {
  const fields = getCustomFieldsSettings();
  if (!fields.length) {
    return [];
  }

  const results = [];
  for (const field of fields) {
    let value;
    if (field.target === "everyone") {
      const valueByCharacterId = parseEveryoneVarMap(context.variables?.local?.get?.(field.varName));
      value = formatVariableValue(valueByCharacterId[normalizeCharacterIdKey(character.id)]);
    } else {
      const targetId = field.target === "viewer" ? state?.viewerCharacterId : state?.mainCharacterId;
      if (!targetId || targetId !== character.id) {
        continue;
      }

      value = formatVariableValue(context.variables?.local?.get?.(field.varName));
    }

    const enabled = getCustomFieldGeneratorToggleForCharacter(state, field, character.id);
    const linkedForAll = isCustomFieldGeneratorLinkedForAll(state, field);
    results.push({
      label: field.label,
      varName: field.varName,
      target: field.target,
      value,
      enabled,
      linkedForAll,
    });
  }

  return results;
}

function refreshCustomFieldInputs(context) {
  if (!panelRoot?.length) {
    return;
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  const fields = getCustomFieldsForCharacter(character, context);
  const valueByVar = new Map(fields.map((field) => [field.varName, field.value]));

  panelRoot.find("[data-field='custom-field-value']").each((index, element) => {
    const $element = $(element);
    if ($element.is(":focus")) {
      return;
    }

    const varName = $element.data("varName");
    const nextValue = valueByVar.get(varName) ?? "";
    if ($element.val() !== nextValue) {
      $element.val(nextValue);
    }
  });
}

function applyViewerFromPersona(data, context) {
  const personaName = normalizeName(context?.name1);
  if (!personaName) {
    return;
  }

  const match = data.characters.find((character) => normalizeName(character.name) === personaName);
  if (match) {
    data.viewerCharacterId = match.id;
  }
}

function getCurrentPersonaSignature(context) {
  const personaId = getCurrentPersonaId(context);
  const personaName = normalizeName(context?.name1);
  return `${personaId}::${personaName}`;
}

function hasPersonaChanged(context) {
  const nextSignature = getCurrentPersonaSignature(context);
  if (lastObservedPersonaSignature === null) {
    lastObservedPersonaSignature = nextSignature;
    return false;
  }

  const changed = nextSignature !== lastObservedPersonaSignature;
  lastObservedPersonaSignature = nextSignature;
  return changed;
}

function applyMainCharacterFromChat(data, context) {
  // Only auto-set MC if not already set
  if (data.mainCharacterId) {
    return;
  }

  const chatName = getChatName(context);
  if (!chatName) {
    return;
  }

  const match = data.characters.find((character) => normalizeName(character.name) === normalizeName(chatName));
  if (match) {
    data.mainCharacterId = match.id;
  }
}

function getChatName(context) {
  // Try to get character name from context
  if (context.name2) {
    return context.name2;
  }
  
  // For group chats
  if (context.groupId && context.groups) {
    const group = context.groups.find(g => g.id === context.groupId);
    if (group?.name) {
      return group.name;
    }
  }
  
  return null;
}

function findGroup(character, groupId) {
  return character.clothingGroups.find((group) => group.id === groupId) || null;
}

function findCharacterById(data, characterId) {
  return data.characters.find((character) => character.id === characterId) || null;
}

function findLayer(layers, layerId) {
  for (const layer of layers) {
    if (layer.id === layerId) {
      return layer;
    }

    const child = findLayer(layer.children, layerId);
    if (child) {
      return child;
    }
  }

  return null;
}

function removeLayer(layers, layerId) {
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index !== -1) {
    layers.splice(index, 1);
    return true;
  }

  for (const layer of layers) {
    if (removeLayer(layer.children, layerId)) {
      return true;
    }
  }

  return false;
}

function removeLayerFromGroups(groups, layerId) {
  for (const group of groups) {
    if (removeLayer(group.layers, layerId)) {
      return true;
    }
  }

  return false;
}

function findLayerWithParent(layers, layerId, parentArray) {
  for (const layer of layers) {
    if (layer.id === layerId) {
      return { layer, parentArray };
    }

    const child = findLayerWithParent(layer.children, layerId, layer.children);
    if (child) {
      return child;
    }
  }

  return null;
}

function findLayerWithParentInGroups(groups, layerId) {
  for (const group of groups) {
    const found = findLayerWithParent(group.layers, layerId, group.layers);
    if (found) {
      return { ...found, group };
    }
  }

  return null;
}

function extractLayerFromGroups(groups, layerId) {
  const found = findLayerWithParentInGroups(groups, layerId);
  if (!found) {
    return null;
  }

  const { layer, parentArray } = found;
  const index = parentArray.findIndex((item) => item.id === layerId);
  if (index !== -1) {
    parentArray.splice(index, 1);
  }

  return { layer, parentArray, index, group: found.group };
}

function isDescendantLayer(layer, targetId) {
  for (const child of layer.children || []) {
    if (child.id === targetId) {
      return true;
    }
    if (isDescendantLayer(child, targetId)) {
      return true;
    }
  }
  return false;
}

function clearDragIndicators() {
  panelRoot.find(".clothing-layer").removeClass("drop-before drop-after drop-child");
}

function resolveLayerElement(event) {
  const target = event.target || event.currentTarget;
  return target?.closest ? target.closest(".clothing-layer") : null;
}

function cycleState(layer) {
  if (layer.state === "on") {
    layer.state = "partial";
    return;
  }

  if (layer.state === "partial") {
    layer.state = "off";
    return;
  }

  layer.state = "on";
}

function getLayerEffect(layer) {
  if (layer.state === "off") {
    return "none";
  }

  if (layer.state === "partial") {
    return "partial";
  }

  return "full";
}

function combineOcclusion(current, next) {
  if (current === "full" || next === "full") {
    return "full";
  }

  if (current === "partial" || next === "partial") {
    return "partial";
  }

  return "none";
}

function checkHasLockedChild(layers) {
  for (const layer of layers) {
    if (layer.locked) {
      return true;
    }
    if (checkHasLockedChild(layer.children || [])) {
      return true;
    }
  }
  return false;
}

function renderLayers(layers, depth, inheritedOcclusion) {
  return layers
    .map((layer) => {
      const displayOcclusion = inheritedOcclusion;
      const layerEffect = getLayerEffect(layer);
      const nextOcclusion = combineOcclusion(inheritedOcclusion, layerEffect);
      const visibilityOverride = layer.visibilityOverride === true;
      const canToggleVisibilityOverride = displayOcclusion === "full" || visibilityOverride;
      const effectiveOcclusion = visibilityOverride && displayOcclusion === "full"
        ? "partial"
        : displayOcclusion;
      const occlusionClass =
        effectiveOcclusion === "full"
          ? "layer--occluded-full"
          : effectiveOcclusion === "partial"
            ? "layer--occluded-partial"
            : "";
      const stateClass =
        layer.state === "off"
          ? "layer--state-off"
          : layer.state === "partial"
            ? "layer--state-partial"
            : "layer--state-on";

      const stateLabel = layer.state === "on" ? "On" : layer.state === "partial" ? "Partial" : "Off";
      const hasLockedChild = checkHasLockedChild(layer.children);
      const canDelete = !layer.locked && !hasLockedChild;
      const deleteClass = canDelete ? "" : "is-disabled";
      const lockIcon = layer.locked ? "fa-lock" : "fa-lock-open";
      const lockTitle = layer.locked ? "Locked (LLM cannot modify)" : "Unlocked";
      const visibilityIcon = visibilityOverride ? "fa-eye" : "fa-eye-slash";
      const visibilityClass = visibilityOverride ? "is-on" : "";
      const visibilityTitle = visibilityOverride
        ? "Override enabled: force partially visible when occluded"
        : "Force partially visible when fully occluded";
      const visibilityButtonHtml = canToggleVisibilityOverride
        ? `<button class="layer-action icon-button layer-visibility-toggle ${visibilityClass}" type="button" data-action="toggle-visibility-override" title="${visibilityTitle}">
            <i class="fa-solid ${visibilityIcon}"></i>
          </button>`
        : "";

      const childrenHtml = renderLayers(layer.children, depth + 1, nextOcclusion);

      return `
        <div class="clothing-layer ${occlusionClass} ${stateClass}" data-layer-id="${layer.id}" style="--depth:${depth}">
          <button class="layer-action icon-button layer-drag-handle" type="button" title="Drag layer" draggable="true">
            <i class="fa-solid fa-grip-vertical"></i>
          </button>
          <button class="layer-state" type="button" data-action="cycle-state" title="Toggle state">${stateLabel}</button>
          ${visibilityButtonHtml}
          <input class="layer-name text_pole" type="text" value="${escapeHtml(layer.name)}" data-field="layer-name" data-layer-id="${layer.id}" />
          <div class="layer-lock-wrapper">
            <button class="layer-action icon-button layer-lock-button" type="button" data-action="toggle-lock" title="${lockTitle}">
              <i class="fa-solid ${lockIcon}"></i>
            </button>
          </div>
          <button class="layer-action icon-button" type="button" data-action="add-child" title="Add child">
            <i class="fa-solid fa-plus"></i>
          </button>
          <button class="layer-action icon-button ${deleteClass}" type="button" data-action="delete-layer" title="Delete layer" ${canDelete ? "" : "disabled"}>
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        ${childrenHtml}
      `;
    })
    .join("");
}

function renderGroups(character) {
  if (!character.clothingGroups.length) {
    return "<div class=\"empty-hint\">No outfits yet.</div>";
  }

  return character.clothingGroups
    .map((group) => {
      const isActive = character.activeGroupId === group.id;
      const activeClass = isActive ? "is-active" : "";
      const activeIcon = isActive ? "fa-check" : "fa-shirt";
      const activeTitle = isActive ? "Currently worn" : "Set as worn";
      const collapsedClass = group.collapsed ? "is-collapsed" : "";
      const hasLockedChild = checkHasLockedChild(group.layers);
      const canDelete = !group.locked && !hasLockedChild;
      const deleteClass = canDelete ? "" : "is-disabled";
      const lockIcon = group.locked ? "fa-lock" : "fa-lock-open";
      const lockTitle = group.locked ? "Locked (LLM cannot modify)" : "Unlocked";
      const contentHtml = renderLayers(group.layers, 0, "none");

      return `
        <div class="clothing-group ${activeClass}" data-group-id="${group.id}">
            <div class="clothing-group__header">
                <button class="group-toggle" type="button" data-action="toggle-group">${group.collapsed ? "+" : "-"}</button>
            <input class="group-name text_pole" type="text" value="${escapeHtml(group.name)}" data-field="group-name" data-group-id="${group.id}" />
            <button class="group-action icon-button group-active-toggle ${isActive ? "is-on" : ""}" type="button" data-action="set-active-group" title="${activeTitle}">
              <i class="fa-solid ${activeIcon}"></i>
            </button>
            <div class="group-lock-wrapper">
              <button class="group-action icon-button group-lock-button" type="button" data-action="toggle-lock" title="${lockTitle}">
                <i class="fa-solid ${lockIcon}"></i>
              </button>
            </div>
            <button class="group-action icon-button" type="button" data-action="add-layer" title="Add layer">
              <i class="fa-solid fa-plus"></i>
            </button>
            <button class="group-action icon-button ${deleteClass}" type="button" data-action="delete-group" title="Delete group" ${canDelete ? "" : "disabled"}>
              <i class="fa-solid fa-trash"></i>
            </button>
            </div>
            <div class="clothing-group__content ${collapsedClass}">
                ${contentHtml}
            </div>
        </div>
      `;
    })
    .join("");
}

function renderCharacter(character) {
  if (!character) {
    return `
      <div class="character-details__empty">
        <div class="empty-title">No characters yet</div>
        <div class="empty-subtitle">Open manager and use Add to create one.</div>
      </div>
    `;
  }

  const context = getContext();
  const avatarMap = readAvatarMap(context);
  const uploadedAvatarKey = getAvatarKeyForCharacterName(character.name);
  const hasUploadedAvatar = Boolean(uploadedAvatarKey && avatarMap?.[uploadedAvatarKey]);
  const avatarSrc = getCharacterAvatarSource(character, context, avatarMap);
  const avatarHtml = avatarSrc
    ? `<img class="character-manager__avatar-image" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(character.name || "Unnamed")}" />`
    : escapeHtml(getInitials(character.name));
  const removeAvatarButton = hasUploadedAvatar
    ? `<span class="character-manager__avatar-remove" data-action="remove-avatar-character" data-character-id="${character.id}" title="Remove uploaded avatar" role="button" tabindex="0" aria-label="Remove uploaded avatar">
        <i class="fa-solid fa-xmark"></i>
      </span>`
    : "";
  const uploadAvatarTitle = hasUploadedAvatar ? "Upload an image (overwrite)" : "Upload an image";
  const customFields = getCustomFieldsForCharacter(character, context);
  const customFieldsHtml = customFields
    .map((field) => {
      const linkToggleButton = field.target === "everyone"
        ? `
          <button class="group-action icon-button custom-field-toggle ${field.linkedForAll ? "is-on" : ""}" type="button" data-action="toggle-custom-field-link" data-var-name="${escapeHtml(field.varName)}" title="${field.linkedForAll ? "Unlink send state for all chars" : "Link send state for all chars"}">
            <i class="fa-solid ${field.linkedForAll ? "fa-link" : "fa-link-slash"}"></i>
          </button>
        `
        : "";

      return `
      <div class="character-details__section">
        <div class="character-details__header">
          <div class="character-details__label">${escapeHtml(field.label)}</div>
          ${linkToggleButton}
          <button class="group-action icon-button custom-field-toggle ${field.enabled ? "is-on" : ""}" type="button" data-action="toggle-custom-field" data-var-name="${escapeHtml(field.varName)}" title="${field.enabled ? "Send to generator" : "Do not send to generator"}">
            <i class="fa-solid ${field.enabled ? "fa-paper-plane" : "fa-paper-plane"}"></i>
          </button>
        </div>
        <textarea class="text_pole character-details__textarea character-details__custom-field" rows="2" data-field="custom-field-value" data-var-name="${escapeHtml(field.varName)}">${escapeHtml(field.value || "")}</textarea>
      </div>
    `;
    })
    .join("");

  return `
    <div class="character-details">
        <div class="character-details__section">
            <div class="character-details__label">Name</div>
        <div class="character-details__name-row">
          <button class="character-manager__initials" type="button" data-action="upload-avatar-character" data-character-id="${character.id}" title="${uploadAvatarTitle}">
            ${avatarHtml}
            <span class="character-manager__avatar-upload">
              <i class="fa-solid fa-upload"></i>
            </span>
            ${removeAvatarButton}
          </button>
          <input class="text_pole" type="text" value="${escapeHtml(character.name)}" data-field="character-name" data-character-id="${character.id}" />
          <button class="presence-toggle ${character.presence ? "is-on" : ""}" type="button" data-action="toggle-presence" title="Present in scene">
            <i class="fa-solid ${character.presence ? "fa-user-check" : "fa-user-slash"}"></i>
          </button>
          <button class="mc-toggle ${state?.mainCharacterId === character.id ? "is-on" : ""}" type="button" data-action="toggle-mc" title="Main Character">
            <i class="fa-solid ${state?.mainCharacterId === character.id ? "fa-star" : "fa-star"}" style="${state?.mainCharacterId === character.id ? "" : "opacity: 0.4;"}"></i>
          </button>
          <button class="viewer-toggle ${state?.viewerCharacterId === character.id ? "is-on" : ""}" type="button" data-action="toggle-viewer" title="Viewer">
            <i class="fa-solid ${state?.viewerCharacterId === character.id ? "fa-eye" : "fa-eye-slash"}"></i>
          </button>
        </div>
        </div>
        <div class="character-details__section">
            <div class="character-details__label">Appearance</div>
            <textarea class="text_pole character-details__textarea" rows="3" data-field="appearance" data-character-id="${character.id}">${escapeHtml(character.appearance)}</textarea>
        </div>
        ${customFieldsHtml}
        <div class="character-details__section">
            <div class="character-details__header">
            <div class="character-details__label">Outfits</div>
            <button class="group-action icon-button" type="button" data-action="generate-outfit-ai" title="Generate outfit with AI">
              <i class="fa-solid fa-robot"></i>
            </button>
            <button class="group-action icon-button" type="button" data-action="add-group" title="Add outfit">
              <i class="fa-solid fa-plus"></i>
            </button>
            </div>
            <div class="clothing-groups">
                ${renderGroups(character)}
            </div>
        </div>
    </div>
  `;
}

function renderPanel() {
  const context = getContext();
  const hasChatTargetValue = hasChatTarget(context);
  const compactActive = isRightDrawerCompactActive();

  if (!hasChatTargetValue) {
    renderCompactEmptyFooterState(compactActive);
    panelContainerRoot.toggleClass("is-compact", compactActive);
    if (compactActive) {
      panelRoot.empty();
      panelRoot.addClass("hidden");
      footerRoot.removeClass("displayNone");
    } else {
      panelRoot.removeClass("hidden");
      panelRoot.html(`
        <div class="character-details__empty">
          <div class="empty-title">Enter chat</div>
          <div class="empty-subtitle">Select a character to start managing details.</div>
        </div>
      `);
      footerRoot.addClass("displayNone");
    }
    floatingRoot.addClass("hidden");
    managerRoot.addClass("hidden");
    renderRightCompactControls();
    return;
  }

  renderCompactEmptyFooterState(false);
  panelContainerRoot.toggleClass("is-compact", compactActive);
  footerRoot.removeClass("displayNone");
  updateFooterImageButtonsVisibility();

  if (compactActive || managerExpanded) {
    if (compactActive) {
      panelRoot.empty();
    }
    panelRoot.addClass("hidden");
  } else {
    const character = getActiveCharacter(state);
    panelRoot.removeClass("hidden");
    panelRoot.html(renderCharacter(character));
  }

  renderFloatingCharacters();
  renderManagerPanel();
  renderRightCompactControls();
}

function hasActiveChatSession(context) {
  return Boolean(context?.getCurrentChatId?.());
}

function persistDescriptionsForCurrentChat(context, data) {
  if (!hasActiveChatSession(context)) {
    return;
  }

  const descriptionsText = buildDescriptionsText(data);
  context.variables?.local?.set?.("descriptions", descriptionsText);

  if (data?.lastGenDescriptionsTarget) {
    const genDescriptions = buildGenDescriptions(data, data.lastGenDescriptionsTarget);
    context.variables?.local?.set?.("genDescriptions", genDescriptions);
  }
}

function saveAndRender() {
  const context = getContext();
  state = normalizeCharacterDetails(state, context);
  
  // Reload to get the latest lastGenDescriptionsTarget from storage
  const savedData = loadCharacterDetails(context);
  state.lastGenDescriptionsTarget = savedData.lastGenDescriptionsTarget;
  
  ensureActiveGroups(state);
  saveCharacterDetails(context, state);
  persistDescriptionsForCurrentChat(context, state);
  
  renderPanel();
}

function updateDescriptionsOnly() {
  const context = getContext();
  state = normalizeCharacterDetails(state, context);
  
  // Reload to get the latest lastGenDescriptionsTarget from storage
  const savedData = loadCharacterDetails(context);
  state.lastGenDescriptionsTarget = savedData.lastGenDescriptionsTarget;
  
  ensureActiveGroups(state);
  saveCharacterDetails(context, state);
  persistDescriptionsForCurrentChat(context, state);
}

async function handleAddCharacter() {
  const characterName = await Popup.show.input(
    "Add character",
    "Enter the name for the new character:",
    "New character",
    { okButton: "Add", cancelButton: "Cancel" },
  );

  if (characterName === null) {
    return;
  }

  const name = String(characterName || "").trim() || "New character";

  const context = getContext();
  const newCharacter = createCharacter(context);
  newCharacter.name = name;
  state.characters.push(newCharacter);
  state.activeCharacterId = newCharacter.id;

  if (normalizeName(newCharacter.name) && normalizeName(newCharacter.name) === normalizeName(context?.name1)) {
    state.viewerCharacterId = newCharacter.id;
  }

  saveAndRender();
}

function moveUploadedAvatarKey(oldName, newName) {
  const oldKey = getAvatarKeyForCharacterName(oldName);
  const newKey = getAvatarKeyForCharacterName(newName);
  if (!oldKey || !newKey || oldKey === newKey) {
    return;
  }

  const context = getContext();
  const avatarMap = readAvatarMap(context);
  if (!avatarMap[oldKey] || avatarMap[newKey]) {
    return;
  }

  avatarMap[newKey] = avatarMap[oldKey];
  delete avatarMap[oldKey];
  writeAvatarMap(context, avatarMap);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function pickAvatarFile() {
  return await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const onChange = () => {
      const file = input.files?.[0] || null;
      cleanup();
      resolve(file);
    };

    input.addEventListener("change", onChange, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function handleUploadCharacterAvatar(character) {
  const file = await pickAvatarFile();
  if (!file) {
    return;
  }

  let dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl.startsWith("data:image/")) {
    toastr.error("Selected file is not a supported image.", "Character Details");
    return;
  }

  const key = getAvatarKeyForCharacterName(character.name);
  if (!key) {
    toastr.warning("Set character name before uploading avatar.", "Character Details");
    return;
  }

  dataUrl = await maybeCropAvatarDataUrl(dataUrl, character?.name);
  if (!dataUrl) {
    return;
  }

  const context = getContext();
  const avatarMap = readAvatarMap(context);
  avatarMap[key] = dataUrl;
  writeAvatarMap(context, avatarMap);
  renderPanel();
}

function handleRemoveCharacterAvatar(character) {
  const key = getAvatarKeyForCharacterName(character.name);
  if (!key) {
    return;
  }

  const context = getContext();
  const avatarMap = readAvatarMap(context);
  if (!avatarMap[key]) {
    return;
  }

  delete avatarMap[key];
  writeAvatarMap(context, avatarMap);
  renderPanel();
}

async function setupAutoBackgroundAfterGeneration(context) {
  // Wait a moment for the image to be rendered in chat
  await new Promise(resolve => setTimeout(resolve, 1200));
  
  console.log("[ST Extension] Looking for generated background image...");
  
  // Look for the most recent image in the chat
  const chatContainer = $("#chat");
  if (!chatContainer.length) {
    console.log("[ST Extension] Chat container not found");
    return;
  }
  
  const messages = chatContainer.find(".mes").toArray().reverse();
  console.log(`[ST Extension] Scanning ${messages.length} messages`);
  
  for (const msgElement of messages) {
    const imageElements = $(msgElement).find("img");
    console.log(`[ST Extension] Found ${imageElements.length} images in message`);
    
    if (imageElements.length > 0) {
      const imageElement = $(imageElements).last();
      const imageSrc = imageElement.attr("src");
      console.log(`[ST Extension] Image src: ${imageSrc?.substring(0, 100)}...`);
      
      if (imageSrc) {
        // Auto-set background if it's a data URL (our generated image)
        try {
          await applyBackgroundFromImage(imageSrc);
          toastr.success("Background set automatically.", "Character Details");
          console.log("[ST Extension] Background applied successfully");
        } catch (error) {
          console.error("[ST Extension] Failed to set background:", error);
          toastr.error("Failed to set background: " + error?.message, "Character Details");
        }
      }
      break;
    }
  }
}

function normalizeBackgroundPath(value) {
  if (typeof value !== "string") {
    return "";
  }

  let text = String(value).trim();
  if (!text) {
    return "";
  }

  const cssUrlMatch = text.match(/^url\((.*)\)$/i);
  if (cssUrlMatch) {
    text = String(cssUrlMatch[1] || "").trim().replace(/^['"]|['"]$/g, "");
  }

  try {
    const absoluteUrl = new URL(text, window.location.origin);
    text = `${absoluteUrl.pathname}${absoluteUrl.search}`;
  } catch {
  }

  try {
    text = decodeURI(text);
  } catch {
  }

  return text;
}

function findExistingChatBackgroundPath(imageUrl, chatBackgrounds) {
  const normalizedImagePath = normalizeBackgroundPath(imageUrl);
  if (!normalizedImagePath || !Array.isArray(chatBackgrounds)) {
    return null;
  }

  for (const item of chatBackgrounds) {
    if (normalizeBackgroundPath(item) === normalizedImagePath) {
      return item;
    }
  }

  return null;
}

function getPersistedImagePathFromUrl(imageUrl) {
  const normalized = normalizeBackgroundPath(imageUrl);
  if (!normalized) {
    return null;
  }

  // Already stored in user images - no upload needed
  if (normalized.startsWith('/user/images/')) {
    return normalized;
  }

  return null;
}

async function setChatBackgroundMetadata(imagePath) {
  const context = getContext();
  const chatMetadata = context?.chatMetadata;
  if (!chatMetadata) {
    throw new Error('chatMetadata is not available in context');
  }

  const LIST_METADATA_KEY = 'chat_backgrounds';
  const BG_METADATA_KEY = 'custom_background';
  const normalizedTarget = normalizeBackgroundPath(imagePath);
  const list = Array.isArray(chatMetadata[LIST_METADATA_KEY]) ? [...chatMetadata[LIST_METADATA_KEY]] : [];
  const alreadyInList = list.some((item) => normalizeBackgroundPath(item) === normalizedTarget);
  if (!alreadyInList) {
    list.push(imagePath);
  }
  chatMetadata[LIST_METADATA_KEY] = list;
  chatMetadata[BG_METADATA_KEY] = `url("${encodeURI(imagePath)}")`;

  if (typeof context?.saveMetadata === 'function') {
    await context.saveMetadata();
  } else {
    throw new Error('saveMetadata function not available in context');
  }

  if (context?.eventSource && context?.eventTypes?.CHAT_CHANGED) {
    await context.eventSource.emit(context.eventTypes.CHAT_CHANGED);
  }
}

async function applyBackgroundFromImage(imageUrl) {
  console.log("[ST Extension] Applying background image...", imageUrl);
  
  try {
    const context = getContext();
    const chatMetadata = context?.chatMetadata;
    const LIST_METADATA_KEY = "chat_backgrounds";

    // Optimization 1: if source image is already persisted in /user/images, skip upload
    const persistedImagePath = getPersistedImagePathFromUrl(imageUrl);

    // Optimization 2: if image already exists in chat backgrounds, skip upload
    const existingPath = findExistingChatBackgroundPath(imageUrl, chatMetadata?.[LIST_METADATA_KEY]);
    const imagePath = existingPath || persistedImagePath || await uploadBackgroundToServer(imageUrl);

    if (existingPath || persistedImagePath) {
      await setChatBackgroundMetadata(imagePath);
      console.log("[ST Extension] Reused existing persisted background, upload skipped:", imagePath);
    }
    
    if (!imagePath) {
      throw new Error("No image path returned from upload");
    }
    
    // Apply background CSS with the persisted path
    if (typeof jQuery !== 'undefined') {
      const bgElement = jQuery('#bg1');
      if (bgElement.length) {
        const backgroundCssUrl = `url("${encodeURI(imagePath)}")`;
        bgElement.css('background-image', backgroundCssUrl);
        console.log("[ST Extension] Applied CSS to #bg1 with path:", backgroundCssUrl);
      } else {
        console.warn("[ST Extension] #bg1 element not found");
      }
    }
  } catch (error) {
    console.error("[ST Extension] Failed to apply background:", error);
    throw error;
  }
}

async function uploadBackgroundToServer(imageUrl) {
  try {
    console.log("[ST Extension] Starting background upload for:", imageUrl);
    
    // Use SillyTavern extension context API
    const context = getContext();
    const characters = Array.isArray(context?.characters) ? context.characters : [];
    const thisChid = Number(context?.characterId);
    const selectedGroup = context?.groupId;
    const groups = Array.isArray(context?.groups) ? context.groups : [];
    const chatId = typeof context?.getCurrentChatId === 'function' ? context.getCurrentChatId() : null;
    if (!chatId) {
      throw new Error('No active chat selected');
    }
    
    let characterName;
    if (selectedGroup) {
      characterName = groups.find((group) => String(group?.id) == String(selectedGroup))?.id?.toString();
    } else if (Number.isInteger(thisChid) && characters[thisChid]) {
      characterName = String(characters[thisChid].name || "").trim();
    }

    // Fallback: use currently active extension character
    if (!characterName) {
      const activeCharacter = getActiveCharacter(state);
      const activeName = String(activeCharacter?.name || "").trim();
      if (activeName) {
        characterName = activeName;
      }
    }

    // Fallback: parse character folder from image URL e.g. /user/images/Kei and Rika/file.png
    if (!characterName && typeof imageUrl === "string") {
      const marker = "/user/images/";
      const markerIndex = imageUrl.indexOf(marker);
      if (markerIndex >= 0) {
        const pathAfterMarker = imageUrl.slice(markerIndex + marker.length);
        const firstSlashIndex = pathAfterMarker.indexOf("/");
        const folderName = firstSlashIndex >= 0 ? pathAfterMarker.slice(0, firstSlashIndex) : "";
        const decodedFolderName = decodeURIComponent(folderName || "").trim();
        if (decodedFolderName) {
          characterName = decodedFolderName;
        }
      }
    }
    
    if (!characterName) {
      console.warn("[ST Extension] No character selected and could not infer from image URL");
      return null;
    }
    
    console.log("[ST Extension] Character name:", characterName);
    
    // Convert image URL to base64
    let base64Data;
    if (imageUrl.startsWith('data:')) {
      // Already a data URL - extract base64 part
      base64Data = imageUrl.split(',')[1];
      console.log("[ST Extension] Using data URL directly");
    } else {
      // Fetch and convert to base64
      console.log("[ST Extension] Fetching image from URL:", imageUrl);
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve) => {
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      base64Data = dataUrl.split(',')[1];
      console.log("[ST Extension] Converted to base64");
    }
    
    // Create filename with timestamp (humanized format like SillyTavern)
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}@${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}m${String(now.getSeconds()).padStart(2, '0')}s${String(now.getMilliseconds()).padStart(3, '0')}ms`;
    const filename = `${characterName}_${timestamp}`;
    
    console.log("[ST Extension] Uploading with filename:", filename);
    
    // Upload using SillyTavern's API
    const requestBody = {
      image: base64Data,
      format: 'png',
      ch_name: characterName,
      filename: filename.replace(/\./g, '_'),
    };
    
    const uploadResponse = await fetch('/api/images/upload', {
      method: 'POST',
      headers: typeof context?.getRequestHeaders === 'function'
        ? context.getRequestHeaders()
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed (${uploadResponse.status}): ${errorText}`);
    }
    
    const responseData = await uploadResponse.json();
    console.log("[ST Extension] Upload successful:", responseData);
    
    const imagePath = String(responseData.path || '').trim();
    if (!imagePath) {
      throw new Error('Upload response missing image path');
    }
    
    console.log("[ST Extension] Background uploaded to:", imagePath);
    
    await setChatBackgroundMetadata(imagePath);
    console.log("[ST Extension] Metadata saved successfully");
    
    // Refresh background gallery if function is available
    if (typeof window.getBackgrounds === 'function') {
      await window.getBackgrounds();
      console.log("[ST Extension] Backgrounds refreshed");
    }
    
    return imagePath;
    
  } catch (error) {
    console.error("[ST Extension] Failed to upload background:", error);
    throw error;
  }
}

function resetMessageProcessing() {
  // Remove the processed flag from all messages so they get re-checked
  const chatContainer = $("#chat");
  if (chatContainer.length) {
    chatContainer.find(".mes[data-st-extension-processed]").removeAttr("data-st-extension-processed");
  }
}

function findMessageImageElement($msg) {
  if (!$msg?.length) {
    return $();
  }

  const imageElement = $msg
    .find(".mes_img")
    .filter((index, element) => {
      const $element = $(element);
      const source = String($element.attr("src") || $element.attr("data-src") || "").trim();
      return Boolean(source);
    })
    .last();

  if (imageElement.length) {
    return imageElement;
  }

  return $msg.find(".mes_img").last();
}

function setImageActionButtonsState($msg) {
  if (!$msg?.length) {
    return;
  }

  const hasImage = findMessageImageElement($msg).length > 0;
  const buttons = $msg.find("[data-st-extension-image-action]");
  if (!buttons.length) {
    return;
  }

  buttons.each((index, button) => {
    const $button = $(button);
    $button.toggleClass("disabled", !hasImage);
    $button.css("opacity", hasImage ? "" : "0.3");
    $button.css("cursor", hasImage ? "" : "not-allowed");
    $button.attr("aria-disabled", hasImage ? "false" : "true");
  });
}

function injectMessageActionButtons() {
  const chatContainer = $("#chat");
  if (!chatContainer.length) {
    return;
  }
  
  const messages = chatContainer.find(".mes");
  
  if (messages.length === 0) {
    return;
  }
  
  messages.each((index, msgElement) => {
    const $msg = $(msgElement);
    
    // Find or create extraMesButtons container
    let actionsContainer = $msg.find(".extraMesButtons");
    if (!actionsContainer.length) {
      actionsContainer = $('<div class="extraMesButtons"></div>');
      const mesButtons = $msg.find(".mes_buttons");
      if (mesButtons.length) {
        actionsContainer.appendTo(mesButtons);
      } else {
        // Fallback: append after mes_text
        const mesBlock = $msg.find(".mes_block");
        if (mesBlock.length) {
          actionsContainer.appendTo(mesBlock);
        }
      }
    }
    
    // Check if our buttons already added
    const hasOurButtons = actionsContainer.find("[data-st-extension-image-action]").length > 0;
    if (!hasOurButtons) {
      // Add "Set as avatar" button
      const avatarBtn = $(
        `<div class="mes_button mes_button_icon" data-action="set-as-avatar" data-st-extension-image-action="true" 
          title="Set as character avatar" tabindex="0" role="button">
          <i class="fa-solid fa-user-circle"></i>
        </div>`
      );
      
      // Add "Set as background" button
      const bgBtn = $(
        `<div class="mes_button mes_button_icon" data-action="set-as-chat-background" data-st-extension-image-action="true"
          title="Set as chat background" tabindex="0" role="button">
          <i class="fa-solid fa-image"></i>
        </div>`
      );

      actionsContainer.append(avatarBtn);
      actionsContainer.append(bgBtn);
    }

    setImageActionButtonsState($msg);
  });
}


async function handleSetAsAvatarClick(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const $btn = $(event.target).closest("[data-action='set-as-avatar']");
  const $msg = $btn.closest(".mes");
  setImageActionButtonsState($msg);
  
  // Check if button is disabled
  if ($btn.hasClass("disabled")) {
    toastr.warning("No image detected in this message yet.", "Character Details");
    return;
  }

  const imageElement = findMessageImageElement($msg);
  
  if (!imageElement.length) {
    setImageActionButtonsState($msg);
    toastr.error("No image found in message.", "Character Details");
    return;
  }

  const imageSrc = imageElement.attr("src") || imageElement.attr("data-src");
  if (!imageSrc) {
    toastr.error("Image source not found.", "Character Details");
    return;
  }
  
  // Convert to data URL if needed
  let dataUrl = imageSrc;
  if (!imageSrc.startsWith("data:")) {
    try {
      const response = await fetch(imageSrc);
      const blob = await response.blob();
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      toastr.error("Failed to load image: " + error.message, "Character Details");
      return;
    }
  }

  const context = getContext();
  const activeCharacter = getActiveCharacter(state);
  if (!activeCharacter) {
    toastr.warning("Select a character first.", "Character Details");
    return;
  }

  dataUrl = await maybeCropAvatarDataUrl(dataUrl, activeCharacter.name);
  if (!dataUrl) {
    return;
  }
  
  const key = getAvatarKeyForCharacterName(activeCharacter.name);
  if (!key) {
    toastr.warning("Character name required.", "Character Details");
    return;
  }
  
  const avatarMap = readAvatarMap(context);
  avatarMap[key] = dataUrl;
  writeAvatarMap(context, avatarMap);
  
  renderFloatingCharacters();
  renderManagerPanel();
  
  toastr.success(`Avatar set for ${activeCharacter.name}.`, "Character Details");
}

async function handleSetAsChatBackgroundClick(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const $btn = $(event.target).closest("[data-action='set-as-chat-background']");
  const $msg = $btn.closest(".mes");
  setImageActionButtonsState($msg);
  
  // Check if button is disabled
  if ($btn.hasClass("disabled")) {
    toastr.warning("No image detected in this message yet.", "Character Details");
    return;
  }

  const imageElement = findMessageImageElement($msg);
  
  if (!imageElement.length) {
    setImageActionButtonsState($msg);
    toastr.error("No image found in message.", "Character Details");
    return;
  }

  const imageSrc = imageElement.attr("src") || imageElement.attr("data-src");
  if (!imageSrc) {
    toastr.error("Image source not found.", "Character Details");
    return;
  }
  
  console.log("[ST Extension] Set as chat background clicked for:", imageSrc);
  
  try {
    await applyBackgroundFromImage(imageSrc);
    toastr.success("Chat background updated.", "Character Details");
  } catch (error) {
    console.error("[ST Extension] Error setting background:", error);
    toastr.error("Failed to set background: " + error?.message, "Character Details");
  }
}

function getDefinedCustomFieldsByVarName() {
  const byVarName = new Map();
  for (const field of getCustomFieldsSettings()) {
    if (!field?.varName || byVarName.has(field.varName)) {
      continue;
    }
    byVarName.set(field.varName, field);
  }

  return byVarName;
}

function collectCustomFieldValues(context) {
  const values = {};
  const fieldsByVarName = getDefinedCustomFieldsByVarName();
  for (const [varName, field] of fieldsByVarName.entries()) {
    const rawValue = context.variables?.local?.get?.(varName);
    values[varName] = field.target === "everyone"
      ? parseEveryoneVarMap(rawValue)
      : formatVariableValue(rawValue);
  }
  return values;
}

function normalizeImportedCustomFieldValues(rawValues) {
  if (!rawValues || typeof rawValues !== "object") {
    return {};
  }

  const normalized = {};
  const fieldsByVarName = getDefinedCustomFieldsByVarName();
  for (const [varName, field] of fieldsByVarName.entries()) {
    if (!Object.prototype.hasOwnProperty.call(rawValues, varName)) {
      continue;
    }

    normalized[varName] = field.target === "everyone"
      ? parseEveryoneVarMap(rawValues[varName])
      : formatVariableValue(rawValues[varName]);
  }

  return normalized;
}

function applyImportedCustomFieldValues(context, values) {
  const normalized = values && typeof values === "object" ? values : {};
  const fieldsByVarName = getDefinedCustomFieldsByVarName();

  for (const [varName, field] of fieldsByVarName.entries()) {
    if (Object.prototype.hasOwnProperty.call(normalized, varName)) {
      const nextValue = field.target === "everyone"
        ? parseEveryoneVarMap(normalized[varName])
        : formatVariableValue(normalized[varName]);
      context.variables?.local?.set?.(varName, nextValue);
    } else {
      context.variables?.local?.set?.(varName, field.target === "everyone" ? {} : "");
    }
  }
}

function collectCharacterAvatars(data, context) {
  const avatarMap = readAvatarMap(context);
  const result = {};

  for (const character of Array.isArray(data?.characters) ? data.characters : []) {
    const key = getAvatarKeyForCharacterName(character?.name);
    if (!key || !avatarMap[key]) {
      continue;
    }
    result[key] = avatarMap[key];
  }

  return result;
}

function normalizeImportedCharacterAvatars(rawValues, data) {
  if (!rawValues || typeof rawValues !== "object") {
    return {};
  }

  const allowedNames = new Set(
    (Array.isArray(data?.characters) ? data.characters : [])
      .map((character) => getAvatarKeyForCharacterName(character?.name))
      .filter(Boolean),
  );

  const result = {};
  for (const [name, value] of Object.entries(rawValues)) {
    const key = getAvatarKeyForCharacterName(name);
    if (!key || !allowedNames.has(key) || typeof value !== "string" || !value.trim()) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

function applyImportedCharacterAvatars(context, avatars, data) {
  const nextMap = readAvatarMap(context);
  const allowedNames = new Set(
    (Array.isArray(data?.characters) ? data.characters : [])
      .map((character) => getAvatarKeyForCharacterName(character?.name))
      .filter(Boolean),
  );

  for (const name of allowedNames) {
    delete nextMap[name];
  }

  for (const [name, value] of Object.entries(avatars && typeof avatars === "object" ? avatars : {})) {
    const key = getAvatarKeyForCharacterName(name);
    if (!key || !allowedNames.has(key) || typeof value !== "string" || !value.trim()) {
      continue;
    }
    nextMap[key] = value;
  }

  writeAvatarMap(context, nextMap);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCurrentPersonaId(context) {
  const personaId = String(context?.user_avatar || globalUserAvatar || "").trim();
  return personaId || "";
}

function readPersonaCharacterMap(context) {
  const raw = context.variables?.global?.get?.(PERSONA_CHARACTER_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  return parsed;
}

function writePersonaCharacterMap(context, value) {
  const map = value && typeof value === "object" ? value : {};
  context.variables?.global?.set?.(PERSONA_CHARACTER_STORAGE_KEY, JSON.stringify(map));
}

function buildViewerPersonaPayload(data, context) {
  const viewerCharacter = data?.viewerCharacterId
    ? (data.characters || []).find((character) => character.id === data.viewerCharacterId) || null
    : null;

  if (!viewerCharacter) {
    return null;
  }

  const customFieldValues = {};
  for (const field of getCustomFieldsForCharacter(viewerCharacter, context)) {
    if (!field?.varName) {
      continue;
    }
    customFieldValues[field.varName] = formatVariableValue(field.value);
  }

  const avatarMap = readAvatarMap(context);
  const avatarKey = getAvatarKeyForCharacterName(viewerCharacter.name);
  const avatar = avatarKey && avatarMap[avatarKey] ? avatarMap[avatarKey] : getCharacterAvatarSource(viewerCharacter, context, avatarMap);

  return {
    character: cloneValue(viewerCharacter),
    customFieldValues,
    avatar: typeof avatar === "string" ? avatar : "",
    savedAt: Date.now(),
  };
}

async function handleSaveViewerToPersona() {
  const context = getContext();
  const personaId = getCurrentPersonaId(context);
  if (!personaId) {
    toastr.warning("No active persona selected.", "Character Details");
    return;
  }

  const payload = buildViewerPersonaPayload(state, context);
  if (!payload) {
    toastr.warning("Set viewer character first.", "Character Details");
    return;
  }

  const map = readPersonaCharacterMap(context);
  if (map[personaId]) {
    const shouldReplace = await Popup.show.confirm(
      "Replace saved persona character",
      "Current persona already has a saved character. It will be replaced.",
      { okButton: "Replace", cancelButton: "Cancel" },
    );
    if (!shouldReplace) {
      return;
    }
  }

  map[personaId] = payload;
  writePersonaCharacterMap(context, map);
  toastr.success("Viewer character saved to current persona.", "Character Details");
}

function upsertPersonaCharacterIntoState(data, context, personaEntry, options = {}) {
  const overwriteViewer = options.overwriteViewer === true;
  const sourceCharacter = personaEntry?.character;
  if (!sourceCharacter || typeof sourceCharacter !== "object") {
    return false;
  }

  const viewerCharacter = data.viewerCharacterId
    ? (data.characters || []).find((character) => character.id === data.viewerCharacterId) || null
    : null;

  let targetId = sourceCharacter.id;
  if (overwriteViewer && viewerCharacter) {
    targetId = viewerCharacter.id;
  }

  const normalized = normalizeCharacterDetails({
    characters: [{ ...cloneValue(sourceCharacter), id: targetId }],
  }, context);
  const nextCharacter = normalized.characters?.[0] || null;
  if (!nextCharacter) {
    return false;
  }

  if (overwriteViewer && viewerCharacter) {
    const index = data.characters.findIndex((character) => character.id === viewerCharacter.id);
    if (index !== -1) {
      data.characters[index] = nextCharacter;
      const oldAvatarKey = getAvatarKeyForCharacterName(viewerCharacter.name);
      const nextAvatarKey = getAvatarKeyForCharacterName(nextCharacter.name);
      if (oldAvatarKey && nextAvatarKey && oldAvatarKey !== nextAvatarKey) {
        const avatarMap = readAvatarMap(context);
        if (avatarMap[oldAvatarKey]) {
          delete avatarMap[oldAvatarKey];
          writeAvatarMap(context, avatarMap);
        }
      }
    } else {
      data.characters.push(nextCharacter);
    }
  } else {
    data.characters.push(nextCharacter);
  }

  data.viewerCharacterId = nextCharacter.id;
  data.activeCharacterId = nextCharacter.id;

  const nextAvatarKey = getAvatarKeyForCharacterName(nextCharacter.name);
  if (nextAvatarKey && typeof personaEntry.avatar === "string" && personaEntry.avatar.trim()) {
    const avatarMap = readAvatarMap(context);
    avatarMap[nextAvatarKey] = personaEntry.avatar;
    writeAvatarMap(context, avatarMap);
  }

  applyImportedCustomFieldValues(context, personaEntry.customFieldValues || {});
  ensureActiveCharacter(data);
  ensureActiveGroups(data);
  collapseOutfitsToActiveOnly(nextCharacter);
  return true;
}

async function handleAddCharacterFromPersona() {
  const context = getContext();
  const personaId = getCurrentPersonaId(context);
  if (!personaId) {
    toastr.warning("No active persona selected.", "Character Details");
    return;
  }

  const map = readPersonaCharacterMap(context);
  const entry = map[personaId];
  if (!entry?.character) {
    toastr.warning("No saved character for current persona.", "Character Details");
    return;
  }

  const hasViewer = Boolean(state.viewerCharacterId && state.characters.some((character) => character.id === state.viewerCharacterId));
  if (hasViewer) {
    const shouldOverwrite = await Popup.show.confirm(
      "Overwrite viewer character",
      "Viewer character already exists and will be overwritten.",
      { okButton: "Overwrite", cancelButton: "Cancel" },
    );
    if (!shouldOverwrite) {
      return;
    }
  }

  const updated = upsertPersonaCharacterIntoState(state, context, entry, { overwriteViewer: hasViewer });
  if (!updated) {
    toastr.error("Failed to load character from persona.", "Character Details");
    return;
  }

  saveAndRender();
  toastr.success("Character loaded from persona.", "Character Details");
}

function autoAddCharacterFromPersonaIfExists(data, context) {
  if (!shouldAutoAddPersonaCharacter()) {
    return false;
  }

  if (Array.isArray(data?.characters) && data.characters.length > 0) {
    return false;
  }

  const personaId = getCurrentPersonaId(context);
  if (!personaId) {
    return false;
  }

  const map = readPersonaCharacterMap(context);
  const entry = map[personaId];
  if (!entry?.character) {
    return false;
  }

  return upsertPersonaCharacterIntoState(data, context, entry, { overwriteViewer: false });
}

function sanitizeExportFileName(value) {
  const cleaned = String(value || "character-details")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");

  return cleaned || "character-details";
}

function triggerJsonDownload(fileName, payload) {
  const jsonText = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleExportCharacterDetails() {
  const context = getContext();
  const chatId = context?.getCurrentChatId?.();
  if (!chatId) {
    toastr.warning("Open a chat before exporting.", "Character Details");
    return;
  }

  const dataToExport = loadCharacterDetails(context);
  const payload = {
    ...dataToExport,
    customFieldValues: collectCustomFieldValues(context),
    avatars: collectCharacterAvatars(dataToExport, context),
  };
  const fileName = sanitizeExportFileName(`character-details-${chatId}`);
  triggerJsonDownload(fileName, payload);
  toastr.success("Character details exported.", "Character Details");
}

async function readImportFile() {
  return await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const onChange = () => {
      const file = input.files?.[0] || null;
      cleanup();
      resolve(file);
    };

    input.addEventListener("change", onChange, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function handleImportCharacterDetails() {
  const context = getContext();
  const chatId = context?.getCurrentChatId?.();
  if (!chatId) {
    toastr.warning("Open a chat before importing.", "Character Details");
    return;
  }

  try {
    const file = await readImportFile();
    if (!file) {
      return;
    }

    const rawText = await file.text();
    const parsed = JSON.parse(rawText);
    const importedData = normalizeCharacterDetails(parsed, context);
    const currentData = loadCharacterDetails(context);
    const currentCustomFieldValues = collectCustomFieldValues(context);
    const currentAvatars = collectCharacterAvatars(currentData, context);
    const hasImportedCustomFieldValues = Object.prototype.hasOwnProperty.call(parsed || {}, "customFieldValues");
    const hasImportedAvatars = Object.prototype.hasOwnProperty.call(parsed || {}, "avatars");
    const importedCustomFieldValues = hasImportedCustomFieldValues
      ? normalizeImportedCustomFieldValues(parsed.customFieldValues)
      : currentCustomFieldValues;
    const importedAvatars = hasImportedAvatars
      ? normalizeImportedCharacterAvatars(parsed.avatars, importedData)
      : currentAvatars;

    const currentPayload = {
      ...currentData,
      customFieldValues: currentCustomFieldValues,
      avatars: currentAvatars,
    };

    const importedPayload = {
      ...importedData,
      customFieldValues: importedCustomFieldValues,
      avatars: importedAvatars,
    };

    showCharacterDetailsDiff(currentPayload, importedPayload, (nextData) => {
      const { customFieldValues, avatars, ...nextCharacterData } = nextData || {};
      applyImportedCustomFieldValues(context, customFieldValues);
      applyImportedCharacterAvatars(context, avatars, nextCharacterData);
      for (const character of Array.isArray(nextCharacterData?.characters) ? nextCharacterData.characters : []) {
        collapseOutfitsToActiveOnly(character);
      }
      setCharacterDetailsData(nextCharacterData);
      toastr.success("Character details imported.", "Character Details");
    });
  } catch (error) {
    toastr.error(`Import failed: ${error?.message || "Invalid JSON file"}`, "Character Details");
  }
}

function renderModsPanelVisibility() {
  if (!modsPanelContainerRoot?.length || !mobileDrawerLeftToggleButton?.length) {
    return;
  }

  const visible = shouldShowModsPanel();
  modsPanelContainerRoot.toggleClass("is-hidden", !visible);
  mobileDrawerLeftToggleButton.toggleClass("displayNone", !visible);

  if (!visible) {
    openModImageTypesForId = null;
    openModPositionForId = null;
    openModGroupForId = null;
    return;
  }

  renderLeftDrawerState();
  renderModsPositionFilterState();
  renderModsPanel();
}

function renderModsPositionFilterState() {
  if (!modsPositionFilterRoot?.length) {
    return;
  }

  const filterValue = normalizeModsPanelPositionFilter(modsPanelPositionFilter);
  modsPositionFilterRoot
    .find("[data-mods-filter]")
    .each((_, element) => {
      const button = $(element);
      const buttonFilter = normalizeModsPanelPositionFilter(button.data("modsFilter"));
      const active = buttonFilter === filterValue;
      button.toggleClass("is-active", active);
      button.attr("aria-pressed", active ? "true" : "false");
      button.attr("tabindex", active ? "0" : "-1");
    });
}

function getEnabledModImageTypeCount(mod) {
  return MOD_IMAGE_TYPE_DEFINITIONS
    .filter((definition) => mod?.imageTypes?.[definition.key] !== false)
    .length;
}

function getModImageTypesButtonTitle(mod) {
  const enabledLabels = MOD_IMAGE_TYPE_DEFINITIONS
    .filter((definition) => mod?.imageTypes?.[definition.key] !== false)
    .map((definition) => definition.label);

  if (enabledLabels.length === MOD_IMAGE_TYPE_DEFINITIONS.length) {
    return "Active for all image types";
  }

  if (enabledLabels.length === 0) {
    return "Active for no image types";
  }

  return `Active for: ${enabledLabels.join(", ")}`;
}

function renderModsPanel() {
  if (!modsPanelRoot?.length) {
    return;
  }

  if (!shouldShowModsPanel()) {
    modsPanelRoot.empty();
    return;
  }

  const useTallLayout = isMobileDrawerMode() || shouldUseTallModsInDesktopMode();
  modsPanelRoot.toggleClass("is-tall-layout", useTallLayout);

  const context = getContext();
  const mods = getVisibleModsForCurrentChat(getModsSettings(context), context);
  if (!mods.length) {
    modsPanelRoot.html('<div class="character-mods-panel__empty">No mods yet. Use + to add one.</div>');
    return;
  }

  const filterValue = normalizeModsPanelPositionFilter(modsPanelPositionFilter);
  const visibleMods = mods.filter((mod) => {
    if (filterValue === MODS_PANEL_FILTER_ALL) {
      return true;
    }

    return normalizeModPosition(mod.position) === filterValue;
  });

  if (openModImageTypesForId && !visibleMods.some((mod) => mod.id === openModImageTypesForId)) {
    openModImageTypesForId = null;
  }

  if (openModPositionForId && !visibleMods.some((mod) => mod.id === openModPositionForId)) {
    openModPositionForId = null;
  }

  if (openModGroupForId && !visibleMods.some((mod) => mod.id === openModGroupForId)) {
    openModGroupForId = null;
  }

  if (!visibleMods.length) {
    modsPanelRoot.html(`<div class="character-mods-panel__empty">No mods in ${escapeHtml(getModsPanelFilterLabel(filterValue))}.</div>`);
    return;
  }

  const html = visibleMods.map((mod) => {
    const groupEntry = isModGroup(mod);
    const selectedItem = getSelectedModItem(mod);
    const displayedShortname = groupEntry
      ? `${String(mod.groupName || "Group").trim()} - ${String(selectedItem?.shortname || "Unnamed").trim() || "Unnamed"}`
      : String(mod.shortname || "").trim() || "Unnamed";
    const enabledTypesCount = getEnabledModImageTypeCount(mod);
    const allTypesEnabled = enabledTypesCount === MOD_IMAGE_TYPE_DEFINITIONS.length;
    const typesPopupOpen = openModImageTypesForId === mod.id;
    const groupPopupOpen = openModGroupForId === mod.id;
    const position = normalizeModPosition(mod.position);
    const positionDefinition = getModPositionDefinition(position);
    const positionPopupOpen = openModPositionForId === mod.id;
    const stateScopeLabel = mod.stateScope === MOD_STATE_SCOPE_LOCAL ? "local" : "global";
    const afterCharName = normalizeModAfterCharName(mod.afterCharName);
    const afterCharMatch = findCharacterByName(state, afterCharName);
    const afterCharInvalid = position === MOD_POSITION_AFTER_CHAR && !afterCharMatch;

    const typeButtons = MOD_IMAGE_TYPE_DEFINITIONS.map((definition) => {
      const typeEnabled = mod.imageTypes?.[definition.key] !== false;
      return `
        <button
          type="button"
          class="mod-item__image-type ${typeEnabled ? "" : "is-disabled"}"
          data-action="toggle-mod-image-type"
          data-mod-id="${escapeHtml(mod.id)}"
          data-image-type="${escapeHtml(definition.key)}"
          title="${escapeHtml(definition.label)}"
        >
          <i class="fa-solid ${definition.icon}"></i>
        </button>
      `;
    }).join("");

    const positionOptions = MOD_POSITION_DEFINITIONS.map((definition) => {
      const selected = position === definition.key;
      return `
        <button
          type="button"
          class="mod-item__position-option ${selected ? "is-active" : ""}"
          data-action="set-mod-position"
          data-mod-id="${escapeHtml(mod.id)}"
          data-position="${escapeHtml(definition.key)}"
          title="${escapeHtml(definition.label)}"
        >
          <i class="fa-solid ${definition.icon}"></i>
          <span>${escapeHtml(definition.label)}</span>
        </button>
      `;
    }).join("");

    const groupOptions = (Array.isArray(mod.items) ? mod.items : []).map((item) => {
      const selected = item.id === selectedItem?.id;
      return `
        <button
          type="button"
          class="mod-item__group-option ${selected ? "is-active" : ""}"
          data-action="select-mod-group-item"
          data-mod-id="${escapeHtml(mod.id)}"
          data-item-id="${escapeHtml(item.id)}"
          title="${escapeHtml(item.shortname)}"
        >
          ${escapeHtml(item.shortname)}
        </button>
      `;
    }).join("");

    const shortnameControl = groupEntry
      ? `
        <div class="mod-item__group-wrap">
          <button
            type="button"
            class="menu_button mod-item__group-trigger"
            data-action="toggle-mod-group-menu"
            data-mod-id="${escapeHtml(mod.id)}"
            title="Select active group mod"
          >
            <span class="mod-item__group-trigger-label">${escapeHtml(displayedShortname)}</span>
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <div class="mod-item__group-popup ${groupPopupOpen ? "is-open" : ""}">
            ${groupOptions}
          </div>
        </div>
      `
      : `
        <div
          class="mod-item__shortname"
          title="${escapeHtml(displayedShortname)}"
        >${escapeHtml(displayedShortname)}</div>
      `;

    const primaryLabelControl = position === MOD_POSITION_AFTER_CHAR
      ? `
        <div class="mod-item__name-pair">
          <input
            class="text_pole mod-item__charname-input ${afterCharInvalid ? "is-invalid" : ""}"
            type="text"
            value="${escapeHtml(afterCharName)}"
            data-field="mod-after-char-name"
            data-mod-id="${escapeHtml(mod.id)}"
            title="${afterCharInvalid ? "Character not found in this chat" : "Character name for after-char mod"}"
          />
          ${shortnameControl}
        </div>
      `
      : shortnameControl;

    const secondaryActionConfig = groupEntry
      ? { action: "add-mod-to-group", title: "Add mod to group", icon: "fa-plus" }
      : { action: "convert-mod-to-group", title: "Convert to group", icon: "fa-layer-group" };

    const secondaryActionButton = `
      <button
        type="button"
        class="mod-item__action"
        data-action="${secondaryActionConfig.action}"
        data-mod-id="${escapeHtml(mod.id)}"
        title="${secondaryActionConfig.title}"
      >
        <i class="fa-solid ${secondaryActionConfig.icon}"></i>
      </button>
    `;

    const rowClass = [
      "mod-item",
      groupEntry ? "mod-item--group" : "",
      mod.characterId ? "mod-item--character" : "",
      position === MOD_POSITION_AFTER_CHAR ? "mod-item--after-char" : "",
    ].filter(Boolean).join(" ");

    if (useTallLayout) {
      const afterCharInput = position === MOD_POSITION_AFTER_CHAR
        ? `
          <input
            class="text_pole mod-item__charname-input mod-item__charname-input--tall ${afterCharInvalid ? "is-invalid" : ""}"
            type="text"
            value="${escapeHtml(afterCharName)}"
            data-field="mod-after-char-name"
            data-mod-id="${escapeHtml(mod.id)}"
            title="${afterCharInvalid ? "Character not found in this chat" : "Character name for after-char mod"}"
          />
        `
        : '<div class="mod-item__charname-placeholder"></div>';

      return `
        <div class="${rowClass}" data-mod-id="${escapeHtml(mod.id)}">
          <div class="st-mod-item__tall-row-top">
            <span class="mod-item__drag-handle" draggable="true" title="Drag to reorder">
              <i class="fa-solid fa-grip-vertical"></i>
            </span>
            <button
              type="button"
              class="mod-item__led ${mod.enabled ? "is-enabled" : ""}"
              data-action="toggle-mod-enabled"
              data-mod-id="${escapeHtml(mod.id)}"
              title="${mod.enabled ? "Disable mod" : "Enable mod"} (${stateScopeLabel} state)"
            >
              <i class="fa-solid fa-circle"></i>
            </button>
            <div class="mod-item__types-wrap">
              <button
                type="button"
                class="menu_button mod-item__image-types-button ${allTypesEnabled ? "" : "is-filtered"}"
                data-action="toggle-mod-image-types"
                data-mod-id="${escapeHtml(mod.id)}"
                title="${escapeHtml(getModImageTypesButtonTitle(mod))}"
              >
                <i class="fa-solid fa-images"></i>
              </button>
              <div class="mod-item__image-types-popup ${typesPopupOpen ? "is-open" : ""}">
                ${typeButtons}
              </div>
            </div>
            <div class="mod-item__position-wrap">
              <button
                type="button"
                class="menu_button mod-item__position-trigger"
                data-action="toggle-mod-position-menu"
                data-mod-id="${escapeHtml(mod.id)}"
                title="${escapeHtml(positionDefinition.label)}"
              >
                <i class="fa-solid ${positionDefinition.icon}"></i>
              </button>
              <div class="mod-item__position-popup ${positionPopupOpen ? "is-open" : ""}">
                ${positionOptions}
              </div>
            </div>
            ${afterCharInput}
          </div>
          <div class="st-mod-item__tall-row-bottom">
            <div class="mod-item__shortname-slot">${shortnameControl}</div>
            <button
              type="button"
              class="mod-item__action mod-item__action--edit"
              data-action="edit-mod-entry"
              data-mod-id="${escapeHtml(mod.id)}"
              title="Edit mod"
            >
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button
              type="button"
              class="mod-item__action mod-item__action--secondary"
              data-action="${secondaryActionConfig.action}"
              data-mod-id="${escapeHtml(mod.id)}"
              title="${secondaryActionConfig.title}"
            >
              <i class="fa-solid ${secondaryActionConfig.icon}"></i>
            </button>
            <button
              type="button"
              class="mod-item__action mod-item__action--delete"
              data-action="delete-mod"
              data-mod-id="${escapeHtml(mod.id)}"
              title="Delete mod"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="${rowClass}" data-mod-id="${escapeHtml(mod.id)}">
        <span class="mod-item__drag-handle" draggable="true" title="Drag to reorder">
          <i class="fa-solid fa-grip-vertical"></i>
        </span>
        <button
          type="button"
          class="mod-item__led ${mod.enabled ? "is-enabled" : ""}"
          data-action="toggle-mod-enabled"
          data-mod-id="${escapeHtml(mod.id)}"
          title="${mod.enabled ? "Disable mod" : "Enable mod"} (${stateScopeLabel} state)"
        >
          <i class="fa-solid fa-circle"></i>
        </button>
        <div class="mod-item__types-wrap">
          <button
            type="button"
            class="menu_button mod-item__image-types-button ${allTypesEnabled ? "" : "is-filtered"}"
            data-action="toggle-mod-image-types"
            data-mod-id="${escapeHtml(mod.id)}"
            title="${escapeHtml(getModImageTypesButtonTitle(mod))}"
          >
            <i class="fa-solid fa-images"></i>
          </button>
          <div class="mod-item__image-types-popup ${typesPopupOpen ? "is-open" : ""}">
            ${typeButtons}
          </div>
        </div>
        <div class="mod-item__position-wrap">
          <button
            type="button"
            class="menu_button mod-item__position-trigger"
            data-action="toggle-mod-position-menu"
            data-mod-id="${escapeHtml(mod.id)}"
            title="${escapeHtml(positionDefinition.label)}"
          >
            <i class="fa-solid ${positionDefinition.icon}"></i>
          </button>
          <div class="mod-item__position-popup ${positionPopupOpen ? "is-open" : ""}">
            ${positionOptions}
          </div>
        </div>
        ${primaryLabelControl}
        <button
          type="button"
          class="mod-item__action"
          data-action="edit-mod-entry"
          data-mod-id="${escapeHtml(mod.id)}"
          title="Edit mod"
        >
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        ${secondaryActionButton}
        <button
          type="button"
          class="mod-item__action"
          data-action="delete-mod"
          data-mod-id="${escapeHtml(mod.id)}"
          title="Delete mod"
        >
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
  }).join("");

  modsPanelRoot.html(html);
  renderLeftDrawerState();
}

function clearModDragIndicators() {
  modsPanelRoot?.find(".mod-item")
    .removeClass("drop-before drop-after drop-into")
    .each((_, element) => {
      delete element.dataset.dropMode;
    });
}

function resolveModItemElement(event) {
  const target = event?.target;
  if (!target?.closest) {
    return null;
  }

  return target.closest(".mod-item");
}

function resolveModDropMode(modItemElement, mods, draggedId, nativeEvent) {
  const targetId = String(modItemElement?.dataset?.modId || "").trim();
  if (!targetId || !draggedId || targetId === draggedId) {
    return null;
  }

  const draggedMod = mods.find((mod) => mod.id === draggedId);
  const targetMod = mods.find((mod) => mod.id === targetId);
  if (!draggedMod || !targetMod) {
    return null;
  }

  const rect = modItemElement.getBoundingClientRect();
  const pointerY = Number.isFinite(nativeEvent?.clientY) ? nativeEvent.clientY : (rect.top + rect.height / 2);
  const offsetY = pointerY - rect.top;
  const ratio = rect.height > 0 ? offsetY / rect.height : 0.5;

  if (isModGroup(targetMod) && !isModGroup(draggedMod)) {
    if (ratio >= 0.25 && ratio <= 0.75) {
      return "into";
    }

    return ratio < 0.25 ? "before" : "after";
  }

  return ratio <= 0.5 ? "before" : "after";
}

function getModById(modId) {
  return getModsSettings().find((mod) => mod.id === modId) || null;
}

function handleModsPositionFilterClick(event) {
  const actionOwner = event.target.closest("[data-mods-filter]");
  if (!actionOwner) {
    return;
  }

  const nextFilter = normalizeModsPanelPositionFilter(actionOwner.dataset.modsFilter);
  if (modsPanelPositionFilter === nextFilter) {
    return;
  }

  modsPanelPositionFilter = nextFilter;
  openModImageTypesForId = null;
  openModPositionForId = null;
  openModGroupForId = null;
  renderModsPositionFilterState();
  renderModsPanel();
}

function getDefaultAfterCharName() {
  const activeCharacter = getActiveCharacter(state || {});
  return String(activeCharacter?.name || "").trim();
}

function resolveCharacterModAssignment(shouldBindToCharacter, existingCharacterId = "") {
  if (!shouldBindToCharacter) {
    return "";
  }

  const currentCharacterId = getCurrentChatCharacterCardId(getContext());
  if (currentCharacterId) {
    return currentCharacterId;
  }

  const fallbackCharacterId = normalizeModCharacterCardId(existingCharacterId);
  if (fallbackCharacterId) {
    return fallbackCharacterId;
  }

  toastr.warning("Character mod could not be assigned because there is no active character-card chat.", "Character Details");
  return "";
}

function setLocalModEnabledState(modId, enabled) {
  const context = getContext();
  const localState = cleanupModsLocalState(context, getNormalizedModsSettings());
  const normalizedModId = String(modId || "").trim();
  if (!normalizedModId) {
    return;
  }

  localState.enabledByModId[normalizedModId] = enabled === true;
  writeModsLocalState(context, localState);
}

function setLocalGroupSelectedItem(modId, itemId) {
  const context = getContext();
  const localState = cleanupModsLocalState(context, getNormalizedModsSettings());
  const normalizedModId = String(modId || "").trim();
  const normalizedItemId = String(itemId || "").trim();
  if (!normalizedModId) {
    return;
  }

  if (normalizedItemId) {
    localState.selectedItemByGroupModId[normalizedModId] = normalizedItemId;
  } else {
    delete localState.selectedItemByGroupModId[normalizedModId];
  }

  writeModsLocalState(context, localState);
}

async function showModItemEditorPopup({
  title,
  okButton,
  shortnameValue = "",
  detailsValue = "",
  includeGroupName = false,
  initialGroupName = "",
  includeModSettings = true,
  initialCharacterMod = false,
  initialLocalState = false,
} = {}) {
  let nextGroupName = String(initialGroupName || "").trim();
  let nextShortname = String(shortnameValue || "").trim();
  let nextDetails = String(detailsValue || "").replace(/\r\n?/g, "\n").trim();
  let nextCharacterMod = initialCharacterMod === true;
  let nextLocalState = initialLocalState === true;

  while (true) {
    const customInputs = [];

    if (includeGroupName) {
      customInputs.push({
        id: "st_extension_mod_group_name",
        label: "Group name",
        type: "text",
        defaultState: nextGroupName,
      });
    }

    customInputs.push(
      {
        id: "st_extension_mod_shortname",
        label: "Shortname",
        type: "text",
        defaultState: nextShortname,
      },
      {
        id: "st_extension_mod_details",
        label: "Details",
        type: "textarea",
        rows: 8,
        defaultState: nextDetails,
      },
    );

    if (includeModSettings) {
      customInputs.push(
        {
          id: "st_extension_mod_character_mod",
          label: "Character mod (bind to current character-card chat)",
          type: "checkbox",
          defaultState: nextCharacterMod,
        },
        {
          id: "st_extension_mod_local_state",
          label: "Local state (unchecked = global state)",
          type: "checkbox",
          defaultState: nextLocalState,
        },
      );
    }

    const popup = new Popup(
      `<h3>${escapeHtml(title || "Edit mod")}</h3>`,
      POPUP_TYPE.TEXT,
      "",
      {
        okButton: okButton || "Save",
        cancelButton: "Cancel",
        leftAlign: true,
        customInputs,
      },
    );

    await popup.show();
    if (popup.result !== 1) {
      return null;
    }

    const groupNameInput = includeGroupName
      ? normalizeRequiredModShortname(popup.inputResults?.get("st_extension_mod_group_name"))
      : "";
    const shortnameInput = normalizeRequiredModShortname(popup.inputResults?.get("st_extension_mod_shortname"));
    const detailsInput = String(popup.inputResults?.get("st_extension_mod_details") || "")
      .replace(/\r\n?/g, "\n")
      .trim();
    const characterModInput = includeModSettings
      ? Boolean(popup.inputResults?.get("st_extension_mod_character_mod"))
      : false;
    const localStateInput = includeModSettings
      ? Boolean(popup.inputResults?.get("st_extension_mod_local_state"))
      : false;

    if (includeGroupName && !groupNameInput) {
      toastr.warning("Group name is required.", "Character Details");
      nextShortname = shortnameInput;
      nextDetails = detailsInput;
      nextCharacterMod = characterModInput;
      nextLocalState = localStateInput;
      continue;
    }

    if (!shortnameInput) {
      toastr.warning("Shortname is required.", "Character Details");
      nextGroupName = groupNameInput;
      nextDetails = detailsInput;
      nextCharacterMod = characterModInput;
      nextLocalState = localStateInput;
      continue;
    }

    return {
      groupName: groupNameInput,
      shortname: shortnameInput,
      fullContent: detailsInput,
      characterMod: characterModInput,
      localState: localStateInput,
    };
  }
}

async function handleAddMod() {
  const edited = await showModItemEditorPopup({
    title: "Create mod",
    okButton: "Add",
    shortnameValue: "",
    detailsValue: "",
    includeModSettings: true,
    initialCharacterMod: false,
    initialLocalState: false,
  });

  if (!edited) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const characterId = resolveCharacterModAssignment(edited.characterMod === true, "");
  mods.push({
    id: createModId(),
    type: MOD_ENTRY_TYPE_SINGLE,
    enabled: true,
    position: MOD_POSITION_MIDDLE,
    shortname: edited.shortname,
    fullContent: edited.fullContent,
    imageTypes: createDefaultModImageTypes(),
    stateScope: edited.localState ? MOD_STATE_SCOPE_LOCAL : MOD_STATE_SCOPE_GLOBAL,
    characterId,
    afterCharName: "",
  });
  saveModsSettings(mods);
}

function handleModEnabledToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  const mod = mods[index];
  const effectiveMod = getModsSettings().find((item) => item.id === modId) || mod;
  const nextEnabled = !Boolean(effectiveMod?.enabled);
  if (mod.stateScope === MOD_STATE_SCOPE_LOCAL) {
    setLocalModEnabledState(modId, nextEnabled);
    renderModsPanel();
    return;
  }

  mods[index].enabled = nextEnabled;
  saveModsSettings(mods);
}

function handleModImageTypesMenuToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  openModPositionForId = null;
  openModGroupForId = null;
  openModImageTypesForId = openModImageTypesForId === modId ? null : modId;
  renderModsPanel();
}

function handleModPositionMenuToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  openModImageTypesForId = null;
  openModGroupForId = null;
  openModPositionForId = openModPositionForId === modId ? null : modId;
  renderModsPanel();
}

function handleModGroupMenuToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  openModImageTypesForId = null;
  openModPositionForId = null;
  openModGroupForId = openModGroupForId === modId ? null : modId;
  renderModsPanel();
}

function handleModGroupItemSelect(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  const itemId = String(actionOwner?.dataset?.itemId || "").trim();
  if (!modId || !itemId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1 || !isModGroup(mods[index])) {
    return;
  }

  const items = Array.isArray(mods[index].items) ? mods[index].items : [];
  if (!items.some((item) => item.id === itemId)) {
    return;
  }

  if (mods[index].stateScope === MOD_STATE_SCOPE_LOCAL) {
    setLocalGroupSelectedItem(modId, itemId);
    openModGroupForId = null;
    renderModsPanel();
    return;
  }

  mods[index].selectedItemId = itemId;
  openModGroupForId = null;
  saveModsSettings(mods);
}

function handleModImageTypeToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  const imageType = String(actionOwner?.dataset?.imageType || "").trim();
  if (!modId || !imageType) {
    return;
  }

  if (!MOD_IMAGE_TYPE_DEFINITIONS.some((definition) => definition.key === imageType)) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  const nextImageTypes = normalizeModImageTypes(mods[index].imageTypes);
  nextImageTypes[imageType] = !nextImageTypes[imageType];
  mods[index].imageTypes = nextImageTypes;
  openModImageTypesForId = modId;
  saveModsSettings(mods);
}

function handleModPositionChange(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  const nextPosition = normalizeModPosition(actionOwner?.dataset?.position || actionOwner?.value);
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  mods[index].position = nextPosition;
  if (nextPosition === MOD_POSITION_AFTER_CHAR && !normalizeModAfterCharName(mods[index].afterCharName)) {
    mods[index].afterCharName = getDefaultAfterCharName();
  }
  openModPositionForId = null;
  saveModsSettings(mods);
}

async function handleConvertModToGroup(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1 || isModGroup(mods[index])) {
    return;
  }

  const groupNameInput = await Popup.show.input(
    "Convert to group",
    "Enter name for this group:",
    mods[index].shortname,
    { okButton: "Convert", cancelButton: "Cancel", rows: 1 },
  );

  if (groupNameInput === null) {
    return;
  }

  const groupName = normalizeRequiredModShortname(groupNameInput);
  if (!groupName) {
    toastr.warning("Group name is required.", "Character Details");
    return;
  }

  const source = mods[index];
  const groupItem = normalizeModItemEntry({
    shortname: source.shortname,
    fullContent: source.fullContent,
  });

  mods[index] = normalizeModEntry({
    ...source,
    type: MOD_ENTRY_TYPE_GROUP,
    groupName,
    items: [groupItem],
    selectedItemId: groupItem.id,
  });
  openModGroupForId = null;
  saveModsSettings(mods);
}

async function handleAddModToGroup(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1 || !isModGroup(mods[index])) {
    return;
  }

  const edited = await showModItemEditorPopup({
    title: "Add mod to group",
    okButton: "Add",
    shortnameValue: "",
    detailsValue: "",
    includeModSettings: false,
  });

  if (!edited) {
    return;
  }

  const nextItem = normalizeModItemEntry({
    shortname: edited.shortname,
    fullContent: edited.fullContent,
  });
  mods[index].items = Array.isArray(mods[index].items) ? mods[index].items : [];
  mods[index].items.push(nextItem);
  mods[index].selectedItemId = nextItem.id;
  openModGroupForId = null;
  saveModsSettings(mods);
}

async function handleModEntryEdit(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  const mod = mods[index];
  const previousStateScope = mod.stateScope;
  const effectiveModBeforeEdit = getModsSettings().find((item) => item.id === modId) || mod;
  const editingGroupItem = isModGroup(effectiveModBeforeEdit)
    ? getSelectedModItem(effectiveModBeforeEdit)
    : null;
  const edited = await showModItemEditorPopup({
    title: isModGroup(mod) ? "Edit selected group mod" : "Edit mod",
    okButton: "Save",
    shortnameValue: isModGroup(mod) ? editingGroupItem?.shortname : mod.shortname,
    detailsValue: isModGroup(mod) ? editingGroupItem?.fullContent : mod.fullContent,
    includeGroupName: isModGroup(mod),
    initialGroupName: isModGroup(mod) ? mod.groupName : "",
    includeModSettings: true,
    initialCharacterMod: Boolean(normalizeModCharacterCardId(mod.characterId)),
    initialLocalState: mod.stateScope === MOD_STATE_SCOPE_LOCAL,
  });

  if (!edited) {
    return;
  }

  if (isModGroup(mod)) {
    if (!editingGroupItem) {
      return;
    }

    mod.groupName = deriveModGroupName(edited.groupName);

    mod.items = (Array.isArray(mod.items) ? mod.items : []).map((item) => {
      if (item.id !== editingGroupItem.id) {
        return item;
      }

      return normalizeModItemEntry({
        ...item,
        shortname: edited.shortname,
        fullContent: edited.fullContent,
      });
    });
  } else {
    mod.shortname = edited.shortname;
    mod.fullContent = edited.fullContent;
  }

  mod.characterId = resolveCharacterModAssignment(edited.characterMod === true, mod.characterId);
  mod.stateScope = edited.localState ? MOD_STATE_SCOPE_LOCAL : MOD_STATE_SCOPE_GLOBAL;

  if (previousStateScope !== MOD_STATE_SCOPE_LOCAL && mod.stateScope === MOD_STATE_SCOPE_LOCAL) {
    // One-time copy on conversion global -> local for current chat only.
    seedCurrentChatLocalStateFromMod(mods, mod, effectiveModBeforeEdit);
  }

  saveModsSettings(mods);
}

async function handleModDelete(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  const mod = mods[index];
  if (!isModGroup(mod)) {
    const confirmed = await Popup.show.confirm(
      "Delete mod",
      "Are you sure you want to delete this mod?",
      { okButton: "Delete", cancelButton: "Cancel" },
    );

    if (!confirmed) {
      return;
    }

    const nextMods = mods.filter((item) => item.id !== modId);
    if (openModImageTypesForId === modId) {
      openModImageTypesForId = null;
    }
    if (openModPositionForId === modId) {
      openModPositionForId = null;
    }
    if (openModGroupForId === modId) {
      openModGroupForId = null;
    }
    saveModsSettings(nextMods);
    return;
  }

  const effectiveMod = getModsSettings().find((item) => item.id === modId) || mod;
  const selectedItem = isModGroup(effectiveMod) ? getSelectedModItem(effectiveMod) : null;
  if (!selectedItem) {
    return;
  }

  const itemCount = Array.isArray(mod.items) ? mod.items.length : 0;
  const deleteMessage = itemCount <= 1
    ? "Are you sure you want to delete selected mod from this group? If you remove this mod whole group will be removed"
    : "Are you sure you want to delete selected mod from this group?";

  const confirmed = await Popup.show.confirm(
    "Delete selected group mod",
    deleteMessage,
    { okButton: "Delete", cancelButton: "Cancel" },
  );

  if (!confirmed) {
    return;
  }

  if (itemCount <= 1) {
    const nextMods = mods.filter((item) => item.id !== modId);
    if (openModImageTypesForId === modId) {
      openModImageTypesForId = null;
    }
    if (openModPositionForId === modId) {
      openModPositionForId = null;
    }
    if (openModGroupForId === modId) {
      openModGroupForId = null;
    }
    saveModsSettings(nextMods);
    return;
  }

  const selectedIndex = mod.items.findIndex((item) => item.id === selectedItem.id);
  if (selectedIndex === -1) {
    return;
  }
  mod.items.splice(selectedIndex, 1);
  const nextSelection = mod.items[Math.min(selectedIndex, mod.items.length - 1)] || mod.items[0];
  mod.selectedItemId = nextSelection?.id || "";
  saveModsSettings(mods);
}

function handleModDragStart(event) {
  const dragOrigin = event.target;
  const dragHandle = dragOrigin?.closest?.(".mod-item__drag-handle");
  const nativeEvent = event.originalEvent || event;

  if (!dragHandle) {
    if (nativeEvent.dataTransfer) {
      nativeEvent.dataTransfer.effectAllowed = "none";
    }
    event.preventDefault();
    return;
  }

  const modItemElement = dragHandle.closest(".mod-item");
  const modId = String(modItemElement?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  draggedModId = modId;
  if (nativeEvent.dataTransfer) {
    nativeEvent.dataTransfer.setData("text/plain", modId);
    nativeEvent.dataTransfer.effectAllowed = "move";
  }

  modItemElement.classList.add("is-dragging");
}

function handleModDragOver(event) {
  if (!draggedModId) {
    return;
  }

  const modItemElement = resolveModItemElement(event);
  if (!modItemElement) {
    return;
  }

  const targetModId = String(modItemElement.dataset.modId || "").trim();
  if (!targetModId || targetModId === draggedModId) {
    return;
  }

  event.preventDefault();
  const nativeEvent = event.originalEvent || event;
  const mods = getNormalizedModsSettings();
  const dropMode = resolveModDropMode(modItemElement, mods, draggedModId, nativeEvent);
  if (!dropMode) {
    return;
  }

  clearModDragIndicators();
  modItemElement.dataset.dropMode = dropMode;
  if (dropMode === "before") {
    modItemElement.classList.add("drop-before");
  } else if (dropMode === "after") {
    modItemElement.classList.add("drop-after");
  } else if (dropMode === "into") {
    modItemElement.classList.add("drop-into");
  }
}

function handleModDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const modItemElement = resolveModItemElement(event);
  if (!modItemElement) {
    return;
  }

  const nativeEvent = event.originalEvent || event;
  const draggedId = String(nativeEvent.dataTransfer?.getData("text/plain") || draggedModId || "").trim();
  const targetId = String(modItemElement.dataset.modId || "").trim();
  if (!draggedId || !targetId || draggedId === targetId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const draggedIndex = mods.findIndex((mod) => mod.id === draggedId);
  const targetIndex = mods.findIndex((mod) => mod.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1) {
    return;
  }

  const dropMode = String(modItemElement.dataset.dropMode || resolveModDropMode(modItemElement, mods, draggedId, nativeEvent) || "").trim();
  const draggedModEntry = mods[draggedIndex];
  const targetMod = mods[targetIndex];

  if (dropMode === "into" && isModGroup(targetMod) && !isModGroup(draggedModEntry)) {
    void (async () => {
      const shouldConvert = await Popup.show.confirm(
        "Add to group",
        "Add this mod to a group(cannot be reversed)",
        { okButton: "Yes", cancelButton: "No" },
      );

      if (!shouldConvert) {
        clearModDragIndicators();
        return;
      }

      const nextMods = getNormalizedModsSettings();
      const nextDraggedIndex = nextMods.findIndex((mod) => mod.id === draggedId);
      const nextTargetIndex = nextMods.findIndex((mod) => mod.id === targetId);
      if (nextDraggedIndex === -1 || nextTargetIndex === -1) {
        return;
      }

      const [sourceMod] = nextMods.splice(nextDraggedIndex, 1);
      const adjustedTargetIndex = nextDraggedIndex < nextTargetIndex ? nextTargetIndex - 1 : nextTargetIndex;
      const targetGroup = nextMods[adjustedTargetIndex];
      if (!isModGroup(targetGroup)) {
        return;
      }

      const nextItem = normalizeModItemEntry({
        shortname: sourceMod.shortname,
        fullContent: sourceMod.fullContent,
      });

      targetGroup.items = Array.isArray(targetGroup.items) ? targetGroup.items : [];
      targetGroup.items.push(nextItem);
      targetGroup.selectedItemId = nextItem.id;

      openModImageTypesForId = null;
      openModPositionForId = null;
      openModGroupForId = null;
      saveModsSettings(nextMods);
    })();
    return;
  }

  const [draggedMod] = mods.splice(draggedIndex, 1);
  let insertIndex = targetIndex;

  if (draggedIndex < targetIndex) {
    insertIndex -= 1;
  }

  if (dropMode === "after") {
    insertIndex += 1;
  }

  insertIndex = Math.max(0, Math.min(mods.length, insertIndex));
  mods.splice(insertIndex, 0, draggedMod);
  openModImageTypesForId = null;
  openModPositionForId = null;
  openModGroupForId = null;
  saveModsSettings(mods);
}

function handleModDragEnd(event) {
  const modItemElement = resolveModItemElement(event);
  if (modItemElement) {
    modItemElement.classList.remove("is-dragging");
  }

  draggedModId = null;
  clearModDragIndicators();
}

function handleModPanelClick(event) {
  const actionOwner = event.target.closest("[data-action]");
  if (!actionOwner) {
    return;
  }

  const action = String(actionOwner.dataset.action || "").trim();
  if (!action) {
    return;
  }

  if (action === "toggle-mod-enabled") {
    handleModEnabledToggle(actionOwner);
    return;
  }

  if (action === "toggle-mod-image-types") {
    handleModImageTypesMenuToggle(actionOwner);
    return;
  }

  if (action === "toggle-mod-group-menu") {
    handleModGroupMenuToggle(actionOwner);
    return;
  }

  if (action === "select-mod-group-item") {
    handleModGroupItemSelect(actionOwner);
    return;
  }

  if (action === "toggle-mod-position-menu") {
    handleModPositionMenuToggle(actionOwner);
    return;
  }

  if (action === "set-mod-position") {
    handleModPositionChange(actionOwner);
    return;
  }

  if (action === "toggle-mod-image-type") {
    handleModImageTypeToggle(actionOwner);
    return;
  }

  if (action === "edit-mod-entry") {
    void handleModEntryEdit(actionOwner);
    return;
  }

  if (action === "convert-mod-to-group") {
    void handleConvertModToGroup(actionOwner);
    return;
  }

  if (action === "add-mod-to-group") {
    void handleAddModToGroup(actionOwner);
    return;
  }

  if (action === "delete-mod") {
    void handleModDelete(actionOwner);
    return;
  }
}

function handleModPanelChange(event) {
  const actionOwner = event.target.closest("[data-action]");
  if (!actionOwner) {
    return;
  }

  const action = String(actionOwner.dataset.action || "").trim();
  if (action === "set-mod-position") {
    handleModPositionChange(actionOwner);
  }
}

function handleModPanelInput(event) {
  const target = event.target;
  if (!target || target.dataset?.field !== "mod-after-char-name") {
    return;
  }

  const modId = String(target.dataset.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  mods[index].afterCharName = normalizeModAfterCharName(target.value);
  saveModsSettings(mods, { rerender: false });

  const isValid = Boolean(findCharacterByName(state, mods[index].afterCharName));
  target.classList.toggle("is-invalid", !isValid);
  target.setAttribute("title", isValid ? "Character name for after-char mod" : "Character not found in this chat");
}

function handleModPanelOutsideClick(event) {
  if (!openModImageTypesForId && !openModPositionForId && !openModGroupForId) {
    return;
  }

  const target = event.target;
  if (target?.closest?.(".mod-item__types-wrap")) {
    return;
  }

  if (target?.closest?.(".mod-item__position-wrap")) {
    return;
  }

  if (target?.closest?.(".mod-item__group-wrap")) {
    return;
  }

  openModImageTypesForId = null;
  openModPositionForId = null;
  openModGroupForId = null;
  renderModsPanel();
}

function handlePanelInput(event) {
  const target = event.target;
  const field = target.dataset.field;
  if (!field) {
    return;
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  if (field === "character-name") {
    const sanitizedValue = sanitizeForbiddenText(target.value);
    if (target.value !== sanitizedValue) {
      target.value = sanitizedValue;
    }
    const previousName = character.name;
    character.name = sanitizedValue;
    moveUploadedAvatarKey(previousName, character.name);
    updateDescriptionsOnly();
    renderFloatingCharacters();
    renderManagerPanel();
    return;
  }

  if (field === "appearance") {
    const sanitizedValue = sanitizeForbiddenText(target.value);
    if (target.value !== sanitizedValue) {
      target.value = sanitizedValue;
    }
    character.appearance = sanitizedValue;
    updateDescriptionsOnly();
    return;
  }

  if (field === "group-name") {
    const group = findGroup(character, target.dataset.groupId);
    if (group) {
      const sanitizedValue = sanitizeForbiddenText(target.value);
      if (target.value !== sanitizedValue) {
        target.value = sanitizedValue;
      }
      group.name = sanitizedValue;
      updateDescriptionsOnly();
    }
    return;
  }

  if (field === "layer-name") {
    const layer = findLayer(character.clothingGroups.flatMap((group) => group.layers), target.dataset.layerId);
    if (layer) {
      const sanitizedValue = sanitizeForbiddenText(target.value);
      if (target.value !== sanitizedValue) {
        target.value = sanitizedValue;
      }
      layer.name = sanitizedValue;
      updateDescriptionsOnly();
    }
  }

  if (field === "custom-field-value") {
    const varName = target.dataset.varName;
    if (varName) {
      const context = getContext();
      const customField = getCustomFieldByVarName(varName);
      if (customField?.target === "everyone") {
        const characterId = normalizeCharacterIdKey(character.id);
        const valueByCharacterId = parseEveryoneVarMap(context.variables?.local?.get?.(varName));
        valueByCharacterId[characterId] = target.value;
        context.variables?.local?.set?.(varName, valueByCharacterId);
      } else {
        context.variables?.local?.set?.(varName, target.value);
      }
      updateDescriptionsOnly();
    }
  }
}

async function handlePanelClick(event) {
  const action = event.target.dataset.action;
  const actionOwner = action ? event.target : event.target.closest("[data-action]");
  const resolvedAction = actionOwner?.dataset.action;
  if (!resolvedAction) {
    return;
  }

  if (resolvedAction === "expand-manager") {
    managerExpanded = true;
    return renderPanel();
  }

  if (resolvedAction === "collapse-manager") {
    managerExpanded = false;
    return renderPanel();
  }

  if (resolvedAction === "set-compact-mode") {
    managerExpanded = false;
    setRightDrawerCompact(true);
    return;
  }

  if (resolvedAction === "exit-compact-mode") {
    managerExpanded = false;
    setRightDrawerCompact(false);
    return;
  }

  if (resolvedAction === "add-character") {
    managerExpanded = true;
    await handleAddCharacter();
    return renderPanel();
  }

  if (resolvedAction === "generate-character-ai") {
    void (async () => {
      const request = await Popup.show.input(
        "Generate character with AI",
        "Describe what character should be added to the scene (for example: a mysterious stranger in a dark cloak).",
        "",
        { okButton: "Generate", cancelButton: "Cancel", rows: 2 },
      );

      if (request === null) {
        return;
      }

      const requestText = String(request || "").trim();
      if (!requestText) {
        toastr.warning("Character request cannot be empty.", "Character Details");
        return;
      }

      await runCharacterGenerationWithAI(requestText, $(actionOwner));
    })();
    return;
  }

  if (resolvedAction === "export-character-details") {
    return handleExportCharacterDetails();
  }

  if (resolvedAction === "import-character-details") {
    return handleImportCharacterDetails();
  }

  if (resolvedAction === "save-viewer-to-persona") {
    return handleSaveViewerToPersona();
  }

  if (resolvedAction === "add-character-from-persona") {
    return handleAddCharacterFromPersona();
  }

  if (resolvedAction === "upload-avatar-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      return handleUploadCharacterAvatar(targetCharacter);
    }
  }

  if (resolvedAction === "remove-avatar-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      return handleRemoveCharacterAvatar(targetCharacter);
    }
  }

  if (resolvedAction === "switch-character") {
    const characterId = actionOwner.dataset.characterId || actionOwner.closest("[data-character-id]")?.dataset.characterId;
    if (characterId && findCharacterById(state, characterId)) {
      state.activeCharacterId = characterId;
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-presence-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      targetCharacter.presence = !targetCharacter.presence;
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-mc-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      state.mainCharacterId = state.mainCharacterId === targetCharacter.id ? null : targetCharacter.id;
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-viewer-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      state.viewerCharacterId = state.viewerCharacterId === targetCharacter.id ? null : targetCharacter.id;
      return saveAndRender();
    }
  }

  if (resolvedAction === "delete-character") {
    const characterId = actionOwner.dataset.characterId;
    if (characterId) {
      const removedCharacter = state.characters.find((characterItem) => characterItem.id === characterId) || null;
      const removedCharacterName = removedCharacter?.name;
      state.characters = state.characters.filter((characterItem) => characterItem.id !== characterId);
      if (state.activeCharacterId === characterId) {
        state.activeCharacterId = null;
      }
      if (state.mainCharacterId === characterId) {
        state.mainCharacterId = null;
      }
      if (state.viewerCharacterId === characterId) {
        state.viewerCharacterId = null;
      }

      const avatarKey = getAvatarKeyForCharacterName(removedCharacterName);
      if (avatarKey) {
        const context = getContext();
        const avatarMap = readAvatarMap(context);
        if (avatarMap[avatarKey]) {
          delete avatarMap[avatarKey];
          writeAvatarMap(context, avatarMap);
        }
      }

      ensureActiveCharacter(state);
      return saveAndRender();
    }
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  if (resolvedAction === "generate-outfit-ai") {
    void (async () => {
      const request = await Popup.show.input(
        "Generate outfit with AI",
        "Describe what outfit should be generated for this character (for example: Nice outfit for a date).",
        "",
        { okButton: "Generate", cancelButton: "Cancel", rows: 2 },
      );

      if (request === null) {
        return;
      }

      const requestText = String(request || "").trim();
      if (!requestText) {
        toastr.warning("Outfit request cannot be empty.", "Character Details");
        return;
      }

      await runOutfitGenerationForCharacter(character.id, requestText, $(actionOwner));
    })();
    return;
  }

  if (resolvedAction === "add-group") {
    const newGroup = createGroup(getContext());
    character.clothingGroups.push(newGroup);
    character.activeGroupId = newGroup.id;
    return saveAndRender();
  }

  const groupElement = event.target.closest(".clothing-group");
  const groupId = groupElement?.dataset.groupId;
  const group = groupId ? findGroup(character, groupId) : null;

  if (resolvedAction === "toggle-group" && group) {
    group.collapsed = !group.collapsed;
    return saveAndRender();
  }

  if (resolvedAction === "delete-group" && group) {
    character.clothingGroups = character.clothingGroups.filter((item) => item.id !== group.id);
    ensureActiveGroup(character);
    return saveAndRender();
  }

  if (resolvedAction === "set-active-group" && group) {
    character.activeGroupId = group.id;
    return saveAndRender();
  }

  if (resolvedAction === "add-layer" && group) {
    group.layers.push(createLayer(getContext()));
    return saveAndRender();
  }

  const layerElement = event.target.closest(".clothing-layer");
  const layerId = layerElement?.dataset.layerId;
  const layersRoot = character.clothingGroups.flatMap((item) => item.layers);
  const layer = layerId ? findLayer(layersRoot, layerId) : null;

  if (resolvedAction === "add-child" && layer) {
    layer.children.push(createLayer(getContext()));
    return saveAndRender();
  }

  if (resolvedAction === "delete-layer" && layerId) {
    removeLayerFromGroups(character.clothingGroups, layerId);
    return saveAndRender();
  }

  if (resolvedAction === "cycle-state" && layer) {
    cycleState(layer);
    return saveAndRender();
  }

  if (resolvedAction === "toggle-visibility-override" && layer) {
    layer.visibilityOverride = !Boolean(layer.visibilityOverride);
    return saveAndRender();
  }

  if (resolvedAction === "toggle-presence") {
    character.presence = !character.presence;
    return saveAndRender();
  }

  if (resolvedAction === "toggle-viewer") {
    state.viewerCharacterId = state.viewerCharacterId === character.id ? null : character.id;
    return saveAndRender();
  }

  if (resolvedAction === "toggle-mc") {
    state.mainCharacterId = state.mainCharacterId === character.id ? null : character.id;
    return saveAndRender();
  }

  if (resolvedAction === "toggle-custom-field") {
    const varName = actionOwner?.dataset.varName;
    if (varName) {
      const customField = getCustomFieldByVarName(varName);
      if (!customField) {
        return;
      }

      const currentEnabled = getCustomFieldGeneratorToggleForCharacter(state, customField, character.id);
      setCustomFieldGeneratorToggleForCharacter(state, customField, character.id, !currentEnabled);
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-custom-field-link") {
    const varName = actionOwner?.dataset.varName;
    if (varName) {
      const customField = getCustomFieldByVarName(varName);
      if (customField?.target !== "everyone") {
        return;
      }

      const nextLinkedState = !isCustomFieldGeneratorLinkedForAll(state, customField);
      setCustomFieldGeneratorLinkForAll(state, customField, character.id, nextLinkedState);
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-lock" && layerId) {
    const layer = findLayer(character.clothingGroups.flatMap((g) => g.layers), layerId);
    if (layer) {
      layer.locked = !layer.locked;
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-lock" && groupId) {
    const group = findGroup(character, groupId);
    if (group) {
      group.locked = !group.locked;
      return saveAndRender();
    }
  }
}

function handleLayerDragStart(event) {
  const dragOrigin = event.target;
  if (dragOrigin?.closest?.("input, textarea")) {
    const nativeEvent = event.originalEvent || event;
    if (nativeEvent.dataTransfer) {
      nativeEvent.dataTransfer.effectAllowed = "none";
    }
    event.preventDefault();
    return;
  }

  const dragHandle = dragOrigin?.closest?.(".layer-drag-handle");
  if (!dragHandle) {
    return;
  }

  const layerElement = dragHandle.closest(".clothing-layer");
  const layerId = layerElement?.dataset?.layerId;
  if (!layerId) {
    return;
  }

  draggedLayerId = layerId;
  const nativeEvent = event.originalEvent || event;
  if (nativeEvent.dataTransfer) {
    nativeEvent.dataTransfer.setData("text/plain", layerId);
    nativeEvent.dataTransfer.effectAllowed = "move";
  }

  layerElement.classList.add("is-dragging");
}

function handleLayerDragOver(event) {
  const layerElement = resolveLayerElement(event);
  if (!layerElement || !draggedLayerId) {
    return;
  }

  event.preventDefault();
  const nativeEvent = event.originalEvent || event;
  const rect = layerElement.getBoundingClientRect();
  const offsetY = nativeEvent.clientY - rect.top;
  const ratio = rect.height > 0 ? offsetY / rect.height : 0.5;

  clearDragIndicators();
  if (ratio <= 0.25) {
    layerElement.classList.add("drop-before");
    layerElement.dataset.dropMode = "before";
  } else if (ratio >= 0.75) {
    layerElement.classList.add("drop-after");
    layerElement.dataset.dropMode = "after";
  } else {
    layerElement.classList.add("drop-child");
    layerElement.dataset.dropMode = "child";
  }
}

function handleLayerDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const layerElement = resolveLayerElement(event);
  if (!layerElement) {
    return;
  }

  const nativeEvent = event.originalEvent || event;
  const draggedId = nativeEvent.dataTransfer?.getData("text/plain") || draggedLayerId;
  const targetId = layerElement.dataset.layerId;
  const dropMode = layerElement.dataset.dropMode || "child";

  if (!draggedId || !targetId || draggedId === targetId) {
    return;
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  const draggedInfo = findLayerWithParentInGroups(character.clothingGroups, draggedId);
  const targetInfo = findLayerWithParentInGroups(character.clothingGroups, targetId);
  if (!draggedInfo || !targetInfo) {
    return;
  }

  const draggedIndex = draggedInfo.parentArray.findIndex((item) => item.id === draggedId);
  const targetIndex = targetInfo.parentArray.findIndex((item) => item.id === targetId);
  const sameParent = draggedInfo.parentArray === targetInfo.parentArray;
  if (sameParent && dropMode === "before" && draggedIndex === targetIndex - 1) {
    return;
  }
  if (sameParent && dropMode === "after" && draggedIndex === targetIndex + 1) {
    return;
  }

  const targetIsDescendant = isDescendantLayer(draggedInfo.layer, targetId);
  if (targetIsDescendant) {
    const targetParent = targetInfo.parentArray;
    const targetIndex = targetParent.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) {
      return;
    }

    targetParent.splice(targetIndex, 1);

    const extracted = extractLayerFromGroups(character.clothingGroups, draggedId);
    if (!extracted) {
      return;
    }

    extracted.parentArray.splice(extracted.index, 0, targetInfo.layer);
    targetInfo.layer.children = targetInfo.layer.children || [];
    targetInfo.layer.children.push(extracted.layer);
  } else {
    const extracted = extractLayerFromGroups(character.clothingGroups, draggedId);
    if (!extracted) {
      return;
    }

    if (dropMode === "child") {
      targetInfo.layer.children = targetInfo.layer.children || [];
      targetInfo.layer.children.push(extracted.layer);
    } else {
      const targetParent = targetInfo.parentArray;
      const targetIndex = targetParent.findIndex((item) => item.id === targetId);
      if (targetIndex === -1) {
        return;
      }

      let insertIndex = dropMode === "after" ? targetIndex + 1 : targetIndex;
      if (extracted.parentArray === targetParent && extracted.index < targetIndex) {
        insertIndex -= 1;
      }

      targetParent.splice(insertIndex, 0, extracted.layer);
    }
  }

  saveAndRender();
}

function handleLayerDragEnd(event) {
  const layerElement = resolveLayerElement(event);
  if (layerElement) {
    layerElement.classList.remove("is-dragging");
    layerElement.dataset.dropMode = "";
  }

  draggedLayerId = null;
  clearDragIndicators();
}

function handleGroupDragOver(event) {
  if (!draggedLayerId) {
    return;
  }

  event.preventDefault();
}

function handleGroupDrop(event) {
  event.preventDefault();
  if (resolveLayerElement(event)) {
    return;
  }

  const groupElement = event.currentTarget.closest(".clothing-group");
  if (!groupElement) {
    return;
  }

  const groupId = groupElement.dataset.groupId;
  const nativeEvent = event.originalEvent || event;
  const draggedId = nativeEvent.dataTransfer?.getData("text/plain") || draggedLayerId;
  if (!draggedId || !groupId) {
    return;
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  const group = findGroup(character, groupId);
  if (!group) {
    return;
  }

  const extracted = extractLayerFromGroups(character.clothingGroups, draggedId);
  if (!extracted) {
    return;
  }

  group.layers.push(extracted.layer);
  saveAndRender();
}

function bindEvents() {
  footerGenerateButton.on("click", runDescriptionsGeneration);
  footerPreviewToggle.on("click", () => {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].preview_image_prompts = !shouldPreviewImagePrompts();
    renderPreviewToggleState();
    saveSettingsDebounced();
  });
  footerGuideToggle.on("click", () => {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].add_prompt_guide = !shouldAddPromptGuide();
    renderGuideToggleState();
    saveSettingsDebounced();
  });
  footerFreeGenerateButton.on("click", generateFreeImage);
  footerPortraitButton.on("click", (event) => generateCharacterImage("portrait", $(event.currentTarget)));
  footerFullBodyButton.on("click", (event) => generateCharacterImage("fullbody", $(event.currentTarget)));
  footerBackgroundButton.on("click", (event) => generateCharacterImage("background", $(event.currentTarget)));
  footerViewerEyesButton.on("click", (event) => generateCharacterImage("viewer-eyes", $(event.currentTarget)));
  footerSceneButton.on("click", (event) => generateCharacterImage("scene", $(event.currentTarget)));
  modsPositionFilterRoot.on("click", handleModsPositionFilterClick);
  modsAddButton.on("click", () => {
    void handleAddMod();
  });
  modsPanelRoot.on("click", handleModPanelClick);
  modsPanelRoot.on("change", handleModPanelChange);
  modsPanelRoot.on("input", handleModPanelInput);
  modsPanelRoot.on("dragstart", handleModDragStart);
  modsPanelRoot.on("dragover", handleModDragOver);
  modsPanelRoot.on("drop", handleModDrop);
  modsPanelRoot.on("dragend", handleModDragEnd);
  panelRoot.on("input", handlePanelInput);
  panelRoot.on("click", handlePanelClick);
  floatingRoot.on("click", handlePanelClick);
  managerRoot.on("click", handlePanelClick);
  rightCompactToggleButton.on("click", () => {
    managerExpanded = false;
    if (isMobileDrawerMode()) {
      setRightDrawerCompact(!isRightDrawerCompactActive());
    } else {
      setRightDrawerCompact(true);
    }
  });
  rightCompactRestoreButton.on("click", () => {
    managerExpanded = false;
    setRightDrawerCompact(false);
  });
  panelRoot.on("dragstart", handleLayerDragStart);
  panelRoot.on("dragover", handleLayerDragOver);
  panelRoot.on("drop", handleLayerDrop);
  panelRoot.on("dragend", handleLayerDragEnd);
  panelRoot.on("dragover", ".clothing-group__content", handleGroupDragOver);
  panelRoot.on("drop", ".clothing-group__content", handleGroupDrop);

  // Global handler for message action buttons (Set as avatar, Set as background)
  $(document).on("mouseenter", "[data-st-extension-image-action]", (event) => {
    const $button = $(event.currentTarget);
    const $msg = $button.closest(".mes");
    setImageActionButtonsState($msg);
  });
  $(document).on("click", "[data-action='set-as-avatar']", handleSetAsAvatarClick);
  $(document).on("click", "[data-action='set-as-chat-background']", handleSetAsChatBackgroundClick);
  $(document).off("click.stExtensionModsPanel").on("click.stExtensionModsPanel", handleModPanelOutsideClick);
  $(document)
    .off("st-charmander:mods-panel-visibility-changed")
    .on("st-charmander:mods-panel-visibility-changed", renderModsPanelVisibility);
  $(document)
    .off("st-charmander:mods-layout-changed")
    .on("st-charmander:mods-layout-changed", renderModsPanel);
}

function initCharacterDetailsPanel() {
  const context = getContext();
  panelContainerRoot = $("#st-extension-right-panel");
  modsPanelContainerRoot = $("#st-extension-left-panel");
  panelRoot = $("#character-details-panel");
  floatingRoot = $("#character-details-floating");
  managerRoot = $("#character-details-manager");
  mobileDrawerToggleButton = $("#st-extension-mobile-drawer-toggle");
  mobileDrawerLeftToggleButton = $("#st-extension-mobile-drawer-left-toggle");
  rightCompactToggleButton = $("#st-extension-right-compact-toggle");
  rightCompactRestoreButton = $("#st-extension-right-compact-restore");
  modsPanelRoot = $("#character-details-mods-panel");
  modsPositionFilterRoot = $("#character-details-mods-position-filter");
  modsAddButton = $("#character-details-mods-add");
  footerGenerateButton = $("#character-details-generate");
  footerFreeGenerateButton = $("#character-details-free-generate");
  footerPortraitButton = $("#character-details-portrait");
  footerFullBodyButton = $("#character-details-fullbody");
  footerPreviewToggle = $("#character-details-preview-prompts");
  footerGuideToggle = $("#character-details-add-guide");
  footerBackgroundButton = $("#character-details-background");
  footerViewerEyesButton = $("#character-details-viewer-eyes");
  footerSceneButton = $("#character-details-scene");
  footerRoot = $(".st-extension-right-panel__footer");

  if (!panelRoot.length) {
    return;
  }

  const reloadState = () => {
    const nextContext = getContext();
    state = loadCharacterDetails(nextContext);
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    rightDrawerCompact = isRightDrawerCompactEnabled();
    extension_settings[extensionName].mods = getNormalizedModsSettings();
    cleanupModsLocalState(nextContext, extension_settings[extensionName].mods);
    ensureActiveCharacter(state);
    ensureActiveGroups(state);
    if (hasPersonaChanged(nextContext)) {
      applyViewerFromPersona(state, nextContext);
    }
    applyMainCharacterFromChat(state, nextContext);
    saveCharacterDetails(nextContext, state);
    persistDescriptionsForCurrentChat(nextContext, state);
    renderPreviewToggleState();
    renderGuideToggleState();
    updateFooterImageButtonsVisibility();
    renderModsPanelVisibility();
    renderPanel();
    
    // Reset processed messages to re-inject buttons after chat change
    resetMessageProcessing();
  };

  const handleNewChatAutoAdd = () => {
    const nextContext = getContext();
    state = loadCharacterDetails(nextContext);
    if (autoAddCharacterFromPersonaIfExists(state, nextContext)) {
      saveAndRender();
      toastr.success("Persona character auto-added for new chat.", "Character Details");
      return;
    }
    reloadState();
  };

  bindEvents();
  initializeMobileDrawer();
  initializeLeftMobileDrawer();
  reloadState();

  if (!customFieldRefreshTimer) {
    customFieldRefreshTimer = setInterval(() => {
      const nextContext = getContext();
      refreshCustomFieldInputs(nextContext);
    }, 1000);
  }

  // Start monitoring for new messages and inject action buttons
  const messageActionInterval = setInterval(() => {
    injectMessageActionButtons();
  }, 500);

  if (context.eventSource && context.eventTypes) {
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, reloadState);
    context.eventSource.on(context.eventTypes.CHAT_LOADED, reloadState);
    context.eventSource.on(context.eventTypes.SETTINGS_UPDATED, reloadState);
    if (context.eventTypes.CHAT_CREATED) {
      context.eventSource.on(context.eventTypes.CHAT_CREATED, handleNewChatAutoAdd);
    }
    if (context.eventTypes.GROUP_CHAT_CREATED) {
      context.eventSource.on(context.eventTypes.GROUP_CHAT_CREATED, handleNewChatAutoAdd);
    }
  }
}

function setCharacterDetailsData(data) {
  const context = getContext();
  const previousViewerId = state?.viewerCharacterId || null;
  const previousViewerName = state?.characters?.find((item) => item.id === previousViewerId)?.name;
  const previousMainId = state?.mainCharacterId || null;
  state = data;
  if (previousViewerName) {
    const match = state.characters.find((character) => normalizeName(character.name) === normalizeName(previousViewerName));
    state.viewerCharacterId = match?.id || null;
  }
  // Preserve mainCharacterId
  if (previousMainId && state.characters.find((c) => c.id === previousMainId)) {
    state.mainCharacterId = previousMainId;
  }
  if (hasPersonaChanged(context)) {
    applyViewerFromPersona(state, context);
  }
  applyMainCharacterFromChat(state, context);
  ensureActiveCharacter(state);
  ensureActiveGroups(state);
  saveCharacterDetails(context, state);
  persistDescriptionsForCurrentChat(context, state);
  renderPanel();
}

export { initCharacterDetailsPanel, setCharacterDetailsData };
