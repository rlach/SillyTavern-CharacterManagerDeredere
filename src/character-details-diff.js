function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toBooleanLike(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  return null;
}

function valuesEqual(left, right) {
  const leftBool = toBooleanLike(left);
  const rightBool = toBooleanLike(right);
  if (leftBool !== null && rightBool !== null) {
    return leftBool === rightBool;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

let diffId = 0;

function createItem(data) {
  diffId += 1;
  return {
    id: `diff_${diffId}`,
    accepted: false,
    children: [],
    ...data,
  };
}

function mapByName(items) {
  const map = new Map();
  for (const item of items) {
    map.set(normalizeName(item.name), item);
  }
  return map;
}

function findLayerByName(layers, name) {
  const normalized = normalizeName(name);
  for (const layer of layers) {
    if (normalizeName(layer.name) === normalized) {
      return layer;
    }
    const found = findLayerByName(layer.children || [], name);
    if (found) {
      return found;
    }
  }
  return null;
}

function hasLockedChild(layers) {
  for (const layer of layers) {
    if (layer.locked) {
      return true;
    }
    if (hasLockedChild(layer.children || [])) {
      return true;
    }
  }
  return false;
}

function getChildrenSignature(layers) {
  return layers
    .map((layer) => {
      const childSig = getChildrenSignature(layer.children || []);
      return `${normalizeName(layer.name)}:${childSig}`;
    })
    .sort()
    .join("||");
}

function findLayerByChildrenSignature(layers, signature) {
  for (const layer of layers) {
    const layerSig = getChildrenSignature(layer.children || []);
    if (layerSig === signature) {
      return layer;
    }
  }
  return null;
}

function getGroupLayersSignature(layers) {
  return layers
    .map((layer) => {
      const childSig = getChildrenSignature(layer.children || []);
      return `${normalizeName(layer.name)}:${childSig}`;
    })
    .sort()
    .join("||");
}

function findGroupByLayersSignature(groups, signature) {
  for (const group of groups) {
    const groupSig = getGroupLayersSignature(group.layers || []);
    if (groupSig === signature) {
      return group;
    }
  }
  return null;
}

function diffLayers(currentLayers, proposedLayers, path) {
  const items = [];
  const currentMap = mapByName(currentLayers);
  const proposedMap = mapByName(proposedLayers);
  const matchedCurrent = new Set();

  for (const [key, proposed] of proposedMap) {
    const current = currentMap.get(key);
    if (!current) {
      // No match by name - check if it's a rename by comparing children structure
      const proposedChildrenSig = getChildrenSignature(proposed.children || []);
      const matchByStructure = findLayerByChildrenSignature(currentLayers, proposedChildrenSig);
      
      if (matchByStructure && !matchedCurrent.has(normalizeName(matchByStructure.name)) && !proposedMap.has(normalizeName(matchByStructure.name))) {
        // Found a match by children structure - this is a rename!
        matchedCurrent.add(normalizeName(matchByStructure.name));
        
        const currentLayerPath = path.layer ? `${path.layer} > ${matchByStructure.name}` : matchByStructure.name;
        
        if (!matchByStructure.locked) {
          items.push(
            createItem({
              type: "layer",
              action: "change",
              label: `Layer name: ${matchByStructure.name} -> ${proposed.name}`,
              path: { ...path, layer: currentLayerPath, field: "name" },
              before: matchByStructure.name,
              after: proposed.name,
            })
          );
        }
        
        // Check for state/coverage changes
        const newLayerPath = path.layer ? `${path.layer} > ${proposed.name}` : proposed.name;
        
        if (matchByStructure.state !== proposed.state) {
          items.push(
            createItem({
              type: "layer",
              action: "change",
              label: `Layer state: ${proposed.name}`,
              path: { ...path, layer: newLayerPath, field: "state" },
              before: matchByStructure.state,
              after: proposed.state,
            })
          );
        }

        // Recurse into children
        const childItems = diffLayers(matchByStructure.children || [], proposed.children || [], {
          ...path,
          layer: newLayerPath,
        });
        items.push(...childItems);
      } else {
        // No match at all - this is truly a new layer
        items.push(
          createItem({
            type: "layer",
            action: "add",
            accepted: true,
            label: `Add layer: ${proposed.name || "(unnamed)"}`,
            path,
            payload: proposed,
          })
        );
      }
      continue;
    }

    matchedCurrent.add(key);

    const currentLayerPath = path.layer ? `${path.layer} > ${current.name}` : current.name;

    // Skip changes if layer is locked
    if (current.locked) {
      // Can still recurse to children
      const childItems = diffLayers(current.children || [], proposed.children || [], {
        ...path,
        layer: currentLayerPath,
      });
      items.push(...childItems);
      continue;
    }

    if (current.state !== proposed.state) {
      items.push(
        createItem({
          type: "layer",
          action: "change",
          label: `Layer state: ${current.name}`,
          path: { ...path, layer: currentLayerPath, field: "state" },
          before: current.state,
          after: proposed.state,
        })
      );
    }

    const childItems = diffLayers(current.children || [], proposed.children || [], {
      ...path,
      layer: currentLayerPath,
    });
    items.push(...childItems);
  }

  for (const [key, current] of currentMap) {
    if (!proposedMap.has(key) && !matchedCurrent.has(key)) {
      // Don't allow removal if layer is locked or has locked children
      if (current.locked || hasLockedChild(current.children || [])) {
        continue;
      }
      items.push(
        createItem({
          type: "layer",
          action: "remove",
          label: `Remove layer: ${current.name}`,
          path,
          before: current,
        })
      );
    }
  }

  return items;
}

function collectLayerStateItemsForAddedGroup(layers, path, items = []) {
  for (const layer of Array.isArray(layers) ? layers : []) {
    const layerPath = path.layer ? `${path.layer} > ${layer.name}` : layer.name;

    if (layer.state && layer.state !== "on") {
      items.push(
        createItem({
          type: "layer",
          action: "change",
          accepted: true,
          label: `Layer state: ${layer.name}`,
          path: { ...path, layer: layerPath, field: "state" },
          before: "on",
          after: layer.state,
        })
      );
    }

    if (layer.visibilityOverride === true) {
      items.push(
        createItem({
          type: "layer",
          action: "change",
          accepted: true,
          label: `Layer visibility override: ${layer.name}`,
          path: { ...path, layer: layerPath, field: "visibilityOverride" },
          before: false,
          after: true,
        })
      );
    }

    collectLayerStateItemsForAddedGroup(layer.children || [], { ...path, layer: layerPath }, items);
  }

  return items;
}

function diffGroups(currentGroups, proposedGroups, path, options = {}) {
  const items = [];
  const currentMap = mapByName(currentGroups);
  const proposedMap = mapByName(proposedGroups);
  const matchedCurrent = new Set();
  let hasAddedGroup = false;

  for (const [key, proposed] of proposedMap) {
    const current = currentMap.get(key);
    if (!current) {
      const proposedLayersSig = getGroupLayersSignature(proposed.layers || []);
      const matchByStructure = findGroupByLayersSignature(currentGroups, proposedLayersSig);

      if (matchByStructure && !matchedCurrent.has(normalizeName(matchByStructure.name)) && !proposedMap.has(normalizeName(matchByStructure.name))) {
        matchedCurrent.add(normalizeName(matchByStructure.name));

        if (!matchByStructure.locked) {
          items.push(
            createItem({
              type: "group",
              action: "change",
              label: `Group name: ${matchByStructure.name} -> ${proposed.name}`,
              path: { ...path, group: matchByStructure.name, field: "name" },
              before: matchByStructure.name,
              after: proposed.name,
            })
          );
        }

        items.push(
          ...diffLayers(matchByStructure.layers || [], proposed.layers || [], {
            ...path,
            group: proposed.name,
          })
        );
      } else {
        const addGroupItem =
          createItem({
            type: "group",
            action: "add",
            accepted: true,
            label: `Add group: ${proposed.name || "(unnamed)"}`,
            path,
            payload: proposed,
          });
        items.push(
          addGroupItem
        );

        const explicitVisibilityItems = collectLayerStateItemsForAddedGroup(
          proposed.layers || [],
          {
            ...path,
            group: proposed.name,
          }
        );
        items.push(...explicitVisibilityItems);
        hasAddedGroup = true;
      }
      continue;
    }

    matchedCurrent.add(key);

    if (current.locked) {
      items.push(
        ...diffLayers(current.layers || [], proposed.layers || [], {
          ...path,
          group: current.name,
        })
      );
      continue;
    }

    items.push(
      ...diffLayers(current.layers || [], proposed.layers || [], {
        ...path,
        group: current.name,
      })
    );
  }

  for (const [key, current] of currentMap) {
    if (options.ignoreGroupRemovals === true) {
      continue;
    }

    if (hasAddedGroup) {
      continue;
    }

    if (!proposedMap.has(key) && !matchedCurrent.has(key)) {
      if (current.locked || hasLockedChild(current.layers || [])) {
        continue;
      }
      items.push(
        createItem({
          type: "group",
          action: "remove",
          label: `Remove group: ${current.name}`,
          path,
          before: current,
        })
      );
    }
  }

  return items;
}

function diffCustomFieldValues(currentValues, proposedValues) {
  const items = [];
  const currentMap = currentValues && typeof currentValues === "object" ? currentValues : {};
  const proposedMap = proposedValues && typeof proposedValues === "object" ? proposedValues : {};
  const keys = new Set([...Object.keys(currentMap), ...Object.keys(proposedMap)]);

  for (const key of keys) {
    const hasCurrent = Object.prototype.hasOwnProperty.call(currentMap, key);
    const hasProposed = Object.prototype.hasOwnProperty.call(proposedMap, key);

    if (!hasCurrent && hasProposed) {
      items.push(
        createItem({
          type: "custom-field",
          action: "add",
          accepted: true,
          label: `Add custom field value: ${key}`,
          path: { field: "custom-field-value", customField: key },
          payload: proposedMap[key],
        })
      );
      continue;
    }

    if (hasCurrent && !hasProposed) {
      items.push(
        createItem({
          type: "custom-field",
          action: "remove",
          label: `Remove custom field value: ${key}`,
          path: { field: "custom-field-value", customField: key },
          before: currentMap[key],
        })
      );
      continue;
    }

    if (!valuesEqual(currentMap[key], proposedMap[key])) {
      items.push(
        createItem({
          type: "custom-field",
          action: "change",
          label: `Custom field value: ${key}`,
          path: { field: "custom-field-value", customField: key },
          before: currentMap[key],
          after: proposedMap[key],
        })
      );
    }
  }

  return items;
}

function diffCharacterAvatars(currentValues, proposedValues, currentCharacters, proposedCharacters) {
  const items = [];
  const currentMap = currentValues && typeof currentValues === "object" ? currentValues : {};
  const proposedMap = proposedValues && typeof proposedValues === "object" ? proposedValues : {};

  const allowedNames = new Set([
    ...(Array.isArray(currentCharacters) ? currentCharacters : []).map((character) => String(character?.name || "").trim()),
    ...(Array.isArray(proposedCharacters) ? proposedCharacters : []).map((character) => String(character?.name || "").trim()),
  ].filter(Boolean));

  const keys = new Set([...Object.keys(currentMap), ...Object.keys(proposedMap)]);
  for (const key of keys) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || !allowedNames.has(normalizedKey)) {
      continue;
    }

    const hasCurrent = Object.prototype.hasOwnProperty.call(currentMap, normalizedKey);
    const hasProposed = Object.prototype.hasOwnProperty.call(proposedMap, normalizedKey);

    if (!hasCurrent && hasProposed) {
      items.push(
        createItem({
          type: "avatar",
          action: "add",
          accepted: true,
          label: `Add avatar: ${normalizedKey}`,
          path: { field: "avatar", character: normalizedKey },
          payload: proposedMap[normalizedKey],
        })
      );
      continue;
    }

    if (hasCurrent && !hasProposed) {
      items.push(
        createItem({
          type: "avatar",
          action: "remove",
          label: `Remove avatar: ${normalizedKey}`,
          path: { field: "avatar", character: normalizedKey },
          before: currentMap[normalizedKey],
        })
      );
      continue;
    }

    if (JSON.stringify(currentMap[normalizedKey]) !== JSON.stringify(proposedMap[normalizedKey])) {
      items.push(
        createItem({
          type: "avatar",
          action: "change",
          label: `Avatar: ${normalizedKey}`,
          path: { field: "avatar", character: normalizedKey },
          before: currentMap[normalizedKey],
          after: proposedMap[normalizedKey],
        })
      );
    }
  }

  return items;
}

