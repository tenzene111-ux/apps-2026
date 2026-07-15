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

// Real user-uploaded dramas are fetched from Supabase and pushed in here
// at runtime (see fetchRealDramas). No hardcoded demo content anymore.
const DRAMAS = [];

const COIN_PACKAGES = [
  { coins: 100, price: "Nu. 25" },
  { coins: 350, price: "Nu. 79" },
  { coins: 800, price: "Nu. 169" },
  { coins: 2000, price: "Nu. 399" },
];

const UNLOCK_COST = 30;

/* ---------------- Supabase (real auth + profile sync) ---------------- */
const SUPABASE_URL = "https://lmuejnpqpattxljcuqya.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uUDJ15UR6FUKphJuxGfJdw_ggIF-8gI";
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

const VAPID_PUBLIC_KEY = "BNfuzgsUjte3lamMiF-6QkU8qhrXVFYcnx53bhriQzVI92X0N_z1RN0Xnu5i71zClku8YxhybHKSQNLGX0_BNbU";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribeToPush() {
  if (!currentUser || !supabaseClient) return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast("Push notifications aren't supported on this browser");
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Notification permission denied");
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();
  const { error } = await supabaseClient.from("push_subscriptions").upsert(
    {
      user_id: currentUser.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) { toast("Couldn't enable push notifications"); return false; }
  toast("Push notifications enabled");
  return true;
}

async function unsubscribeFromPush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    if (supabaseClient) await supabaseClient.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    await subscription.unsubscribe();
  }
}

let currentUser = null;
let currentProfile = null;
let authMode = "signin";
let profileSyncTimer = null;
let followingIds = new Set();
let notificationsUnreadCount = 0;
let notificationsChannel = null;
let dmUnreadCount = 0;
let dmInboxChannel = null;
let dmChatChannel = null;
let currentDmPartnerId = null;

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
  gems: 0,
  adsWatchedToday: 0,
  adsDate: null,
  claimedTasks: {},
  questClaimed: {},
  freshClaimed: {},
  redeemed: {},
  sessionStart: null,
  language: "English",
  notifOn: true,
  autoplayNext: true,
  watchHistory: {},
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
  if (!state.sessionStart) state.sessionStart = Date.now();
  const today = new Date().toDateString();
  if (state.adsDate !== today) {
    state.adsDate = today;
    state.adsWatchedToday = 0;
  }
}
function saveState() {
  localStorage.setItem("reelapp_state", JSON.stringify(state));
  queueProfileSync();
}

/* ---------------- Auth / profile sync ---------------- */
function queueProfileSync() {
  if (!currentUser || !supabaseClient) return;
  clearTimeout(profileSyncTimer);
  profileSyncTimer = setTimeout(async () => {
    await supabaseClient
      .from("profiles")
      .update({ coins: state.coins, gems: state.gems, vip: state.vip })
      .eq("id", currentUser.id);
  }, 800);
}

function updateAuthUI() {
  const signedIn = !!currentUser;
  document.getElementById("signInBtn").style.display = signedIn ? "none" : "";
  document.getElementById("signOutBtn").style.display = signedIn ? "" : "none";
  document.getElementById("profileNameText").textContent = signedIn
    ? (currentProfile?.username || currentUser.email || "Member")
    : "Guest";
  document.getElementById("uidText").textContent = signedIn ? currentUser.id.slice(0, 10) : "1062724055";
}

async function refreshWalletFromServer() {
  if (!currentUser || !supabaseClient) return;
  const { data } = await supabaseClient.from("profiles").select("coins, gems, vip").eq("id", currentUser.id).single();
  if (data) {
    state.coins = data.coins;
    state.gems = data.gems;
    state.vip = data.vip;
    localStorage.setItem("reelapp_state", JSON.stringify(state));
    updateCoinDisplays();
  }
}

async function loadProfile(userId) {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient.from("profiles").select("*").eq("id", userId).single();
  if (error) return null;
  return data;
}

async function handleSignedIn(user) {
  currentUser = user;
  let profile = await loadProfile(user.id);
  if (!profile) {
    for (let i = 0; i < 5 && !profile; i++) {
      await new Promise((r) => setTimeout(r, 400));
      profile = await loadProfile(user.id);
    }
  }
  currentProfile = profile;
  if (profile) {
    state.coins = profile.coins;
    state.gems = profile.gems;
    state.vip = profile.vip;
    localStorage.setItem("reelapp_state", JSON.stringify(state));
  }
  updateAuthUI();
  updateCoinDisplays();
  await loadFollowing();
  fetchLiveSessions();
  refreshNotificationsUnread();
  subscribeNotificationsRealtime();
  syncWatchHistoryFromServer();
  refreshDmUnread();
  subscribeDmInboxRealtime();
}

async function loadFollowing() {
  if (!currentUser || !supabaseClient) { followingIds = new Set(); return; }
  const { data } = await supabaseClient.from("follows").select("followed_id").eq("follower_id", currentUser.id);
  followingIds = new Set((data || []).map((r) => r.followed_id));
}

async function refreshNotificationsUnread() {
  if (!currentUser || !supabaseClient) { notificationsUnreadCount = 0; return; }
  const { count } = await supabaseClient
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", currentUser.id)
    .eq("read", false);
  notificationsUnreadCount = count || 0;
  renderProfileMenu();
}

function subscribeNotificationsRealtime() {
  if (!supabaseClient || !currentUser) return;
  if (notificationsChannel) supabaseClient.removeChannel(notificationsChannel);
  notificationsChannel = supabaseClient
    .channel(`notifications:${currentUser.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${currentUser.id}` },
      () => refreshNotificationsUnread()
    )
    .subscribe();
}

function notificationText(n) {
  const name = n.actor?.username || "Someone";
  if (n.type === "follow") return `<b>${name}</b> followed you`;
  if (n.type === "gift") return `<b>${name}</b> sent you a gift — +${n.data?.amount || 0} coins`;
  if (n.type === "comment") return `<b>${name}</b> commented on your drama`;
  if (n.type === "like") return `<b>${name}</b> liked your episode`;
  return `<b>${name}</b> did something`;
}

async function openNotifications() {
  if (!currentUser) { toast("Sign in to see notifications"); openAuthModal("signin"); return; }
  const list = document.getElementById("notificationsList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';
  openModal("notificationsModal");

  const { data } = await supabaseClient
    .from("notifications")
    .select("id, type, data, created_at, actor:profiles(username)")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(50);

  list.innerHTML = "";
  if (!data || !data.length) {
    list.innerHTML = '<div class="creator-empty">No notifications yet.</div>';
  } else {
    data.forEach((n) => {
      const row = document.createElement("div");
      row.className = "creator-card";
      row.innerHTML = `
        <div class="creator-avatar" style="background:${gradientFor(n.actor?.username || "u")}">${(n.actor?.username || "?")[0].toUpperCase()}</div>
        <div class="creator-info"><div class="creator-name">${notificationText(n)}</div></div>
      `;
      list.appendChild(row);
    });
  }

  await supabaseClient.from("notifications").update({ read: true }).eq("user_id", currentUser.id).eq("read", false);
  notificationsUnreadCount = 0;
  renderProfileMenu();
}

function handleSignedOut() {
  currentUser = null;
  currentProfile = null;
  followingIds = new Set();
  notificationsUnreadCount = 0;
  if (notificationsChannel && supabaseClient) { supabaseClient.removeChannel(notificationsChannel); notificationsChannel = null; }
  dmUnreadCount = 0;
  if (dmInboxChannel && supabaseClient) { supabaseClient.removeChannel(dmInboxChannel); dmInboxChannel = null; }
  if (dmChatChannel && supabaseClient) { supabaseClient.removeChannel(dmChatChannel); dmChatChannel = null; }
  updateAuthUI();
}

function openAuthModal(mode) {
  authMode = mode;
  document.getElementById("authModalTitle").textContent = mode === "signup" ? "Create account" : "Sign in";
  document.getElementById("authModalSubtitle").textContent =
    mode === "signup" ? "Sign up to save your coins, gems and profile." : "Sign in to save your coins, gems and profile.";
  document.getElementById("authSubmitBtn").textContent = mode === "signup" ? "Sign up" : "Sign in";
  document.getElementById("authUsernameInput").style.display = mode === "signup" ? "" : "none";
  document.getElementById("authSwitchText").textContent = mode === "signup" ? "Already have an account?" : "Don't have an account?";
  document.getElementById("authSwitchBtn").textContent = mode === "signup" ? "Sign in" : "Sign up";
  document.getElementById("authModalError").style.display = "none";
  document.getElementById("authEmailInput").value = "";
  document.getElementById("authPasswordInput").value = "";
  document.getElementById("authUsernameInput").value = "";
  openModal("authModal");
}

function showAuthError(msg) {
  const el = document.getElementById("authModalError");
  el.textContent = msg;
  el.style.display = "";
}

function gradientFor(seedStr, offset) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return GRADIENTS[(h + (offset || 0)) % GRADIENTS.length];
}

function coverStyle(d, offset) {
  if (d.coverUrl) return `background-image:url('${d.coverUrl}');background-size:cover;background-position:center`;
  return `background:${gradientFor(d.id, offset)}`;
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
  document.querySelectorAll("[data-gem-balance]").forEach(el => el.textContent = state.gems);
}

/* ---------------- Views ---------------- */
function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
  state.view = name;
  document.getElementById("bottomNav").style.display = (name === "player" || name === "live-host" || name === "live-guest" || name === "dm-chat") ? "none" : "flex";
  const tabForView = { home: "home", foryou: "foryou", mylist: "mylist", rewards: "rewards", mine: "profile" };
  if (tabForView[name]) {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === tabForView[name]));
  }
}

function renderContinueWatching() {
  const section = document.getElementById("continueSection");
  const strip = document.getElementById("continueStrip");
  const entries = Object.entries(state.watchHistory)
    .map(([dramaId, progress]) => ({ drama: DRAMAS.find((d) => d.id === dramaId), ...progress }))
    .filter((e) => e.drama)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

  if (!entries.length) { section.style.display = "none"; return; }
  section.style.display = "block";
  strip.innerHTML = "";
  entries.forEach(({ drama, epNum }) => {
    const pct = Math.round((epNum / drama.episodes) * 100);
    const card = document.createElement("div");
    card.className = "continue-card";
    card.innerHTML = `
      <div class="continue-thumb" style="${coverStyle(drama)}">
        <span class="continue-ep-badge">EP ${epNum}</span>
        <div class="continue-progress"><div class="continue-progress-fill" style="width:${pct}%"></div></div>
      </div>
      <p class="continue-title">${drama.title}</p>
    `;
    card.addEventListener("click", () => openPlayer(drama.id, epNum - 1));
    strip.appendChild(card);
  });
}

function renderFeed() {
  const feed = document.getElementById("feed");
  feed.innerHTML = "";

  let list;
  if (state.topTab === "anime" || state.topTab === "novel") {
    feed.innerHTML = '<div class="empty-state">More ' + state.topTab + ' titles launching soon.</div>';
    return;
  } else if (state.topTab === "new") {
    list = DRAMAS.filter(d => d.badge === "New");
  } else if (state.topTab === "ranking") {
    list = [...DRAMAS].sort((a, b) => parseFloat(b.views) - parseFloat(a.views));
  } else {
    list = DRAMAS;
  }
  list = list.filter(d => state.subGenre === "all" || d.genre === state.subGenre);

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
      <div class="poster-cover" style="${coverStyle(d)}">
        ${rankBadge}
        <span class="poster-views"><svg class="ic"><use href="#ic-play"/></svg> ${d.views}</span>
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
      <div class="drama-cover" style="${coverStyle(d)}">
        <span class="play-glyph"><svg class="ic"><use href="#ic-play"/></svg></span>
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

/* ---------------- Creators (real follow/discovery) ---------------- */
document.querySelectorAll(".mltab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".mltab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".mylist-panel").forEach((p) => p.classList.remove("active"));
    document.getElementById("panel-mylist-" + tab.dataset.mltab).classList.add("active");
    if (tab.dataset.mltab === "creators") renderFollowingList();
  });
});

