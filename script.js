let currentId = null;
let speechVolume = parseFloat(localStorage.getItem("speechVolume") ?? "0.3");
let currentVoice = null;
const isAndroid = /android/i.test(navigator.userAgent);
let currentCryUrl = null;
let currentLang = "en";
let isShiny = false;
let currentSprites = null;

// Storage / favourites
// Each of the 10 boxes holds an array of pokemon objects.
// Data is now persisted server-side in SQLite via the /storage API.
const STORAGE_SIZE = 10;
let storage = Array.from({ length: STORAGE_SIZE }, () => []); // empty default until loaded
let selectedBox = 0;      // which box is selected (0-9)
let boxCursor = 0;        // position within selectedBox's pokemon list
let boxEverSelected = false; // don't highlight until user has clicked a box

// Fetch all boxes from the server on page load.
// The UI renders the empty default immediately, then re-renders once data arrives.
async function loadStorage() {
  try {
    const res = await fetch("/storage");
    if (!res.ok) throw new Error("Failed to load storage");
    storage = await res.json();
  } catch (err) {
    console.warn("Could not load storage from server:", err);
    // storage stays as empty default — app still works offline
  }
  updateStorageUI();
}

// Save a pokemon to a box on the server.
async function addToBox(boxIndex, pokemon) {
  try {
    await fetch(`/storage/${boxIndex}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pokemon),
    });
  } catch (err) {
    console.warn("Could not save to box:", err);
  }
}

// Remove a pokemon from a box on the server.
async function removeFromBox(boxIndex, pokemonId) {
  try {
    await fetch(`/storage/${boxIndex}/${pokemonId}`, { method: "DELETE" });
  } catch (err) {
    console.warn("Could not remove from box:", err);
  }
}

function updateStorageUI() {
  document.querySelectorAll(".storage-box").forEach((box, i) => {
    box.classList.toggle("occupied", storage[i].length > 0);
    box.classList.toggle("selected", boxEverSelected && i === selectedBox);
  });
}

function isInSelectedBox() {
  return currentId != null && storage[selectedBox].some(p => p.id === currentId);
}

function updateFavoriteBtn() {
  const btn = document.getElementById("favoriteBtn");
  btn.classList.toggle("favorited", isInSelectedBox());
}

function showBoxView(boxIndex) {
  document.getElementById("pokemonView").style.display = "none";
  document.getElementById("boxView").style.display = "block";

  const box = storage[boxIndex];
  document.getElementById("boxViewTitle").textContent = `Box ${boxIndex + 1}`;
  document.getElementById("boxViewCount").textContent =
    box.length === 0 ? "empty" : `${box.length} Pokémon`;

  const list = document.getElementById("boxViewList");
  list.innerHTML = "";

  if (box.length === 0) {
    const empty = document.createElement("div");
    empty.className = "box-empty";
    empty.textContent = "No Pokémon stored here yet.";
    list.appendChild(empty);
    return;
  }

  box.forEach((pokemon, i) => {
    const entry = document.createElement("div");
    entry.className = "box-entry";

    const num = document.createElement("span");
    num.className = "box-entry-num";
    num.textContent = i + 1;

    const img = document.createElement("img");
    img.src = pokemon.sprites?.front_default || pokemon.sprites?.official?.default || "";
    img.alt = pokemon.name;

    const name = document.createElement("span");
    name.className = "box-entry-name";
    name.textContent = pokemon.name;

    entry.append(num, img, name);
    entry.addEventListener("click", () => {
      boxCursor = i;
      fetchPokemon(pokemon.id);
    });
    list.appendChild(entry);
  });
}

function hiddenBoxView() {
  document.getElementById("pokemonView").style.display = "block";
  document.getElementById("boxView").style.display = "none";
}

// Maps TTS BCP-47 prefix → PokeAPI language name
const ttsToPokeApiLang = {
  en: "en", fr: "fr", de: "de", es: "es", it: "it",
  ja: "ja", ko: "ko", zh: "zh-Hans"
};

const LANG_CONFIG = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-MX", label: "Spanish", fallback: v => v.lang.startsWith("es-") && v.lang !== "es-ES" },
  { code: "es-ES", label: "European Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "it-IT", label: "Italian" },
];

// Language-only dropdown used on Android (voice switching is unreliable there)
const LANG_DROPDOWN = [
  { label: "English",  bcp47: "en-US", pokeApi: "en" },
  { label: "French",   bcp47: "fr-FR", pokeApi: "fr" },
  { label: "German",   bcp47: "de-DE", pokeApi: "de" },
  { label: "Spanish",  bcp47: "es-ES", pokeApi: "es" },
  { label: "Italian",  bcp47: "it-IT", pokeApi: "it" },
  { label: "Japanese", bcp47: "ja-JP", pokeApi: "ja" },
  { label: "Korean",   bcp47: "ko-KR", pokeApi: "ko" },
];

function populateLangSelect() {
  const sel = document.getElementById("langSelect");
  LANG_DROPDOWN.forEach(({ label, bcp47, pokeApi }) => {
    const opt = document.createElement("option");
    opt.value = pokeApi;
    opt.dataset.bcp47 = bcp47;
    opt.textContent = label;
    sel.appendChild(opt);
  });
  const saved = localStorage.getItem("currentLang");
  if (saved && sel.querySelector(`option[value="${saved}"]`)) sel.value = saved;
  currentLang = sel.value;
}

function populateVoices() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  const voiceSelect = document.getElementById("voiceSelect");
  const prevValue = voiceSelect.value;
  voiceSelect.innerHTML = "";

  LANG_CONFIG.forEach(({ code, label, fallback }) => {
    let matching = voices.filter(v => v.lang === code);
    if (!matching.length && fallback) matching = voices.filter(fallback);
    matching.forEach(voice => {
      const option = document.createElement("option");
      option.value = voices.indexOf(voice);
      option.textContent = matching.length > 1 ? `${label} - ${voice.name}` : label;
      voiceSelect.appendChild(option);
    });
  });

  if (prevValue && voiceSelect.querySelector(`option[value="${prevValue}"]`)) {
    voiceSelect.value = prevValue;
  } else {
    const savedName = localStorage.getItem("voiceName");
    const savedOption = savedName && Array.from(voiceSelect.options).find(opt => voices[opt.value]?.name === savedName);
    if (savedOption) {
      voiceSelect.value = savedOption.value;
    } else {
      const enGBOption = Array.from(voiceSelect.options).find(opt => voices[opt.value]?.lang === "en-GB");
      if (enGBOption) voiceSelect.value = enGBOption.value;
    }
  }
  currentVoice = voices[voiceSelect.value] ?? voices[voiceSelect.options[0]?.value] ?? null;
  if (currentVoice) {
    const prefix = currentVoice.lang.split("-")[0];
    currentLang = ttsToPokeApiLang[prefix] || prefix;
  }
}

// On Android voice switching is unreliable — show a language dropdown instead.
// On all other platforms, populate the voice dropdown and wire up async loading.
if (isAndroid) {
  document.getElementById("voiceSelect").style.display = "none";
  document.getElementById("langSelect").style.display = "";
  populateLangSelect();
} else {
  document.getElementById("langSelect").style.display = "none";
  populateVoices();
  window.speechSynthesis.addEventListener("voiceschanged", populateVoices);

  // Polling fallback: Android Chrome and iOS Safari often don't fire voiceschanged
  // reliably, or return empty from getVoices() until async loading completes.
  const _voicePoll = setInterval(() => {
    if (window.speechSynthesis.getVoices().length) {
      populateVoices();
      clearInterval(_voicePoll);
    }
  }, 250);
  setTimeout(() => clearInterval(_voicePoll), 10000); // stop polling after 10s

  // iOS Safari: voices are gated behind a user gesture. On first touch, nudge
  // the API and re-attempt population after a short delay.
  document.addEventListener("touchstart", () => {
    window.speechSynthesis.getVoices(); // triggers async load on iOS
    setTimeout(populateVoices, 100);
  }, { once: true });
}

document.getElementById("voiceSelect").addEventListener("change", (e) => {
  const voices = window.speechSynthesis.getVoices();
  currentVoice = voices[e.target.value];
  if (currentVoice) {
    localStorage.setItem("voiceName", currentVoice.name);
    const prefix = currentVoice.lang.split("-")[0];
    currentLang = ttsToPokeApiLang[prefix] || prefix;
    if (currentId) fetchPokemon(currentId);
  }
});

document.getElementById("langSelect").addEventListener("change", (e) => {
  currentLang = e.target.value;
  localStorage.setItem("currentLang", currentLang);
  if (currentId) fetchPokemon(currentId);
});
let volumeBarTimeout = null;

function showVolumeBar() {
  const bar = document.getElementById("volumeBar");
  const fill = document.getElementById("volumeBarFill");
  const icon = document.getElementById("volumeIcon");
  fill.style.width = (speechVolume * 100) + "%";
  icon.textContent = speechVolume === 0 ? "🔇" : "🔊";
  bar.classList.add("visible");
  clearTimeout(volumeBarTimeout);
  volumeBarTimeout = setTimeout(() => bar.classList.remove("visible"), 1500);
}

async function fetchPokemon(identifier) {
  try {
    const res = await fetch(`/pokemon/${identifier}?lang=${currentLang}`);
    if (!res.ok) throw new Error("Pokémon not found");
    const data = await res.json();
    displayPokemon(data);
  } catch (err) {
    alert(err.message);
  }
}

function displayPokemon(pokemon) {
  currentId = pokemon.id;
  isShiny = false;
  currentSprites = pokemon.sprites;
  document.getElementById("shinyBtn").querySelector("circle").setAttribute("fill", "#b71c1c");
  hiddenBoxView();
  updateFavoriteBtn();
  document.getElementById("screenText").style.display = "none";
  const img = document.getElementById("pokemonImage");
  img.src = pokemon.sprites?.official?.default || pokemon.sprites?.front_default || "";
  img.alt = pokemon.name;
  img.style.display = "block";
  document.getElementById("pokemonName").textContent = pokemon.name.charAt(0).toUpperCase() + pokemon.name.slice(1);
  document.getElementById("pokemonDescription").textContent = pokemon.description;
  const camera = document.querySelector(".camera");
  camera.classList.remove("flash");
  window.speechSynthesis.cancel();

  let flashInterval = null;

  const doFlash = () => {
    camera.classList.remove("flash");
    camera.classList.add("flash");
    setTimeout(() => camera.classList.remove("flash"), 140);
  };

  const startFallbackInterval = () => {
    if (flashInterval) clearInterval(flashInterval);
    flashInterval = setInterval(doFlash, 350);
  };

  const stopFlash = () => {
    if (flashInterval) {
      clearInterval(flashInterval);
      flashInterval = null;
    }
    camera.classList.remove("flash");
  };

  const attachFlash = (utterance) => {
    utterance.onstart = startFallbackInterval;
    utterance.addEventListener("boundary", (event) => {
      if (event.name !== "word") return;
      doFlash();
      startFallbackInterval(); // reset interval so it stays in step with words
    });
  };

  const makeUtterance = (text) => {
    const u = new SpeechSynthesisUtterance(text);
    u.volume = speechVolume;
    u.lang = currentLang;
    if (!isAndroid && currentVoice) u.voice = currentVoice;
    return u;
  };

  const nameUtterance = makeUtterance(pokemon.name);
  attachFlash(nameUtterance);
  nameUtterance.onerror = stopFlash;
  nameUtterance.onend = () => {
    const descUtterance = makeUtterance(pokemon.description);
    attachFlash(descUtterance);
    descUtterance.onend = stopFlash;
    descUtterance.onerror = stopFlash;
    window.speechSynthesis.speak(descUtterance);
  };

  window.speechSynthesis.speak(nameUtterance);
  document.getElementById("pokemonId").textContent = `#${pokemon.id}`;
  document.getElementById("pokemonType").textContent = pokemon.types.join(", ");
  document.getElementById("pokemonHeight").textContent = `Height: ${(pokemon.height / 10).toFixed(1)} m`;
  document.getElementById("pokemonWeight").textContent = `Weight: ${(pokemon.weight / 10).toFixed(1)} kg`;
  currentCryUrl = pokemon.cry ?? null;
  document.getElementById("cryBtn").disabled = !currentCryUrl;
}

document.getElementById("shinyBtn").addEventListener("click", () => {
  if (!currentSprites) return;
  isShiny = !isShiny;
  const img = document.getElementById("pokemonImage");
  const btn = document.getElementById("shinyBtn").querySelector("circle");
  if (isShiny) {
    img.src = currentSprites.official?.shiny || currentSprites.front_default || "";
    btn.setAttribute("fill", "#f4c430");
  } else {
    img.src = currentSprites.official?.default || currentSprites.front_default || "";
    btn.setAttribute("fill", "#b71c1c");
  }
});

document.getElementById("searchBtn").addEventListener("click", () => {
  const val = document.getElementById("pokemonInput").value.trim().toLowerCase();
  if (val) fetchPokemon(val);
});

document.getElementById("pokemonInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = e.target.value.trim().toLowerCase();
    if (val) fetchPokemon(val);
  }
});

