export function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
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
