(ns cljdetector.core
  (:require [clojure.string :as string]
            [cljdetector.process.source-processor :as source-processor]
            [cljdetector.process.expander :as expander]
            [cljdetector.storage.storage :as storage]))

;; Defaults come from environment when present
(def DEFAULT-CHUNKSIZE 5)
(def source-dir (or (System/getenv "SOURCEDIR") "/QualitasCorpus"))
(def source-type #".*\.java")

;; Timestamped logger that also writes to Mongo statusUpdates
(defn ts-println [& args]
  (let [msg (string/join " " args)
        ts  (.toString (java.time.LocalDateTime/now))]
    (println ts ":" msg)
    (try
      (storage/addUpdate! msg)
      (catch Exception _e
        ;; do not fail the pipeline if status logging has an issue
        nil))))

(defn maybe-clear-db [args]
  (when (some #{"CLEAR"} (map string/upper-case args))
    (ts-println "Clearing database...")
    (storage/clear-db!)))

(defn maybe-read-files [args]
  (when-not (some #{"NOREAD"} (map string/upper-case args))
    (ts-println "Reading and processing files from" source-dir "...")
    (let [chunk-param (System/getenv "CHUNKSIZE")
          chunk-size (try
                       (if chunk-param (Integer/parseInt chunk-param) DEFAULT-CHUNKSIZE)
                       (catch Exception _ DEFAULT-CHUNKSIZE))
          file-handles (source-processor/traverse-directory source-dir source-type)
          chunks       (source-processor/chunkify chunk-size file-handles)]
      (ts-println "Storing files...")
      (storage/store-files! file-handles)
      (ts-println "Storing chunks of size" chunk-size "...")
      (storage/store-chunks! chunks))))

(defn maybe-detect-clones [args]
  (when-not (some #{"NOCLONEID"} (map string/upper-case args))
    (ts-println "Identifying clone candidates...")
    (try
      (println "DEBUG core: Starting identify-candidates!...")
      (storage/identify-candidates!)
      (println "DEBUG core: identify-candidates! completed")
      (let [candidate-count (storage/count-items "candidates")]
        (ts-println "Found" candidate-count "candidates")
        (println (format "DEBUG core: Candidate count = %d" candidate-count))
        (if (> candidate-count 0)
          (do
            (ts-println "Expanding candidates...")
            (println "DEBUG core: Starting expand-clones...")
            (expander/expand-clones)
            (println "DEBUG core: expand-clones completed")
            (let [final-clone-count (storage/count-items "clones")]
              (ts-println "Expansion complete. Final clones count:" final-clone-count)
              (println (format "DEBUG core: Final clone count = %d" final-clone-count))))
          (ts-println "No candidates found - skipping expansion. This may indicate that chunks do not have duplicate hashes.")))
      (catch Exception e
        (ts-println "ERROR during clone detection:" (.getMessage e))
        (println "Full exception:")
        (.printStackTrace e)
        (throw e))))

(defn pretty-print [clones]
  (doseq [clone clones]
    (println "====================\n" "Clone with" (count (:instances clone)) "instances:")
    (doseq [inst (:instances clone)]
      (println "  -" (:fileName inst) "startLine:" (:startLine inst) "endLine:" (:endLine inst)))
    (println "\nContents:\n----------\n" (:contents clone) "\n----------")))

(defn maybe-list-clones [args]
  (when (some #{"LIST"} (map string/upper-case args))
    (ts-println "Consolidating and listing clones...")
    (pretty-print (storage/consolidate-clones-and-source))))

(defn -main
  "Starting point for All-At-Once Clone Detection
   Arguments:
     CLEAR     clears the database
     NOREAD    do not read the files again
     NOCLONEID do not detect clones
     LIST      print a list of all clones"
  [& args]
  (maybe-clear-db args)
  (maybe-read-files args)
  (maybe-detect-clones args)
  (maybe-list-clones args)
  (ts-println "Summary")
  (storage/print-statistics))