async function toggleFollow(userId, btn) {
  if (!currentUser) { toast("Sign in to follow"); openAuthModal("signin"); return; }
  const isFollowing = followingIds.has(userId);
  btn.disabled = true;
  if (isFollowing) {
    const { error } = await supabaseClient.from("follows").delete().eq("follower_id", currentUser.id).eq("followed_id", userId);
    if (!error) followingIds.delete(userId);
  } else {
    const { error } = await supabaseClient.from("follows").insert({ follower_id: currentUser.id, followed_id: userId });
    if (!error) followingIds.add(userId);
  }
  btn.disabled = false;
  fetchLiveSessions();
  if (document.getElementById("panel-mylist-creators").classList.contains("active")) renderFollowingList();
}

function buildCreatorCard(profile) {
  const isFollowing = followingIds.has(profile.id);
  const isLive = liveSessionsCache.some((h) => h.hostId === profile.id);
  const card = document.createElement("div");
  card.className = "creator-card";
  card.innerHTML = `
    <div class="creator-avatar" style="background:${gradientFor(profile.id)}">${profile.username[0].toUpperCase()}</div>
    <div class="creator-info">
      <div class="creator-name">${profile.username}</div>
      <div class="creator-status${isLive ? " is-live" : ""}">${isLive ? "LIVE now" : "Not live"}</div>
    </div>
    <button class="creator-follow-btn${isFollowing ? " following" : ""}">${isFollowing ? "Following" : "+ Follow"}</button>
  `;
  const btn = card.querySelector(".creator-follow-btn");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFollow(profile.id, btn).then(() => {
      const nowFollowing = followingIds.has(profile.id);
      btn.textContent = nowFollowing ? "Following" : "+ Follow";
      btn.classList.toggle("following", nowFollowing);
    });
  });
  card.addEventListener("click", () => openCreatorProfile(profile.id));
  return card;
}

async function renderFollowingList() {
  const wrap = document.getElementById("followingList");
  wrap.innerHTML = "";
  if (!currentUser) { wrap.innerHTML = '<div class="creator-empty">Sign in to follow creators.</div>'; return; }
  if (!followingIds.size) { wrap.innerHTML = '<div class="creator-empty">You aren\'t following anyone yet. Search above to find creators.</div>'; return; }
  const { data } = await supabaseClient.from("profiles").select("id, username").in("id", Array.from(followingIds));
  (data || []).forEach((p) => wrap.appendChild(buildCreatorCard(p)));
}

async function openCreatorProfile(userId) {
  switchView("creator-profile");
  document.getElementById("creatorProfileAvatar").style.background = gradientFor(userId);
  document.getElementById("creatorProfileAvatar").textContent = "?";
  document.getElementById("creatorProfileName").textContent = "Loading...";
  document.getElementById("creatorProfileFollowers").textContent = "0";
  document.getElementById("creatorProfileDramaCount").textContent = "0";
  document.getElementById("creatorProfileDramaGrid").innerHTML = "";
  document.getElementById("creatorProfileWatchLiveBtn").style.display = "none";

  const { data: profile } = await supabaseClient.from("profiles").select("username").eq("id", userId).single();
  const username = profile?.username || "User";
  document.getElementById("creatorProfileName").textContent = username;
  document.getElementById("creatorProfileAvatar").textContent = username[0].toUpperCase();

  const { count: followerCount } = await supabaseClient
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("followed_id", userId);
  document.getElementById("creatorProfileFollowers").textContent = followerCount || 0;

  const dramas = DRAMAS.filter((d) => d.real && d.creatorId === userId);
  document.getElementById("creatorProfileDramaCount").textContent = dramas.length;
  const grid = document.getElementById("creatorProfileDramaGrid");
  if (!dramas.length) {
    grid.innerHTML = '<div class="empty-state">No dramas uploaded yet.</div>';
  } else {
    dramas.forEach((d) => {
      const card = document.createElement("div");
      card.className = "poster-card";
      card.innerHTML = `
        <div class="poster-cover" style="${coverStyle(d)}"></div>
        <h3 class="poster-title">${d.title}</h3>
        <p class="poster-genre">${d.label}</p>`;
      card.addEventListener("click", () => openDetail(d.id));
      grid.appendChild(card);
    });
  }

  const followBtn = document.getElementById("creatorProfileFollowBtn");
  followBtn.style.display = currentUser && currentUser.id === userId ? "none" : "";
  const applyFollowState = () => {
    const isFollowing = followingIds.has(userId);
    followBtn.textContent = isFollowing ? "Following" : "+ Follow";
    followBtn.classList.toggle("following", isFollowing);
  };
  applyFollowState();
  followBtn.onclick = async () => {
    await toggleFollow(userId, followBtn);
    applyFollowState();
    const { count } = await supabaseClient.from("follows").select("follower_id", { count: "exact", head: true }).eq("followed_id", userId);
    document.getElementById("creatorProfileFollowers").textContent = count || 0;
  };

  const messageBtn = document.getElementById("creatorProfileMessageBtn");
  messageBtn.style.display = currentUser && currentUser.id === userId ? "none" : "";
  messageBtn.onclick = () => {
    if (!currentUser) { toast("Sign in to send messages"); openAuthModal("signin"); return; }
    openDmChat(userId, username);
  };

  const liveHost = liveSessionsCache.find((h) => h.hostId === userId);
  const watchLiveBtn = document.getElementById("creatorProfileWatchLiveBtn");
  if (liveHost) {
    watchLiveBtn.style.display = "";
    watchLiveBtn.onclick = () => openLiveGuest(liveHost);
  }
}

document.getElementById("creatorProfileBackBtn").addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "mylist"));
  switchView("mylist");
  renderMyList();
});

/* ---------------- Leaderboard (real, from follows + gifts) ---------------- */
function openLeaderboard() {
  switchView("leaderboard");
  renderTopCreators();
  renderTopGifters();
}

document.getElementById("leaderboardBackBtn").addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "profile"));
  switchView("mine");
  renderMine();
});

document.querySelectorAll("#view-leaderboard .lbtab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#view-leaderboard .lbtab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll("#view-leaderboard .mylist-panel").forEach((p) => p.classList.remove("active"));
    document.getElementById("panel-lb-" + tab.dataset.lbtab).classList.add("active");
  });
});

function buildLeaderboardRow(rank, userId, username, statText) {
  const row = document.createElement("div");
  row.className = "creator-card";
  row.innerHTML = `
    <div class="lb-rank">#${rank}</div>
    <div class="creator-avatar" style="background:${gradientFor(userId)}">${username[0].toUpperCase()}</div>
    <div class="creator-info"><div class="creator-name">${username}</div><div class="creator-status">${statText}</div></div>
  `;
  row.addEventListener("click", () => openCreatorProfile(userId));
  return row;
}

