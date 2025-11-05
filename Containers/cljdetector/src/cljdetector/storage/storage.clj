(ns cljdetector.storage.storage
  (:require [monger.core :as mg]
            [monger.collection :as mc]
            [monger.operators :refer :all]
            [monger.conversion :refer [from-db-object]]
            [clojure.string :as str]))

;; -------------------------------
;; Config (no MONGO_URI needed)
;; -------------------------------
(def hostname (or (System/getenv "DBHOST") "dbstorage"))   ;; compose service name
(def dbname   (or (System/getenv "MONGO_DB") "cljdetector"))
(def collnames ["files" "chunks" "candidates" "clones"])
(def partition-size 100)

(defn- get-db []
  (let [conn (mg/connect {:host hostname})]
    (mg/get-db conn dbname)))

;; -------------------------------
;; Status updates for monitoring
;; -------------------------------
(defn addUpdate! [message]
  (let [db (get-db)]
    (mc/insert db "statusUpdates"
               {:ts (.toString (java.time.Instant/now))
                :message message})))

;; -------------------------------
;; Stats / maintenance
;; -------------------------------
(defn print-statistics []
  (let [db (get-db)]
    (doseq [coll collnames]
      (println "db contains" (mc/count db coll) coll))))

(defn clear-db! []
  (let [db (get-db)]
    (doseq [coll collnames]
      (mc/drop db coll))))

(defn count-items [collname]
  (mc/count (get-db) collname))

;; -------------------------------
;; Writers
;; -------------------------------
(defn store-files! [files]
  (let [db (get-db)
        collname "files"
        file-parted (partition-all partition-size files)]
    (try
      (doseq [file-group file-parted]
        (mc/insert-batch db collname
                          (map (fn [f] {:fileName (.getPath f)
                                        :contents (slurp f)})
                               file-group)))
      (catch Exception _e
        ;; swallow in assignment context to avoid breaking the run on a single bad file
        []))))

(defn store-chunks! [chunks]
  (let [db (get-db)
        collname "chunks"
        chunk-parted (partition-all partition-size (flatten chunks))]
    (doseq [chunk-group chunk-parted]
      (mc/insert-batch db collname (map identity chunk-group)))))

(defn store-clones! [clones]
  (let [db (get-db)
        collname "clones"
        clones-parted (partition-all partition-size clones)]
    (doseq [clone-group clones-parted]
      (mc/insert-batch db collname (map identity clone-group)))))

