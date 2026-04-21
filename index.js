// The main script for the extension
// The following are examples of some basic extension functionality

//You'll likely need to import extension_settings, getContext, and loadExtensionSettings from extensions.js
import { extension_settings, getContext, findExtension, renderExtensionTemplateAsync } from "../../../extensions.js";
import { initCharacterDetailsPanel, getCharacterDetailsState } from "./src/character-details-panel.js";
import { initModPanel } from "./src/character-details-mod-panel.js";
import { loadCharacterDetails } from "./src/character-details-store.js";
import { buildGenDescriptions } from "./src/character-details-descriptions.js";
import { initCharacterDetailsPromptInjector } from "./src/character-details-prompt-injector.js";
import { IMAGE_RESOLUTION_OPTIONS, DEFAULT_RESOLUTION_OPTION } from "./src/image-resolution-options.js";
import { DEFAULT_DESCRIPTIONS_PROMPT } from "./src/character-details-prompts.js";

//You'll likely need to import some other functions from the main script
import { saveSettingsDebounced } from "../../../../script.js";

// Keep track of where your extension is located, name should match repo name
const extensionName = "st-charmander";
const IMAGE_SETTINGS_CHANGED_EVENT = "st-charmander:image-settings-changed";
const DEFAULT_JSON_INTERPRETATION_PROMPT = "Interpretation for clothing state (authoritative):\n- The JSON is the source of truth for what is currently worn.\n- In narration, mention only the outermost visible layers and items with state=partial that are visible.\n- Do not mention covered inner layers while they are still covered.\n- Covered layers are included for continuity only; if outer layers are removed later, newly revealed layers must match this data and story logic.\n- Keep clothing continuity logically consistent with scene progression.";
const DEFAULT_PLAIN_TEXT_INTERPRETATION_PROMPT = "Interpretation for clothing state (authoritative):\n- The plain-text clothing list is the source of truth for what is currently worn.\n- In narration, mention only currently visible outer layers and partially visible items.\n- Do not mention covered inner layers while they are still covered.\n- Covered layers are included for continuity only; if outer layers are removed later, newly revealed layers must match this data and story logic.\n- Keep clothing continuity logically consistent with scene progression.";
const resolutionSelectMappings = [
  { selector: "#custom-resolution-portrait", key: "portrait" },
  { selector: "#custom-resolution-fullbody", key: "fullbody" },
  { selector: "#custom-resolution-background", key: "background" },
  { selector: "#custom-resolution-viewer-eyes", key: "viewer_eyes" },
  { selector: "#custom-resolution-scene", key: "scene" },
];
const TEMPLATE_PATH = 'third-party/SillyTavern-CharacterManagerDeredere';

function emitImageSettingsChanged() {
  $(document).trigger(IMAGE_SETTINGS_CHANGED_EVENT);
}

function normalizeQuickResolutionId(value) {
  const normalized = String(value || "").trim();
  return normalized in IMAGE_RESOLUTION_OPTIONS ? normalized : "";
}

function normalizeQuickResolutionList(values) {
  const source = Array.isArray(values) ? values : [];
  const seen = new Set();
  const normalized = [];

  for (const value of source) {
    const id = normalizeQuickResolutionId(value);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function getQuickResolutionSettings() {
  return normalizeQuickResolutionList(extension_settings?.[extensionName]?.quick_resolutions);
}

function buildResolutionOptionsMarkup(selectedValue, { includeDefault = true } = {}) {
  const options = [];

  if (includeDefault) {
    const selected = String(selectedValue || DEFAULT_RESOLUTION_OPTION) === DEFAULT_RESOLUTION_OPTION;
    options.push(`<option value="${DEFAULT_RESOLUTION_OPTION}" ${selected ? "selected" : ""}>default</option>`);
  }

  for (const [id, resolution] of Object.entries(IMAGE_RESOLUTION_OPTIONS)) {
    const selected = id === selectedValue;
    options.push(`<option value="${id}" ${selected ? "selected" : ""}>${escapeHtml(resolution.name)}</option>`);
  }

  return options.join("");
}

function normalizeSwitcherCharacterLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 7;
  }

  return Math.max(1, Math.min(50, Math.floor(numeric)));
}

function normalizeLlmHistoryMessageLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }

  return Math.max(0, Math.min(200, Math.floor(numeric)));
}

