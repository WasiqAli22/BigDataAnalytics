(ns cljdetector.storage.storage
  (:require [monger.core :as mg]
            [monger.collection :as mc]
            [monger.operators :refer :all]
            [monger.conversion :refer [from-db-object]]))

(def DEFAULT-DBHOST "localhost")
(def dbname "cloneDetector")
(def partition-size 100)
(def hostname (or (System/getenv "DBHOST") DEFAULT-DBHOST))
(def collnames ["files"  "chunks" "candidates" "clones" "statusUpdates"])

(defn print-statistics []
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)]
    (doseq [coll collnames]
      (println "db contains" (mc/count db coll) coll))))

(defn clear-db! []
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)]
    (doseq [coll collnames]
      (mc/drop db coll))))

(defn count-items [collname]
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)]
    (mc/count db collname)))

(defn- slurp-safely
  "A helper function to slurp a file, returning nil on failure."
  [file]
  (try
    {:fileName (.getPath file) :contents (slurp file)}
    (catch Exception e
      (println (str "!!! SKIPPING FILE: Failed to read " (.getPath file) " - Error: " (.getMessage e)))
      nil))) ; Return nil if slurp fails

(defn store-files! [files]
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)
        collname "files"
        file-parted (partition-all partition-size files)]
    (doseq [file-group file-parted]
      ; 1. Map each file to our 'slurp-safely' function
      ; 2. Remove any 'nil' results (the files that failed)
      (let [safe-files (remove nil? (map slurp-safely file-group))]
        ; 3. Only insert the batch if it's not empty
        (when (not-empty safe-files)
          (try
            (mc/insert-batch db collname safe-files)
            (catch Exception e 
              (println (str "!!! DB ERROR: Failed to insert file batch - " (.getMessage e))))))))))

(defn store-chunks! [chunks]
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)
        collname "chunks"
        chunk-parted (partition-all partition-size (flatten chunks))]
    (doseq [chunk-group chunk-parted]
      (mc/insert-batch db collname (map identity chunk-group)))))

(defn store-clones! [clones]
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)
        collname "clones"
        clones-parted (partition-all partition-size clones)]
    (doseq [clone-group clones-parted]
      (mc/insert-batch db collname (map identity clone-group)))))

(defn identify-candidates! []
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)
        collname "chunks"]
     (mc/aggregate db collname
                   [{$group {:_id "$chunkHash" ; <-- THE REAL FIX
                             :numberOfInstances {$count {}}
                             :instances {$push {:fileName "$fileName"
                                             :startLine "$startLine"
                                             :endLine "$endLine"}}}}
                    {$match {:numberOfInstances {$gt 1}}}
                    {"$out" "candidates"} ])))


(defn consolidate-clones-and-source []
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)
        collname "clones"]
    (mc/aggregate db collname
                  [{$project {:_id 0 :instances "$instances" :sourcePosition {$first "$instances"}}}
                   {"$addFields" {:cloneLength {"$subtract" ["$sourcePosition.endLine" "$sourcePosition.startLine"]}}}
                   {$lookup
                    {:from "files"
                     :let {:sourceName "$sourcePosition.fileName"
                           :sourceStart {"$subtract" ["$sourcePosition.startLine" 1]}
                           :sourceLength "$cloneLength"}
                     :pipeline
                     [{$match {$expr {$eq ["$fileName" "$$sourceName"]}}}
                      {$project {:contents {"$split" ["$contents" "\n"]}}}
                      {$project {:contents {"$slice" ["$contents" "$$sourceStart" "$$sourceLength"]}}}
                      {$project
                       {:_id 0
                        :contents 
                        {"$reduce"
                         {:input "$contents"
                          :initialValue ""
                          :in {"$concat"
                               ["$$value"
                                {"$cond" [{"$eq" ["$$value", ""]}, "", "\n"]}
                                "$$this"]
                               }}}}}]
                     :as "sourceContents"}}
                   {$project {:_id 0 :instances 1 :contents "$sourceContents.contents"}}])))


(defn get-dbconnection []
  (mg/connect {:host hostname}))

(defn get-one-candidate [conn]
  (let [db (mg/get-db conn dbname)
        collname "candidates"]
    (from-db-object (mc/find-one db collname {}) true)))

(defn get-overlapping-candidates [conn candidate]
  (let [db (mg/get-db conn dbname)
        collname "candidates"
        clj-cand (from-db-object candidate true)]
    (mc/aggregate db collname
                  [{$match {"instances.fileName" {$all (map #(:fileName %) (:instances clj-cand))}}}
                   {$addFields {:candidate candidate}}
                   {$unwind "$instances"}
                   {$project 
                    {:matches
                     {$filter
                      {:input "$candidate.instances"
                       :cond {$and [{$eq ["$$this.fileName" "$instances.fileName"]}
                                    {$or [{$and [{$gt  ["$$this.startLine" "$instances.startLine"]}
                                                 {$lte ["$$this.startLine" "$instances.endLine"]}]}
                                          {$and [{$gt  ["$instances.startLine" "$$this.startLine"]}
                                                 {$lte ["$instances.startLine" "$$this.endLine"]}]}]}]}}}
                     :instances 1
                     :numberOfInstances 1
                     :candidate 1
                     }}
                   {$match {$expr {$gt [{$size "$matches"} 0]}}}
                   {$group {:_id "$_id"
                            :candidate {$first "$candidate"}
                            :numberOfInstances {$max "$numberOfInstances"}
                            :instances {$push "$instances"}}}
                   {$match {$expr {$eq [{$size "$candidate.instances"} "$numberOfInstances"]}}}
                   {$project {:_id 1 :numberOfInstances 1 :instances 1}}])))

(defn remove-overlapping-candidates! [conn candidates]
  (let [db (mg/get-db conn dbname)
        collname "candidates"]
      (mc/remove db collname {:_id {$in (map #(:_id %) candidates)}})))

(defn store-clone! [conn clone]
  (let [db (mg/get-db conn dbname)
        collname "clones"
        anonymous-clone (select-keys clone [:numberOfInstances :instances])]
    (mc/insert db collname anonymous-clone)))

(defn addUpdate! [timestamp message]
  (let [conn (mg/connect {:host hostname})        
        db (mg/get-db conn dbname)
        collname "statusUpdates"]
    (try
      (mc/insert db collname {:timestamp (.toString timestamp) :message message})
      (catch Exception e
        ; Print to stderr to avoid a loop if db logging fails
        (.println System/err (str "Failed to log status update: " (.getMessage e)))))))

(defn create-chunks-index! []
  (let [conn (mg/connect {:host hostname})
        db (mg/get-db conn dbname)]
    (println "Ensuring index on chunks.chunkHash...")
    (mc/create-index db "chunks" (array-map :chunkHash 1))))

(defn create-candidates-index! []
  (let [conn (mg/connect {:host hostname})
        db (mg/get-db conn dbname)]
    (println "Ensuring index on candidates.instances.fileName...")
    (mc/create-index db "candidates" (array-map :instances.fileName 1))))