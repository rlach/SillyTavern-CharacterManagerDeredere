export function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

const AFTER_CHAR_MACRO_TO_ID_FIELD = {
  "{{mc}}": "mainCharacterId",
  "{{selected}}": "activeCharacterId",
  "{{viewer}}": "viewerCharacterId",
};

export function normalizeAfterCharMacro(value) {
  return String(value || "").trim().toLowerCase();
}

export function isSupportedAfterCharMacro(value) {
  const normalized = normalizeAfterCharMacro(value);
  return Object.prototype.hasOwnProperty.call(AFTER_CHAR_MACRO_TO_ID_FIELD, normalized);
}

function findCharacterById(data, characterId) {
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedCharacterId) {
    return null;
  }

  return (Array.isArray(data?.characters) ? data.characters : [])
    .find((character) => String(character?.id || "").trim() === normalizedCharacterId) || null;
}

export function compactWhitespace(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeInlineModSegment(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s,.]+$/g, "")
    .trim();
}

export function findCharacterByName(data, nameValue) {
  const normalized = normalizeName(nameValue);
  if (!normalized) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(AFTER_CHAR_MACRO_TO_ID_FIELD, normalized)) {
    const idField = AFTER_CHAR_MACRO_TO_ID_FIELD[normalized];
    return findCharacterById(data, data?.[idField]);
  }

  return (Array.isArray(data?.characters) ? data.characters : [])
    .find((character) => normalizeName(character?.name) === normalized) || null;
}

export function shouldPopupOpenUpward(triggerEl) {
  if (!triggerEl) {
    return false;
  }

  const rect = triggerEl.getBoundingClientRect();
  return rect.bottom > window.innerHeight * 0.6;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getInitials(name) {
  const text = String(name || "").trim();
  if (!text) {
    return "?";
  }

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return (parts[0].slice(0, 2) || "?").toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}
