# =============================================================================
# server.py  —  Pokédex Backend
# =============================================================================
# This file is a Python web server built with Flask.  It does two things:
#
#   1. Acts as a PROXY to the PokéAPI (https://pokeapi.co/):
#      When the browser asks for Pokémon data, this server fetches it from
#      PokéAPI, cleans it up, and returns only the fields the frontend needs.
#
#   2. Stores the player's Pokémon boxes in a local SQLite database so the
#      data persists across page refreshes and browser sessions.
#
# To run locally:
#   pip install -r requirements.txt
#   python server.py
# Then open http://localhost:3000 in your browser.
# =============================================================================

import os
import re
import sqlite3  # Part of Python's standard library — no pip install needed!

import requests
# Flask is a lightweight Python web framework.
# `jsonify` turns a Python dict/list into a JSON HTTP response.
# `send_from_directory` serves a static file (index.html) from a folder.
# `request` lets us read URL query parameters and POST body data.
from flask import Flask, jsonify, send_from_directory, request

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
# `static_folder="."` tells Flask to serve files (index.html, script.js,
# styles.css, images) directly from the current directory when the browser
# requests them.
app = Flask(__name__, static_folder=".", static_url_path="")

PORT = 3000
STORAGE_SIZE = 10  # number of storage boxes

# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------
# SQLite is a file-based relational database that comes built into Python.
# Unlike PostgreSQL or MySQL, it needs no separate server process — it's just
# a single .db file sitting next to your code.
#
# DB_PATH points to pokedex.db in the same folder as this script.
#
# IMPORTANT for deployment: On platforms like Heroku, the filesystem is
# "ephemeral" — the .db file gets wiped when the server restarts.  For
# persistent cloud storage you would swap SQLite for a hosted database like
# Postgres.  For local development and classroom use, SQLite is perfect.
DB_PATH = os.path.join(os.path.dirname(__file__), "pokedex.db")


def init_db():
    """Create the database table if it doesn't already exist.

    Called once when the server starts.  The CREATE TABLE IF NOT EXISTS
    statement is safe to run repeatedly — it does nothing if the table
    is already there.
    """
    con = sqlite3.connect(DB_PATH)
    # Each row represents one Pokémon stored in one box.
    # UNIQUE (box_index, pokemon_id) means the same Pokémon can't appear
    # twice in the same box — this mirrors the check in the frontend.
    con.execute("""
        CREATE TABLE IF NOT EXISTS box_pokemon (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            box_index               INTEGER NOT NULL
                                        CHECK (box_index >= 0 AND box_index <= 9),
            pokemon_id              INTEGER NOT NULL,
            pokemon_name            TEXT    NOT NULL,
            sprite_front            TEXT,
            sprite_official_default TEXT,
            sprite_official_shiny   TEXT,
            UNIQUE (box_index, pokemon_id)
        )
    """)
    con.commit()
    con.close()


def get_db():
    """Open and return a SQLite connection.

    Setting row_factory = sqlite3.Row lets you access columns by name
    (e.g. row["pokemon_id"]) instead of by index (row[2]).
    """
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


# Run database setup immediately when the server starts.
init_db()


