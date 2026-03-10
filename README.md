# Pokédex Project — Student Instructions

## What You're Building

A fully functional Pokédex web app — just like the one from the games.

You can search for any Pokémon, hear its name and description read aloud, toggle its shiny form, and save your favorites into 10 storage boxes that persist between sessions.

The frontend (HTML, CSS, JavaScript) is already complete. **Your job is to finish the Python backend** in `server.py`.

---

## What You'll Learn

- **Python as a web server** — using Flask to handle HTTP requests and serve files
- **Calling a third-party API** — fetching data from PokéAPI with the `requests` library
- **SQLite databases** — storing and retrieving data with Python's built-in `sqlite3` module
- **REST API design** — how GET, POST, and DELETE requests map to database operations

---

## Project Structure

```
pokedex-starter-code/
├── server.py        ← YOU WORK HERE (Python backend)
├── index.html       ← already complete (do not edit)
├── script.js        ← already complete (do not edit)
├── styles.css       ← already complete (do not edit)
├── requirements.txt ← Python dependencies
└── README.md        ← this file
```

---

## Getting Started

**1. Install dependencies**

```bash
pip install -r requirements.txt
```

**2. Run the server**

```bash
python server.py
```

**3. Open the app**

Go to [http://localhost:3000](http://localhost:3000) in your browser.

The page will load but searching for Pokémon won't work yet — that's your task!

---

## How the App Works (Big Picture)

```
Browser (script.js)
    │
    │  GET /pokemon/pikachu?lang=en
    ▼
server.py  ← YOU ARE HERE
    │
    │  GET https://pokeapi.co/api/v2/pokemon/pikachu
    ▼
PokéAPI (external service)
    │
    └─ returns cleaned JSON back to the browser
```

The browser never talks to PokéAPI directly. It talks to **your Flask server**, which acts as a middleman (called a *proxy*). This is a very common pattern in real web development.

Storage works differently:

```
Browser (script.js)
    │
    │  POST /storage/2   (add Bulbasaur to box 2)
    ▼
server.py
    │
    │  INSERT INTO box_pokemon ...
    ▼
pokedex.db  (SQLite file on disk)
```

---

## Your Tasks

All your work is in `server.py` inside the `get_pokemon` function.
Look for the `# TODO` comments — each one is a step to complete.

### Step 1 — Fetch basic Pokémon data from PokéAPI

Use the `requests` library to call PokéAPI.

```python
response = requests.get(f"https://pokeapi.co/api/v2/pokemon/{identifier.lower()}")
```

> `identifier` is the Pokémon name or number from the URL.
> `.lower()` normalises it so "Pikachu" and "pikachu" both work.

---

### Step 2 — Handle "not found"

If the Pokémon doesn't exist, PokéAPI returns a 404 status code.
Check for it and return an error so the browser knows what went wrong:

```python
if not response.ok:
    return jsonify({"error": "Pokémon not found"}), 404
```

`response.ok` is `True` when the status code is 200–299, `False` otherwise.

---

### Step 3 — Parse the JSON response

The `response` object contains the raw HTTP response.
Call `.json()` on it to get a Python dictionary:

```python
pokemon = response.json()
```

Now `pokemon` is a dict with keys like `"name"`, `"sprites"`, `"stats"`, etc.

---

### Step 4 — Fetch the species data

The text description ("A strange seed was planted...") lives in a *separate* endpoint.
PokéAPI helpfully gives you the URL inside the pokemon data:

```python
species_res = requests.get(pokemon["species"]["url"])
species_data = species_res.json()
```

> `pokemon["species"]["url"]` is something like
> `https://pokeapi.co/api/v2/pokemon-species/1/`

---

### Step 5 — Get the language from the query string

The browser passes a `?lang=fr` query parameter so descriptions appear in the right language.
Read it from the request:

```python
lang = request.args.get("lang", "en")
```

`"en"` is the default if no `lang` param is provided.

---

### Step 6 — Return the shaped data

Pass everything to the helper function and return the result as JSON:

```python
return jsonify(build_pokemon_data(pokemon, species_data, lang))
```

`build_pokemon_data` (already written above your function) extracts only the fields the frontend needs from the large PokéAPI responses.

---

## Testing Your Work

Once all 6 steps are done:

1. Restart the server (`Ctrl+C`, then `python server.py`)
2. Open [http://localhost:3000](http://localhost:3000)
3. Type `pikachu` in the search box and press Enter — you should see Pikachu!
4. Try a number like `6` (Charizard) — names and IDs both work
5. Change the language dropdown — the description should update
6. Click a storage box, then click the star — the Pokémon is saved
7. **Refresh the page** — the saved Pokémon should still be there (stored in SQLite)

To inspect the database directly, run this in your terminal:

```bash
sqlite3 pokedex.db "SELECT box_index, pokemon_name FROM box_pokemon;"
```

---

## Concepts Explained

### What is Flask?

Flask is a Python library that turns your script into an HTTP server.
You define *routes* with `@app.get(...)` / `@app.post(...)` decorators, and Flask calls
the matching function when a request arrives at that URL.

```python
@app.get("/pokemon/<identifier>")
def get_pokemon(identifier):
    # This runs when the browser requests GET /pokemon/pikachu
    ...
```

### What is a REST API?

A REST API uses standard HTTP methods to perform actions:

| Method   | Purpose          | Example in this project          |
|----------|------------------|----------------------------------|
| `GET`    | Read data        | Fetch a Pokémon, load boxes      |
| `POST`   | Create/add data  | Add a Pokémon to a storage box   |
| `DELETE` | Remove data      | Remove a Pokémon from a box      |

### What is SQLite?

SQLite is a relational database stored as a single file (`pokedex.db`).
It comes built into Python — no installation needed.

Unlike MySQL or PostgreSQL, SQLite needs no separate server process.
It's perfect for small projects, local development, and learning.

### What are parameterized queries?

When inserting user data into SQL, **never** do this:

```python
# DANGEROUS — allows SQL injection attacks
con.execute(f"INSERT INTO table VALUES ({user_input})")
```

Always use `?` placeholders instead:

```python
# SAFE — Python passes values separately, preventing injection
con.execute("INSERT INTO table VALUES (?)", (user_input,))
```

This is already done for you in the storage endpoints — notice the pattern
and use it if you ever write your own SQL.

---

## What's Already Done For You

These parts of `server.py` are fully implemented so you can focus on the core tasks:

- **Database setup** (`init_db`, `get_db`) — creates `pokedex.db` and the table on startup
- **`build_pokemon_data()`** — reshapes the raw PokéAPI response into clean JSON
- **`GET /storage`** — reads all 10 boxes from the database
- **`POST /storage/<box_index>`** — saves a Pokémon to a box
- **`DELETE /storage/<box_index>/<pokemon_id>`** — removes a Pokémon from a box

---

## Stretch Goals

Finished early? Try these:

1. **Cache responses** — store Pokémon data in a Python dict so the same Pokémon isn't fetched from PokéAPI twice per server session
2. **Stats endpoint** — add a `GET /storage/stats` route that returns how many Pokémon are in each box
3. **Search endpoint** — add a `GET /search?q=char` route that returns a list of Pokémon names matching the query (hint: PokéAPI has a `/pokemon?limit=1000` endpoint)
4. **Error page** — instead of an `alert()`, render a friendly error message in the Pokédex screen when a Pokémon isn't found
