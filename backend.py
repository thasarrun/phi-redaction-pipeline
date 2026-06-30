"""
PHI Shield — real detector backend.

Loads a clinical de-identification NER model (trained on the i2b2
de-identification dataset) and exposes a single /redact endpoint that
the frontend calls instead of the old regex mock.

Everything runs locally. The only time this process touches the network
is the very first run, to download the model weights from Hugging Face.
After that they're cached on disk and inference is fully offline — no
clinical text ever leaves this machine.
"""

import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline

# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
# obi/deid_roberta_i2b2 is a RoBERTa model fine-tuned on the i2b2 2014
# de-identification challenge dataset — real clinical notes, hand-labeled
# for names, dates, locations, ages, IDs, etc. This is what makes detection
# "real" rather than pattern-matching: it understands context, so it can
# catch a name it's never seen before, not just things that match a regex.
MODEL_NAME = "obi/deid_roberta_i2b2"

print(f"Loading {MODEL_NAME} ... (first run downloads ~500MB, then it's cached)")
ner = pipeline("ner", model=MODEL_NAME, aggregation_strategy="simple")
print("Model loaded. Detector is ready.")

# ---------------------------------------------------------------------------
# Regex safety net
# ---------------------------------------------------------------------------
# NER models are good at "this looks like a name/place" but can be inconsistent
# on rigidly-formatted IDs. Catching those with regex too is standard practice —
# defense in depth, not a replacement for the model.
REGEX_PATTERNS = [
    ("SSN",   re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("MRN",   re.compile(r"\bMRN:?\s?\d{4,10}\b", re.IGNORECASE)),
    ("Phone", re.compile(r"\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b")),
]


def regex_matches(text: str):
    out = []
    for label, pattern in REGEX_PATTERNS:
        for m in pattern.finditer(text):
            out.append({
                "start": m.start(),
                "end": m.end(),
                "label": label,
                "value": m.group(),
                "score": 1.0,
            })
    return out


def ner_matches(text: str):
    out = []
    for ent in ner(text):
        out.append({
            "start": ent["start"],
            "end": ent["end"],
            "label": ent["entity_group"],
            "value": ent["word"],
            "score": float(ent["score"]),
        })
    return out


def merge_matches(matches):
    """Sort by position, prefer longer spans, drop anything that overlaps
    a span we've already kept."""
    matches.sort(key=lambda m: (m["start"], -(m["end"] - m["start"])))
    merged = []
    last_end = -1
    for m in matches:
        if m["start"] >= last_end:
            merged.append(m)
            last_end = m["end"]
    return merged


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
app = FastAPI(title="PHI Shield Detector")

# Allows the static frontend (served from a different local port, or file://)
# to call this API. Fine for local/internal use; tighten if you ever deploy
# this beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class NoteRequest(BaseModel):
    text: str


@app.post("/redact")
def redact(req: NoteRequest):
    matches = ner_matches(req.text) + regex_matches(req.text)
    matches = merge_matches(matches)
    return {"matches": matches}


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}
