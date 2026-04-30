import { getContext, extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { Popup, POPUP_TYPE } from "../../../../popup.js";
import {
  cleanupModsLocalState,
  writeModsLocalState,
  getCurrentChatCharacterCardId,
  seedCurrentChatLocalStateFromMod,
} from "./character-details-mod-local-state.js";
import {
  findCharacterByName,
  isSupportedAfterCharMacro,
  escapeHtml,
  shouldPopupOpenUpward,
} from "./character-details-shared-utils.js";
import { showModItemEditorPopup as showModItemEditorPopupModal } from "./character-details-mod-modal.js";
import {
  MOD_POSITION_AFTER_CHAR,
  MOD_POSITION_MIDDLE,
  MOD_ENTRY_TYPE_SINGLE,
  MOD_ENTRY_TYPE_GROUP,
  MODS_PANEL_FILTER_ALL,
  MOD_STATE_SCOPE_GLOBAL,
  MOD_STATE_SCOPE_LOCAL,
  MOD_POSITION_DEFINITIONS,
  MOD_IMAGE_TYPE_DEFINITIONS,
  normalizeModPosition,
  normalizeModsPanelPositionFilter,
  normalizeModCharacterCardId,
  normalizeModAfterCharName,
  normalizeRequiredModShortname,
  normalizeModImageTypes,
  normalizeModEntry,
  normalizeModItemEntry,
  deriveModGroupName,
  createModId,
  createDefaultModImageTypes,
  isModGroup,
  getSelectedModItem,
  getModsSettings,
  getNormalizedModsSettings,
  getVisibleModsForCurrentChat,
  getModPositionDefinition,
  getModsPanelFilterLabel,
} from "./character-details-mod-prompts.js";

const extensionName = "st-charmander";
const MOBILE_DRAWER_MEDIA_QUERY = "(max-width: 1000px)";

// ── DOM refs ──────────────────────────────────────────────────────────────────
let modsPanelContainerRoot = null;
let mobileDrawerLeftToggleButton = null;
let modsPanelRoot = null;
let modsPositionFilterRoot = null;
let modsAddButton = null;

// ── UI state ──────────────────────────────────────────────────────────────────
let openModImageTypesForId = null;
let openModPositionForId = null;
let openModPositionOpensUpward = false;
let openModGroupForId = null;
let openModGroupOpensUpward = false;
let modsPanelPositionFilter = MODS_PANEL_FILTER_ALL;
let mobileDrawerLeftOpen = false;
let mobileDrawerLeftBindingsInitialized = false;
let draggedModId = null;

// ── DI from index.js ──────────────────────────────────────────────────────────
let _getState = () => null;

// ── Settings helpers ──────────────────────────────────────────────────────────
function isMobileDrawerMode() {
  return window.matchMedia(MOBILE_DRAWER_MEDIA_QUERY).matches;
}

function shouldShowModsPanel() {
  return extension_settings?.[extensionName]?.show_mods_panel === true;
}

function shouldUseTallModsInDesktopMode() {
  return extension_settings?.[extensionName]?.use_tall_mods_in_desktop_mode === true;
}

// ── UI state helpers ──────────────────────────────────────────────────────────
function getUiState() {
  return {
    openModImageTypesForId,
    openModPositionForId,
    openModPositionOpensUpward,
    openModGroupForId,
    openModGroupOpensUpward,
    modsPanelPositionFilter,
  };
}

function patchUiState(patch = {}) {
  if (Object.hasOwn(patch, "openModImageTypesForId")) {
    openModImageTypesForId = patch.openModImageTypesForId;
  }

  if (Object.hasOwn(patch, "openModPositionForId")) {
    openModPositionForId = patch.openModPositionForId;
  }

  if (Object.hasOwn(patch, "openModPositionOpensUpward")) {
    openModPositionOpensUpward = Boolean(patch.openModPositionOpensUpward);
  }

  if (Object.hasOwn(patch, "openModGroupForId")) {
    openModGroupForId = patch.openModGroupForId;
  }

  if (Object.hasOwn(patch, "openModGroupOpensUpward")) {
    openModGroupOpensUpward = Boolean(patch.openModGroupOpensUpward);
  }

  if (Object.hasOwn(patch, "modsPanelPositionFilter")) {
    modsPanelPositionFilter = normalizeModsPanelPositionFilter(patch.modsPanelPositionFilter);
  }
}

// ── Mod panel DI helpers (moved from character-details-panel.js) ──────────────
function getDefaultAfterCharName() {
  const currentState = _getState();
  const activeCharId = currentState?.activeCharacterId;
  if (!activeCharId) {
    return "";
  }

  const characters = Array.isArray(currentState?.characters) ? currentState.characters : [];
  const active = characters.find((c) => c.id === activeCharId);
  return String(active?.name || "").trim();
}

function getDefaultModPositionForCreate() {
  const filterValue = normalizeModsPanelPositionFilter(modsPanelPositionFilter);
  if (filterValue === MODS_PANEL_FILTER_ALL) {
    return MOD_POSITION_MIDDLE;
  }

  return normalizeModPosition(filterValue);
}

function resolveCharacterModAssignment(shouldBindToCharacter, existingCharacterId = "") {
  if (!shouldBindToCharacter) {
    return "";
  }

  const currentCharacterId = getCurrentChatCharacterCardId(getContext());
  if (currentCharacterId) {
    return currentCharacterId;
  }

  const fallbackCharacterId = normalizeModCharacterCardId(existingCharacterId);
  if (fallbackCharacterId) {
    return fallbackCharacterId;
  }

  toastr.warning("Character mod could not be assigned because there is no active character-card chat.", "Character Details");
  return "";
}

function setLocalModEnabledState(modId, enabled) {
  const context = getContext();
  const localState = cleanupModsLocalState(context, getNormalizedModsSettings());
  const normalizedModId = String(modId || "").trim();
  if (!normalizedModId) {
    return;
  }

  localState.enabledByModId[normalizedModId] = enabled === true;
  writeModsLocalState(context, localState);
}

function setLocalGroupSelectedItem(modId, itemId) {
  const context = getContext();
  const localState = cleanupModsLocalState(context, getNormalizedModsSettings());
  const normalizedModId = String(modId || "").trim();
  const normalizedItemId = String(itemId || "").trim();
  if (!normalizedModId) {
    return;
  }

  if (normalizedItemId) {
    localState.selectedItemByGroupModId[normalizedModId] = normalizedItemId;
  } else {
    delete localState.selectedItemByGroupModId[normalizedModId];
  }

  writeModsLocalState(context, localState);
}

async function showModItemEditorPopup({
  title,
  okButton,
  shortnameValue = "",
  detailsValue = "",
  initialPosition = MOD_POSITION_MIDDLE,
  includeGroupName = false,
  initialGroupName = "",
  includeModSettings = true,
  initialCharacterMod = false,
  initialLocalState = false,
} = {}) {
  return showModItemEditorPopupModal({
    title,
    okButton,
    shortnameValue,
    detailsValue,
    initialPosition,
    includeGroupName,
    initialGroupName,
    includeModSettings,
    initialCharacterMod,
    initialLocalState,
  }, {
    Popup,
    POPUP_TYPE,
    escapeHtml,
    normalizeRequiredModShortname,
    normalizeModPosition,
    MOD_POSITION_DEFINITIONS,
    toastr,
  });
}

// ── Left drawer (moved from character-details-panel.js) ───────────────────────
function isModActiveForCurrentChat(mod) {
  if (!mod?.enabled) {
    return false;
  }

  if (normalizeModPosition(mod.position) === MOD_POSITION_AFTER_CHAR) {
    return Boolean(findCharacterByName(_getState() || {}, mod.afterCharName));
  }

  return true;
}

function getActiveModsCountForCurrentChat() {
  const context = getContext();
  const mods = getVisibleModsForCurrentChat(getModsSettings(context), context);
  return mods.filter((mod) => isModActiveForCurrentChat(mod)).length;
}

function renderLeftDrawerState() {
  if (!modsPanelContainerRoot?.length || !mobileDrawerLeftToggleButton?.length) {
    return;
  }

  const mobileMode = isMobileDrawerMode();
  modsPanelContainerRoot.toggleClass("is-mobile-collapsed", mobileMode && !mobileDrawerLeftOpen);
  modsPanelContainerRoot.toggleClass("is-desktop-collapsed", !mobileMode && !mobileDrawerLeftOpen);

  mobileDrawerLeftToggleButton.toggleClass("is-open", mobileDrawerLeftOpen);
  const activeModsCount = getActiveModsCountForCurrentChat();
  const showActiveGlow = !mobileDrawerLeftOpen && activeModsCount > 0;
  mobileDrawerLeftToggleButton.toggleClass("has-active-mods", showActiveGlow);

  let badge = mobileDrawerLeftToggleButton.find(".st-extension-mobile-drawer-left-toggle__count");
  if (!badge.length) {
    mobileDrawerLeftToggleButton.append('<span class="st-extension-mobile-drawer-left-toggle__count displayNone"></span>');
    badge = mobileDrawerLeftToggleButton.find(".st-extension-mobile-drawer-left-toggle__count");
  }

  badge.text(String(activeModsCount));
  badge.toggleClass("displayNone", !(showActiveGlow && activeModsCount > 0));

  const icon = mobileDrawerLeftToggleButton.find("i");
  icon
    .removeClass("fa-angle-left fa-angle-right fa-gear fa-gears")
    .addClass(mobileDrawerLeftOpen ? "fa-angle-left" : (activeModsCount > 0 ? "fa-gears" : "fa-gear"));

  mobileDrawerLeftToggleButton.attr(
    "title",
    mobileDrawerLeftOpen
      ? "Close mods panel"
      : (activeModsCount > 0 ? `${activeModsCount} mod(s) active – open mods panel` : "Open mods panel"),
  );
}

function initializeLeftMobileDrawer() {
  if (!modsPanelContainerRoot?.length || !mobileDrawerLeftToggleButton?.length) {
    return;
  }

  if (!mobileDrawerLeftBindingsInitialized) {
    mobileDrawerLeftBindingsInitialized = true;

    mobileDrawerLeftToggleButton.on("click", () => {
      mobileDrawerLeftOpen = !mobileDrawerLeftOpen;
      renderLeftDrawerState();
    });

    const onViewportChange = () => {
      renderLeftDrawerState();
    };

    const mediaQueryList = window.matchMedia(MOBILE_DRAWER_MEDIA_QUERY);
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", onViewportChange);
    } else if (typeof mediaQueryList.addListener === "function") {
      mediaQueryList.addListener(onViewportChange);
    }
  }

  mobileDrawerLeftOpen = false;
  renderLeftDrawerState();
}

