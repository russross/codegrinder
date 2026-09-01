import { nameFromPath } from "./directoryTree.js";

interface AceMode {
  mode: string;
}

interface AceModeList {
  getModeForPath(path: string): AceMode;
}

type TabHandler = () => void;
type SaveHandler = (path: string, content: string) => void;

const modeList: AceModeList = window.ace.require("ace/ext/modelist");
const untitledPath = "untitled";

function createAceEditor(element: HTMLElement): AceAjax.Editor {
  const editor = window.ace.edit(element);
  editor.setTheme("ace/theme/monokai");
  editor.setOptions({
    copyWithEmptySelection: true,
    enableBasicAutocompletion: true,
    enableSnippets: true,
    enableLiveAutocompletion: true,
    mergeUndoDeltas: "always",
  });
  return editor;
}

class Tab {
  readonly closeElement: HTMLButtonElement;
  readonly editor: HTMLDivElement;
  readonly element: HTMLLIElement;
  changeHandler: TabHandler = () => {};
  saveHandler: TabHandler = () => {};

  readonly #ace: AceAjax.Editor;
  #defaultMode: string;
  readonly #nameElement: HTMLSpanElement;
  #path: string;
  #readOnly: boolean;
  #saved = true;

  constructor(path = untitledPath, content = "", readOnly = false, defaultMode = "ace/mode/text") {
    this.element = document.createElement("li");
    this.#nameElement = document.createElement("span");
    this.element.appendChild(this.#nameElement);
    this.closeElement = document.createElement("button");
    this.element.appendChild(this.closeElement);

    this.editor = document.createElement("div");
    this.#ace = createAceEditor(this.editor);
    this.#defaultMode = defaultMode;
    this.#path = path;
    this.#readOnly = readOnly;
    this.#ace.getSession().on("change", (delta) => {
      if (delta.action === "insert" || delta.action === "remove") {
        this.saved = false;
        this.changeHandler();
      }
    });
    this.#ace.commands.addCommand({
      name: "saveFile",
      bindKey: { win: "Ctrl-S", mac: "Command-S" },
      exec: () => this.saveHandler(),
    });
    this.content = content;
    this.path = path;
    this.readOnly = readOnly;
    this.saved = true;
  }

  updateSize(): void {
    this.#ace.resize();
  }

  destroy(): void {
    this.#ace.destroy();
  }

  get saved(): boolean {
    return this.#saved;
  }

  set saved(value: boolean) {
    this.#saved = value;
    this.closeElement.innerText = value ? "✖" : "⬤";
  }

  get path(): string {
    return this.#path;
  }

  set path(value: string) {
    this.#path = value;
    this.#nameElement.innerText = this.name;
    this.element.title = value;
    const mode = value === untitledPath ? this.#defaultMode : modeList.getModeForPath(value).mode;
    this.#ace.session.setMode(mode);
  }

  get name(): string {
    return nameFromPath(this.path);
  }

  get content(): string {
    return this.#ace.getValue();
  }

  set content(value: string) {
    this.#ace.setValue(value, -1);
  }

  get readOnly(): boolean {
    return this.#readOnly;
  }

  set readOnly(value: boolean) {
    this.#readOnly = value;
    this.#ace.setReadOnly(value);
  }

  setInteractionDisabled(disabled: boolean): void {
    this.#ace.setReadOnly(disabled || this.#readOnly);
  }

  setDefaultMode(mode: string): void {
    this.#defaultMode = mode;
    if (this.path === untitledPath) {
      this.#ace.session.setMode(mode);
    }
  }
}

class Tabs {
  autoSave = false;
  currentTab = 0;
  pathChangesAllowed = true;
  readonly tabs: Tab[] = [];

  private defaultMode = "ace/mode/text";
  private readonly editorListElement: HTMLDivElement;
  private readonly pathInput: HTMLInputElement;
  private readonly saveHandler: SaveHandler;
  private readonly tabListElement: HTMLOListElement;