# ---------------------------------------------------------------------------
# PokeAPI helper
# ---------------------------------------------------------------------------
# PokéAPI returns a huge JSON object for each Pokémon.  This function pulls
# out only the fields we need and returns a clean, small dictionary.
#
# It needs TWO API calls to build the full picture:
#   • https://pokeapi.co/api/v2/pokemon/{name}  →  sprites, stats, types, etc.
#   • pokemon["species"]["url"]                 →  text descriptions (flavor text)
#
# The flavor text comes from the species endpoint because it is stored
# separately in PokéAPI — descriptions are per-game and per-language.
def build_pokemon_data(pokemon, species_data, lang="en"):
    """Extract and reshape Pokémon data from PokéAPI responses.

    Args:
        pokemon:      The JSON dict from /api/v2/pokemon/{id}
        species_data: The JSON dict from /api/v2/pokemon-species/{id}
        lang:         Two-letter language code, e.g. "en", "fr", "ja"

    Returns:
        A clean dict with only the fields the frontend needs.
    """
    # flavor_text_entries is a list of descriptions from every game and
    # language.  We find the first entry matching our requested language,
    # then fall back to English if none exists.
    flavor_entry = next(
        (e for e in species_data["flavor_text_entries"] if e["language"]["name"] == lang),
        None,
    )
    if not flavor_entry:
        flavor_entry = next(
            (e for e in species_data["flavor_text_entries"] if e["language"]["name"] == "en"),
            None,
        )

    # The original Game Boy cartridges stored descriptions with newline (\n)
    # and form-feed (\f) characters as line breaks.  We replace them with
    # spaces so the text displays cleanly in the browser.
    description = (
        re.sub(r"[\n\f]", " ", flavor_entry["flavor_text"])
        if flavor_entry
        else "No description available"
    )

    # Build the response dictionary.  `next(..., None)` is used to safely
    # find each stat without crashing if a stat is unexpectedly missing.
    return {
        "id": pokemon["id"],
        "name": pokemon["name"],
        "description": description,
        "sprites": {
            "front_default": pokemon["sprites"]["front_default"],
            "official": {
                "default": pokemon["sprites"]["other"]["official-artwork"]["front_default"],
                "shiny": pokemon["sprites"]["other"]["official-artwork"]["front_shiny"],
            },
        },
        "stats": {
            "hp":            next((s["base_stat"] for s in pokemon["stats"] if s["stat"]["name"] == "hp"), None),
            "attack":        next((s["base_stat"] for s in pokemon["stats"] if s["stat"]["name"] == "attack"), None),
            "defense":       next((s["base_stat"] for s in pokemon["stats"] if s["stat"]["name"] == "defense"), None),
            "specialAttack": next((s["base_stat"] for s in pokemon["stats"] if s["stat"]["name"] == "special-attack"), None),
            "specialDefense":next((s["base_stat"] for s in pokemon["stats"] if s["stat"]["name"] == "special-defense"), None),
            "speed":         next((s["base_stat"] for s in pokemon["stats"] if s["stat"]["name"] == "speed"), None),
        },
        "types":  [t["type"]["name"] for t in pokemon["types"]],
        "height": pokemon["height"],
        "weight": pokemon["weight"],
        "cry":    pokemon.get("cries", {}).get("latest"),
    }


# ---------------------------------------------------------------------------
# Routes — Static file
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    # Serve the main HTML page.
    return send_from_directory(".", "index.html")


# ---------------------------------------------------------------------------
# Routes — PokéAPI proxy
# ---------------------------------------------------------------------------
# WHY A PROXY?
# The browser could call PokéAPI directly with fetch(), but:
#   • We want to reshape the response to only what the frontend needs.
#   • A server-side proxy hides implementation details and makes the
#     frontend code much simpler.
#   • It also lets us add caching later without changing the frontend.
#
# The `?lang=en` query parameter is passed through to build_pokemon_data()
# so the description is returned in the right language.

@app.get("/pokemon/<identifier>")
def get_pokemon(identifier):
    """Fetch a Pokémon by name or National Dex number.

    The frontend calls: GET /pokemon/pikachu  or  GET /pokemon/25
    This handler calls PokéAPI, reshapes the data, and returns JSON.

    TODO for students:
      1. Make the first requests.get() call to PokéAPI using `identifier`.
         The URL pattern is: https://pokeapi.co/api/v2/pokemon/{identifier}
      2. Check if the response was successful with response.ok (or
         response.status_code == 200).  Return a 404 error if not found.
      3. Parse the JSON body with response.json().
      4. Fetch the species data using the URL stored in pokemon["species"]["url"].
      5. Get the `lang` query param with request.args.get("lang", "en").
      6. Call build_pokemon_data() and return the result with jsonify().
    """
    try:
        # --- Step 1: Fetch basic Pokémon data from PokéAPI ---
        # TODO: Replace `None` with the actual requests.get() call.
        #       The PokéAPI base URL is https://pokeapi.co/api/v2/pokemon/
        #       Always lowercase the identifier so "Pikachu" and "pikachu" both work.
        response = None  # TODO

        # --- Step 2: Handle "not found" ---
        # TODO: Check response.ok (True if status code is 200–299).
        #       If the Pokémon wasn't found, return a 404 JSON error.

        # --- Step 3: Parse the JSON ---
        # TODO: Replace `None` with response.json()
        pokemon = None  # TODO

        # --- Step 4: Fetch species data (needed for the description text) ---
        # The pokemon dict has a "species" key whose "url" value points to
        # the species endpoint.  Fetch it the same way you fetched pokemon.
        # TODO: Replace `None` with the actual requests.get() call.
        species_res = None   # TODO
        species_data = None  # TODO: parse species_res.json()

        # --- Step 5: Get the language from the query string ---
        # The frontend passes ?lang=fr etc.  Default to "en" if omitted.
        # TODO: Replace `None` with request.args.get(...)
        lang = None  # TODO

        # --- Step 6: Return the shaped data ---
        # TODO: Replace `None` with build_pokemon_data(pokemon, species_data, lang)
        #       and wrap it with jsonify()
        return None  # TODO

    except requests.RequestException as e:
        print(f"Request error: {e}")
        return jsonify({"error": "Failed to fetch Pokémon"}), 500