async function renderTopCreators() {
  const list = document.getElementById("lbCreatorsList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';
  const { data: follows } = await supabaseClient.from("follows").select("followed_id");
  const counts = {};
  (follows || []).forEach((f) => { counts[f.followed_id] = (counts[f.followed_id] || 0) + 1; });
  const topIds = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
  if (!topIds.length) { list.innerHTML = '<div class="creator-empty">No creators yet.</div>'; return; }
  const { data: profiles } = await supabaseClient.from("profiles").select("id, username").in("id", topIds);
  const byId = {};
  (profiles || []).forEach((p) => { byId[p.id] = p; });
  list.innerHTML = "";
  topIds.forEach((id, i) => {
    const p = byId[id];
    if (!p) return;
    list.appendChild(buildLeaderboardRow(i + 1, id, p.username, `${counts[id]} follower${counts[id] === 1 ? "" : "s"}`));
  });
}

async function renderTopGifters() {
  const list = document.getElementById("lbGiftersList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';
  const { data: gifts } = await supabaseClient.from("gifts").select("sender_id, amount");
  const totals = {};
  (gifts || []).forEach((g) => { totals[g.sender_id] = (totals[g.sender_id] || 0) + g.amount; });
  const topIds = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
  if (!topIds.length) { list.innerHTML = '<div class="creator-empty">No gifts sent yet.</div>'; return; }
  const { data: profiles } = await supabaseClient.from("profiles").select("id, username").in("id", topIds);
  const byId = {};
  (profiles || []).forEach((p) => { byId[p.id] = p; });
  list.innerHTML = "";
  topIds.forEach((id, i) => {
    const p = byId[id];
    if (!p) return;
    list.appendChild(buildLeaderboardRow(i + 1, id, p.username, `${totals[id]} coins gifted`));
  });
}

/* ---------------- Direct messages (real, via Supabase Realtime) ---------------- */
async function refreshDmUnread() {
  if (!currentUser || !supabaseClient) { dmUnreadCount = 0; return; }
  const { count } = await supabaseClient
    .from("dm_messages")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", currentUser.id)
    .eq("read", false);
  dmUnreadCount = count || 0;
  renderProfileMenu();
}

function subscribeDmInboxRealtime() {
  if (!supabaseClient || !currentUser) return;
  if (dmInboxChannel) supabaseClient.removeChannel(dmInboxChannel);
  dmInboxChannel = supabaseClient
    .channel(`dm-inbox:${currentUser.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "dm_messages", filter: `receiver_id=eq.${currentUser.id}` },
      () => refreshDmUnread()
    )
    .subscribe();
}

async function openDmInbox() {
  switchView("dm-inbox");
  const list = document.getElementById("dmConversationList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';

  const { data } = await supabaseClient
    .from("dm_messages")
    .select("sender_id, receiver_id, text, created_at, read")
    .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
    .order("created_at", { ascending: false });

  const convByPartner = {};
  (data || []).forEach((m) => {
    const partnerId = m.sender_id === currentUser.id ? m.receiver_id : m.sender_id;
    if (!convByPartner[partnerId]) convByPartner[partnerId] = { lastText: m.text, lastAt: m.created_at, unread: 0 };
    if (m.receiver_id === currentUser.id && !m.read) convByPartner[partnerId].unread++;
  });
  const partnerIds = Object.keys(convByPartner);
  if (!partnerIds.length) {
    list.innerHTML = '<div class="creator-empty">No messages yet. Message a creator from their profile.</div>';
    return;
  }
  const { data: profiles } = await supabaseClient.from("profiles").select("id, username").in("id", partnerIds);
  const byId = {};
  (profiles || []).forEach((p) => { byId[p.id] = p; });

  list.innerHTML = "";
  partnerIds
    .sort((a, b) => new Date(convByPartner[b].lastAt) - new Date(convByPartner[a].lastAt))
    .forEach((id) => {
      const p = byId[id];
      if (!p) return;
      const conv = convByPartner[id];
      const row = document.createElement("div");
      row.className = "creator-card";
      row.innerHTML = `
        <div class="creator-avatar" style="background:${gradientFor(id)}">${p.username[0].toUpperCase()}</div>
        <div class="creator-info">
          <div class="creator-name">${p.username}</div>
          <div class="creator-status">${conv.lastText.slice(0, 40)}</div>
        </div>
        ${conv.unread > 0 ? '<span class="dm-unread-dot"></span>' : ""}
      `;
      row.addEventListener("click", () => openDmChat(id, p.username));
      list.appendChild(row);
    });
}

function appendDmMessage(mine, text) {
  const messagesEl = document.getElementById("dmChatMessages");
  const empty = messagesEl.querySelector(".creator-empty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "dm-msg " + (mine ? "mine" : "theirs");
  row.textContent = text;
  messagesEl.appendChild(row);
}

async function openDmChat(partnerId, partnerName) {
  switchView("dm-chat");
  document.getElementById("dmChatTitle").textContent = partnerName;
  currentDmPartnerId = partnerId;
  const messagesEl = document.getElementById("dmChatMessages");
  messagesEl.innerHTML = '<div class="creator-empty">Loading...</div>';

  const { data } = await supabaseClient
    .from("dm_messages")
    .select("id, sender_id, text, created_at")
    .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${currentUser.id})`)
    .order("created_at", { ascending: true });

  messagesEl.innerHTML = "";
  (data || []).forEach((m) => appendDmMessage(m.sender_id === currentUser.id, m.text));
  messagesEl.scrollTop = messagesEl.scrollHeight;

  await supabaseClient.from("dm_messages").update({ read: true }).eq("sender_id", partnerId).eq("receiver_id", currentUser.id).eq("read", false);
  refreshDmUnread();

  if (dmChatChannel) supabaseClient.removeChannel(dmChatChannel);
  dmChatChannel = supabaseClient
    .channel(`dm-chat:${[currentUser.id, partnerId].sort().join(":")}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "dm_messages", filter: `sender_id=eq.${partnerId}` },
      (payload) => {
        if (payload.new.receiver_id !== currentUser.id) return;
        appendDmMessage(false, payload.new.text);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        supabaseClient.from("dm_messages").update({ read: true }).eq("id", payload.new.id);
      }
    )
    .subscribe();
}

document.getElementById("dmChatSendBtn").addEventListener("click", sendDmMessage);
document.getElementById("dmChatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendDmMessage(); });
async function sendDmMessage() {
  const input = document.getElementById("dmChatInput");
  const text = input.value.trim();
  if (!text || !currentDmPartnerId) return;
  input.value = "";
  appendDmMessage(true, text);
  const messagesEl = document.getElementById("dmChatMessages");
  messagesEl.scrollTop = messagesEl.scrollHeight;
  await supabaseClient.from("dm_messages").insert({ sender_id: currentUser.id, receiver_id: currentDmPartnerId, text });
}

document.getElementById("dmChatBackBtn").addEventListener("click", () => {
  if (dmChatChannel) { supabaseClient.removeChannel(dmChatChannel); dmChatChannel = null; }
  openDmInbox();
});
document.getElementById("dmInboxBackBtn").addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "profile"));
  switchView("mine");
  renderMine();
});

let creatorSearchTimer = null;
document.getElementById("creatorSearchInput").addEventListener("input", (e) => {
  const term = e.target.value.trim();
  clearTimeout(creatorSearchTimer);
  const results = document.getElementById("creatorSearchResults");
  if (!term) { results.innerHTML = ""; return; }
  creatorSearchTimer = setTimeout(async () => {
    const { data } = await supabaseClient
      .from("profiles")
      .select("id, username")
      .ilike("username", `%${term}%`)
      .neq("id", currentUser?.id || "")
      .limit(20);
    results.innerHTML = "";
    if (!data || !data.length) { results.innerHTML = '<div class="creator-empty">No creators found.</div>'; return; }
    data.forEach((p) => results.appendChild(buildCreatorCard(p)));
  }, 350);
});

/* ---------------- Content upload (real user-generated dramas) ---------------- */
let uploadDramaId = null;
let uploadNextEpisodeNumber = 1;
let episodeLikeCounts = {};
let myLikedEpisodes = new Set();

function showUploadStep(step) {
  document.getElementById("uploadStepList").style.display = step === "list" ? "" : "none";
  document.getElementById("uploadStepCreate").style.display = step === "create" ? "" : "none";
  document.getElementById("uploadStepEpisodes").style.display = step === "episodes" ? "" : "none";
  document.getElementById("uploadStepEdit").style.display = step === "edit" ? "" : "none";
  const titles = { list: "My Dramas", create: "New Drama", episodes: "Add Episodes", edit: "Edit Drama" };
  document.getElementById("uploadModalTitle").textContent = titles[step];
}

function openUploadModal() {
  if (!currentUser) { toast("Sign in to upload"); openAuthModal("signin"); return; }
  showUploadStep("list");
  renderUploadDramaList();
  openModal("uploadModal");
}

async function renderUploadDramaList() {
  const wrap = document.getElementById("uploadDramaList");
  wrap.innerHTML = '<div class="creator-empty">Loading...</div>';
  const { data: dramaRows } = await supabaseClient
    .from("dramas")
    .select("id, title, genre")
    .eq("creator_id", currentUser.id)
    .order("created_at", { ascending: false });
  const { data: episodeRows } = await supabaseClient.from("episodes").select("drama_id, episode_number");
  const countByDrama = {};
  (episodeRows || []).forEach((e) => { countByDrama[e.drama_id] = (countByDrama[e.drama_id] || 0) + 1; });

  wrap.innerHTML = "";
  if (!dramaRows || !dramaRows.length) {
    wrap.innerHTML = '<div class="creator-empty">You haven\'t created any dramas yet.</div>';
    return;
  }
  dramaRows.forEach((row) => {
    const epCount = countByDrama[row.id] || 0;
    const card = document.createElement("div");
    card.className = "creator-card";
    card.innerHTML = `
      <div class="creator-avatar" style="background:${gradientFor(row.id)}">${row.title[0].toUpperCase()}</div>
      <div class="creator-info">
        <div class="creator-name">${row.title}</div>
        <div class="creator-status">${epCount} episode${epCount === 1 ? "" : "s"}</div>
      </div>
      <button class="creator-follow-btn edit-drama-btn">Edit</button>
      <button class="creator-follow-btn add-episode-btn">+ Add Episode</button>
    `;
    card.querySelector(".edit-drama-btn").addEventListener("click", () => openEditDrama(row.id));
    card.querySelector(".add-episode-btn").addEventListener("click", () => {
      uploadDramaId = row.id;
      uploadNextEpisodeNumber = epCount + 1;
      document.getElementById("uploadEpisodesForText").textContent = `Add episodes to "${row.title}" — upload one video file at a time.`;
      document.getElementById("uploadNextEpNum").textContent = uploadNextEpisodeNumber;
      document.getElementById("uploadProgressText").textContent = "";
      showUploadStep("episodes");
    });
    wrap.appendChild(card);
  });
}

let editDramaId = null;

async function openEditDrama(dramaId) {
  editDramaId = dramaId;
  document.getElementById("editCoverInput").value = "";
  showUploadStep("edit");

  const { data: row } = await supabaseClient.from("dramas").select("title, description, genre").eq("id", dramaId).single();
  if (row) {
    document.getElementById("editTitleInput").value = row.title;
    document.getElementById("editDescInput").value = row.description || "";
    document.getElementById("editGenreSelect").value = row.genre;
  }
  renderEditEpisodeList(dramaId);
}

async function renderEditEpisodeList(dramaId) {
  const list = document.getElementById("editEpisodeList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';
  const { data: episodes } = await supabaseClient
    .from("episodes")
    .select("episode_number, video_path")
    .eq("drama_id", dramaId)
    .order("episode_number", { ascending: true });
  list.innerHTML = "";
  if (!episodes || !episodes.length) {
    list.innerHTML = '<div class="creator-empty">No episodes uploaded yet.</div>';
    return;
  }
  const lastEpNum = episodes[episodes.length - 1].episode_number;
  episodes.forEach((ep) => {
    const row = document.createElement("div");
    row.className = "creator-card";
    row.innerHTML = `
      <div class="creator-info"><div class="creator-name">Episode ${ep.episode_number}</div></div>
      ${ep.episode_number === lastEpNum ? '<button class="creator-follow-btn delete-episode-btn">Delete</button>' : ""}
    `;
    const deleteBtn = row.querySelector(".delete-episode-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        deleteBtn.disabled = true;
        await supabaseClient.storage.from("episode-videos").remove([ep.video_path]);
        await supabaseClient.from("episodes").delete().eq("drama_id", dramaId).eq("episode_number", ep.episode_number);
        renderEditEpisodeList(dramaId);
        fetchRealDramas();
      });
    }
    list.appendChild(row);
  });
}

document.getElementById("editSaveBtn").addEventListener("click", async () => {
  const title = document.getElementById("editTitleInput").value.trim();
  const description = document.getElementById("editDescInput").value.trim();
  const genre = document.getElementById("editGenreSelect").value;
  if (!title) { toast("Give your drama a title"); return; }
  const btn = document.getElementById("editSaveBtn");
  btn.disabled = true;

  const coverFile = document.getElementById("editCoverInput").files[0];
  if (coverFile) {
    const ext = coverFile.name.split(".").pop() || "jpg";
    const coverPath = `${currentUser.id}/${editDramaId}.${ext}`;
    const { error: coverError } = await supabaseClient.storage.from("drama-covers").upload(coverPath, coverFile, { upsert: true });
    if (!coverError) await supabaseClient.from("dramas").update({ cover_path: coverPath }).eq("id", editDramaId);
  }

  const { error } = await supabaseClient.from("dramas").update({ title, description, genre }).eq("id", editDramaId);
  btn.disabled = false;
  if (error) { toast("Couldn't save changes: " + error.message); return; }
  toast("Drama updated!");
  await fetchRealDramas();
  showUploadStep("list");
  renderUploadDramaList();
});

document.getElementById("editDeleteDramaBtn").addEventListener("click", async () => {
  if (!confirm("Delete this entire drama and all its episodes? This cannot be undone.")) return;
  const btn = document.getElementById("editDeleteDramaBtn");
  btn.disabled = true;
  const { error } = await supabaseClient.from("dramas").delete().eq("id", editDramaId);
  btn.disabled = false;
  if (error) { toast("Couldn't delete: " + error.message); return; }
  toast("Drama deleted");
  await fetchRealDramas();
  showUploadStep("list");
  renderUploadDramaList();
});

document.getElementById("editBackBtn").addEventListener("click", () => {
  showUploadStep("list");
  renderUploadDramaList();
});

document.getElementById("uploadNewDramaBtn").addEventListener("click", () => {
  document.getElementById("uploadTitleInput").value = "";
  document.getElementById("uploadDescInput").value = "";
  document.getElementById("uploadGenreSelect").value = "romance";
  document.getElementById("uploadCoverInput").value = "";
  showUploadStep("create");
});

document.getElementById("uploadCreateBackBtn").addEventListener("click", () => {
  showUploadStep("list");
  renderUploadDramaList();
});

document.getElementById("uploadCreateBtn").addEventListener("click", async () => {
  const title = document.getElementById("uploadTitleInput").value.trim();
  const description = document.getElementById("uploadDescInput").value.trim();
  const genre = document.getElementById("uploadGenreSelect").value;
  if (!title) { toast("Give your drama a title"); return; }
  const btn = document.getElementById("uploadCreateBtn");
  btn.disabled = true;
  const { data, error } = await supabaseClient
    .from("dramas")
    .insert({ creator_id: currentUser.id, title, description, genre, free_episodes: 3 })
    .select()
    .single();
  btn.disabled = false;
  if (error) { toast("Couldn't create drama: " + error.message); return; }
  uploadDramaId = data.id;
  uploadNextEpisodeNumber = 1;

  const coverFile = document.getElementById("uploadCoverInput").files[0];
  if (coverFile) {
    const ext = coverFile.name.split(".").pop() || "jpg";
    const coverPath = `${currentUser.id}/${uploadDramaId}.${ext}`;
    const { error: coverError } = await supabaseClient.storage.from("drama-covers").upload(coverPath, coverFile);
    if (!coverError) {
      await supabaseClient.from("dramas").update({ cover_path: coverPath }).eq("id", uploadDramaId);
    }
  }

  document.getElementById("uploadEpisodesForText").textContent = `Add episodes to "${data.title}" — upload one video file at a time.`;
  document.getElementById("uploadNextEpNum").textContent = 1;
  document.getElementById("uploadProgressText").textContent = "";
  showUploadStep("episodes");
});

document.getElementById("uploadEpisodeBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("uploadVideoInput");
  const file = fileInput.files[0];
  if (!file) { toast("Choose a video file first"); return; }
  const btn = document.getElementById("uploadEpisodeBtn");
  const progress = document.getElementById("uploadProgressText");
  btn.disabled = true;
  progress.textContent = "Uploading...";
  const ext = file.name.split(".").pop() || "mp4";
  const path = `${currentUser.id}/${uploadDramaId}/${uploadNextEpisodeNumber}.${ext}`;
  const { error: uploadError } = await supabaseClient.storage.from("episode-videos").upload(path, file);
  if (uploadError) {
    progress.textContent = "";
    btn.disabled = false;
    toast("Upload failed: " + uploadError.message);
    return;
  }
  const { error: insertError } = await supabaseClient
    .from("episodes")
    .insert({ drama_id: uploadDramaId, episode_number: uploadNextEpisodeNumber, video_path: path });
  btn.disabled = false;
  if (insertError) { progress.textContent = ""; toast("Couldn't save episode: " + insertError.message); return; }
  toast(`Episode ${uploadNextEpisodeNumber} uploaded!`);
  uploadNextEpisodeNumber++;
  document.getElementById("uploadNextEpNum").textContent = uploadNextEpisodeNumber;
  fileInput.value = "";
  progress.textContent = "";
});

document.getElementById("uploadDoneBtn").addEventListener("click", async () => {
  await fetchRealDramas();
  showUploadStep("list");
  renderUploadDramaList();
});

async function fetchRealDramas() {
  if (!supabaseClient) return;
  const { data: dramaRows } = await supabaseClient
    .from("dramas")
    .select("id, creator_id, title, description, genre, free_episodes, cover_path, created_at, creator:profiles(username)")
    .order("created_at", { ascending: false });
  if (!dramaRows) return;
  const { data: episodeRows } = await supabaseClient.from("episodes").select("drama_id, episode_number, video_path");
  const episodesByDrama = {};
  (episodeRows || []).forEach((e) => {
    (episodesByDrama[e.drama_id] ||= []).push(e);
  });

  const { data: viewRows } = await supabaseClient.from("drama_views").select("drama_id");
  const viewCounts = {};
  (viewRows || []).forEach((v) => { viewCounts[v.drama_id] = (viewCounts[v.drama_id] || 0) + 1; });

  const { data: likeRows } = await supabaseClient.from("episode_likes").select("drama_id, episode_number, user_id");
  episodeLikeCounts = {};
  myLikedEpisodes = new Set();
  (likeRows || []).forEach((l) => {
    const key = l.drama_id + ":" + l.episode_number;
    episodeLikeCounts[key] = (episodeLikeCounts[key] || 0) + 1;
    if (l.user_id === currentUser?.id) myLikedEpisodes.add(key);
  });

  for (let i = DRAMAS.length - 1; i >= 0; i--) {
    if (DRAMAS[i].real) DRAMAS.splice(i, 1);
  }
  dramaRows.forEach((row) => {
    const eps = (episodesByDrama[row.id] || []).sort((a, b) => a.episode_number - b.episode_number);
    if (!eps.length) return;
    const videoUrls = {};
    eps.forEach((e) => {
      videoUrls[e.episode_number] = `${SUPABASE_URL}/storage/v1/object/public/episode-videos/${e.video_path}`;
    });
    DRAMAS.push({
      id: row.id,
      title: row.title,
      genre: row.genre,
      label: "Original",
      badge: "New",
      views: String(viewCounts[row.id] || 0),
      desc: row.description || "",
      episodes: eps.length,
      free: row.free_episodes,
      real: true,
      creatorId: row.creator_id,
      creatorName: row.creator?.username || "Creator",
      videoUrls,
      coverUrl: row.cover_path ? `${SUPABASE_URL}/storage/v1/object/public/drama-covers/${row.cover_path}` : null,
    });
  });
  renderFeed();
  if (state.view === "foryou") renderForYouFeed();
}

function openDetail(dramaId) {
  const d = DRAMAS.find(x => x.id === dramaId);
  state.currentDrama = d;
  document.getElementById("detailHero").style.cssText = coverStyle(d);
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
    btn.innerHTML = `${n}<svg class="ic ep-badge-icon"><use href="#ic-${unlocked ? "play" : "lock"}"/></svg>`;
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
  recordWatchProgress(dramaId, epIndex + 1);
}

function recordWatchProgress(dramaId, epNum) {
  state.watchHistory[dramaId] = { epNum, updatedAt: Date.now() };
  saveState();
  recordRealView(dramaId);
  if (currentUser && supabaseClient) {
    supabaseClient.from("watch_history").upsert(
      { user_id: currentUser.id, drama_id: dramaId, episode_number: epNum, updated_at: new Date().toISOString() },
      { onConflict: "user_id,drama_id" }
    );
  }
}

async function syncWatchHistoryFromServer() {
  if (!currentUser || !supabaseClient) return;
  const { data } = await supabaseClient.from("watch_history").select("drama_id, episode_number, updated_at").eq("user_id", currentUser.id);
  (data || []).forEach((row) => {
    const serverUpdatedAt = new Date(row.updated_at).getTime();
    const local = state.watchHistory[row.drama_id];
    if (!local || serverUpdatedAt > local.updatedAt) {
      state.watchHistory[row.drama_id] = { epNum: row.episode_number, updatedAt: serverUpdatedAt };
    }
  });
  saveState();
  if (state.view === "home") renderContinueWatching();
}

let viewedDramaIds = new Set();
async function recordRealView(dramaId) {
  if (!currentUser || !supabaseClient) return;
  if (viewedDramaIds.has(dramaId)) return;
  const drama = DRAMAS.find((d) => d.id === dramaId);
  if (!drama?.real) return;
  viewedDramaIds.add(dramaId);
  const { error } = await supabaseClient.from("drama_views").insert({ drama_id: dramaId, user_id: currentUser.id });
  if (!error) {
    drama.views = String((parseInt(drama.views, 10) || 0) + 1);
  }
}

function buildPlayerCard(d, epNum) {
  const unlocked = isUnlocked(d.id, epNum, d.free) || isDramaFullyUnlocked(d);
  const card = document.createElement("div");
  card.className = "player-card";
  card.dataset.ep = epNum;
  const likeKey = d.id + ":" + epNum;
  const baseLikes = 1200 + (epNum * 37) % 900;
  const liked = d.real ? myLikedEpisodes.has(likeKey) : !!state.likes[likeKey];
  const likeCount = d.real ? (episodeLikeCounts[likeKey] || 0) : baseLikes + (liked ? 1 : 0);

  let dots = "";
  for (let i = 1; i <= d.episodes; i++) {
    dots += `<span class="${i < epNum ? 'done' : ''} ${i === epNum ? 'current' : ''}"></span>`;
  }

  const realVideoUrl = d.real ? d.videoUrls[epNum] : null;

  card.innerHTML = `
    ${realVideoUrl
      ? `<video class="player-video" src="${realVideoUrl}" loop playsinline muted></video>`
      : `<div class="player-bg" style="background:${gradientFor(d.id, epNum)}"></div>`}
    <div class="player-vignette"></div>
    <div class="player-topbar">
      <button class="icon-btn" data-back="detail">←</button>
      <div class="player-dots">${dots}</div>
      <button class="icon-btn mute-btn" data-muted="${realVideoUrl ? "true" : "false"}">${muteIconHTML(!!realVideoUrl)}</button>
    </div>
    <div class="player-rail">
      <button class="rail-btn like-btn ${liked ? 'liked' : ''}" data-like="${likeKey}">${heartIconHTML(liked)}<span>${formatCount(likeCount)}</span></button>
      <button class="rail-btn comment-btn"><svg class="ic"><use href="#ic-comment"/></svg><span>${120 + epNum % 40}</span></button>
      <button class="rail-btn share-btn2"><svg class="ic"><use href="#ic-share"/></svg><span>Share</span></button>
      <button class="rail-btn coin-shortcut" data-open="coinModal"><svg class="ic ic-coin"><use href="#ic-coin"/></svg><span data-coin-balance>${state.coins}</span></button>
    </div>
    <div class="player-bottom">
      <h3>${d.title}</h3>
      <p class="ep-label">EP ${epNum} · ${episodeSubtitle(epNum)}</p>
      <p class="ep-desc">${d.desc}</p>
      ${d.real ? `<p class="ep-creator" data-creator-id="${d.creatorId}">by ${d.creatorName}</p>` : ""}
    </div>
    ${!unlocked ? lockOverlayHTML(d, epNum) : ""}
  `;

  function setLiked(forceOn) {
    if (d.real) {
      if (!currentUser) { toast("Sign in to like"); openAuthModal("signin"); return; }
      if (forceOn && myLikedEpisodes.has(likeKey)) return;
      const nowLiked = forceOn ? true : !myLikedEpisodes.has(likeKey);
      if (nowLiked) myLikedEpisodes.add(likeKey); else myLikedEpisodes.delete(likeKey);
      episodeLikeCounts[likeKey] = (episodeLikeCounts[likeKey] || 0) + (nowLiked ? 1 : -1);
      const btn = card.querySelector(".like-btn");
      btn.classList.toggle("liked", nowLiked);
      btn.querySelector("use").setAttribute("href", nowLiked ? "#ic-heart-filled" : "#ic-heart");
      btn.querySelector("span").textContent = formatCount(episodeLikeCounts[likeKey]);
      if (nowLiked) {
        supabaseClient.from("episode_likes").insert({ drama_id: d.id, episode_number: epNum, user_id: currentUser.id });
      } else {
        supabaseClient.from("episode_likes").delete().eq("drama_id", d.id).eq("episode_number", epNum).eq("user_id", currentUser.id);
      }
      return;
    }
    if (forceOn && state.likes[likeKey]) return;
    state.likes[likeKey] = forceOn ? true : !state.likes[likeKey];
    saveState();
    const btn = card.querySelector(".like-btn");
    btn.classList.toggle("liked", state.likes[likeKey]);
    btn.querySelector("use").setAttribute("href", state.likes[likeKey] ? "#ic-heart-filled" : "#ic-heart");
    btn.querySelector("span").textContent = formatCount(baseLikes + (state.likes[likeKey] ? 1 : 0));
  }

  card.querySelector('[data-back="detail"]').addEventListener("click", () => openDetail(d.id));
  const creatorCredit = card.querySelector(".ep-creator");
  if (creatorCredit) creatorCredit.addEventListener("click", () => openCreatorProfile(creatorCredit.dataset.creatorId));
  card.querySelector(".mute-btn").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const muted = btn.dataset.muted !== "true";
    btn.dataset.muted = String(muted);
    btn.querySelector("use").setAttribute("href", muted ? "#ic-mute" : "#ic-unmute");
    const video = card.querySelector(".player-video");
    if (video) video.muted = muted;
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
  heart.innerHTML = '<svg class="ic"><use href="#ic-heart-filled"/></svg>';
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

function heartIconHTML(liked) {
  return `<svg class="ic"><use href="#ic-heart${liked ? "-filled" : ""}"/></svg>`;
}
function muteIconHTML(muted) {
  return `<svg class="ic"><use href="#ic-${muted ? "mute" : "unmute"}"/></svg>`;
}

function lockOverlayHTML(d, epNum) {
  return `
    <div class="lock-overlay" data-lock-for="${epNum}">
      <div class="lock-icon"><svg class="ic"><use href="#ic-lock"/></svg></div>
      <h4>Episode ${epNum} is locked</h4>
      <p>Unlock this episode for ${UNLOCK_COST} coins, or unlock the whole series.</p>
      <button class="btn-primary" data-unlock-one="${epNum}">Unlock for ${UNLOCK_COST} <svg class="ic ic-coin"><use href="#ic-coin"/></svg></button>
      <button class="btn-ghost" data-unlock-all="1">Unlock All — ${d.episodes * UNLOCK_COST * 0.4 | 0} <svg class="ic ic-coin"><use href="#ic-coin"/></svg></button>
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
      const video = entry.target.querySelector(".player-video");
      if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
        const epNum = Number(entry.target.dataset.ep);
        state.currentEpIndex = epNum - 1;
        if (state.currentDrama) recordWatchProgress(state.currentDrama.id, epNum);
        if (video) video.play().catch(() => {});
      } else if (video) {
        video.pause();
      }
    });
  }, { threshold: [0.6], root: document.getElementById("playerFeed") });
  cards.forEach(c => io.observe(c));
}

