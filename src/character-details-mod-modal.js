export async function showModItemEditorPopup(config = {}, deps = {}) {
  const {
    title,
    okButton,
    shortnameValue = "",
    detailsValue = "",
    initialPosition,
    includeGroupName = false,
    initialGroupName = "",
    includeModSettings = true,
    initialCharacterMod = false,
    initialLocalState = false,
  } = config;

  const {
    Popup,
    POPUP_TYPE,
    escapeHtml,
    normalizeRequiredModShortname,
    normalizeModPosition,
    MOD_POSITION_DEFINITIONS,
    toastr,
  } = deps;

  let nextGroupName = String(initialGroupName || "").trim();
  let nextShortname = String(shortnameValue || "").trim();
  let nextDetails = String(detailsValue || "").replace(/\r\n?/g, "\n").trim();
  let nextPosition = normalizeModPosition(initialPosition);
  let nextCharacterMod = initialCharacterMod === true;
  let nextLocalState = initialLocalState === true;

  while (true) {
    const customInputs = [];

    if (includeGroupName) {
      customInputs.push({
        id: "st_extension_mod_group_name",
        label: "Group name",
        type: "text",
        defaultState: nextGroupName,
      });
    }

    customInputs.push(
      {
        id: "st_extension_mod_shortname",
        label: "Shortname",
        type: "text",
        defaultState: nextShortname,
      },
      {
        id: "st_extension_mod_position",
        label: "Position",
        type: "text",
        defaultState: nextPosition,
      },
      {
        id: "st_extension_mod_details",
        label: "Details",
        type: "textarea",
        rows: 8,
        defaultState: nextDetails,
      },
    );

    if (includeModSettings) {
      customInputs.push(
        {
          id: "st_extension_mod_character_mod",
          label: "Character mod (bind to current character-card chat)",
          type: "checkbox",
          defaultState: nextCharacterMod,
        },
        {
          id: "st_extension_mod_local_state",
          label: "Local state (unchecked = global state)",
          type: "checkbox",
          defaultState: nextLocalState,
        },
      );
    }

    const popup = new Popup(
      `<h3>${escapeHtml(title || "Edit mod")}</h3>`,
      POPUP_TYPE.TEXT,
      "",
      {
        okButton: okButton || "Save",
        cancelButton: "Cancel",
        leftAlign: true,
        customInputs,
        onOpen: (openedPopup) => {
          const input = openedPopup?.dlg?.querySelector("#st_extension_mod_position");
          if (!(input instanceof HTMLInputElement)) {
            return;
          }

          const select = document.createElement("select");
          select.classList.add("text_pole", "result-control");
          select.id = input.id;
          select.title = "Mod type";

          for (const definition of MOD_POSITION_DEFINITIONS) {
            const option = document.createElement("option");
            option.value = definition.key;
            option.textContent = definition.label;
            option.selected = normalizeModPosition(nextPosition) === definition.key;
            select.append(option);
          }

          input.replaceWith(select);
        },
      },
    );

    await popup.show();
    if (popup.result !== 1) {
      return null;
    }

    const groupNameInput = includeGroupName
      ? normalizeRequiredModShortname(popup.inputResults?.get("st_extension_mod_group_name"))
      : "";
    const shortnameInput = normalizeRequiredModShortname(popup.inputResults?.get("st_extension_mod_shortname"));
    const positionInput = normalizeModPosition(popup.inputResults?.get("st_extension_mod_position"));
    const detailsInput = String(popup.inputResults?.get("st_extension_mod_details") || "")
      .replace(/\r\n?/g, "\n")
      .trim();
    const characterModInput = includeModSettings
      ? Boolean(popup.inputResults?.get("st_extension_mod_character_mod"))
      : false;
    const localStateInput = includeModSettings
      ? Boolean(popup.inputResults?.get("st_extension_mod_local_state"))
      : false;

    if (includeGroupName && !groupNameInput) {
      toastr.warning("Group name is required.", "Character Details");
      nextPosition = positionInput;
      nextShortname = shortnameInput;
      nextDetails = detailsInput;
      nextCharacterMod = characterModInput;
      nextLocalState = localStateInput;
      continue;
    }

    if (!shortnameInput) {
      toastr.warning("Shortname is required.", "Character Details");
      nextGroupName = groupNameInput;
      nextPosition = positionInput;
      nextDetails = detailsInput;
      nextCharacterMod = characterModInput;
      nextLocalState = localStateInput;
      continue;
    }

    return {
      groupName: groupNameInput,
      shortname: shortnameInput,
      position: positionInput,
      fullContent: detailsInput,
      characterMod: characterModInput,
      localState: localStateInput,
    };
  }
}
