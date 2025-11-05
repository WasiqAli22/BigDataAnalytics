import os
import time
import threading
from datetime import datetime, timezone
from typing import Dict, Any, List

from flask import Flask, jsonify, render_template, request
from pymongo import MongoClient


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()

MONGO_HOST  = os.getenv("MONGO_HOST", "dbstorage")
MONGO_PORT  = int(os.getenv("MONGO_PORT", "27017"))
MONGO_DB    = os.getenv("MONGO_DB", "cljdetector")
SAMPLE_SEC  = int(os.getenv("SAMPLE_SEC", "30"))
KEEP_POINTS = int(os.getenv("KEEP_POINTS", "720"))  # ~6h if sampling every 30s

client = MongoClient(f"mongodb://{MONGO_HOST}:{MONGO_PORT}")
db = client[MONGO_DB]

app = Flask(__name__, static_folder="static", template_folder="templates")

# in-memory time series
series: List[Dict[str, Any]] = []
seen_update_ids = set()
lock = threading.RLock()


def count(coll: str) -> int:
    return db[coll].estimated_document_count()

def snapshot() -> Dict[str, Any]:
    return {
        "ts": utc_now_iso(),
        "files": count("files"),
        "chunks": count("chunks"),
        "candidates": count("candidates"),
        "clones": count("clones"),
    }

def compute_rates(prev: Dict[str, Any], cur: Dict[str, Any]):
    from datetime import datetime as dt
    t0 = dt.fromisoformat(prev["ts"])
    t1 = dt.fromisoformat(cur["ts"])
    dt_s = max((t1 - t0).total_seconds(), 1e-9)
    out = {}
    for k in ["files", "chunks", "candidates", "clones"]:
        diff = cur[k] - prev[k]
        out[f"{k}_per_sec"] = diff / dt_s
        # time-per-unit (seconds to produce 1 new unit in that interval); inf if no progress
        out[f"{k}_sec_per_unit"] = (dt_s / diff) if diff > 0 else None
    out["interval_sec"] = dt_s
    return out

def poll_loop():
    last = None
    while True:
        cur = snapshot()
        with lock:
            if last:
                rates = compute_rates(last, cur)
                series.append({**cur, **rates})
            else:
                series.append(cur)
            # keep memory bounded
            if len(series) > KEEP_POINTS:
                del series[: len(series) - KEEP_POINTS]
        last = cur

        # dump any new statusUpdates to stdout (useful in compose logs)
        # the dashboard will fetch them via API separately
        try:
            for doc in db["statusUpdates"].find().sort([("_id", 1)]):
                _id = str(doc["_id"])
                if _id not in seen_update_ids:
                    print(f"[StatusUpdate] {doc.get('ts')} {doc.get('message')}")
                    seen_update_ids.add(_id)
        except Exception as e:
            print(f"[Monitor warn] reading statusUpdates failed: {e}")

        time.sleep(SAMPLE_SEC)


@app.get("/")
def home():
    return render_template("index.html")

@app.get("/api/stats")
def api_stats():
    n = int(request.args.get("n", "360"))  # default last 3h if SAMPLE_SEC=30
    with lock:
        data = series[-n:] if n > 0 else series[:]
    return jsonify(data)

@app.get("/api/snapshot")
def api_snapshot():
    with lock:
        return jsonify(series[-1] if series else snapshot())

@app.get("/api/updates")
def api_updates():
    """
    Optional: fetch latest status updates.
    Use /api/updates?since=2025-11-04T00:00:00+00:00
    """
    since = request.args.get("since")
    q = {}
    if since:
        try:
            q = {"ts": {"$gt": since}}
        except Exception:
            pass
    docs = list(db["statusUpdates"].find(q).sort([("_id", 1)]))
    # sanitize ObjectId for JSON
    for d in docs:
        d["_id"] = str(d["_id"])
    return jsonify(docs)


if __name__ == "__main__":
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()
    app.run(host="0.0.0.0", port=8080, debug=False)
