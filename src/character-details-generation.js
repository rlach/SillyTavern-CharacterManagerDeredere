import { getContext } from "../../../../extensions.js";
import { extension_settings } from "../../../../extensions.js";
import { loadCharacterDetails, normalizeCharacterDetails } from "./character-details-store.js";
import { setCharacterDetailsData } from "./character-details-panel.js";
import { showCharacterDetailsDiff } from "./character-details-diff-modal.js";
import { buildCharacterVisualDescription } from "./character-details-descriptions.js";
import { COMPACT_OUTFIT_ONLY_CHANGELOG_SHAPE, DEFAULT_DESCRIPTIONS_PROMPT } from "./character-details-prompts.js";

const extensionName = "st-extension-example";
let activeDescriptionsGeneration = null;
const FORBIDDEN_NAME_CHARS = /[\[\]\/|]/g;
const SHORT_ID_REGEX = /^[a-z0-9]{3}$/i;
const NON_SUBSTANTIVE_TOKENS = new Set(["a", "an", "the", "and", "or", "with", "of", "to", "in", "on", "at", "for", "by"]);
const STRICT_JSON_OUTPUT_RULES = "\n\nOUTPUT FORMAT (STRICT):\n"
  + "- Return exactly one valid JSON object in a SINGLE LINE.\n"
  + "- No pretty formatting, no indentation, no line breaks/newlines.\n"
  + "- No markdown, no code fences, and no commentary before or after JSON.";

function applyStrictJsonOutputRules(prompt) {
  return `${String(prompt || "").trim()}${STRICT_JSON_OUTPUT_RULES}`;
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

  if (message.is_system === true) {
    return false;
  }

  return true;
}

function getPersonaDescriptionSystemMessage(context) {
  const personaDescription = String(context?.powerUserSettings?.persona_description || "").trim();
  if (!personaDescription) {
    return "";
  }

  return `Persona Description:\n${personaDescription}`;
}

