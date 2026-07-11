const GRADIENTS = [
  "linear-gradient(160deg,#ff3860,#7b2ff7)",
  "linear-gradient(160deg,#ff7a45,#c91e63)",
  "linear-gradient(160deg,#2b5876,#4e4376)",
  "linear-gradient(160deg,#c31432,#240b36)",
  "linear-gradient(160deg,#834d9b,#d04ed6)",
  "linear-gradient(160deg,#ee0979,#ff6a00)",
  "linear-gradient(160deg,#0f2027,#2c5364)",
  "linear-gradient(160deg,#8e2de2,#4a00e0)",
  "linear-gradient(160deg,#e53935,#e35d5b)",
  "linear-gradient(160deg,#360033,#0b8793)",
];

const DRAMAS = [
  { id: "d1", title: "The Billionaire's Fake Fiancée", genre: "romance", label: "Age Gap", badge: "Trending", views: "42.1M", desc: "She signed a fake engagement contract to save her family. He never told her the ring was real.", episodes: 42, free: 3 },
  { id: "d2", title: "CEO's Secret Baby", genre: "romance", label: "Young Adult", badge: "Hot", views: "38.7M", desc: "Five years after she vanished, she returns with his son — and he wants them both back.", episodes: 36, free: 3 },
  { id: "d3", title: "Revenge of the Discarded Wife", genre: "revenge", label: "Revenge", badge: "New", views: "21.4M", desc: "Cast aside for a socialite, she rebuilds herself into the one woman this city cannot ignore.", episodes: 50, free: 4 },
  { id: "d4", title: "Alpha's Rejected Mate", genre: "fantasy", label: "Werewolf", badge: "Trending", views: "55.9M", desc: "Rejected by her wolf mate in front of the pack, she discovers a power older than the moon itself.", episodes: 60, free: 3 },
  { id: "d5", title: "Married to the Mafia King", genre: "revenge", label: "Family Drama", badge: "", views: "19.2M", desc: "A marriage of convenience turns dangerous when she becomes the only one he trusts.", episodes: 34, free: 3 },
  { id: "d6", title: "My Ex-Husband is a Billionaire", genre: "romance", label: "Age Gap", badge: "New", views: "15.8M", desc: "She didn't know the man she divorced broke was secretly worth billions — until he showed up at her wedding.", episodes: 28, free: 3 },
  { id: "d7", title: "The Contract Bride", genre: "romance", label: "Young Adult", badge: "Dubbed", views: "12.3M", desc: "One signature bound them together. Neither expected to fall for the terms of the deal.", episodes: 30, free: 3 },
  { id: "d8", title: "Twin Swap Wedding", genre: "fantasy", label: "Male Lead", badge: "Hot", views: "27.6M", desc: "She took her twin's place at the altar to save the family — now she can't escape the marriage, or her feelings.", episodes: 40, free: 3 },
];

const COIN_PACKAGES = [
  { coins: 100, price: "$0.99" },
  { coins: 350, price: "$2.99" },
  { coins: 800, price: "$5.99" },
  { coins: 2000, price: "$12.99" },
];

const UNLOCK_COST = 30;

const state = {
  coins: 0,
  unlocked: {},
  followed: {},
  likes: {},
  view: "home",
  currentDrama: null,
  currentEpIndex: 0,
  topTab: "hot",
  subGenre: "all",
  searchTerm: "",
  vip: false,
  checkedInDays: 0,
  lastCheckIn: null,
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("reelapp_state") || "{}");
    Object.assign(state, saved);
  } catch (e) {}
  if (!state.coins && state.coins !== 0) state.coins = 0;
  if (typeof state.coinsInit === "undefined") {
    state.coins = 120;
    state.coinsInit = true;
  }
}
function saveState() {
  localStorage.setItem("reelapp_state", JSON.stringify(state));
}

function gradientFor(seedStr, offset) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return GRADIENTS[(h + (offset || 0)) % GRADIENTS.length];
}

