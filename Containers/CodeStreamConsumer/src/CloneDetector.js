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
  #myChunkSize = process.env.CHUNKSIZE || DEFAULT_CHUNKSIZE;
  #myFileStore = FileStorage.getInstance();

  constructor() {}

  // Private Methods
  // --------------------
  #filterLines(file) {
    let lines = file.contents.split("\n");
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
    let chunkSize = this.#myChunkSize;
    let lines = this.#getContentLines(file);
    file.chunks = [];

    for (let i = 0; i <= lines.length - chunkSize; i++) {
      let chunk = lines.slice(i, i + chunkSize);
      file.chunks.push(chunk);
    }
    return file;
  }

  #chunkMatch(first, second) {
    let match = true;

    if (first.length != second.length) {
      match = false;
    }
    for (let idx = 0; idx < first.length; idx++) {
      if (!first[idx].equals(second[idx])) {
        match = false;
      }
    }

    return match;
  }

  #filterCloneCandidates(file, compareFile) {
    // Ensure instances array exists
    file.instances = file.instances || [];

    file.chunks.forEach((chunk) => {
      compareFile.chunks.forEach((cChunk) => {
        // Skip empty chunks or undefined lines
        if (!chunk || !cChunk || chunk.length === 0 || cChunk.length === 0)
          return;
        if (chunk.some((line) => !line || !line.hasContent())) return;
        if (cChunk.some((line) => !line || !line.hasContent())) return;

        // Check if chunks match
        if (this.#chunkMatch(chunk, cChunk)) {
          // Create new Clone safely
          const newClone = new Clone(
            chunk.map((l) => l.lineNumber), // source lines
            cChunk.map((l) => l.lineNumber), // target lines
            chunk.map((l) => l.content), // original code content
            chunk[0].sourceFile, // source file name
            cChunk[0].sourceFile // target file name
          );

          // Add to instances
          file.instances.push(newClone);
        }
      });
    });

    return file;
  }

  #expandCloneCandidates(file) {
    // TODO
    // For each Clone in file.instances, try to expand it with every other Clone
    // (using Clone::maybeExpandWith(), which returns true if it could expand)
    //
    // Comment: This should be doable with a reduce:
    //          For every new element, check if it overlaps any element in the accumulator.
    //          If it does, expand the element in the accumulator. If it doesn't, add it to the accumulator.
    //
    // ASSUME: As long as you traverse the array file.instances in the "normal" order, only forward expansion is necessary.
    //
    // Return: file, with file.instances only including Clones that have been expanded as much as they can,
    //         and not any of the Clones used during that expansion.
    //
    //--------------------------------------------------------------------------------
    // Expand each clone by checking overlaps with accumulated clones
    const expanded = file.instances.reduce((acc, clone) => {
      const overlapping = acc.find((c) => c.maybeExpandWith(clone));
      if (!overlapping) acc.push(clone);
      return acc;
    }, []);

    // Update file.instances to only include fully expanded clones

    file.instances = expanded;

    return file;
  }

  #consolidateClones(file) {
    // TODO
    // For each clone, accumulate it into an array if it is new
    // If it isn't new, update the existing clone to include this one too
    // using Clone::addTarget()
    //
    // TIP 1: Array.reduce() with an empty array as start value.
    //        Push not-seen-before clones into the accumulator
    // TIP 2: There should only be one match in the accumulator
    //        so Array.find() and Clone::equals() will do nicely.
    //
    // Return: file, with file.instances containing unique Clone objects that may contain several targets
    //

    //---------------------------------------------------------------------------
    // Reduce file.instances into unique clones, combining targets where necessary

    const consolidated = file.instances.reduce((acc, clone) => {
      const existing = acc.find((c) => c.equals(clone));
      if (existing) existing.addTarget(clone);
      else acc.push(clone);
      return acc;
    }, []);
    // Update file.instances with consolidated clones

    file.instances = consolidated;
    return file;
  }

  // Public Processing Steps
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
    let allFiles = this.#myFileStore.getAllFiles();
    file.instances = file.instances || [];
    for (let f of allFiles) {
      // TODO implement these methods (or re-write the function matchDetect() to your own liking)
      //
      // Overall process:
      //
      // 1. Find all equal chunks in file and f. Represent each matching pair as a Clone.
      //
      // 2. For each Clone with endLine=x, merge it with Clone with endLine-1=x
      //    remove the now redundant clone, rinse & repeat.
      //    note that you may end up with several "root" Clones for each processed file f
      //    if there are more than one clone between the file f and the current
      //
      // 3. If the same clone is found in several places, consolidate them into one Clone.
      //
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