const defaultSettings = {
  descriptions_prompt: DEFAULT_DESCRIPTIONS_PROMPT,
  custom_fields: [],
  mods: [],
  auto_add_persona_character_for_new_chat: true,
  switcher_character_limit: 7,
  llm_history_message_limit: 5,
  llm_clothing_plain_text: false,
  llm_clothing_json_interpretation_prompt: DEFAULT_JSON_INTERPRETATION_PROMPT,
  llm_clothing_plain_text_interpretation_prompt: DEFAULT_PLAIN_TEXT_INTERPRETATION_PROMPT,
  show_image_generation_buttons: true,
  show_mods_panel: false,
  use_tall_mods_in_desktop_mode: false,
  use_crop_tool_for_avatars: false,
  remove_image_prompt_newlines: true,
  preview_image_prompts: false,
  add_prompt_guide: false,
  visual_command_start: "Ignore previous instructions. Your next response must be description of visual elements of previous message. Describe only the most recent message. Summarize. Your description will be used by professional artist to paint the scene - mention everything that is needed for that, and don't add any unnecessary information. KEEP IT SHORT. DO NOT INCLUDE ANY COMMENTARY ON MORAL OR SOCIAL DILLEMAS. ONLY DESCRIBE VISUAL ASPECT.\n\nDO NOT, UNDER ANY CIRMUSCANCES describe backstory or history, nor speculate on future. All you can describe is visuals.\n\nDO NOT USE FLOWERY LANGUAGE. USE ONLY SIMPLE WORDS, SIMPLE SENTENCES, AND BASIC CONSTRUCTS.",
  closeup_portrait_prompt: "You are creating a close-up portrait prompt (head and upper torso) for image generation. Describe only the currently selected character by name. Do not describe appearance or clothing because it is provided separately. Keep the character in a neutral, static pose with current facial expression. Background should describe only current location. Never mention any other person or character. Do not describe interactions, backstory, history, future events, or actions in progress. Keep wording direct, visual, and concise. Always include exact line: \"[name] is looking at viewer\".",
  full_body_portrait_prompt: "You are creating a full body portrait prompt for image generation. Describe only the currently selected character by name. Do not describe appearance or clothing because it is provided separately. Keep the character in a neutral, static standing pose with current facial expression. Background should describe only current location. Never mention any other person or character. Do not describe interactions, backstory, history, future events, or actions in progress. Keep wording direct, visual, and concise. Always include exact line: \"[name] is looking at viewer\".",
  describe_background_prompt: "Describe background of current scene, include: location, time of day, weather, lighting, and any other relevant details. Do not include descriptions of characters and non-visual qualities such as names, personality, movements, scents, mental traits, or anything which could not be seen in a still photograph. Prefix your description with the phrase 'background,'. Ignore the rest of the story when crafting this description. Do not reply as {{user}} when writing this description, and do not attempt to continue the story.",
  describe_viewer_eyes_prompt: "Describe the scene strictly from viewer's eyes (first-person viewpoint from viewer position). Viewer name is provided for context, but never use the user's name; always refer to user as \"viewer\". Do not describe appearance or clothing of any character because this is added automatically. Describe composition and spatial positions as if explaining to a blind artist. Use third-person references for named characters and refer to them by their names. Use medical/basic terms for body parts, avoid metaphors and comparisons (for example: avoid \"as big as\", \"as black as\"). Keep the description concise but exhaustive. Describe scene background and environment where characters are located. Do not summarize or describe dialogue. Visible written text on objects, screens, signs, labels may be included. If story spans longer period, choose one single point in time with the highest emotional impact and describe only that moment.",
  describe_current_scene_prompt: "Describe the current scene as a single still frame. Do not describe appearance or clothing of any character because this is added automatically. Describe composition and spatial positions as if explaining to a blind artist. Use third-person references for named characters and refer to them by their names. Use medical/basic terms for body parts, avoid metaphors and comparisons (for example: avoid \"as big as\", \"as black as\"). Keep the description concise but exhaustive. Describe scene background and environment where characters are located. Do not summarize or describe dialogue. Visible written text on objects, screens, signs, labels may be included. If story spans longer period, choose one single point in time with the highest emotional impact and describe only that moment.",
  custom_resolutions: {
    portrait: DEFAULT_RESOLUTION_OPTION,
    fullbody: DEFAULT_RESOLUTION_OPTION,
    background: DEFAULT_RESOLUTION_OPTION,
    viewer_eyes: DEFAULT_RESOLUTION_OPTION,
    scene: DEFAULT_RESOLUTION_OPTION,
  },
  show_quick_resolution_button: false,
  quick_resolutions: [],
  active_quick_resolution: DEFAULT_RESOLUTION_OPTION,
};


 
// Loads the extension settings if they exist, otherwise initializes them to the defaults.
async function loadSettings() {
  //Create the settings if they don't exist
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  for (const [key, value] of Object.entries(defaultSettings)) {
    if (extension_settings[extensionName][key] === undefined) {
      extension_settings[extensionName][key] = value;
    }
  }

  if (extension_settings[extensionName].image_scene_prompt && !extension_settings[extensionName].closeup_portrait_prompt) {
    extension_settings[extensionName].closeup_portrait_prompt = extension_settings[extensionName].image_scene_prompt;
  }
  if (extension_settings[extensionName].image_scene_prompt && !extension_settings[extensionName].full_body_portrait_prompt) {
    extension_settings[extensionName].full_body_portrait_prompt = extension_settings[extensionName].image_scene_prompt;
  }

  if (!extension_settings[extensionName].custom_resolutions || typeof extension_settings[extensionName].custom_resolutions !== "object") {
    extension_settings[extensionName].custom_resolutions = { ...defaultSettings.custom_resolutions };
  }

  if (!Array.isArray(extension_settings[extensionName].mods)) {
    extension_settings[extensionName].mods = [];
  }

  for (const { key } of resolutionSelectMappings) {
    const value = String(extension_settings[extensionName].custom_resolutions[key] || DEFAULT_RESOLUTION_OPTION);
    extension_settings[extensionName].custom_resolutions[key] = value in IMAGE_RESOLUTION_OPTIONS ? value : DEFAULT_RESOLUTION_OPTION;
  }

  extension_settings[extensionName].quick_resolutions = normalizeQuickResolutionList(extension_settings[extensionName].quick_resolutions);
  extension_settings[extensionName].show_quick_resolution_button = extension_settings[extensionName].show_quick_resolution_button === true;
  const activeQuickResolution = normalizeQuickResolutionId(extension_settings[extensionName].active_quick_resolution);
  extension_settings[extensionName].active_quick_resolution = extension_settings[extensionName].quick_resolutions.includes(activeQuickResolution)
    ? activeQuickResolution
    : DEFAULT_RESOLUTION_OPTION;

  // Updating settings in the UI
  $("#descriptions_prompt").val(extension_settings[extensionName].descriptions_prompt || defaultSettings.descriptions_prompt);
  $("#auto_add_persona_character_for_new_chat").prop("checked", extension_settings[extensionName].auto_add_persona_character_for_new_chat !== false);
  const switcherLimit = normalizeSwitcherCharacterLimit(extension_settings[extensionName].switcher_character_limit);
  extension_settings[extensionName].switcher_character_limit = switcherLimit;
  $("#switcher_character_limit").val(String(switcherLimit));
  const historyLimit = normalizeLlmHistoryMessageLimit(extension_settings[extensionName].llm_history_message_limit);
  extension_settings[extensionName].llm_history_message_limit = historyLimit;
  $("#llm_history_message_limit").val(String(historyLimit));
  $("#llm_clothing_plain_text").prop("checked", extension_settings[extensionName].llm_clothing_plain_text === true);
  renderClothingInterpretationPromptField();
  $("#show_image_generation_buttons").prop("checked", extension_settings[extensionName].show_image_generation_buttons !== false);
  $("#show_mods_panel").prop("checked", extension_settings[extensionName].show_mods_panel === true);
  $("#use_tall_mods_in_desktop_mode").prop("checked", extension_settings[extensionName].use_tall_mods_in_desktop_mode === true);
  $("#use_crop_tool_for_avatars").prop("checked", extension_settings[extensionName].use_crop_tool_for_avatars === true);
  $("#remove_image_prompt_newlines").prop("checked", extension_settings[extensionName].remove_image_prompt_newlines !== false);
  $("#visual_command_start").val(extension_settings[extensionName].visual_command_start || defaultSettings.visual_command_start);
  $("#closeup_portrait_prompt").val(extension_settings[extensionName].closeup_portrait_prompt || defaultSettings.closeup_portrait_prompt);
  $("#full_body_portrait_prompt").val(extension_settings[extensionName].full_body_portrait_prompt || defaultSettings.full_body_portrait_prompt);
  $("#describe_background_prompt").val(extension_settings[extensionName].describe_background_prompt || defaultSettings.describe_background_prompt);
  $("#describe_viewer_eyes_prompt").val(extension_settings[extensionName].describe_viewer_eyes_prompt || defaultSettings.describe_viewer_eyes_prompt);
  $("#describe_current_scene_prompt").val(extension_settings[extensionName].describe_current_scene_prompt || defaultSettings.describe_current_scene_prompt);
  $("#show_quick_resolution_button").prop("checked", extension_settings[extensionName].show_quick_resolution_button === true);
  for (const { selector, key } of resolutionSelectMappings) {
    $(selector).val(extension_settings[extensionName].custom_resolutions[key] || DEFAULT_RESOLUTION_OPTION);
  }
  updateImageGenerationSettingsState();
  renderCustomFieldsSettings();
  renderQuickResolutionSettings();
}

