var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FigureMoverPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var IMAGE_EXTS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"]);
var WIKI_RE = /!\[\[([^\]|]+?)(\|[^[\]]+?)?\]\]/g;
var MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
function isImage(path) {
  var _a, _b;
  const ext = (_b = (_a = path.split(".").pop()) == null ? void 0 : _a.toLowerCase()) != null ? _b : "";
  return IMAGE_EXTS.has(ext);
}
function parentDir(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.substring(0, i);
}
function fileName(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.substring(i + 1);
}
function resolveImagePath(docDir, ref, getFile, nameIndex) {
  if (ref.startsWith("/")) {
    const f = getFile(ref.substring(1));
    return f ? f.path : null;
  }
  if (ref.includes("/")) {
    const f = getFile(ref);
    return f ? f.path : null;
  }
  const rel = docDir ? docDir + "/" + ref : ref;
  if (getFile(rel))
    return rel;
  const found = nameIndex.get(ref);
  return found ? found.path : null;
}
var FigureMoverPlugin = class extends import_obsidian.Plugin {
  onload() {
    return __async(this, null, function* () {
      this.addRibbonIcon("image-plus", "Organize all figures", () => {
        this.organizeAll().catch((e) => {
          new import_obsidian.Notice(`Figure Mover error: ${e.message}`);
          console.error("Figure Mover error", e);
        });
      });
      this.addCommand({
        id: "organize-all-figures",
        name: "Organize all figures across vault",
        callback: () => {
          this.organizeAll().catch((e) => {
            new import_obsidian.Notice(`Figure Mover error: ${e.message}`);
            console.error("Figure Mover error", e);
          });
        }
      });
    });
  }
  organizeAll() {
    return __async(this, null, function* () {
      var _a;
      new import_obsidian.Notice("Scanning vault...");
      const mdFiles = this.app.vault.getMarkdownFiles();
      new import_obsidian.Notice(`Found ${mdFiles.length} markdown files.`);
      if (mdFiles.length === 0) {
        new import_obsidian.Notice("No markdown files found.");
        return;
      }
      const nameIndex = /* @__PURE__ */ new Map();
      for (const f of this.app.vault.getFiles()) {
        if (isImage(f.path)) {
          nameIndex.set(f.name, f);
        }
      }
      new import_obsidian.Notice(`Found ${nameIndex.size} image files in vault.`);
      const imageRefCount = /* @__PURE__ */ new Map();
      const getFile = (path) => {
        const f = this.app.vault.getAbstractFileByPath(path);
        return f instanceof import_obsidian.TFile ? f : null;
      };
      for (const doc of mdFiles) {
        const content = yield this.app.vault.cachedRead(doc);
        const docDir = parentDir(doc.path);
        for (const m of content.matchAll(WIKI_RE)) {
          const rawRef = m[1];
          if (!isImage(rawRef))
            continue;
          const resolved = resolveImagePath(docDir, rawRef, getFile, nameIndex);
          if (!resolved)
            continue;
          const tFile = getFile(resolved);
          if (!tFile)
            continue;
          if (parentDir(tFile.path) === docDir)
            continue;
          this.addRef(imageRefCount, resolved, doc, {
            file: tFile,
            type: "wiki",
            fullMatch: m[0],
            aliasOrAlt: (_a = m[2]) != null ? _a : ""
          });
        }
        for (const m of content.matchAll(MD_RE)) {
          const rawRef = decodeURIComponent(m[2]);
          if (!isImage(rawRef))
            continue;
          if (rawRef.startsWith("http://") || rawRef.startsWith("https://"))
            continue;
          const resolved = resolveImagePath(docDir, rawRef, getFile, nameIndex);
          if (!resolved)
            continue;
          const tFile = getFile(resolved);
          if (!tFile)
            continue;
          if (parentDir(tFile.path) === docDir)
            continue;
          this.addRef(imageRefCount, resolved, doc, {
            file: tFile,
            type: "md",
            fullMatch: m[0],
            aliasOrAlt: m[1]
          });
        }
      }
      if (imageRefCount.size === 0) {
        new import_obsidian.Notice("All figures are already organized.");
        return;
      }
      new import_obsidian.Notice(`Found ${imageRefCount.size} image(s) to move. Processing...`);
      let moved = 0;
      let copied = 0;
      const toDelete = [];
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
            const data = yield this.app.vault.readBinary(imgFile);
            yield this.app.vault.createBinary(newPath, new Uint8Array(data));
            copied++;
          } else {
            yield this.app.vault.rename(imgFile, newPath);
            moved++;
          }
          yield this.app.vault.process(doc, (text) => {
            for (const ref of refs) {
              const replacement = ref.type === "wiki" ? `![[${newRef}${ref.aliasOrAlt}]]` : `![${ref.aliasOrAlt}](${newRef})`;
              text = text.replace(ref.fullMatch, replacement);
            }
            return text;
          });
        }
        if (isShared) {
          toDelete.push(imgFile);
        }
      }
      for (const f of toDelete) {
        if (this.app.vault.getAbstractFileByPath(f.path) instanceof import_obsidian.TFile) {
          yield this.app.vault.trash(f, true);
        }
      }
      const parts = [];
      if (moved > 0)
        parts.push(`moved ${moved}`);
      if (copied > 0)
        parts.push(`copied ${copied}`);
      new import_obsidian.Notice(`Done: ${parts.join(", ")} image(s).`);
    });
  }
  addRef(map, imgPath, doc, ref) {
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
  uniquePath(path) {
    if (!this.app.vault.getAbstractFileByPath(path))
      return path;
    const dotIdx = path.lastIndexOf(".");
    const ext = dotIdx !== -1 ? path.substring(dotIdx) : "";
    const base = dotIdx !== -1 ? path.substring(0, dotIdx) : path;
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(`${base}-${i}${ext}`))
      i++;
    return `${base}-${i}${ext}`;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {});