;; -------------------------------
;; Candidate identification (DB-side)
;; -------------------------------
(defn identify-candidates! []
  (try
    (let [db (get-db)
          collname "chunks"
          total-chunks (mc/count db collname)]
      (println (format "DEBUG: Total chunks in database: %d" total-chunks))
      (when (> total-chunks 0)
        ;; Sample a chunk to verify structure
        (let [sample (mc/find-one db collname {})]
          (when sample
            (println (format "DEBUG: Sample chunk keys: %s" (keys sample)))
            (println (format "DEBUG: Sample chunk has chunkHash: %s" (contains? sample :chunkHash)))
            (when (contains? sample :chunkHash)
              (println (format "DEBUG: Sample chunkHash value: %s" (str (:chunkHash sample))))))
        ;; Clear existing candidates first
        (println "DEBUG: Clearing existing candidates collection...")
        (try (mc/drop db "candidates") (catch Exception _e (println "DEBUG: Candidates collection did not exist")))
        ;; Test aggregation to find duplicates
        (println "DEBUG: Running test aggregation to find duplicate hashes...")
        (let [test-pipeline [{$group {:_id "$chunkHash"
                                       :numberOfInstances {$sum 1}
                                       :instances {$push {:fileName "$fileName"
                                                          :startLine "$startLine"
                                                          :endLine "$endLine"}}}}
                             {$match {:numberOfInstances {$gt 1}}}
                             {$limit 5}]
              test-result (mc/aggregate db collname test-pipeline)
              duplicate-count (count test-result)]
          (println (format "DEBUG: Test aggregation found %d duplicate chunk hashes (sampled first 5)" duplicate-count))
          (when (> duplicate-count 0)
            (let [sample-dup (first test-result)]
              (println (format "DEBUG: Sample duplicate structure: _id=%s, count=%s" 
                               (str (:_id sample-dup)) 
                               (str (:numberOfInstances sample-dup))))))
          ;; Run the full aggregation with $out to create candidates
          (if (> duplicate-count 0)
            (do
              (println "DEBUG: Running full aggregation to create candidates collection...")
              (try
                (let [full-pipeline [{$group {:_id "$chunkHash"
                                              :numberOfInstances {$sum 1}
                                              :instances {$push {:fileName "$fileName"
                                                                 :startLine "$startLine"
                                                                 :endLine "$endLine"}}}}
                                     {$match {:numberOfInstances {$gt 1}}}
                                     {$addFields {:chunkHash "$_id"}}
                                     {"$out" "candidates"}]
                      _ (mc/aggregate db collname full-pipeline)]
                  (println "DEBUG: Aggregation pipeline completed")
                  ;; Verify candidates were created
                  (let [candidate-count (mc/count db "candidates")]
                    (println (format "DEBUG: Candidates collection now contains %d documents" candidate-count))
                    (when (> candidate-count 0)
                      (let [sample-candidate (mc/find-one db "candidates" {})]
                        (when sample-candidate
                          (println (format "DEBUG: Sample candidate keys: %s" (keys sample-candidate)))
                          (println (format "DEBUG: Sample candidate numberOfInstances: %s" 
                                           (str (:numberOfInstances sample-candidate))))))))
                (catch Exception agg-e
                  (println (format "ERROR during aggregation: %s" (.getMessage agg-e)))
                  (.printStackTrace agg-e)
                  (throw agg-e)))
              ;; Count total candidates
              (let [final-count (mc/count db "candidates")]
                (println (format "DEBUG: Final candidate count: %d" final-count))))
            (println "DEBUG: No duplicates found in test aggregation - skipping candidate creation"))))))
    (catch Exception e
      (println "ERROR in identify-candidates!:" (.getMessage e))
      (println "Stack trace:")
      (.printStackTrace e)
      (throw e))))

;; -------------------------------
;; Consolidation for pretty printing
;; -------------------------------
(defn consolidate-clones-and-source []
  (let [db (get-db)
        collname "clones"]
    (mc/aggregate db collname
                  [{$project {:_id 0
                              :instances "$instances"
                              :sourcePosition {$first "$instances"}}}
                   {"$addFields" {:cloneLength {"$subtract" ["$sourcePosition.endLine"
                                                             "$sourcePosition.startLine"]}}}
                   {$lookup
                    {:from "files"
                     :let {:sourceName "$sourcePosition.fileName"
                           :sourceStart {"$subtract" ["$sourcePosition.startLine" 1]}
                           :sourceLength "$cloneLength"}
                     :pipeline
                     [{$match {$expr {$eq ["$fileName" "$$sourceName"]}}}
                      {$project {:contents {"$split" ["$contents" "\n"]}}}
                      {$project {:contents {"$slice" ["$contents" "$$sourceStart" "$$sourceLength"]}}}
                      {$project {:_id 0
                                 :contents {"$reduce" {:input "$contents"
                                                       :initialValue ""
                                                       :in {"$concat"
                                                            ["$$value"
                                                             {"$cond" [{"$eq" ["$$value" ""]} "" "\n"]}
                                                             "$$this"]}}}}}]
                     :as "sourceContents"}}
                   {$project {:_id 0
                              :instances 1
                              :contents "$sourceContents.contents"}}])))

;; -------------------------------
;; Accessors used by expander
;; -------------------------------
(defn get-dbconnection []
  (mg/connect {:host hostname}))  ;; kept for compatibility with existing expander code

(defn get-one-candidate [conn]
  (try
    (let [db (mg/get-db conn dbname)
          candidate-count (mc/count db "candidates")]
      (when (> candidate-count 0)
        (let [candidate-doc (mc/find-one db "candidates" {})]
          (when candidate-doc
            (from-db-object candidate-doc true)))))
    (catch Exception e
      (println "ERROR in get-one-candidate:" (.getMessage e))
      (.printStackTrace e)
      nil)))

(defn get-overlapping-candidates [conn candidate]
  (let [db (mg/get-db conn dbname)
        clj-cand (from-db-object candidate true)]
    (mc/aggregate db "candidates"
                  [{$match {"instances.fileName"
                            {$all (map #(:fileName %) (:instances clj-cand))}}}
                   {$addFields {:candidate candidate}}
                   {$unwind "$instances"}
                   {$project {:matches
                              {$filter {:input "$candidate.instances"
                                        :cond {$and [{$eq ["$$this.fileName" "$instances.fileName"]}
                                                     {$or [{$and [{$gt  ["$$this.startLine" "$instances.startLine"]}
                                                                  {$lte ["$$this.startLine" "$instances.endLine"]}]}
                                                           {$and [{$gt  ["$instances.startLine" "$$this.startLine"]}
                                                                  {$lte ["$instances.startLine" "$$this.endLine"]}]}]}]}}}
                             :instances 1
                             :numberOfInstances 1
                             :candidate 1}}
                   {$match {$expr {$gt [{$size "$matches"} 0]}}}
                   {$group {:_id "$_id"
                            :candidate {$first "$candidate"}
                            :numberOfInstances {$max "$numberOfInstances"}
                            :instances {$push "$instances"}}}
                   {$match {$expr {$eq [{$size "$candidate.instances"} "$numberOfInstances"]}}}
                   {$project {:_id 1 :numberOfInstances 1 :instances 1}}])))

(defn remove-overlapping-candidates! [conn candidates]
  (let [db (mg/get-db conn dbname)]
    (mc/remove db "candidates" {:_id {$in (map #(:_id %) candidates)}})))

(defn store-clone! [conn clone]
  (let [db (mg/get-db conn dbname)
        anonymous-clone (select-keys clone [:numberOfInstances :instances])]
    (mc/insert db "clones" anonymous-clone)))