function isUnlocked(dramaId, epNum, freeCount) {
  if (epNum <= freeCount) return true;
  const key = dramaId + ":" + epNum;
  return !!state.unlocked[key];
}
function isDramaFullyUnlocked(drama) {
  return !!state.unlocked["ALL:" + drama.id];
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

function updateCoinDisplays() {
  document.querySelectorAll("[data-coin-balance]").forEach(el => el.textContent = state.coins);
}

/* ---------------- Views ---------------- */
function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  state.view = name;
  document.getElementById("bottomNav").style.display = (name === "player") ? "none" : "flex";
  const tabForView = { home: "home", foryou: "foryou", mylist: "mylist", rewards: "rewards", mine: "profile" };
  if (tabForView[name]) {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === tabForView[name]));
  }
}

function renderFeed() {
  const feed = document.getElementById("feed");
  feed.innerHTML = "";
  document.getElementById("subGenreTabs").style.display = state.topTab === "category" ? "flex" : "none";

  let list;
  if (state.topTab === "anime" || state.topTab === "novel") {
    feed.innerHTML = '<div class="empty-state">More ' + state.topTab + ' titles launching soon.</div>';
    return;
  } else if (state.topTab === "new") {
    list = DRAMAS.filter(d => d.badge === "New");
  } else if (state.topTab === "ranking") {
    list = [...DRAMAS].sort((a, b) => parseFloat(b.views) - parseFloat(a.views));
  } else if (state.topTab === "category") {
    list = DRAMAS.filter(d => state.subGenre === "all" || d.genre === state.subGenre);
  } else {
    list = DRAMAS;
  }

  if (state.searchTerm) {
    const q = state.searchTerm.toLowerCase();
    list = list.filter(d => d.title.toLowerCase().includes(q));
  }

  if (!list.length) {
    feed.innerHTML = '<div class="empty-state">No dramas found.</div>';
    return;
  }

  list.forEach((d, i) => {
    const card = document.createElement("div");
    card.className = "poster-card";
    const rankBadge = state.topTab === "ranking" && i < 3
      ? `<span class="poster-rank rank-${i + 1}">#${i + 1}</span>`
      : (d.badge ? `<span class="poster-badge ${d.badge.toLowerCase()}">${d.badge}</span>` : "");
    card.innerHTML = `
      <div class="poster-cover" style="background:${gradientFor(d.id)}">
        ${rankBadge}
        <span class="poster-views">▶ ${d.views}</span>
      </div>
      <h3 class="poster-title">${d.title}</h3>
      <p class="poster-genre">${d.label}</p>`;
    card.addEventListener("click", () => openDetail(d.id));
    feed.appendChild(card);
  });
}

function renderMyList() {
  const wrap = document.getElementById("mylistFeed");
  wrap.innerHTML = "";
  const list = DRAMAS.filter(d => state.followed[d.id]);
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state">Series you follow will show up here.<br>Tap the heart on any series to save it.</div>';
    return;
  }
  list.forEach(d => {
    const card = document.createElement("div");
    card.className = "drama-card";
    card.innerHTML = `
      <div class="drama-cover" style="background:${gradientFor(d.id)}">
        <span class="play-glyph">▶</span>
      </div>
      <div class="drama-info">
        <h3>${d.title}</h3>
        <p class="desc">${d.desc}</p>
        <div class="drama-meta"><span class="tag">${d.episodes} EP</span></div>
      </div>`;
    card.addEventListener("click", () => openDetail(d.id));
    wrap.appendChild(card);
  });
}

function openDetail(dramaId) {
  const d = DRAMAS.find(x => x.id === dramaId);
  state.currentDrama = d;
  document.getElementById("detailHero").style.background = gradientFor(d.id);
  document.getElementById("detailTitle").textContent = d.title;
  document.getElementById("detailMeta").textContent = `${d.episodes} Episodes · ${d.views} views`;
  document.getElementById("detailDesc").textContent = d.desc;

  const followBtn = document.getElementById("followBtn");
  followBtn.textContent = state.followed[d.id] ? "✓ Following" : "+ Follow";
  followBtn.classList.toggle("following", !!state.followed[d.id]);

  const grid = document.getElementById("episodeGrid");
  grid.innerHTML = "";
  for (let n = 1; n <= d.episodes; n++) {
    const unlocked = isUnlocked(d.id, n, d.free) || isDramaFullyUnlocked(d);
    const btn = document.createElement("button");
    btn.className = "ep-btn " + (unlocked ? "unlocked" : "locked");
    btn.textContent = n;
    btn.addEventListener("click", () => openPlayer(d.id, n - 1));
    grid.appendChild(btn);
  }
  switchView("detail");
}

