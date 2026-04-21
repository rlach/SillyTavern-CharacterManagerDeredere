/**
 * Message Action Buttons Module
 * Handles "Set as Avatar" and "Set as Chat Background" buttons in chat messages.
 */

import { applyBackgroundFromImage } from "./background-manager.js";

// These will be set during initialization
let messageActionButtonsInitialized = false;
let checkInterval = null;

// Injected dependencies
let deps = {
  getContext: null,
  getActiveCharacter: null,  // Will be bound to state by caller
  maybeCropAvatarDataUrl: null,
  getAvatarKeyForCharacterName: null,
  readAvatarMap: null,
  writeAvatarMap: null,
  renderFloatingCharacters: null,
  renderManagerPanel: null,
};

/**
 * Reset the processed flag from all messages to force re-checking.
 * Used when re-rendering or after chat changes.
 */
export function resetMessageProcessing() {
  // Remove the processed flag from all messages so they get re-checked
  const chatContainer = jQuery("#chat");
  if (chatContainer.length) {
    chatContainer.find(".mes[data-st-extension-processed]").removeAttr("data-st-extension-processed");
  }
}

/**
 * Find the image element within a message.
 * Prefers .mes_img with valid src/data-src attributes.
 * @param {jQuery} $msg - The message element
 * @returns {jQuery} - The image element, or empty jQuery object if not found
 */
export function findMessageImageElement($msg) {
  if (!$msg?.length) {
    return jQuery();
  }

  const imageElement = $msg
    .find(".mes_img")
    .filter((index, element) => {
      const $element = jQuery(element);
      const source = String($element.attr("src") || $element.attr("data-src") || "").trim();
      return Boolean(source);
    })
    .last();

  if (imageElement.length) {
    return imageElement;
  }

  return $msg.find(".mes_img").last();
}

/**
 * Update the disabled state of action buttons based on image presence.
 * @param {jQuery} $msg - The message element
 */
export function setImageActionButtonsState($msg) {
  if (!$msg?.length) {
    return;
  }

  const hasImage = findMessageImageElement($msg).length > 0;
  const buttons = $msg.find("[data-st-extension-image-action]");
  if (!buttons.length) {
    return;
  }

  buttons.each((index, button) => {
    const $button = jQuery(button);
    $button.toggleClass("disabled", !hasImage);
    $button.css("opacity", hasImage ? "" : "0.3");
    $button.css("cursor", hasImage ? "" : "not-allowed");
    $button.attr("aria-disabled", hasImage ? "false" : "true");
  });
}

/**
 * Inject action buttons into all messages in the chat.
 * Checks for existing buttons to avoid duplicate injection.
 */
export function injectMessageActionButtons() {
  const chatContainer = jQuery("#chat");
  if (!chatContainer.length) {
    return;
  }
  
  const messages = chatContainer.find(".mes");
  
  if (messages.length === 0) {
    return;
  }
  
  messages.each((index, msgElement) => {
    const $msg = jQuery(msgElement);
    
    // Find or create extraMesButtons container
    let actionsContainer = $msg.find(".extraMesButtons");
    if (!actionsContainer.length) {
      actionsContainer = jQuery('<div class="extraMesButtons"></div>');
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
      const avatarBtn = jQuery(
        `<div class="mes_button mes_button_icon" data-action="set-as-avatar" data-st-extension-image-action="true" 
          title="Set as character avatar" tabindex="0" role="button">
          <i class="fa-solid fa-user-circle"></i>
        </div>`
      );
      
      // Add "Set as background" button
      const bgBtn = jQuery(
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

/**
 * Handle "Set as Avatar" button click.
 * Extracts image from message, optionally crops it, and saves to avatar map.
 * @param {Event} event - The click event
 */
export async function handleSetAsAvatarClick(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const $btn = jQuery(event.target).closest("[data-action='set-as-avatar']");
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

  const context = deps.getContext?.();
  const activeCharacter = deps.getActiveCharacter?.();
  if (!activeCharacter) {
    toastr.warning("Select a character first.", "Character Details");
    return;
  }

  dataUrl = await deps.maybeCropAvatarDataUrl?.(dataUrl, activeCharacter.name);
  if (!dataUrl) {
    return;
  }
  
  const key = deps.getAvatarKeyForCharacterName?.(activeCharacter.name);
  if (!key) {
    toastr.warning("Character name required.", "Character Details");
    return;
  }
  
  const avatarMap = deps.readAvatarMap?.(context);
  if (!avatarMap) {
    toastr.error("Failed to read avatar map.", "Character Details");
    return;
  }
  
  avatarMap[key] = dataUrl;
  deps.writeAvatarMap?.(context, avatarMap);
  
  deps.renderFloatingCharacters?.();
  deps.renderManagerPanel?.();
  
  toastr.success(`Avatar set for ${activeCharacter.name}.`, "Character Details");
}

/**
 * Handle "Set as Chat Background" button click.
 * Extracts image from message and applies it as chat background.
 * @param {Event} event - The click event
 */
export async function handleSetAsChatBackgroundClick(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const $btn = jQuery(event.target).closest("[data-action='set-as-chat-background']");
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
    await applyBackgroundFromImage(imageSrc, deps.getActiveCharacter);
    toastr.success("Chat background updated.", "Character Details");
  } catch (error) {
    console.error("[ST Extension] Error setting background:", error);
    toastr.error("Failed to set background: " + error?.message, "Character Details");
  }
}

/**
 * Set dependencies for the action buttons module.
 * Should be called once during extension initialization.
 * @param {Object} dependencies - Object containing required functions and state
 */
export function setActionButtonsDependencies(dependencies) {
  deps = { ...deps, ...dependencies };
}

/**
 * Initialize message action buttons.
 * Sets up periodic injection and event delegation for button clicks.
 * Should be called once during extension initialization.
 * @param {number} [intervalMs=500] - Interval in milliseconds for checking new messages
 */
export function initMessageActionButtons(intervalMs = 500) {
  if (messageActionButtonsInitialized) {
    return;
  }

  // Initial injection
  injectMessageActionButtons();
  resetMessageProcessing();

  // Set up periodic re-injection (for new messages added to chat)
  if (checkInterval) {
    clearInterval(checkInterval);
  }
  
  checkInterval = setInterval(() => {
    injectMessageActionButtons();
  }, intervalMs);

  // Set up event delegation for button clicks
  const chatContainer = jQuery("#chat");
  if (chatContainer.length) {
    // Event delegation: attach handlers to parent container
    chatContainer.off("click.st-extension-image-actions");
    chatContainer.on("click.st-extension-image-actions", "[data-action='set-as-avatar']", handleSetAsAvatarClick);
    chatContainer.on("click.st-extension-image-actions", "[data-action='set-as-chat-background']", handleSetAsChatBackgroundClick);
  }

  messageActionButtonsInitialized = true;
  console.log("[ST Extension] Message action buttons initialized");
}

/**
 * Cleanup message action buttons.
 * Should be called when disabling the extension.
 */
export function cleanupMessageActionButtons() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }

  const chatContainer = jQuery("#chat");
  if (chatContainer.length) {
    chatContainer.off("click.st-extension-image-actions");
  }

  messageActionButtonsInitialized = false;
  console.log("[ST Extension] Message action buttons cleaned up");
}