function buildDiff(current, proposed, options = {}) {
  diffId = 0;
  const items = [];
  const currentMap = mapByName(current.characters || []);
  const proposedMap = mapByName(proposed.characters || []);

  for (const [key, proposedCharacter] of proposedMap) {
    const currentCharacter = currentMap.get(key);
    if (!currentCharacter) {
      items.push(
        createItem({
          type: "character",
          action: "add",
          accepted: true,
          label: `Add character: ${proposedCharacter.name || "(unnamed)"}`,
          payload: proposedCharacter,
        })
      );
      continue;
    }

    const currentPresence = toBooleanLike(currentCharacter.presence);
    const proposedPresence = toBooleanLike(proposedCharacter.presence);
    if (currentPresence !== null && proposedPresence !== null && currentPresence !== proposedPresence) {
      items.push(
        createItem({
          type: "field",
          action: "change",
          label: `Presence: ${currentCharacter.name}`,
          path: { character: currentCharacter.name, field: "presence" },
          before: currentPresence,
          after: proposedPresence,
        })
      );
    }

    if (currentCharacter.appearance !== proposedCharacter.appearance) {
      items.push(
        createItem({
          type: "field",
          action: "change",
          label: `Appearance: ${currentCharacter.name}`,
          path: { character: currentCharacter.name, field: "appearance" },
          before: currentCharacter.appearance,
          after: proposedCharacter.appearance,
        })
      );
    }

    items.push(
      ...diffGroups(currentCharacter.clothingGroups || [], proposedCharacter.clothingGroups || [], {
        character: currentCharacter.name,
      }, options)
    );
  }

  for (const [key, currentCharacter] of currentMap) {
    if (!proposedMap.has(key)) {
      const currentPresence = toBooleanLike(currentCharacter.presence);
      if (currentPresence !== false) {
        items.push(
          createItem({
            type: "field",
            action: "change",
            label: `Presence: ${currentCharacter.name}`,
            path: { character: currentCharacter.name, field: "presence" },
            before: currentPresence === null ? currentCharacter.presence : currentPresence,
            after: false,
          })
        );
      }
    }
  }

  items.push(...diffCustomFieldValues(current.customFieldValues, proposed.customFieldValues));
  items.push(...diffCharacterAvatars(current.avatars, proposed.avatars, current.characters, proposed.characters));

  return { items: reconcileRedundantLayerAddRemove(items) };
}