document.addEventListener("click", (e) => {
  if (e.target.id === "playFirstBtn") openPlayer(state.currentDrama.id, 0);
  if (e.target.id === "followBtn") {
    const d = state.currentDrama;
    state.followed[d.id] = !state.followed[d.id];
    saveState();
    openDetail(d.id);
    toast(state.followed[d.id] ? "Added to My List" : "Removed from My List");
  }
});

/* ---------------- Player ---------------- */
function openPlayer(dramaId, epIndex) {
  const d = DRAMAS.find(x => x.id === dramaId);
  state.currentDrama = d;
  const feed = document.getElementById("playerFeed");
  feed.innerHTML = "";
  for (let i = 0; i < d.episodes; i++) {
    feed.appendChild(buildPlayerCard(d, i + 1));
  }
  switchView("player");
  requestAnimationFrame(() => {
    const target = feed.children[epIndex];
    if (target) target.scrollIntoView({ block: "start" });
  });
  observePlayerCards();
}

function buildPlayerCard(d, epNum) {
  const unlocked = isUnlocked(d.id, epNum, d.free) || isDramaFullyUnlocked(d);
  const card = document.createElement("div");
  card.className = "player-card";
  card.dataset.ep = epNum;
  const likeKey = d.id + ":" + epNum;
  const baseLikes = 1200 + (epNum * 37) % 900;
  const liked = !!state.likes[likeKey];

  let dots = "";
  for (let i = 1; i <= d.episodes; i++) {
    dots += `<span class="${i < epNum ? 'done' : ''} ${i === epNum ? 'current' : ''}"></span>`;
  }

  card.innerHTML = `
    <div class="player-bg" style="background:${gradientFor(d.id, epNum)}"></div>
    <div class="player-vignette"></div>
    <div class="player-topbar">
      <button class="icon-btn" data-back="detail">←</button>
      <div class="player-dots">${dots}</div>
      <button class="icon-btn mute-btn">🔊</button>
    </div>
    <div class="player-rail">
      <button class="rail-btn like-btn ${liked ? 'liked' : ''}" data-like="${likeKey}">❤️<span>${formatCount(baseLikes + (liked ? 1 : 0))}</span></button>
      <button class="rail-btn comment-btn">💬<span>${120 + epNum % 40}</span></button>
      <button class="rail-btn share-btn2">↗️<span>Share</span></button>
      <button class="rail-btn coin-shortcut" data-open="coinModal">🪙<span data-coin-balance>${state.coins}</span></button>
    </div>
    <div class="player-bottom">
      <h3>${d.title}</h3>
      <p class="ep-label">EP ${epNum} · ${episodeSubtitle(epNum)}</p>
      <p class="ep-desc">${d.desc}</p>
    </div>
    ${!unlocked ? lockOverlayHTML(d, epNum) : ""}
  `;

  function setLiked(forceOn) {
    if (forceOn && state.likes[likeKey]) return;
    state.likes[likeKey] = forceOn ? true : !state.likes[likeKey];
    saveState();
    const btn = card.querySelector(".like-btn");
    btn.classList.toggle("liked", state.likes[likeKey]);
    btn.querySelector("span").textContent = formatCount(baseLikes + (state.likes[likeKey] ? 1 : 0));
  }

  card.querySelector('[data-back="detail"]').addEventListener("click", () => openDetail(d.id));
  card.querySelector(".mute-btn").addEventListener("click", (e) => {
    e.currentTarget.textContent = e.currentTarget.textContent.trim() === "🔊" ? "🔇" : "🔊";
  });
  card.querySelector(".like-btn").addEventListener("click", () => setLiked(false));
  card.querySelector(".comment-btn").addEventListener("click", () => openComments(d, epNum));
  card.querySelector(".share-btn2").addEventListener("click", () => openModal("shareModal"));
  card.querySelector(".coin-shortcut").addEventListener("click", () => openModal("coinModal"));

  let lastTap = 0;
  card.addEventListener("pointerup", (e) => {
    if (e.target.closest("button") || e.target.closest(".lock-overlay")) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      setLiked(true);
      spawnHeartBurst(card, e.clientX, e.clientY);
    }
    lastTap = now;
  });

  if (!unlocked) wireLockOverlay(card, d, epNum);

  return card;
}

