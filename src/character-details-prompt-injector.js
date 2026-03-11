import { getContext, extension_settings } from "../../../../extensions.js";
import { loadCharacterDetails } from "./character-details-store.js";
import { buildCharacterVisualDescription, shouldUsePlainTextClothingForLlm } from "./character-details-descriptions.js";

const SYSTEM_MARKER = "[CHARMANDER_CLOTHING_STATE]";
const extensionName = "st-extension-example";
const DEFAULT_JSON_INTERPRETATION_PROMPT = "Interpretation for clothing state (authoritative):\n- The JSON is the source of truth for what is currently worn.\n- In narration, mention only the outermost visible layers and items with state=partial that are visible.\n- Do not mention covered inner layers while they are still covered.\n- Covered layers are included for continuity only; if outer layers are removed later, newly revealed layers must match this data and story logic.\n- Keep clothing continuity logically consistent with scene progression.";
const DEFAULT_PLAIN_TEXT_INTERPRETATION_PROMPT = "Interpretation for clothing state (authoritative):\n- The plain-text clothing list is the source of truth for what is currently worn.\n- In narration, mention only currently visible outer layers and partially visible items.\n- Do not mention covered inner layers while they are still covered.\n- Covered layers are included for continuity only; if outer layers are removed later, newly revealed layers must match this data and story logic.\n- Keep clothing continuity logically consistent with scene progression.";

function normalizeCustomField(field) {
  const rawTarget = String(field?.target || "").trim().toLowerCase();
  const target = rawTarget === "viewer" || rawTarget === "everyone" ? rawTarget : "mc";
  return {
    label: String(field?.label || "").trim(),
    varName: String(field?.varName || "").trim(),
    target,
  };
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
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!normalizedKey) {
      continue;
    }
    normalized[normalizedKey] = entry;
  }

  return normalized;
}

function getCustomFieldsSettings() {
  const fields = extension_settings[extensionName]?.custom_fields;
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.map(normalizeCustomField);
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

function buildCustomFieldsForCharacter(character, data, context) {
  const fields = getCustomFieldsSettings().filter((field) => field.label && field.varName);
  if (!fields.length) {
    return [];
  }

  const viewerId = data.viewerCharacterId || null;
  const mcId = data.mainCharacterId || null;
  const results = [];

  for (const field of fields) {
    if (field.target === "everyone") {
      const valueByCharacterId = parseEveryoneVarMap(context.variables?.local?.get?.(field.varName));
      const value = formatVariableValue(valueByCharacterId[String(character.id || "").toLowerCase()]);
      results.push({
        label: field.label,
        varName: field.varName,
        value,
      });
      continue;
    }

    const targetId = field.target === "viewer" ? viewerId : mcId;
    if (!targetId || targetId !== character.id) {
      continue;
    }

    const value = formatVariableValue(context.variables?.local?.get?.(field.varName));
    results.push({
      label: field.label,
      varName: field.varName,
      value,
    });
  }

  return results;
}

function buildLayerPayload(layer) {
  return {
    name: typeof layer.name === "string" ? layer.name : "",
    state: layer.state === "partial" || layer.state === "off" ? layer.state : "on",
    children: Array.isArray(layer.children) ? layer.children.map(buildLayerPayload) : [],
  };
}

function buildGroupPayload(group) {
  return {
    name: typeof group.name === "string" ? group.name : "",
    layers: Array.isArray(group.layers) ? group.layers.map(buildLayerPayload) : [],
  };
}

function buildCharacterPayload(character, data, context) {
  const groups = Array.isArray(character.clothingGroups) ? character.clothingGroups : [];
  const activeGroup = character.activeGroupId
    ? groups.find((group) => group.id === character.activeGroupId)
    : null;
  const groupsToUse = activeGroup ? [activeGroup] : groups;

  return {
    name: typeof character.name === "string" ? character.name : "Unnamed",
    appearance: typeof character.appearance === "string" ? character.appearance : "",
    clothingGroups: groupsToUse.map(buildGroupPayload),
    customFields: buildCustomFieldsForCharacter(character, data, context),
  };
}

function getInterpretationPrompt(usePlainText) {
  const key = usePlainText
    ? "llm_clothing_plain_text_interpretation_prompt"
    : "llm_clothing_json_interpretation_prompt";
  const fallback = usePlainText
    ? DEFAULT_PLAIN_TEXT_INTERPRETATION_PROMPT
    : DEFAULT_JSON_INTERPRETATION_PROMPT;

  return String(extension_settings[extensionName]?.[key] || fallback).trim();
}

function buildSystemMessage(data, context) {
  const presentCharacters = (data.characters || []).filter((character) => character.presence);
  if (presentCharacters.length === 0) {
    return "";
  }

  const usePlainText = shouldUsePlainTextClothingForLlm();
  const interpretationPrompt = getInterpretationPrompt(usePlainText);

  if (usePlainText) {
    const lines = presentCharacters
      .map((character) => buildCharacterVisualDescription(data, character.id, {
        includeInGenerationOnly: false,
        useLlmPlainTextClothing: true,
      }))
      .filter(Boolean);

    if (!lines.length) {
      return "";
    }

    return interpretationPrompt
      ? `${SYSTEM_MARKER}\nCurrent worn items (plain text, authoritative):\n${lines.join("\n\n")}\n\n${interpretationPrompt}`
      : `${SYSTEM_MARKER}\nCurrent worn items (plain text, authoritative):\n${lines.join("\n\n")}`;
  }

  const payload = {
    characters: presentCharacters.map((character) => buildCharacterPayload(character, data, context)),
  };

  return interpretationPrompt
    ? `${SYSTEM_MARKER}\nCurrent worn items JSON (authoritative):\n${JSON.stringify(payload, null, 2)}\n\n${interpretationPrompt}`
    : `${SYSTEM_MARKER}\nCurrent worn items JSON (authoritative):\n${JSON.stringify(payload, null, 2)}`;
}

function onChatCompletionPromptReady(eventData) {
  const { chat, dryRun } = eventData || {};
  if (dryRun || !Array.isArray(chat)) {
    return;
  }

  const context = getContext();
  const data = loadCharacterDetails(context);
  const content = buildSystemMessage(data, context);
  if (!content) {
    return;
  }

  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const message = chat[i];
    if (message?.role === "system" && typeof message.content === "string" && message.content.includes(SYSTEM_MARKER)) {
      chat.splice(i, 1);
    }
  }

  const lastMessage = chat[chat.length - 1];
  if (lastMessage?.role === "system") {
    chat.splice(chat.length - 1, 0, { role: "system", content });
  } else {
    chat.push({ role: "system", content });
  }
}

function initCharacterDetailsPromptInjector() {
  const context = getContext();
  if (!context?.eventSource || !context?.eventTypes?.CHAT_COMPLETION_PROMPT_READY) {
    return;
  }

  context.eventSource.on(
    context.eventTypes.CHAT_COMPLETION_PROMPT_READY,
    onChatCompletionPromptReady
  );
}

export { initCharacterDetailsPromptInjector };