function buildLayerSignature(layer) {
  if (!layer || typeof layer !== "object") {
    return "";
  }

  const children = Array.isArray(layer.children)
    ? layer.children.map((child) => buildLayerSignature(child)).sort().join("||")
    : "";

  return [
    normalizeName(layer.name),
    String(layer.state || "on"),
    children,
  ].join("::");
}

function buildLayerContextKey(item) {
  const character = normalizeName(item.path?.character || "");
  const group = normalizeName(item.path?.group || "");
  const parentLayer = normalizeName(item.path?.layer || "");
  return `${character}::${group}::${parentLayer}`;
}

function reconcileRedundantLayerAddRemove(items) {
  const addBuckets = new Map();
  const removeBuckets = new Map();

  for (const item of items) {
    if (item.type !== "layer") {
      continue;
    }

    if (item.action === "add") {
      const signature = buildLayerSignature(item.payload);
      const key = `${buildLayerContextKey(item)}::${signature}`;
      if (!addBuckets.has(key)) {
        addBuckets.set(key, []);
      }
      addBuckets.get(key).push(item.id);
    }

    if (item.action === "remove") {
      const signature = buildLayerSignature(item.before);
      const key = `${buildLayerContextKey(item)}::${signature}`;
      if (!removeBuckets.has(key)) {
        removeBuckets.set(key, []);
      }
      removeBuckets.get(key).push(item.id);
    }
  }

  const toDrop = new Set();
  for (const [key, addIds] of addBuckets) {
    const removeIds = removeBuckets.get(key) || [];
    const count = Math.min(addIds.length, removeIds.length);
    for (let index = 0; index < count; index += 1) {
      toDrop.add(addIds[index]);
      toDrop.add(removeIds[index]);
    }
  }

  if (toDrop.size === 0) {
    return items;
  }

  return items.filter((item) => !toDrop.has(item.id));
}