/* ---------------- More action sheet (For You) ---------------- */
let moreModalTarget = null;
document.querySelectorAll("#moreModal .more-row").forEach((row) => {
  row.addEventListener("click", () => {
    const action = row.dataset.more;
    closeModal("moreModal");
    if (!moreModalTarget) return;
    if (action === "comment") openComments(moreModalTarget, 1);
    if (action === "share") openModal("shareModal");
    if (action === "report") submitReport(moreModalTarget);
  });
});

async function submitReport(drama) {
  if (!currentUser) { toast("Sign in to report"); openAuthModal("signin"); return; }
  const { error } = await supabaseClient.from("reports").insert({
    reporter_id: currentUser.id,
    drama_id: drama.id,
    episode_number: state.currentEpIndex + 1,
    reason: "user_report",
  });
  toast(error ? "Report failed to send" : "Report submitted — thanks for the feedback");
}

/* ---------------- Comments ---------------- */
let currentCommentKey = null;
let commentsChannel = null;

async function openComments(drama, epNum) {
  const list = document.getElementById("commentList");
  list.innerHTML = '<div class="creator-empty">Loading comments...</div>';
  openModal("commentModal");
  currentCommentKey = { dramaId: drama.id, epNum };

  const { data } = await supabaseClient
    .from("comments")
    .select("text, user_id, author:profiles(username)")
    .eq("drama_id", drama.id)
    .eq("episode_number", epNum)
    .order("created_at", { ascending: true });

  list.innerHTML = "";
  if (!data || !data.length) {
    list.innerHTML = '<div class="creator-empty">No comments yet — be the first!</div>';
  } else {
    data.forEach((c) => list.appendChild(commentRow(c.author?.username || "User", c.text)));
    list.scrollTop = list.scrollHeight;
  }

  if (commentsChannel) supabaseClient.removeChannel(commentsChannel);
  commentsChannel = supabaseClient
    .channel(`comments:${drama.id}:${epNum}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "comments", filter: `drama_id=eq.${drama.id}` },
      (payload) => {
        if (payload.new.episode_number !== epNum) return;
        if (payload.new.user_id === currentUser?.id) return;
        supabaseClient
          .from("profiles")
          .select("username")
          .eq("id", payload.new.user_id)
          .single()
          .then(({ data: p }) => {
            const empty = list.querySelector(".creator-empty");
            if (empty) empty.remove();
            list.appendChild(commentRow(p?.username || "User", payload.new.text));
            list.scrollTop = list.scrollHeight;
          });
      }
    )
    .subscribe();
}

function commentRow(name, text) {
  const row = document.createElement("div");
  row.className = "comment-item";
  row.innerHTML = `<div class="comment-avatar" style="background:${gradientFor(name)}">${name[0].toUpperCase()}</div>
    <div class="comment-body"><b>${name}</b><p>${text}</p></div>`;
  return row;
}

document.getElementById("commentSendBtn").addEventListener("click", sendComment);
document.getElementById("commentInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendComment(); });

async function sendComment() {
  const input = document.getElementById("commentInput");
  const text = input.value.trim();
  if (!text || !currentCommentKey) return;
  if (!currentUser) { toast("Sign in to comment"); openAuthModal("signin"); return; }
  const { dramaId, epNum } = currentCommentKey;
  input.value = "";
  const list = document.getElementById("commentList");
  const empty = list.querySelector(".creator-empty");
  if (empty) empty.remove();
  list.appendChild(commentRow(currentProfile?.username || "You", text));
  list.scrollTop = list.scrollHeight;
  const { error } = await supabaseClient.from("comments").insert({
    drama_id: dramaId,
    episode_number: epNum,
    user_id: currentUser.id,
    text,
  });
  if (error) toast("Comment failed to send");
}

/* ---------------- Coin packages ---------------- */
function renderCoinPackages() {
  const wrap = document.getElementById("coinPackages");
  wrap.innerHTML = "";
  COIN_PACKAGES.forEach(p => {
    const el = document.createElement("div");
    el.className = "coin-pack";
    el.innerHTML = `<div class="amt"><svg class="ic ic-coin"><use href="#ic-coin"/></svg> ${p.coins}</div><div class="price">${p.price}</div><button>Buy</button>`;
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
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  if (id === "commentModal" && commentsChannel) {
    supabaseClient.removeChannel(commentsChannel);
    commentsChannel = null;
  }
}
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(backdrop.id); });
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
    if (tab === "home") { switchView("home"); renderFeed(); renderContinueWatching(); }
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
  btn.addEventListener("click", () => { switchView("home"); renderContinueWatching(); });
});

/* ---------------- For You (cross-series swipe discovery) ---------------- */
function renderForYouFeed() {
  const feed = document.getElementById("forYouFeed");
  feed.innerHTML = "";

  const maxDramaViews = Math.max(...DRAMAS.map((d) => parseFloat(d.views)));

  const items = [
    // Real live sessions always rank as maximally "hot" — someone is live right now.
    ...liveSessionsCache.map((host) => ({ type: "live", data: host, mutual: !!host.following, score: 1 })),
    ...DRAMAS.map((d) => ({ type: "drama", data: d, mutual: !!d.mutual, score: parseFloat(d.views) / maxDramaViews })),
  ];

  items.sort((a, b) => {
    if (a.mutual !== b.mutual) return a.mutual ? -1 : 1;
    return b.score - a.score;
  });

  items.forEach((item) => {
    feed.appendChild(item.type === "live" ? buildLiveTeaserCard(item.data) : buildForYouCard(item.data));
  });
  observeForYouCards();
}

function buildLiveTeaserCard(host) {
  const card = document.createElement("div");
  card.className = "player-card live-teaser-card";
  card.innerHTML = `
    <div class="player-bg" style="background:${gradientFor(host.id, 2)}"></div>
    <div class="player-vignette"></div>
    <div class="fyu-topbar">
      <div class="fyu-logo"><svg viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke="currentColor" stroke-width="3"/><text x="32" y="42" font-size="30" font-weight="800" text-anchor="middle" fill="currentColor" font-family="Arial, sans-serif">R</text></svg></div>
      ${host.following ? '<span class="mutual-badge">Following</span>' : ""}
      <span class="live-teaser-badge">LIVE</span>
    </div>
    <div class="live-teaser-center">
      <div class="live-teaser-avatar" style="background:${gradientFor(host.id)}">${host.name[0].toUpperCase()}</div>
      <div class="live-teaser-ring"></div>
    </div>
    <div class="player-bottom player-bottom-nav-spacer">
      <h3>${host.name} <span class="chevron">›</span></h3>
      <span class="fyu-tag">${host.tag} · streaming now</span>
      <button class="btn-watch-now live-teaser-cta">Watch Live</button>
    </div>
  `;
  card.querySelector(".live-teaser-cta").addEventListener("click", () => openLiveGuest(host));
  card.addEventListener("pointerup", (e) => {
    if (e.target.closest("button")) return;
    openLiveGuest(host);
  });
  return card;
}

function buildForYouCard(d) {
  const card = document.createElement("div");
  card.className = "player-card foryou-card";
  const likeKey = d.id + ":foryou";
  const claimKey = "foryouClaim:" + d.id;
  const baseLikes = 2000 + (d.id.charCodeAt(1) * 53) % 3000;
  const baseSaves = 8000 + (d.id.charCodeAt(1) * 337) % 30000;
  const liked = !!state.likes[likeKey];
  const saved = !!state.followed[d.id];
  const claimed = !!state.claimedTasks[claimKey];

  card.innerHTML = `
    <div class="player-bg" style="${coverStyle(d, 1)}"></div>
    <div class="player-vignette"></div>
    <div class="fyu-topbar">
      <div class="fyu-logo"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="url(#coinGrad)" opacity="0"/><rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke="currentColor" stroke-width="3"/><text x="32" y="42" font-size="30" font-weight="800" text-anchor="middle" fill="currentColor" font-family="Arial, sans-serif">R</text></svg></div>
      ${d.mutual ? '<span class="mutual-badge">Mutual</span>' : ""}
      <button class="fyu-search-btn"><svg class="ic"><use href="#ic-search"/></svg></button>
    </div>
    <div class="center-play-btn"><svg class="ic"><use href="#ic-play"/></svg></div>
    <div class="player-rail fyu-rail">
      ${!claimed ? `
      <button class="rail-btn claim-btn" data-claim="${claimKey}">
        <span class="claim-coin"><svg class="ic ic-coin"><use href="#ic-coin"/></svg></span>
        <span class="claim-pill">Claim</span>
      </button>` : ""}
      <button class="rail-btn bookmark-btn ${saved ? 'saved' : ''}" data-bookmark="${d.id}"><svg class="ic"><use href="#ic-bookmark${saved ? '-filled' : ''}"/></svg><span>${formatCount(baseSaves + (saved ? 1 : 0))}</span></button>
      <button class="rail-btn like-btn ${liked ? 'liked' : ''}" data-like="${likeKey}">${heartIconHTML(liked)}<span>${formatCount(baseLikes + (liked ? 1 : 0))}</span></button>
      <button class="rail-btn more-btn"><svg class="ic"><use href="#ic-more"/></svg><span>More</span></button>
    </div>
    <div class="player-bottom player-bottom-nav-spacer fyu-bottom">
      <div class="fyu-title-row">
        <div class="fyu-thumb" style="${coverStyle(d)}"></div>
        <div class="fyu-title-info">
          <h3>${d.title} <span class="chevron">›</span></h3>
          <span class="fyu-tag">${d.label}</span>
        </div>
      </div>
      <p class="ep-desc">${d.desc} <span class="more-link">More</span></p>
      <button class="btn-watch-now foryou-cta"><svg class="ic"><use href="#ic-play"/></svg> Watch Now</button>
    </div>
  `;

  card.querySelector(".like-btn").addEventListener("click", (e) => {
    state.likes[likeKey] = !state.likes[likeKey];
    saveState();
    e.currentTarget.classList.toggle("liked", state.likes[likeKey]);
    e.currentTarget.querySelector("use").setAttribute("href", state.likes[likeKey] ? "#ic-heart-filled" : "#ic-heart");
    e.currentTarget.querySelector("span").textContent = formatCount(baseLikes + (state.likes[likeKey] ? 1 : 0));
  });
  card.querySelector(".bookmark-btn").addEventListener("click", (e) => {
    state.followed[d.id] = !state.followed[d.id];
    saveState();
    const btn = e.currentTarget;
    btn.classList.toggle("saved", state.followed[d.id]);
    btn.querySelector("use").setAttribute("href", state.followed[d.id] ? "#ic-bookmark-filled" : "#ic-bookmark");
    btn.querySelector("span").textContent = formatCount(baseSaves + (state.followed[d.id] ? 1 : 0));
    toast(state.followed[d.id] ? "Added to My List" : "Removed from My List");
  });
  const claimBtn = card.querySelector(".claim-btn");
  if (claimBtn) {
    claimBtn.addEventListener("click", () => {
      state.claimedTasks[claimKey] = true;
      state.coins += 5;
      saveState();
      updateCoinDisplays();
      toast("+5 coins claimed!");
      claimBtn.remove();
    });
  }
  card.querySelector(".more-btn").addEventListener("click", () => {
    moreModalTarget = d;
    openModal("moreModal");
  });
  card.querySelector(".fyu-search-btn").addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "mylist"));
    switchView("mylist");
    renderMyList();
    document.querySelector('.mltab[data-mltab="creators"]').click();
    setTimeout(() => document.getElementById("creatorSearchInput").focus(), 150);
  });
  card.querySelector(".foryou-cta").addEventListener("click", () => openDetail(d.id));
  card.querySelector(".fyu-title-row").addEventListener("click", () => openDetail(d.id));
  card.querySelector(".more-link").addEventListener("click", () => openDetail(d.id));

  let lastTap = 0;
  let singleTapTimer = null;
  card.addEventListener("pointerup", (e) => {
    if (e.target.closest("button, .fyu-title-row, .more-link")) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      clearTimeout(singleTapTimer);
      if (!state.likes[likeKey]) card.querySelector(".like-btn").click();
      spawnHeartBurst(card, e.clientX, e.clientY);
    } else {
      singleTapTimer = setTimeout(() => card.classList.toggle("paused"), 300);
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
const QUEST_TIERS = [
  { seconds: 30, coins: 1 },
  { seconds: 60, coins: 1 },
  { seconds: 120, coins: 2 },
  { seconds: 240, coins: 4 },
  { seconds: 420, coins: 6 },
  { seconds: 600, coins: 6 },
];
const FRESH_TIERS = [
  { seconds: 30, coins: 3 },
  { seconds: 120, coins: 9 },
  { seconds: 300, coins: 18 },
  { seconds: 600, coins: 30 },
];
const REDEEM_ITEMS = [
  { id: "vip1", name: "1-Day VIP Pass", cost: 3000, max: 3, icon: '<svg class="ic"><use href="#ic-crown"/></svg>' },
  { id: "vote", name: "Vote Prop", cost: 200, max: null, icon: '<svg class="ic"><use href="#ic-fire"/></svg>' },
  { id: "choice1", name: "Interactive Choice Pass", cost: 1000, max: null, icon: '<svg class="ic"><use href="#ic-ticket"/></svg>' },
  { id: "vip3", name: "3-Day VIP Pass", cost: 8000, max: 1, icon: '<svg class="ic"><use href="#ic-crown"/></svg>' },
  { id: "choice3", name: "Interactive Choice Pass x3", cost: 2500, max: null, icon: '<svg class="ic"><use href="#ic-ticket"/></svg>' },
];
const APP_PROMOS = [
  { icon: '<svg class="ic"><use href="#ic-comment"/></svg>', label: "StoryMe", bg: "linear-gradient(135deg,#7b2ff7,#f107a3)" },
  { icon: '<svg class="ic"><use href="#ic-mail"/></svg>', label: "MailDash", bg: "linear-gradient(135deg,#2b5876,#4e4376)" },
  { icon: '<svg class="ic"><use href="#ic-bolt"/></svg>', label: "QuizFlash", bg: "linear-gradient(135deg,#ff7a45,#c91e63)" },
  { icon: '<svg class="ic"><use href="#ic-puzzle"/></svg>', label: "PuzzleHit", bg: "linear-gradient(135deg,#0f2027,#2c5364)" },
];

let rewardsTickInterval = null;

function elapsedSeconds() {
  return Math.floor((Date.now() - state.sessionStart) / 1000);
}

function stopRewardsTicker() {
  if (rewardsTickInterval) { clearInterval(rewardsTickInterval); rewardsTickInterval = null; }
}

const SIMPLE_CLAIMABLE_TASKS = ["firstlogin", "login", "notif", "email", "addlist", "fulldrama", "fb", "ig", "yt", "tiktok"];

function hasClaimableRewards() {
  const el = elapsedSeconds();
  if (SIMPLE_CLAIMABLE_TASKS.some((key) => !state.claimedTasks[key])) return true;
  if (QUEST_TIERS.some((tier, i) => el >= tier.seconds && !state.questClaimed[i])) return true;
  if (FRESH_TIERS.some((tier, i) => el >= tier.seconds && !state.freshClaimed[i])) return true;
  return false;
}

function updateRewardsDots() {
  const claimable = hasClaimableRewards();
  document.getElementById("rewardsDot").style.display = claimable ? "block" : "none";
  const tabDot = document.getElementById("rewardsTabDot");
  if (tabDot) tabDot.style.display = claimable ? "block" : "none";
}

function renderRewards() {
  updateRewardsDots();
  renderQuestStrip();
  renderFreshDramaStrip();
  renderAdSlots();
  renderRedeemGrid();
  renderAppPromos();
  applyClaimedTaskButtons();
  updateCoinDisplays();
  document.getElementById("fullDramaProgress").textContent = state.claimedTasks.fulldrama ? "1" : "0";
  stopRewardsTicker();
  rewardsTickInterval = setInterval(() => {
    if (state.view !== "rewards") { stopRewardsTicker(); return; }
    renderQuestStrip();
    renderFreshDramaStrip();
  }, 5000);
}

function renderQuestStrip() {
  const el = elapsedSeconds();
  const strip = document.getElementById("questStrip");
  strip.innerHTML = "";
  let nextLocked = null;
  QUEST_TIERS.forEach((tier, i) => {
    const unlocked = el >= tier.seconds;
    const claimed = !!state.questClaimed[i];
    if (!unlocked && nextLocked === null) nextLocked = tier;
    const chip = document.createElement("div");
    chip.className = "quest-tier " + (claimed ? "claimed" : unlocked ? "unlocked" : "");
    chip.innerHTML = `<span class="qcoin"><svg class="ic ic-coin"><use href="#ic-coin"/></svg>${tier.coins}</span><span class="qtime">${formatTierTime(tier.seconds)}</span>`;
    strip.appendChild(chip);
  });
  document.getElementById("questSubText").innerHTML = nextLocked
    ? `Watch ${nextLocked.seconds - el}s more to earn <svg class="ic ic-coin"><use href="#ic-coin"/></svg>${nextLocked.coins}`
    : "All coin tiers unlocked!";
}

function formatTierTime(s) {
  if (s < 60) return s + "s";
  return Math.round(s / 60) + "min";
}

document.getElementById("claimAllQuestBtn").addEventListener("click", () => {
  const el = elapsedSeconds();
  let total = 0;
  QUEST_TIERS.forEach((tier, i) => {
    if (el >= tier.seconds && !state.questClaimed[i]) {
      state.questClaimed[i] = true;
      total += tier.coins;
    }
  });
  if (total > 0) {
    state.coins += total;
    saveState();
    updateCoinDisplays();
    renderQuestStrip();
    updateRewardsDots();
    toast(`+${total} coins claimed!`);
  } else {
    toast("Nothing to claim yet — keep watching!");
  }
});

function renderFreshDramaStrip() {
  const el = elapsedSeconds();
  const strip = document.getElementById("freshDramaStrip");
  strip.innerHTML = "";
  FRESH_TIERS.forEach((tier, i) => {
    const unlocked = el >= tier.seconds;
    const claimed = !!state.freshClaimed[i];
    const tile = document.createElement("div");
    tile.className = "fresh-tile " + (claimed ? "claimed" : unlocked ? "unlocked" : "");
    tile.innerHTML = `<b>${tier.coins}</b><span>${formatTierTime(tier.seconds)}</span>`;
    if (unlocked && !claimed) {
      tile.addEventListener("click", () => {
        state.freshClaimed[i] = true;
        state.coins += tier.coins;
        saveState();
        updateCoinDisplays();
        toast(`+${tier.coins} coins claimed!`);
        renderFreshDramaStrip();
        updateRewardsDots();
      });
    }
    strip.appendChild(tile);
  });
}

function renderAdSlots() {
  const wrap = document.getElementById("adSlots");
  wrap.innerHTML = "";
  document.getElementById("adsWatchedCount").textContent = state.adsWatchedToday;
  for (let i = 1; i <= 5; i++) {
    const claimed = i <= state.adsWatchedToday;
    const slot = document.createElement("div");
    slot.className = "ad-slot " + (claimed ? "claimed" : "");
    slot.innerHTML = `<b><svg class="ic ic-coin"><use href="#ic-coin"/></svg>10</b>Ad.${i}`;
    wrap.appendChild(slot);
  }
}

function watchAd() {
  if (state.adsWatchedToday >= 12) { toast("No more ads available today"); return; }
  toast("▶ Ad playing…");
  setTimeout(() => {
    state.adsWatchedToday += 1;
    state.coins += 10;
    saveState();
    updateCoinDisplays();
    renderAdSlots();
    toast("+10 coins earned!");
  }, 900);
}
document.getElementById("watchAdMainBtn").addEventListener("click", watchAd);

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".task-btn[data-task]");
  if (!btn || btn.disabled) return;
  const key = btn.dataset.task;
  if (state.claimedTasks[key]) return;
  const coins = Number(btn.dataset.coins) || 0;
  state.claimedTasks[key] = true;
  state.coins += coins;
  saveState();
  updateCoinDisplays();
  btn.textContent = "Claimed";
  btn.disabled = true;
  btn.classList.add("claimed-btn");
  toast(`+${coins} coins claimed!`);
  updateRewardsDots();
  if (key === "fulldrama") document.getElementById("fullDramaProgress").textContent = "1";
});

function applyClaimedTaskButtons() {
  document.querySelectorAll(".task-btn[data-task]").forEach((btn) => {
    if (state.claimedTasks[btn.dataset.task]) {
      btn.textContent = "Claimed";
      btn.disabled = true;
      btn.classList.add("claimed-btn");
    }
  });
}

function renderRedeemGrid() {
  const grid = document.getElementById("redeemGrid");
  grid.innerHTML = "";
  REDEEM_ITEMS.forEach((item) => {
    const owned = state.redeemed[item.id] || 0;
    const maxedOut = item.max !== null && owned >= item.max;
    const card = document.createElement("div");
    card.className = "redeem-card";
    card.innerHTML = `
      ${item.max !== null ? `<span class="redeem-owned">${owned}/${item.max}</span>` : ""}
      <div class="redeem-icon">${item.icon}</div>
      <div class="redeem-name">${item.name}</div>
      <button class="redeem-cost-btn" ${maxedOut ? "disabled" : ""}>${maxedOut ? "Maxed" : '<svg class="ic"><use href="#ic-gem"/></svg> ' + item.cost}</button>
    `;
    if (!maxedOut) {
      card.querySelector(".redeem-cost-btn").addEventListener("click", () => {
        if (state.gems < item.cost) { toast("Not enough gems"); return; }
        state.gems -= item.cost;
        state.redeemed[item.id] = owned + 1;
        saveState();
        updateCoinDisplays();
        toast(`Redeemed ${item.name}!`);
        renderRedeemGrid();
      });
    }
    grid.appendChild(card);
  });
}

function renderAppPromos() {
  const row = document.getElementById("appsRow");
  row.innerHTML = "";
  APP_PROMOS.forEach((app) => {
    const tile = document.createElement("div");
    tile.className = "app-tile";
    tile.innerHTML = `<div class="app-icon" style="background:${app.bg}">${app.icon}</div>${app.label}`;
    row.appendChild(tile);
  });
}

document.getElementById("crackBoxBtn").addEventListener("click", () => {
  state.gems += 3000;
  saveState();
  updateCoinDisplays();
  toast("Subscribed! +3000 gems");
  renderRedeemGrid();
});

document.querySelectorAll("#rewardsToptabs .rtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#rewardsToptabs .rtab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.rtab;
    document.getElementById("panel-rewards").classList.toggle("active", tab === "rewards");
    document.getElementById("panel-vipgems").classList.toggle("active", tab === "vipgems");
    document.getElementById("rewardsTabDot").style.display = (tab === "rewards" && hasClaimableRewards()) ? "block" : "none";
  });
});

document.querySelectorAll(".vgtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.vgtab;
    document.querySelectorAll(".vgtab").forEach((b) => b.classList.toggle("active", b.dataset.vgtab === tab));
    const target = document.getElementById(tab === "benefits" ? "vgSectionBenefits" : "vgSectionRedemption");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

const PROFILE_ICONS = {
  golive: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  upload: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5"/>',
  following: '<circle cx="10" cy="8" r="3.2"/><path d="M4 19c0-3.3 2.7-5.5 6-5.5"/><path d="M16.5 12.8c1.9-1.3 4.3.4 3.4 2.5-.5 1.2-2.1 2.4-3.4 3.2-1.3-.8-2.9-2-3.4-3.2-.9-2.1 1.5-3.8 3.4-2.5z"/>',
  earnrewards: '<rect x="3" y="8" width="18" height="4" rx="1"/><rect x="4" y="12" width="16" height="8" rx="1"/><path d="M12 8v12M9 8c-2-2.5-4.5-1-3 1s4 .5 3-1zM15 8c2-2.5 4.5-1 3 1s-4 .5-3-1z"/>',
  mylist: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h5M8 13h8"/>',
  notifications: '<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  invite: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z"/><path d="M12 6v12" stroke-dasharray="2 2"/>',
  myitems: '<path d="M11 4H6a2 2 0 0 0-2 2v5l9.5 9.5a2 2 0 0 0 2.8 0l4.2-4.2a2 2 0 0 0 0-2.8L11 4z"/><circle cx="8.5" cy="8.5" r="1.1"/>',
  feedback: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 1.5-2.3 1.8-2.3 3.5"/><path d="M12 17.2v.1"/>',
  language: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18"/>',
  setting: '<circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.15-1.4l1.9-1.3-1.8-3.1-2.15.75a7 7 0 0 0-2.4-1.4L14 3h-3.6l-.4 2.55a7 7 0 0 0-2.4 1.4L5.45 6.2 3.65 9.3l1.9 1.3A7 7 0 0 0 5.4 12c0 .48.05.94.15 1.4l-1.9 1.3 1.8 3.1 2.15-.75a7 7 0 0 0 2.4 1.4L10.4 21H14l.4-2.55a7 7 0 0 0 2.4-1.4l2.15.75 1.8-3.1-1.9-1.3c.1-.46.15-.92.15-1.4z"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 11h1v6h1"/>',
  leaderboard: '<path d="M8 21h8M12 17v4"/><path d="M6 4h12v6a6 6 0 0 1-12 0V4z"/><path d="M6 6H4a2 2 0 0 0 0 4h2M18 6h2a2 2 0 0 1 0 4h-2"/>',
  messages: '<path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
};

const PROFILE_MENU = [
  { key: "golive", label: "Go Live" },
  { key: "upload", label: "Upload Drama" },
  { key: "leaderboard", label: "Leaderboard" },
  { key: "messages", label: "Messages", dot: true },
  { key: "following", label: "Following" },
  { key: "earnrewards", label: "Earn Rewards" },
  { key: "mylist", label: "My List" },
  { key: "notifications", label: "Notifications", dot: true },
  { key: "invite", label: "Invitation Code" },
  { key: "myitems", label: "My Items" },
  { key: "feedback", label: "Feedback" },
  { key: "language", label: "Language" },
  { key: "setting", label: "Setting" },
  { key: "about", label: "About Us", version: "V1.0.0" },
];

function renderMine() {
  updateCoinDisplays();
  document.querySelector(".firstlogin-badge").classList.toggle("claimed-btn", !!state.claimedTasks.firstlogin);
  renderProfileMenu();
}

function renderProfileMenu() {
  const wrap = document.getElementById("profileMenu");
  wrap.innerHTML = "";
  const dotCountByKey = { notifications: notificationsUnreadCount, messages: dmUnreadCount };
  PROFILE_MENU.forEach((item) => {
    const row = document.createElement("button");
    row.className = "profile-row";
    row.dataset.action = item.key;
    row.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PROFILE_ICONS[item.key]}</svg>
      ${item.dot && (dotCountByKey[item.key] || 0) > 0 ? '<span class="row-dot"></span>' : ""}
      <span class="row-label">${item.label}</span>
      ${item.version ? `<span class="row-version">${item.version}</span>` : ""}
      <span class="row-chevron">›</span>
    `;
    wrap.appendChild(row);
  });
}

