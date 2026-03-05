// The main script for the extension
// The following are examples of some basic extension functionality

//You'll likely need to import extension_settings, getContext, and loadExtensionSettings from extensions.js
import { extension_settings, getContext, loadExtensionSettings, findExtension } from "../../../extensions.js";
import { initCharacterDetailsPanel } from "./src/character-details-panel.js";
import { loadCharacterDetails } from "./src/character-details-store.js";
import { buildGenDescriptions } from "./src/character-details-descriptions.js";
import { initCharacterDetailsPromptInjector } from "./src/character-details-prompt-injector.js";
import { IMAGE_RESOLUTION_OPTIONS, DEFAULT_RESOLUTION_OPTION } from "./src/image-resolution-options.js";
import { DEFAULT_DESCRIPTIONS_PROMPT } from "./src/character-details-prompts.js";
import { randomizeStats } from "../stat-randomizer/src/stat-randomizer.js";

//You'll likely need to import some other functions from the main script
import { saveSettingsDebounced } from "../../../../script.js";

// Keep track of where your extension is located, name should match repo name
const extensionName = "st-extension-example";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];
const DEFAULT_JSON_INTERPRETATION_PROMPT = "Interpretation for clothing state (authoritative):\n- The JSON is the source of truth for what is currently worn.\n- In narration, mention only the outermost visible layers and items with state=partial that are visible.\n- Do not mention covered inner layers while they are still covered.\n- Covered layers are included for continuity only; if outer layers are removed later, newly revealed layers must match this data and story logic.\n- Keep clothing continuity logically consistent with scene progression.";
const DEFAULT_PLAIN_TEXT_INTERPRETATION_PROMPT = "Interpretation for clothing state (authoritative):\n- The plain-text clothing list is the source of truth for what is currently worn.\n- In narration, mention only currently visible outer layers and partially visible items.\n- Do not mention covered inner layers while they are still covered.\n- Covered layers are included for continuity only; if outer layers are removed later, newly revealed layers must match this data and story logic.\n- Keep clothing continuity logically consistent with scene progression.";
const resolutionSelectMappings = [
  { selector: "#custom-resolution-portrait", key: "portrait" },
  { selector: "#custom-resolution-fullbody", key: "fullbody" },
  { selector: "#custom-resolution-background", key: "background" },
  { selector: "#custom-resolution-viewer-eyes", key: "viewer_eyes" },
  { selector: "#custom-resolution-scene", key: "scene" },
];

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
  use_crop_tool_for_avatars: false,
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
  $("#use_crop_tool_for_avatars").prop("checked", extension_settings[extensionName].use_crop_tool_for_avatars === true);
  $("#visual_command_start").val(extension_settings[extensionName].visual_command_start || defaultSettings.visual_command_start);
  $("#closeup_portrait_prompt").val(extension_settings[extensionName].closeup_portrait_prompt || defaultSettings.closeup_portrait_prompt);
  $("#full_body_portrait_prompt").val(extension_settings[extensionName].full_body_portrait_prompt || defaultSettings.full_body_portrait_prompt);
  $("#describe_background_prompt").val(extension_settings[extensionName].describe_background_prompt || defaultSettings.describe_background_prompt);
  $("#describe_viewer_eyes_prompt").val(extension_settings[extensionName].describe_viewer_eyes_prompt || defaultSettings.describe_viewer_eyes_prompt);
  $("#describe_current_scene_prompt").val(extension_settings[extensionName].describe_current_scene_prompt || defaultSettings.describe_current_scene_prompt);
  for (const { selector, key } of resolutionSelectMappings) {
    $(selector).val(extension_settings[extensionName].custom_resolutions[key] || DEFAULT_RESOLUTION_OPTION);
  }
  updateImageGenerationSettingsState();
  renderCustomFieldsSettings();
}

function populateCustomResolutionDropdowns() {
  for (const { selector } of resolutionSelectMappings) {
    const select = $(selector);
    if (!select.length) {
      continue;
    }

    select.empty();
    select.append('<option value="default">default</option>');
    for (const [id, resolution] of Object.entries(IMAGE_RESOLUTION_OPTIONS)) {
      select.append(`<option value="${id}">${resolution.name}</option>`);
    }
  }
}

function updateImageGenerationSettingsState() {
  const hasImageGeneration = Boolean(findExtension("stable-diffusion")?.enabled);
  const disabled = !hasImageGeneration;
  const controls = $("#show_image_generation_buttons, #visual_command_start, #closeup_portrait_prompt, #full_body_portrait_prompt, #describe_background_prompt, #describe_viewer_eyes_prompt, #describe_current_scene_prompt, #custom-resolution-portrait, #custom-resolution-fullbody, #custom-resolution-background, #custom-resolution-viewer-eyes, #custom-resolution-scene, #reset-visual-command-start-prompt, #reset-closeup-portrait-prompt, #reset-full-body-portrait-prompt, #reset-describe-background-prompt, #reset-describe-viewer-eyes-prompt, #reset-describe-current-scene-prompt");
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
  return {
    label: String(field?.label || "").trim(),
    varName: String(field?.varName || "").trim(),
    target: field?.target === "viewer" ? "viewer" : "mc",
  };
}

function getCustomFieldsSettings() {
  const fields = extension_settings[extensionName]?.custom_fields;
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.map(normalizeCustomField);
}

function readCustomFieldsFromDom() {
  const fields = [];
  $("#custom-fields-list .custom-field-row").each((index, row) => {
    const $row = $(row);
    const label = String($row.find("[data-field='label']").val() || "").trim();
    const varName = String($row.find("[data-field='varName']").val() || "").trim();
    const target = $row.find("[data-field='target']").val() === "viewer" ? "viewer" : "mc";
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
    const target = field.target === "viewer" ? "viewer" : "mc";
    list.append(`
      <div class="custom-field-row">
        <input class="text_pole" type="text" placeholder="Field label" data-field="label" value="${escapeHtml(field.label)}" />
        <input class="text_pole" type="text" placeholder="Local var name" data-field="varName" value="${escapeHtml(field.varName)}" />
        <select class="text_pole" data-field="target">
          <option value="mc" ${target === "mc" ? "selected" : ""}>MC</option>
          <option value="viewer" ${target === "viewer" ? "selected" : ""}>Viewer</option>
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
    "randomize-stats",
    async () => {
      try {
        const ctx = getContext();
        const result = await randomizeStats(ctx);
        return result.descDetails;
      } catch (error) {
        const message = error?.message || "Unknown randomizer error";
        return `randomize-stats error: ${message}`;
      }
    },
    [],
    "Randomize stats from lorebook config and set local vars: {{getvar::descSize}} and {{getvar::descDetails}}.",
    true,
    true,
  );

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
}

// This function is called when the extension is loaded
jQuery(async () => {
  // This is an example of loading HTML from a file
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
  const panelHtml = await $.get(`${extensionFolderPath}/panel.html`);

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
    saveSettingsDebounced();
  });

  $("#show_mods_panel").on("change", (event) => {
    extension_settings[extensionName].show_mods_panel = Boolean($(event.target).prop("checked"));
    $(document).trigger("st-extension-example:mods-panel-visibility-changed");
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
      saveSettingsDebounced();
    });
  }

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

  initCharacterDetailsPanel();
  initCharacterDetailsPromptInjector();

  const ctx = getContext();
  if (ctx.eventSource && ctx.eventTypes) {
    ctx.eventSource.on(ctx.eventTypes.SETTINGS_UPDATED, () => updateImageGenerationSettingsState());
  }
});
