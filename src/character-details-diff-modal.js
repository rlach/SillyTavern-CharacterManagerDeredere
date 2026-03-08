import { buildDiff, applyAcceptedChanges } from "./character-details-diff.js";

let modalRoot = null;
let modalContent = null;
let acceptAllButton = null;
let applyButton = null;
let closeButton = null;
let pendingDiff = null;
let onApplyHandler = null;
const APPLY_BUTTON_BASE_LABEL = "Apply accepted";

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function getItemCharacterKey(item) {
  if (item.type === "character" && item.action === "add") {
    return normalizeName(item.payload?.name);
  }

  return normalizeName(item.path?.character);
}

function getItemGroupKey(item) {
  if (item.type === "group" && item.action === "add") {
    return normalizeName(item.payload?.name);
  }

  return normalizeName(item.path?.group);
}

function addDependency(item, dependencyId, options = {}) {
  if (!item || !dependencyId || item.id === dependencyId) {
    return;
  }

  item.requires = Array.isArray(item.requires) ? item.requires : [];
  if (!item.requires.includes(dependencyId)) {
    item.requires.push(dependencyId);
  }

  if (options.autoAccept === true) {
    item.autoAcceptOnDependencies = true;
  }
}

function buildDependencyRules(diff) {
  if (!Array.isArray(diff?.items)) {
    return;
  }

  const addCharacterByName = new Map();
  const addGroupByKey = new Map();

  for (const item of diff.items) {
    if (item.type === "character" && item.action === "add") {
      const key = getItemCharacterKey(item);
      if (key) {
        addCharacterByName.set(key, item);
      }
      continue;
    }

    if (item.type === "group" && item.action === "add") {
      const characterKey = getItemCharacterKey(item);
      const groupKey = getItemGroupKey(item);
      if (characterKey && groupKey) {
        addGroupByKey.set(`${characterKey}::${groupKey}`, item);
      }
    }
  }

  for (const item of diff.items) {
    const characterKey = getItemCharacterKey(item);
    if (characterKey) {
      const characterRoot = addCharacterByName.get(characterKey);
      if (characterRoot && characterRoot.id !== item.id) {
        addDependency(item, characterRoot.id);
      }
    }

    const groupKey = getItemGroupKey(item);
    if (characterKey && groupKey) {
      const groupRoot = addGroupByKey.get(`${characterKey}::${groupKey}`);
      if (groupRoot && groupRoot.id !== item.id) {
        const isVisibilityOrStateChange = item.type === "layer"
          && item.action === "change"
          && (item.path?.field === "state" || item.path?.field === "visibilityOverride");
        addDependency(item, groupRoot.id, { autoAccept: isVisibilityOrStateChange });
      }
    }
  }
}

function getItemById(itemId) {
  return pendingDiff?.items.find((item) => item.id === itemId) || null;
}

function forceUncheckDependents(sourceId, visited = new Set()) {
  if (!sourceId || visited.has(sourceId)) {
    return;
  }
  visited.add(sourceId);

  for (const item of pendingDiff?.items || []) {
    const requires = Array.isArray(item.requires) ? item.requires : [];
    if (!requires.includes(sourceId)) {
      continue;
    }

    if (item.accepted) {
      item.accepted = false;
    }

    forceUncheckDependents(item.id, visited);
  }
}

function autoAcceptUnlockedDependents(sourceId) {
  if (!sourceId) {
    return;
  }

  for (const item of pendingDiff?.items || []) {
    const requires = Array.isArray(item.requires) ? item.requires : [];
    if (!requires.includes(sourceId) || item.autoAcceptOnDependencies !== true) {
      continue;
    }

    const allRequirementsAccepted = requires.every((requiredId) => getItemById(requiredId)?.accepted);
    if (allRequirementsAccepted) {
      item.accepted = true;
    }
  }
}

function updateDependencyDisabledState() {
  if (!pendingDiff || !Array.isArray(pendingDiff.items)) {
    return;
  }

  for (const item of pendingDiff.items) {
    const requires = Array.isArray(item.requires) ? item.requires : [];
    const blocked = requires.some((requiredId) => !getItemById(requiredId)?.accepted);
    item.disabledByDependency = blocked;
    if (blocked) {
      item.accepted = false;
    }
  }
}