function buildChatCompletionContextMessages(context) {
  const messages = [];

  const personaDescriptionMessage = getPersonaDescriptionSystemMessage(context);
  if (personaDescriptionMessage) {
    messages.push({ role: "system", content: personaDescriptionMessage });
  }

  return messages;
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

function buildLimitedChatPrompt(context, charmanderClothingContext, systemInstructionPrompt) {
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

  const contextMessages = buildChatCompletionContextMessages(context);
  if (contextMessages.length > 0 || charmanderClothingContext) {
    const contextBlocks = [
      String(charmanderClothingContext || "").trim(),
      ...contextMessages.map((message) => String(message.content || "").trim()).filter(Boolean),
    ].filter(Boolean);

    if (contextBlocks.length > 0) {
      prompt.push({ role: "system", content: contextBlocks.join("\n\n") });
    }
  }

  if (systemInstructionPrompt) {
    prompt.push({ role: "system", content: String(systemInstructionPrompt).trim() });
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

function buildCustomFieldsForCharacter(character, data, context, includeInGenerationOnly) {
  const fields = getCustomFieldsSettings().filter((field) => field.label && field.varName);
  if (!fields.length) {
    return [];
  }

  const viewerId = data.viewerCharacterId || null;
  const mcId = data.mainCharacterId || null;
  const results = [];

  for (const field of fields) {
    if (includeInGenerationOnly && !data.customFieldGeneratorToggles?.[field.varName]) {
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

function getLayerEffect(layer) {
  if (layer?.state === "off") {
    return "none";
  }

  if (layer?.state === "partial") {
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

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function collectHiddenDescendantNames(layers, occlusion) {
  const result = [];
  for (const layer of Array.isArray(layers) ? layers : []) {
    const name = String(layer?.name || "").trim();
    const nextOcclusion = combineOcclusion(occlusion, getLayerEffect(layer));
    const visibilityOverride = layer?.visibilityOverride === true;

    if (layer?.state !== "off" && occlusion === "full" && !visibilityOverride && name) {
      result.push(name);
    }

    result.push(...collectHiddenDescendantNames(layer?.children || [], nextOcclusion));
  }

  return result;
}

function collectLayerItemsWithUnderneath(layer, occlusion) {
  const items = [];
  const name = String(layer?.name || "").trim();
  const layerEffect = getLayerEffect(layer);
  const nextOcclusion = combineOcclusion(occlusion, layerEffect);
  const visibilityOverride = layer?.visibilityOverride === true;
  const forcePartiallyVisible = visibilityOverride && occlusion === "full";

  if (layer?.state !== "off" && (occlusion !== "full" || forcePartiallyVisible) && name) {
    const visibleLabel = (occlusion === "partial" || forcePartiallyVisible) ? `partially visible ${name}` : name;
    const underneath = Array.from(new Set(collectHiddenDescendantNames(layer?.children || [], nextOcclusion)));
    if (underneath.length > 0) {
      items.push(`${visibleLabel} (${formatList(underneath)} underneath)`);
    } else {
      items.push(visibleLabel);
    }
  }

  for (const child of layer?.children || []) {
    items.push(...collectLayerItemsWithUnderneath(child, nextOcclusion));
  }

  return items;
}

function collectGroupClothingItems(group) {
  const items = [];
  for (const layer of group?.layers || []) {
    items.push(...collectLayerItemsWithUnderneath(layer, "none"));
  }
  return items;
}

function buildCharacterTextWithAlternateCostumes(character, data) {
  const base = buildCharacterVisualDescription(data, character?.id, {
    includeInGenerationOnly: true,
    useLlmPlainTextClothing: true,
  });
  const groups = Array.isArray(character?.clothingGroups) ? character.clothingGroups : [];
  if (groups.length <= 1) {
    return base;
  }

  const activeGroupId = character?.activeGroupId || null;
  const alternates = groups.filter((group) => !activeGroupId || group.id !== activeGroupId);
  if (!alternates.length) {
    return base;
  }

  const alternateLines = alternates.map((group) => {
    const groupName = String(group?.name || "Unnamed outfit").trim() || "Unnamed outfit";
    const items = collectGroupClothingItems(group);
    const wearingText = items.length ? `wearing: ${formatList(items)}` : "wearing: (no visible items)";
    return `- ${groupName}: ${wearingText}`;
  });

  return `${base}\nAlternate costumes:\n${alternateLines.join("\n")}`;
}

function buildClothingContextPrompt(data, context) {
  const allCharacters = Array.isArray(data.characters) ? data.characters : [];
  if (allCharacters.length === 0) {
    return "";
  }

  const presentPayload = {
    characters: allCharacters.map((character) => ({
      ...character,
      customFields: buildCustomFieldsForCharacter(character, data, context, true),
    })),
  };

  const lockedItemsNote = "\n\nIMPORTANT RULES ABOUT LOCKED ITEMS:\n" +
    "- Items marked with \"locked\": true MUST NOT be removed or have their names changed.\n" +
    "- You CAN change names of children of locked items (if the children themselves are not locked).\n" +
    "- You CAN change state of locked items and their children.\n" +
    "- If a layer has \"locked\": true, you cannot remove any of its parent layers.\n" +
    "- When in doubt, preserve locked items exactly as they are.";

  return `${lockedItemsNote}\n\nThis is previous charactersDescription json:\n${JSON.stringify(presentPayload)}`;
}

function buildSystemInstructionPrompt(basePrompt, extraInstruction = "") {
  const trimmedBasePrompt = String(basePrompt || "").trim();
  const trimmedExtraInstruction = String(extraInstruction || "").trim();
  const mergedPrompt = trimmedExtraInstruction
    ? `${trimmedBasePrompt}\n\n${trimmedExtraInstruction}`
    : trimmedBasePrompt;

  return applyStrictJsonOutputRules(mergedPrompt);
}

function buildOutfitGenerationInstruction(character, userRequest) {
  const characterId = normalizeShortId(character?.id);
  const characterName = sanitizeForbiddenText(character?.name || "Unnamed");
  const requestText = sanitizeForbiddenText(userRequest || "");

  return [
    "OUTFIT GENERATION MODE:",
    "- Follow all rules from the main prompt above exactly as-is, except for the following modifications for this run only:",
    "- This is only a scope override for current task, not a new rule set.",
    `- Target character is (${characterId})${characterName}.`,
    `- User outfit request: ${requestText}`,
    "- In this run, ONLY create a new outfit for target character. `present` field is no longer mandatory, but `newOutfits` and `newLayers` fields with exactly one new outfit and as many layers as needed(minimum 1 layer) become mandatory.",
    "- You HAVE TO creatively invent a fitting outfit and layers when needed to satisfy user request and context. Be sure to imagine also underlying layers that will match the outfit.",
    "- Keep strict logical layering and visibility semantics from the main prompt.",
    "- Output should contain only costume additions for this task: newOutfits and matching newLayers.",
    `- Expected single-line JSON shape example: ${COMPACT_OUTFIT_ONLY_CHANGELOG_SHAPE}`,
    "- Do not output unrelated updates in this mode (no character rename/presence/description changes).",
    "- If no valid outfit can be added create outfit `Naked` with single layer `Nude`",
  ].join("\n");
}

async function runCharacterDetailsGeneration(eventOrButton, options = {}) {
  const context = getContext();
  const button = getTriggerButtonFromArgument(eventOrButton);
  const extraInstruction = String(options?.extraInstruction || "").trim();
  const generatingMessage = String(options?.generatingMessage || "Generating descriptions...");
  const successMessage = String(options?.successMessage || "Character details updated.");

  if (activeDescriptionsGeneration?.running) {
    const isSameButton = Boolean(button && activeDescriptionsGeneration.button && activeDescriptionsGeneration.button.is(button));
    if (isSameButton && typeof context?.stopGeneration === "function") {
      activeDescriptionsGeneration.cancelRequested = true;
      activeDescriptionsGeneration.stopSignaled = Boolean(context.stopGeneration());
      return;
    }

    toastr.info("Descriptions generation already in progress. Press stop on the active button to cancel.", "Character Details");
    return;
  }

  activeDescriptionsGeneration = {
    running: true,
    cancelRequested: false,
    stopSignaled: false,
    button,
  };

  setGenerationButtonStopState(button);
  const defaultPrompt = DEFAULT_DESCRIPTIONS_PROMPT;
  const prompt = extension_settings[extensionName]?.descriptions_prompt || defaultPrompt;
  const data = loadCharacterDetails(context);
  const finalPrompt = buildSystemInstructionPrompt(prompt, extraInstruction);
  const clothingContextPrompt = buildClothingContextPrompt(data, context);

  const generationToast = toastr.info(
    `<i class="fa-solid fa-spinner fa-spin"></i> ${generatingMessage}`,
    "Character Details",
    {
      timeOut: 0,
      extendedTimeOut: 0,
      tapToDismiss: false,
      escapeHtml: false,
    }
  );

  let response = "";
  const generationOptions = {
    presence_penalty: -2,
    reasoning_effort: "min",
    include_reasoning: false,
    request_thoughts: false,
  };
  const limitedPromptMessages = buildLimitedChatPrompt(context, clothingContextPrompt, finalPrompt);

  try {
    const quietPrompt = serializePromptMessagesForQuietPrompt(limitedPromptMessages);

    if (activeDescriptionsGeneration?.cancelRequested && activeDescriptionsGeneration?.stopSignaled) {
      throw new DOMException("Cancelled by user", "AbortError");
    }

    if (context.generate) {
      response = await generateWithChatStopSemantics(context, quietPrompt, generationOptions);
    } else {
      throw new Error("Generate API unavailable");
    }
  } catch (error) {
    if (generationToast) {
      toastr.clear(generationToast);
    }

    if (isGenerationAbortError(error) || activeDescriptionsGeneration?.stopSignaled) {
      toastr.info("Descriptions generation cancelled.", "Character Details");
    } else {
      toastr.error(`Error: ${error?.message || "Failed to generate"}`, "Character Details");
    }

    restoreGenerationButtonState(button);
    activeDescriptionsGeneration = null;
    return;
  }

  try {
    const parsed = extractJsonFromResponse(String(response || ""), context);
    const currentData = loadCharacterDetails(context);
    const current = deepClone(currentData);
    const mergedData = applyChangelogToCharacterDetails(currentData, parsed);
    const normalized = normalizeCharacterDetails(mergedData, context);

    if (generationToast) {
      toastr.clear(generationToast);
    }

    showCharacterDetailsDiff(current, normalized, (nextData) => {
      setCharacterDetailsData(nextData);
      toastr.success(successMessage, "Character Details");
    }, {
      ignoreGroupRemovals: true,
      ignoreLayerRemovals: true,
    });
  } catch (error) {
    if (generationToast) {
      toastr.clear(generationToast);
    }
    toastr.error(`Error: ${error?.message || "Invalid JSON"}`, "Character Details");
  } finally {
    restoreGenerationButtonState(button);
    activeDescriptionsGeneration = null;
  }
}

function stripReasoningFromResponse(text, context) {
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

function extractJsonFromResponse(text, context) {
  const sanitizedText = stripReasoningFromResponse(text, context);

  try {
    return JSON.parse(sanitizedText);
  } catch (error) {
    const start = sanitizedText.indexOf("{");
    const end = sanitizedText.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw error;
    }

    const snippet = sanitizedText.slice(start, end + 1);
    return JSON.parse(snippet);
  }
}

function sanitizeLocksForLlmPayload(input) {
  const payload = input && typeof input === "object" ? JSON.parse(JSON.stringify(input)) : input;
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const sanitizeLayers = (layers) => {
    if (!Array.isArray(layers)) {
      return;
    }

    for (const layer of layers) {
      if (!layer || typeof layer !== "object") {
        continue;
      }

      layer.locked = false;
      sanitizeLayers(layer.children);
    }
  };

  const characters = Array.isArray(payload.characters) ? payload.characters : [];
  for (const character of characters) {
    if (!character || typeof character !== "object") {
      continue;
    }

    const groups = Array.isArray(character.clothingGroups) ? character.clothingGroups : [];
    for (const group of groups) {
      if (!group || typeof group !== "object") {
        continue;
      }

      group.locked = false;
      sanitizeLayers(group.layers);
    }
  }

  return payload;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwnProperty(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function tokenizeMeaningfulWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function removeNonSubstantiveTokens(tokens) {
  return (Array.isArray(tokens) ? tokens : []).filter((token) => !NON_SUBSTANTIVE_TOKENS.has(token));
}

function isSubstantiveTextChange(previousValue, nextValue) {
  const previousText = String(previousValue || "").trim();
  const nextText = String(nextValue || "").trim();

  if (!nextText || previousText === nextText) {
    return false;
  }

  const previousTokens = tokenizeMeaningfulWords(previousText);
  const nextTokens = tokenizeMeaningfulWords(nextText);
  if (previousTokens.join(" ") === nextTokens.join(" ")) {
    return false;
  }

  const previousCore = removeNonSubstantiveTokens(previousTokens);
  const nextCore = removeNonSubstantiveTokens(nextTokens);
  if (previousCore.join(" ") === nextCore.join(" ")) {
    return false;
  }

  return true;
}

function findCharacterIndexByPatch(characters, patchCharacter) {
  const patchId = String(patchCharacter?.id || "").trim();
  if (patchId) {
    const byId = characters.findIndex((character) => String(character?.id || "").trim() === patchId);
    if (byId !== -1) {
      return byId;
    }
  }

  const patchName = normalizeKey(patchCharacter?.name);
  if (!patchName) {
    return -1;
  }

  return characters.findIndex((character) => normalizeKey(character?.name) === patchName);
}

function findGroupIndexByPatch(groups, patchGroup) {
  const patchId = String(patchGroup?.id || "").trim();
  if (patchId) {
    const byId = groups.findIndex((group) => String(group?.id || "").trim() === patchId);
    if (byId !== -1) {
      return byId;
    }
  }

  const patchName = normalizeKey(patchGroup?.name);
  if (!patchName) {
    return -1;
  }

  return groups.findIndex((group) => normalizeKey(group?.name) === patchName);
}

function mergeClothingGroups(targetCharacter, patchCharacter) {
  if (!hasOwnProperty(patchCharacter, "clothingGroups") || !Array.isArray(patchCharacter.clothingGroups)) {
    return;
  }

  targetCharacter.clothingGroups = Array.isArray(targetCharacter.clothingGroups)
    ? targetCharacter.clothingGroups
    : [];

  for (const patchGroup of patchCharacter.clothingGroups) {
    if (!patchGroup || typeof patchGroup !== "object") {
      continue;
    }

    const groupIndex = findGroupIndexByPatch(targetCharacter.clothingGroups, patchGroup);
    if (groupIndex === -1) {
      targetCharacter.clothingGroups.push(deepClone(patchGroup));
      continue;
    }

    const existingGroup = targetCharacter.clothingGroups[groupIndex] || {};
    const nextGroup = {
      ...existingGroup,
      ...deepClone(patchGroup),
    };

    if (!hasOwnProperty(patchGroup, "id")) {
      nextGroup.id = existingGroup.id;
    }
    if (!hasOwnProperty(patchGroup, "name")) {
      nextGroup.name = existingGroup.name;
    }
    if (!hasOwnProperty(patchGroup, "layers")) {
      nextGroup.layers = existingGroup.layers;
    }

    targetCharacter.clothingGroups[groupIndex] = nextGroup;
  }
}

function mergeCharacterDetailsPatch(currentData, patchData) {
  const merged = deepClone(currentData && typeof currentData === "object" ? currentData : {});
  merged.characters = Array.isArray(merged.characters) ? merged.characters : [];

  const patchCharacters = Array.isArray(patchData?.characters) ? patchData.characters : [];
  if (!patchCharacters.length) {
    return merged;
  }

  for (const patchCharacter of patchCharacters) {
    if (!patchCharacter || typeof patchCharacter !== "object") {
      continue;
    }

    const characterIndex = findCharacterIndexByPatch(merged.characters, patchCharacter);
    if (characterIndex === -1) {
      merged.characters.push(deepClone(patchCharacter));
      continue;
    }

    const targetCharacter = merged.characters[characterIndex];

    if (hasOwnProperty(patchCharacter, "name") && typeof patchCharacter.name === "string") {
      targetCharacter.name = patchCharacter.name;
    }

    if (hasOwnProperty(patchCharacter, "presence")) {
      targetCharacter.presence = patchCharacter.presence;
    }

    if (
      hasOwnProperty(patchCharacter, "appearance")
      && typeof patchCharacter.appearance === "string"
      && isSubstantiveTextChange(targetCharacter.appearance, patchCharacter.appearance)
    ) {
      targetCharacter.appearance = patchCharacter.appearance;
    }

    if (hasOwnProperty(patchCharacter, "activeGroupId")) {
      targetCharacter.activeGroupId = patchCharacter.activeGroupId;
    }

    mergeClothingGroups(targetCharacter, patchCharacter);
  }

  return merged;
}

function sanitizeForbiddenText(value) {
  return String(value ?? "").replace(FORBIDDEN_NAME_CHARS, ".").trim();
}

function normalizeShortId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SHORT_ID_REGEX.test(normalized) ? normalized : "";
}

function normalizeIncomingId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function createRandomShortId(usedIds) {
  const used = usedIds instanceof Set ? usedIds : new Set();
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

  for (let index = 0; index < 5000; index += 1) {
    const candidate = [
      alphabet[Math.floor(Math.random() * alphabet.length)],
      alphabet[Math.floor(Math.random() * alphabet.length)],
      alphabet[Math.floor(Math.random() * alphabet.length)],
    ].join("");
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return `x${Math.floor(Math.random() * 10)}${Math.floor(Math.random() * 10)}`;
}

function createShortIdFromName(name, usedIds) {
  const used = usedIds instanceof Set ? usedIds : new Set();
  const seed = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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

function collectCharacterIds(data) {
  const result = new Set();
  for (const character of Array.isArray(data?.characters) ? data.characters : []) {
    const id = normalizeShortId(character?.id);
    if (id) {
      result.add(id);
    }
  }
  return result;
}

function collectOutfitIds(data) {
  const result = new Set();
  for (const character of Array.isArray(data?.characters) ? data.characters : []) {
    for (const group of Array.isArray(character?.clothingGroups) ? character.clothingGroups : []) {
      const id = normalizeShortId(group?.id);
      if (id) {
        result.add(id);
      }
    }
  }
  return result;
}

function findCharacterByShortId(data, shortId) {
  const normalizedId = normalizeShortId(shortId);
  if (!normalizedId) {
    return null;
  }

  return (Array.isArray(data?.characters) ? data.characters : [])
    .find((character) => normalizeShortId(character?.id) === normalizedId) || null;
}

function findOutfitOwnerByShortId(data, shortId) {
  const normalizedId = normalizeShortId(shortId);
  if (!normalizedId) {
    return null;
  }

  for (const character of Array.isArray(data?.characters) ? data.characters : []) {
    const groups = Array.isArray(character?.clothingGroups) ? character.clothingGroups : [];
    const group = groups.find((entry) => normalizeShortId(entry?.id) === normalizedId);
    if (group) {
      return { character, group };
    }
  }

  return null;
}

function parseCharacterTuple(value) {
  const text = String(value || "").trim();
  const match = text.match(/^\(\s*([^)]+?)\s*\)\s*(.+)$/);
  if (!match) {
    return null;
  }

  const id = normalizeIncomingId(match[1]);
  const name = sanitizeForbiddenText(match[2]);
  if (!id || !name) {
    return null;
  }

  return { id, name };
}

function parseOutfitTuple(value) {
  let text = String(value || "").trim();

  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }

  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner.startsWith("(")) {
      text = inner;
    }
  }

  const match = text.match(/^\(\s*([^)]+?)\s*\)\s*\[\s*([^\]]*?)\s*\]\s*(.+)$/);
  if (!match) {
    return null;
  }

  const ownerId = normalizeIncomingId(match[1]);
  const outfitId = normalizeIncomingId(match[2]);
  const name = sanitizeForbiddenText(match[3]);
  if (!ownerId || !name) {
    return null;
  }

  return { ownerId, outfitId, name };
}

function parseBracketTuple(value) {
  const text = String(value || "").trim();
  const match = text.match(/^\[\s*([^\]]+?)\s*\]\s*(.+)$/);
  if (!match) {
    return null;
  }

  const id = normalizeIncomingId(match[1]);
  const name = sanitizeForbiddenText(match[2]);
  if (!id || !name) {
    return null;
  }

  return { id, name };
}

function createLayerNode(name) {
  return {
    id: "",
    name: sanitizeForbiddenText(name),
    state: "on",
    visibilityOverride: false,
    locked: false,
    children: [],
  };
}

function splitLayerSpecList(text, startIndex = 0) {
  const nodes = [];
  let index = startIndex;

  while (index < text.length) {
    if (text[index] === "]") {
      break;
    }

    let token = "";
    while (index < text.length && !["[", "]", "|"].includes(text[index])) {
      token += text[index];
      index += 1;
    }

    const name = sanitizeForbiddenText(token);
    let children = [];

    if (index < text.length && text[index] === "[") {
      const nested = splitLayerSpecList(text, index + 1);
      children = nested.nodes;
      index = nested.nextIndex;
      if (index < text.length && text[index] === "]") {
        index += 1;
      }
    }

    if (name) {
      const node = createLayerNode(name);
      node.children = children;
      nodes.push(node);
    }

    if (index < text.length && text[index] === "|") {
      index += 1;
      continue;
    }

    if (index < text.length && text[index] === "]") {
      break;
    }
  }

  return { nodes, nextIndex: index };
}

function parseLayerSpec(value) {
  const source = String(value || "").trim();
  if (!source) {
    return [];
  }

  return splitLayerSpecList(source, 0).nodes;
}

function mergeLayerNodeIntoList(layers, node) {
  if (!node?.name) {
    return null;
  }

  const targetList = Array.isArray(layers) ? layers : [];
  const existing = targetList.find((layer) => normalizeKey(layer?.name) === normalizeKey(node.name));
  if (!existing) {
    targetList.push(deepClone(node));
    return targetList[targetList.length - 1];
  }

  existing.children = Array.isArray(existing.children) ? existing.children : [];
  for (const child of Array.isArray(node.children) ? node.children : []) {
    mergeLayerNodeIntoList(existing.children, child);
  }
  return existing;
}

function findLayerByPathNames(layers, pathNames) {
  let currentList = Array.isArray(layers) ? layers : [];
  let current = null;

  for (const rawPart of Array.isArray(pathNames) ? pathNames : []) {
    const part = sanitizeForbiddenText(rawPart);
    if (!part) {
      return null;
    }

    current = currentList.find((layer) => normalizeKey(layer?.name) === normalizeKey(part)) || null;
    if (!current) {
      return null;
    }

    currentList = Array.isArray(current.children) ? current.children : [];
  }

  return current;
}

function parseOutfitPath(value, resolveOutfitId = null) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const segments = text.split("/").map((segment) => String(segment || "").trim()).filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const parsedOutfitId = normalizeIncomingId(segments.shift());
  if (!parsedOutfitId) {
    return null;
  }

  const resolvedOutfitId = typeof resolveOutfitId === "function"
    ? normalizeShortId(resolveOutfitId(parsedOutfitId) || parsedOutfitId)
    : parsedOutfitId;

  if (!resolvedOutfitId) {
    return null;
  }

  return {
    outfitId: resolvedOutfitId,
    path: segments.map((part) => sanitizeForbiddenText(part)).filter(Boolean),
  };
}

function applyRenameLayers(data, renameLayersValue, resolveOutfitId = null) {
  const applySingleRename = (pathKey, nextNameValue) => {
    const pathInfo = parseOutfitPath(pathKey, resolveOutfitId);
    const nextName = sanitizeForbiddenText(nextNameValue);
    if (!pathInfo || !nextName) {
      return;
    }

    const match = findOutfitOwnerByShortId(data, pathInfo.outfitId);
    if (!match?.group || pathInfo.path.length === 0) {
      return;
    }

    const layer = findLayerByPathNames(match.group.layers, pathInfo.path);
    if (!layer || layer.locked) {
      return;
    }

    layer.name = nextName;
  };

  if (Array.isArray(renameLayersValue)) {
    for (const entry of renameLayersValue) {
      const text = String(entry || "").trim();
      const match = text.match(/^(.*?)\s*(?:=>|->)\s*(.+)$/);
      if (!match) {
        continue;
      }

      applySingleRename(match[1], match[2]);
    }
    return;
  }

  if (!renameLayersValue || typeof renameLayersValue !== "object") {
    return;
  }

  for (const [pathKey, nextName] of Object.entries(renameLayersValue)) {
    applySingleRename(pathKey, nextName);
  }
}

function applyVisChanges(data, visChanges, resolveOutfitId = null) {
  if (!visChanges || typeof visChanges !== "object") {
    return;
  }

  const applyEntries = (entries, mode) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const parsed = parseOutfitPath(entry, resolveOutfitId);
      if (!parsed) {
        continue;
      }

      const match = findOutfitOwnerByShortId(data, parsed.outfitId);
      if (!match?.group || parsed.path.length === 0) {
        continue;
      }

      const layer = findLayerByPathNames(match.group.layers, parsed.path);
      if (!layer) {
        continue;
      }

      if (mode === "peek") {
        layer.visibilityOverride = true;
        continue;
      }

      if (mode === "on") {
        layer.state = "on";
        continue;
      }

      if (mode === "part") {
        layer.state = "partial";
        continue;
      }

      if (mode === "off") {
        layer.state = "off";
      }
    }
  };

  applyEntries(visChanges.on, "on");
  applyEntries(visChanges.part, "part");
  applyEntries(visChanges.partial, "part");
  applyEntries(visChanges.off, "off");
  applyEntries(visChanges.peek, "peek");
}

function applyChangelogToCharacterDetails(currentData, changelog) {
  const nextData = deepClone(currentData && typeof currentData === "object" ? currentData : {});
  nextData.characters = Array.isArray(nextData.characters) ? nextData.characters : [];

  if (!changelog || typeof changelog !== "object") {
    return nextData;
  }

  const usedCharacterIds = collectCharacterIds(nextData);
  const usedOutfitIds = collectOutfitIds(nextData);
  const remappedCharacterIds = new Map();
  const remappedOutfitIds = new Map();
  const asArray = (value) => {
    if (Array.isArray(value)) {
      return value;
    }

    if (value === null || value === undefined || value === "") {
      return [];
    }

    return [value];
  };
  const resolveCharacterId = (id) => {
    const normalizedId = normalizeIncomingId(id);
    if (!normalizedId) {
      return "";
    }

    const mapped = remappedCharacterIds.get(normalizedId) || normalizedId;
    return normalizeShortId(mapped);
  };

  const resolveOutfitId = (id) => {
    const normalizedId = normalizeIncomingId(id);
    if (!normalizedId) {
      return "";
    }

    const mapped = remappedOutfitIds.get(normalizedId) || normalizedId;
    return normalizeShortId(mapped);
  };

  for (const existingCharacter of nextData.characters) {
    const id = normalizeShortId(existingCharacter?.id);
    if (id) {
      remappedCharacterIds.set(id, id);
    }
  }

  for (const existingCharacter of nextData.characters) {
    for (const existingGroup of Array.isArray(existingCharacter?.clothingGroups) ? existingCharacter.clothingGroups : []) {
      const id = normalizeShortId(existingGroup?.id);
      if (id) {
        remappedOutfitIds.set(id, id);
      }
    }
  }

  for (const entry of Array.isArray(changelog.newChars) ? changelog.newChars : []) {
    const parsed = parseCharacterTuple(entry);
    if (!parsed) {
      continue;
    }

    if (findCharacterByShortId(nextData, resolveCharacterId(parsed.id))) {
      continue;
    }

    const candidateId = normalizeShortId(parsed.id);
    const targetId = candidateId && !usedCharacterIds.has(candidateId)
      ? candidateId
      : createShortIdFromName(parsed.name, usedCharacterIds);

    nextData.characters.push({
      id: targetId,
      name: parsed.name,
      presence: true,
      appearance: "",
      activeGroupId: null,
      clothingGroups: [],
    });
    usedCharacterIds.add(targetId);
    remappedCharacterIds.set(parsed.id, targetId);
    remappedCharacterIds.set(targetId, targetId);
  }

  for (const entry of Array.isArray(changelog.rename) ? changelog.rename : []) {
    const parsed = parseCharacterTuple(entry);
    if (!parsed) {
      continue;
    }

    const character = findCharacterByShortId(nextData, resolveCharacterId(parsed.id));
    if (!character) {
      continue;
    }

    character.name = parsed.name;
  }

  if (Array.isArray(changelog.present)) {
    const presentSet = new Set(
      changelog.present
        .map((entry) => resolveCharacterId(entry))
        .filter(Boolean)
    );

    for (const character of nextData.characters) {
      character.presence = presentSet.has(normalizeShortId(character.id));
    }
  }

  if (changelog.newDescs && typeof changelog.newDescs === "object") {
    for (const [characterId, value] of Object.entries(changelog.newDescs)) {
      const character = findCharacterByShortId(nextData, resolveCharacterId(characterId));
      const nextAppearance = sanitizeForbiddenText(value);
      if (!character || !nextAppearance || String(character.appearance || "").trim()) {
        continue;
      }

      character.appearance = nextAppearance;
    }
  }

  if (changelog.updatedDescs && typeof changelog.updatedDescs === "object") {
    for (const [characterId, value] of Object.entries(changelog.updatedDescs)) {
      const character = findCharacterByShortId(nextData, resolveCharacterId(characterId));
      const nextAppearance = sanitizeForbiddenText(value);
      if (!character || !nextAppearance) {
        continue;
      }

      const previousAppearance = String(character.appearance || "").trim();
      if (!previousAppearance) {
        character.appearance = nextAppearance;
        continue;
      }

      if (!isSubstantiveTextChange(character.appearance, nextAppearance)) {
        continue;
      }

      character.appearance = nextAppearance;
    }
  }

  for (const entry of asArray(changelog.newOutfits)) {
    const parsed = parseOutfitTuple(entry);
    if (!parsed) {
      continue;
    }

    const owner = findCharacterByShortId(nextData, resolveCharacterId(parsed.ownerId));
    if (!owner) {
      continue;
    }

    owner.clothingGroups = Array.isArray(owner.clothingGroups) ? owner.clothingGroups : [];
    const candidateId = normalizeShortId(parsed.outfitId);
    const targetId = candidateId && !usedOutfitIds.has(candidateId)
      ? candidateId
      : createShortIdFromName(parsed.name, usedOutfitIds);

    if (parsed.outfitId) {
      remappedOutfitIds.set(parsed.outfitId, targetId);
    }
    remappedOutfitIds.set(targetId, targetId);

    if (findOutfitOwnerByShortId(nextData, targetId)) {
      continue;
    }

    owner.clothingGroups.push({
      id: targetId,
      name: parsed.name,
      collapsed: false,
      locked: false,
      layers: [],
    });

    if (!owner.activeGroupId) {
      owner.activeGroupId = targetId;
    }

    usedOutfitIds.add(targetId);
  }

  for (const entry of asArray(changelog.renameOutfits)) {
    const parsed = parseBracketTuple(entry);
    if (!parsed) {
      continue;
    }

    const match = findOutfitOwnerByShortId(nextData, resolveOutfitId(parsed.id));
    if (!match?.group || match.group.locked) {
      continue;
    }

    match.group.name = parsed.name;
  }

  if (changelog.newLayers && typeof changelog.newLayers === "object") {
    for (const [outfitId, rawSpecs] of Object.entries(changelog.newLayers)) {
      const match = findOutfitOwnerByShortId(nextData, resolveOutfitId(outfitId));
      if (!match?.group) {
        continue;
      }

      const specs = Array.isArray(rawSpecs)
        ? rawSpecs
        : typeof rawSpecs === "string"
          ? [rawSpecs]
          : [];
      for (const spec of specs) {
        const parsedLayers = parseLayerSpec(spec);
        for (const parsedLayer of parsedLayers) {
          mergeLayerNodeIntoList(match.group.layers, parsedLayer);
        }
      }
    }
  }

  applyRenameLayers(nextData, changelog.renameLayers, resolveOutfitId);
  applyVisChanges(nextData, changelog.visChanges, resolveOutfitId);

  return nextData;
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

function getTriggerButtonFromArgument(eventOrButton) {
  if (!eventOrButton) {
    return null;
  }

  if (eventOrButton?.currentTarget) {
    return $(eventOrButton.currentTarget);
  }

  if (eventOrButton?.jquery) {
    return eventOrButton;
  }

  return null;
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

async function runDescriptionsGeneration(eventOrButton) {
  await runCharacterDetailsGeneration(eventOrButton, {
    generatingMessage: "Generating descriptions...",
    successMessage: "Character details updated.",
  });
}

async function runOutfitGenerationForCharacter(characterId, userRequest, eventOrButton) {
  const context = getContext();
  const data = loadCharacterDetails(context);
  const targetCharacter = (Array.isArray(data?.characters) ? data.characters : [])
    .find((character) => String(character?.id || "") === String(characterId || ""));

  if (!targetCharacter) {
    toastr.warning("Select a valid character first.", "Character Details");
    return;
  }

  const requestText = String(userRequest || "").trim();
  if (!requestText) {
    toastr.warning("Provide outfit request first.", "Character Details");
    return;
  }

  const extraInstruction = buildOutfitGenerationInstruction(targetCharacter, requestText);
  await runCharacterDetailsGeneration(eventOrButton, {
    extraInstruction,
    generatingMessage: "Generating outfit...",
    successMessage: "Outfit changelog generated.",
  });
}

function buildCharacterGenerationInstruction(userRequest) {
  const requestText = sanitizeForbiddenText(userRequest || "");

  return [
    "CHARACTER GENERATION MODE (DELTA OVER MAIN RULES):",
    "- Follow all rules from the main prompt above exactly as-is.",
    "- This is only a scope override for current task, not a new rule set.",
    `- User character request: ${requestText}`,
    "- In this run, ONLY add a single new character based on the user's request.",
    "- You HAVE TO creatively invent character details (name, appearance, default outfit) to satisfy user request and context.",
    "- Generated character name MUST fit the setting and tone of the current story; do not use descriptive placeholder labels like 'suspicious old man' as the character name.",
    "- Try to use original and uncommon names.",
    "- Output HAS TO contain a new character entry and following fields are MANDATORY for this run: newChars, newDescs, newOutfits, and matching newLayers.",
    "- The character should start with presence set to true.",
    "- Keep strict logical layering and visibility semantics from the main prompt.",
    "- Do not output unrelated updates in this mode (no changes to existing characters).",
  ].join("\n");
}

async function runCharacterGenerationWithAI(userRequest, eventOrButton) {
  const requestText = String(userRequest || "").trim();
  if (!requestText) {
    toastr.warning("Provide character request first.", "Character Details");
    return;
  }

  const extraInstruction = buildCharacterGenerationInstruction(requestText);
  await runCharacterDetailsGeneration(eventOrButton, {
    extraInstruction,
    generatingMessage: "Generating character...",
    successMessage: "Character changelog generated.",
  });
}

export { runDescriptionsGeneration, runOutfitGenerationForCharacter, runCharacterGenerationWithAI };