document.getElementById("cryBtn").addEventListener("click", () => {
  if (currentCryUrl) {
    const cry = new Audio(currentCryUrl);
    cry.volume = speechVolume * 0.5;
    cry.play();
  }
});

document.getElementById("volDownBtn").addEventListener("click", () => {
  speechVolume = Math.max(0, parseFloat((speechVolume - 0.05).toFixed(2)));
  localStorage.setItem("speechVolume", speechVolume);
  showVolumeBar();
});

document.getElementById("volUpBtn").addEventListener("click", () => {
  speechVolume = Math.min(1, parseFloat((speechVolume + 0.05).toFixed(2)));
  localStorage.setItem("speechVolume", speechVolume);
  showVolumeBar();
});

// Storage box click — select that box and show its contents
document.querySelectorAll(".storage-box").forEach((box) => {
  box.addEventListener("click", () => {
    selectedBox = parseInt(box.dataset.slot);
    boxCursor = 0;
    boxEverSelected = true;
    updateStorageUI();
    updateFavoriteBtn();
    showBoxView(selectedBox);
  });
});

// Favourite button — append/remove current pokemon in the selected box
document.getElementById("favoriteBtn").addEventListener("click", async () => {
  if (!currentId || !currentSprites) return;
  if (isInSelectedBox()) {
    storage[selectedBox] = storage[selectedBox].filter(p => p.id !== currentId);
    boxCursor = Math.max(0, Math.min(boxCursor, storage[selectedBox].length - 1));
    await removeFromBox(selectedBox, currentId);
  } else {
    const pokemon = {
      id: currentId,
      name: document.getElementById("pokemonName").textContent,
      sprites: currentSprites,
    };
    storage[selectedBox].push(pokemon);
    boxCursor = storage[selectedBox].length - 1;
    await addToBox(selectedBox, pokemon);
  }
  updateStorageUI();
  updateFavoriteBtn();
  if (document.getElementById("boxView").style.display !== "none") {
    showBoxView(selectedBox);
  }
});

