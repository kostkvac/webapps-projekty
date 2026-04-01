"""
AI Phase Summary Generator
============================
Parses Obsidian Canvas (phases, edges/dependencies) + reads all referenced
markdown docs, then calls OpenAI/Gemini to produce a single coherent
phase-by-phase summary document.
"""
import json
import logging
import os
import asyncio
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Load .env if keys not yet in environment ──────────────────────────────
_env_files = [
    Path("/opt/webapps/projekty/.env"),
    Path("/opt/webapps/zahrada/.env"),  # fallback — shared API keys
]
for _ef in _env_files:
    if _ef.exists():
        for line in _ef.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


# ── AI call helpers (same pattern as zahrada) ─────────────────────────────

def _parse_ai_text(raw: str) -> str:
    """Strip markdown code fences if present."""
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n", 1)
        if len(lines) > 1:
            raw = lines[1]
        raw = raw.rsplit("```", 1)[0].strip()
    return raw


async def _call_openai(prompt: str, api_key: str, retries: int = 3) -> str:
    import openai as openai_lib
    for attempt in range(retries):
        try:
            def _call():
                client = openai_lib.OpenAI(api_key=api_key)
                resp = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.4,
                )
                return resp.choices[0].message.content.strip()
            return await asyncio.to_thread(_call)
        except Exception as e:
            msg = str(e)
            is_transient = any(s in msg.lower() for s in ("503", "429", "rate", "server_error"))
            if is_transient and attempt < retries - 1:
                wait = 10 * (attempt + 1)
                logger.warning("OpenAI transient error (attempt %d/%d), waiting %ds: %s", attempt + 1, retries, wait, e)
                await asyncio.sleep(wait)
            else:
                raise


