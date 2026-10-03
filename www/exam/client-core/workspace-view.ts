import "./workspace-view.css";

interface TreeNode {
    readonly name: string;
    readonly path: string;
    readonly children: Map<string, TreeNode>;
    isFile: boolean;
    priority: number;
}
export interface FileTreeOptions {
    readonly selectedPath: string | null;
    onSelect(path: string): void;
    priority(path: string): number;
}

// Priority propagates to directories so application file groups stay together.
export function renderFileTree(host: HTMLElement, paths: readonly string[], options: FileTreeOptions): void {
    const root = new Map<string, TreeNode>();
    for (const path of paths) {
        let children = root;
        const parts = path.split("/");
        for (let index = 0; index < parts.length; index++) {
            const name = parts[index];
            let node = children.get(name);
            if (node === undefined) {
                node = { name, path: parts.slice(0, index + 1).join("/"), isFile: index === parts.length - 1,
                    children: new Map(), priority: options.priority(path) };
                children.set(name, node);
            }
            node.priority = Math.min(node.priority, options.priority(path));
            children = node.children;
        }
    }
    const render = (nodes: ReadonlyMap<string, TreeNode>, depth: number): HTMLUListElement => {
        const list = document.createElement("ul");
        const sorted = [...nodes.values()].sort((left, right) => left.priority - right.priority
            || Number(left.isFile) - Number(right.isFile) || left.name.localeCompare(right.name));
        for (const node of sorted) {
            const item = document.createElement("li");
            item.classList.add(node.isFile ? "file" : "folder");
            const wrapper = document.createElement("div");
            wrapper.className = "item-content-wrapper";
            wrapper.style.setProperty("--tree-depth", String(depth));
            const icon = document.createElement("span");
            icon.className = "icon";
            if (node.isFile) {
                const button = document.createElement("button");
                button.type = "button";
                button.append(icon, document.createTextNode(node.name));
                wrapper.addEventListener("click", event => { event.stopPropagation(); options.onSelect(node.path); });
                wrapper.append(button);
                item.dataset.path = node.path;
                item.classList.toggle("selected", node.path === options.selectedPath);
            } else wrapper.append(icon, document.createTextNode(node.name));
            item.append(wrapper);
            if (node.children.size > 0) item.append(render(node.children, depth + 1));
            list.append(item);
        }
        return list;
    };
    const list = render(root, 0);
    list.className = "file-tree";
    host.replaceChildren(list);
}
