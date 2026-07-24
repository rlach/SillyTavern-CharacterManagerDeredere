import {
  IMAGE_RESOLUTION_OPTIONS,
  DEFAULT_RESOLUTION_OPTION,
} from "./image-resolution-options.js";

export const BUILTIN_GENERATION_STYLE_DEFINITIONS = [
  {
    id: "portrait",
    name: "Closeup portrait",
    icon: "fa-user",
    mode: "portrait",
    promptKey: "closeup_portrait_prompt",
    resolutionKey: "portrait",
  },
  {
    id: "fullbody",
    name: "Full body portrait",
    icon: "fa-person",
    mode: "fullbody",
    promptKey: "full_body_portrait_prompt",
    resolutionKey: "fullbody",
  },
  {
    id: "background",
    name: "Background",
    icon: "fa-mountain-sun",
    mode: "background",
    promptKey: "describe_background_prompt",
    resolutionKey: "background",
  },
  {
    id: "viewer-eyes",
    name: "View from viewer's eyes",
    icon: "fa-eye",
    mode: "viewer-eyes",
    promptKey: "describe_viewer_eyes_prompt",
    resolutionKey: "viewer_eyes",
  },
  {
    id: "scene",
    name: "Current scene",
    icon: "fa-people-group",
    mode: "scene",
    promptKey: "describe_current_scene_prompt",
    resolutionKey: "scene",
  },
];

const BUILTIN_BY_ID = new Map(
  BUILTIN_GENERATION_STYLE_DEFINITIONS.map((definition) => [
    definition.id,
    definition,
  ]),
);

export function normalizeGenerationStyleIcon(value, fallback = "fa-question") {
  const icon = String(value || "").trim();
  return /^fa-[a-z0-9-]+$/i.test(icon) ? icon : fallback;
}

export function normalizeGenerationStylePriority(value) {
  const priority = Number(value);
  if (!Number.isFinite(priority)) {
    return 10;
  }

  return Math.max(-9999, Math.min(9999, Math.trunc(priority)));
}

export function normalizeGenerationStyleResolution(value) {
  const resolution = String(value || DEFAULT_RESOLUTION_OPTION);
  return resolution in IMAGE_RESOLUTION_OPTIONS
    ? resolution
    : DEFAULT_RESOLUTION_OPTION;
}

function normalizeBuiltinStyle(definition, value, legacySettings) {
  const source = value && typeof value === "object" ? value : {};
  return {
    id: definition.id,
    builtin: true,
    mode: definition.mode,
    name: definition.name,
    icon: normalizeGenerationStyleIcon(source.icon, definition.icon),
    showInQuickMenu: source.showInQuickMenu !== false,
    priority: normalizeGenerationStylePriority(source.priority),
    prompt: String(
      source.prompt ?? legacySettings?.[definition.promptKey] ?? "",
    ),
    resolution: normalizeGenerationStyleResolution(
      source.resolution ??
        legacySettings?.custom_resolutions?.[definition.resolutionKey],
    ),
  };
}

function normalizeCustomStyle(value, usedIds) {
  const source = value && typeof value === "object" ? value : {};
  let id = String(source.id || "").trim();
  if (!id || usedIds.has(id) || BUILTIN_BY_ID.has(id)) {
    id = createGenerationStyleId(usedIds);
  }

  return {
    id,
    builtin: false,
    mode: "scene",
    name: String(source.name || "New style").trim() || "New style",
    icon: normalizeGenerationStyleIcon(source.icon),
    showInQuickMenu: source.showInQuickMenu !== false,
    priority: normalizeGenerationStylePriority(source.priority),
    prompt: String(source.prompt || ""),
    resolution: normalizeGenerationStyleResolution(source.resolution),
  };
}

export function normalizeGenerationStyles(values, legacySettings = {}) {
  const source = Array.isArray(values) ? values : [];
  const sourceById = new Map(
    source
      .filter((style) => style && typeof style === "object")
      .map((style) => [String(style.id || ""), style]),
  );
  const normalized = BUILTIN_GENERATION_STYLE_DEFINITIONS.map((definition) =>
    normalizeBuiltinStyle(
      definition,
      sourceById.get(definition.id),
      legacySettings,
    ),
  );
  const usedIds = new Set(normalized.map((style) => style.id));

  for (const style of source) {
    if (!style || typeof style !== "object" || BUILTIN_BY_ID.has(style.id)) {
      continue;
    }

    const normalizedStyle = normalizeCustomStyle(style, usedIds);
    usedIds.add(normalizedStyle.id);
    normalized.push(normalizedStyle);
  }

  return normalized;
}

export function createGenerationStyleId(usedIds = new Set()) {
  let id = "";
  do {
    id = `style_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  } while (usedIds.has(id));
  return id;
}

export function createCustomGenerationStyle(existingStyles = []) {
  const usedIds = new Set(
    (Array.isArray(existingStyles) ? existingStyles : []).map((style) =>
      String(style?.id || ""),
    ),
  );
  return {
    id: createGenerationStyleId(usedIds),
    builtin: false,
    mode: "scene",
    name: "New style",
    icon: "fa-question",
    showInQuickMenu: true,
    priority: 10,
    prompt: "",
    resolution: DEFAULT_RESOLUTION_OPTION,
  };
}

export function getBuiltinGenerationStyleDefinition(styleId) {
  return BUILTIN_BY_ID.get(String(styleId || "")) || null;
}

export function sortGenerationStylesForQuickMenu(styles) {
  return (Array.isArray(styles) ? styles : [])
    .map((style, index) => ({ style, index }))
    .filter(({ style }) => style?.showInQuickMenu !== false)
    .sort(
      (left, right) =>
        normalizeGenerationStylePriority(right.style?.priority) -
          normalizeGenerationStylePriority(left.style?.priority) ||
        left.index - right.index,
    )
    .map(({ style }) => style);
}
