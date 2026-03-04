import { getContext, extension_settings, findExtension } from "../../../../extensions.js";
import { callGenericPopup, POPUP_TYPE, Popup } from "../../../../popup.js";
import { saveSettingsDebounced, user_avatar as globalUserAvatar } from "../../../../../script.js";
import {
  loadCharacterDetails,
  saveCharacterDetails,
  createCharacter,
  createGroup,
  createLayer,
  normalizeCharacterDetails,
} from "./character-details-store.js";
import { buildDescriptionsText, buildGenDescriptions, buildCharacterVisualDescription } from "./character-details-descriptions.js";
import { runDescriptionsGeneration, runOutfitGenerationForCharacter } from "./character-details-generation.js";
import { IMAGE_RESOLUTION_OPTIONS, DEFAULT_RESOLUTION_OPTION } from "./image-resolution-options.js";
import { showCharacterDetailsDiff } from "./character-details-diff-modal.js";

let state = null;
let panelRoot = null;
let footerGenerateButton = null;
let footerFreeGenerateButton = null;
let footerPortraitButton = null;
let footerFullBodyButton = null;
let footerPreviewToggle = null;
let footerGuideToggle = null;
let footerBackgroundButton = null;
let footerViewerEyesButton = null;
let footerSceneButton = null;
let footerRoot = null;
let floatingRoot = null;
let managerRoot = null;
let panelContainerRoot = null;
let mobileDrawerToggleButton = null;
let customFieldRefreshTimer = null;
let draggedLayerId = null;
let managerExpanded = false;
let mobileDrawerOpen = false;
let mobileDrawerBindingsInitialized = false;
let activeImageGeneration = null;
const extensionName = "st-extension-example";
const PERSONA_CHARACTER_STORAGE_KEY = "characterDetailsPersonaCharacters";
const FORBIDDEN_NAME_CHARS = /[\[\]\/|]/g;

const MOBILE_DRAWER_MEDIA_QUERY = "(max-width: 1000px)";

function hasImageGenerationExtension() {
  return Boolean(findExtension("stable-diffusion")?.enabled);
}

function shouldShowImageGenerationButtons() {
  return hasImageGenerationExtension() && extension_settings?.[extensionName]?.show_image_generation_buttons !== false;
}

function shouldPreviewImagePrompts() {
  return extension_settings?.[extensionName]?.preview_image_prompts === true;
}

function shouldAddPromptGuide() {
  return extension_settings?.[extensionName]?.add_prompt_guide === true;
}

function shouldUseCropToolForAvatars() {
  return extension_settings?.[extensionName]?.use_crop_tool_for_avatars === true;
}