async def _call_gemini(prompt: str, api_key: str, retries: int = 3) -> str:
    from google import genai as google_genai
    for attempt in range(retries):
        try:
            def _call():
                client = google_genai.Client(api_key=api_key)
                resp = client.models.generate_content(
                    model="models/gemini-2.5-flash-preview-05-20",
                    contents=prompt,
                )
                return resp.text.strip()
            return await asyncio.to_thread(_call)
        except Exception as e:
            msg = str(e)
            is_transient = any(s in msg for s in ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED"))
            if is_transient and attempt < retries - 1:
                wait = 10 * (attempt + 1)
                logger.warning("Gemini transient error (attempt %d/%d), waiting %ds: %s", attempt + 1, retries, wait, e)
                await asyncio.sleep(wait)
            else:
                raise


async def _call_ai(prompt: str) -> str:
    """Call primary AI provider with fallback to secondary."""
    provider = os.getenv("AI_PROVIDER", "openai").lower()
    openai_key = os.getenv("OPENAI_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")

    primary_fn = _call_openai if provider == "openai" else _call_gemini
    primary_key = openai_key if provider == "openai" else gemini_key
    fallback_fn = _call_gemini if provider == "openai" else _call_openai
    fallback_key = gemini_key if provider == "openai" else openai_key

    if not primary_key:
        if not fallback_key:
            raise ValueError("No AI API key configured (OPENAI_API_KEY or GEMINI_API_KEY)")
        primary_fn, primary_key = fallback_fn, fallback_key
        fallback_key = ""

    try:
        return await primary_fn(prompt, primary_key)
    except Exception as primary_err:
        if fallback_key:
            logger.warning("%s failed (%s), trying fallback", provider, primary_err)
            return await fallback_fn(prompt, fallback_key)
        raise


# ── Canvas parsing with dependency graph ──────────────────────────────────

def parse_canvas_full(canvas_path: Path) -> dict:
    """Parse Obsidian Canvas → phases with files and dependency edges."""
    data = json.loads(canvas_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    # Groups = phases, sorted left-to-right
    groups = sorted(
        [n for n in nodes if n["type"] == "group"],
        key=lambda g: g["x"],
    )
    file_nodes = {n["id"]: n for n in nodes if n["type"] == "file"}

    # Assign files to phases
    phases = []
    for idx, g in enumerate(groups, 1):
        gx, gy, gw, gh = g["x"], g["y"], g["width"], g["height"]
        files_in = []
        for fid, f in file_nodes.items():
            if gx <= f["x"] <= gx + gw and gy <= f["y"] <= gy + gh:
                files_in.append({"id": fid, "file": f["file"]})
        phases.append({
            "number": idx,
            "label": g.get("label", f"Fáze {idx}"),
            "files": files_in,
        })

    # Build dependency map from edges: fromNode → toNode
    # Both node-to-node and group-to-group edges
    deps = []
    node_id_to_file = {f["id"]: f["file"] for f in file_nodes.values()}
    group_ids = {g["id"] for g in groups}
    group_id_to_idx = {g["id"]: i + 1 for i, g in enumerate(groups)}

    for e in edges:
        from_id = e.get("fromNode")
        to_id = e.get("toNode")
        from_file = node_id_to_file.get(from_id)
        to_file = node_id_to_file.get(to_id)

        if from_file and to_file:
            deps.append({"from": from_file, "to": to_file, "type": "task"})
        elif from_id in group_ids and to_id in group_ids:
            deps.append({
                "from": f"Fáze {group_id_to_idx[from_id]}",
                "to": f"Fáze {group_id_to_idx[to_id]}",
                "type": "phase",
            })
        elif from_id in group_ids and to_file:
            deps.append({
                "from": f"Fáze {group_id_to_idx[from_id]}",
                "to": to_file,
                "type": "phase_to_task",
            })
        elif from_file and to_id in group_ids:
            deps.append({
                "from": from_file,
                "to": f"Fáze {group_id_to_idx[to_id]}",
                "type": "task_to_phase",
            })

    return {"phases": phases, "dependencies": deps}


def read_doc_files(repo_path: Path, file_paths: list[str]) -> dict[str, str]:
    """Read markdown files and return {path: content}."""
    result = {}
    for fp in file_paths:
        full = (repo_path / fp).resolve()
        if full.is_relative_to(repo_path.resolve()) and full.exists():
            try:
                result[fp] = full.read_text(encoding="utf-8")
            except Exception:
                result[fp] = "(nepodařilo se přečíst)"
    return result


# ── Prompt builder ────────────────────────────────────────────────────────

SUMMARY_PROMPT = """Jsi zkušený stavební projektový manažer. Na základě níže uvedených podkladů vytvoř **souhrnnou dokumentaci projektu** rozdělenou po fázích.

## Pravidla:
1. Pro každou fázi vytvoř přehlednou sekci s:
   - Stručným popisem co se v dané fázi dělá (2-3 věty)
   - Seznamem kroků/úkolů v logickém pořadí (respektuj závislosti!)
   - U každého kroku stručný souhrn klíčových bodů z dokumentace (NE celý text — jen to nejdůležitější: materiály, rozměry, postup)
   - Závislosti: co musí být hotové předtím
2. Pokud z Canvasu vyplývá, že úkoly na sebe navazují (edges/závislosti), jasně to vyznač — např. "⚠️ Nelze začít před dokončením: XYZ"
3. Na konci přidej sekci "Kritické závislosti" — přehled co na co čeká a proč
4. Formát: čistý Markdown, nadpisy ## pro fáze, ### pro úkoly, checklisty zachovej jako checklisty
5. Piš česky, stručně a prakticky — tohle je pracovní dokument pro stavebníka

## Struktura fází a závislosti (z Obsidian Canvas):

{phases_json}

## Závislosti mezi úkoly (hrany z Canvas):

{deps_json}

## Obsah jednotlivých dokumentů:

{docs_content}

---

Vytvoř souhrnný dokument. Začni nadpisem "# Souhrnná dokumentace — {project_name}".
"""


async def generate_phase_summary(
    repo_path: Path,
    canvas_path: Path,
    project_name: str,
) -> str:
    """Parse canvas, read docs, call AI, return generated markdown."""
    # 1. Parse canvas structure
    canvas_data = parse_canvas_full(canvas_path)
    phases = canvas_data["phases"]
    deps = canvas_data["dependencies"]

    # 2. Collect all referenced doc files
    all_files = []
    for p in phases:
        for f in p["files"]:
            all_files.append(f["file"])

    # 3. Read doc contents
    docs = read_doc_files(repo_path, all_files)

    # 4. Build prompt
    phases_summary = []
    for p in phases:
        files_list = [f["file"] for f in p["files"]]
        phases_summary.append({
            "faze": p["number"],
            "nazev": p["label"],
            "dokumenty": files_list,
        })

    docs_text = ""
    for path, content in docs.items():
        docs_text += f"\n### Dokument: {path}\n\n{content}\n\n---\n"

    prompt = SUMMARY_PROMPT.format(
        phases_json=json.dumps(phases_summary, ensure_ascii=False, indent=2),
        deps_json=json.dumps(deps, ensure_ascii=False, indent=2),
        docs_content=docs_text,
        project_name=project_name,
    )

    # 5. Call AI
    logger.info("Generating phase summary for %s (%d phases, %d docs)", project_name, len(phases), len(docs))
    raw = await _call_ai(prompt)
    result = _parse_ai_text(raw)
    logger.info("Phase summary generated: %d chars", len(result))

    return result
