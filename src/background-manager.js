/**
 * Background Manager Module
 * Handles background image upload, storage, and application logic.
 * Shared utility for action buttons and other UI components that need to set chat backgrounds.
 */

import { getContext as getExtensionContext } from "../../../../extensions.js";

function resolveContext() {
  if (typeof getExtensionContext === "function") {
    const context = getExtensionContext();
    if (context) {
      return context;
    }
  }

  return window.getContext?.() || null;
}

/**
 * Normalize a background image path string.
 * Handles CSS url() syntax, absolute/relative URLs, and encoding.
 * @param {string} value - The background path to normalize
 * @returns {string} - Normalized path or empty string
 */
export function normalizeBackgroundPath(value) {
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

/**
 * Check if a background image already exists in the chat's background list.
 * @param {string} imageUrl - The image URL to check
 * @param {Array} chatBackgrounds - Array of existing background paths
 * @returns {string|null} - The existing path if found, null otherwise
 */
export function findExistingChatBackgroundPath(imageUrl, chatBackgrounds) {
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

/**
 * Check if an image URL is already persisted in /user/images/.
 * If so, no upload is needed.
 * @param {string} imageUrl - The image URL to check
 * @returns {string|null} - The persisted path if found, null otherwise
 */
export function getPersistedImagePathFromUrl(imageUrl) {
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

/**
 * Update chat metadata with background path and save to context.
 * Adds the path to the chat_backgrounds list and sets it as custom_background.
 * @param {string} imagePath - The persisted image path to set
 * @throws {Error} - If chatMetadata or saveMetadata is not available
 */
export async function setChatBackgroundMetadata(imagePath) {
  const context = resolveContext();
  if (!context) {
    throw new Error("Extension context is not available");
  }

  if (!context.chatMetadata || typeof context.chatMetadata !== "object") {
    context.chatMetadata = {};
  }

  const chatMetadata = context.chatMetadata;
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

/**
 * Upload a background image to the server.
 * Fetches image from URL (or uses data URL), converts to base64, and uploads via /api/images/upload.
 * @param {string} imageUrl - The image URL (http, data URL, or relative path)
 * @param {Function} [getActiveCharacterFn] - Optional function to get active character for fallback
 * @returns {Promise<string|null>} - The server-persisted image path, or null if upload failed
 * @throws {Error} - On upload or conversion errors
 */
export async function uploadBackgroundToServer(imageUrl, getActiveCharacterFn = null) {
  try {
    console.log("[ST Extension] Starting background upload for:", imageUrl);
    
    // Use SillyTavern extension context API
    const context = resolveContext();
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

    // Fallback: use currently active extension character (if getter provided)
    if (!characterName && typeof getActiveCharacterFn === 'function') {
      const activeCharacter = getActiveCharacterFn();
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

/**
 * Apply a background image to the current chat.
 * Intelligently handles upload: skips if image is already persisted or in chat backgrounds.
 * Updates metadata and applies CSS to #bg1 element.
 * @param {string} imageUrl - The image URL to apply (http, data URL, or relative path)
 * @param {Function} [getActiveCharacterFn] - Optional function to get active character for upload fallback
 * @throws {Error} - If upload fails or no image path is returned
 */
export async function applyBackgroundFromImage(imageUrl, getActiveCharacterFn = null) {
  console.log("[ST Extension] Applying background image...", imageUrl);
  
  try {
    const context = resolveContext();
    const chatMetadata = context?.chatMetadata;
    const LIST_METADATA_KEY = "chat_backgrounds";

    // Optimization 1: if source image is already persisted in /user/images, skip upload
    const persistedImagePath = getPersistedImagePathFromUrl(imageUrl);

    // Optimization 2: if image already exists in chat backgrounds, skip upload
    const existingPath = findExistingChatBackgroundPath(imageUrl, chatMetadata?.[LIST_METADATA_KEY]);
    const imagePath = existingPath || persistedImagePath || await uploadBackgroundToServer(imageUrl, getActiveCharacterFn);

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
