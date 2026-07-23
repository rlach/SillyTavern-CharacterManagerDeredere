export async function showModItemEditorPopup(config = {}, deps = {}) {
  const {
    title,
    okButton,
    shortnameValue = "",
    detailsValue = "",
    initialPosition,
    initialAfterCharName = "",
    includeGroupName = false,
    initialGroupName = "",
    includeModSettings = true,
    initialCharacterMod = false,
    initialLocalState = false,
    initialMultiselect = false,
    initialImageTypes = {},
    allowDelete = false,
    allowConvertToGroup = false,
  } = config;

  const {
    Popup,
    POPUP_TYPE,
    escapeHtml,
    normalizeRequiredModShortname,
    normalizeModPosition,
    MOD_POSITION_DEFINITIONS,
    MOD_IMAGE_TYPE_DEFINITIONS,
    normalizeModImageTypes,
    toastr,
  } = deps;

  let nextGroupName = String(initialGroupName || "").trim();
  let nextShortname = String(shortnameValue || "").trim();
  let nextDetails = String(detailsValue || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  let nextPosition = normalizeModPosition(initialPosition);
  let nextAfterCharName = String(initialAfterCharName || "").trim();
  let nextCharacterMod = initialCharacterMod === true;
  let nextLocalState = initialLocalState === true;
  let nextMultiselect = initialMultiselect === true;
  let nextImageTypes = normalizeModImageTypes(initialImageTypes);

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
        id: "st_extension_mod_after_char_name",
        label: "After character (used only for After char X)",
        type: "text",
        defaultState: nextAfterCharName,
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

      if (includeGroupName) {
        customInputs.push({
          id: "st_extension_mod_multiselect",
          label: "Is multiselect",
          type: "checkbox",
          defaultState: nextMultiselect,
        });
      }
    }

    for (const definition of MOD_IMAGE_TYPE_DEFINITIONS) {
      customInputs.push({
        id: `st_extension_mod_image_type_${definition.key}`,
        label: definition.label,
        type: "checkbox",
        defaultState: nextImageTypes[definition.key] !== false,
      });
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
        customButtons: [
          ...(allowDelete
            ? [
                {
                  text: "Delete",
                  result: 2,
                  classes: ["mod-editor__delete-button"],
                },
              ]
            : []),
          ...(allowConvertToGroup
            ? [{ text: "Convert to group", result: 3 }]
            : []),
        ],
        onOpen: (openedPopup) => {
          const input = openedPopup?.dlg?.querySelector(
            "#st_extension_mod_position",
          );
          if (!(input instanceof HTMLInputElement)) {
            return;
          }

          const positionWrap = document.createElement("div");
          positionWrap.classList.add(
            "mod-editor__position-wrap",
            "mod-item__position-wrap",
          );
          const valueInput = document.createElement("input");
          valueInput.type = "hidden";
          valueInput.id = input.id;
          valueInput.value = normalizeModPosition(nextPosition);

          const trigger = document.createElement("button");
          trigger.type = "button";
          trigger.classList.add("menu_button", "mod-editor__position-trigger");
          const menu = document.createElement("div");
          menu.classList.add(
            "mod-item__position-popup",
            "mod-editor__position-popup",
          );

          const setSelectedPosition = (position) => {
            const selected =
              MOD_POSITION_DEFINITIONS.find(
                (definition) => definition.key === position,
              ) || MOD_POSITION_DEFINITIONS[0];
            valueInput.value = selected.key;
            trigger.innerHTML = `<i class="fa-solid ${selected.icon}"></i><span>${selected.label}</span><i class="fa-solid fa-chevron-down"></i>`;
            menu
              .querySelectorAll(".mod-item__position-option")
              .forEach((option) => {
                option.classList.toggle(
                  "is-active",
                  option.dataset.position === selected.key,
                );
              });
          };

          for (const definition of MOD_POSITION_DEFINITIONS) {
            const option = document.createElement("button");
            option.type = "button";
            option.classList.add("mod-item__position-option");
            option.dataset.position = definition.key;
            option.innerHTML = `<i class="fa-solid ${definition.icon}"></i><span>${definition.label}</span>`;
            option.addEventListener("click", () => {
              setSelectedPosition(definition.key);
              menu.classList.remove("is-open");
            });
            menu.append(option);
          }

          trigger.addEventListener("click", () => {
            menu.classList.toggle("is-open");
          });
          setSelectedPosition(valueInput.value);
          positionWrap.append(valueInput, trigger, menu);
          input.replaceWith(positionWrap);

          const imageTypesHeading = document.createElement("div");
          imageTypesHeading.classList.add("mod-editor__image-types-heading");
          imageTypesHeading.textContent = "Use mod in";
          const firstImageTypeLabel = openedPopup.dlg
            .querySelector(
              `#st_extension_mod_image_type_${MOD_IMAGE_TYPE_DEFINITIONS[0]?.key}`,
            )
            ?.closest("label");
          if (firstImageTypeLabel) {
            firstImageTypeLabel.before(imageTypesHeading);
          } else {
            openedPopup.inputControls.append(imageTypesHeading);
          }

          for (const definition of MOD_IMAGE_TYPE_DEFINITIONS) {
            const checkbox = openedPopup.dlg.querySelector(
              `#st_extension_mod_image_type_${definition.key}`,
            );
            const label = checkbox?.closest("label");
            if (!checkbox || !label) {
              continue;
            }

            label.classList.add("mod-editor__image-type");
            label.title = definition.label;
            const text = label.querySelector("span");
            if (text) {
              text.innerHTML = `<i class="fa-solid ${definition.icon}"></i>`;
            }
          }
        },
      },
    );

    await popup.show();
    if (popup.result === 2) {
      return { action: "delete" };
    }
    if (popup.result === 3) {
      return { action: "convert-to-group" };
    }
    if (popup.result !== 1) {
      return null;
    }

    const groupNameInput = includeGroupName
      ? normalizeRequiredModShortname(
          popup.inputResults?.get("st_extension_mod_group_name"),
        )
      : "";
    const shortnameInput = normalizeRequiredModShortname(
      popup.inputResults?.get("st_extension_mod_shortname"),
    );
    const positionInput = normalizeModPosition(
      popup.inputResults?.get("st_extension_mod_position"),
    );
    const afterCharNameInput = String(
      popup.inputResults?.get("st_extension_mod_after_char_name") || "",
    ).trim();
    const detailsInput = String(
      popup.inputResults?.get("st_extension_mod_details") || "",
    )
      .replace(/\r\n?/g, "\n")
      .trim();
    const characterModInput = includeModSettings
      ? Boolean(popup.inputResults?.get("st_extension_mod_character_mod"))
      : false;
    const localStateInput = includeModSettings
      ? Boolean(popup.inputResults?.get("st_extension_mod_local_state"))
      : false;
    const multiselectInput =
      includeGroupName && includeModSettings
        ? Boolean(popup.inputResults?.get("st_extension_mod_multiselect"))
        : false;
    const imageTypesInput = Object.fromEntries(
      MOD_IMAGE_TYPE_DEFINITIONS.map((definition) => [
        definition.key,
        Boolean(
          popup.inputResults?.get(
            `st_extension_mod_image_type_${definition.key}`,
          ),
        ),
      ]),
    );

    if (includeGroupName && !groupNameInput) {
      toastr.warning("Group name is required.", "Character Details");
      nextPosition = positionInput;
      nextAfterCharName = afterCharNameInput;
      nextShortname = shortnameInput;
      nextDetails = detailsInput;
      nextCharacterMod = characterModInput;
      nextLocalState = localStateInput;
      nextMultiselect = multiselectInput;
      nextImageTypes = imageTypesInput;
      continue;
    }

    if (!shortnameInput) {
      toastr.warning("Shortname is required.", "Character Details");
      nextGroupName = groupNameInput;
      nextPosition = positionInput;
      nextAfterCharName = afterCharNameInput;
      nextDetails = detailsInput;
      nextCharacterMod = characterModInput;
      nextLocalState = localStateInput;
      nextMultiselect = multiselectInput;
      nextImageTypes = imageTypesInput;
      continue;
    }

    return {
      groupName: groupNameInput,
      shortname: shortnameInput,
      position: positionInput,
      afterCharName: afterCharNameInput,
      fullContent: detailsInput,
      characterMod: characterModInput,
      localState: localStateInput,
      multiselect: multiselectInput,
      imageTypes: imageTypesInput,
    };
  }
}
