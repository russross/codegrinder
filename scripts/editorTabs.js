import { nameFromPath } from './directoryTree.js';
const modelist = window.ace.require("ace/ext/modelist");
function createAceEditor(element) {
  const editor = window.ace.edit(element);
  editor.setTheme("ace/theme/monokai");
  // use setOptions method to set several options at once
  editor.setOptions({
    copyWithEmptySelection: true,
    enableBasicAutocompletion: true,
    enableSnippets: true,
    enableLiveAutocompletion: true,
    mergeUndoDeltas: "always",
  });
  return editor;
}
const UNTITLED = "untitled";
class Tab {
  // Private members
  #nameElement;
  #saved;
  #path;
  #ace;
  #readOnly;
  constructor(path = UNTITLED, content = "", readOnly = false) {
    // Set up Tab
    this.element = document.createElement('li');
    this.#nameElement = document.createElement("span");
    this.element.appendChild(this.#nameElement);
    this.closeElement = document.createElement('button');
    this.element.appendChild(this.closeElement);

    // Set up editor
    this.editor = document.createElement("div");
    this.#ace = createAceEditor(this.editor);
    this.content = content;
    this.#ace.getSession().on("change", (delta) => {
      if (delta.action === "insert" || delta.action === "remove") {
        this.saved = false;
        this.changeHandler();
      }
    });
    this.#ace.commands.addCommand({
      name: "saveFile",
      bindKey: { win: "Ctrl-S", mac: "Command-S" },
      exec: (editor) => {
        this.saveHandler();
      }
    });
    this.saveHandler = null;
    this.changeHandler = null;
    // Set magic properties
    this.path = path;
    this.readOnly = readOnly;
    this.saved = true;
  }
  updateSize() {
    this.#ace.resize();
  }
  destroy() {
    this.#ace.destroy();
  }
  get saved() {
    return this.#saved;
  }
  set saved(value) {
    this.#saved = value;
    this.closeElement.innerText = this.saved ? "✖" : "⬤";
  }
  get path() {
    return this.#path;
  }
  set path(value) {
    this.#path = value;
    this.#nameElement.innerText = this.name;
    this.element.title = value;
    const mode = value === UNTITLED ? "ace/mode/javascript" : modelist.getModeForPath(this.path).mode;
    this.#ace.session.setMode(mode);
  }
  get name() {
    return nameFromPath(this.path);
  }
  get content() {
    return this.#ace.getValue();
  }
  set content(value) {
    this.#ace.setValue(value, -1);
  }
  get readOnly() {
    return this.#readOnly;
  }
  set readOnly(value) {
    this.#readOnly = value;
    this.#ace.setReadOnly(value);
  }
  setInteractionDisabled(disabled) {
    this.#ace.setReadOnly(disabled || this.#readOnly);
  }
}
class Tabs {
  constructor(tabbedEditorElement, saveHandler) {
    this.tabbedEditorElement = tabbedEditorElement;
    this.tabListElement = document.createElement("ol");
    this.tabListElement.classList.add("tabs-container");
    this.tabbedEditorElement.appendChild(this.tabListElement);
    this.pathInput = document.createElement("input");
    // This next line to make the browser happy
    this.pathInput.name = "path";
    this.pathInput.classList.add("path-input");
    this.tabbedEditorElement.appendChild(this.pathInput);
    this.editorListElement = document.createElement("div");
    this.editorListElement.classList.add("editor-container");
    this.tabbedEditorElement.appendChild(this.editorListElement);
    this.pathInput.addEventListener("change", () => {
      if (this.pathChangesAllowed && this.tabs[this.currentTab]) {
        this.tabs[this.currentTab].saved = false;
        this.tabs[this.currentTab].path = this.pathInput.value;
      }
    })

    this.saveHandler = saveHandler;
    this.tabs = [];
    this.autoSave = false;
    this.pathChangesAllowed = true;
    this.addNewTab();

    // Attach a listener to the resize event of the editor's container
    let debouncer;
    new ResizeObserver(() => {
      if (debouncer) {
        clearTimeout(debouncer)
      }
      debouncer = setTimeout(() => this.tabs[this.currentTab]?.updateSize(), 500);
    }).observe(this.editorListElement);
  };
  saveTab(tab) {
    if (tab.saved || tab.readOnly) {
      return;
    }
    if (tab.path === UNTITLED) {
      let response = window.prompt("Filename");
      if (!response) {
        return;
      }
      tab.path = response;
    }
    if (!tab.path.startsWith("/")) {
      tab.path = "/" + tab.path;
    }
    tab.saved = true;
    if (tab === this.tabs[this.currentTab]) {
      this.pathInput.value = this.tabs[this.currentTab]?.path;
    }
    this.saveHandler(tab.path, tab.content);
  }
  saveCurrentTab() {
    this.saveTab(this.tabs[this.currentTab]);
  }
  saveAllTabs() {
    for (let tab of this.tabs) {
      this.saveTab(tab);
    }
  }
  setInteractionDisabled(disabled) {
    for (const tab of this.tabs) {
      tab.setInteractionDisabled(disabled);
    }
    this.pathInput.disabled = disabled
      || !this.pathChangesAllowed
      || (this.tabs[this.currentTab]?.readOnly ?? false);
  }
  setPathChangesAllowed(allowed) {
    this.pathChangesAllowed = allowed;
    this.pathInput.disabled = !allowed || (this.tabs[this.currentTab]?.readOnly ?? false);
  }
  closeTab(tab, canCloseLast) {
    const currentTab = this.tabs[this.currentTab];
    const closingCurrent = currentTab === tab;
    this.tabListElement.removeChild(tab.element);
    this.editorListElement.removeChild(tab.editor);
    const index = this.tabs.indexOf(tab);
    tab.destroy();
    this.tabs.splice(index, 1);
    if (closingCurrent) {
      if (!canCloseLast && this.tabs.length === 0) {
        this.addNewTab();
      }
      if (this.tabs.length > 0) {
        this.switchTab(0);
      }
    } else {
      this.switchTab(this.tabs.indexOf(currentTab));
    }
  }
  tryCloseTab(tab, canCloseLast = false) {
    if (!tab.saved) {
      const result = window.confirm(tab.name + " is not saved, close anyway?")
      if (!result) {
        return false;
      }
    }
    this.closeTab(tab, canCloseLast);
    return true;
  }
  addNewTab(tab = new Tab()) {
    tab.saveHandler = () => {
      this.saveTab(tab);
    };
    tab.changeHandler = () => {
      if (this.autoSave) {
        this.saveTab(tab);
      }
    }
    tab.element.addEventListener("click", () => {
      this.switchTab(this.tabs.indexOf(tab));
    })
    tab.closeElement.addEventListener('click', (event) => {
      event.stopPropagation();
      this.tryCloseTab(tab);
    });
    this.tabListElement.appendChild(tab.element);
    this.editorListElement.appendChild(tab.editor);
    this.tabs.push(tab);
    this.switchTab(this.tabs.length - 1);
  };
  switchTab(tabIndex) {
    this.currentTab = tabIndex;
    for (let tab in this.tabs) {
      if (tab == this.currentTab) {
        this.tabs[tab].editor.classList.add("active")
        this.tabs[tab].element.classList.add("active");
      } else {
        this.tabs[tab].editor.classList.remove("active")
        this.tabs[tab].element.classList.remove("active");
      }
    }
    this.tabs[this.currentTab]?.updateSize();
    this.pathInput.value = this.tabs[this.currentTab]?.path;
    this.pathInput.disabled = !this.pathChangesAllowed || (this.tabs[this.currentTab]?.readOnly ?? false);
  };
  addSwitchTab(path, content, readOnly = false) {
    for (let tab in this.tabs) {
      if (this.tabs[tab].path === path) {
        this.switchTab(tab);
        return;
      }
    }
    this.addNewTab(new Tab(path, content, readOnly));
  }
  closeAll() {
    while (this.tabs.length > 0) {
      this.closeTab(this.tabs[0], true);
    }
  }
};
export { Tab, Tabs };
