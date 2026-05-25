import { Notice, Plugin, TFile } from "obsidian";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"]);

const WIKI_RE = /!\[\[([^\]|]+?)(\|[^[\]]+?)?\]\]/g;
const MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function isImage(path: string): boolean {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTS.has(ext);
}

function parentDir(path: string): string {
	const i = path.lastIndexOf("/");
	return i === -1 ? "" : path.substring(0, i);
}

function fileName(path: string): string {
	const i = path.lastIndexOf("/");
	return i === -1 ? path : path.substring(i + 1);
}

function resolveImagePath(docDir: string, ref: string): string | null {
	if (ref.startsWith("/")) return ref.substring(1);
	if (ref.includes("/")) return ref;
	return docDir ? docDir + "/" + ref : ref;
}

interface RefInfo {
	file: TFile;
	type: "wiki" | "md";
	fullMatch: string;
	aliasOrAlt: string;
}

export default class FigureMoverPlugin extends Plugin {
	async onload() {
		this.addRibbonIcon("image-file", "Organize all figures", () => {
			this.organizeAll();
		});

		this.addCommand({
			id: "organize-all-figures",
			name: "Organize all figures across vault",
			callback: () => this.organizeAll(),
		});
	}

	async organizeAll() {
		const mdFiles = this.app.vault.getMarkdownFiles();
		if (mdFiles.length === 0) {
			new Notice("No markdown files found.");
			return;
		}

		// image path -> list of docs referencing it
		const imageRefCount = new Map<string, { doc: TFile; refs: RefInfo[] }[]>();

		for (const doc of mdFiles) {
			const content = await this.app.vault.cachedRead(doc);
			const docDir = parentDir(doc.path);

			for (const m of content.matchAll(WIKI_RE)) {
				const rawRef = m[1];
				if (!isImage(rawRef)) continue;
				const resolved = resolveImagePath(docDir, rawRef);
				if (!resolved) continue;
				const tFile = this.app.vault.getAbstractFileByPath(resolved);
				if (!(tFile instanceof TFile)) continue;
				if (parentDir(tFile.path) === docDir) continue;

				this.addRef(imageRefCount, resolved, doc, {
					file: tFile,
					type: "wiki",
					fullMatch: m[0],
					aliasOrAlt: m[2] ?? "",
				});
			}

			for (const m of content.matchAll(MD_RE)) {
				const rawRef = decodeURIComponent(m[2]);
				if (!isImage(rawRef)) continue;
				if (rawRef.startsWith("http://") || rawRef.startsWith("https://")) continue;
				const resolved = resolveImagePath(docDir, rawRef);
				if (!resolved) continue;
				const tFile = this.app.vault.getAbstractFileByPath(resolved);
				if (!(tFile instanceof TFile)) continue;
				if (parentDir(tFile.path) === docDir) continue;

				this.addRef(imageRefCount, resolved, doc, {
					file: tFile,
					type: "md",
					fullMatch: m[0],
					aliasOrAlt: m[1],
				});
			}
		}

		if (imageRefCount.size === 0) {
			new Notice("All figures are already organized.");
			return;
		}

		let moved = 0;
		let copied = 0;
		const toDelete: TFile[] = [];

		for (const [imgPath, docEntries] of imageRefCount) {
			const imgFile = docEntries[0].refs[0].file;
			const isShared = docEntries.length > 1;

			for (const { doc, refs } of docEntries) {
				const docDir = parentDir(doc.path);
				const newName = fileName(imgPath);
				let newPath = docDir ? docDir + "/" + newName : newName;
				newPath = this.uniquePath(newPath);
				const newRef = docDir ? docDir + "/" + fileName(newPath) : fileName(newPath);

				if (isShared) {
					// Copy to each doc's directory
					const data = await this.app.vault.readBinary(imgFile);
					// @ts-ignore — ArrayBuffer is valid for binary files
					await this.app.vault.create(newPath, data as string);
					copied++;
				} else {
					// Move (only one doc references it)
					await this.app.vault.rename(imgFile, newPath);
					moved++;
				}

				// Update references in the document
				await this.app.vault.process(doc, (text) => {
					for (const ref of refs) {
						const replacement = ref.type === "wiki"
							? `![[${newRef}${ref.aliasOrAlt}]]`
							: `![${ref.aliasOrAlt}](${newRef})`;
						text = text.replace(ref.fullMatch, replacement);
					}
					return text;
				});
			}

			// Mark shared originals for deletion after all copies are made
			if (isShared) {
				toDelete.push(imgFile);
			}
		}

		// Delete originals that were copied
		for (const f of toDelete) {
			if (this.app.vault.getAbstractFileByPath(f.path) instanceof TFile) {
				await this.app.vault.trash(f, true);
			}
		}

		const parts: string[] = [];
		if (moved > 0) parts.push(`moved ${moved}`);
		if (copied > 0) parts.push(`copied ${copied}`);
		new Notice(`Done: ${parts.join(", ")} image(s).`);
	}

	private addRef(
		map: Map<string, { doc: TFile; refs: RefInfo[] }[]>,
		imgPath: string,
		doc: TFile,
		ref: RefInfo,
	) {
		let entries = map.get(imgPath);
		if (!entries) {
			entries = [];
			map.set(imgPath, entries);
		}
		let entry = entries.find((e) => e.doc.path === doc.path);
		if (!entry) {
			entry = { doc, refs: [] };
			entries.push(entry);
		}
		entry.refs.push(ref);
	}

	private uniquePath(path: string): string {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		const dotIdx = path.lastIndexOf(".");
		const ext = dotIdx !== -1 ? path.substring(dotIdx) : "";
		const base = dotIdx !== -1 ? path.substring(0, dotIdx) : path;
		let i = 1;
		while (this.app.vault.getAbstractFileByPath(`${base}-${i}${ext}`)) i++;
		return `${base}-${i}${ext}`;
	}
}
