const emptyLine = /^\s*$/;
const oneLineComment = /\/\/.*/;
const oneLineMultiLineComment = /\/\*.*?\*\//;
const openMultiLineComment = /\/\*+[^\*\/]*$/;
const closeMultiLineComment = /^[\*\/]*\*+\//;

const SourceLine = require("./SourceLine");
const FileStorage = require("./FileStorage");
const Clone = require("./Clone");

const DEFAULT_CHUNKSIZE = 5;

class CloneDetector {
  #myChunkSize = Number(process.env.CHUNKSIZE) || DEFAULT_CHUNKSIZE;
  #myFileStore = FileStorage.getInstance();

  constructor() {}

  // --------------------
  // Private helpers
  // --------------------
  #filterLines(file) {
    const lines = file.contents.split("\n");
    let inMultiLineComment = false;
    file.lines = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (inMultiLineComment) {
        if (-1 != line.search(closeMultiLineComment)) {
          line = line.replace(closeMultiLineComment, "");
          inMultiLineComment = false;
        } else {
          line = "";
        }
      }

      line = line.replace(emptyLine, "");
      line = line.replace(oneLineComment, "");
      line = line.replace(oneLineMultiLineComment, "");

      if (-1 != line.search(openMultiLineComment)) {
        line = line.replace(openMultiLineComment, "");
        inMultiLineComment = true;
      }

      file.lines.push(new SourceLine(i + 1, line.trim()));
    }
    return file;
  }

  #getContentLines(file) {
    return file.lines.filter((line) => line.hasContent());
  }

  #chunkify(file) {
    const chunkSize = this.#myChunkSize;
    const lines = this.#getContentLines(file);
    file.chunks = [];

    for (let i = 0; i <= lines.length - chunkSize; i++) {
      const chunk = lines.slice(i, i + chunkSize);
      file.chunks.push(chunk);
    }
    return file;
  }

  #chunkMatch(first, second) {
    if (first.length !== second.length) return false;
    for (let i = 0; i < first.length; i++) {
      if (!first[i].equals(second[i])) return false;
    }
    return true;
  }

  /**
   * Todo-1: Identify potential clone pairs based on identical chunks.
   * For every matching chunk found between two files,
   * we create a new Clone instance referencing both sides.
   */
  #filterCloneCandidates(file, compareFile) {
    // ensure this file has a list to store any detected clone candidates
    file.instances = file.instances || [];
    // compare each chunk in the current file with all chunks in the other file
    for (const chunk of file.chunks) {
      for (const other of compareFile.chunks) {
        // if chunks match, create a new clone candidate
        if (this.#chunkMatch(chunk, other)) {
          try {
            // Clone expects full chunk objects, not just their line numbers
            const clone = new Clone(file.name, compareFile.name, chunk, other);
            file.instances.push(clone);
          } catch (err) {
            console.error("Error while creating clone candidate:", err.message);
          }
        }
      }
    }
    return file;
  }

  /**
   * Todo-2: Extend existing clone candidates.
  * When two detected candidates are found to be adjacent (via the sliding-window),
 * they can be merged into a longer continuous clone using Clone.maybeExpandWith().
 *
 *  * Expansion is done per target file to ensure clones from different
 * comparison files aren’t accidentally merged together.

    */
  #expandCloneCandidates(file) {
    if (!file.instances || file.instances.length === 0) return file;

    // Expand each clone by checking overlaps with accumulated clones
    const byTarget = new Map();
    for (const c of file.instances) {
      const targetName =
        (c.targets && c.targets[0] && c.targets[0].name) || "__unknown__";
      if (!byTarget.has(targetName)) byTarget.set(targetName, []);
      byTarget.get(targetName).push(c);
    }

    const expanded = [];

    for (const [, clones] of byTarget) {
      // sort clones by their starting line in the source file

      clones.sort((a, b) => a.sourceStart - b.sourceStart);

      let current = null;
      for (const cand of clones) {
        if (!current) {
          current = cand;
          continue;
        }
        // try to merge if the next candidate directly follows the current one
        if (!current.maybeExpandWith(cand)) {
          // if merge is not possible, store the current one and move on
          expanded.push(current);
          current = cand;
        }
      }
      // add the last processed clone if available

      if (current) expanded.push(current);
    }

    file.instances = expanded;
    return file;
  }

  /**
   * Todo3: Merge overlapping or duplicate clone entries.
   * After expansion, multiple clone records may refer to the same
   * source range but different targets — we combine them to avoid duplication.
   */
  #consolidateClones(file) {
    // nothing to consolidate if no clones exist

    if (!file.instances || file.instances.length === 0) return file;

    const map = new Map();
    for (const c of file.instances) {
      // unique key based on source file and its start-end range

      const key = `${c.sourceName}:${c.sourceStart}-${c.sourceEnd}`;
      if (map.has(key)) {
        // merge additional targets into the existing clone
        map.get(key).addTarget(c);
      } else {
      }
      map.set(key, c);
    }
    // replace file clone list with consolidated set
    file.instances = Array.from(map.values());
    return file;
  }

  // --------------------
  // Public API used by index.js
  // --------------------
  preprocess(file) {
    return new Promise((resolve, reject) => {
      if (!file.name.endsWith(".java")) {
        reject(file.name + " is not a java file. Discarding.");
      } else if (this.#myFileStore.isFileProcessed(file.name)) {
        reject(file.name + " has already been processed.");
      } else {
        resolve(file);
      }
    });
  }

  transform(file) {
    file = this.#filterLines(file);
    file = this.#chunkify(file);
    return file;
  }

  matchDetect(file) {
    const allFiles = this.#myFileStore.getAllFiles();
    file.instances = file.instances || [];

    for (const f of allFiles) {
      file = this.#filterCloneCandidates(file, f);
      file = this.#expandCloneCandidates(file);
      file = this.#consolidateClones(file);
    }
    return file;
  }

  pruneFile(file) {
    delete file.lines;
    delete file.instances;
    return file;
  }

  storeFile(file) {
    this.#myFileStore.storeFile(this.pruneFile(file));
    return file;
  }

  get numberOfProcessedFiles() {
    return this.#myFileStore.numberOfFiles;
  }
}

module.exports = CloneDetector;