function updateApplyButtonState() {
  if (!applyButton?.length) {
    return;
  }

  const acceptedCount = Array.isArray(pendingDiff?.items)
    ? pendingDiff.items.filter((item) => item.accepted).length
    : 0;
  const hasAccepted = acceptedCount > 0;
  applyButton.prop("disabled", !hasAccepted);
  applyButton.text(hasAccepted ? `${APPLY_BUTTON_BASE_LABEL} (${acceptedCount})` : APPLY_BUTTON_BASE_LABEL);
}

function ensureModal() {
  if (modalRoot) {
    return;
  }

  modalRoot = $(`
    <div id="character-details-diff-modal" class="character-details-modal hidden">
      <div class="character-details-modal__backdrop" data-action="close"></div>
      <div class="character-details-modal__panel">
        <div class="character-details-modal__header">
          <div class="character-details-modal__title">Review character changes</div>
          <button class="character-details-modal__close" data-action="close" type="button">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="character-details-modal__content"></div>
        <div class="character-details-modal__footer">
          <button id="character-details-accept-all" class="menu_button" type="button">Accept all</button>
          <button id="character-details-apply" class="menu_button" type="button">Apply accepted</button>
          <button id="character-details-cancel" class="menu_button" type="button">Cancel</button>
        </div>
      </div>
    </div>
  `);

  $("body").append(modalRoot);
  modalContent = modalRoot.find(".character-details-modal__content");
  acceptAllButton = modalRoot.find("#character-details-accept-all");
  applyButton = modalRoot.find("#character-details-apply");
  closeButton = modalRoot.find("#character-details-cancel");

  modalRoot.on("click", "[data-action='close']", () => closeModal());
  closeButton.on("click", () => closeModal());
  acceptAllButton.on("click", () => toggleAll(true));
  applyButton.on("click", () => applyAccepted());
  modalRoot.on("change", ".diff-toggle", handleToggle);
}

function renderDiff(diff) {
  buildDependencyRules(diff);
  updateDependencyDisabledState();

  if (!diff.items.length) {
    modalContent.html("<div class=\"character-details-modal__empty\">No changes detected.</div>");
    updateApplyButtonState();
    return;
  }

  const html = diff.items
    .map((item) => renderItem(item))
    .join("");

  modalContent.html(html);
  updateApplyButtonState();
}

function renderItem(item) {
  const badge = item.action === "add" ? "badge-add" : item.action === "remove" ? "badge-remove" : "badge-change";
  const label = buildItemLabel(item);
  const beforeValue = item.before ?? item.payload ?? item.after;
  const afterValue = item.after ?? item.payload;
  const beforeText = formatDetail(beforeValue, item, "before");
  const afterText = formatDetail(afterValue, item, "after");
  const before = item.before !== undefined ? `<div class=\"diff-before\">${beforeText}</div>` : "";
  const after = item.after !== undefined || item.action === "add" ? `<div class=\"diff-after\">${afterText}</div>` : "";

  return `
    <div class=\"diff-item ${item.disabledByDependency ? "diff-item--disabled" : ""}\" data-diff-id=\"${item.id}\">
      <label class=\"diff-toggle-row\">
        <input class=\"diff-toggle\" type=\"checkbox\" ${item.accepted ? "checked" : ""} ${item.disabledByDependency ? "disabled" : ""} />
        <span class=\"diff-label\">${escapeHtml(label)}</span>
        <span class=\"diff-badge ${badge}\">${item.action.toUpperCase()}</span>
      </label>
      <div class=\"diff-details\">
        ${before}
        ${after}
      </div>
    </div>
  `;
}

function buildItemLabel(item) {
  const characterName = item.path?.character ? ` (${item.path.character})` : "";
  const groupName = item.path?.group ? ` in ${item.path.group}` : "";
  const parentLayer = item.path?.layer ? ` under ${item.path.layer}` : "";

  if (item.type === "avatar") {
    const name = item.path?.character || "(unknown)";
    if (item.action === "add") {
      return `Add avatar: ${name}`;
    }
    if (item.action === "remove") {
      return `Remove avatar: ${name}`;
    }
    return `Avatar: ${name}`;
  }

  if (item.type === "custom-field") {
    const varName = item.path?.customField || "(unknown)";
    if (item.action === "add") {
      return `Add custom field value: ${varName}`;
    }
    if (item.action === "remove") {
      return `Remove custom field value: ${varName}`;
    }
    return `Custom field value: ${varName}`;
  }
  
  if (item.type === "layer") {
    if (item.action === "add") {
      return `Add layer: ${item.payload?.name || "(unnamed)"}${parentLayer}${groupName}${characterName}`;
    }
    if (item.action === "remove") {
      return `Remove layer: ${item.before?.name || "(unnamed)"}${parentLayer}${groupName}${characterName}`;
    }
  }
  
  if (item.type === "group") {
    if (item.action === "add") {
      return `Add group: ${item.payload?.name || "(unnamed)"}${characterName}`;
    }
    if (item.action === "remove") {
      return `Remove group: ${item.before?.name || "(unnamed)"}${characterName}`;
    }
  }
  
  return item.label;
}

