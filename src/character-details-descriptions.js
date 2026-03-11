import { getContext, extension_settings } from "../../../../extensions.js";

const extensionName = "st-extension-example";

function shouldUsePlainTextClothingForLlm() {
  return extension_settings?.[extensionName]?.llm_clothing_plain_text === true;
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

function collectLayerItems(layer, occlusion) {
  const items = [];
  const name = layer.name?.trim();
  const visibilityOverride = layer?.visibilityOverride === true;
  const forcePartiallyVisible = visibilityOverride && occlusion === "full";
  if (layer.state !== "off" && (occlusion !== "full" || forcePartiallyVisible) && name) {
    items.push((occlusion === "partial" || forcePartiallyVisible) ? `partially visible ${name}` : name);
  }

  const nextOcclusion = combineOcclusion(occlusion, getLayerEffect(layer));
  for (const child of layer.children || []) {
    items.push(...collectLayerItems(child, nextOcclusion));
  }

  return items;
}

function collectClothingItems(character) {
  const items = [];
  const groups = Array.isArray(character.clothingGroups) ? character.clothingGroups : [];
  const activeGroup = character.activeGroupId
    ? groups.find((group) => group.id === character.activeGroupId)
    : null;
  const groupsToUse = activeGroup ? [activeGroup] : groups;

  for (const group of groupsToUse) {
    for (const layer of group.layers || []) {
      items.push(...collectLayerItems(layer, "none"));
    }
  }

  return items;
}

function collectHiddenDescendantNames(layers, occlusion) {
  const result = [];
  for (const layer of Array.isArray(layers) ? layers : []) {
    const name = String(layer?.name || "").trim();
    const layerEffect = getLayerEffect(layer);
    const nextOcclusion = combineOcclusion(occlusion, layerEffect);
    const visibilityOverride = layer?.visibilityOverride === true;

    if (layer.state !== "off" && occlusion === "full" && !visibilityOverride && name) {
      result.push(name);
    }

    result.push(...collectHiddenDescendantNames(layer.children || [], nextOcclusion));
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

  if (layer.state !== "off" && (occlusion !== "full" || forcePartiallyVisible) && name) {
    const visibleLabel = (occlusion === "partial" || forcePartiallyVisible) ? `partially visible ${name}` : name;
    const hiddenUnderneath = Array.from(new Set(collectHiddenDescendantNames(layer.children || [], nextOcclusion)));
    if (hiddenUnderneath.length > 0) {
      items.push(`${visibleLabel} (${formatList(hiddenUnderneath)} underneath)`);
    } else {
      items.push(visibleLabel);
    }
  }

  for (const child of layer.children || []) {
    items.push(...collectLayerItemsWithUnderneath(child, nextOcclusion));
  }

  return items;
}

function collectClothingItemsForPlainLlm(character) {
  const items = [];
  const groups = Array.isArray(character.clothingGroups) ? character.clothingGroups : [];
  const activeGroup = character.activeGroupId
    ? groups.find((group) => group.id === character.activeGroupId)
    : null;
  const groupsToUse = activeGroup ? [activeGroup] : groups;

  for (const group of groupsToUse) {
    for (const layer of group.layers || []) {
      items.push(...collectLayerItemsWithUnderneath(layer, "none"));
    }
  }

  return items;
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

function getCustomFieldGeneratorEnabled(data, field, characterId) {
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

  const normalizedCharacterId = String(characterId || "").trim().toLowerCase();
  const byCharacterId = rawToggle.byCharacterId && typeof rawToggle.byCharacterId === "object"
    ? rawToggle.byCharacterId
    : {};

  if (rawToggle.linkedForAll === true) {
    if (normalizedCharacterId && Object.prototype.hasOwnProperty.call(byCharacterId, normalizedCharacterId)) {
      return byCharacterId[normalizedCharacterId] === true;
    }

    const firstValue = Object.values(byCharacterId)[0];
    return firstValue === true;
  }

  return normalizedCharacterId ? byCharacterId[normalizedCharacterId] === true : false;
}

function getCustomFieldsSettings() {
  const fields = extension_settings?.[extensionName]?.custom_fields;
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.map(normalizeCustomField).filter((field) => field.label && field.varName);
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

function collectCustomFieldValues(character, data, includeInGenerationOnly) {
  const fields = getCustomFieldsSettings();
  if (!fields.length) {
    return [];
  }

  const context = getContext();
  const viewerId = data.viewerCharacterId || null;
  const mcId = data.mainCharacterId || null;
  const results = [];

  for (const field of fields) {
    if (includeInGenerationOnly && !getCustomFieldGeneratorEnabled(data, field, character.id)) {
      continue;
    }

    let value;
    if (field.target === "everyone") {
      const valueByCharacterId = parseEveryoneVarMap(context.variables?.local?.get?.(field.varName));
      value = formatVariableValue(valueByCharacterId[String(character.id || "").toLowerCase()]);
    } else {
      const targetId = field.target === "viewer" ? viewerId : mcId;
      if (!targetId || targetId !== character.id) {
        continue;
      }

      value = formatVariableValue(context.variables?.local?.get?.(field.varName));
    }

    if (!String(value || "").trim()) {
      continue;
    }

    results.push(String(value));
  }

  return results;
}

function formatList(items) {
  if (items.length === 0) {
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

function formatCommaList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeImageDescriptionLine(line) {
  let text = String(line || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, " ")
    .trim();

  if (!text) {
    return "";
  }

  text = text
    // Keep decimal dots intact (e.g. (keyword:1.5) weighted syntax for image generators).
    .replace(/\.+/g, (dots, offset, source) => {
      if (
        dots === "."
        && /\d/.test(String(source?.[offset - 1] || ""))
        && /\d/.test(String(source?.[offset + 1] || ""))
      ) {
        return ".";
      }

      return ",";
    })
    .replace(/,+/g, ",")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.]+|[\s,.]+$/g, "")
    .trim();

  return text ? `${text}.` : "";
}

function buildDescriptionsText(data) {
  const lines = [];
  for (const character of data.characters || []) {
    if (!character.presence) {
      continue;
    }

    const name = character.name?.trim() || "Unnamed";
    const appearance = character.appearance?.trim();
    const clothingItems = collectClothingItems(character);

    let line = name;
    if (appearance) {
      line += `, ${appearance}`;
    }

    if (clothingItems.length > 0) {
      line += `, wearing: ${formatList(clothingItems)}`;
    }

    lines.push(line);
  }

  return lines.join("\n\n");
}

function buildGenDescriptions(data, filter) {
  const lines = [];
  let characters = [];

  switch (filter) {
    case "you":
    case "face":
      // Only MC (main character)
      if (data.mainCharacterId) {
        const mc = data.characters.find((c) => c.id === data.mainCharacterId && c.presence);
        if (mc) characters = [mc];
      }
      break;

    case "background":
      return "no people,";

    case "me":
      // Only viewer
      if (data.viewerCharacterId) {
        const viewer = data.characters.find((c) => c.id === data.viewerCharacterId && c.presence);
        if (viewer) characters = [viewer];
      }
      break;

    case "scene":
      // All present except viewer
      characters = data.characters.filter(
        (c) => c.presence && c.id !== data.viewerCharacterId
      );
      break;

    case "last":
    case "raw_last":
    default:
      // All present characters
      characters = data.characters.filter((c) => c.presence);
      break;
  }

  for (const character of characters) {
    const name = character.name?.trim() || "Unnamed";
    const appearance = character.appearance?.trim();
    const customFields = collectCustomFieldValues(character, data, true);
    const clothingItems = shouldUsePlainTextClothingForLlm()
      ? collectClothingItemsForPlainLlm(character)
      : collectClothingItems(character);

    let line = name;
    if (appearance) {
      line += `, ${appearance}`;
    }

    if (customFields.length > 0) {
      line += `, ${customFields.join(", ")}`;
    }

    if (clothingItems.length > 0) {
      line += `, wearing: ${formatCommaList(clothingItems)}`;
    }

    const normalizedLine = normalizeImageDescriptionLine(line);
    if (normalizedLine) {
      lines.push(normalizedLine);
    }
  }

  return lines.join("\n\n");
}

function buildCharacterVisualDescription(data, characterId, options = {}) {
  if (!characterId) {
    return "";
  }

  const character = (data.characters || []).find((item) => item.id === characterId);
  if (!character) {
    return "";
  }

  const name = character.name?.trim() || "Unnamed";
  const appearance = character.appearance?.trim();
  const includeInGenerationOnly = options.includeInGenerationOnly !== false;
  const useLlmPlainTextClothing = options.useLlmPlainTextClothing === true;
  const additionalWearingItems = Array.isArray(options.additionalWearingItems)
    ? options.additionalWearingItems
      .map((item) => String(item || "").trim())
      .filter(Boolean)
    : [];
  const customFields = collectCustomFieldValues(character, data, includeInGenerationOnly);
  const clothingItemsBase = useLlmPlainTextClothing
    ? collectClothingItemsForPlainLlm(character)
    : collectClothingItems(character);
  const clothingItems = [...clothingItemsBase, ...additionalWearingItems];

  let line = name;
  if (appearance) {
    line += `, ${appearance}`;
  }

  if (customFields.length > 0) {
    line += `, ${customFields.join(", ")}`;
  }

  if (clothingItems.length > 0) {
    line += `, wearing: ${formatCommaList(clothingItems)}`;
  }

  return normalizeImageDescriptionLine(line);
}

export { buildDescriptionsText, buildGenDescriptions, buildCharacterVisualDescription, shouldUsePlainTextClothingForLlm };