document.getElementById("profileMenu").addEventListener("click", (e) => {
  const row = e.target.closest(".profile-row");
  if (!row) return;
  const action = row.dataset.action;
  if (action === "golive") {
    openLiveHost();
  } else if (action === "upload") {
    openUploadModal();
  } else if (action === "leaderboard") {
    openLeaderboard();
  } else if (action === "messages") {
    if (!currentUser) { toast("Sign in to see messages"); openAuthModal("signin"); return; }
    openDmInbox();
  } else if (action === "following" || action === "mylist") {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "mylist"));
    switchView("mylist");
    renderMyList();
  } else if (action === "earnrewards") {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "rewards"));
    switchView("rewards");
    renderRewards();
  } else if (action === "notifications") {
    openNotifications();
  } else if (action === "myitems") {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "rewards"));
    switchView("rewards");
    renderRewards();
    document.querySelector('.rtab[data-rtab="vipgems"]').click();
    setTimeout(() => document.getElementById("vgSectionRedemption").scrollIntoView({ behavior: "smooth" }), 100);
  } else if (["invite", "feedback", "language", "setting", "about"].includes(action)) {
    const modalIds = { invite: "inviteModal", feedback: "feedbackModal", language: "languageModal", setting: "settingsModal", about: "aboutModal" };
    if (action === "language") renderLanguageOptions();
    if (action === "setting") renderSettingsToggles();
    openModal(modalIds[action]);
  }
});