function findCharacter(data, name) {
  const key = normalizeName(name);
  return data.characters.find((character) => normalizeName(character.name) === key) || null;
}

function findGroup(character, name) {
  const key = normalizeName(name);
  return (character.clothingGroups || []).find((group) => normalizeName(group.name) === key) || null;
}

function findLayerByPath(layers, path) {
  if (!path || !path.length) {
    return null;
  }

  const [head, ...rest] = path;
  const match = layers.find((layer) => normalizeName(layer.name) === normalizeName(head));
  if (!match) {
    return null;
  }

  if (rest.length === 0) {
    return match;
  }

  return findLayerByPath(match.children || [], rest);
}

function removeByName(list, name) {
  const key = normalizeName(name);
  const index = list.findIndex((item) => normalizeName(item.name) === key);
  if (index !== -1) {
    list.splice(index, 1);
    return true;
  }

  return false;
}

function applyChange(data, item) {
  if (item.action === "add") {
    if (item.type === "avatar") {
      const characterName = String(item.path?.character || "").trim();
      if (!characterName) {
        return;
      }

      data.avatars = data.avatars && typeof data.avatars === "object"
        ? data.avatars
        : {};
      data.avatars[characterName] = clone(item.payload);
      return;
    }

    if (item.type === "custom-field") {
      const varName = item.path?.customField;
      if (!varName) {
        return;
      }

      data.customFieldValues = data.customFieldValues && typeof data.customFieldValues === "object"
        ? data.customFieldValues
        : {};
      data.customFieldValues[varName] = clone(item.payload);
      return;
    }

    if (item.type === "character") {
      data.characters.push(clone(item.payload));
      return;
    }

    const character = findCharacter(data, item.path?.character);
    if (!character) {
      return;
    }

    if (item.type === "group") {
      character.clothingGroups = character.clothingGroups || [];
      const nextGroup = clone(item.payload);
      character.clothingGroups.push(nextGroup);
      if (nextGroup?.id) {
        character.activeGroupId = nextGroup.id;
      } else {
        const inserted = findGroup(character, nextGroup?.name);
        character.activeGroupId = inserted?.id || character.activeGroupId || null;
      }
      return;
    }

    if (item.type === "layer") {
      const group = findGroup(character, item.path?.group);
      if (!group) {
        return;
      }

      if (!item.path?.layer) {
        group.layers = group.layers || [];
        group.layers.push(clone(item.payload));
        return;
      }

      const parent = findLayerByPath(group.layers || [], item.path.layer.split(" > "));
      if (!parent) {
        return;
      }

      parent.children = parent.children || [];
      parent.children.push(clone(item.payload));
    }

    return;
  }

  if (item.action === "remove") {
    if (item.type === "avatar") {
      const characterName = String(item.path?.character || "").trim();
      if (!characterName) {
        return;
      }

      data.avatars = data.avatars && typeof data.avatars === "object"
        ? data.avatars
        : {};
      delete data.avatars[characterName];
      return;
    }

    if (item.type === "custom-field") {
      const varName = item.path?.customField;
      if (!varName) {
        return;
      }

      data.customFieldValues = data.customFieldValues && typeof data.customFieldValues === "object"
        ? data.customFieldValues
        : {};
      delete data.customFieldValues[varName];
      return;
    }

    if (item.type === "character") {
      removeByName(data.characters, item.before?.name || item.path?.character);
      return;
    }

    const character = findCharacter(data, item.path?.character);
    if (!character) {
      return;
    }

    if (item.type === "group") {
      removeByName(character.clothingGroups || [], item.before?.name || item.path?.group);
      return;
    }

    if (item.type === "layer") {
      const group = findGroup(character, item.path?.group);
      if (!group) {
        return;
      }

      removeByName(group.layers || [], item.before?.name || item.path?.layer);
      return;
    }
  }

  if (item.action === "change") {
    if (item.type === "avatar") {
      const characterName = String(item.path?.character || "").trim();
      if (!characterName) {
        return;
      }

      data.avatars = data.avatars && typeof data.avatars === "object"
        ? data.avatars
        : {};
      data.avatars[characterName] = item.after;
      return;
    }

    if (item.type === "custom-field") {
      const varName = item.path?.customField;
      if (!varName) {
        return;
      }

      data.customFieldValues = data.customFieldValues && typeof data.customFieldValues === "object"
        ? data.customFieldValues
        : {};
      data.customFieldValues[varName] = item.after;
      return;
    }

    const character = findCharacter(data, item.path?.character);
    if (!character) {
      return;
    }

    if (item.path?.field === "presence") {
      const normalizedPresence = toBooleanLike(item.after);
      character.presence = normalizedPresence === null ? item.after : normalizedPresence;
      return;
    }

    if (item.path?.field === "appearance") {
      character.appearance = item.after;
      return;
    }

    if (item.path?.field === "name" && item.type === "group") {
      const group = findGroup(character, item.before);
      if (group) {
        group.name = item.after;
      }
      return;
    }

    if (item.path?.field === "name" && item.type === "layer") {
      const group = findGroup(character, item.path?.group);
      if (!group) {
        return;
      }

      const layerPath = item.path?.layer ? item.path.layer.split(" > ") : [];
      const layer = findLayerByPath(group.layers || [], layerPath);
      if (!layer) {
        return;
      }

      layer.name = item.after;
      return;
    }

    if (item.path?.field === "state" || item.path?.field === "coverage") {
      const group = findGroup(character, item.path?.group);
      if (!group) {
        return;
      }

      const layerPath = item.path?.layer ? item.path.layer.split(" > ") : [];
      const layer = findLayerByPath(group.layers || [], layerPath);
      if (!layer) {
        return;
      }

      layer[item.path.field] = item.after;
      return;
    }

    if (item.path?.field === "visibilityOverride") {
      const group = findGroup(character, item.path?.group);
      if (!group) {
        return;
      }

      const layerPath = item.path?.layer ? item.path.layer.split(" > ") : [];
      const layer = findLayerByPath(group.layers || [], layerPath);
      if (!layer) {
        return;
      }

      layer.visibilityOverride = Boolean(item.after);
    }
  }

}

function applyAcceptedChanges(current, diff) {
  const data = clone(current);
  const removals = diff.items.filter((item) => item.accepted && item.action === "remove");
  const additions = diff.items.filter((item) => item.accepted && item.action === "add");
  const changes = diff.items.filter((item) => item.accepted && item.action === "change");

  for (const item of removals) {
    applyChange(data, item);
  }

  for (const item of additions) {
    applyChange(data, item);
  }

  for (const item of changes) {
    applyChange(data, item);
  }

  return data;
}

export { buildDiff, applyAcceptedChanges };
