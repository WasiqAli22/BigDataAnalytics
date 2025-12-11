import warnings
warnings.filterwarnings("ignore")

import streamlit as st
import pymongo
import time
import os
import pandas as pd
import numpy as np
import json
from datetime import datetime
import plotly.express as px
import plotly.graph_objects as go


# ---------------------------
# PAGE CONFIGURATION
# ---------------------------
st.set_page_config(
    page_title="Clone Detector Analytics Dashboard",
    page_icon="🧠",
    layout="wide"
)

# Custom CSS for modern dark UI
st.markdown("""
    <style>
        body {
            background-color: #0e1117;
            color: #fafafa;
        }
        .stMetric {
            background: #1a1c23;
            padding: 1.2em;
            border-radius: 12px;
            text-align: center;
            border: 1px solid #2a2d36;
            box-shadow: 0px 0px 5px #00f0ff22;
        }
        .stDataFrame {
            background-color: #1c1e26;
        }
    </style>
""", unsafe_allow_html=True)

st.title("Clone Detector Analytics Dashboard")


# ---------------------------
# DATABASE CONNECTION
# ---------------------------
DB_HOST = os.environ.get("DBHOST", "localhost")
DB_NAME = "cloneDetector"

@st.cache_resource
def get_db_client():
    """Connect to MongoDB with retry."""
    while True:
        try:
            client = pymongo.MongoClient(f"mongodb://{DB_HOST}:27017/")
            client.admin.command('ping')
            return client
        except Exception:
            st.error(f"⚠️ Failed to connect to MongoDB at {DB_HOST}. Retrying...")
            time.sleep(2)

client = get_db_client()
db = client[DB_NAME]


# ---------------------------
# LOCAL PERSISTENCE HELPERS
# ---------------------------
CACHE_FILE = "stats_cache.json"

def load_stats_from_cache():
    """Load stats history from JSON file if available."""
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r") as f:
                data = json.load(f)
            for d in data:
                d["Time"] = pd.to_datetime(d["Time"])
            return data
        except Exception:
            return []
    return []

def save_stats_to_cache(data):
    """Save stats history to local JSON file."""
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump(data, f, default=str, indent=2)
    except Exception:
        pass


# ---------------------------
# HELPER FUNCTIONS
# ---------------------------
def count_documents_safe(name):
    try:
        if name in db.list_collection_names():
            return db[name].count_documents({})
        return 0
    except Exception:
        return 0

def get_average_clone_size():
    if "clones" in db.list_collection_names():
        clones = list(db.clones.find({}, {"size": 1}).limit(500))
        sizes = [c.get("size", 0) for c in clones if "size" in c]
        return np.mean(sizes) if sizes else 0
    return 0

def get_avg_chunks_per_file(files, chunks):
    return chunks / files if files else 0


# ---------------------------
# STATE INIT
# ---------------------------
if "stats" not in st.session_state:
    st.session_state.stats = load_stats_from_cache()

if "last_run" not in st.session_state:
    st.session_state.last_run = {"timestamp": time.time(), "chunks": 0, "candidates": 0, "clones": 0}


# Sidebar Controls
st.sidebar.header("⚙️ Controls")
refresh_rate = st.sidebar.slider("Refresh Interval (seconds)", 1, 10, 3)
st.sidebar.markdown("---")
st.sidebar.info("📊 Real-time analytics and performance monitoring for cljDetector")


# ---------------------------
# MAIN LOOP
# ---------------------------
placeholder_top = st.empty()
placeholder_mid = st.empty()
placeholder_bottom = st.empty()