function buildWordDiffOperations(beforeText, afterText) {
  const left = String(beforeText || "").trim() ? String(beforeText).trim().split(/\s+/) : [];
  const right = String(afterText || "").trim() ? String(afterText).trim().split(/\s+/) : [];

  const rows = left.length + 1;
  const cols = right.length + 1;
  const lcs = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (left[leftIndex] === right[rightIndex]) {
        lcs[leftIndex][rightIndex] = lcs[leftIndex + 1][rightIndex + 1] + 1;
      } else {
        lcs[leftIndex][rightIndex] = Math.max(lcs[leftIndex + 1][rightIndex], lcs[leftIndex][rightIndex + 1]);
      }
    }
  }

  const operations = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      operations.push({ type: "same", value: left[leftIndex] });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (lcs[leftIndex + 1][rightIndex] >= lcs[leftIndex][rightIndex + 1]) {
      operations.push({ type: "remove", value: left[leftIndex] });
      leftIndex += 1;
    } else {
      operations.push({ type: "add", value: right[rightIndex] });
      rightIndex += 1;
    }
  }

  while (leftIndex < left.length) {
    operations.push({ type: "remove", value: left[leftIndex] });
    leftIndex += 1;
  }

  while (rightIndex < right.length) {
    operations.push({ type: "add", value: right[rightIndex] });
    rightIndex += 1;
  }

  return operations;
}

function formatChangedStringDiff(item, side) {
  const beforeText = typeof item?.before === "string" ? item.before : String(item?.before ?? "");
  const afterText = typeof item?.after === "string" ? item.after : String(item?.after ?? "");
  const operations = buildWordDiffOperations(beforeText, afterText);

  if (operations.length === 0) {
    return `<span class="diff-value-text">(empty)</span>`;
  }

  const tokens = [];
  for (const operation of operations) {
    const value = escapeHtml(operation.value);
    if (operation.type === "same") {
      tokens.push(value);
      continue;
    }

    if (side === "before" && operation.type === "remove") {
      tokens.push(`<span class="diff-removed-word">${value}</span>`);
      continue;
    }

    if (side === "after" && operation.type === "add") {
      tokens.push(`<span class="diff-added-word">${value}</span>`);
    }
  }

  if (tokens.length === 0) {
    return `<span class="diff-value-text">(empty)</span>`;
  }

  return `<span class="diff-value-text">${tokens.join(" ")}</span>`;
}

function formatDetail(value, item, side) {
  if (
    item?.action === "change"
    && typeof item?.before === "string"
    && typeof item?.after === "string"
  ) {
    return formatChangedStringDiff(item, side);
  }

  if (item.type === "avatar") {
    if (!value) {
      return `<span class="diff-value-text">(empty)</span>`;
    }

    return `<span class="diff-value-text">Uploaded image data</span>`;
  }

  if (item.type === "layer" && (item.action === "add" || item.action === "remove")) {
    return formatLayer(value);
  }

  if (item.type === "group" && (item.action === "add" || item.action === "remove")) {
    return formatGroup(value);
  }

  if (item.type === "character" && (item.action === "add" || item.action === "remove")) {
    return formatCharacter(value);
  }

  if (typeof value === "object" && value !== null) {
    return `<span class="diff-value-object">${escapeHtml(JSON.stringify(value))}</span>`;
  }

  return `<span class="diff-value-text">${escapeHtml(String(value ?? ""))}</span>`;
}