function populateCustomResolutionDropdowns() {
  for (const { selector } of resolutionSelectMappings) {
    const select = $(selector);
    if (!select.length) {
      continue;
    }

    select.empty();
    select.append(buildResolutionOptionsMarkup(DEFAULT_RESOLUTION_OPTION));
  }
}

function renderQuickResolutionSettings() {
  const list = $("#quick-resolutions-list");
  if (!list.length) {
    return;
  }

  const quickResolutions = getQuickResolutionSettings();
  list.empty();

  for (const [index, resolutionId] of quickResolutions.entries()) {
    list.append(`
      <div class="quick-resolution-row">
        <select class="text_pole" data-field="quick-resolution" data-index="${index}">
          ${buildResolutionOptionsMarkup(resolutionId, { includeDefault: false })}
        </select>
        <button class="menu_button" type="button" data-action="remove-quick-resolution" data-index="${index}" title="Remove resolution">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `);
  }
}

function updateImageGenerationSettingsState() {
  const hasImageGeneration = Boolean(findExtension("stable-diffusion")?.enabled);
  const disabled = !hasImageGeneration;
  const controls = $("#show_image_generation_buttons, #remove_image_prompt_newlines, #visual_command_start, #closeup_portrait_prompt, #full_body_portrait_prompt, #describe_background_prompt, #describe_viewer_eyes_prompt, #describe_current_scene_prompt, #custom-resolution-portrait, #custom-resolution-fullbody, #custom-resolution-background, #custom-resolution-viewer-eyes, #custom-resolution-scene, #show_quick_resolution_button, #quick-resolutions-add, #quick-resolutions-list select, #quick-resolutions-list button, #reset-visual-command-start-prompt, #reset-closeup-portrait-prompt, #reset-full-body-portrait-prompt, #reset-describe-background-prompt, #reset-describe-viewer-eyes-prompt, #reset-describe-current-scene-prompt");
  controls.prop("disabled", disabled);
  $("#image-generation-required-note").toggleClass("displayNone", !disabled);
}

function getActiveClothingInterpretationPromptKey() {
  return extension_settings[extensionName].llm_clothing_plain_text
    ? "llm_clothing_plain_text_interpretation_prompt"
    : "llm_clothing_json_interpretation_prompt";
}

