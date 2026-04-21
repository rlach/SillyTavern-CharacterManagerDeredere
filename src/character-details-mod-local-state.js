import { getContext } from "../../../../extensions.js";

const MOD_STATE_SCOPE_LOCAL = "local";
const MODS_LOCAL_STATE_STORAGE_KEY = "characterDetailsModsLocalState";

function isModGroup(mod) {
  return mod?.type === "group";
}

export function createDefaultModsLocalState() {
  return {
    enabledByModId: {},
    selectedItemByGroupModId: {},
  };
}

export function readModsLocalState(context) {
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

export function writeModsLocalState(context, stateValue) {
  const sourceContext = context || getContext();
  const nextState = stateValue && typeof stateValue === "object"
    ? stateValue
    : createDefaultModsLocalState();

  sourceContext?.variables?.local?.set?.(MODS_LOCAL_STATE_STORAGE_KEY, nextState);
}

export function getCurrentChatCharacterCardId(context = null) {
  const sourceContext = context || getContext();
  const chatCharacterId = sourceContext?.characterId;
  if (chatCharacterId === null || chatCharacterId === undefined) {
    return "";
  }

  return String(chatCharacterId).trim();
}

export function isCharacterModVisibleInCurrentChat(mod, context = null) {
  const boundCharacterId = String(mod?.characterId || "").trim();
  if (!boundCharacterId) {
    return true;
  }

  const currentCharacterId = getCurrentChatCharacterCardId(context);
  return Boolean(currentCharacterId && boundCharacterId === currentCharacterId);
}

export function cleanupModsLocalState(context, mods) {
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

export function applyLocalModsState(mods, localState) {
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

export function seedCurrentChatLocalStateFromMod(mods, mod, effectiveMod = null) {
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