function bindModsPanelEvents() {
  modsPositionFilterRoot.on("click", handleModsPositionFilterClick);
  modsAddButton.on("click", () => {
    void handleAddMod();
  });
  modsPanelRoot.on("click", handleModPanelClick);
  modsPanelRoot.on("change", handleModPanelChange);
  modsPanelRoot.on("input", handleModPanelInput);
  modsPanelRoot.on("dragstart", handleModDragStart);
  modsPanelRoot.on("dragover", handleModDragOver);
  modsPanelRoot.on("drop", handleModDrop);
  modsPanelRoot.on("dragend", handleModDragEnd);
}

// ── saveModsSettings ──────────────────────────────────────────────────────────
function saveModsSettings(nextMods, options = {}) {
  const rerender = options.rerender !== false;
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  const normalizedMods = (Array.isArray(nextMods) ? nextMods : []).map((mod) => normalizeModEntry(mod));
  extension_settings[extensionName].mods = normalizedMods;
  cleanupModsLocalState(getContext(), normalizedMods);
  saveSettingsDebounced();
  renderLeftDrawerState();

  if (rerender) {
    renderModsPanel();
  }
}

export function renderModsPanelVisibility() {
  if (!modsPanelContainerRoot?.length || !mobileDrawerLeftToggleButton?.length) {
    return;
  }

  const visible = shouldShowModsPanel();
  modsPanelContainerRoot.toggleClass("is-hidden", !visible);
  mobileDrawerLeftToggleButton.toggleClass("displayNone", !visible);

  if (!visible) {
    patchUiState({
      openModImageTypesForId: null,
      openModPositionForId: null,
      openModGroupForId: null,
    });
    return;
  }

  renderLeftDrawerState();
  renderModsPositionFilterState();
  renderModsPanel();
}