function spawnHeartBurst(card, x, y) {
  const rect = card.getBoundingClientRect();
  const heart = document.createElement("div");
  heart.className = "heart-burst";
  heart.textContent = "❤️";
  heart.style.left = (x - rect.left) + "px";
  heart.style.top = (y - rect.top) + "px";
  card.appendChild(heart);
  heart.addEventListener("animationend", () => heart.remove());
}

function episodeSubtitle(epNum) {
  const subs = ["A Deal Neither Expected", "The Truth Comes Out", "No Way Back", "A Dangerous Promise", "What She Never Said", "The Wedding Trap", "His Real Identity", "One Last Lie"];
  return subs[epNum % subs.length];
}

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function lockOverlayHTML(d, epNum) {
  return `
    <div class="lock-overlay" data-lock-for="${epNum}">
      <div class="lock-icon">🔒</div>
      <h4>Episode ${epNum} is locked</h4>
      <p>Unlock this episode for ${UNLOCK_COST} coins, or unlock the whole series.</p>
      <button class="btn-primary" data-unlock-one="${epNum}">Unlock for ${UNLOCK_COST} 🪙</button>
      <button class="btn-ghost" data-unlock-all="1">Unlock All — ${d.episodes * UNLOCK_COST * 0.4 | 0} 🪙</button>
      <button class="btn-outline" data-open="coinModal">Get More Coins</button>
    </div>`;
}

function wireLockOverlay(card, d, epNum) {
  const overlay = card.querySelector(".lock-overlay");
  overlay.querySelector("[data-unlock-one]").addEventListener("click", () => {
    if (state.coins < UNLOCK_COST) { toast("Not enough coins"); openModal("coinModal"); return; }
    state.coins -= UNLOCK_COST;
    state.unlocked[d.id + ":" + epNum] = true;
    saveState();
    updateCoinDisplays();
    overlay.remove();
    toast(`Episode ${epNum} unlocked!`);
  });
  overlay.querySelector("[data-unlock-all]").addEventListener("click", () => {
    const cost = d.episodes * UNLOCK_COST * 0.4 | 0;
    if (state.coins < cost) { toast("Not enough coins"); openModal("coinModal"); return; }
    state.coins -= cost;
    state.unlocked["ALL:" + d.id] = true;
    saveState();
    updateCoinDisplays();
    document.querySelectorAll(".lock-overlay").forEach(o => o.remove());
    toast("Series fully unlocked!");
  });
  overlay.querySelector('[data-open="coinModal"]').addEventListener("click", () => openModal("coinModal"));
}

function observePlayerCards() {
  const cards = document.querySelectorAll(".player-card");
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
        state.currentEpIndex = Number(entry.target.dataset.ep) - 1;
      }
    });
  }, { threshold: [0.6], root: document.getElementById("playerFeed") });
  cards.forEach(c => io.observe(c));
}