function shouldAutoAddPersonaCharacter() {
  return extension_settings?.[extensionName]?.auto_add_persona_character_for_new_chat !== false;
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

  return message.is_system !== true;
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

function buildLimitedChatPrompt(context, systemPrompt) {
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

  if (systemPrompt) {
    prompt.push({ role: "system", content: String(systemPrompt) });
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

function getSwitcherCharacterLimit() {
  const rawValue = extension_settings?.[extensionName]?.switcher_character_limit;
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return 7;
  }

  return Math.max(1, Math.min(50, Math.floor(numeric)));
}

function isMobileDrawerMode() {
  return Boolean(window?.matchMedia?.(MOBILE_DRAWER_MEDIA_QUERY)?.matches);
}

function renderMobileDrawerState() {
  if (!panelContainerRoot?.length || !mobileDrawerToggleButton?.length) {
    return;
  }

  const mobileMode = isMobileDrawerMode();
  panelContainerRoot.toggleClass("is-mobile-collapsed", mobileMode && !mobileDrawerOpen);
  panelContainerRoot.toggleClass("is-desktop-collapsed", !mobileMode && !mobileDrawerOpen);

  mobileDrawerToggleButton.toggleClass("is-open", mobileDrawerOpen);

  const icon = mobileDrawerToggleButton.find("i");
  icon.removeClass("fa-angle-left fa-angle-right").addClass(mobileDrawerOpen ? "fa-angle-right" : "fa-angle-left");

  mobileDrawerToggleButton.attr("title", mobileDrawerOpen ? "Hide character panel" : "Show character panel");
}

function initializeMobileDrawer() {
  if (!panelContainerRoot?.length || !mobileDrawerToggleButton?.length) {
    return;
  }

  if (!mobileDrawerBindingsInitialized) {
    mobileDrawerBindingsInitialized = true;

    mobileDrawerToggleButton.on("click", () => {
      mobileDrawerOpen = !mobileDrawerOpen;
      renderMobileDrawerState();
    });

    const onViewportChange = () => {
      if (!isMobileDrawerMode()) {
        mobileDrawerOpen = true;
      }
      renderMobileDrawerState();
    };

    const mediaQueryList = window.matchMedia(MOBILE_DRAWER_MEDIA_QUERY);
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", onViewportChange);
    } else if (typeof mediaQueryList.addListener === "function") {
      mediaQueryList.addListener(onViewportChange);
    }
  }

  mobileDrawerOpen = !isMobileDrawerMode();
  renderMobileDrawerState();
}

async function maybeCropAvatarDataUrl(dataUrl) {
  if (!shouldUseCropToolForAvatars()) {
    return dataUrl;
  }

  const croppedImage = await callGenericPopup(
    "Set the crop position of the avatar image",
    POPUP_TYPE.CROP,
    "",
    { cropAspect: 1, cropImage: dataUrl },
  );

  if (!croppedImage) {
    return null;
  }

  return String(croppedImage);
}

function getResolutionSettingKeyForMode(mode) {
  const map = {
    portrait: "portrait",
    fullbody: "fullbody",
    background: "background",
    "viewer-eyes": "viewer_eyes",
    scene: "scene",
  };

  return map[mode] || null;
}

function getCustomResolutionForMode(mode) {
  const key = getResolutionSettingKeyForMode(mode);
  if (!key) {
    return null;
  }

  const selected = String(extension_settings?.[extensionName]?.custom_resolutions?.[key] || DEFAULT_RESOLUTION_OPTION);
  if (selected === DEFAULT_RESOLUTION_OPTION) {
    return null;
  }

  const preset = IMAGE_RESOLUTION_OPTIONS[selected];
  if (!preset || !Number.isFinite(preset.width) || !Number.isFinite(preset.height)) {
    return null;
  }

  return { width: preset.width, height: preset.height };
}

function getPresentCharacters(data, options = {}) {
  const excludeId = options.excludeId || null;
  return (Array.isArray(data?.characters) ? data.characters : [])
    .filter((character) => character?.presence)
    .filter((character) => !excludeId || character.id !== excludeId);
}

function buildCharactersVisualDescriptions(data, characters) {
  return (Array.isArray(characters) ? characters : [])
    .map((character) => buildCharacterVisualDescription(data, character.id))
    .filter(Boolean)
    .join("\n\n");
}

function buildCharactersPresentLine(characters) {
  const names = (Array.isArray(characters) ? characters : [])
    .map((character) => String(character?.name || "").trim())
    .filter(Boolean);
  return `Characters present: ${names.length ? names.join(", ") : "none"}.`;
}

function stripReasoningFromLlmOutput(text, context) {
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

function isGenerationAbortError(error) {
  if (!error) {
    return false;
  }

  const errorName = String(error?.name || "").toLowerCase();
  const errorMessage = String(error?.message || error || "").toLowerCase();
  return errorName === "aborterror"
    || /abort|aborted|cancel|canceled|stopped|interrupted/.test(errorMessage);
}

function requestStopGeneration(context) {
  if (typeof context?.stopGeneration !== "function") {
    return false;
  }

  try {
    context.stopGeneration();
    return true;
  } catch (error) {
    return false;
  }
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

function clearActiveImageGeneration(button) {
  restoreGenerationButtonState(button);
  activeImageGeneration = null;
}

function compactPromptToSingleLine(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function generateWithChatStopSemantics(context, promptText) {
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

async function askGuideForPrompt() {
  if (!shouldAddPromptGuide()) {
    return "";
  }

  const guide = await callGenericPopup(
    "What to focus on?",
    POPUP_TYPE.INPUT,
    "",
    { rows: 4, okButton: "Apply", cancelButton: "Cancel" },
  );

  if (guide === null || guide === undefined || guide === false) {
    return null;
  }

  return String(guide || "").trim();
}

async function generateCharacterImage(mode, triggerButton = null) {
  const context = getContext();
  const button = triggerButton?.length ? triggerButton : null;

  if (activeImageGeneration?.running) {
    const isSameButton = Boolean(button && activeImageGeneration.button && activeImageGeneration.button.is(button));
    if (isSameButton) {
      activeImageGeneration.cancelRequested = true;
      activeImageGeneration.stopSignaled = requestStopGeneration(context);
      return;
    }

    toastr.info("Generation already in progress. Press stop on the active button to cancel.", "Character Details");
    return;
  }

  activeImageGeneration = {
    running: true,
    cancelRequested: false,
    stopSignaled: false,
    button,
  };

  if (button) {
    setGenerationButtonStopState(button);
  }

  if (!shouldShowImageGenerationButtons()) {
    toastr.warning("Image generation requires built-in Image Generation extension (Optional modules: sd).", "Character Details");
    clearActiveImageGeneration(button);
    return;
  }

  const data = loadCharacterDetails(context);
  const activeCharacter = getActiveCharacter(data);
  const viewerCharacter = data.viewerCharacterId
    ? (data.characters || []).find((character) => character.id === data.viewerCharacterId) || null
    : null;

  let characterDescription = "";
  let charactersPresentLine = "";
  let scenePrompt = "";
  let modeLine = "";

  if (mode === "portrait" || mode === "fullbody") {
    if (!activeCharacter) {
      toastr.warning("Select a character first.", "Character Details");
      clearActiveImageGeneration(button);
      return;
    }

    characterDescription = buildCharacterVisualDescription(data, activeCharacter.id);
    if (!characterDescription) {
      toastr.warning("No active character description to generate image from.", "Character Details");
      clearActiveImageGeneration(button);
      return;
    }

    scenePrompt = String(
      mode === "portrait"
        ? extension_settings?.[extensionName]?.closeup_portrait_prompt
        : extension_settings?.[extensionName]?.full_body_portrait_prompt,
    ).trim();
    modeLine = mode === "portrait"
      ? "You are writing a CLOSE-UP PORTRAIT prompt (head and upper torso only)."
      : "You are writing a FULL BODY PORTRAIT prompt (entire body visible).";
  }

  if (mode === "background") {
    scenePrompt = String(extension_settings?.[extensionName]?.describe_background_prompt || "").trim();
    modeLine = "You are writing a BACKGROUND prompt for image generation.";
  }

  if (mode === "viewer-eyes") {
    if (!viewerCharacter) {
      toastr.warning("Set viewer character first.", "Character Details");
      clearActiveImageGeneration(button);
      return;
    }

    const presentWithoutViewer = getPresentCharacters(data, { excludeId: viewerCharacter.id });
    charactersPresentLine = buildCharactersPresentLine(presentWithoutViewer);
    characterDescription = buildCharactersVisualDescriptions(data, presentWithoutViewer);
    scenePrompt = String(extension_settings?.[extensionName]?.describe_viewer_eyes_prompt || "").trim();
    modeLine = `Viewpoint is from viewer's eyes. Viewer name is ${viewerCharacter.name || "viewer"}, but always call this person \"viewer\".`;
  }

  if (mode === "scene") {
    const presentAll = getPresentCharacters(data);
    charactersPresentLine = buildCharactersPresentLine(presentAll);
    characterDescription = buildCharactersVisualDescriptions(data, presentAll);
    scenePrompt = String(extension_settings?.[extensionName]?.describe_current_scene_prompt || "").trim();
    modeLine = "You are writing a CURRENT SCENE prompt for image generation.";
  }

  const guideText = await askGuideForPrompt();
  if (guideText === null) {
    clearActiveImageGeneration(button);
    return;
  }

  const visualCommandStart = String(extension_settings?.[extensionName]?.visual_command_start || "").trim();
  const strictSceneRules = "Never mention any other person or character unless explicitly listed in Characters present.";
  const alwaysLine = (mode === "portrait" || mode === "fullbody") && activeCharacter
    ? `Always include exact line: \"${activeCharacter.name || "Unnamed"} is looking at viewer\".`
    : "";
  const llmPrompt = [
    visualCommandStart,
    modeLine,
    charactersPresentLine,
    scenePrompt,
    strictSceneRules,
    alwaysLine,
    activeCharacter ? `Character name: ${activeCharacter.name || "Unnamed"}` : "",
    guideText ? `IMPORTANT: User wants you to focus on this during your description: ${guideText}` : "",
  ].filter(Boolean).join("\n\n");

  let promptToast = toastr.info('<i class="fa-solid fa-spinner fa-spin"></i> Preparing image prompt...', 'Character Details', {
    timeOut: 0,
    extendedTimeOut: 0,
    tapToDismiss: false,
    escapeHtml: false,
  });

  try {
    let llmVisual = "";
    const limitedPromptMessages = buildLimitedChatPrompt(context, llmPrompt);
    const quietPrompt = serializePromptMessagesForQuietPrompt(limitedPromptMessages);

    if (activeImageGeneration?.cancelRequested && activeImageGeneration?.stopSignaled) {
      throw new DOMException("Cancelled by user", "AbortError");
    }

    if (context.generate) {
      llmVisual = await generateWithChatStopSemantics(context, quietPrompt);
    } else {
      throw new Error("Generate API unavailable");
    }

    llmVisual = stripReasoningFromLlmOutput(llmVisual, context);

    if (promptToast) {
      toastr.clear(promptToast);
      promptToast = null;
    }

    let finalTrigger = [characterDescription, String(llmVisual || "").trim()]
      .filter(Boolean)
      .join("\n\n")
      .replace(/\r\n/g, "\n")
      .trim();

    if (shouldPreviewImagePrompts()) {
      const editedPrompt = await callGenericPopup(
        'Preview and optionally edit the final image prompt. Press "Cancel" to abort generation.',
        POPUP_TYPE.INPUT,
        finalTrigger,
        { rows: 12, okButton: "Generate", cancelButton: "Cancel" },
      );

      if (editedPrompt === null || editedPrompt === undefined || editedPrompt === false) {
        return;
      }

      finalTrigger = String(editedPrompt || "").replace(/\r\n/g, "\n").trim();
    }

    if (!finalTrigger) {
      throw new Error("Empty image trigger");
    }

    const finalTriggerSingleLine = compactPromptToSingleLine(finalTrigger);
    if (!finalTriggerSingleLine) {
      throw new Error("Empty image trigger");
    }

    const customResolution = getCustomResolutionForMode(mode);
    const sdCommand = customResolution
      ? `/sd width=${customResolution.width} height=${customResolution.height} ${finalTriggerSingleLine}`
      : `/sd ${finalTriggerSingleLine}`;

    if (context.executeSlashCommandsWithOptions) {
      await context.executeSlashCommandsWithOptions(sdCommand);
    } else if (context.executeSlashCommands) {
      await context.executeSlashCommands(sdCommand);
    } else {
      throw new Error("Slash commands API unavailable");
    }

    // For background generated by our process, auto-set as chat background
    if (mode === "background") {
      await setupAutoBackgroundAfterGeneration(context);
    }
  } catch (error) {
    if (isGenerationAbortError(error) || activeImageGeneration?.stopSignaled) {
      toastr.info("Image generation cancelled.", "Character Details");
    } else {
      toastr.error(`Error: ${error?.message || "Image generation failed"}`, "Character Details");
    }
  } finally {
    if (promptToast) {
      toastr.clear(promptToast);
    }

    clearActiveImageGeneration(button);
  }
}

async function generateFreeImage() {
  const context = getContext();
  if (!shouldShowImageGenerationButtons()) {
    toastr.warning("Image generation requires built-in Image Generation extension (Optional modules: sd).", "Character Details");
    return;
  }

  const data = loadCharacterDetails(context);
  const presentAll = getPresentCharacters(data);
  const characterDescription = buildCharactersVisualDescriptions(data, presentAll);
  let finalTrigger = [characterDescription]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\r\n/g, "\n")
    .trim();

  const editedPrompt = await callGenericPopup(
    'Write your image prompt. Press "Cancel" to abort generation.',
    POPUP_TYPE.INPUT,
    finalTrigger,
    { rows: 12, okButton: "Generate", cancelButton: "Cancel" },
  );

  if (editedPrompt === null || editedPrompt === undefined || editedPrompt === false) {
    return;
  }

  finalTrigger = String(editedPrompt || "").replace(/\r\n/g, "\n").trim();
  if (!finalTrigger) {
    toastr.warning("Prompt is empty.", "Character Details");
    return;
  }

  const finalTriggerSingleLine = compactPromptToSingleLine(finalTrigger);
  if (!finalTriggerSingleLine) {
    toastr.warning("Prompt is empty.", "Character Details");
    return;
  }

  const customResolution = getCustomResolutionForMode("scene");
  const sdCommand = customResolution
    ? `/sd width=${customResolution.width} height=${customResolution.height} ${finalTriggerSingleLine}`
    : `/sd ${finalTriggerSingleLine}`;

  try {
    if (context.executeSlashCommandsWithOptions) {
      await context.executeSlashCommandsWithOptions(sdCommand);
    } else if (context.executeSlashCommands) {
      await context.executeSlashCommands(sdCommand);
    } else {
      throw new Error("Slash commands API unavailable");
    }
  } catch (error) {
    toastr.error(`Error: ${error?.message || "Image generation failed"}`, "Character Details");
  }
}

function renderPreviewToggleState() {
  if (!footerPreviewToggle?.length) {
    return;
  }

  const isOn = shouldPreviewImagePrompts();
  footerPreviewToggle.toggleClass("is-on", isOn);
  const icon = footerPreviewToggle.find("i");
  icon.removeClass("fa-eye fa-eye-slash").addClass(isOn ? "fa-eye" : "fa-eye-slash");
}

function renderGuideToggleState() {
  if (!footerGuideToggle?.length) {
    return;
  }

  const isOn = shouldAddPromptGuide();
  footerGuideToggle.toggleClass("is-on", isOn);
  const icon = footerGuideToggle.find("i");
  icon.removeClass("fa-crosshairs fa-xmark").addClass(isOn ? "fa-crosshairs" : "fa-xmark");
}

function updateFooterImageButtonsVisibility() {
  const show = shouldShowImageGenerationButtons();
  if (footerPreviewToggle?.length) {
    footerPreviewToggle.toggleClass("displayNone", !show);
  }
  if (footerGuideToggle?.length) {
    footerGuideToggle.toggleClass("displayNone", !show);
  }
  if (footerFreeGenerateButton?.length) {
    footerFreeGenerateButton.toggleClass("displayNone", !show);
  }
  if (footerPortraitButton?.length) {
    footerPortraitButton.toggleClass("displayNone", !show);
  }
  if (footerFullBodyButton?.length) {
    footerFullBodyButton.toggleClass("displayNone", !show);
  }
  if (footerBackgroundButton?.length) {
    footerBackgroundButton.toggleClass("displayNone", !show);
  }
  if (footerViewerEyesButton?.length) {
    footerViewerEyesButton.toggleClass("displayNone", !show);
  }
  if (footerSceneButton?.length) {
    footerSceneButton.toggleClass("displayNone", !show);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getInitials(name) {
  const text = String(name || "").trim();
  if (!text) {
    return "?";
  }

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function readAvatarMap(context) {
  const raw = context.variables?.local?.get?.("avatars");
  if (!raw) {
    return {};
  }

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const result = {};
  for (const [name, value] of Object.entries(parsed)) {
    const key = String(name || "").trim();
    if (!key || typeof value !== "string" || !value.trim()) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

function writeAvatarMap(context, avatarMap) {
  const nextMap = avatarMap && typeof avatarMap === "object" ? avatarMap : {};
  context.variables?.local?.set?.("avatars", nextMap);
}

function getAvatarKeyForCharacterName(name) {
  return String(name || "").trim();
}

function getAvatarSourceFromContextCharacter(character, context) {
  if (!character || typeof character !== "object") {
    return "";
  }

  if (typeof character.avatar === "string" && character.avatar) {
    if (/^(data:|https?:)/i.test(character.avatar)) {
      return character.avatar;
    }
    if (context?.getThumbnailUrl) {
      return context.getThumbnailUrl("avatar", character.avatar);
    }
  }

  if (typeof character.avatar_url === "string" && character.avatar_url) {
    return character.avatar_url;
  }

  return "";
}

function getGroupCharacterAvatarSourceByName(characterName, context) {
  if (!context?.groupId || !characterName) {
    return "";
  }

  const group = (Array.isArray(context?.groups) ? context.groups : [])
    .find((item) => String(item?.id) === String(context.groupId));

  const members = Array.isArray(group?.members) ? group.members : [];
  if (!members.length) {
    return "";
  }

  const normalizedTargetName = normalizeName(characterName);
  if (!normalizedTargetName) {
    return "";
  }

  const allCharacters = Array.isArray(context?.characters) ? context.characters : [];
  for (const member of members) {
    const match = allCharacters.find((item) => item?.avatar === member || item?.name === member);
    if (!match) {
      continue;
    }

    if (normalizeName(match.name) !== normalizedTargetName) {
      continue;
    }

    const avatarSource = getAvatarSourceFromContextCharacter(match, context);
    if (avatarSource) {
      return avatarSource;
    }
  }

  return "";
}

function getChatCharacterAvatarSource(context) {
  const activeCharacterId = context?.characterId;
  const activeCharacterIndex = Number(activeCharacterId);
  if (Number.isInteger(activeCharacterIndex) && activeCharacterIndex >= 0) {
    const activeCharacter = Array.isArray(context?.characters) ? context.characters[activeCharacterIndex] : null;
    if (activeCharacter) {
      const avatarSource = getAvatarSourceFromContextCharacter(activeCharacter, context);
      if (avatarSource) {
        return avatarSource;
      }
    }
  }

  const chatName = getChatName(context);
  if (!chatName) {
    return "";
  }

  const match = (Array.isArray(context?.characters) ? context.characters : [])
    .find((character) => normalizeName(character?.name) === normalizeName(chatName));

  if (!match) {
    return "";
  }

  return getAvatarSourceFromContextCharacter(match, context);
}

function getActivePersonaAvatarSource(context) {
  const personaAvatar = String(context?.user_avatar || globalUserAvatar || "").trim();
  if (personaAvatar) {
    if (/^(data:|https?:)/i.test(personaAvatar)) {
      return personaAvatar;
    }

    if (context?.getThumbnailUrl) {
      return context.getThumbnailUrl("persona", personaAvatar);
    }
  }

  const selectors = [
    "#user_avatar img",
    "#user_avatar",
    "#user_avatar_block img",
    "#persona_avatar img",
    "#persona_avatar",
    ".persona_avatar img",
    "[id*='user_avatar'] img",
    "[id*='persona'] img",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }

    if (element instanceof HTMLImageElement && element.src) {
      return element.src;
    }

    const src = element.getAttribute?.("src");
    if (src) {
      return src;
    }
  }

  return "";
}

function getCharacterAvatarSource(character, context, avatarMap) {
  const key = getAvatarKeyForCharacterName(character?.name);
  if (key && avatarMap?.[key]) {
    return avatarMap[key];
  }

  const characterName = normalizeName(character?.name);
  if (!characterName) {
    return "";
  }

  if (context?.groupId) {
    const groupAvatar = getGroupCharacterAvatarSourceByName(character?.name, context);
    if (groupAvatar) {
      return groupAvatar;
    }
  }

  const chatName = context?.groupId ? "" : normalizeName(getChatName(context));
  if (chatName && characterName === chatName) {
    return getChatCharacterAvatarSource(context);
  }

  const personaName = normalizeName(context?.name1);
  if (personaName && characterName === personaName) {
    return getActivePersonaAvatarSource(context);
  }

  return "";
}

function buildSwitcherCharacters(data, maxItems = 7) {
  const characters = Array.isArray(data?.characters) ? data.characters : [];
  if (characters.length <= maxItems) {
    return characters;
  }

  const presentCharacters = characters.filter((character) => character?.presence);
  const notPresentCharacters = characters.filter((character) => !character?.presence);
  const viewerId = data?.viewerCharacterId || null;
  const mainCharacterId = data?.mainCharacterId || null;

  const selected = [];
  const selectedIds = new Set();
  const addCharacter = (character) => {
    if (!character?.id || selectedIds.has(character.id) || selected.length >= maxItems) {
      return;
    }
    selected.push(character);
    selectedIds.add(character.id);
  };

  if (presentCharacters.length > maxItems) {
    const viewerCharacter = viewerId
      ? presentCharacters.find((character) => character.id === viewerId)
      : null;
    const mainCharacter = mainCharacterId
      ? presentCharacters.find((character) => character.id === mainCharacterId)
      : null;

    addCharacter(viewerCharacter);
    addCharacter(mainCharacter);
  }

  for (const character of presentCharacters) {
    addCharacter(character);
  }

  if (selected.length < maxItems) {
    for (const character of notPresentCharacters) {
      addCharacter(character);
    }
  }

  return selected;
}

function renderFloatingCharacters() {
  if (!floatingRoot?.length) {
    return;
  }

  if (managerExpanded) {
    floatingRoot.addClass("hidden");
    return;
  }

  floatingRoot.removeClass("hidden");
  const context = getContext();
  const avatarMap = readAvatarMap(context);
  const characters = buildSwitcherCharacters(state, getSwitcherCharacterLimit());
  const items = characters
    .slice()
    .reverse()
    .map((character) => {
      const activeClass = character.id === state.activeCharacterId ? "is-active" : "";
      const avatarSrc = getCharacterAvatarSource(character, context, avatarMap);
      const avatarClass = avatarSrc ? "has-avatar" : "";
      const avatarHtml = avatarSrc
        ? `<img class="character-floating__avatar-image" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(character.name || "Unnamed")}" />`
        : escapeHtml(getInitials(character.name));
      return `
        <button class="character-floating__item ${activeClass} ${avatarClass}" type="button" data-action="switch-character" data-character-id="${character.id}" title="${escapeHtml(character.name || "Unnamed")}">
          ${avatarHtml}
        </button>
      `;
    })
    .join("");

  floatingRoot.html(`
    <button class="character-floating__toggle" type="button" data-action="expand-manager" title="Open character manager">
      <i class="fa-solid fa-angle-left"></i>
    </button>
    ${items}
  `);
}

function renderManagerPanel() {
  if (!managerRoot?.length) {
    return;
  }

  if (!managerExpanded) {
    managerRoot.addClass("hidden");
    managerRoot.empty();
    return;
  }

  managerRoot.removeClass("hidden");
  const characters = Array.isArray(state?.characters) ? state.characters : [];
  const context = getContext();
  const avatarMap = readAvatarMap(context);
  const listHtml = characters.length === 0
    ? `<div class="character-manager__empty">No characters yet.</div>`
    : characters
      .map((character) => {
        const activeClass = character.id === state.activeCharacterId ? "is-active" : "";
        const mcClass = state.mainCharacterId === character.id ? "is-on" : "";
        const viewerClass = state.viewerCharacterId === character.id ? "is-on" : "";
        const presenceClass = character.presence ? "is-on" : "";
        const uploadedAvatarKey = getAvatarKeyForCharacterName(character.name);
        const hasUploadedAvatar = Boolean(uploadedAvatarKey && avatarMap?.[uploadedAvatarKey]);
        const avatarSrc = getCharacterAvatarSource(character, context, avatarMap);
        const avatarHtml = avatarSrc
          ? `<img class="character-manager__avatar-image" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(character.name || "Unnamed")}" />`
          : escapeHtml(getInitials(character.name));
        const removeAvatarButton = hasUploadedAvatar
          ? `<span class="character-manager__avatar-remove" data-action="remove-avatar-character" data-character-id="${character.id}" title="Remove uploaded avatar" role="button" tabindex="0" aria-label="Remove uploaded avatar">
              <i class="fa-solid fa-xmark"></i>
            </span>`
          : "";
        const uploadAvatarTitle = hasUploadedAvatar ? "Upload an image (overwrite)" : "Upload an image";

        return `
          <div class="character-manager__row ${activeClass}" data-character-id="${character.id}" data-action="switch-character">
            <button class="character-manager__initials" type="button" data-action="upload-avatar-character" data-character-id="${character.id}" title="${uploadAvatarTitle}">
              ${avatarHtml}
              <span class="character-manager__avatar-upload">
                <i class="fa-solid fa-upload"></i>
              </span>
              ${removeAvatarButton}
            </button>
            <div class="character-manager__name">${escapeHtml(character.name || "Unnamed")}</div>
            <button class="character-manager__action ${presenceClass}" type="button" data-action="toggle-presence-character" data-character-id="${character.id}" title="Presence">
              <i class="fa-solid ${character.presence ? "fa-user-check" : "fa-user-slash"}"></i>
            </button>
            <button class="character-manager__action ${mcClass}" type="button" data-action="toggle-mc-character" data-character-id="${character.id}" title="MC">
              <i class="fa-solid fa-star"></i>
            </button>
            <button class="character-manager__action ${viewerClass}" type="button" data-action="toggle-viewer-character" data-character-id="${character.id}" title="Viewer">
              <i class="fa-solid ${viewerClass ? "fa-eye" : "fa-eye-slash"}"></i>
            </button>
            <button class="character-manager__action" type="button" data-action="delete-character" data-character-id="${character.id}" title="Delete">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        `;
      })
      .join("");

  managerRoot.html(`
    <div class="character-manager__actions">
      <button class="character-manager__collapse" type="button" data-action="collapse-manager" title="Close character manager">
        <i class="fa-solid fa-angle-right"></i>
      </button>
      <div class="character-manager__actions-right">
        <button class="character-manager__collapse" type="button" data-action="export-character-details" title="Export JSON">
          <i class="fa-solid fa-file-export"></i>
        </button>
        <button class="character-manager__collapse" type="button" data-action="import-character-details" title="Import JSON">
          <i class="fa-solid fa-file-import"></i>
        </button>
        <button class="character-manager__collapse" type="button" data-action="save-viewer-to-persona" title="Save viewer to persona">
          <i class="fa-solid fa-floppy-disk"></i>
        </button>
        <button class="character-manager__collapse" type="button" data-action="add-character-from-persona" title="Add character from persona">
          <i class="fa-solid fa-user-plus"></i>
        </button>
        <button class="menu_button" type="button" data-action="add-character">Add</button>
      </div>
    </div>
    <div class="character-manager__list">
      ${listHtml}
    </div>
  `);
}

function getActiveCharacter(data) {
  if (!data.activeCharacterId) {
    return null;
  }

  return data.characters.find((character) => character.id === data.activeCharacterId) || null;
}

function ensureActiveCharacter(data) {
  if (!data.activeCharacterId && data.characters.length > 0) {
    data.activeCharacterId = data.characters[0].id;
  }
}

function ensureActiveGroup(character) {
  if (!character) {
    return;
  }

  if (!Array.isArray(character.clothingGroups) || character.clothingGroups.length === 0) {
    character.activeGroupId = null;
    return;
  }

  const match = character.clothingGroups.find((group) => group.id === character.activeGroupId);
  if (!match) {
    character.activeGroupId = character.clothingGroups[0].id;
  }
}

function ensureActiveGroups(data) {
  for (const character of data.characters || []) {
    ensureActiveGroup(character);
  }
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeForbiddenText(value) {
  return String(value ?? "").replace(FORBIDDEN_NAME_CHARS, ".");
}

function normalizeCustomField(field) {
  return {
    label: String(field?.label || "").trim(),
    varName: String(field?.varName || "").trim(),
    target: field?.target === "viewer" ? "viewer" : "mc",
  };
}

function getCustomFieldsSettings() {
  const settings = extension_settings?.[extensionName];
  if (!Array.isArray(settings?.custom_fields)) {
    return [];
  }

  return settings.custom_fields
    .map(normalizeCustomField)
    .filter((field) => field.label && field.varName);
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

function getCustomFieldsForCharacter(character, context) {
  const fields = getCustomFieldsSettings();
  if (!fields.length) {
    return [];
  }

  const results = [];
  for (const field of fields) {
    const targetId = field.target === "viewer" ? state?.viewerCharacterId : state?.mainCharacterId;
    if (!targetId || targetId !== character.id) {
      continue;
    }

    const value = formatVariableValue(context.variables?.local?.get?.(field.varName));
    const enabled = Boolean(state?.customFieldGeneratorToggles?.[field.varName]);
    results.push({ label: field.label, varName: field.varName, value, enabled });
  }

  return results;
}

function refreshCustomFieldInputs(context) {
  if (!panelRoot?.length) {
    return;
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  const fields = getCustomFieldsForCharacter(character, context);
  const valueByVar = new Map(fields.map((field) => [field.varName, field.value]));

  panelRoot.find("[data-field='custom-field-value']").each((index, element) => {
    const $element = $(element);
    if ($element.is(":focus")) {
      return;
    }

    const varName = $element.data("varName");
    const nextValue = valueByVar.get(varName) ?? "";
    if ($element.val() !== nextValue) {
      $element.val(nextValue);
    }
  });
}

function applyViewerFromPersona(data, context) {
  const personaName = normalizeName(context?.name1);
  if (!personaName) {
    return;
  }

  const match = data.characters.find((character) => normalizeName(character.name) === personaName);
  if (match) {
    data.viewerCharacterId = match.id;
  }
}

function applyMainCharacterFromChat(data, context) {
  // Only auto-set MC if not already set
  if (data.mainCharacterId) {
    return;
  }

  const chatName = getChatName(context);
  if (!chatName) {
    return;
  }

  const match = data.characters.find((character) => normalizeName(character.name) === normalizeName(chatName));
  if (match) {
    data.mainCharacterId = match.id;
  }
}

function getChatName(context) {
  // Try to get character name from context
  if (context.name2) {
    return context.name2;
  }
  
  // For group chats
  if (context.groupId && context.groups) {
    const group = context.groups.find(g => g.id === context.groupId);
    if (group?.name) {
      return group.name;
    }
  }
  
  return null;
}

function findGroup(character, groupId) {
  return character.clothingGroups.find((group) => group.id === groupId) || null;
}

function findCharacterById(data, characterId) {
  return data.characters.find((character) => character.id === characterId) || null;
}

function findLayer(layers, layerId) {
  for (const layer of layers) {
    if (layer.id === layerId) {
      return layer;
    }

    const child = findLayer(layer.children, layerId);
    if (child) {
      return child;
    }
  }

  return null;
}

function removeLayer(layers, layerId) {
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index !== -1) {
    layers.splice(index, 1);
    return true;
  }

  for (const layer of layers) {
    if (removeLayer(layer.children, layerId)) {
      return true;
    }
  }

  return false;
}

function removeLayerFromGroups(groups, layerId) {
  for (const group of groups) {
    if (removeLayer(group.layers, layerId)) {
      return true;
    }
  }

  return false;
}

function findLayerWithParent(layers, layerId, parentArray) {
  for (const layer of layers) {
    if (layer.id === layerId) {
      return { layer, parentArray };
    }

    const child = findLayerWithParent(layer.children, layerId, layer.children);
    if (child) {
      return child;
    }
  }

  return null;
}

function findLayerWithParentInGroups(groups, layerId) {
  for (const group of groups) {
    const found = findLayerWithParent(group.layers, layerId, group.layers);
    if (found) {
      return { ...found, group };
    }
  }

  return null;
}

function extractLayerFromGroups(groups, layerId) {
  const found = findLayerWithParentInGroups(groups, layerId);
  if (!found) {
    return null;
  }

  const { layer, parentArray } = found;
  const index = parentArray.findIndex((item) => item.id === layerId);
  if (index !== -1) {
    parentArray.splice(index, 1);
  }

  return { layer, parentArray, index, group: found.group };
}

function isDescendantLayer(layer, targetId) {
  for (const child of layer.children || []) {
    if (child.id === targetId) {
      return true;
    }
    if (isDescendantLayer(child, targetId)) {
      return true;
    }
  }
  return false;
}

function clearDragIndicators() {
  panelRoot.find(".clothing-layer").removeClass("drop-before drop-after drop-child");
}

function resolveLayerElement(event) {
  const target = event.target || event.currentTarget;
  return target?.closest ? target.closest(".clothing-layer") : null;
}

function cycleState(layer) {
  if (layer.state === "on") {
    layer.state = "partial";
    return;
  }

  if (layer.state === "partial") {
    layer.state = "off";
    return;
  }

  layer.state = "on";
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

function checkHasLockedChild(layers) {
  for (const layer of layers) {
    if (layer.locked) {
      return true;
    }
    if (checkHasLockedChild(layer.children || [])) {
      return true;
    }
  }
  return false;
}

function renderLayers(layers, depth, inheritedOcclusion) {
  return layers
    .map((layer) => {
      const displayOcclusion = inheritedOcclusion;
      const layerEffect = getLayerEffect(layer);
      const nextOcclusion = combineOcclusion(inheritedOcclusion, layerEffect);
      const visibilityOverride = layer.visibilityOverride === true;
      const canToggleVisibilityOverride = displayOcclusion === "full" || visibilityOverride;
      const effectiveOcclusion = visibilityOverride && displayOcclusion === "full"
        ? "partial"
        : displayOcclusion;
      const occlusionClass =
        effectiveOcclusion === "full"
          ? "layer--occluded-full"
          : effectiveOcclusion === "partial"
            ? "layer--occluded-partial"
            : "";

      const stateLabel = layer.state === "on" ? "On" : layer.state === "partial" ? "Partial" : "Off";
      const hasLockedChild = checkHasLockedChild(layer.children);
      const canDelete = !layer.locked && !hasLockedChild;
      const deleteClass = canDelete ? "" : "is-disabled";
      const lockIcon = layer.locked ? "fa-lock" : "fa-lock-open";
      const lockTitle = layer.locked ? "Locked (LLM cannot modify)" : "Unlocked";
      const visibilityIcon = visibilityOverride ? "fa-eye" : "fa-eye-slash";
      const visibilityClass = visibilityOverride ? "is-on" : "";
      const visibilityTitle = visibilityOverride
        ? "Override enabled: force partially visible when occluded"
        : "Force partially visible when fully occluded";
      const visibilityButtonHtml = canToggleVisibilityOverride
        ? `<button class="layer-action icon-button layer-visibility-toggle ${visibilityClass}" type="button" data-action="toggle-visibility-override" title="${visibilityTitle}">
            <i class="fa-solid ${visibilityIcon}"></i>
          </button>`
        : "";

      const childrenHtml = renderLayers(layer.children, depth + 1, nextOcclusion);

      return `
        <div class="clothing-layer ${occlusionClass}" data-layer-id="${layer.id}" style="--depth:${depth}">
          <button class="layer-action icon-button layer-drag-handle" type="button" title="Drag layer" draggable="true">
            <i class="fa-solid fa-grip-vertical"></i>
          </button>
          <button class="layer-state" type="button" data-action="cycle-state" title="Toggle state">${stateLabel}</button>
          ${visibilityButtonHtml}
          <input class="layer-name text_pole" type="text" value="${escapeHtml(layer.name)}" data-field="layer-name" data-layer-id="${layer.id}" />
          <div class="layer-lock-wrapper">
            <button class="layer-action icon-button layer-lock-button" type="button" data-action="toggle-lock" title="${lockTitle}">
              <i class="fa-solid ${lockIcon}"></i>
            </button>
          </div>
          <button class="layer-action icon-button" type="button" data-action="add-child" title="Add child">
            <i class="fa-solid fa-plus"></i>
          </button>
          <button class="layer-action icon-button ${deleteClass}" type="button" data-action="delete-layer" title="Delete layer" ${canDelete ? "" : "disabled"}>
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        ${childrenHtml}
      `;
    })
    .join("");
}

function renderGroups(character) {
  if (!character.clothingGroups.length) {
    return "<div class=\"empty-hint\">No outfits yet.</div>";
  }

  return character.clothingGroups
    .map((group) => {
      const isActive = character.activeGroupId === group.id;
      const activeClass = isActive ? "is-active" : "";
      const activeIcon = isActive ? "fa-check" : "fa-shirt";
      const activeTitle = isActive ? "Currently worn" : "Set as worn";
      const collapsedClass = group.collapsed ? "is-collapsed" : "";
      const hasLockedChild = checkHasLockedChild(group.layers);
      const canDelete = !group.locked && !hasLockedChild;
      const deleteClass = canDelete ? "" : "is-disabled";
      const lockIcon = group.locked ? "fa-lock" : "fa-lock-open";
      const lockTitle = group.locked ? "Locked (LLM cannot modify)" : "Unlocked";
      const contentHtml = renderLayers(group.layers, 0, "none");

      return `
        <div class="clothing-group ${activeClass}" data-group-id="${group.id}">
            <div class="clothing-group__header">
                <button class="group-toggle" type="button" data-action="toggle-group">${group.collapsed ? "+" : "-"}</button>
            <input class="group-name text_pole" type="text" value="${escapeHtml(group.name)}" data-field="group-name" data-group-id="${group.id}" />
            <button class="group-action icon-button group-active-toggle ${isActive ? "is-on" : ""}" type="button" data-action="set-active-group" title="${activeTitle}">
              <i class="fa-solid ${activeIcon}"></i>
            </button>
            <div class="group-lock-wrapper">
              <button class="group-action icon-button group-lock-button" type="button" data-action="toggle-lock" title="${lockTitle}">
                <i class="fa-solid ${lockIcon}"></i>
              </button>
            </div>
            <button class="group-action icon-button" type="button" data-action="add-layer" title="Add layer">
              <i class="fa-solid fa-plus"></i>
            </button>
            <button class="group-action icon-button ${deleteClass}" type="button" data-action="delete-group" title="Delete group" ${canDelete ? "" : "disabled"}>
              <i class="fa-solid fa-trash"></i>
            </button>
            </div>
            <div class="clothing-group__content ${collapsedClass}">
                ${contentHtml}
            </div>
        </div>
      `;
    })
    .join("");
}

function renderCharacter(character) {
  if (!character) {
    return `
      <div class="character-details__empty">
        <div class="empty-title">No characters yet</div>
        <div class="empty-subtitle">Open manager and use Add to create one.</div>
      </div>
    `;
  }

  const context = getContext();
  const avatarMap = readAvatarMap(context);
  const uploadedAvatarKey = getAvatarKeyForCharacterName(character.name);
  const hasUploadedAvatar = Boolean(uploadedAvatarKey && avatarMap?.[uploadedAvatarKey]);
  const avatarSrc = getCharacterAvatarSource(character, context, avatarMap);
  const avatarHtml = avatarSrc
    ? `<img class="character-manager__avatar-image" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(character.name || "Unnamed")}" />`
    : escapeHtml(getInitials(character.name));
  const removeAvatarButton = hasUploadedAvatar
    ? `<span class="character-manager__avatar-remove" data-action="remove-avatar-character" data-character-id="${character.id}" title="Remove uploaded avatar" role="button" tabindex="0" aria-label="Remove uploaded avatar">
        <i class="fa-solid fa-xmark"></i>
      </span>`
    : "";
  const uploadAvatarTitle = hasUploadedAvatar ? "Upload an image (overwrite)" : "Upload an image";
  const customFields = getCustomFieldsForCharacter(character, context);
  const customFieldsHtml = customFields
    .map((field) => `
      <div class="character-details__section">
        <div class="character-details__header">
          <div class="character-details__label">${escapeHtml(field.label)}</div>
          <button class="group-action icon-button custom-field-toggle ${field.enabled ? "is-on" : ""}" type="button" data-action="toggle-custom-field" data-var-name="${escapeHtml(field.varName)}" title="${field.enabled ? "Send to generator" : "Do not send to generator"}">
            <i class="fa-solid ${field.enabled ? "fa-paper-plane" : "fa-paper-plane"}"></i>
          </button>
        </div>
        <textarea class="text_pole character-details__textarea character-details__custom-field" rows="2" data-field="custom-field-value" data-var-name="${escapeHtml(field.varName)}">${escapeHtml(field.value || "")}</textarea>
      </div>
    `)
    .join("");

  return `
    <div class="character-details">
        <div class="character-details__section">
            <div class="character-details__label">Name</div>
        <div class="character-details__name-row">
          <button class="character-manager__initials" type="button" data-action="upload-avatar-character" data-character-id="${character.id}" title="${uploadAvatarTitle}">
            ${avatarHtml}
            <span class="character-manager__avatar-upload">
              <i class="fa-solid fa-upload"></i>
            </span>
            ${removeAvatarButton}
          </button>
          <input class="text_pole" type="text" value="${escapeHtml(character.name)}" data-field="character-name" data-character-id="${character.id}" />
          <button class="presence-toggle ${character.presence ? "is-on" : ""}" type="button" data-action="toggle-presence" title="Present in scene">
            <i class="fa-solid ${character.presence ? "fa-user-check" : "fa-user-slash"}"></i>
          </button>
          <button class="mc-toggle ${state?.mainCharacterId === character.id ? "is-on" : ""}" type="button" data-action="toggle-mc" title="Main Character">
            <i class="fa-solid ${state?.mainCharacterId === character.id ? "fa-star" : "fa-star"}" style="${state?.mainCharacterId === character.id ? "" : "opacity: 0.4;"}"></i>
          </button>
          <button class="viewer-toggle ${state?.viewerCharacterId === character.id ? "is-on" : ""}" type="button" data-action="toggle-viewer" title="Viewer">
            <i class="fa-solid ${state?.viewerCharacterId === character.id ? "fa-eye" : "fa-eye-slash"}"></i>
          </button>
        </div>
        </div>
        <div class="character-details__section">
            <div class="character-details__label">Appearance</div>
            <textarea class="text_pole character-details__textarea" rows="3" data-field="appearance" data-character-id="${character.id}">${escapeHtml(character.appearance)}</textarea>
        </div>
        ${customFieldsHtml}
        <div class="character-details__section">
            <div class="character-details__header">
            <div class="character-details__label">Outfits</div>
            <button class="group-action icon-button" type="button" data-action="generate-outfit-ai" title="Generate outfit with AI">
              <i class="fa-solid fa-robot"></i>
            </button>
            <button class="group-action icon-button" type="button" data-action="add-group" title="Add outfit">
              <i class="fa-solid fa-plus"></i>
            </button>
            </div>
            <div class="clothing-groups">
                ${renderGroups(character)}
            </div>
        </div>
    </div>
  `;
}

function renderPanel() {
  const context = getContext();
  const hasChatTarget = context.characterId !== undefined && context.characterId !== null || context.groupId;

  if (!hasChatTarget) {
    panelRoot.html(`
      <div class="character-details__empty">
        <div class="empty-title">Enter chat</div>
        <div class="empty-subtitle">Select a character to start managing details.</div>
      </div>
    `);
    footerRoot.addClass("displayNone");
    floatingRoot.addClass("hidden");
    managerRoot.addClass("hidden");
    return;
  }

  footerRoot.removeClass("displayNone");
  updateFooterImageButtonsVisibility();
  const character = getActiveCharacter(state);
  panelRoot.html(renderCharacter(character));
  renderFloatingCharacters();
  renderManagerPanel();
}

function saveAndRender() {
  const context = getContext();
  state = normalizeCharacterDetails(state, context);
  
  // Reload to get the latest lastGenDescriptionsTarget from storage
  const savedData = loadCharacterDetails(context);
  state.lastGenDescriptionsTarget = savedData.lastGenDescriptionsTarget;
  
  ensureActiveGroups(state);
  saveCharacterDetails(context, state);
  const descriptionsText = buildDescriptionsText(state);
  context.variables?.local?.set?.("descriptions", descriptionsText);
  
  // If a target was previously set, also update genDescriptions
  if (state.lastGenDescriptionsTarget) {
    const genDescriptions = buildGenDescriptions(state, state.lastGenDescriptionsTarget);
    context.variables?.local?.set?.("genDescriptions", genDescriptions);
  }
  
  renderPanel();
}

function updateDescriptionsOnly() {
  const context = getContext();
  state = normalizeCharacterDetails(state, context);
  
  // Reload to get the latest lastGenDescriptionsTarget from storage
  const savedData = loadCharacterDetails(context);
  state.lastGenDescriptionsTarget = savedData.lastGenDescriptionsTarget;
  
  ensureActiveGroups(state);
  saveCharacterDetails(context, state);
  const descriptionsText = buildDescriptionsText(state);
  context.variables?.local?.set?.("descriptions", descriptionsText);
  
  // If a target was previously set, also update genDescriptions
  if (state.lastGenDescriptionsTarget) {
    const genDescriptions = buildGenDescriptions(state, state.lastGenDescriptionsTarget);
    context.variables?.local?.set?.("genDescriptions", genDescriptions);
  }
}

function handleAddCharacter() {
  const context = getContext();
  const newCharacter = createCharacter(context);
  state.characters.push(newCharacter);
  state.activeCharacterId = newCharacter.id;
  saveAndRender();
}

function moveUploadedAvatarKey(oldName, newName) {
  const oldKey = getAvatarKeyForCharacterName(oldName);
  const newKey = getAvatarKeyForCharacterName(newName);
  if (!oldKey || !newKey || oldKey === newKey) {
    return;
  }

  const context = getContext();
  const avatarMap = readAvatarMap(context);
  if (!avatarMap[oldKey] || avatarMap[newKey]) {
    return;
  }

  avatarMap[newKey] = avatarMap[oldKey];
  delete avatarMap[oldKey];
  writeAvatarMap(context, avatarMap);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function pickAvatarFile() {
  return await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const onChange = () => {
      const file = input.files?.[0] || null;
      cleanup();
      resolve(file);
    };

    input.addEventListener("change", onChange, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function handleUploadCharacterAvatar(character) {
  const file = await pickAvatarFile();
  if (!file) {
    return;
  }

  let dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl.startsWith("data:image/")) {
    toastr.error("Selected file is not a supported image.", "Character Details");
    return;
  }

  const key = getAvatarKeyForCharacterName(character.name);
  if (!key) {
    toastr.warning("Set character name before uploading avatar.", "Character Details");
    return;
  }

  dataUrl = await maybeCropAvatarDataUrl(dataUrl);
  if (!dataUrl) {
    return;
  }

  const context = getContext();
  const avatarMap = readAvatarMap(context);
  avatarMap[key] = dataUrl;
  writeAvatarMap(context, avatarMap);
  renderPanel();
}

function handleRemoveCharacterAvatar(character) {
  const key = getAvatarKeyForCharacterName(character.name);
  if (!key) {
    return;
  }

  const context = getContext();
  const avatarMap = readAvatarMap(context);
  if (!avatarMap[key]) {
    return;
  }

  delete avatarMap[key];
  writeAvatarMap(context, avatarMap);
  renderPanel();
}

async function setupAutoBackgroundAfterGeneration(context) {
  // Wait a moment for the image to be rendered in chat
  await new Promise(resolve => setTimeout(resolve, 1200));
  
  console.log("[ST Extension] Looking for generated background image...");
  
  // Look for the most recent image in the chat
  const chatContainer = $("#chat");
  if (!chatContainer.length) {
    console.log("[ST Extension] Chat container not found");
    return;
  }
  
  const messages = chatContainer.find(".mes").toArray().reverse();
  console.log(`[ST Extension] Scanning ${messages.length} messages`);
  
  for (const msgElement of messages) {
    const imageElements = $(msgElement).find("img");
    console.log(`[ST Extension] Found ${imageElements.length} images in message`);
    
    if (imageElements.length > 0) {
      const imageElement = $(imageElements).last();
      const imageSrc = imageElement.attr("src");
      console.log(`[ST Extension] Image src: ${imageSrc?.substring(0, 100)}...`);
      
      if (imageSrc) {
        // Auto-set background if it's a data URL (our generated image)
        try {
          await applyBackgroundFromImage(imageSrc);
          toastr.success("Background set automatically.", "Character Details");
          console.log("[ST Extension] Background applied successfully");
        } catch (error) {
          console.error("[ST Extension] Failed to set background:", error);
          toastr.error("Failed to set background: " + error?.message, "Character Details");
        }
      }
      break;
    }
  }
}

function normalizeBackgroundPath(value) {
  if (typeof value !== "string") {
    return "";
  }

  let text = String(value).trim();
  if (!text) {
    return "";
  }

  const cssUrlMatch = text.match(/^url\((.*)\)$/i);
  if (cssUrlMatch) {
    text = String(cssUrlMatch[1] || "").trim().replace(/^['"]|['"]$/g, "");
  }

  try {
    const absoluteUrl = new URL(text, window.location.origin);
    text = `${absoluteUrl.pathname}${absoluteUrl.search}`;
  } catch {
  }

  try {
    text = decodeURI(text);
  } catch {
  }

  return text;
}

function findExistingChatBackgroundPath(imageUrl, chatBackgrounds) {
  const normalizedImagePath = normalizeBackgroundPath(imageUrl);
  if (!normalizedImagePath || !Array.isArray(chatBackgrounds)) {
    return null;
  }

  for (const item of chatBackgrounds) {
    if (normalizeBackgroundPath(item) === normalizedImagePath) {
      return item;
    }
  }

  return null;
}

function getPersistedImagePathFromUrl(imageUrl) {
  const normalized = normalizeBackgroundPath(imageUrl);
  if (!normalized) {
    return null;
  }

  // Already stored in user images - no upload needed
  if (normalized.startsWith('/user/images/')) {
    return normalized;
  }

  return null;
}

async function setChatBackgroundMetadata(imagePath) {
  const context = getContext();
  const chatMetadata = context?.chatMetadata;
  if (!chatMetadata) {
    throw new Error('chatMetadata is not available in context');
  }

  const LIST_METADATA_KEY = 'chat_backgrounds';
  const BG_METADATA_KEY = 'custom_background';
  const normalizedTarget = normalizeBackgroundPath(imagePath);
  const list = Array.isArray(chatMetadata[LIST_METADATA_KEY]) ? [...chatMetadata[LIST_METADATA_KEY]] : [];
  const alreadyInList = list.some((item) => normalizeBackgroundPath(item) === normalizedTarget);
  if (!alreadyInList) {
    list.push(imagePath);
  }
  chatMetadata[LIST_METADATA_KEY] = list;
  chatMetadata[BG_METADATA_KEY] = `url("${encodeURI(imagePath)}")`;

  if (typeof context?.saveMetadata === 'function') {
    await context.saveMetadata();
  } else {
    throw new Error('saveMetadata function not available in context');
  }

  if (context?.eventSource && context?.eventTypes?.CHAT_CHANGED) {
    await context.eventSource.emit(context.eventTypes.CHAT_CHANGED);
  }
}

async function applyBackgroundFromImage(imageUrl) {
  console.log("[ST Extension] Applying background image...", imageUrl);
  
  try {
    const context = getContext();
    const chatMetadata = context?.chatMetadata;
    const LIST_METADATA_KEY = "chat_backgrounds";

    // Optimization 1: if source image is already persisted in /user/images, skip upload
    const persistedImagePath = getPersistedImagePathFromUrl(imageUrl);

    // Optimization 2: if image already exists in chat backgrounds, skip upload
    const existingPath = findExistingChatBackgroundPath(imageUrl, chatMetadata?.[LIST_METADATA_KEY]);
    const imagePath = existingPath || persistedImagePath || await uploadBackgroundToServer(imageUrl);

    if (existingPath || persistedImagePath) {
      await setChatBackgroundMetadata(imagePath);
      console.log("[ST Extension] Reused existing persisted background, upload skipped:", imagePath);
    }
    
    if (!imagePath) {
      throw new Error("No image path returned from upload");
    }
    
    // Apply background CSS with the persisted path
    if (typeof jQuery !== 'undefined') {
      const bgElement = jQuery('#bg1');
      if (bgElement.length) {
        const backgroundCssUrl = `url("${encodeURI(imagePath)}")`;
        bgElement.css('background-image', backgroundCssUrl);
        console.log("[ST Extension] Applied CSS to #bg1 with path:", backgroundCssUrl);
      } else {
        console.warn("[ST Extension] #bg1 element not found");
      }
    }
  } catch (error) {
    console.error("[ST Extension] Failed to apply background:", error);
    throw error;
  }
}

async function uploadBackgroundToServer(imageUrl) {
  try {
    console.log("[ST Extension] Starting background upload for:", imageUrl);
    
    // Use SillyTavern extension context API
    const context = getContext();
    const characters = Array.isArray(context?.characters) ? context.characters : [];
    const thisChid = Number(context?.characterId);
    const selectedGroup = context?.groupId;
    const groups = Array.isArray(context?.groups) ? context.groups : [];
    const chatId = typeof context?.getCurrentChatId === 'function' ? context.getCurrentChatId() : null;
    if (!chatId) {
      throw new Error('No active chat selected');
    }
    
    let characterName;
    if (selectedGroup) {
      characterName = groups.find((group) => String(group?.id) == String(selectedGroup))?.id?.toString();
    } else if (Number.isInteger(thisChid) && characters[thisChid]) {
      characterName = String(characters[thisChid].name || "").trim();
    }

    // Fallback: use currently active extension character
    if (!characterName) {
      const activeCharacter = getActiveCharacter(state);
      const activeName = String(activeCharacter?.name || "").trim();
      if (activeName) {
        characterName = activeName;
      }
    }

    // Fallback: parse character folder from image URL e.g. /user/images/Kei and Rika/file.png
    if (!characterName && typeof imageUrl === "string") {
      const marker = "/user/images/";
      const markerIndex = imageUrl.indexOf(marker);
      if (markerIndex >= 0) {
        const pathAfterMarker = imageUrl.slice(markerIndex + marker.length);
        const firstSlashIndex = pathAfterMarker.indexOf("/");
        const folderName = firstSlashIndex >= 0 ? pathAfterMarker.slice(0, firstSlashIndex) : "";
        const decodedFolderName = decodeURIComponent(folderName || "").trim();
        if (decodedFolderName) {
          characterName = decodedFolderName;
        }
      }
    }
    
    if (!characterName) {
      console.warn("[ST Extension] No character selected and could not infer from image URL");
      return null;
    }
    
    console.log("[ST Extension] Character name:", characterName);
    
    // Convert image URL to base64
    let base64Data;
    if (imageUrl.startsWith('data:')) {
      // Already a data URL - extract base64 part
      base64Data = imageUrl.split(',')[1];
      console.log("[ST Extension] Using data URL directly");
    } else {
      // Fetch and convert to base64
      console.log("[ST Extension] Fetching image from URL:", imageUrl);
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve) => {
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      base64Data = dataUrl.split(',')[1];
      console.log("[ST Extension] Converted to base64");
    }
    
    // Create filename with timestamp (humanized format like SillyTavern)
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}@${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}m${String(now.getSeconds()).padStart(2, '0')}s${String(now.getMilliseconds()).padStart(3, '0')}ms`;
    const filename = `${characterName}_${timestamp}`;
    
    console.log("[ST Extension] Uploading with filename:", filename);
    
    // Upload using SillyTavern's API
    const requestBody = {
      image: base64Data,
      format: 'png',
      ch_name: characterName,
      filename: filename.replace(/\./g, '_'),
    };
    
    const uploadResponse = await fetch('/api/images/upload', {
      method: 'POST',
      headers: typeof context?.getRequestHeaders === 'function'
        ? context.getRequestHeaders()
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed (${uploadResponse.status}): ${errorText}`);
    }
    
    const responseData = await uploadResponse.json();
    console.log("[ST Extension] Upload successful:", responseData);
    
    const imagePath = String(responseData.path || '').trim();
    if (!imagePath) {
      throw new Error('Upload response missing image path');
    }
    
    console.log("[ST Extension] Background uploaded to:", imagePath);
    
    await setChatBackgroundMetadata(imagePath);
    console.log("[ST Extension] Metadata saved successfully");
    
    // Refresh background gallery if function is available
    if (typeof window.getBackgrounds === 'function') {
      await window.getBackgrounds();
      console.log("[ST Extension] Backgrounds refreshed");
    }
    
    return imagePath;
    
  } catch (error) {
    console.error("[ST Extension] Failed to upload background:", error);
    throw error;
  }
}

function resetMessageProcessing() {
  // Remove the processed flag from all messages so they get re-checked
  const chatContainer = $("#chat");
  if (chatContainer.length) {
    chatContainer.find(".mes[data-st-extension-processed]").removeAttr("data-st-extension-processed");
  }
}

function findMessageImageElement($msg) {
  if (!$msg?.length) {
    return $();
  }

  const imageElement = $msg
    .find(".mes_img")
    .filter((index, element) => {
      const $element = $(element);
      const source = String($element.attr("src") || $element.attr("data-src") || "").trim();
      return Boolean(source);
    })
    .last();

  if (imageElement.length) {
    return imageElement;
  }

  return $msg.find(".mes_img").last();
}

function setImageActionButtonsState($msg) {
  if (!$msg?.length) {
    return;
  }

  const hasImage = findMessageImageElement($msg).length > 0;
  const buttons = $msg.find("[data-st-extension-image-action]");
  if (!buttons.length) {
    return;
  }

  buttons.each((index, button) => {
    const $button = $(button);
    $button.toggleClass("disabled", !hasImage);
    $button.css("opacity", hasImage ? "" : "0.3");
    $button.css("cursor", hasImage ? "" : "not-allowed");
    $button.attr("aria-disabled", hasImage ? "false" : "true");
  });
}

function injectMessageActionButtons() {
  const chatContainer = $("#chat");
  if (!chatContainer.length) {
    return;
  }
  
  const messages = chatContainer.find(".mes");
  
  if (messages.length === 0) {
    return;
  }
  
  messages.each((index, msgElement) => {
    const $msg = $(msgElement);
    
    // Find or create extraMesButtons container
    let actionsContainer = $msg.find(".extraMesButtons");
    if (!actionsContainer.length) {
      actionsContainer = $('<div class="extraMesButtons"></div>');
      const mesButtons = $msg.find(".mes_buttons");
      if (mesButtons.length) {
        actionsContainer.appendTo(mesButtons);
      } else {
        // Fallback: append after mes_text
        const mesBlock = $msg.find(".mes_block");
        if (mesBlock.length) {
          actionsContainer.appendTo(mesBlock);
        }
      }
    }
    
    // Check if our buttons already added
    const hasOurButtons = actionsContainer.find("[data-st-extension-image-action]").length > 0;
    if (!hasOurButtons) {
      // Add "Set as avatar" button
      const avatarBtn = $(
        `<div class="mes_button mes_button_icon" data-action="set-as-avatar" data-st-extension-image-action="true" 
          title="Set as character avatar" tabindex="0" role="button">
          <i class="fa-solid fa-user-circle"></i>
        </div>`
      );
      
      // Add "Set as background" button
      const bgBtn = $(
        `<div class="mes_button mes_button_icon" data-action="set-as-chat-background" data-st-extension-image-action="true"
          title="Set as chat background" tabindex="0" role="button">
          <i class="fa-solid fa-image"></i>
        </div>`
      );

      actionsContainer.append(avatarBtn);
      actionsContainer.append(bgBtn);
    }

    setImageActionButtonsState($msg);
  });
}


async function handleSetAsAvatarClick(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const $btn = $(event.target).closest("[data-action='set-as-avatar']");
  const $msg = $btn.closest(".mes");
  setImageActionButtonsState($msg);
  
  // Check if button is disabled
  if ($btn.hasClass("disabled")) {
    toastr.warning("No image detected in this message yet.", "Character Details");
    return;
  }

  const imageElement = findMessageImageElement($msg);
  
  if (!imageElement.length) {
    setImageActionButtonsState($msg);
    toastr.error("No image found in message.", "Character Details");
    return;
  }

  const imageSrc = imageElement.attr("src") || imageElement.attr("data-src");
  if (!imageSrc) {
    toastr.error("Image source not found.", "Character Details");
    return;
  }
  
  // Convert to data URL if needed
  let dataUrl = imageSrc;
  if (!imageSrc.startsWith("data:")) {
    try {
      const response = await fetch(imageSrc);
      const blob = await response.blob();
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      toastr.error("Failed to load image: " + error.message, "Character Details");
      return;
    }
  }

  dataUrl = await maybeCropAvatarDataUrl(dataUrl);
  if (!dataUrl) {
    return;
  }
  
  const context = getContext();
  const activeCharacter = getActiveCharacter(state);
  if (!activeCharacter) {
    toastr.warning("Select a character first.", "Character Details");
    return;
  }
  
  const key = getAvatarKeyForCharacterName(activeCharacter.name);
  if (!key) {
    toastr.warning("Character name required.", "Character Details");
    return;
  }
  
  const avatarMap = readAvatarMap(context);
  avatarMap[key] = dataUrl;
  writeAvatarMap(context, avatarMap);
  
  renderFloatingCharacters();
  renderManagerPanel();
  
  toastr.success(`Avatar set for ${activeCharacter.name}.`, "Character Details");
}

async function handleSetAsChatBackgroundClick(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const $btn = $(event.target).closest("[data-action='set-as-chat-background']");
  const $msg = $btn.closest(".mes");
  setImageActionButtonsState($msg);
  
  // Check if button is disabled
  if ($btn.hasClass("disabled")) {
    toastr.warning("No image detected in this message yet.", "Character Details");
    return;
  }

  const imageElement = findMessageImageElement($msg);
  
  if (!imageElement.length) {
    setImageActionButtonsState($msg);
    toastr.error("No image found in message.", "Character Details");
    return;
  }

  const imageSrc = imageElement.attr("src") || imageElement.attr("data-src");
  if (!imageSrc) {
    toastr.error("Image source not found.", "Character Details");
    return;
  }
  
  console.log("[ST Extension] Set as chat background clicked for:", imageSrc);
  
  try {
    await applyBackgroundFromImage(imageSrc);
    toastr.success("Chat background updated.", "Character Details");
  } catch (error) {
    console.error("[ST Extension] Error setting background:", error);
    toastr.error("Failed to set background: " + error?.message, "Character Details");
  }
}

function getDefinedCustomFieldVarNames() {
  return getCustomFieldsSettings()
    .map((field) => field.varName)
    .filter(Boolean);
}

function collectCustomFieldValues(context) {
  const values = {};
  const varNames = getDefinedCustomFieldVarNames();
  for (const varName of varNames) {
    values[varName] = formatVariableValue(context.variables?.local?.get?.(varName));
  }
  return values;
}

function normalizeImportedCustomFieldValues(rawValues) {
  if (!rawValues || typeof rawValues !== "object") {
    return {};
  }

  const normalized = {};
  const varNames = getDefinedCustomFieldVarNames();
  for (const varName of varNames) {
    if (!Object.prototype.hasOwnProperty.call(rawValues, varName)) {
      continue;
    }

    normalized[varName] = formatVariableValue(rawValues[varName]);
  }

  return normalized;
}

function applyImportedCustomFieldValues(context, values) {
  const normalized = values && typeof values === "object" ? values : {};
  const varNames = getDefinedCustomFieldVarNames();

  for (const varName of varNames) {
    if (Object.prototype.hasOwnProperty.call(normalized, varName)) {
      context.variables?.local?.set?.(varName, formatVariableValue(normalized[varName]));
    } else {
      context.variables?.local?.set?.(varName, "");
    }
  }
}

function collectCharacterAvatars(data, context) {
  const avatarMap = readAvatarMap(context);
  const result = {};

  for (const character of Array.isArray(data?.characters) ? data.characters : []) {
    const key = getAvatarKeyForCharacterName(character?.name);
    if (!key || !avatarMap[key]) {
      continue;
    }
    result[key] = avatarMap[key];
  }

  return result;
}

function normalizeImportedCharacterAvatars(rawValues, data) {
  if (!rawValues || typeof rawValues !== "object") {
    return {};
  }

  const allowedNames = new Set(
    (Array.isArray(data?.characters) ? data.characters : [])
      .map((character) => getAvatarKeyForCharacterName(character?.name))
      .filter(Boolean),
  );

  const result = {};
  for (const [name, value] of Object.entries(rawValues)) {
    const key = getAvatarKeyForCharacterName(name);
    if (!key || !allowedNames.has(key) || typeof value !== "string" || !value.trim()) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

function applyImportedCharacterAvatars(context, avatars, data) {
  const nextMap = readAvatarMap(context);
  const allowedNames = new Set(
    (Array.isArray(data?.characters) ? data.characters : [])
      .map((character) => getAvatarKeyForCharacterName(character?.name))
      .filter(Boolean),
  );

  for (const name of allowedNames) {
    delete nextMap[name];
  }

  for (const [name, value] of Object.entries(avatars && typeof avatars === "object" ? avatars : {})) {
    const key = getAvatarKeyForCharacterName(name);
    if (!key || !allowedNames.has(key) || typeof value !== "string" || !value.trim()) {
      continue;
    }
    nextMap[key] = value;
  }

  writeAvatarMap(context, nextMap);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCurrentPersonaId(context) {
  const personaId = String(context?.user_avatar || globalUserAvatar || "").trim();
  return personaId || "";
}

function readPersonaCharacterMap(context) {
  const raw = context.variables?.global?.get?.(PERSONA_CHARACTER_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  return parsed;
}

function writePersonaCharacterMap(context, value) {
  const map = value && typeof value === "object" ? value : {};
  context.variables?.global?.set?.(PERSONA_CHARACTER_STORAGE_KEY, JSON.stringify(map));
}

function buildViewerPersonaPayload(data, context) {
  const viewerCharacter = data?.viewerCharacterId
    ? (data.characters || []).find((character) => character.id === data.viewerCharacterId) || null
    : null;

  if (!viewerCharacter) {
    return null;
  }

  const customFieldValues = {};
  for (const field of getCustomFieldsForCharacter(viewerCharacter, context)) {
    if (!field?.varName) {
      continue;
    }
    customFieldValues[field.varName] = formatVariableValue(field.value);
  }

  const avatarMap = readAvatarMap(context);
  const avatarKey = getAvatarKeyForCharacterName(viewerCharacter.name);
  const avatar = avatarKey && avatarMap[avatarKey] ? avatarMap[avatarKey] : getCharacterAvatarSource(viewerCharacter, context, avatarMap);

  return {
    character: cloneValue(viewerCharacter),
    customFieldValues,
    avatar: typeof avatar === "string" ? avatar : "",
    savedAt: Date.now(),
  };
}

async function handleSaveViewerToPersona() {
  const context = getContext();
  const personaId = getCurrentPersonaId(context);
  if (!personaId) {
    toastr.warning("No active persona selected.", "Character Details");
    return;
  }

  const payload = buildViewerPersonaPayload(state, context);
  if (!payload) {
    toastr.warning("Set viewer character first.", "Character Details");
    return;
  }

  const map = readPersonaCharacterMap(context);
  if (map[personaId]) {
    const shouldReplace = await Popup.show.confirm(
      "Replace saved persona character",
      "Current persona already has a saved character. It will be replaced.",
      { okButton: "Replace", cancelButton: "Cancel" },
    );
    if (!shouldReplace) {
      return;
    }
  }

  map[personaId] = payload;
  writePersonaCharacterMap(context, map);
  toastr.success("Viewer character saved to current persona.", "Character Details");
}

function upsertPersonaCharacterIntoState(data, context, personaEntry, options = {}) {
  const overwriteViewer = options.overwriteViewer === true;
  const sourceCharacter = personaEntry?.character;
  if (!sourceCharacter || typeof sourceCharacter !== "object") {
    return false;
  }

  const viewerCharacter = data.viewerCharacterId
    ? (data.characters || []).find((character) => character.id === data.viewerCharacterId) || null
    : null;

  let targetId = sourceCharacter.id;
  if (overwriteViewer && viewerCharacter) {
    targetId = viewerCharacter.id;
  }

  const normalized = normalizeCharacterDetails({
    characters: [{ ...cloneValue(sourceCharacter), id: targetId }],
  }, context);
  const nextCharacter = normalized.characters?.[0] || null;
  if (!nextCharacter) {
    return false;
  }

  if (overwriteViewer && viewerCharacter) {
    const index = data.characters.findIndex((character) => character.id === viewerCharacter.id);
    if (index !== -1) {
      data.characters[index] = nextCharacter;
      const oldAvatarKey = getAvatarKeyForCharacterName(viewerCharacter.name);
      const nextAvatarKey = getAvatarKeyForCharacterName(nextCharacter.name);
      if (oldAvatarKey && nextAvatarKey && oldAvatarKey !== nextAvatarKey) {
        const avatarMap = readAvatarMap(context);
        if (avatarMap[oldAvatarKey]) {
          delete avatarMap[oldAvatarKey];
          writeAvatarMap(context, avatarMap);
        }
      }
    } else {
      data.characters.push(nextCharacter);
    }
  } else {
    data.characters.push(nextCharacter);
  }

  data.viewerCharacterId = nextCharacter.id;
  data.activeCharacterId = nextCharacter.id;

  const nextAvatarKey = getAvatarKeyForCharacterName(nextCharacter.name);
  if (nextAvatarKey && typeof personaEntry.avatar === "string" && personaEntry.avatar.trim()) {
    const avatarMap = readAvatarMap(context);
    avatarMap[nextAvatarKey] = personaEntry.avatar;
    writeAvatarMap(context, avatarMap);
  }

  applyImportedCustomFieldValues(context, personaEntry.customFieldValues || {});
  ensureActiveCharacter(data);
  ensureActiveGroups(data);
  return true;
}

async function handleAddCharacterFromPersona() {
  const context = getContext();
  const personaId = getCurrentPersonaId(context);
  if (!personaId) {
    toastr.warning("No active persona selected.", "Character Details");
    return;
  }

  const map = readPersonaCharacterMap(context);
  const entry = map[personaId];
  if (!entry?.character) {
    toastr.warning("No saved character for current persona.", "Character Details");
    return;
  }

  const hasViewer = Boolean(state.viewerCharacterId && state.characters.some((character) => character.id === state.viewerCharacterId));
  if (hasViewer) {
    const shouldOverwrite = await Popup.show.confirm(
      "Overwrite viewer character",
      "Viewer character already exists and will be overwritten.",
      { okButton: "Overwrite", cancelButton: "Cancel" },
    );
    if (!shouldOverwrite) {
      return;
    }
  }

  const updated = upsertPersonaCharacterIntoState(state, context, entry, { overwriteViewer: hasViewer });
  if (!updated) {
    toastr.error("Failed to load character from persona.", "Character Details");
    return;
  }

  saveAndRender();
  toastr.success("Character loaded from persona.", "Character Details");
}

function autoAddCharacterFromPersonaIfExists(data, context) {
  if (!shouldAutoAddPersonaCharacter()) {
    return false;
  }

  if (Array.isArray(data?.characters) && data.characters.length > 0) {
    return false;
  }

  const personaId = getCurrentPersonaId(context);
  if (!personaId) {
    return false;
  }

  const map = readPersonaCharacterMap(context);
  const entry = map[personaId];
  if (!entry?.character) {
    return false;
  }

  return upsertPersonaCharacterIntoState(data, context, entry, { overwriteViewer: false });
}

function sanitizeExportFileName(value) {
  const cleaned = String(value || "character-details")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");

  return cleaned || "character-details";
}

function triggerJsonDownload(fileName, payload) {
  const jsonText = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleExportCharacterDetails() {
  const context = getContext();
  const chatId = context?.getCurrentChatId?.();
  if (!chatId) {
    toastr.warning("Open a chat before exporting.", "Character Details");
    return;
  }

  const dataToExport = loadCharacterDetails(context);
  const payload = {
    ...dataToExport,
    customFieldValues: collectCustomFieldValues(context),
    avatars: collectCharacterAvatars(dataToExport, context),
  };
  const fileName = sanitizeExportFileName(`character-details-${chatId}`);
  triggerJsonDownload(fileName, payload);
  toastr.success("Character details exported.", "Character Details");
}

async function readImportFile() {
  return await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const onChange = () => {
      const file = input.files?.[0] || null;
      cleanup();
      resolve(file);
    };

    input.addEventListener("change", onChange, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function handleImportCharacterDetails() {
  const context = getContext();
  const chatId = context?.getCurrentChatId?.();
  if (!chatId) {
    toastr.warning("Open a chat before importing.", "Character Details");
    return;
  }

  try {
    const file = await readImportFile();
    if (!file) {
      return;
    }

    const rawText = await file.text();
    const parsed = JSON.parse(rawText);
    const importedData = normalizeCharacterDetails(parsed, context);
    const currentData = loadCharacterDetails(context);
    const currentCustomFieldValues = collectCustomFieldValues(context);
    const currentAvatars = collectCharacterAvatars(currentData, context);
    const hasImportedCustomFieldValues = Object.prototype.hasOwnProperty.call(parsed || {}, "customFieldValues");
    const hasImportedAvatars = Object.prototype.hasOwnProperty.call(parsed || {}, "avatars");
    const importedCustomFieldValues = hasImportedCustomFieldValues
      ? normalizeImportedCustomFieldValues(parsed.customFieldValues)
      : currentCustomFieldValues;
    const importedAvatars = hasImportedAvatars
      ? normalizeImportedCharacterAvatars(parsed.avatars, importedData)
      : currentAvatars;

    const currentPayload = {
      ...currentData,
      customFieldValues: currentCustomFieldValues,
      avatars: currentAvatars,
    };

    const importedPayload = {
      ...importedData,
      customFieldValues: importedCustomFieldValues,
      avatars: importedAvatars,
    };

    showCharacterDetailsDiff(currentPayload, importedPayload, (nextData) => {
      const { customFieldValues, avatars, ...nextCharacterData } = nextData || {};
      applyImportedCustomFieldValues(context, customFieldValues);
      applyImportedCharacterAvatars(context, avatars, nextCharacterData);
      setCharacterDetailsData(nextCharacterData);
      toastr.success("Character details imported.", "Character Details");
    });
  } catch (error) {
    toastr.error(`Import failed: ${error?.message || "Invalid JSON file"}`, "Character Details");
  }
}

function handlePanelInput(event) {
  const target = event.target;
  const field = target.dataset.field;
  if (!field) {
    return;
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  if (field === "character-name") {
    const sanitizedValue = sanitizeForbiddenText(target.value);
    if (target.value !== sanitizedValue) {
      target.value = sanitizedValue;
    }
    const previousName = character.name;
    character.name = sanitizedValue;
    moveUploadedAvatarKey(previousName, character.name);
    applyViewerFromPersona(state, getContext());
    updateDescriptionsOnly();
    renderFloatingCharacters();
    renderManagerPanel();
    return;
  }

  if (field === "appearance") {
    const sanitizedValue = sanitizeForbiddenText(target.value);
    if (target.value !== sanitizedValue) {
      target.value = sanitizedValue;
    }
    character.appearance = sanitizedValue;
    updateDescriptionsOnly();
    return;
  }

  if (field === "group-name") {
    const group = findGroup(character, target.dataset.groupId);
    if (group) {
      const sanitizedValue = sanitizeForbiddenText(target.value);
      if (target.value !== sanitizedValue) {
        target.value = sanitizedValue;
      }
      group.name = sanitizedValue;
      updateDescriptionsOnly();
    }
    return;
  }

  if (field === "layer-name") {
    const layer = findLayer(character.clothingGroups.flatMap((group) => group.layers), target.dataset.layerId);
    if (layer) {
      const sanitizedValue = sanitizeForbiddenText(target.value);
      if (target.value !== sanitizedValue) {
        target.value = sanitizedValue;
      }
      layer.name = sanitizedValue;
      updateDescriptionsOnly();
    }
  }

  if (field === "custom-field-value") {
    const varName = target.dataset.varName;
    if (varName) {
      const context = getContext();
      context.variables?.local?.set?.(varName, target.value);
      updateDescriptionsOnly();
    }
  }
}

function handlePanelClick(event) {
  const action = event.target.dataset.action;
  const actionOwner = action ? event.target : event.target.closest("[data-action]");
  const resolvedAction = actionOwner?.dataset.action;
  if (!resolvedAction) {
    return;
  }

  if (resolvedAction === "expand-manager") {
    managerExpanded = true;
    return renderPanel();
  }

  if (resolvedAction === "collapse-manager") {
    managerExpanded = false;
    return renderPanel();
  }

  if (resolvedAction === "add-character") {
    managerExpanded = true;
    return handleAddCharacter();
  }

  if (resolvedAction === "export-character-details") {
    return handleExportCharacterDetails();
  }

  if (resolvedAction === "import-character-details") {
    return handleImportCharacterDetails();
  }

  if (resolvedAction === "save-viewer-to-persona") {
    return handleSaveViewerToPersona();
  }

  if (resolvedAction === "add-character-from-persona") {
    return handleAddCharacterFromPersona();
  }

  if (resolvedAction === "upload-avatar-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      return handleUploadCharacterAvatar(targetCharacter);
    }
  }

  if (resolvedAction === "remove-avatar-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      return handleRemoveCharacterAvatar(targetCharacter);
    }
  }

  if (resolvedAction === "switch-character") {
    const characterId = actionOwner.dataset.characterId || actionOwner.closest("[data-character-id]")?.dataset.characterId;
    if (characterId && findCharacterById(state, characterId)) {
      state.activeCharacterId = characterId;
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-presence-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      targetCharacter.presence = !targetCharacter.presence;
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-mc-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      state.mainCharacterId = state.mainCharacterId === targetCharacter.id ? null : targetCharacter.id;
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-viewer-character") {
    const characterId = actionOwner.dataset.characterId;
    const targetCharacter = characterId ? findCharacterById(state, characterId) : null;
    if (targetCharacter) {
      state.viewerCharacterId = state.viewerCharacterId === targetCharacter.id ? null : targetCharacter.id;
      return saveAndRender();
    }
  }

  if (resolvedAction === "delete-character") {
    const characterId = actionOwner.dataset.characterId;
    if (characterId) {
      const removedCharacter = state.characters.find((characterItem) => characterItem.id === characterId) || null;
      const removedCharacterName = removedCharacter?.name;
      state.characters = state.characters.filter((characterItem) => characterItem.id !== characterId);
      if (state.activeCharacterId === characterId) {
        state.activeCharacterId = null;
      }
      if (state.mainCharacterId === characterId) {
        state.mainCharacterId = null;
      }
      if (state.viewerCharacterId === characterId) {
        state.viewerCharacterId = null;
      }

      const avatarKey = getAvatarKeyForCharacterName(removedCharacterName);
      if (avatarKey) {
        const context = getContext();
        const avatarMap = readAvatarMap(context);
        if (avatarMap[avatarKey]) {
          delete avatarMap[avatarKey];
          writeAvatarMap(context, avatarMap);
        }
      }

      ensureActiveCharacter(state);
      return saveAndRender();
    }
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  if (resolvedAction === "generate-outfit-ai") {
    void (async () => {
      const request = await Popup.show.input(
        "Generate outfit with AI",
        "Describe what outfit should be generated for this character (for example: Nice outfit for a date).",
        "",
        { okButton: "Generate", cancelButton: "Cancel", rows: 2 },
      );

      if (request === null) {
        return;
      }

      const requestText = String(request || "").trim();
      if (!requestText) {
        toastr.warning("Outfit request cannot be empty.", "Character Details");
        return;
      }

      await runOutfitGenerationForCharacter(character.id, requestText, $(actionOwner));
    })();
    return;
  }

  if (resolvedAction === "add-group") {
    const newGroup = createGroup(getContext());
    character.clothingGroups.push(newGroup);
    if (!character.activeGroupId) {
      character.activeGroupId = newGroup.id;
    }
    return saveAndRender();
  }

  const groupElement = event.target.closest(".clothing-group");
  const groupId = groupElement?.dataset.groupId;
  const group = groupId ? findGroup(character, groupId) : null;

  if (resolvedAction === "toggle-group" && group) {
    group.collapsed = !group.collapsed;
    return saveAndRender();
  }

  if (resolvedAction === "delete-group" && group) {
    character.clothingGroups = character.clothingGroups.filter((item) => item.id !== group.id);
    ensureActiveGroup(character);
    return saveAndRender();
  }

  if (resolvedAction === "set-active-group" && group) {
    character.activeGroupId = group.id;
    return saveAndRender();
  }

  if (resolvedAction === "add-layer" && group) {
    group.layers.push(createLayer(getContext()));
    return saveAndRender();
  }

  const layerElement = event.target.closest(".clothing-layer");
  const layerId = layerElement?.dataset.layerId;
  const layersRoot = character.clothingGroups.flatMap((item) => item.layers);
  const layer = layerId ? findLayer(layersRoot, layerId) : null;

  if (resolvedAction === "add-child" && layer) {
    layer.children.push(createLayer(getContext()));
    return saveAndRender();
  }

  if (resolvedAction === "delete-layer" && layerId) {
    removeLayerFromGroups(character.clothingGroups, layerId);
    return saveAndRender();
  }

  if (resolvedAction === "cycle-state" && layer) {
    cycleState(layer);
    return saveAndRender();
  }

  if (resolvedAction === "toggle-visibility-override" && layer) {
    layer.visibilityOverride = !Boolean(layer.visibilityOverride);
    return saveAndRender();
  }

  if (resolvedAction === "toggle-presence") {
    character.presence = !character.presence;
    return saveAndRender();
  }

  if (resolvedAction === "toggle-viewer") {
    state.viewerCharacterId = state.viewerCharacterId === character.id ? null : character.id;
    return saveAndRender();
  }

  if (resolvedAction === "toggle-mc") {
    state.mainCharacterId = state.mainCharacterId === character.id ? null : character.id;
    return saveAndRender();
  }

  if (resolvedAction === "toggle-custom-field") {
    const varName = actionOwner?.dataset.varName;
    if (varName) {
      state.customFieldGeneratorToggles = state.customFieldGeneratorToggles || {};
      state.customFieldGeneratorToggles[varName] = !state.customFieldGeneratorToggles[varName];
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-lock" && layerId) {
    const layer = findLayer(character.clothingGroups.flatMap((g) => g.layers), layerId);
    if (layer) {
      layer.locked = !layer.locked;
      return saveAndRender();
    }
  }

  if (resolvedAction === "toggle-lock" && groupId) {
    const group = findGroup(character, groupId);
    if (group) {
      group.locked = !group.locked;
      return saveAndRender();
    }
  }
}

function handleLayerDragStart(event) {
  const dragOrigin = event.target;
  if (dragOrigin?.closest?.("input, textarea")) {
    const nativeEvent = event.originalEvent || event;
    if (nativeEvent.dataTransfer) {
      nativeEvent.dataTransfer.effectAllowed = "none";
    }
    event.preventDefault();
    return;
  }

  const dragHandle = dragOrigin?.closest?.(".layer-drag-handle");
  if (!dragHandle) {
    return;
  }

  const layerElement = dragHandle.closest(".clothing-layer");
  const layerId = layerElement?.dataset?.layerId;
  if (!layerId) {
    return;
  }

  draggedLayerId = layerId;
  const nativeEvent = event.originalEvent || event;
  if (nativeEvent.dataTransfer) {
    nativeEvent.dataTransfer.setData("text/plain", layerId);
    nativeEvent.dataTransfer.effectAllowed = "move";
  }

  layerElement.classList.add("is-dragging");
}

function handleLayerDragOver(event) {
  const layerElement = resolveLayerElement(event);
  if (!layerElement || !draggedLayerId) {
    return;
  }

  event.preventDefault();
  const nativeEvent = event.originalEvent || event;
  const rect = layerElement.getBoundingClientRect();
  const offsetY = nativeEvent.clientY - rect.top;
  const ratio = rect.height > 0 ? offsetY / rect.height : 0.5;

  clearDragIndicators();
  if (ratio <= 0.25) {
    layerElement.classList.add("drop-before");
    layerElement.dataset.dropMode = "before";
  } else if (ratio >= 0.75) {
    layerElement.classList.add("drop-after");
    layerElement.dataset.dropMode = "after";
  } else {
    layerElement.classList.add("drop-child");
    layerElement.dataset.dropMode = "child";
  }
}

function handleLayerDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const layerElement = resolveLayerElement(event);
  if (!layerElement) {
    return;
  }

  const nativeEvent = event.originalEvent || event;
  const draggedId = nativeEvent.dataTransfer?.getData("text/plain") || draggedLayerId;
  const targetId = layerElement.dataset.layerId;
  const dropMode = layerElement.dataset.dropMode || "child";

  if (!draggedId || !targetId || draggedId === targetId) {
    return;
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  const draggedInfo = findLayerWithParentInGroups(character.clothingGroups, draggedId);
  const targetInfo = findLayerWithParentInGroups(character.clothingGroups, targetId);
  if (!draggedInfo || !targetInfo) {
    return;
  }

  const draggedIndex = draggedInfo.parentArray.findIndex((item) => item.id === draggedId);
  const targetIndex = targetInfo.parentArray.findIndex((item) => item.id === targetId);
  const sameParent = draggedInfo.parentArray === targetInfo.parentArray;
  if (sameParent && dropMode === "before" && draggedIndex === targetIndex - 1) {
    return;
  }
  if (sameParent && dropMode === "after" && draggedIndex === targetIndex + 1) {
    return;
  }

  const targetIsDescendant = isDescendantLayer(draggedInfo.layer, targetId);
  if (targetIsDescendant) {
    const targetParent = targetInfo.parentArray;
    const targetIndex = targetParent.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) {
      return;
    }

    targetParent.splice(targetIndex, 1);

    const extracted = extractLayerFromGroups(character.clothingGroups, draggedId);
    if (!extracted) {
      return;
    }

    extracted.parentArray.splice(extracted.index, 0, targetInfo.layer);
    targetInfo.layer.children = targetInfo.layer.children || [];
    targetInfo.layer.children.push(extracted.layer);
  } else {
    const extracted = extractLayerFromGroups(character.clothingGroups, draggedId);
    if (!extracted) {
      return;
    }

    if (dropMode === "child") {
      targetInfo.layer.children = targetInfo.layer.children || [];
      targetInfo.layer.children.push(extracted.layer);
    } else {
      const targetParent = targetInfo.parentArray;
      const targetIndex = targetParent.findIndex((item) => item.id === targetId);
      if (targetIndex === -1) {
        return;
      }

      let insertIndex = dropMode === "after" ? targetIndex + 1 : targetIndex;
      if (extracted.parentArray === targetParent && extracted.index < targetIndex) {
        insertIndex -= 1;
      }

      targetParent.splice(insertIndex, 0, extracted.layer);
    }
  }

  saveAndRender();
}

function handleLayerDragEnd(event) {
  const layerElement = resolveLayerElement(event);
  if (layerElement) {
    layerElement.classList.remove("is-dragging");
    layerElement.dataset.dropMode = "";
  }

  draggedLayerId = null;
  clearDragIndicators();
}

function handleGroupDragOver(event) {
  if (!draggedLayerId) {
    return;
  }

  event.preventDefault();
}

function handleGroupDrop(event) {
  event.preventDefault();
  if (resolveLayerElement(event)) {
    return;
  }

  const groupElement = event.currentTarget.closest(".clothing-group");
  if (!groupElement) {
    return;
  }

  const groupId = groupElement.dataset.groupId;
  const nativeEvent = event.originalEvent || event;
  const draggedId = nativeEvent.dataTransfer?.getData("text/plain") || draggedLayerId;
  if (!draggedId || !groupId) {
    return;
  }

  const character = getActiveCharacter(state);
  if (!character) {
    return;
  }

  const group = findGroup(character, groupId);
  if (!group) {
    return;
  }

  const extracted = extractLayerFromGroups(character.clothingGroups, draggedId);
  if (!extracted) {
    return;
  }

  group.layers.push(extracted.layer);
  saveAndRender();
}

function bindEvents() {
  footerGenerateButton.on("click", runDescriptionsGeneration);
  footerPreviewToggle.on("click", () => {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].preview_image_prompts = !shouldPreviewImagePrompts();
    renderPreviewToggleState();
    saveSettingsDebounced();
  });
  footerGuideToggle.on("click", () => {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].add_prompt_guide = !shouldAddPromptGuide();
    renderGuideToggleState();
    saveSettingsDebounced();
  });
  footerFreeGenerateButton.on("click", generateFreeImage);
  footerPortraitButton.on("click", (event) => generateCharacterImage("portrait", $(event.currentTarget)));
  footerFullBodyButton.on("click", (event) => generateCharacterImage("fullbody", $(event.currentTarget)));
  footerBackgroundButton.on("click", (event) => generateCharacterImage("background", $(event.currentTarget)));
  footerViewerEyesButton.on("click", (event) => generateCharacterImage("viewer-eyes", $(event.currentTarget)));
  footerSceneButton.on("click", (event) => generateCharacterImage("scene", $(event.currentTarget)));
  panelRoot.on("input", handlePanelInput);
  panelRoot.on("click", handlePanelClick);
  floatingRoot.on("click", handlePanelClick);
  managerRoot.on("click", handlePanelClick);
  panelRoot.on("dragstart", handleLayerDragStart);
  panelRoot.on("dragover", handleLayerDragOver);
  panelRoot.on("drop", handleLayerDrop);
  panelRoot.on("dragend", handleLayerDragEnd);
  panelRoot.on("dragover", ".clothing-group__content", handleGroupDragOver);
  panelRoot.on("drop", ".clothing-group__content", handleGroupDrop);

  // Global handler for message action buttons (Set as avatar, Set as background)
  $(document).on("mouseenter", "[data-st-extension-image-action]", (event) => {
    const $button = $(event.currentTarget);
    const $msg = $button.closest(".mes");
    setImageActionButtonsState($msg);
  });
  $(document).on("click", "[data-action='set-as-avatar']", handleSetAsAvatarClick);
  $(document).on("click", "[data-action='set-as-chat-background']", handleSetAsChatBackgroundClick);
}

function initCharacterDetailsPanel() {
  const context = getContext();
  panelContainerRoot = $("#st-extension-right-panel");
  panelRoot = $("#character-details-panel");
  floatingRoot = $("#character-details-floating");
  managerRoot = $("#character-details-manager");
  mobileDrawerToggleButton = $("#st-extension-mobile-drawer-toggle");
  footerGenerateButton = $("#character-details-generate");
  footerFreeGenerateButton = $("#character-details-free-generate");
  footerPortraitButton = $("#character-details-portrait");
  footerFullBodyButton = $("#character-details-fullbody");
  footerPreviewToggle = $("#character-details-preview-prompts");
  footerGuideToggle = $("#character-details-add-guide");
  footerBackgroundButton = $("#character-details-background");
  footerViewerEyesButton = $("#character-details-viewer-eyes");
  footerSceneButton = $("#character-details-scene");
  footerRoot = $(".st-extension-right-panel__footer");

  if (!panelRoot.length) {
    return;
  }

  const reloadState = () => {
    const nextContext = getContext();
    state = loadCharacterDetails(nextContext);
    ensureActiveCharacter(state);
    ensureActiveGroups(state);
    applyViewerFromPersona(state, nextContext);
    applyMainCharacterFromChat(state, nextContext);
    saveCharacterDetails(nextContext, state);
    const descriptionsText = buildDescriptionsText(state);
    nextContext.variables?.local?.set?.("descriptions", descriptionsText);
    renderPreviewToggleState();
    renderGuideToggleState();
    updateFooterImageButtonsVisibility();
    renderPanel();
    
    // Reset processed messages to re-inject buttons after chat change
    resetMessageProcessing();
  };

  const handleNewChatAutoAdd = () => {
    const nextContext = getContext();
    state = loadCharacterDetails(nextContext);
    if (autoAddCharacterFromPersonaIfExists(state, nextContext)) {
      saveAndRender();
      toastr.success("Persona character auto-added for new chat.", "Character Details");
      return;
    }
    reloadState();
  };

  bindEvents();
  initializeMobileDrawer();
  reloadState();

  if (!customFieldRefreshTimer) {
    customFieldRefreshTimer = setInterval(() => {
      const nextContext = getContext();
      refreshCustomFieldInputs(nextContext);
    }, 1000);
  }

  // Start monitoring for new messages and inject action buttons
  const messageActionInterval = setInterval(() => {
    injectMessageActionButtons();
  }, 500);

  if (context.eventSource && context.eventTypes) {
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, reloadState);
    context.eventSource.on(context.eventTypes.CHAT_LOADED, reloadState);
    context.eventSource.on(context.eventTypes.SETTINGS_UPDATED, reloadState);
    if (context.eventTypes.CHAT_CREATED) {
      context.eventSource.on(context.eventTypes.CHAT_CREATED, handleNewChatAutoAdd);
    }
    if (context.eventTypes.GROUP_CHAT_CREATED) {
      context.eventSource.on(context.eventTypes.GROUP_CHAT_CREATED, handleNewChatAutoAdd);
    }
  }
}

function setCharacterDetailsData(data) {
  const context = getContext();
  const previousViewerId = state?.viewerCharacterId || null;
  const previousViewerName = state?.characters?.find((item) => item.id === previousViewerId)?.name;
  const previousMainId = state?.mainCharacterId || null;
  state = data;
  if (previousViewerName) {
    const match = state.characters.find((character) => normalizeName(character.name) === normalizeName(previousViewerName));
    state.viewerCharacterId = match?.id || null;
  }
  // Preserve mainCharacterId
  if (previousMainId && state.characters.find((c) => c.id === previousMainId)) {
    state.mainCharacterId = previousMainId;
  }
  applyViewerFromPersona(state, context);
  applyMainCharacterFromChat(state, context);
  ensureActiveCharacter(state);
  ensureActiveGroups(state);
  saveCharacterDetails(context, state);
  const descriptionsText = buildDescriptionsText(state);
  context.variables?.local?.set?.("descriptions", descriptionsText);
  renderPanel();
}

export { initCharacterDetailsPanel, setCharacterDetailsData };