function renderClothingInterpretationPromptField() {
  const key = getActiveClothingInterpretationPromptKey();
  const isPlainText = key === "llm_clothing_plain_text_interpretation_prompt";
  const label = isPlainText
    ? "Clothing interpretation prompt (plain text)"
    : "Clothing interpretation prompt (JSON)";
  const value = extension_settings[extensionName][key] || defaultSettings[key] || "";

  $("#clothing_interpretation_prompt_label").text(label);
  $("#clothing_interpretation_prompt").val(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  const fields = extension_settings[extensionName]?.custom_fields;
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.map(normalizeCustomField);
}

function getCharacterNameById(data, characterId) {
  if (!characterId || !Array.isArray(data?.characters)) {
    return "";
  }

  const match = data.characters.find((character) => character?.id === characterId);
  return String(match?.name || "").trim();
}

function getSelectedCharacterName(data) {
  if (!data?.activeCharacterId || !Array.isArray(data?.characters)) {
    return "";
  }

  const match = data.characters.find((character) => character?.id === data.activeCharacterId);
  return String(match?.name || "").trim();
}

function normalizeCharacterLookup(value) {
  return String(value || "").trim().toLowerCase();
}

function parseCharVarMap(rawValue) {
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
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!normalizedKey) {
      continue;
    }
    normalized[normalizedKey] = entry;
  }

  return normalized;
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
  } catch {
    return String(value);
  }
}

function resolveCharacterByNameOrId(data, characterNameOrId) {
  const characters = Array.isArray(data?.characters) ? data.characters : [];
  const normalizedLookup = normalizeCharacterLookup(characterNameOrId);
  if (!normalizedLookup) {
    return null;
  }

  const idMatch = characters.find((character) => normalizeCharacterLookup(character?.id) === normalizedLookup);
  if (idMatch) {
    return idMatch;
  }

  return characters.find((character) => normalizeCharacterLookup(character?.name) === normalizedLookup) || null;
}

function canUseCustomFieldForCharacter(field, data, characterId) {
  const normalizedCharacterId = String(characterId || "").trim().toLowerCase();
  if (!field || !normalizedCharacterId) {
    return false;
  }

  if (field.target === "everyone") {
    return true;
  }

  if (field.target === "viewer") {
    return String(data?.viewerCharacterId || "").trim().toLowerCase() === normalizedCharacterId;
  }

  return String(data?.mainCharacterId || "").trim().toLowerCase() === normalizedCharacterId;
}

function resolveScopedFieldForCharacter(varName, data, characterId) {
  const normalizedVarName = String(varName || "").trim();
  if (!normalizedVarName) {
    return null;
  }

  const matchingFields = getCustomFieldsSettings().filter((field) => field.varName === normalizedVarName);
  if (!matchingFields.length) {
    return null;
  }

  return matchingFields.find((field) => canUseCustomFieldForCharacter(field, data, characterId)) || null;
}

function getCharScopedVariableValue(context, data, characterNameOrId, varName) {
  const normalizedVarName = String(varName || "").trim();
  if (!normalizedVarName) {
    return "";
  }

  const character = resolveCharacterByNameOrId(data, characterNameOrId);
  if (!character?.id) {
    return "";
  }

  const resolvedField = resolveScopedFieldForCharacter(normalizedVarName, data, character.id);
  if (!resolvedField) {
    return "";
  }

  if (resolvedField.target === "everyone") {
    const valueByCharacterId = parseCharVarMap(context.variables?.local?.get?.(normalizedVarName));
    return valueByCharacterId[String(character.id).toLowerCase()] ?? "";
  }

  return context.variables?.local?.get?.(normalizedVarName) ?? "";
}

function setCharScopedVariableValue(context, data, characterNameOrId, varName, value) {
  const normalizedVarName = String(varName || "").trim();
  if (!normalizedVarName) {
    return { ok: false, message: "Missing variable name." };
  }

  const character = resolveCharacterByNameOrId(data, characterNameOrId);
  if (!character?.id) {
    return { ok: true, value: "" };
  }

  const resolvedField = resolveScopedFieldForCharacter(normalizedVarName, data, character.id);
  if (!resolvedField) {
    return { ok: true, value: "" };
  }

  if (resolvedField.target !== "everyone") {
    context.variables?.local?.set?.(normalizedVarName, value);
    return { ok: true, value };
  }

  const valueByCharacterId = parseCharVarMap(context.variables?.local?.get?.(normalizedVarName));
  valueByCharacterId[String(character.id).toLowerCase()] = value;
  context.variables?.local?.set?.(normalizedVarName, valueByCharacterId);

  return { ok: true, value };
}

function resolveGlobalCharacterDetailsMacroValue(macroName) {
  const context = getContext();
  const data = loadCharacterDetails(context);

  if (macroName === "viewer") {
    return getCharacterNameById(data, data?.viewerCharacterId);
  }

  if (macroName === "mc") {
    return getCharacterNameById(data, data?.mainCharacterId);
  }

  if (macroName === "selected") {
    return getSelectedCharacterName(data);
  }

  return "";
}

function registerCharacterDetailsGlobalMacros() {
  const context = getContext();
  if (typeof context?.registerMacro !== "function") {
    console.warn("CHARacter MANager: Macro registration API is not available");
    return;
  }

  const macroDefinitions = [
    {
      key: "viewer",
      description: "Name of the character marked as Viewer in CHARacter MANager.",
    },
    {
      key: "mc",
      description: "Name of the character marked as MC in CHARacter MANager.",
    },
    {
      key: "selected",
      description: "Name of the currently selected character in CHARacter MANager.",
    },
  ];

  for (const definition of macroDefinitions) {
    context.registerMacro(
      definition.key,
      () => resolveGlobalCharacterDetailsMacroValue(definition.key),
      definition.description,
    );
  }
}