/* ---------------- Comments ---------------- */
const SAMPLE_NAMES = ["Mia", "Jordan", "Aaliyah", "Sam", "Priya", "Leo", "Nora", "Ken"];
function openComments(drama, epNum) {
  const list = document.getElementById("commentList");
  list.innerHTML = "";
  const key = "comments:" + drama.id + ":" + epNum;
  const stored = state[key] || defaultComments(epNum);
  state[key] = stored;
  stored.forEach(c => list.appendChild(commentRow(c)));
  openModal("commentModal");
  document.getElementById("commentModal").dataset.key = key;
}
function defaultComments(epNum) {
  return [
    { name: SAMPLE_NAMES[epNum % SAMPLE_NAMES.length], text: "I did NOT see that twist coming 😱" },
    { name: SAMPLE_NAMES[(epNum + 3) % SAMPLE_NAMES.length], text: "someone unlock the next ep for me pleaseee" },
    { name: SAMPLE_NAMES[(epNum + 5) % SAMPLE_NAMES.length], text: "the male lead's acting in this scene 🔥🔥" },
  ];
}
function commentRow(c) {
  const row = document.createElement("div");
  row.className = "comment-item";
  row.innerHTML = `<div class="comment-avatar" style="background:${gradientFor(c.name)}">${c.name[0]}</div>
    <div class="comment-body"><b>${c.name}</b><p>${c.text}</p></div>`;
  return row;
}
document.getElementById("commentSendBtn").addEventListener("click", sendComment);
document.getElementById("commentInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendComment(); });
function sendComment() {
  const input = document.getElementById("commentInput");
  const text = input.value.trim();
  if (!text) return;
  const key = document.getElementById("commentModal").dataset.key;
  const c = { name: "You", text };
  state[key] = state[key] || [];
  state[key].push(c);
  saveState();
  document.getElementById("commentList").appendChild(commentRow(c));
  document.getElementById("commentList").scrollTop = 999999;
  input.value = "";
}

/* ---------------- Coin packages ---------------- */
function renderCoinPackages() {
  const wrap = document.getElementById("coinPackages");
  wrap.innerHTML = "";
  COIN_PACKAGES.forEach(p => {
    const el = document.createElement("div");
    el.className = "coin-pack";
    el.innerHTML = `<div class="amt">🪙 ${p.coins}</div><div class="price">${p.price}</div><button>Buy</button>`;
    el.querySelector("button").addEventListener("click", () => {
      state.coins += p.coins;
      saveState();
      updateCoinDisplays();
      toast(`+${p.coins} coins added`);
      closeModal("coinModal");
    });
    wrap.appendChild(el);
  });
}

/* ---------------- Modals ---------------- */
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.classList.remove("open"); });
});
document.addEventListener("click", (e) => {
  const openBtn = e.target.closest("[data-open]");
  if (openBtn) openModal(openBtn.dataset.open);
});

/* ---------------- Nav & tabs ---------------- */
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    if (tab === "home") { switchView("home"); renderFeed(); }
    if (tab === "foryou") { switchView("foryou"); renderForYouFeed(); }
    if (tab === "mylist") { switchView("mylist"); renderMyList(); }
    if (tab === "rewards") { switchView("rewards"); renderRewards(); }
    if (tab === "profile") { switchView("mine"); renderMine(); }
  });
});

document.querySelectorAll("#genreTabsV2 .gtab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#genreTabsV2 .gtab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.topTab = tab.dataset.top;
    renderFeed();
  });
});

document.querySelectorAll("#subGenreTabs .genre-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#subGenreTabs .genre-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.subGenre = tab.dataset.genre;
    renderFeed();
  });
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  state.searchTerm = e.target.value.trim();
  renderFeed();
});
document.getElementById("filterBtn").addEventListener("click", () => toast("More filters coming soon"));
document.getElementById("subscribeVipBtn").addEventListener("click", () => {
  state.vip = true;
  saveState();
  toast("Welcome to VIP! All series unlocked.");
  closeModal("vipModal");
});

document.querySelectorAll('[data-back="home"]').forEach(btn => {
  btn.addEventListener("click", () => switchView("home"));
});

/* ---------------- For You (cross-series swipe discovery) ---------------- */
function renderForYouFeed() {
  const feed = document.getElementById("forYouFeed");
  feed.innerHTML = "";
  DRAMAS.forEach((d) => feed.appendChild(buildForYouCard(d)));
  observeForYouCards();
}