# ---------------------------------------------------------------------------
# Routes — Storage (SQLite)
# ---------------------------------------------------------------------------
# These three endpoints let the frontend read and write the player's
# Pokémon boxes.  Data is persisted in pokedex.db.
#
# The response shape for GET /storage is a JSON array of 10 arrays,
# matching the `storage` variable in script.js exactly:
#   [ [], [], [{id:1, name:"bulbasaur", sprites:{...}}], [], ... ]

@app.get("/storage")
def get_storage():
    """Return all 10 storage boxes as a JSON array of arrays.

    Reads every row from box_pokemon, ordered by box then insertion order,
    and groups them into the 10-element list the frontend expects.
    """
    con = get_db()
    rows = con.execute(
        "SELECT * FROM box_pokemon ORDER BY box_index, id"
    ).fetchall()
    con.close()

    # Build the empty 10-box structure first, then fill it in.
    boxes = [[] for _ in range(STORAGE_SIZE)]
    for row in rows:
        # Reconstruct the sprites object shape that the frontend expects.
        boxes[row["box_index"]].append({
            "id":   row["pokemon_id"],
            "name": row["pokemon_name"],
            "sprites": {
                "front_default": row["sprite_front"],
                "official": {
                    "default": row["sprite_official_default"],
                    "shiny":   row["sprite_official_shiny"],
                },
            },
        })

    return jsonify(boxes)


@app.post("/storage/<int:box_index>")
def add_to_box(box_index):
    """Add a Pokémon to a storage box.

    Expects a JSON body: { "id": 25, "name": "pikachu", "sprites": {...} }

    Uses INSERT OR IGNORE so that adding a Pokémon that is already in the
    box is a no-op (the UNIQUE constraint handles duplicates silently).

    IMPORTANT: Always use parameterised queries (the `?` placeholders) when
    inserting user-supplied data into SQL.  Never build SQL strings with
    string formatting — that opens you up to SQL injection attacks.
    """
    if box_index < 0 or box_index >= STORAGE_SIZE:
        return jsonify({"error": "Invalid box index"}), 400

    data = request.get_json()
    if not data or "id" not in data or "name" not in data:
        return jsonify({"error": "Missing pokemon data"}), 400

    sprites  = data.get("sprites", {})
    official = sprites.get("official", {})

    con = get_db()
    try:
        con.execute(
            """INSERT OR IGNORE INTO box_pokemon
               (box_index, pokemon_id, pokemon_name,
                sprite_front, sprite_official_default, sprite_official_shiny)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                box_index,
                data["id"],
                data["name"],
                sprites.get("front_default"),
                official.get("default"),
                official.get("shiny"),
            ),
        )
        con.commit()
    finally:
        con.close()

    return jsonify({"ok": True})


@app.delete("/storage/<int:box_index>/<int:pokemon_id>")
def remove_from_box(box_index, pokemon_id):
    """Remove a Pokémon from a storage box.

    This is an idempotent operation — deleting something that isn't there
    is not an error; we just return {"ok": True} either way.
    """
    con = get_db()
    con.execute(
        "DELETE FROM box_pokemon WHERE box_index = ? AND pokemon_id = ?",
        (box_index, pokemon_id),
    )
    con.commit()
    con.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", PORT))
    app.run(host="0.0.0.0", port=port, debug=False)