function registerCharacterDetailsCharVarMacros() {
  const context = getContext();
  const macroRegistry = context?.macros?.registry;
  if (!macroRegistry?.registerMacro) {
    console.warn("CHARacter MANager: New macro registry API is not available");
    return;
  }

  const category = context?.macros?.category?.VARIABLE || "variable";
  macroRegistry.unregisterMacro?.("getCharVar");
  macroRegistry.unregisterMacro?.("setCharVar");

  macroRegistry.registerMacro("getCharVar", {
    category,
    unnamedArgs: [
      { name: "charnameOrId" },
      { name: "varName" },
    ],
    description: "Gets a character-scoped value from a chat-local object variable.",
    returns: "Character value for the given key.",
    handler: ({ unnamedArgs: [characterNameOrId, varName], normalize }) => {
      const currentContext = getContext();
      const data = loadCharacterDetails(currentContext);
      const value = getCharScopedVariableValue(currentContext, data, characterNameOrId, varName);
      return normalize(value);
    },
  });

  macroRegistry.registerMacro("setCharVar", {
    category,
    unnamedArgs: [
      { name: "charnameOrId" },
      { name: "varName" },
      { name: "value", optional: true, defaultValue: "" },
    ],
    description: "Sets a character-scoped value in a chat-local object variable.",
    returns: "",
    handler: ({ unnamedArgs: [characterNameOrId, varName, value] }) => {
      const currentContext = getContext();
      const data = loadCharacterDetails(currentContext);
      setCharScopedVariableValue(currentContext, data, characterNameOrId, varName, value || "");
      return "";
    },
  });
}

function readCustomFieldsFromDom() {
  const fields = [];
  $("#custom-fields-list .custom-field-row").each((index, row) => {
    const $row = $(row);
    const label = String($row.find("[data-field='label']").val() || "").trim();
    const varName = String($row.find("[data-field='varName']").val() || "").trim();
    const targetValue = String($row.find("[data-field='target']").val() || "").trim().toLowerCase();
    const target = targetValue === "viewer" || targetValue === "everyone" ? targetValue : "mc";
    if (!label && !varName) {
      return;
    }
    fields.push({ label, varName, target });
  });

  return fields;
}

function renderCustomFieldsSettings() {
  const list = $("#custom-fields-list");
  if (!list.length) {
    return;
  }

  const fields = getCustomFieldsSettings();
  list.empty();

  for (const field of fields) {
    const target = field.target === "viewer" || field.target === "everyone" ? field.target : "mc";
    list.append(`
      <div class="custom-field-row">
        <input class="text_pole" type="text" placeholder="Field label" data-field="label" value="${escapeHtml(field.label)}" />
        <input class="text_pole" type="text" placeholder="Local var name" data-field="varName" value="${escapeHtml(field.varName)}" />
        <select class="text_pole" data-field="target">
          <option value="mc" ${target === "mc" ? "selected" : ""}>MC</option>
          <option value="viewer" ${target === "viewer" ? "selected" : ""}>Viewer</option>
          <option value="everyone" ${target === "everyone" ? "selected" : ""}>Everyone</option>
        </select>
        <button class="menu_button" type="button" data-action="remove-custom-field" title="Remove">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `);
  }
}

function appendRightPanel(panelHtml) {
  const $panel = $(panelHtml);
  const $existing = $("#st-extension-right-panel");
  const $existingLeft = $("#st-extension-left-panel");
  const $existingToggle = $("#st-extension-mobile-drawer-toggle");
  const $existingLeftToggle = $("#st-extension-mobile-drawer-left-toggle");
  if ($existing.length > 0) {
    $existing.remove();
  }
  if ($existingLeft.length > 0) {
    $existingLeft.remove();
  }
  if ($existingToggle.length > 0) {
    $existingToggle.remove();
  }
  if ($existingLeftToggle.length > 0) {
    $existingLeftToggle.remove();
  }

  $("body").append($panel);
}