document.getElementById("signInBtn").addEventListener("click", () => openAuthModal("signin"));
document.getElementById("signOutBtn").addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  toast("Signed out");
});
document.getElementById("authSwitchBtn").addEventListener("click", () => openAuthModal(authMode === "signin" ? "signup" : "signin"));
document.getElementById("authSubmitBtn").addEventListener("click", async () => {
  if (!supabaseClient) { showAuthError("Not available in this build."); return; }
  const email = document.getElementById("authEmailInput").value.trim();
  const password = document.getElementById("authPasswordInput").value;
  const username = document.getElementById("authUsernameInput").value.trim();
  if (!email || !password) { showAuthError("Enter your email and password."); return; }
  if (authMode === "signup" && !username) { showAuthError("Choose a username."); return; }
  const btn = document.getElementById("authSubmitBtn");
  btn.disabled = true;
  try {
    if (authMode === "signup") {
      const { error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) { showAuthError(error.message); return; }
      toast("Account created!");
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) { showAuthError(error.message); return; }
      toast("Welcome back!");
    }
    closeModal("authModal");
  } finally {
    btn.disabled = false;
  }
});
document.getElementById("copyUidBtn").addEventListener("click", () => {
  const uid = document.getElementById("uidText").textContent;
  navigator.clipboard.writeText(uid).then(() => toast("UID copied")).catch(() => toast("UID copied"));
});

