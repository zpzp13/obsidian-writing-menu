export interface ExportSource { path: string; basename: string }
export interface ExportTreeNode { path: string; name: string; folder: boolean; children: ExportTreeNode[]; files: string[] }
export function isInExportFolder(path: string, root: string): boolean { return !root || path.startsWith(root + '/'); }
export function commonExportFolder(paths: string[]): string {
	if (!paths.length) return '';
	const parts = paths[0].split('/').slice(0, -1);
	while (parts.length && !paths.every(path => path.startsWith(parts.join('/') + '/'))) parts.pop();
	return parts.join('/');
}
export function exportSourceTree(files: ExportSource[], root: string, query = ''): ExportTreeNode[] {
	const roots: ExportTreeNode[] = [], nodes = new Map<string, ExportTreeNode>();
	for (const file of files) {
		if (!isInExportFolder(file.path, root) || !file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
		const parts = file.path.slice(root ? root.length + 1 : 0).split('/');
		let parent = roots, prefix = root;
		for (const [index, name] of parts.entries()) {
			const path = prefix ? `${prefix}/${name}` : name, folder = index !== parts.length - 1;
			let node = nodes.get(path);
			if (!node) { node = { path, name: folder ? name : file.basename, folder, children: [], files: [] }; nodes.set(path, node); parent.push(node); }
			node.files.push(file.path); parent = node.children; prefix = path;
		}
	}
	const sort = (items: ExportTreeNode[]): void => { items.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true })); items.forEach(item => sort(item.children)); };
	sort(roots); return roots;
}
export class ExportSelection {
	order: string[];
	constructor(paths: string[]) { this.order = [...new Set(paths)]; }
	state(paths: string[]): 'none' | 'some' | 'all' { const selected = paths.filter(path => this.order.includes(path)).length; return !selected ? 'none' : selected === paths.length ? 'all' : 'some'; }
	toggle(paths: string[], checked: boolean): void { const affected = new Set(paths); this.order = checked ? [...this.order, ...paths.filter(path => !this.order.includes(path))] : this.order.filter(path => !affected.has(path)); }
	move(path: string, before: string): void {
		if (path === before || !this.order.includes(path) || !this.order.includes(before)) return;
		this.order = this.order.filter(item => item !== path); this.order.splice(this.order.indexOf(before), 0, path);
	}
	step(path: string, delta: number): void { const from = this.order.indexOf(path), to = from + delta; if (from < 0 || to < 0 || to >= this.order.length) return; const next = [...this.order]; [next[from], next[to]] = [next[to], next[from]]; this.order = next; }
	/** Apply query sorting to visible selections while retaining filtered-out positions. */
	reorderVisible(paths: string[]): boolean {
		const selected = new Set(this.order), sorted = [...new Set(paths)].filter(path => selected.has(path));
		const visible = new Set(sorted); let index = 0;
		const next = this.order.map(path => visible.has(path) ? sorted[index++] : path);
		if (next.every((path, position) => path === this.order[position])) return false;
		this.order = next; return true;
	}
}
