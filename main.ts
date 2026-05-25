import { Notice, Plugin, TFile } from "obsidian";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"]);

// Match ![[image.png]] and ![[image.png|alias]]
const WIKI_RE = /!\[\[([^\]|]+?)(\|[^[\]]+?)?\]\]/g;
// Match ![alt](path)
const MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function isImage(path: string): boolean {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTS.has(ext);
}

function parentDir(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx === -1 ? "" : path.substring(0, idx);
}

function fileName(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx === -1 ? path : path.substring(idx + 1);
}

function resolveImagePath(vaultPath: string, ref: string): string | null {
	// Already vault-absolute path (starts with / or has no extension trickery)
	if (ref.startsWith("/")) return ref.substring(1);

	// If ref contains a folder separator, treat as relative to vault root or absolute
	if (ref.includes("/")) {
		// Could be vault-relative
		return ref;
	}

	// Bare filename — resolve relative to the document's directory
	if (vaultPath === "") return ref;
	return vaultPath + "/" + ref;
}

interface MoveOp {
	file: TFile;
	newPath: string;
	oldRef: string;
	newRef: string;
	type: "wiki" | "md";
	fullMatch: string;
	aliasOrAlt: string;
}

export default class FigureMoverPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: "move-figures-to-current-dir",
			name: "Move figures to current document directory",
			callback: () => this.moveFigures(),
		});
	}

	async moveFigures() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file.");
			return;
		}

		const content = await this.app.vault.read(file);
		const docDir = parentDir(file.path);
		const ops: MoveOp[] = [];

		// Collect wiki-link images: ![[image.png]] or ![[image.png|alias]]
		for (const m of content.matchAll(WIKI_RE)) {
			const rawRef = m[1];
			const alias = m[2] ?? "";
			if (!isImage(rawRef)) continue;

			const resolved = resolveImagePath(docDir, rawRef);
			if (!resolved) continue;

			const tFile = this.app.vault.getAbstractFileByPath(resolved);
			if (!(tFile instanceof TFile)) continue;

			if (parentDir(tFile.path) === docDir) continue; // already in same dir

			const newName = fileName(tFile.path);
			let newPath = docDir ? docDir + "/" + newName : newName;

			// Handle name collision
			newPath = this.uniquePath(newPath);

			ops.push({
				file: tFile,
				newPath,
				oldRef: rawRef,
				newRef: docDir ? docDir + "/" + newName : newName,
				type: "wiki",
				fullMatch: m[0],
				aliasOrAlt: alias,
			});
		}

		// Collect markdown-link images: ![alt](path)
		for (const m of content.matchAll(MD_RE)) {
			const alt = m[1];
			const rawRef = decodeURIComponent(m[2]);
			if (!isImage(rawRef)) continue;
			if (rawRef.startsWith("http://") || rawRef.startsWith("https://")) continue;

			const resolved = resolveImagePath(docDir, rawRef);
			if (!resolved) continue;

			const tFile = this.app.vault.getAbstractFileByPath(resolved);
			if (!(tFile instanceof TFile)) continue;

			if (parentDir(tFile.path) === docDir) continue;

			const newName = fileName(tFile.path);
			let newPath = docDir ? docDir + "/" + newName : newName;
			newPath = this.uniquePath(newPath);

			ops.push({
				file: tFile,
				newPath,
				oldRef: m[2],
				newRef: newName,
				type: "md",
				fullMatch: m[0],
				aliasOrAlt: alt,
			});
		}

		if (ops.length === 0) {
			new Notice("No images to move.");
			return;
		}

		// Move files first
		for (const op of ops) {
			await this.app.vault.rename(op.file, op.newPath);
		}

		// Update document content
		await this.app.vault.process(file, (data) => {
			for (const op of ops) {
				if (op.type === "wiki") {
					const newWiki = `![[${op.newRef}${op.aliasOrAlt}]]`;
					data = data.replace(op.fullMatch, newWiki);
				} else {
					const newMd = `![${op.aliasOrAlt}](${op.newRef})`;
					data = data.replace(op.fullMatch, newMd);
				}
			}
			return data;
		});

		new Notice(`Moved ${ops.length} image(s) to "${docDir || "/"}".`);
	}

	private uniquePath(path: string): string {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;

		const ext = path.lastIndexOf(".") !== -1 ? path.substring(path.lastIndexOf(".")) : "";
		const base = ext ? path.substring(0, path.length - ext.length) : path;
		let i = 1;
		while (this.app.vault.getAbstractFileByPath(`${base}-${i}${ext}`)) {
			i++;
		}
		return `${base}-${i}${ext}`;
	}
}