document.getElementById("applyInviteBtn").addEventListener("click", () => {
  const code = document.getElementById("inviteCodeInput").value.trim();
  if (!code) { toast("Enter a code first"); return; }
  if (state.claimedTasks.invite) { toast("Invite bonus already claimed"); closeModal("inviteModal"); return; }
  state.claimedTasks.invite = true;
  state.coins += 50;
  saveState();
  updateCoinDisplays();
  toast("+50 coins — invite code applied!");
  document.getElementById("inviteCodeInput").value = "";
  closeModal("inviteModal");
});

document.getElementById("submitFeedbackBtn").addEventListener("click", async () => {
  const text = document.getElementById("feedbackInput").value.trim();
  if (!text) { toast("Write something first"); return; }
  if (!currentUser) { toast("Sign in to send feedback"); openAuthModal("signin"); return; }
  const { error } = await supabaseClient.from("feedback").insert({ user_id: currentUser.id, text });
  document.getElementById("feedbackInput").value = "";
  toast(error ? "Feedback failed to send" : "Thanks for your feedback!");
  closeModal("feedbackModal");
});

const LANGUAGES = ["English", "Español", "中文", "Bahasa Indonesia", "Tiếng Việt"];
function renderLanguageOptions() {
  const list = document.getElementById("langList");
  list.innerHTML = "";
  LANGUAGES.forEach((lang) => {
    const row = document.createElement("div");
    row.className = "lang-option" + (state.language === lang ? " selected" : "");
    row.innerHTML = `<span>${lang}</span><span class="check">✓</span>`;
    row.addEventListener("click", () => {
      state.language = lang;
      saveState();
      toast(`Language set to ${lang}`);
      renderLanguageOptions();
      closeModal("languageModal");
    });
    list.appendChild(row);
  });
}

function renderSettingsToggles() {
  document.getElementById("toggleNotif").classList.toggle("on", state.notifOn);
  document.getElementById("toggleAutoplay").classList.toggle("on", state.autoplayNext);
}
document.getElementById("toggleNotif").addEventListener("click", async () => {
  const turningOn = !state.notifOn;
  if (turningOn) {
    if (!currentUser) { toast("Sign in to enable push notifications"); openAuthModal("signin"); return; }
    const ok = await subscribeToPush();
    if (!ok) return;
  } else {
    await unsubscribeFromPush();
  }
  state.notifOn = turningOn;
  saveState();
  renderSettingsToggles();
});
document.getElementById("toggleAutoplay").addEventListener("click", () => {
  state.autoplayNext = !state.autoplayNext;
  saveState();
  renderSettingsToggles();
});

/* ---------------- Gifts ---------------- */
const GIFT_ITEMS = [
  { id: "rose", name: "Rose", cost: 10, icon: "ic-rose", color: "#ff5c8a" },
  { id: "heart", name: "Heart", cost: 50, icon: "ic-heart-filled", color: "#ff3860" },
  { id: "crown", name: "Crown", cost: 500, icon: "ic-crown", color: "#ffc93c" },
  { id: "rocket", name: "Rocket", cost: 1000, icon: "ic-rocket", color: "#4fc3f7" },
  { id: "diamond", name: "Diamond", cost: 5000, icon: "ic-gem", color: "#7fd9ff" },
];

let giftTargetStage = null;

function renderGiftGrid() {
  const grid = document.getElementById("giftGrid");
  grid.innerHTML = "";
  GIFT_ITEMS.forEach((g) => {
    const card = document.createElement("button");
    card.className = "gift-card";
    const affordable = state.coins >= g.cost;
    card.disabled = !affordable;
    card.innerHTML = `
      <svg class="ic gift-icon" style="color:${g.color}"><use href="#${g.icon}"/></svg>
      <div class="gift-name">${g.name}</div>
      <div class="gift-cost"><svg class="ic ic-coin"><use href="#ic-coin"/></svg>${g.cost}</div>
    `;
    card.addEventListener("click", () => sendGift(g));
    grid.appendChild(card);
  });
}

async function sendGift(gift) {
  if (!currentLiveHostId) { closeModal("giftModal"); return; }
  if (state.coins < gift.cost) { toast("Not enough coins"); closeModal("giftModal"); openModal("coinModal"); return; }
  closeModal("giftModal");
  const { error } = await supabaseClient.rpc("send_gift", { p_host_id: currentLiveHostId, p_amount: gift.cost });
  if (error) { toast(error.message.includes("insufficient") ? "Not enough coins" : "Gift failed"); return; }
  await refreshWalletFromServer();
  const stage = document.getElementById(giftTargetStage);
  spawnGiftFly(stage, gift);
  const chatFeedId = giftTargetStage === "liveHostStage" ? "hostChatFeed" : "guestChatFeed";
  addLiveChatMessage(chatFeedId, "You", `sent a ${gift.name}!`, true);
  if (currentLiveRoom) {
    const payload = new TextEncoder().encode(JSON.stringify({
      type: "gift", name: currentProfile?.username || "Someone", giftId: gift.id, giftName: gift.name, cost: gift.cost,
    }));
    currentLiveRoom.localParticipant.publishData(payload, { reliable: true });
  }
}