  constructor(tabbedEditorElement: HTMLElement, saveHandler: SaveHandler) {
    this.tabListElement = document.createElement("ol");
    this.tabListElement.classList.add("tabs-container");
    tabbedEditorElement.appendChild(this.tabListElement);
    this.pathInput = document.createElement("input");
    this.pathInput.name = "path";
    this.pathInput.classList.add("path-input");
    tabbedEditorElement.appendChild(this.pathInput);
    this.editorListElement = document.createElement("div");
    this.editorListElement.classList.add("editor-container");
    tabbedEditorElement.appendChild(this.editorListElement);
    this.pathInput.addEventListener("change", () => {
      const tab = this.tabs[this.currentTab];
      if (this.pathChangesAllowed && tab !== undefined) {
        tab.saved = false;
        tab.path = this.pathInput.value;
      }
    });

    this.saveHandler = saveHandler;
    this.addNewTab();

    let debouncer: ReturnType<typeof setTimeout> | undefined;
    new ResizeObserver(() => {
      if (debouncer !== undefined) {
        clearTimeout(debouncer);
      }
      debouncer = setTimeout(() => this.tabs[this.currentTab]?.updateSize(), 500);
    }).observe(this.editorListElement);
  }

  saveTab(tab: Tab | undefined): void {
    if (tab === undefined || tab.saved || tab.readOnly) {
      return;
    }
    if (tab.path === untitledPath) {
      const response = window.prompt("Filename");
      if (!response) {
        return;
      }
      tab.path = response;
    }
    if (!tab.path.startsWith("/")) {
      tab.path = `/${tab.path}`;
    }
    tab.saved = true;
    if (tab === this.tabs[this.currentTab]) {
      this.pathInput.value = tab.path;
    }
    this.saveHandler(tab.path, tab.content);
  }

  saveCurrentTab(): void {
    this.saveTab(this.tabs[this.currentTab]);
  }

  saveAllTabs(): void {
    for (const tab of this.tabs) {
      this.saveTab(tab);
    }
  }

  setInteractionDisabled(disabled: boolean): void {
    for (const tab of this.tabs) {
      tab.setInteractionDisabled(disabled);
    }
    this.pathInput.disabled = disabled
      || !this.pathChangesAllowed
      || (this.tabs[this.currentTab]?.readOnly ?? false);
  }

  setPathChangesAllowed(allowed: boolean): void {
    this.pathChangesAllowed = allowed;
    this.pathInput.disabled = !allowed || (this.tabs[this.currentTab]?.readOnly ?? false);
  }

  setDefaultMode(mode: string): void {
    this.defaultMode = mode;
    for (const tab of this.tabs) {
      tab.setDefaultMode(mode);
    }
  }

  closeTab(tab: Tab, canCloseLast: boolean): void {
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
      return;
    }
    if (currentTab !== undefined) {
      this.switchTab(this.tabs.indexOf(currentTab));
    }
  }

  tryCloseTab(tab: Tab, canCloseLast = false): boolean {
    if (!tab.saved && !window.confirm(`${tab.name} is not saved, close anyway?`)) {
      return false;
    }
    this.closeTab(tab, canCloseLast);
    return true;
  }

  addNewTab(tab = new Tab(untitledPath, "", false, this.defaultMode)): void {
    tab.saveHandler = () => this.saveTab(tab);
    tab.changeHandler = () => {
      if (this.autoSave) {
        this.saveTab(tab);
      }
    };
    tab.element.addEventListener("click", () => this.switchTab(this.tabs.indexOf(tab)));
    tab.closeElement.addEventListener("click", (event) => {
      event.stopPropagation();
      this.tryCloseTab(tab);
    });
    this.tabListElement.appendChild(tab.element);
    this.editorListElement.appendChild(tab.editor);
    this.tabs.push(tab);
    this.switchTab(this.tabs.length - 1);
  }

  switchTab(tabIndex: number): void {
    this.currentTab = tabIndex;
    for (const [index, tab] of this.tabs.entries()) {
      tab.editor.classList.toggle("active", index === tabIndex);
      tab.element.classList.toggle("active", index === tabIndex);
    }
    const currentTab = this.tabs[this.currentTab];
    currentTab?.updateSize();
    this.pathInput.value = currentTab?.path ?? "";
    this.pathInput.disabled = !this.pathChangesAllowed || (currentTab?.readOnly ?? false);
  }

  addSwitchTab(path: string, content: string, readOnly = false): void {
    const existingIndex = this.tabs.findIndex((tab) => tab.path === path);
    if (existingIndex >= 0) {
      this.switchTab(existingIndex);
      return;
    }
    this.addNewTab(new Tab(path, content, readOnly, this.defaultMode));
  }

  closeAll(): void {
    while (this.tabs.length > 0) {
      const tab = this.tabs[0];
      if (tab === undefined) {
        return;
      }
      this.closeTab(tab, true);
    }
  }
}

export { Tab, Tabs };
export type { SaveHandler, TabHandler };