export function renderModsPositionFilterState() {
  if (!modsPositionFilterRoot?.length) {
    return;
  }

  const uiState = getUiState();
  const filterValue = normalizeModsPanelPositionFilter(uiState.modsPanelPositionFilter);
  modsPositionFilterRoot
    .find("[data-mods-filter]")
    .each((_, element) => {
      const button = $(element);
      const buttonFilter = normalizeModsPanelPositionFilter(button.data("modsFilter"));
      const active = buttonFilter === filterValue;
      button.toggleClass("is-active", active);
      button.attr("aria-pressed", active ? "true" : "false");
      button.attr("tabindex", active ? "0" : "-1");
    });
}

export function getEnabledModImageTypeCount(mod) {
  return MOD_IMAGE_TYPE_DEFINITIONS
    .filter((definition) => mod?.imageTypes?.[definition.key] !== false)
    .length;
}

export function getModImageTypesButtonTitle(mod) {
  const enabledLabels = MOD_IMAGE_TYPE_DEFINITIONS
    .filter((definition) => mod?.imageTypes?.[definition.key] !== false)
    .map((definition) => definition.label);

  if (enabledLabels.length === MOD_IMAGE_TYPE_DEFINITIONS.length) {
    return "Active for all image types";
  }

  if (enabledLabels.length === 0) {
    return "Active for no image types";
  }

  return `Active for: ${enabledLabels.join(", ")}`;
}