function registerSlashCommands() {
  const context = getContext();
  
  if (!context.registerSlashCommand) {
    console.warn("CHARacter MANager: Slash commands not available");
    return;
  }

  context.registerSlashCommand(
    "charmander-descriptions",
    async (args, trigger) => {
      console.log("Generating descriptions with args:", JSON.stringify(args), "and trigger:", trigger);
      const filter = String(trigger || "last").trim();
      const validFilters = ["you", "me", "scene", "raw_last", "last", "face", "background"];
      
      if (!validFilters.includes(filter)) {
        return `Invalid filter: ${filter}. Valid filters: ${validFilters.join(", ")}`;
      }

      const ctx = getContext();
      const data = loadCharacterDetails(ctx);
      
      // Store the target for future use
      data.lastGenDescriptionsTarget = filter;
      const { saveCharacterDetails } = await import("./src/character-details-store.js");
      saveCharacterDetails(ctx, data);
      
      const genDescriptions = buildGenDescriptions(data, filter);
      
      // Set local variable using executeSlashCommands
      if (ctx.executeSlashCommandsWithOptions) {
        await ctx.executeSlashCommandsWithOptions(`/setvar key=genDescriptions ${genDescriptions}`);
      } else if (ctx.executeSlashCommands) {
        await ctx.executeSlashCommands(`/setvar key=genDescriptions ${genDescriptions}`);
      }
      
      return genDescriptions || "(empty)";
    },
    [],
    "<span class='monospace'>(you|me|scene|raw_last|last|face|background)</span> – Generate character descriptions with filter. Saves to {{getvar::genDescriptions}}.",
    true,
    true
  );

  const canUseTypedSlashApi = Boolean(
    context?.SlashCommandParser?.addCommandObject
    && context?.SlashCommand?.fromProps
    && context?.SlashCommandNamedArgument?.fromProps
    && context?.SlashCommandArgument?.fromProps
    && context?.ARGUMENT_TYPE
    && context?.SlashCommandEnumValue
  );

  if (!canUseTypedSlashApi) {
    console.error("CHARacter MANager: Typed slash command API is required (latest ST build).");
    return;
  }

  const { SlashCommandParser, SlashCommand, SlashCommandNamedArgument, SlashCommandArgument, ARGUMENT_TYPE, SlashCommandEnumValue } = context;
  const charEnumProvider = () => {
    const data = loadCharacterDetails(getContext());
    const values = [];
    for (const character of Array.isArray(data?.characters) ? data.characters : []) {
      const id = String(character?.id || "").trim();
      const name = String(character?.name || "").trim();

      if (id) {
        values.push(new SlashCommandEnumValue(id, name ? `Character ID (${name})` : "Character ID"));
      }
      if (name) {
        values.push(new SlashCommandEnumValue(name, id ? `Character name (ID: ${id})` : "Character name"));
      }
    }

    return values;
  };
  const keyEnumProvider = () => {
    const values = [];
    const seen = new Set();

    for (const field of getCustomFieldsSettings()) {
      const varName = String(field?.varName || "").trim();
      if (!varName || seen.has(varName)) {
        continue;
      }

      seen.add(varName);
      const scopeLabel = field?.target ? `scope: ${field.target}` : "configured custom field";
      values.push(new SlashCommandEnumValue(varName, scopeLabel));
    }

    return values;
  };

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: "getCharVar",
    callback: async (args, value) => {
      const charNameOrId = String(args?.char || args?.name || args?.id || "").trim();
      const varName = String(args?.key || value || "").trim();

      if (!charNameOrId || !varName) {
        return "Usage: /getCharVar name=<charNameOrId> key=<varName>";
      }

      const ctx = getContext();
      const data = loadCharacterDetails(ctx);
      return formatVariableValue(getCharScopedVariableValue(ctx, data, charNameOrId, varName));
    },
    returns: "the character variable value",
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: "char",
        aliasList: ["name", "id"],
        description: "character name or 3-letter ID (ID is preferred if ambiguous)",
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        enumProvider: charEnumProvider,
      }),
      SlashCommandNamedArgument.fromProps({
        name: "key",
        description: "object variable name",
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
        enumProvider: keyEnumProvider,
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: "key (alternative to key=...)",
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
        enumProvider: keyEnumProvider,
      }),
    ],
    helpString: `
      <div>
        Get per-character value from a chat-local object variable and pass it down the pipe.
      </div>
      <div>
        <strong>Examples:</strong>
        <ul>
          <li><pre><code class="language-stscript">/getCharVar name=Areinu key=stats</code></pre></li>
          <li><pre><code class="language-stscript">/getCharVar id=olx stats</code></pre></li>
        </ul>
      </div>
    `,
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: "setCharVar",
    callback: async (args, value) => {
      const charNameOrId = String(args?.char || args?.name || args?.id || "").trim();
      const varName = String(args?.key || "").trim();
      const hasNamedValue = Object.prototype.hasOwnProperty.call(args || {}, "value");
      const nextValue = hasNamedValue ? args.value : value;

      if (!charNameOrId || !varName) {
        return "Usage: /setCharVar name=<charNameOrId> key=<varName> <value>";
      }

      if (!hasNamedValue && String(nextValue ?? "").trim() === "") {
        return "Usage: /setCharVar name=<charNameOrId> key=<varName> <value>";
      }

      const ctx = getContext();
      const data = loadCharacterDetails(ctx);
      const result = setCharScopedVariableValue(ctx, data, charNameOrId, varName, nextValue ?? "");
      if (!result.ok) {
        return result.message;
      }

      return formatVariableValue(result.value);
    },
    returns: "the set character variable value",
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: "char",
        aliasList: ["name", "id"],
        description: "character name or 3-letter ID (ID is preferred if ambiguous)",
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: true,
        enumProvider: charEnumProvider,
      }),
      SlashCommandNamedArgument.fromProps({
        name: "key",
        description: "object variable name",
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: true,
        enumProvider: keyEnumProvider,
      }),
      SlashCommandNamedArgument.fromProps({
        name: "value",
        description: "value to set (optional if passed as unnamed argument)",
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.BOOLEAN, ARGUMENT_TYPE.LIST, ARGUMENT_TYPE.DICTIONARY],
        isRequired: false,
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: "value",
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER, ARGUMENT_TYPE.BOOLEAN, ARGUMENT_TYPE.LIST, ARGUMENT_TYPE.DICTIONARY],
        isRequired: false,
      }),
    ],
    helpString: `
      <div>
        Set per-character value in a chat-local object variable and pass the value down the pipe.
      </div>
      <div>
        <strong>Examples:</strong>
        <ul>
          <li><pre><code class="language-stscript">/setCharVar name=Areinu key=stats 5 str\\n5 dex</code></pre></li>
          <li><pre><code class="language-stscript">/setCharVar id=olx key=stats value="4 str\\n6 dex"</code></pre></li>
        </ul>
      </div>
    `,
  }));
}