function buildForYouCard(d) {
  const card = document.createElement("div");
  card.className = "player-card";
  const likeKey = d.id + ":foryou";
  const baseLikes = 2000 + (d.id.charCodeAt(1) * 53) % 3000;
  const liked = !!state.likes[likeKey];
  card.innerHTML = `
    <div class="player-bg" style="background:${gradientFor(d.id, 1)}"></div>
    <div class="player-vignette"></div>
    <div class="player-topbar">
      <div></div>
      <button class="icon-btn mute-btn">🔊</button>
    </div>
    <div class="player-rail">
      <button class="rail-btn like-btn ${liked ? 'liked' : ''}" data-like="${likeKey}">❤️<span>${formatCount(baseLikes + (liked ? 1 : 0))}</span></button>
      <button class="rail-btn comment-btn">💬<span>${200 + d.episodes % 50}</span></button>
      <button class="rail-btn share-btn2">↗️<span>Share</span></button>
    </div>
    <div class="player-bottom player-bottom-nav-spacer">
      <h3>${d.title}</h3>
      <p class="ep-label">${d.label} · ${d.episodes} Episodes</p>
      <p class="ep-desc">${d.desc}</p>
      <button class="btn-primary foryou-cta">▶ Watch Full Series</button>
    </div>
  `;
  card.querySelector(".like-btn").addEventListener("click", (e) => {
    state.likes[likeKey] = !state.likes[likeKey];
    saveState();
    e.currentTarget.classList.toggle("liked", state.likes[likeKey]);
    e.currentTarget.querySelector("span").textContent = formatCount(baseLikes + (state.likes[likeKey] ? 1 : 0));
  });
  card.querySelector(".comment-btn").addEventListener("click", () => openComments(d, 1));
  card.querySelector(".share-btn2").addEventListener("click", () => openModal("shareModal"));
  card.querySelector(".mute-btn").addEventListener("click", (e) => {
    e.currentTarget.textContent = e.currentTarget.textContent.trim() === "🔊" ? "🔇" : "🔊";
  });
  card.querySelector(".foryou-cta").addEventListener("click", () => openDetail(d.id));

  let lastTap = 0;
  card.addEventListener("pointerup", (e) => {
    if (e.target.closest("button")) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      if (!state.likes[likeKey]) card.querySelector(".like-btn").click();
      spawnHeartBurst(card, e.clientX, e.clientY);
    }
    lastTap = now;
  });

  return card;
}

function observeForYouCards() {
  const cards = document.querySelectorAll("#forYouFeed .player-card");
  const io = new IntersectionObserver(() => {}, { threshold: [0.6], root: document.getElementById("forYouFeed") });
  cards.forEach(c => io.observe(c));
}

/* ---------------- Rewards ---------------- */
function renderRewards() {
  const today = new Date().toDateString();
  if (state.lastCheckIn !== today) {
    document.getElementById("rewardsDot").style.display = "block";
  } else {
    document.getElementById("rewardsDot").style.display = "none";
  }

  const row = document.getElementById("streakRow");
  row.innerHTML = "";
  for (let day = 1; day <= 7; day++) {
    const claimed = day <= state.checkedInDays;
    const isNext = day === state.checkedInDays + 1;
    const chip = document.createElement("div");
    chip.className = "day-chip " + (claimed ? "claimed" : isNext ? "next" : "");
    chip.innerHTML = `<span>Day ${day}</span><b>🪙${day * 5}</b>`;
    if (isNext && state.lastCheckIn !== today) {
      chip.addEventListener("click", () => {
        state.checkedInDays += 1;
        state.lastCheckIn = today;
        state.coins += day * 5;
        saveState();
        updateCoinDisplays();
        toast(`+${day * 5} coins — Day ${day} claimed!`);
        renderRewards();
      });
    }
    row.appendChild(chip);
  }
  updateCoinDisplays();
}

document.getElementById("watchAdBtn").addEventListener("click", () => {
  state.coins += 10;
  saveState();
  updateCoinDisplays();
  toast("+10 coins earned");
});
document.getElementById("inviteBtn").addEventListener("click", () => {
  state.coins += 50;
  saveState();
  updateCoinDisplays();
  toast("+50 coins — invite link copied!");
});

function renderMine() {
  const unlockedCount = Object.keys(state.unlocked).length;
  const followedCount = Object.keys(state.followed).filter(k => state.followed[k]).length;
  document.getElementById("mineUnlocked").textContent = unlockedCount;
  document.getElementById("mineFollowed").textContent = followedCount;
  updateCoinDisplays();
}

/* ---------------- Init ---------------- */
function init() {
  loadState();
  updateCoinDisplays();
  renderFeed();
  switchView("home");
  renderCoinPackages();

  const splash = document.getElementById("splash");
  setTimeout(() => splash.classList.add("hide"), 900);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