function spawnGiftFly(stage, gift) {
  const fly = document.createElement("div");
  fly.className = "gift-fly";
  fly.innerHTML = `<svg class="ic" style="color:${gift.color}"><use href="#${gift.icon}"/></svg><span class="gift-fly-label">${gift.name} x1</span>`;
  stage.appendChild(fly);
  fly.addEventListener("animationend", () => fly.remove());
}

/* ---------------- Live (real, via LiveKit Cloud + Supabase) ---------------- */
let liveSessionsCache = [];
let currentLiveRoom = null;
let currentLiveRoomName = null;
let currentLiveHostId = null;
let hostSessionEarned = 0;
let presenceChannel = null;

function addLiveChatMessage(feedId, name, text, isGift) {
  const feed = document.getElementById(feedId);
  if (!feed) return;
  const row = document.createElement("div");
  row.className = "live-chat-msg" + (isGift ? " gift-msg" : "");
  row.innerHTML = `<b>${name}</b> ${text}`;
  feed.appendChild(row);
  feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 30) feed.removeChild(feed.firstChild);
}

async function fetchLiveSessions() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("live_sessions")
    .select("id, room_name, host_id, title, started_at, host:profiles(username)")
    .is("ended_at", null)
    .order("started_at", { ascending: false });
  if (error) return;
  liveSessionsCache = (data || [])
    .filter((s) => s.host_id !== currentUser?.id)
    .map((s) => ({
      id: s.id,
      room: s.room_name,
      hostId: s.host_id,
      name: s.host?.username || "Live host",
      tag: s.title || "Live",
      following: followingIds.has(s.host_id),
    }));
  renderLiveStrip();
  if (state.view === "foryou") renderForYouFeed();
}

function subscribeLiveSessionsRealtime() {
  if (!supabaseClient) return;
  supabaseClient
    .channel("live_sessions_public")
    .on("postgres_changes", { event: "*", schema: "public", table: "live_sessions" }, fetchLiveSessions)
    .subscribe();
}

function renderLiveStrip() {
  const strip = document.getElementById("liveStrip");
  strip.innerHTML = "";
  strip.style.display = liveSessionsCache.length ? "" : "none";
  liveSessionsCache.forEach((host) => {
    const wrap = document.createElement("div");
    wrap.className = "live-avatar-wrap";
    wrap.innerHTML = `
      <div class="live-ring">
        <div class="live-avatar-inner" style="background:${gradientFor(host.id)}">${host.name[0].toUpperCase()}</div>
        <span class="live-tag-badge">LIVE</span>
      </div>
      <span class="live-name">${host.name}</span>
    `;
    wrap.addEventListener("click", () => openLiveGuest(host));
    strip.appendChild(wrap);
  });
}

async function getLiveKitToken(room) {
  const { data, error } = await supabaseClient.functions.invoke("livekit-token", { body: { room } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

function joinPresence(room, countElId) {
  leavePresence();
  if (!supabaseClient) return;
  presenceChannel = supabaseClient.channel(`presence:${room}`, {
    config: { presence: { key: currentUser?.id || crypto.randomUUID() } },
  });
  presenceChannel.on("presence", { event: "sync" }, () => {
    const count = Object.keys(presenceChannel.presenceState()).length;
    const el = document.getElementById(countElId);
    if (el) el.textContent = Math.max(1, count);
  });
  presenceChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") presenceChannel.track({ joined_at: Date.now() });
  });
}
function leavePresence() {
  if (presenceChannel && supabaseClient) supabaseClient.removeChannel(presenceChannel);
  presenceChannel = null;
}

function setupLiveRoomListeners(room, isHost) {
  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== "video" || isHost) return;
    const video = document.getElementById("guestHostVideo");
    track.attach(video);
    video.style.display = "block";
    document.getElementById("liveGuestBg").style.display = "none";
  });
  room.on(LivekitClient.RoomEvent.DataReceived, (payload) => {
    let msg;
    try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    const chatFeedId = isHost ? "hostChatFeed" : "guestChatFeed";
    const stageId = isHost ? "liveHostStage" : "liveGuestStage";
    if (msg.type === "chat") {
      addLiveChatMessage(chatFeedId, msg.name, msg.text, false);
    } else if (msg.type === "gift") {
      addLiveChatMessage(chatFeedId, msg.name, `sent a ${msg.giftName}!`, true);
      const giftDef = GIFT_ITEMS.find((g) => g.id === msg.giftId);
      if (giftDef) spawnGiftFly(document.getElementById(stageId), giftDef);
      if (isHost) {
        hostSessionEarned += msg.cost;
        document.getElementById("hostEarnedCoins").textContent = hostSessionEarned;
        refreshWalletFromServer();
      }
    }
  });
}

async function openLiveHost() {
  if (!currentUser) { toast("Sign in to go live"); openAuthModal("signin"); return; }
  switchView("live-host");
  document.getElementById("hostChatFeed").innerHTML = "";
  hostSessionEarned = 0;
  document.getElementById("hostEarnedCoins").textContent = "0";
  document.getElementById("hostViewerCount").textContent = "1";
  giftTargetStage = "liveHostStage";

  const roomName = `live-${currentUser.id}`;
  currentLiveRoomName = roomName;
  currentLiveHostId = currentUser.id;

  const { error: upsertError } = await supabaseClient
    .from("live_sessions")
    .upsert(
      { host_id: currentUser.id, room_name: roomName, title: "Live now", started_at: new Date().toISOString(), ended_at: null },
      { onConflict: "room_name" }
    );
  if (upsertError) { toast("Couldn't start live: " + upsertError.message); switchView("mine"); return; }

  const video = document.getElementById("hostCamPreview");
  const fallback = document.getElementById("hostFallbackBg");
  fallback.style.background = gradientFor("host-live");

  try {
    const { token, url } = await getLiveKitToken(roomName);
    const room = new LivekitClient.Room();
    setupLiveRoomListeners(room, true);
    await room.connect(url, token);
    currentLiveRoom = room;
    const pub = await room.localParticipant.setCameraEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(true);
    if (pub?.track) {
      pub.track.attach(video);
      video.style.display = "block";
      fallback.style.display = "none";
    } else {
      video.style.display = "none";
      fallback.style.display = "block";
    }
  } catch (e) {
    toast("Camera/mic access needed to go live");
    video.style.display = "none";
    fallback.style.display = "block";
  }

  joinPresence(roomName, "hostViewerCount");
}

async function closeLiveHost() {
  leavePresence();
  if (currentLiveRoom) { currentLiveRoom.disconnect(); currentLiveRoom = null; }
  if (currentLiveRoomName && currentUser) {
    await supabaseClient.from("live_sessions").update({ ended_at: new Date().toISOString() }).eq("room_name", currentLiveRoomName).eq("host_id", currentUser.id);
  }
  const earned = hostSessionEarned;
  currentLiveRoomName = null;
  currentLiveHostId = null;
  switchView("mine");
  renderMine();
  toast(earned > 0 ? `Live ended — ${earned} coins earned` : "Live ended");
}
document.getElementById("hostExitBtn").addEventListener("click", closeLiveHost);
document.getElementById("endLiveBtn").addEventListener("click", closeLiveHost);

async function openLiveGuest(host) {
  if (!currentUser) { toast("Sign in to watch live"); openAuthModal("signin"); return; }
  switchView("live-guest");
  giftTargetStage = "liveGuestStage";
  document.getElementById("guestChatFeed").innerHTML = "";
  document.getElementById("liveHostName").textContent = host.name;
  document.getElementById("liveHostTag").textContent = host.tag;
  document.getElementById("liveHostAvatar").style.background = gradientFor(host.hostId);
  document.getElementById("liveGuestBg").style.background = gradientFor(host.hostId, 2);
  document.getElementById("liveGuestBg").style.display = "block";
  document.getElementById("guestHostVideo").style.display = "none";
  document.getElementById("guestViewerCount").textContent = "1";

  const joinBtn = document.getElementById("joinGuestBtn");
  joinBtn.textContent = "Join";
  joinBtn.classList.remove("joined");
  const pip = document.getElementById("guestCamPip");
  pip.style.display = "none";

  currentLiveRoomName = host.room;
  currentLiveHostId = host.hostId;
  updateLiveFollowBtn();

  try {
    const { token, url } = await getLiveKitToken(host.room);
    const room = new LivekitClient.Room();
    setupLiveRoomListeners(room, false);
    await room.connect(url, token);
    currentLiveRoom = room;
  } catch (e) {
    toast("This live just ended");
    closeLiveGuest();
    return;
  }

  joinPresence(host.room, "guestViewerCount");
  addLiveChatMessage("guestChatFeed", host.name, "Welcome to my live! 🎉", false);
}

function closeLiveGuest() {
  leavePresence();
  if (currentLiveRoom) { currentLiveRoom.disconnect(); currentLiveRoom = null; }
  currentLiveRoomName = null;
  currentLiveHostId = null;
  switchView("home");
}
document.getElementById("guestExitBtn").addEventListener("click", closeLiveGuest);

function updateLiveFollowBtn() {
  const btn = document.getElementById("liveFollowBtn");
  const isFollowing = !!(currentLiveHostId && followingIds.has(currentLiveHostId));
  btn.textContent = isFollowing ? "Following" : "+ Follow";
  btn.classList.toggle("following", isFollowing);
}

document.getElementById("liveFollowBtn").addEventListener("click", async () => {
  if (!currentLiveHostId) return;
  await toggleFollow(currentLiveHostId, document.getElementById("liveFollowBtn"));
  updateLiveFollowBtn();
});

document.getElementById("joinGuestBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const pip = document.getElementById("guestCamPip");
  if (!currentLiveRoom) return;
  if (btn.classList.contains("joined")) {
    await currentLiveRoom.localParticipant.setCameraEnabled(false);
    await currentLiveRoom.localParticipant.setMicrophoneEnabled(false);
    pip.style.display = "none";
    btn.classList.remove("joined");
    btn.textContent = "Join";
    return;
  }
  try {
    const pub = await currentLiveRoom.localParticipant.setCameraEnabled(true);
    await currentLiveRoom.localParticipant.setMicrophoneEnabled(true);
    if (pub?.track) pub.track.attach(pip);
    pip.style.display = "block";
    btn.classList.add("joined");
    btn.textContent = "Leave";
    addLiveChatMessage("guestChatFeed", "You", "joined as a guest!", false);
  } catch (e) {
    toast("Camera access denied");
  }
});

document.getElementById("liveGiftBtn").addEventListener("click", () => {
  giftTargetStage = "liveGuestStage";
  renderGiftGrid();
  openModal("giftModal");
});

document.getElementById("liveChatInput").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const input = e.currentTarget;
  const text = input.value.trim();
  if (!text) return;
  addLiveChatMessage("guestChatFeed", "You", text, false);
  if (currentLiveRoom) {
    const name = currentProfile?.username || "Someone";
    const payload = new TextEncoder().encode(JSON.stringify({ type: "chat", name, text }));
    currentLiveRoom.localParticipant.publishData(payload, { reliable: true });
  }
  input.value = "";
});

/* ---------------- Init ---------------- */
function init() {
  loadState();
  updateCoinDisplays();
  renderFeed();
  renderLiveStrip();
  renderContinueWatching();
  switchView("home");
  renderCoinPackages();
  updateRewardsDots();
  setInterval(updateRewardsDots, 5000);

  const splash = document.getElementById("splash");
  setTimeout(() => splash.classList.add("hide"), 900);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  document.getElementById("brandRefreshBtn").addEventListener("click", () => location.reload());

  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session?.user) handleSignedIn(session.user);
      else handleSignedOut();
    });
    fetchLiveSessions();
    subscribeLiveSessionsRealtime();
    fetchRealDramas();
  }
}
init();