export function renderModsPanel() {
  if (!modsPanelRoot?.length) {
    return;
  }

  if (!shouldShowModsPanel()) {
    modsPanelRoot.empty();
    return;
  }

  const uiState = getUiState();
  const useTallLayout = isMobileDrawerMode() || shouldUseTallModsInDesktopMode();
  modsPanelRoot.toggleClass("is-tall-layout", useTallLayout);

  const context = getContext();
  const mods = getVisibleModsForCurrentChat(getModsSettings(context), context);
  if (!mods.length) {
    modsPanelRoot.html('<div class="character-mods-panel__empty">No mods yet. Use + to add one.</div>');
    return;
  }

  const filterValue = normalizeModsPanelPositionFilter(uiState.modsPanelPositionFilter);
  const visibleMods = mods.filter((mod) => {
    if (filterValue === MODS_PANEL_FILTER_ALL) {
      return true;
    }

    return normalizeModPosition(mod.position) === filterValue;
  });

  patchUiState({
    openModImageTypesForId: uiState.openModImageTypesForId && !visibleMods.some((mod) => mod.id === uiState.openModImageTypesForId)
      ? null
      : uiState.openModImageTypesForId,
    openModPositionForId: uiState.openModPositionForId && !visibleMods.some((mod) => mod.id === uiState.openModPositionForId)
      ? null
      : uiState.openModPositionForId,
    openModGroupForId: uiState.openModGroupForId && !visibleMods.some((mod) => mod.id === uiState.openModGroupForId)
      ? null
      : uiState.openModGroupForId,
  });

  const nextUiState = getUiState();

  if (!visibleMods.length) {
    modsPanelRoot.html(`<div class="character-mods-panel__empty">No mods in ${escapeHtml(getModsPanelFilterLabel(filterValue))}.</div>`);
    return;
  }

  const state = _getState() || {};

  const html = visibleMods.map((mod) => {
    const groupEntry = isModGroup(mod);
    const selectedItem = getSelectedModItem(mod);
    const displayedShortname = groupEntry
      ? `${String(mod.groupName || "Group").trim()} - ${String(selectedItem?.shortname || "Unnamed").trim() || "Unnamed"}`
      : String(mod.shortname || "").trim() || "Unnamed";
    const enabledTypesCount = getEnabledModImageTypeCount(mod);
    const allTypesEnabled = enabledTypesCount === MOD_IMAGE_TYPE_DEFINITIONS.length;
    const typesPopupOpen = nextUiState.openModImageTypesForId === mod.id;
    const groupPopupOpen = nextUiState.openModGroupForId === mod.id;
    const position = normalizeModPosition(mod.position);
    const positionDefinition = getModPositionDefinition(position);
    const positionPopupOpen = nextUiState.openModPositionForId === mod.id;
    const stateScopeLabel = mod.stateScope === MOD_STATE_SCOPE_LOCAL ? "local" : "global";
    const afterCharName = normalizeModAfterCharName(mod.afterCharName);
    const afterCharMatch = findCharacterByName(state, afterCharName);
    const afterCharInvalid = position === MOD_POSITION_AFTER_CHAR
      && !afterCharMatch
      && !isSupportedAfterCharMacro(afterCharName);

    const typeButtons = MOD_IMAGE_TYPE_DEFINITIONS.map((definition) => {
      const typeEnabled = mod.imageTypes?.[definition.key] !== false;
      return `
        <button
          type="button"
          class="mod-item__image-type ${typeEnabled ? "" : "is-disabled"}"
          data-action="toggle-mod-image-type"
          data-mod-id="${escapeHtml(mod.id)}"
          data-image-type="${escapeHtml(definition.key)}"
          title="${escapeHtml(definition.label)}"
        >
          <i class="fa-solid ${definition.icon}"></i>
        </button>
      `;
    }).join("");

    const positionOptions = MOD_POSITION_DEFINITIONS.map((definition) => {
      const selected = position === definition.key;
      return `
        <button
          type="button"
          class="mod-item__position-option ${selected ? "is-active" : ""}"
          data-action="set-mod-position"
          data-mod-id="${escapeHtml(mod.id)}"
          data-position="${escapeHtml(definition.key)}"
          title="${escapeHtml(definition.label)}"
        >
          <i class="fa-solid ${definition.icon}"></i>
          <span>${escapeHtml(definition.label)}</span>
        </button>
      `;
    }).join("");

    const groupOptions = (Array.isArray(mod.items) ? mod.items : []).map((item) => {
      const selected = item.id === selectedItem?.id;
      return `
        <button
          type="button"
          class="mod-item__group-option ${selected ? "is-active" : ""}"
          data-action="select-mod-group-item"
          data-mod-id="${escapeHtml(mod.id)}"
          data-item-id="${escapeHtml(item.id)}"
          title="${escapeHtml(item.shortname)}"
        >
          ${escapeHtml(item.shortname)}
        </button>
      `;
    }).join("");

    const shortnameControl = groupEntry
      ? `
        <div class="mod-item__group-wrap">
          <button
            type="button"
            class="menu_button mod-item__group-trigger"
            data-action="toggle-mod-group-menu"
            data-mod-id="${escapeHtml(mod.id)}"
            title="Select active group mod"
          >
            <span class="mod-item__group-trigger-label">${escapeHtml(displayedShortname)}</span>
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <div class="mod-item__group-popup ${groupPopupOpen ? "is-open" : ""} ${groupPopupOpen && nextUiState.openModGroupOpensUpward ? "opens-upward" : ""}">
            ${groupOptions}
          </div>
        </div>
      `
      : `
        <div
          class="mod-item__shortname"
          title="${escapeHtml(displayedShortname)}"
        >${escapeHtml(displayedShortname)}</div>
      `;

    const primaryLabelControl = position === MOD_POSITION_AFTER_CHAR
      ? `
        <div class="mod-item__name-pair">
          <input
            class="text_pole mod-item__charname-input ${afterCharInvalid ? "is-invalid" : ""}"
            type="text"
            value="${escapeHtml(afterCharName)}"
            data-field="mod-after-char-name"
            data-mod-id="${escapeHtml(mod.id)}"
            title="${afterCharInvalid ? "Character not found in this chat" : "Character name for after-char mod"}"
          />
          ${shortnameControl}
        </div>
      `
      : shortnameControl;

    const secondaryActionConfig = groupEntry
      ? { action: "add-mod-to-group", title: "Add mod to group", icon: "fa-plus" }
      : { action: "convert-mod-to-group", title: "Convert to group", icon: "fa-layer-group" };

    const secondaryActionButton = `
      <button
        type="button"
        class="mod-item__action"
        data-action="${secondaryActionConfig.action}"
        data-mod-id="${escapeHtml(mod.id)}"
        title="${secondaryActionConfig.title}"
      >
        <i class="fa-solid ${secondaryActionConfig.icon}"></i>
      </button>
    `;

    const rowClass = [
      "mod-item",
      groupEntry ? "mod-item--group" : "",
      mod.characterId ? "mod-item--character" : "",
      position === MOD_POSITION_AFTER_CHAR ? "mod-item--after-char" : "",
    ].filter(Boolean).join(" ");

    if (useTallLayout) {
      const afterCharInput = position === MOD_POSITION_AFTER_CHAR
        ? `
          <input
            class="text_pole mod-item__charname-input mod-item__charname-input--tall ${afterCharInvalid ? "is-invalid" : ""}"
            type="text"
            value="${escapeHtml(afterCharName)}"
            data-field="mod-after-char-name"
            data-mod-id="${escapeHtml(mod.id)}"
            title="${afterCharInvalid ? "Character not found in this chat" : "Character name for after-char mod"}"
          />
        `
        : '<div class="mod-item__charname-placeholder"></div>';

      return `
        <div class="${rowClass}" data-mod-id="${escapeHtml(mod.id)}">
          <div class="st-mod-item__tall-row-top">
            <span class="mod-item__drag-handle" draggable="true" title="Drag to reorder">
              <i class="fa-solid fa-grip-vertical"></i>
            </span>
            <button
              type="button"
              class="mod-item__led ${mod.enabled ? "is-enabled" : ""}"
              data-action="toggle-mod-enabled"
              data-mod-id="${escapeHtml(mod.id)}"
              title="${mod.enabled ? "Disable mod" : "Enable mod"} (${stateScopeLabel} state)"
            >
              <i class="fa-solid fa-circle"></i>
            </button>
            <div class="mod-item__types-wrap">
              <button
                type="button"
                class="menu_button mod-item__image-types-button ${allTypesEnabled ? "" : "is-filtered"}"
                data-action="toggle-mod-image-types"
                data-mod-id="${escapeHtml(mod.id)}"
                title="${escapeHtml(getModImageTypesButtonTitle(mod))}"
              >
                <i class="fa-solid fa-images"></i>
              </button>
              <div class="mod-item__image-types-popup ${typesPopupOpen ? "is-open" : ""}">
                ${typeButtons}
              </div>
            </div>
            <div class="mod-item__position-wrap">
              <button
                type="button"
                class="menu_button mod-item__position-trigger"
                data-action="toggle-mod-position-menu"
                data-mod-id="${escapeHtml(mod.id)}"
                title="${escapeHtml(positionDefinition.label)}"
              >
                <i class="fa-solid ${positionDefinition.icon}"></i>
              </button>
              <div class="mod-item__position-popup ${positionPopupOpen ? "is-open" : ""} ${positionPopupOpen && nextUiState.openModPositionOpensUpward ? "opens-upward" : ""}">
                ${positionOptions}
              </div>
            </div>
            ${afterCharInput}
          </div>
          <div class="st-mod-item__tall-row-bottom">
            <div class="mod-item__shortname-slot">${shortnameControl}</div>
            <button
              type="button"
              class="mod-item__action mod-item__action--edit"
              data-action="edit-mod-entry"
              data-mod-id="${escapeHtml(mod.id)}"
              title="Edit mod"
            >
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button
              type="button"
              class="mod-item__action mod-item__action--secondary"
              data-action="${secondaryActionConfig.action}"
              data-mod-id="${escapeHtml(mod.id)}"
              title="${secondaryActionConfig.title}"
            >
              <i class="fa-solid ${secondaryActionConfig.icon}"></i>
            </button>
            <button
              type="button"
              class="mod-item__action mod-item__action--delete"
              data-action="delete-mod"
              data-mod-id="${escapeHtml(mod.id)}"
              title="Delete mod"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="${rowClass}" data-mod-id="${escapeHtml(mod.id)}">
        <span class="mod-item__drag-handle" draggable="true" title="Drag to reorder">
          <i class="fa-solid fa-grip-vertical"></i>
        </span>
        <button
          type="button"
          class="mod-item__led ${mod.enabled ? "is-enabled" : ""}"
          data-action="toggle-mod-enabled"
          data-mod-id="${escapeHtml(mod.id)}"
          title="${mod.enabled ? "Disable mod" : "Enable mod"} (${stateScopeLabel} state)"
        >
          <i class="fa-solid fa-circle"></i>
        </button>
        <div class="mod-item__types-wrap">
          <button
            type="button"
            class="menu_button mod-item__image-types-button ${allTypesEnabled ? "" : "is-filtered"}"
            data-action="toggle-mod-image-types"
            data-mod-id="${escapeHtml(mod.id)}"
            title="${escapeHtml(getModImageTypesButtonTitle(mod))}"
          >
            <i class="fa-solid fa-images"></i>
          </button>
          <div class="mod-item__image-types-popup ${typesPopupOpen ? "is-open" : ""}">
            ${typeButtons}
          </div>
        </div>
        <div class="mod-item__position-wrap">
          <button
            type="button"
            class="menu_button mod-item__position-trigger"
            data-action="toggle-mod-position-menu"
            data-mod-id="${escapeHtml(mod.id)}"
            title="${escapeHtml(positionDefinition.label)}"
          >
            <i class="fa-solid ${positionDefinition.icon}"></i>
          </button>
          <div class="mod-item__position-popup ${positionPopupOpen ? "is-open" : ""} ${positionPopupOpen && nextUiState.openModPositionOpensUpward ? "opens-upward" : ""}">
            ${positionOptions}
          </div>
        </div>
        ${primaryLabelControl}
        <button
          type="button"
          class="mod-item__action"
          data-action="edit-mod-entry"
          data-mod-id="${escapeHtml(mod.id)}"
          title="Edit mod"
        >
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        ${secondaryActionButton}
        <button
          type="button"
          class="mod-item__action"
          data-action="delete-mod"
          data-mod-id="${escapeHtml(mod.id)}"
          title="Delete mod"
        >
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
  }).join("");

  modsPanelRoot.html(html);
  renderLeftDrawerState();

  if (nextUiState.openModPositionForId) {
    const positionTrigger = modsPanelRoot
      .find(`.mod-item__position-trigger[data-mod-id='${nextUiState.openModPositionForId}']`)
      .get(0);
    patchUiState({
      openModPositionOpensUpward: shouldPopupOpenUpward(positionTrigger),
    });
  }

  if (nextUiState.openModGroupForId) {
    const groupTrigger = modsPanelRoot
      .find(`.mod-item__group-trigger[data-mod-id='${nextUiState.openModGroupForId}']`)
      .get(0);
    patchUiState({
      openModGroupOpensUpward: shouldPopupOpenUpward(groupTrigger),
    });
  }
}

export function handleModsPositionFilterClick(event) {
  const actionOwner = event.target.closest("[data-mods-filter]");
  if (!actionOwner) {
    return;
  }

  const uiState = getUiState();
  const nextFilter = normalizeModsPanelPositionFilter(actionOwner.dataset.modsFilter);
  if (uiState.modsPanelPositionFilter === nextFilter) {
    return;
  }

  patchUiState({
    modsPanelPositionFilter: nextFilter,
    openModImageTypesForId: null,
    openModPositionForId: null,
    openModGroupForId: null,
  });
  renderModsPositionFilterState();
  renderModsPanel();
}

export function handleModImageTypesMenuToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const uiState = getUiState();
  patchUiState({
    openModPositionForId: null,
    openModGroupForId: null,
    openModImageTypesForId: uiState.openModImageTypesForId === modId ? null : modId,
  });
  renderModsPanel();
}

export function handleModPositionMenuToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const uiState = getUiState();
  const willOpen = uiState.openModPositionForId !== modId;
  patchUiState({
    openModImageTypesForId: null,
    openModGroupForId: null,
    openModPositionForId: willOpen ? modId : null,
    openModPositionOpensUpward: willOpen ? shouldPopupOpenUpward(actionOwner) : false,
  });
  renderModsPanel();
}

export function handleModGroupMenuToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const uiState = getUiState();
  const willOpen = uiState.openModGroupForId !== modId;
  patchUiState({
    openModImageTypesForId: null,
    openModPositionForId: null,
    openModGroupForId: willOpen ? modId : null,
    openModGroupOpensUpward: willOpen ? shouldPopupOpenUpward(actionOwner) : false,
  });
  renderModsPanel();
}

export async function handleAddMod() {
  const edited = await showModItemEditorPopup({
    title: "Create mod",
    okButton: "Add",
    shortnameValue: "",
    detailsValue: "",
    initialPosition: getDefaultModPositionForCreate(),
    includeModSettings: true,
    initialCharacterMod: false,
    initialLocalState: false,
  });

  if (!edited) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const characterId = resolveCharacterModAssignment(edited.characterMod === true, "");
  const position = normalizeModPosition(edited.position);
  const afterCharName = position === MOD_POSITION_AFTER_CHAR ? getDefaultAfterCharName() : "";
  mods.push({
    id: createModId(),
    type: MOD_ENTRY_TYPE_SINGLE,
    enabled: true,
    position,
    shortname: edited.shortname,
    fullContent: edited.fullContent,
    imageTypes: createDefaultModImageTypes(),
    stateScope: edited.localState ? MOD_STATE_SCOPE_LOCAL : MOD_STATE_SCOPE_GLOBAL,
    characterId,
    afterCharName,
  });
  saveModsSettings(mods);
}

export function handleModEnabledToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  const mod = mods[index];
  const effectiveMod = getModsSettings().find((item) => item.id === modId) || mod;
  const nextEnabled = !effectiveMod?.enabled;
  if (mod.stateScope === MOD_STATE_SCOPE_LOCAL) {
    setLocalModEnabledState(modId, nextEnabled);
    renderModsPanel();
    return;
  }

  mods[index].enabled = nextEnabled;
  saveModsSettings(mods);
}

export function handleModGroupItemSelect(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  const itemId = String(actionOwner?.dataset?.itemId || "").trim();
  if (!modId || !itemId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1 || !isModGroup(mods[index])) {
    return;
  }

  const items = Array.isArray(mods[index].items) ? mods[index].items : [];
  if (!items.some((item) => item.id === itemId)) {
    return;
  }

  if (mods[index].stateScope === MOD_STATE_SCOPE_LOCAL) {
    setLocalGroupSelectedItem(modId, itemId);
    patchUiState({ openModGroupForId: null });
    renderModsPanel();
    return;
  }

  mods[index].selectedItemId = itemId;
  patchUiState({ openModGroupForId: null });
  saveModsSettings(mods);
}

export function handleModImageTypeToggle(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  const imageType = String(actionOwner?.dataset?.imageType || "").trim();
  if (!modId || !imageType) {
    return;
  }

  if (!MOD_IMAGE_TYPE_DEFINITIONS.some((definition) => definition.key === imageType)) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  const nextImageTypes = normalizeModImageTypes(mods[index].imageTypes);
  nextImageTypes[imageType] = !nextImageTypes[imageType];
  mods[index].imageTypes = nextImageTypes;
  patchUiState({ openModImageTypesForId: modId });
  saveModsSettings(mods);
}

export function handleModPositionChange(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  const nextPosition = normalizeModPosition(actionOwner?.dataset?.position || actionOwner?.value);
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  mods[index].position = nextPosition;
  if (nextPosition === MOD_POSITION_AFTER_CHAR && !normalizeModAfterCharName(mods[index].afterCharName)) {
    mods[index].afterCharName = getDefaultAfterCharName();
  }
  patchUiState({ openModPositionForId: null });
  saveModsSettings(mods);
}

export async function handleConvertModToGroup(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1 || isModGroup(mods[index])) {
    return;
  }

  const groupNameInput = await Popup?.show?.input?.(
    "Convert to group",
    "Enter name for this group:",
    mods[index].shortname,
    { okButton: "Convert", cancelButton: "Cancel", rows: 1 },
  );

  if (groupNameInput === null) {
    return;
  }

  const groupName = normalizeRequiredModShortname(groupNameInput);
  if (!groupName) {
    toastr?.warning?.("Group name is required.", "Character Details");
    return;
  }

  const source = mods[index];
  const groupItem = normalizeModItemEntry({
    shortname: source.shortname,
    fullContent: source.fullContent,
  });

  mods[index] = normalizeModEntry({
    ...source,
    type: MOD_ENTRY_TYPE_GROUP,
    groupName,
    items: [groupItem],
    selectedItemId: groupItem.id,
  });
  patchUiState({ openModGroupForId: null });
  saveModsSettings(mods);
}

export async function handleAddModToGroup(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1 || !isModGroup(mods[index])) {
    return;
  }

  const edited = await showModItemEditorPopup({
    title: "Add mod to group",
    okButton: "Add",
    shortnameValue: "",
    detailsValue: "",
    includeModSettings: false,
  });

  if (!edited) {
    return;
  }

  const nextItem = normalizeModItemEntry({
    shortname: edited.shortname,
    fullContent: edited.fullContent,
  });
  mods[index].items = Array.isArray(mods[index].items) ? mods[index].items : [];
  mods[index].items.push(nextItem);
  mods[index].selectedItemId = nextItem.id;
  patchUiState({ openModGroupForId: null });
  saveModsSettings(mods);
}

export async function handleModEntryEdit(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  const mod = mods[index];
  const previousStateScope = mod.stateScope;
  const effectiveModBeforeEdit = getModsSettings().find((item) => item.id === modId) || mod;
  const editingGroupItem = isModGroup(effectiveModBeforeEdit)
    ? getSelectedModItem(effectiveModBeforeEdit)
    : null;
  const edited = await showModItemEditorPopup({
    title: isModGroup(mod) ? "Edit selected group mod" : "Edit mod",
    okButton: "Save",
    shortnameValue: isModGroup(mod) ? editingGroupItem?.shortname : mod.shortname,
    detailsValue: isModGroup(mod) ? editingGroupItem?.fullContent : mod.fullContent,
    initialPosition: mod.position,
    includeGroupName: isModGroup(mod),
    initialGroupName: isModGroup(mod) ? mod.groupName : "",
    includeModSettings: true,
    initialCharacterMod: Boolean(normalizeModCharacterCardId(mod.characterId)),
    initialLocalState: mod.stateScope === MOD_STATE_SCOPE_LOCAL,
  });

  if (!edited) {
    return;
  }

  if (isModGroup(mod)) {
    if (!editingGroupItem) {
      return;
    }

    mod.groupName = deriveModGroupName(edited.groupName);

    mod.items = (Array.isArray(mod.items) ? mod.items : []).map((item) => {
      if (item.id !== editingGroupItem.id) {
        return item;
      }

      return normalizeModItemEntry({
        ...item,
        shortname: edited.shortname,
        fullContent: edited.fullContent,
      });
    });
  } else {
    mod.shortname = edited.shortname;
    mod.fullContent = edited.fullContent;
  }

  mod.characterId = resolveCharacterModAssignment(edited.characterMod === true, mod.characterId);
  mod.position = normalizeModPosition(edited.position);
  if (mod.position === MOD_POSITION_AFTER_CHAR && !normalizeModAfterCharName(mod.afterCharName)) {
    mod.afterCharName = getDefaultAfterCharName();
  }
  mod.stateScope = edited.localState ? MOD_STATE_SCOPE_LOCAL : MOD_STATE_SCOPE_GLOBAL;

  if (previousStateScope !== MOD_STATE_SCOPE_LOCAL && mod.stateScope === MOD_STATE_SCOPE_LOCAL) {
    seedCurrentChatLocalStateFromMod(mods, mod, effectiveModBeforeEdit);
  }

  saveModsSettings(mods);
}

export async function handleModDelete(actionOwner) {
  const modId = String(actionOwner?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  const mod = mods[index];
  if (!isModGroup(mod)) {
    const confirmed = await Popup?.show?.confirm?.(
      "Delete mod",
      "Are you sure you want to delete this mod?",
      { okButton: "Delete", cancelButton: "Cancel" },
    );

    if (!confirmed) {
      return;
    }

    const nextMods = mods.filter((item) => item.id !== modId);
    patchUiState({
      openModImageTypesForId: getUiState().openModImageTypesForId === modId ? null : getUiState().openModImageTypesForId,
      openModPositionForId: getUiState().openModPositionForId === modId ? null : getUiState().openModPositionForId,
      openModGroupForId: getUiState().openModGroupForId === modId ? null : getUiState().openModGroupForId,
    });
    saveModsSettings(nextMods);
    return;
  }

  const effectiveMod = getModsSettings().find((item) => item.id === modId) || mod;
  const selectedItem = isModGroup(effectiveMod) ? getSelectedModItem(effectiveMod) : null;
  if (!selectedItem) {
    return;
  }

  const itemCount = Array.isArray(mod.items) ? mod.items.length : 0;
  const deleteMessage = itemCount <= 1
    ? "Are you sure you want to delete selected mod from this group? If you remove this mod whole group will be removed"
    : "Are you sure you want to delete selected mod from this group?";

  const confirmed = await Popup?.show?.confirm?.(
    "Delete selected group mod",
    deleteMessage,
    { okButton: "Delete", cancelButton: "Cancel" },
  );

  if (!confirmed) {
    return;
  }

  if (itemCount <= 1) {
    const nextMods = mods.filter((item) => item.id !== modId);
    patchUiState({
      openModImageTypesForId: getUiState().openModImageTypesForId === modId ? null : getUiState().openModImageTypesForId,
      openModPositionForId: getUiState().openModPositionForId === modId ? null : getUiState().openModPositionForId,
      openModGroupForId: getUiState().openModGroupForId === modId ? null : getUiState().openModGroupForId,
    });
    saveModsSettings(nextMods);
    return;
  }

  const selectedIndex = mod.items.findIndex((item) => item.id === selectedItem.id);
  if (selectedIndex === -1) {
    return;
  }
  mod.items.splice(selectedIndex, 1);
  const nextSelection = mod.items[Math.min(selectedIndex, mod.items.length - 1)] || mod.items[0];
  mod.selectedItemId = nextSelection?.id || "";
  saveModsSettings(mods);
}

export function handleModPanelInput(event) {
  const target = event.target;
  if (!target || target.dataset?.field !== "mod-after-char-name") {
    return;
  }

  const modId = String(target.dataset.modId || "").trim();
  if (!modId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const index = mods.findIndex((mod) => mod.id === modId);
  if (index === -1) {
    return;
  }

  mods[index].afterCharName = normalizeModAfterCharName(target.value);
  saveModsSettings(mods, { rerender: false });

  const isValid = Boolean(findCharacterByName(_getState?.(), mods[index].afterCharName))
    || isSupportedAfterCharMacro(mods[index].afterCharName);
  target.classList.toggle("is-invalid", !isValid);
  target.setAttribute("title", isValid ? "Character name for after-char mod" : "Character not found in this chat");
}

export function handleModPanelClick(event) {
  const actionOwner = event.target.closest("[data-action]");
  if (!actionOwner) {
    return;
  }

  const action = String(actionOwner.dataset.action || "").trim();
  if (!action) {
    return;
  }

  if (action === "toggle-mod-enabled") {
    handleModEnabledToggle(actionOwner);
    return;
  }

  if (action === "toggle-mod-image-types") {
    handleModImageTypesMenuToggle(actionOwner);
    return;
  }

  if (action === "toggle-mod-group-menu") {
    handleModGroupMenuToggle(actionOwner);
    return;
  }

  if (action === "select-mod-group-item") {
    handleModGroupItemSelect(actionOwner);
    return;
  }

  if (action === "toggle-mod-position-menu") {
    handleModPositionMenuToggle(actionOwner);
    return;
  }

  if (action === "set-mod-position") {
    handleModPositionChange(actionOwner);
    return;
  }

  if (action === "toggle-mod-image-type") {
    handleModImageTypeToggle(actionOwner);
    return;
  }

  if (action === "edit-mod-entry") {
    void handleModEntryEdit(actionOwner);
    return;
  }

  if (action === "convert-mod-to-group") {
    void handleConvertModToGroup(actionOwner);
    return;
  }

  if (action === "add-mod-to-group") {
    void handleAddModToGroup(actionOwner);
    return;
  }

  if (action === "delete-mod") {
    void handleModDelete(actionOwner);
  }
}

export function handleModPanelChange(event) {
  const actionOwner = event.target.closest("[data-action]");
  if (!actionOwner) {
    return;
  }

  const action = String(actionOwner.dataset.action || "").trim();
  if (action === "set-mod-position") {
    handleModPositionChange(actionOwner);
  }
}

export function handleModPanelOutsideClick(event) {
  const uiState = getUiState();
  if (!uiState.openModImageTypesForId && !uiState.openModPositionForId && !uiState.openModGroupForId) {
    return;
  }

  const target = event.target;
  if (target?.closest?.(".mod-item__types-wrap")) {
    return;
  }

  if (target?.closest?.(".mod-item__position-wrap")) {
    return;
  }

  if (target?.closest?.(".mod-item__group-wrap")) {
    return;
  }

  patchUiState({
    openModImageTypesForId: null,
    openModPositionForId: null,
    openModGroupForId: null,
  });
  renderModsPanel();
}

export function handleModDragStart(event) {
  const dragOrigin = event.target;
  const dragHandle = dragOrigin?.closest?.(".mod-item__drag-handle");
  const nativeEvent = event.originalEvent || event;

  if (!dragHandle) {
    if (nativeEvent.dataTransfer) {
      nativeEvent.dataTransfer.effectAllowed = "none";
    }
    event.preventDefault();
    return;
  }

  const modItemElement = dragHandle.closest(".mod-item");
  const modId = String(modItemElement?.dataset?.modId || "").trim();
  if (!modId) {
    return;
  }

  draggedModId = modId;
  if (nativeEvent.dataTransfer) {
    nativeEvent.dataTransfer.setData("text/plain", modId);
    nativeEvent.dataTransfer.effectAllowed = "move";
  }

  modItemElement.classList.add("is-dragging");
}

export function handleModDragOver(event) {
  if (!draggedModId) {
    return;
  }

  const modItemElement = resolveModItemElement(event);
  if (!modItemElement) {
    return;
  }

  const targetModId = String(modItemElement.dataset.modId || "").trim();
  if (!targetModId || targetModId === draggedModId) {
    return;
  }

  event.preventDefault();
  const nativeEvent = event.originalEvent || event;
  const mods = getNormalizedModsSettings();
  const dropMode = resolveModDropMode(modItemElement, mods, draggedModId, nativeEvent);
  if (!dropMode) {
    return;
  }

  clearModDragIndicators(modsPanelRoot);
  modItemElement.dataset.dropMode = dropMode;
  if (dropMode === "before") {
    modItemElement.classList.add("drop-before");
  } else if (dropMode === "after") {
    modItemElement.classList.add("drop-after");
  } else if (dropMode === "into") {
    modItemElement.classList.add("drop-into");
  }
}

export function handleModDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const modItemElement = resolveModItemElement(event);
  if (!modItemElement) {
    return;
  }

  const nativeEvent = event.originalEvent || event;
  const draggedId = String(nativeEvent.dataTransfer?.getData("text/plain") || draggedModId || "").trim();
  const targetId = String(modItemElement.dataset.modId || "").trim();
  if (!draggedId || !targetId || draggedId === targetId) {
    return;
  }

  const mods = getNormalizedModsSettings();
  const draggedIndex = mods.findIndex((mod) => mod.id === draggedId);
  const targetIndex = mods.findIndex((mod) => mod.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1) {
    return;
  }

  const dropMode = String(modItemElement.dataset.dropMode || resolveModDropMode(modItemElement, mods, draggedId, nativeEvent) || "").trim();
  const draggedModEntry = mods[draggedIndex];
  const targetMod = mods[targetIndex];

  if (dropMode === "into" && isModGroup(targetMod) && !isModGroup(draggedModEntry)) {
    void (async () => {
      const shouldConvert = await Popup?.show?.confirm?.(
        "Add to group",
        "Add this mod to a group(cannot be reversed)",
        { okButton: "Yes", cancelButton: "No" },
      );

      if (!shouldConvert) {
        clearModDragIndicators(modsPanelRoot);
        return;
      }

      const nextMods = getNormalizedModsSettings();
      const nextDraggedIndex = nextMods.findIndex((mod) => mod.id === draggedId);
      const nextTargetIndex = nextMods.findIndex((mod) => mod.id === targetId);
      if (nextDraggedIndex === -1 || nextTargetIndex === -1) {
        return;
      }

      const [sourceMod] = nextMods.splice(nextDraggedIndex, 1);
      const adjustedTargetIndex = nextDraggedIndex < nextTargetIndex ? nextTargetIndex - 1 : nextTargetIndex;
      const targetGroup = nextMods[adjustedTargetIndex];
      if (!isModGroup(targetGroup)) {
        return;
      }

      const nextItem = normalizeModItemEntry({
        shortname: sourceMod.shortname,
        fullContent: sourceMod.fullContent,
      });

      targetGroup.items = Array.isArray(targetGroup.items) ? targetGroup.items : [];
      targetGroup.items.push(nextItem);
      targetGroup.selectedItemId = nextItem.id;

      patchUiState({
        openModImageTypesForId: null,
        openModPositionForId: null,
        openModGroupForId: null,
      });
      saveModsSettings(nextMods);
    })();
    return;
  }

  const [draggedMod] = mods.splice(draggedIndex, 1);
  let insertIndex = targetIndex;

  if (draggedIndex < targetIndex) {
    insertIndex -= 1;
  }

  if (dropMode === "after") {
    insertIndex += 1;
  }

  insertIndex = Math.max(0, Math.min(mods.length, insertIndex));
  mods.splice(insertIndex, 0, draggedMod);
  patchUiState({
    openModImageTypesForId: null,
    openModPositionForId: null,
    openModGroupForId: null,
  });
  saveModsSettings(mods);
}

export function handleModDragEnd(event) {
  const modItemElement = resolveModItemElement(event);
  if (modItemElement) {
    modItemElement.classList.remove("is-dragging");
  }

  draggedModId = null;
  clearModDragIndicators(modsPanelRoot);
}

export function clearModDragIndicators(modsPanelRoot) {
  modsPanelRoot?.find(".mod-item")
    .removeClass("drop-before drop-after drop-into")
    .each((_, element) => {
      delete element.dataset.dropMode;
    });
}

export function resolveModItemElement(event) {
  const target = event?.target;
  if (!target?.closest) {
    return null;
  }

  return target.closest(".mod-item");
}

export function resolveModDropMode(modItemElement, mods, draggedId, nativeEvent) {
  const targetId = String(modItemElement?.dataset?.modId || "").trim();
  if (!targetId || !draggedId || targetId === draggedId) {
    return null;
  }

  const draggedMod = mods.find((mod) => mod.id === draggedId);
  const targetMod = mods.find((mod) => mod.id === targetId);
  if (!draggedMod || !targetMod) {
    return null;
  }

  const rect = modItemElement.getBoundingClientRect();
  const pointerY = Number.isFinite(nativeEvent?.clientY) ? nativeEvent.clientY : (rect.top + rect.height / 2);
  const offsetY = pointerY - rect.top;
  const ratio = rect.height > 0 ? offsetY / rect.height : 0.5;

  if (isModGroup(targetMod) && !isModGroup(draggedMod)) {
    if (ratio >= 0.25 && ratio <= 0.75) {
      return "into";
    }

    return ratio < 0.25 ? "before" : "after";
  }

  return ratio <= 0.5 ? "before" : "after";
}

let externalEventBindingsInitialized = false;

function bindDocumentEvents() {
  $(document).off("click.stExtensionModsPanel").on("click.stExtensionModsPanel", handleModPanelOutsideClick);
  $(document)
    .off("st-charmander:mods-panel-visibility-changed")
    .on("st-charmander:mods-panel-visibility-changed", renderModsPanelVisibility);
  $(document)
    .off("st-charmander:mods-layout-changed")
    .on("st-charmander:mods-layout-changed", renderModsPanel);
}

function bindContextEvents() {
  if (externalEventBindingsInitialized) {
    return;
  }

  const context = getContext();
  if (!context?.eventSource || !context?.eventTypes) {
    return;
  }

  externalEventBindingsInitialized = true;
  const rerender = () => {
    renderModsPanelVisibility();
  };

  context.eventSource.on(context.eventTypes.CHAT_CHANGED, rerender);
  context.eventSource.on(context.eventTypes.CHAT_LOADED, rerender);
  context.eventSource.on(context.eventTypes.SETTINGS_UPDATED, rerender);
  if (context.eventTypes.CHAT_CREATED) {
    context.eventSource.on(context.eventTypes.CHAT_CREATED, rerender);
  }
  if (context.eventTypes.GROUP_CHAT_CREATED) {
    context.eventSource.on(context.eventTypes.GROUP_CHAT_CREATED, rerender);
  }
}

export function initModPanel({ getState } = {}) {
  if (typeof getState === "function") {
    _getState = getState;
  }

  modsPanelContainerRoot = $("#st-extension-left-panel");
  mobileDrawerLeftToggleButton = $("#st-extension-mobile-drawer-left-toggle");
  modsPanelRoot = $("#character-details-mods-panel");
  modsPositionFilterRoot = $("#character-details-mods-position-filter");
  modsAddButton = $("#character-details-mods-add");

  if (!modsPanelRoot.length) {
    return;
  }

  bindModsPanelEvents();
  bindDocumentEvents();
  bindContextEvents();
  initializeLeftMobileDrawer();
  renderModsPanelVisibility();
}