// This function is called when the extension is loaded
jQuery(async () => {
  // This is an example of loading HTML from a file
  const settingsHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, "deredere");
  const panelHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, "panel");

  // Append settingsHtml to extensions_settings
  // extension_settings and extensions_settings2 are the left and right columns of the settings menu
  // Left should be extensions that deal with system functions and right should be visual/UI related 
  $("#extensions_settings").append(settingsHtml);
  appendRightPanel(panelHtml);
  populateCustomResolutionDropdowns();

  // These are examples of listening for events
  $("#descriptions_prompt").on("input", (event) => {
    extension_settings[extensionName].descriptions_prompt = $(event.target).val();
    saveSettingsDebounced();
  });

  $("#show_image_generation_buttons").on("change", (event) => {
    extension_settings[extensionName].show_image_generation_buttons = Boolean($(event.target).prop("checked"));
    emitImageSettingsChanged();
    saveSettingsDebounced();
  });

  $("#show_mods_panel").on("change", (event) => {
    extension_settings[extensionName].show_mods_panel = Boolean($(event.target).prop("checked"));
    $(document).trigger("st-charmander:mods-panel-visibility-changed");
    saveSettingsDebounced();
  });

  $("#use_tall_mods_in_desktop_mode").on("change", (event) => {
    extension_settings[extensionName].use_tall_mods_in_desktop_mode = Boolean($(event.target).prop("checked"));
    $(document).trigger("st-charmander:mods-layout-changed");
    saveSettingsDebounced();
  });

  $("#auto_add_persona_character_for_new_chat").on("change", (event) => {
    extension_settings[extensionName].auto_add_persona_character_for_new_chat = Boolean($(event.target).prop("checked"));
    saveSettingsDebounced();
  });

  $("#switcher_character_limit").on("change input", (event) => {
    const normalized = normalizeSwitcherCharacterLimit($(event.target).val());
    extension_settings[extensionName].switcher_character_limit = normalized;
    $(event.target).val(String(normalized));
    saveSettingsDebounced();
  });

  $("#llm_history_message_limit").on("change input", (event) => {
    const normalized = normalizeLlmHistoryMessageLimit($(event.target).val());
    extension_settings[extensionName].llm_history_message_limit = normalized;
    $(event.target).val(String(normalized));
    saveSettingsDebounced();
  });

  $("#llm_clothing_plain_text").on("change", (event) => {
    extension_settings[extensionName].llm_clothing_plain_text = Boolean($(event.target).prop("checked"));
    renderClothingInterpretationPromptField();
    saveSettingsDebounced();
  });

  $("#clothing_interpretation_prompt").on("input", (event) => {
    const key = getActiveClothingInterpretationPromptKey();
    extension_settings[extensionName][key] = $(event.target).val();
    saveSettingsDebounced();
  });

  $("#use_crop_tool_for_avatars").on("change", (event) => {
    extension_settings[extensionName].use_crop_tool_for_avatars = Boolean($(event.target).prop("checked"));
    saveSettingsDebounced();
  });

  $("#remove_image_prompt_newlines").on("change", (event) => {
    extension_settings[extensionName].remove_image_prompt_newlines = Boolean($(event.target).prop("checked"));
    saveSettingsDebounced();
  });

  $("#show_quick_resolution_button").on("change", (event) => {
    extension_settings[extensionName].show_quick_resolution_button = Boolean($(event.target).prop("checked"));
    emitImageSettingsChanged();
    saveSettingsDebounced();
  });

  $("#visual_command_start").on("input", (event) => {
    extension_settings[extensionName].visual_command_start = $(event.target).val();
    saveSettingsDebounced();
  });

  $("#closeup_portrait_prompt").on("input", (event) => {
    extension_settings[extensionName].closeup_portrait_prompt = $(event.target).val();
    saveSettingsDebounced();
  });

  $("#full_body_portrait_prompt").on("input", (event) => {
    extension_settings[extensionName].full_body_portrait_prompt = $(event.target).val();
    saveSettingsDebounced();
  });

  $("#describe_background_prompt").on("input", (event) => {
    extension_settings[extensionName].describe_background_prompt = $(event.target).val();
    saveSettingsDebounced();
  });

  $("#describe_viewer_eyes_prompt").on("input", (event) => {
    extension_settings[extensionName].describe_viewer_eyes_prompt = $(event.target).val();
    saveSettingsDebounced();
  });

  $("#describe_current_scene_prompt").on("input", (event) => {
    extension_settings[extensionName].describe_current_scene_prompt = $(event.target).val();
    saveSettingsDebounced();
  });

  for (const { selector, key } of resolutionSelectMappings) {
    $(selector).on("change", (event) => {
      extension_settings[extensionName].custom_resolutions = extension_settings[extensionName].custom_resolutions || { ...defaultSettings.custom_resolutions };
      const nextValue = String($(event.target).val() || DEFAULT_RESOLUTION_OPTION);
      extension_settings[extensionName].custom_resolutions[key] = nextValue in IMAGE_RESOLUTION_OPTIONS ? nextValue : DEFAULT_RESOLUTION_OPTION;
      emitImageSettingsChanged();
      saveSettingsDebounced();
    });
  }

  $("#quick-resolutions-add").on("click", () => {
    const quickResolutions = getQuickResolutionSettings();
    const nextResolutionId = Object.keys(IMAGE_RESOLUTION_OPTIONS).find((id) => !quickResolutions.includes(id)) || Object.keys(IMAGE_RESOLUTION_OPTIONS)[0] || "";
    if (!nextResolutionId) {
      return;
    }

    quickResolutions.push(nextResolutionId);
    extension_settings[extensionName].quick_resolutions = normalizeQuickResolutionList(quickResolutions);
    renderQuickResolutionSettings();
    updateImageGenerationSettingsState();
    emitImageSettingsChanged();
    saveSettingsDebounced();
  });

  $("#quick-resolutions-list").on("change", "select[data-field='quick-resolution']", (event) => {
    const quickResolutions = getQuickResolutionSettings();
    const index = Number($(event.target).data("index"));
    if (!Number.isInteger(index) || index < 0 || index >= quickResolutions.length) {
      return;
    }

    quickResolutions[index] = String($(event.target).val() || "");
    extension_settings[extensionName].quick_resolutions = normalizeQuickResolutionList(quickResolutions);

    const activeQuickResolution = normalizeQuickResolutionId(extension_settings[extensionName].active_quick_resolution);
    extension_settings[extensionName].active_quick_resolution = extension_settings[extensionName].quick_resolutions.includes(activeQuickResolution)
      ? activeQuickResolution
      : DEFAULT_RESOLUTION_OPTION;

    renderQuickResolutionSettings();
    updateImageGenerationSettingsState();
    emitImageSettingsChanged();
    saveSettingsDebounced();
  });

  $("#quick-resolutions-list").on("click", "[data-action='remove-quick-resolution']", (event) => {
    const quickResolutions = getQuickResolutionSettings();
    const index = Number($(event.currentTarget).data("index"));
    if (!Number.isInteger(index) || index < 0 || index >= quickResolutions.length) {
      return;
    }

    quickResolutions.splice(index, 1);
    extension_settings[extensionName].quick_resolutions = normalizeQuickResolutionList(quickResolutions);

    const activeQuickResolution = normalizeQuickResolutionId(extension_settings[extensionName].active_quick_resolution);
    extension_settings[extensionName].active_quick_resolution = extension_settings[extensionName].quick_resolutions.includes(activeQuickResolution)
      ? activeQuickResolution
      : DEFAULT_RESOLUTION_OPTION;

    renderQuickResolutionSettings();
    updateImageGenerationSettingsState();
    emitImageSettingsChanged();
    saveSettingsDebounced();
  });

  $("#reset-closeup-portrait-prompt").on("click", () => {
    extension_settings[extensionName].closeup_portrait_prompt = defaultSettings.closeup_portrait_prompt;
    $("#closeup_portrait_prompt").val(defaultSettings.closeup_portrait_prompt);
    saveSettingsDebounced();
  });

  $("#reset-full-body-portrait-prompt").on("click", () => {
    extension_settings[extensionName].full_body_portrait_prompt = defaultSettings.full_body_portrait_prompt;
    $("#full_body_portrait_prompt").val(defaultSettings.full_body_portrait_prompt);
    saveSettingsDebounced();
  });

  $("#reset-describe-background-prompt").on("click", () => {
    extension_settings[extensionName].describe_background_prompt = defaultSettings.describe_background_prompt;
    $("#describe_background_prompt").val(defaultSettings.describe_background_prompt);
    saveSettingsDebounced();
  });

  $("#reset-describe-viewer-eyes-prompt").on("click", () => {
    extension_settings[extensionName].describe_viewer_eyes_prompt = defaultSettings.describe_viewer_eyes_prompt;
    $("#describe_viewer_eyes_prompt").val(defaultSettings.describe_viewer_eyes_prompt);
    saveSettingsDebounced();
  });

  $("#reset-describe-current-scene-prompt").on("click", () => {
    extension_settings[extensionName].describe_current_scene_prompt = defaultSettings.describe_current_scene_prompt;
    $("#describe_current_scene_prompt").val(defaultSettings.describe_current_scene_prompt);
    saveSettingsDebounced();
  });

  $("#reset-descriptions-prompt").on("click", () => {
    extension_settings[extensionName].descriptions_prompt = defaultSettings.descriptions_prompt;
    $("#descriptions_prompt").val(defaultSettings.descriptions_prompt);
    saveSettingsDebounced();
  });

  $("#reset-clothing-interpretation-prompt").on("click", () => {
    const key = getActiveClothingInterpretationPromptKey();
    const nextValue = defaultSettings[key] || "";
    extension_settings[extensionName][key] = nextValue;
    $("#clothing_interpretation_prompt").val(nextValue);
    saveSettingsDebounced();
  });

  $("#reset-visual-command-start-prompt").on("click", () => {
    extension_settings[extensionName].visual_command_start = defaultSettings.visual_command_start;
    $("#visual_command_start").val(defaultSettings.visual_command_start);
    saveSettingsDebounced();
  });

  $("#custom-fields-add").on("click", () => {
    const fields = getCustomFieldsSettings();
    fields.push({ label: "", varName: "", target: "viewer" });
    extension_settings[extensionName].custom_fields = fields;
    renderCustomFieldsSettings();
    saveSettingsDebounced();
  });

  $("#custom-fields-list").on("input change", "input, select", () => {
    extension_settings[extensionName].custom_fields = readCustomFieldsFromDom();
    updateImageGenerationSettingsState();
    saveSettingsDebounced();
  });

  $("#custom-fields-list").on("click", "[data-action='remove-custom-field']", (event) => {
    $(event.currentTarget).closest(".custom-field-row").remove();
    extension_settings[extensionName].custom_fields = readCustomFieldsFromDom();
    updateImageGenerationSettingsState();
    saveSettingsDebounced();
  });

  // Load settings when starting things up (if you have any)
  loadSettings();
  updateImageGenerationSettingsState();

  // Register slash commands
  registerSlashCommands();
  registerCharacterDetailsGlobalMacros();
  registerCharacterDetailsCharVarMacros();

  initCharacterDetailsPanel();
  initModPanel({ getState: getCharacterDetailsState });
  initCharacterDetailsPromptInjector();

  const ctx = getContext();
  if (ctx.eventSource && ctx.eventTypes) {
    ctx.eventSource.on(ctx.eventTypes.SETTINGS_UPDATED, () => updateImageGenerationSettingsState());
  }
});