function formatCharacter(character) {
  if (!character || typeof character !== "object") {
    return "<div class='diff-preview-empty'>(empty)</div>";
  }

  const groupsHtml = Array.isArray(character.clothingGroups) && character.clothingGroups.length > 0
    ? character.clothingGroups.map(g => `<div class="diff-preview-group">${formatGroupPreview(g)}</div>`).join("")
    : "<div class='diff-preview-empty'>No groups</div>";

  return `
    <div class="diff-preview-character">
      <div class="diff-preview-field">
        <strong>Name:</strong> ${escapeHtml(character.name || "(unnamed)")}
      </div>
      ${character.appearance ? `
        <div class="diff-preview-field">
          <strong>Appearance:</strong> ${escapeHtml(character.appearance)}
        </div>
      ` : ""}
      <div class="diff-preview-section">
        <strong>Groups:</strong>
        ${groupsHtml}
      </div>
    </div>
  `;
}

function formatLayer(layer) {
  if (!layer || typeof layer !== "object") {
    return "<div class='diff-preview-empty'>(empty)</div>";
  }

  return `
    <div class="diff-preview-layer">
      <div class="diff-preview-layer-item" style="--depth: 0">
        ${renderLayerPreview(layer, 0)}
      </div>
    </div>
  `;
}

function formatGroup(group) {
  if (!group || typeof group !== "object") {
    return "<div class='diff-preview-empty'>(empty)</div>";
  }

  const layersHtml = Array.isArray(group.layers) && group.layers.length > 0
    ? group.layers.map(l => renderLayerPreview(l, 0)).join("")
    : "<div class='diff-preview-empty'>No layers</div>";

  return `
    <div class="diff-preview-group">
      <div class="diff-preview-field">
        <strong>Group:</strong> ${escapeHtml(group.name || "(unnamed)")}
      </div>
      <div class="diff-preview-section">
        <strong>Layers:</strong>
        ${layersHtml}
      </div>
    </div>
  `;
}

function formatGroupPreview(group) {
  if (!group || typeof group !== "object") {
    return "(unnamed)";
  }

  const layerCount = Array.isArray(group.layers) ? group.layers.length : 0;
  return `<strong>${escapeHtml(group.name || "(unnamed)")}</strong> <span class="diff-preview-count">(${layerCount} layer${layerCount !== 1 ? "s" : ""})</span>`;
}

function renderLayerPreview(layer, depth) {
  if (!layer || typeof layer !== "object") {
    return "";
  }

  const indent = depth * 20;
  const stateLabel = layer.state === "on" ? "On" : layer.state === "partial" ? "Partial" : "Off";
  const childrenHtml = Array.isArray(layer.children)
    ? layer.children.map(c => renderLayerPreview(c, depth + 1)).join("")
    : "";

  return `
    <div class="diff-preview-layer-item" style="margin-left: ${indent}px">
      <span class="diff-preview-layer-name">${escapeHtml(layer.name || "(unnamed)")}</span>
      <span class="diff-preview-layer-badge diff-preview-state-${layer.state || "on"}">${stateLabel}</span>
    </div>
    ${childrenHtml}
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function handleToggle(event) {
  const row = event.target.closest(".diff-item");
  const id = row?.dataset.diffId;
  const item = pendingDiff?.items.find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  item.accepted = event.target.checked;
  if (!item.accepted) {
    forceUncheckDependents(item.id);
  } else {
    autoAcceptUnlockedDependents(item.id);
  }

  updateDependencyDisabledState();
  renderDiff(pendingDiff);
  updateApplyButtonState();
}

function toggleAll(value) {
  if (!pendingDiff) {
    return;
  }

  for (const item of pendingDiff.items) {
    if (value && item.disabledByDependency) {
      continue;
    }
    item.accepted = value;
  }

  updateDependencyDisabledState();
  renderDiff(pendingDiff);
  updateApplyButtonState();
}

function openModal() {
  modalRoot.removeClass("hidden");
}

function closeModal() {
  modalRoot.addClass("hidden");
}

function applyAccepted() {
  if (!pendingDiff || !onApplyHandler) {
    closeModal();
    return;
  }

  if (!pendingDiff.items.some((item) => item.accepted)) {
    return;
  }

  const nextData = applyAcceptedChanges(pendingDiff.current, pendingDiff);
  onApplyHandler(nextData);
  closeModal();
}

function showCharacterDetailsDiff(current, proposed, onApply, options = {}) {
  ensureModal();
  const diff = buildDiff(current, proposed, options);
  diff.current = current;
  pendingDiff = diff;
  onApplyHandler = onApply;
  renderDiff(diff);
  openModal();
}

export { showCharacterDetailsDiff };