// Storage prev/next buttons — change which box is selected
document.getElementById("storagePrevBtn").addEventListener("click", () => {
  if (selectedBox > 0) { selectedBox--; boxCursor = 0; boxEverSelected = true; updateStorageUI(); updateFavoriteBtn(); showBoxView(selectedBox); }
});

document.getElementById("storageNextBtn").addEventListener("click", () => {
  if (selectedBox < STORAGE_SIZE - 1) { selectedBox++; boxCursor = 0; boxEverSelected = true; updateStorageUI(); updateFavoriteBtn(); showBoxView(selectedBox); }
});

// prevBtn/nextBtn — cycle through pokemon within the selected box
document.getElementById("prevBtn").addEventListener("click", () => {
  const box = storage[selectedBox];
  if (!box.length) return;
  boxCursor = (boxCursor - 1 + box.length) % box.length;
  fetchPokemon(box[boxCursor].id);
});

document.getElementById("nextBtn").addEventListener("click", () => {
  const box = storage[selectedBox];
  if (!box.length) return;
  boxCursor = (boxCursor + 1) % box.length;
  fetchPokemon(box[boxCursor].id);
});

// Init storage: fetch boxes from server, then render the UI.
loadStorage();

document.getElementById("dpadLeft").addEventListener("click", () => {
  if (currentId && currentId > 1) fetchPokemon(currentId - 1);
});

document.getElementById("dpadRight").addEventListener("click", () => {
  if (currentId) fetchPokemon(currentId + 1);
  else fetchPokemon(1);
});

document.getElementById("dpadUp").addEventListener("click", () => {
  if (currentId && currentId > 10) fetchPokemon(currentId - 10);
  else if (currentId) fetchPokemon(1);
});

document.getElementById("dpadDown").addEventListener("click", () => {
  if (currentId) fetchPokemon(currentId + 10);
  else fetchPokemon(10);
});

// Mobile panel navigation
const pokedex = document.querySelector(".pokedex");

function isMobile() {
  return window.innerWidth <= 768;
}

document.querySelector(".nav-arrow-right").addEventListener("click", () => {
  if (isMobile()) pokedex.style.transform = "translateX(-50%)";
});

document.querySelector(".nav-arrow-left").addEventListener("click", () => {
  if (isMobile()) pokedex.style.transform = "translateX(0)";
});

window.addEventListener("resize", () => {
  if (!isMobile()) pokedex.style.transform = "";
});