while True:
    try:
        # Collect counts
        files = count_documents_safe("files")
        chunks = count_documents_safe("chunks")
        candidates = count_documents_safe("candidates")
        clones = count_documents_safe("clones")

        # Status updates
        status_updates = []
        if "statusUpdates" in db.list_collection_names():
            status_updates = list(db.statusUpdates.find().sort("timestamp", pymongo.DESCENDING).limit(10))
        status_df = pd.DataFrame(status_updates, columns=["timestamp", "message"]) if status_updates else pd.DataFrame(columns=["timestamp", "message"])

        # Processing rates
        now = time.time()
        dt = now - st.session_state.last_run["timestamp"]
        if dt > 0:
            chunks_per_s = (chunks - st.session_state.last_run["chunks"]) / dt
            candidates_per_s = (candidates - st.session_state.last_run["candidates"]) / dt
            clones_per_s = (clones - st.session_state.last_run["clones"]) / dt
        else:
            chunks_per_s = candidates_per_s = clones_per_s = 0

        # Derived metrics
        avg_clone_size = get_average_clone_size()
        avg_chunks_per_file = get_avg_chunks_per_file(files, chunks)
        clone_ratio = clones / candidates if candidates else 0

        # Store new data point
        new_entry = {
            "Time": datetime.now(),
            "Chunks/sec": chunks_per_s,
            "Candidates/sec": candidates_per_s,
            "Clones/sec": clones_per_s,
            "Total Chunks": chunks,
            "Total Candidates": candidates,
            "Total Clones": clones,
            "Clone Ratio": clone_ratio
        }

        st.session_state.stats.append(new_entry)
        if len(st.session_state.stats) > 1500:
            st.session_state.stats.pop(0)

        # Save to local JSON cache
        save_stats_to_cache(st.session_state.stats)

        st.session_state.last_run = {"timestamp": now, "chunks": chunks, "candidates": candidates, "clones": clones}
        df = pd.DataFrame(st.session_state.stats).set_index("Time")

        # ---------------------------
        # TOP METRICS BAR
        # ---------------------------
        with placeholder_top.container():
            col1, col2, col3, col4, col5 = st.columns(5)
            col1.metric("📁 Total Files", f"{files:,}")
            col2.metric("📦 Total Chunks", f"{chunks:,}")
            col3.metric("🧩 Candidates", f"{candidates:,}")
            col4.metric("🧬 Clones", f"{clones:,}")
            col5.metric("⚖️ Clone Ratio", f"{clone_ratio:.4f}")

        # ---------------------------
        # MIDDLE GRAPHS
        # ---------------------------
        with placeholder_mid.container():
            st.subheader("📈 Real-Time Processing Trends")

            col1, col2 = st.columns(2)
            with col1:
                fig1 = go.Figure()
                fig1.add_trace(go.Scatter(y=df["Chunks/sec"], x=df.index, mode="lines", name="Chunks/sec", line=dict(color="#00FFFF", width=2)))
                fig1.add_trace(go.Scatter(y=df["Candidates/sec"], x=df.index, mode="lines", name="Candidates/sec", line=dict(color="#FF00FF", width=2)))
                fig1.add_trace(go.Scatter(y=df["Clones/sec"], x=df.index, mode="lines", name="Clones/sec", line=dict(color="#FFAA00", width=2)))
                fig1.update_layout(title="Processing Rate Over Time", template="plotly_dark", height=400)
                st.plotly_chart(fig1, use_container_width=True)

            with col2:
                fig2 = px.line(df, y=["Total Chunks", "Total Candidates", "Total Clones"],
                               title="Cumulative Growth Over Time", template="plotly_dark", height=400)
                st.plotly_chart(fig2, use_container_width=True)

            # Clone ratio and trend
            col3, col4 = st.columns(2)
            with col3:
                fig3 = px.area(df, y="Clone Ratio", title="Clone Ratio Trend",
                               color_discrete_sequence=["#33FF99"], template="plotly_dark", height=300)
                st.plotly_chart(fig3, use_container_width=True)

            with col4:
                df["Moving Avg (Chunks/sec)"] = df["Chunks/sec"].rolling(10).mean()
                fig4 = px.line(df, y="Moving Avg (Chunks/sec)", title="Chunking Rate (10-step Moving Avg)",
                               color_discrete_sequence=["#00FFCC"], template="plotly_dark", height=300)
                st.plotly_chart(fig4, use_container_width=True)

        # ---------------------------
        # BOTTOM STATS AND STATUS
        # ---------------------------
        with placeholder_bottom.container():
            st.subheader("🧠 Derived Insights")
            col1, col2, col3 = st.columns(3)
            col1.metric("Avg Clone Size", f"{avg_clone_size:.2f}")
            col2.metric("Avg Chunks/File", f"{avg_chunks_per_file:.2f}")
            col3.metric("Data Points Recorded", f"{len(df):,}")

            st.subheader("⚙️ Execution Timeline")
            st.dataframe(status_df, use_container_width=True)

            st.markdown("#### 💡 Analytical Summary")
            st.write(f"""
            - **Clone Efficiency:** {clone_ratio:.4f} (ratio of clones to candidates)
            - **Clone Growth:** {'Stable' if clones_per_s < 1 else 'Increasing rapidly'}
            - **Chunking Stability:** Variance of chunk/sec = {np.var(df['Chunks/sec']):.4f}
            - **Expected Completion:** Based on current rate, process stabilizing in {(len(df)/20):.1f} minutes.
            """)

    except Exception as e:
        st.error(f"Error: {e}")

    time.sleep(refresh_rate)
