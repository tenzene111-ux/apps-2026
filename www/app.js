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
let blockedIds = new Set();
let notificationsUnreadCount = 0;
let notificationsChannel = null;
let dmUnreadCount = 0;
let dmInboxChannel = null;
let dmChatChannel = null;
let currentDmPartnerId = null;
let globalPresenceChannel = null;
let onlineUserIds = new Set();
let lastSeenInterval = null;
let dmTypingTimeout = null;
let dmLastTypingSentAt = 0;
let currentDmPartnerLastSeen = null;
let dmReplyTarget = null;
let dmMessagesById = new Map();
let dmReactionsByMessage = new Map();
let dmVoiceRecorder = null;
let dmVoiceStream = null;
let dmVoiceChunks = [];
let dmVoiceStartedAt = 0;
const DM_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢"];
let dmConversationMeta = new Map();
let dmChatSearchActive = false;
let dmChatSearchTerm = "";
let groupsById = new Map();
let groupMembersByGroup = new Map();
let currentGroupId = null;
let currentGroupName = null;
let groupChatChannel = null;
let groupsListChannel = null;
let groupMessagesById = new Map();
let groupMemberUsernames = new Map();
let callRoom = null;
let currentCallId = null;
let currentCallIsCaller = false;
let currentCallPartnerId = null;
let currentCallPartnerName = null;
let currentCallIsVideo = false;
let currentCallEnded = true;
let callLocalStream = null;
let callLocalVideoTrack = null;
let callLocalAudioTrack = null;
let callRingTimeoutHandle = null;
let callStatusChannel = null;
let callConnectStartedAt = null;
let pendingIncomingCall = null;

const state = {
  coins: 0,
  unlocked: {},
  followed: {},
  likes: {},
  view: "home",
  currentDrama: null,
  currentEpIndex: 0,
  feedFilter: "all",
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
  document.getElementById("editProfileBtn").style.display = signedIn ? "" : "none";
  document.getElementById("profileNameText").textContent = signedIn
    ? (currentProfile?.username || currentUser.email || "Member")
    : "Guest";
  document.getElementById("uidText").textContent = signedIn ? currentUser.id.slice(0, 10) : "1062724055";
  const handleEl = document.getElementById("profileHandleText");
  handleEl.style.display = signedIn && currentProfile?.username ? "block" : "none";
  handleEl.textContent = currentProfile?.username ? "@" + currentProfile.username : "";
  const bioEl = document.getElementById("profileBioText");
  bioEl.style.display = signedIn && currentProfile?.bio ? "block" : "none";
  bioEl.textContent = currentProfile?.bio || "";
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
  await loadBlocked();
  await loadDmConversationMeta();
  await loadRewardClaims();
  await loadRedemptions();
  fetchLiveSessions();
  refreshNotificationsUnread();
  subscribeNotificationsRealtime();
  syncWatchHistoryFromServer();
  refreshDmUnread();
  subscribeDmInboxRealtime();
  subscribeIncomingCalls();
  joinGlobalPresence();
  touchLastSeen();
  if (lastSeenInterval) clearInterval(lastSeenInterval);
  lastSeenInterval = setInterval(touchLastSeen, 60000);
}

async function loadFollowing() {
  if (!currentUser || !supabaseClient) { followingIds = new Set(); return; }
  const { data } = await supabaseClient.from("follows").select("followed_id").eq("follower_id", currentUser.id);
  followingIds = new Set((data || []).map((r) => r.followed_id));
}

async function loadBlocked() {
  if (!currentUser || !supabaseClient) { blockedIds = new Set(); return; }
  const { data } = await supabaseClient.from("blocks").select("blocked_id").eq("blocker_id", currentUser.id);
  blockedIds = new Set((data || []).map((r) => r.blocked_id));
}

async function loadDmConversationMeta() {
  dmConversationMeta = new Map();
  if (!currentUser || !supabaseClient) return;
  const { data } = await supabaseClient.from("dm_conversation_meta").select("*").eq("owner_id", currentUser.id);
  (data || []).forEach((row) => dmConversationMeta.set(row.partner_id, row));
}

function getDmMeta(partnerId) {
  return dmConversationMeta.get(partnerId) || { pinned: false, muted: false, accepted: false, hidden: false };
}

async function setDmMeta(partnerId, patch) {
  if (!currentUser || !supabaseClient) return;
  const current = getDmMeta(partnerId);
  const next = { ...current, ...patch, owner_id: currentUser.id, partner_id: partnerId, updated_at: new Date().toISOString() };
  dmConversationMeta.set(partnerId, next);
  await supabaseClient.from("dm_conversation_meta").upsert(next, { onConflict: "owner_id,partner_id" });
}

function recordClaim(key) {
  if (currentUser && supabaseClient) {
    supabaseClient.from("reward_claims").insert({ user_id: currentUser.id, claim_key: key }).then(() => {});
  }
}

async function loadRewardClaims() {
  if (!currentUser || !supabaseClient) return;
  const { data } = await supabaseClient.from("reward_claims").select("claim_key").eq("user_id", currentUser.id);
  (data || []).forEach((r) => {
    const key = r.claim_key;
    if (key.startsWith("quest:")) state.questClaimed[Number(key.slice(6))] = true;
    else if (key.startsWith("fresh:")) state.freshClaimed[Number(key.slice(6))] = true;
    else if (key.startsWith("task:")) state.claimedTasks[key.slice(5)] = true;
  });
  saveState();
  if (state.view === "rewards") renderRewards();
}

function recordRedemption(itemId, newCount) {
  if (currentUser && supabaseClient) {
    supabaseClient.from("redemptions").upsert({ user_id: currentUser.id, item_id: itemId, count: newCount }, { onConflict: "user_id,item_id" }).then(() => {});
  }
}

async function loadRedemptions() {
  if (!currentUser || !supabaseClient) return;
  const { data } = await supabaseClient.from("redemptions").select("item_id, count").eq("user_id", currentUser.id);
  (data || []).forEach((r) => { state.redeemed[r.item_id] = r.count; });
  saveState();
  if (state.view === "rewards") renderRewards();
}

async function toggleBlock(userId, btn) {
  if (!currentUser) { toast("Sign in to block users"); openAuthModal("signin"); return; }
  const isBlocked = blockedIds.has(userId);
  if (btn) btn.disabled = true;
  if (isBlocked) {
    const { error } = await supabaseClient.from("blocks").delete().eq("blocker_id", currentUser.id).eq("blocked_id", userId);
    if (!error) blockedIds.delete(userId);
  } else {
    const { error } = await supabaseClient.from("blocks").insert({ blocker_id: currentUser.id, blocked_id: userId });
    if (!error) blockedIds.add(userId);
  }
  if (btn) btn.disabled = false;
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
  if (n.type === "went_live") return `<b>${name}</b> is live now`;
  if (n.type === "new_drama") return `<b>${name}</b> uploaded a new drama: ${n.data?.title || ""}`;
  return `<b>${name}</b> did something`;
}

async function openNotifications() {
  if (!currentUser) { toast("Sign in to see notifications"); openAuthModal("signin"); return; }
  const list = document.getElementById("notificationsList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';
  openModal("notificationsModal");

  const { data } = await supabaseClient
    .from("notifications")
    .select("id, type, data, created_at, actor:profiles!actor_id(username)")
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
  blockedIds = new Set();
  notificationsUnreadCount = 0;
  if (notificationsChannel && supabaseClient) { supabaseClient.removeChannel(notificationsChannel); notificationsChannel = null; }
  dmUnreadCount = 0;
  if (dmInboxChannel && supabaseClient) { supabaseClient.removeChannel(dmInboxChannel); dmInboxChannel = null; }
  if (dmChatChannel && supabaseClient) { supabaseClient.removeChannel(dmChatChannel); dmChatChannel = null; }
  leaveGlobalPresence();
  if (lastSeenInterval) { clearInterval(lastSeenInterval); lastSeenInterval = null; }
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
  document.getElementById("authForgotBtn").style.display = mode === "signup" ? "none" : "";
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
  document.getElementById("bottomNav").style.display = (name === "player" || name === "live-host" || name === "live-guest" || name === "dm-chat" || name === "group-chat" || name === "call") ? "none" : "flex";
  const tabForView = { home: "home", foryou: "foryou", "dm-inbox": "inbox", rewards: "profile", mine: "profile" };
  if (tabForView[name]) {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === tabForView[name]));
  }
}

function renderContinueWatching(sectionId = "continueSection", stripId = "continueStrip") {
  const section = document.getElementById(sectionId);
  const strip = document.getElementById(stripId);
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

function renderHomeDashboard() {
  renderHeroCarousel();
  renderLiveStrip();
  renderContinueWatching();
  renderTrendingStrip();
  renderOriginalsStrip();
}

function renderHeroCarousel() {
  const wrap = document.getElementById("heroCarousel");
  wrap.innerHTML = "";
  const top = [...DRAMAS].sort((a, b) => parseFloat(b.views) - parseFloat(a.views)).slice(0, 5);
  if (!top.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";

  const track = document.createElement("div");
  track.className = "hero-track";
  top.forEach((d) => {
    const slide = document.createElement("div");
    slide.className = "hero-slide";
    slide.style.cssText = coverStyle(d, 1);
    slide.innerHTML = `
      <div class="hero-vignette"></div>
      <div class="hero-info">
        <span class="hero-eyebrow">Popular Now</span>
        <h2>${d.title}</h2>
        <p class="hero-meta">${d.episodes} Episodes · ${d.label}</p>
        <div class="hero-actions">
          <button class="hero-play-btn"><svg class="ic"><use href="#ic-play"/></svg> Play</button>
          <button class="hero-list-btn"><svg class="ic"><use href="#ic-bookmark${state.followed[d.id] ? '-filled' : ''}"/></svg> My List</button>
        </div>
      </div>
    `;
    slide.querySelector(".hero-play-btn").addEventListener("click", (e) => { e.stopPropagation(); openPlayer(d.id, 0); });
    slide.querySelector(".hero-list-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      state.followed[d.id] = !state.followed[d.id];
      saveState();
      toast(state.followed[d.id] ? "Added to My List" : "Removed from My List");
      renderHeroCarousel();
    });
    slide.addEventListener("click", () => openDetail(d.id));
    track.appendChild(slide);
  });
  wrap.appendChild(track);

  if (top.length > 1) {
    const dots = document.createElement("div");
    dots.className = "hero-dots";
    top.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "hero-dot" + (i === 0 ? " active" : "");
      dots.appendChild(dot);
    });
    wrap.appendChild(dots);
    track.addEventListener("scroll", () => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      dots.querySelectorAll(".hero-dot").forEach((d, i) => d.classList.toggle("active", i === idx));
    });
  }
}

function renderTrendingStrip() {
  const strip = document.getElementById("trendingStrip");
  const titleRow = document.getElementById("trendingSectionTitle");
  strip.innerHTML = "";
  const top = [...DRAMAS].sort((a, b) => parseFloat(b.views) - parseFloat(a.views)).slice(0, 10);
  const show = top.length > 0;
  titleRow.style.display = show ? "flex" : "none";
  strip.style.display = show ? "flex" : "none";
  top.forEach((d, i) => {
    const card = document.createElement("div");
    card.className = "trending-card";
    card.innerHTML = `
      <div class="trending-thumb" style="${coverStyle(d, 1)}">
        ${i < 3 ? `<span class="rank-ribbon rank-${i + 1}">TOP ${i + 1}</span>` : ""}
      </div>
      <p class="trending-title">${d.title}</p>
      <p class="trending-sub">${d.label}</p>
    `;
    card.addEventListener("click", () => openDetail(d.id));
    strip.appendChild(card);
  });
}

function renderOriginalsStrip() {
  const strip = document.getElementById("originalsStrip");
  const titleRow = document.getElementById("originalsSectionTitle");
  strip.innerHTML = "";
  const latest = DRAMAS.slice(0, 10);
  const show = latest.length > 0;
  titleRow.style.display = show ? "flex" : "none";
  strip.style.display = show ? "flex" : "none";
  latest.forEach((d) => {
    const card = document.createElement("div");
    card.className = "originals-card";
    card.innerHTML = `
      <div class="originals-thumb" style="${coverStyle(d, 1)}">
        ${d.badge === "New" ? '<span class="new-ep-badge">NEW EPISODE</span>' : ""}
      </div>
      <p class="originals-title">${d.title}</p>
    `;
    card.addEventListener("click", () => openDetail(d.id));
    strip.appendChild(card);
  });
}

function renderFeed() {
  const feed = document.getElementById("feed");
  feed.innerHTML = "";

  let list;
  if (state.feedFilter === "new") {
    list = DRAMAS.filter(d => d.badge === "New");
  } else if (state.feedFilter === "ranking") {
    list = [...DRAMAS].sort((a, b) => parseFloat(b.views) - parseFloat(a.views));
  } else if (state.feedFilter === "all") {
    list = DRAMAS;
  } else {
    list = DRAMAS.filter(d => d.genre === state.feedFilter);
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
    const rankBadge = state.feedFilter === "ranking" && i < 3
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
    const progress = state.watchHistory[d.id];
    const card = document.createElement("div");
    card.className = "drama-card";
    card.innerHTML = `
      <div class="drama-cover" style="${coverStyle(d)}">
        <span class="play-glyph"><svg class="ic"><use href="#ic-play"/></svg></span>
      </div>
      <div class="drama-info">
        <h3>${d.title}</h3>
        <p class="desc">${d.desc}</p>
        <div class="drama-meta">
          <span class="tag">${d.episodes} EP</span>
          ${progress ? `<span class="tag progress-tag">EP ${progress.epNum} · ${d.episodes - progress.epNum} to go</span>` : ""}
        </div>
      </div>`;
    card.addEventListener("click", () => openDetail(d.id));
    wrap.appendChild(card);
  });
}

function renderHistoryList() {
  const wrap = document.getElementById("historyFeed");
  wrap.innerHTML = "";
  const entries = Object.entries(state.watchHistory)
    .map(([dramaId, progress]) => ({ drama: DRAMAS.find((d) => d.id === dramaId), ...progress }))
    .filter((e) => e.drama)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!entries.length) {
    wrap.innerHTML = '<div class="empty-state">Dramas you watch will show up here.</div>';
    return;
  }
  entries.forEach(({ drama, epNum }) => {
    const card = document.createElement("div");
    card.className = "drama-card";
    const pct = Math.round((epNum / drama.episodes) * 100);
    card.innerHTML = `
      <div class="drama-cover" style="${coverStyle(drama)}">
        <span class="play-glyph"><svg class="ic"><use href="#ic-play"/></svg></span>
      </div>
      <div class="drama-info">
        <h3>${drama.title}</h3>
        <p class="desc">${drama.desc}</p>
        <div class="drama-meta"><span class="tag progress-tag">EP ${epNum} · ${pct}% watched</span></div>
      </div>`;
    card.addEventListener("click", () => openPlayer(drama.id, epNum - 1));
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
    if (tab.dataset.mltab === "history") renderHistoryList();
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

  const blockBtn = document.getElementById("creatorProfileBlockBtn");
  const reportBtn = document.getElementById("creatorProfileReportBtn");
  const isSelf = currentUser && currentUser.id === userId;
  blockBtn.style.display = isSelf ? "none" : "";
  reportBtn.style.display = isSelf ? "none" : "";
  const applyBlockState = () => {
    const isBlocked = blockedIds.has(userId);
    blockBtn.textContent = isBlocked ? "Unblock" : "Block";
    blockBtn.classList.toggle("blocked", isBlocked);
  };
  applyBlockState();
  blockBtn.onclick = async () => {
    await toggleBlock(userId, blockBtn);
    applyBlockState();
  };
  reportBtn.onclick = async () => {
    if (!currentUser) { toast("Sign in to report"); openAuthModal("signin"); return; }
    if (!confirm(`Report ${username} for inappropriate behavior?`)) return;
    const { error } = await supabaseClient.from("reports").insert({ reporter_id: currentUser.id, reported_user_id: userId });
    toast(error ? "Report failed to send" : "Report submitted — thanks for letting us know");
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

/* ---------------- Creator analytics (real, from views/likes/follows) ---------------- */
async function openAnalytics() {
  if (!currentUser) { toast("Sign in to see analytics"); openAuthModal("signin"); return; }
  switchView("analytics");

  const myDramaIds = DRAMAS.filter((d) => d.real && d.creatorId === currentUser.id).map((d) => d.id);

  const totalViews = myDramaIds.reduce((sum, id) => {
    const d = DRAMAS.find((x) => x.id === id);
    return sum + (parseInt(d.views, 10) || 0);
  }, 0);
  document.getElementById("analyticsTotalViews").textContent = totalViews;

  let likeRows = [];
  if (myDramaIds.length) {
    const { data } = await supabaseClient.from("episode_likes").select("created_at").in("drama_id", myDramaIds);
    likeRows = data || [];
  }
  document.getElementById("analyticsTotalLikes").textContent = likeRows.length;

  const { count: followerCount } = await supabaseClient
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("followed_id", currentUser.id);
  document.getElementById("analyticsTotalFollowers").textContent = followerCount || 0;

  let viewRows = [];
  if (myDramaIds.length) {
    const { data } = await supabaseClient.from("drama_views").select("created_at").in("drama_id", myDramaIds);
    viewRows = data || [];
  }
  renderAnalyticsChart("analyticsViewsChart", viewRows.map((r) => r.created_at));

  const { data: followRows } = await supabaseClient.from("follows").select("created_at").eq("followed_id", currentUser.id);
  renderAnalyticsChart("analyticsFollowersChart", (followRows || []).map((r) => r.created_at));
}

function renderAnalyticsChart(elId, timestamps) {
  const days = 14;
  const counts = new Array(days).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  timestamps.forEach((ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - d) / 86400000);
    if (diffDays >= 0 && diffDays < days) counts[days - 1 - diffDays]++;
  });
  const max = Math.max(1, ...counts);
  const el = document.getElementById(elId);
  el.innerHTML = "";
  counts.forEach((c) => {
    const bar = document.createElement("div");
    bar.className = "analytics-bar";
    bar.style.height = `${Math.max(4, (c / max) * 100)}%`;
    bar.title = c;
    el.appendChild(bar);
  });
}

document.getElementById("analyticsBackBtn").addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "profile"));
  switchView("mine");
  renderMine();
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
  if (!currentUser || !supabaseClient) { dmUnreadCount = 0; document.getElementById("inboxDot").style.display = "none"; return; }
  const { count } = await supabaseClient
    .from("dm_messages")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", currentUser.id)
    .eq("read", false);
  dmUnreadCount = count || 0;
  document.getElementById("inboxDot").style.display = dmUnreadCount > 0 ? "block" : "none";
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

function joinGlobalPresence() {
  if (!supabaseClient || !currentUser) return;
  if (globalPresenceChannel) supabaseClient.removeChannel(globalPresenceChannel);
  globalPresenceChannel = supabaseClient.channel("presence:global", {
    config: { presence: { key: currentUser.id } },
  });
  globalPresenceChannel.on("presence", { event: "sync" }, () => {
    onlineUserIds = new Set(Object.keys(globalPresenceChannel.presenceState()));
    updateDmPresenceUI();
  });
  globalPresenceChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") globalPresenceChannel.track({ online_at: Date.now() });
  });
}

function leaveGlobalPresence() {
  if (globalPresenceChannel && supabaseClient) supabaseClient.removeChannel(globalPresenceChannel);
  globalPresenceChannel = null;
  onlineUserIds = new Set();
}

async function touchLastSeen() {
  if (!currentUser || !supabaseClient) return;
  await supabaseClient.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", currentUser.id);
}

function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function updateDmPresenceUI() {
  document.querySelectorAll("[data-online-dot]").forEach((dot) => {
    dot.classList.toggle("online", onlineUserIds.has(dot.dataset.onlineDot));
  });
  if (currentDmPartnerId) renderDmChatStatus(currentDmPartnerId);
}

function renderDmChatStatus(partnerId) {
  const el = document.getElementById("dmChatStatus");
  if (!el) return;
  if (onlineUserIds.has(partnerId)) {
    el.textContent = "Online";
    el.classList.add("online");
  } else {
    el.classList.remove("online");
    el.textContent = currentDmPartnerLastSeen ? `Last seen ${timeAgo(currentDmPartnerLastSeen)}` : "";
  }
}

let dmInboxConvByPartner = {};
let dmInboxProfilesById = {};

async function openDmInbox() {
  switchView("dm-inbox");
  const list = document.getElementById("dmConversationList");
  const reqList = document.getElementById("dmRequestsList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';

  const { data } = await supabaseClient
    .from("dm_messages")
    .select("sender_id, receiver_id, text, image_url, audio_url, drama_share_id, created_at, read")
    .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
    .order("created_at", { ascending: false });

  const convByPartner = {};
  (data || []).forEach((m) => {
    const partnerId = m.sender_id === currentUser.id ? m.receiver_id : m.sender_id;
    const preview = dmPreviewText(m);
    if (!convByPartner[partnerId]) {
      convByPartner[partnerId] = { lastText: preview, lastAt: m.created_at, unread: 0, iSentAny: false };
    }
    if (m.sender_id === currentUser.id) convByPartner[partnerId].iSentAny = true;
    if (m.receiver_id === currentUser.id && !m.read) convByPartner[partnerId].unread++;
  });
  const partnerIds = Object.keys(convByPartner);
  dmInboxConvByPartner = convByPartner;
  const byId = {};
  if (partnerIds.length) {
    const { data: profiles } = await supabaseClient.from("profiles").select("id, username").in("id", partnerIds);
    (profiles || []).forEach((p) => { byId[p.id] = p; });
  }
  dmInboxProfilesById = byId;

  const primaryIds = [];
  const requestIds = [];
  partnerIds.forEach((id) => {
    if (!byId[id]) return;
    const conv = convByPartner[id];
    const meta = getDmMeta(id);
    if (meta.hidden && new Date(conv.lastAt) <= new Date(meta.updated_at || 0)) return;
    const isRequest = !meta.accepted && !conv.iSentAny && !followingIds.has(id);
    if (isRequest) requestIds.push(id);
    else primaryIds.push(id);
  });

  const myGroups = await loadMyGroupsWithLastMessage();

  const combined = [
    ...primaryIds.map((id) => ({ type: "dm", id, lastAt: convByPartner[id].lastAt, pinned: !!getDmMeta(id).pinned })),
    ...myGroups.map((g) => ({ type: "group", id: g.id, lastAt: g.lastAt, pinned: false, group: g })),
  ];
  combined.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.lastAt) - new Date(a.lastAt);
  });
  requestIds.sort((a, b) => new Date(convByPartner[b].lastAt) - new Date(convByPartner[a].lastAt));

  document.getElementById("dmRequestsBadge").style.display = requestIds.length ? "" : "none";
  document.getElementById("dmRequestsBadge").textContent = requestIds.length;

  list.innerHTML = "";
  if (!combined.length) {
    list.innerHTML = '<div class="creator-empty">No messages yet. Message a creator from their profile, or start a group.</div>';
  }
  combined.forEach((entry) => {
    if (entry.type === "dm") {
      list.appendChild(buildDmInboxRow(entry.id, byId[entry.id], convByPartner[entry.id], false));
    } else {
      list.appendChild(buildGroupInboxRow(entry.group));
    }
  });

  reqList.innerHTML = "";
  if (!requestIds.length) {
    reqList.innerHTML = '<div class="creator-empty">No message requests.</div>';
  }
  requestIds.forEach((id) => {
    const p = byId[id];
    if (!p) return;
    reqList.appendChild(buildDmInboxRow(id, p, convByPartner[id], true));
  });

  updateDmPresenceUI();
}

async function loadMyGroupsWithLastMessage() {
  if (!currentUser) return [];
  const { data: memberRows } = await supabaseClient.from("group_members").select("group_id").eq("user_id", currentUser.id);
  const groupIds = (memberRows || []).map((r) => r.group_id);
  if (!groupIds.length) return [];
  const { data: groups } = await supabaseClient.from("groups").select("id, name, created_at").in("id", groupIds);
  const { data: lastMsgs } = await supabaseClient
    .from("group_messages")
    .select("group_id, text, image_url, audio_url, created_at")
    .in("group_id", groupIds)
    .order("created_at", { ascending: false });
  const lastByGroup = {};
  (lastMsgs || []).forEach((m) => { if (!lastByGroup[m.group_id]) lastByGroup[m.group_id] = m; });
  return (groups || []).map((g) => {
    const last = lastByGroup[g.id];
    return {
      id: g.id,
      name: g.name,
      lastText: last ? dmPreviewText(last) : "No messages yet",
      lastAt: last ? last.created_at : g.created_at,
    };
  });
}

function buildGroupInboxRow(group) {
  const row = document.createElement("div");
  row.className = "creator-card";
  row.innerHTML = `
    <div class="creator-avatar" style="background:${gradientFor(group.id)}">${group.name[0].toUpperCase()}</div>
    <div class="creator-info">
      <div class="creator-name">👥 ${group.name}</div>
      <div class="creator-status">${(group.lastText || "").slice(0, 40)}</div>
    </div>
  `;
  row.addEventListener("click", () => openGroupChat(group.id, group.name));
  return row;
}

function buildDmInboxRow(partnerId, profile, conv, isRequest) {
  const meta = getDmMeta(partnerId);
  const row = document.createElement("div");
  row.className = "creator-card" + (meta.pinned ? " pinned" : "");
  row.innerHTML = `
    <div class="creator-avatar" style="background:${gradientFor(partnerId)}">${profile.username[0].toUpperCase()}<span class="online-dot" data-online-dot="${partnerId}"></span></div>
    <div class="creator-info">
      <div class="creator-name">
        ${meta.pinned ? '<svg class="creator-card-pin-ic" viewBox="0 0 24 24" fill="currentColor"><use href="#ic-pin"/></svg>' : ""}
        ${meta.muted ? '<svg class="creator-card-muted-ic ic"><use href="#ic-mute"/></svg>' : ""}
        ${profile.username}
      </div>
      <div class="creator-status">${(conv.lastText || "").slice(0, 40)}</div>
    </div>
    ${isRequest
      ? `<div class="dm-request-actions">
           <button class="dm-request-accept-btn">Accept</button>
           <button class="dm-request-delete-btn">Delete</button>
         </div>`
      : `${conv.unread > 0 ? '<span class="dm-unread-dot"></span>' : ""}<button class="icon-btn dm-conv-more-btn">⋮</button>`}
  `;
  if (isRequest) {
    row.querySelector(".dm-request-accept-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      await setDmMeta(partnerId, { accepted: true });
      openDmChat(partnerId, profile.username);
    });
    row.querySelector(".dm-request-delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      await setDmMeta(partnerId, { hidden: true });
      openDmInbox();
    });
    row.addEventListener("click", () => openDmChat(partnerId, profile.username));
  } else {
    row.querySelector(".dm-conv-more-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openDmRowActionsModal(partnerId, profile.username);
    });
    row.addEventListener("click", () => openDmChat(partnerId, profile.username));
  }
  return row;
}

let dmRowActionsPartnerId = null;
function openDmRowActionsModal(partnerId, username) {
  dmRowActionsPartnerId = partnerId;
  const meta = getDmMeta(partnerId);
  document.getElementById("dmRowActionsTitle").textContent = username;
  document.getElementById("dmActionPinLabel").textContent = meta.pinned ? "Unpin Chat" : "Pin Chat";
  document.getElementById("dmActionMuteLabel").textContent = meta.muted ? "Unmute Notifications" : "Mute Notifications";
  openModal("dmRowActionsModal");
}
document.getElementById("dmActionPinBtn").addEventListener("click", async () => {
  if (!dmRowActionsPartnerId) return;
  const meta = getDmMeta(dmRowActionsPartnerId);
  await setDmMeta(dmRowActionsPartnerId, { pinned: !meta.pinned });
  closeModal("dmRowActionsModal");
  openDmInbox();
});
document.getElementById("dmActionMuteBtn").addEventListener("click", async () => {
  if (!dmRowActionsPartnerId) return;
  const meta = getDmMeta(dmRowActionsPartnerId);
  await setDmMeta(dmRowActionsPartnerId, { muted: !meta.muted });
  closeModal("dmRowActionsModal");
  openDmInbox();
});
document.getElementById("dmActionHideBtn").addEventListener("click", async () => {
  if (!dmRowActionsPartnerId) return;
  if (!confirm("Delete this chat from your inbox?")) return;
  await setDmMeta(dmRowActionsPartnerId, { hidden: true });
  closeModal("dmRowActionsModal");
  openDmInbox();
});

document.querySelectorAll(".dm-inbox-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".dm-inbox-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("dmConversationList").style.display = tab.dataset.dmtab === "primary" ? "" : "none";
    document.getElementById("dmRequestsList").style.display = tab.dataset.dmtab === "requests" ? "" : "none";
  });
});

/* ---------------- New Message / Create Group ---------------- */
let newMessageSearchTimer = null;
document.getElementById("newMessageBtn").addEventListener("click", () => {
  document.getElementById("newMessageSearchInput").value = "";
  document.getElementById("newMessageResults").innerHTML = "";
  openModal("newMessageModal");
});
document.getElementById("newMessageSearchInput").addEventListener("input", (e) => {
  const term = e.target.value.trim();
  clearTimeout(newMessageSearchTimer);
  const results = document.getElementById("newMessageResults");
  if (!term) { results.innerHTML = ""; return; }
  newMessageSearchTimer = setTimeout(async () => {
    const { data } = await supabaseClient
      .from("profiles")
      .select("id, username")
      .ilike("username", `%${term}%`)
      .neq("id", currentUser?.id || "")
      .limit(20);
    results.innerHTML = "";
    if (!data || !data.length) { results.innerHTML = '<div class="creator-empty">No users found.</div>'; return; }
    data.forEach((p) => {
      const row = document.createElement("div");
      row.className = "creator-card";
      row.innerHTML = `
        <div class="creator-avatar" style="background:${gradientFor(p.id)}">${p.username[0].toUpperCase()}</div>
        <div class="creator-info"><div class="creator-name">${p.username}</div></div>
      `;
      row.addEventListener("click", () => {
        closeModal("newMessageModal");
        openDmChat(p.id, p.username);
      });
      results.appendChild(row);
    });
  }, 350);
});

let groupSelectedMembers = new Map();
let groupMemberSearchTimer = null;

document.getElementById("createGroupBtn").addEventListener("click", () => {
  closeModal("newMessageModal");
  groupSelectedMembers = new Map();
  document.getElementById("groupNameInput").value = "";
  document.getElementById("groupMemberSearchInput").value = "";
  document.getElementById("groupMemberResults").innerHTML = "";
  renderGroupSelectedChips();
  openModal("createGroupModal");
});

function renderGroupSelectedChips() {
  const wrap = document.getElementById("groupSelectedMembers");
  wrap.innerHTML = "";
  groupSelectedMembers.forEach((username, id) => {
    const chip = document.createElement("span");
    chip.className = "group-chip";
    chip.innerHTML = `${username} <button data-id="${id}">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      groupSelectedMembers.delete(id);
      renderGroupSelectedChips();
    });
    wrap.appendChild(chip);
  });
}

document.getElementById("groupMemberSearchInput").addEventListener("input", (e) => {
  const term = e.target.value.trim();
  clearTimeout(groupMemberSearchTimer);
  const results = document.getElementById("groupMemberResults");
  if (!term) { results.innerHTML = ""; return; }
  groupMemberSearchTimer = setTimeout(async () => {
    const { data } = await supabaseClient
      .from("profiles")
      .select("id, username")
      .ilike("username", `%${term}%`)
      .neq("id", currentUser?.id || "")
      .limit(20);
    results.innerHTML = "";
    (data || []).filter((p) => !groupSelectedMembers.has(p.id)).forEach((p) => {
      const row = document.createElement("div");
      row.className = "creator-card";
      row.innerHTML = `
        <div class="creator-avatar" style="background:${gradientFor(p.id)}">${p.username[0].toUpperCase()}</div>
        <div class="creator-info"><div class="creator-name">${p.username}</div></div>
      `;
      row.addEventListener("click", () => {
        groupSelectedMembers.set(p.id, p.username);
        renderGroupSelectedChips();
        document.getElementById("groupMemberSearchInput").value = "";
        results.innerHTML = "";
      });
      results.appendChild(row);
    });
  }, 350);
});

document.getElementById("createGroupSubmitBtn").addEventListener("click", async () => {
  const name = document.getElementById("groupNameInput").value.trim();
  if (!name) { toast("Enter a group name"); return; }
  if (groupSelectedMembers.size < 2) { toast("Add at least 2 members"); return; }
  if (!currentUser) return;
  const btn = document.getElementById("createGroupSubmitBtn");
  btn.disabled = true;
  const { data: group, error } = await supabaseClient
    .from("groups")
    .insert({ name, created_by: currentUser.id })
    .select()
    .single();
  if (error || !group) { toast("Couldn't create group"); btn.disabled = false; return; }
  const memberRows = [currentUser.id, ...groupSelectedMembers.keys()].map((id) => ({ group_id: group.id, user_id: id }));
  const { error: memberError } = await supabaseClient.from("group_members").insert(memberRows);
  btn.disabled = false;
  if (memberError) { toast("Couldn't add members"); return; }
  closeModal("createGroupModal");
  toast("Group created");
  openGroupChat(group.id, group.name);
});

/* ---------------- Group chat ---------------- */
function appendGroupMessage(mine, msg) {
  groupMessagesById.set(msg.id, msg);
  const messagesEl = document.getElementById("groupChatMessages");
  const empty = messagesEl.querySelector(".creator-empty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "dm-msg " + (mine ? "mine" : "theirs");
  row.dataset.id = msg.id;
  if (!mine) {
    const sender = document.createElement("div");
    sender.className = "group-msg-sender";
    sender.textContent = groupMemberUsernames.get(msg.sender_id) || "Member";
    row.appendChild(sender);
  }
  if (msg.image_url) {
    const img = document.createElement("img");
    img.className = "dm-msg-img";
    img.src = msg.image_url;
    img.addEventListener("click", (e) => { e.stopPropagation(); openImagePreview(msg.image_url); });
    row.appendChild(img);
  }
  if (msg.audio_url) {
    const audio = document.createElement("audio");
    audio.className = "dm-msg-audio";
    audio.controls = true;
    audio.src = msg.audio_url;
    row.appendChild(audio);
  }
  if (msg.text) {
    const span = document.createElement("span");
    span.textContent = msg.text;
    row.appendChild(span);
  }
  messagesEl.appendChild(row);
}

async function openGroupChat(groupId, groupName) {
  switchView("group-chat");
  currentGroupId = groupId;
  currentGroupName = groupName;
  document.getElementById("groupChatTitle").textContent = groupName;
  groupMessagesById = new Map();
  const messagesEl = document.getElementById("groupChatMessages");
  messagesEl.innerHTML = '<div class="creator-empty">Loading...</div>';

  const { data: memberRows } = await supabaseClient.from("group_members").select("user_id").eq("group_id", groupId);
  const memberIds = (memberRows || []).map((r) => r.user_id);
  groupMembersByGroup.set(groupId, memberIds);
  if (memberIds.length) {
    const { data: memberProfiles } = await supabaseClient.from("profiles").select("id, username").in("id", memberIds);
    (memberProfiles || []).forEach((p) => groupMemberUsernames.set(p.id, p.username));
  }

  const { data } = await supabaseClient
    .from("group_messages")
    .select("id, sender_id, text, image_url, audio_url, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });

  messagesEl.innerHTML = "";
  (data || []).forEach((m) => appendGroupMessage(m.sender_id === currentUser.id, m));
  if (!data || !data.length) messagesEl.innerHTML = '<div class="creator-empty">No messages yet. Say hi!</div>';
  messagesEl.scrollTop = messagesEl.scrollHeight;

  if (groupChatChannel) supabaseClient.removeChannel(groupChatChannel);
  groupChatChannel = supabaseClient
    .channel(`group-chat:${groupId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
      (payload) => {
        if (payload.new.sender_id === currentUser.id) return;
        appendGroupMessage(false, payload.new);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    )
    .subscribe();
}

async function sendGroupMessage() {
  const input = document.getElementById("groupChatInput");
  const text = input.value.trim();
  if (!text || !currentGroupId) return;
  input.value = "";
  const tempId = "temp-" + crypto.randomUUID();
  const messagesEl = document.getElementById("groupChatMessages");
  appendGroupMessage(true, { id: tempId, sender_id: currentUser.id, text, created_at: new Date().toISOString() });
  messagesEl.scrollTop = messagesEl.scrollHeight;
  const { data, error } = await supabaseClient
    .from("group_messages")
    .insert({ group_id: currentGroupId, sender_id: currentUser.id, text })
    .select()
    .single();
  if (error) { toast("Message couldn't be delivered"); return; }
  const row = messagesEl.querySelector(`[data-id="${tempId}"]`);
  if (row && data) { row.dataset.id = data.id; groupMessagesById.delete(tempId); groupMessagesById.set(data.id, data); }
}
document.getElementById("groupChatSendBtn").addEventListener("click", sendGroupMessage);
document.getElementById("groupChatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendGroupMessage(); });

document.getElementById("groupImageBtn").addEventListener("click", () => {
  if (!currentGroupId) return;
  document.getElementById("groupImageInput").click();
});
document.getElementById("groupImageInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !currentGroupId || !currentUser) return;
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${currentUser.id}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabaseClient.storage.from("group-media").upload(path, file);
  if (uploadError) { toast("Photo upload failed"); return; }
  const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/group-media/${path}`;
  const { data, error } = await supabaseClient
    .from("group_messages")
    .insert({ group_id: currentGroupId, sender_id: currentUser.id, image_url: imageUrl })
    .select()
    .single();
  if (error) { toast("Message couldn't be delivered"); return; }
  appendGroupMessage(true, data);
  document.getElementById("groupChatMessages").scrollTop = document.getElementById("groupChatMessages").scrollHeight;
});

document.getElementById("groupChatBackBtn").addEventListener("click", () => {
  if (groupChatChannel) { supabaseClient.removeChannel(groupChatChannel); groupChatChannel = null; }
  currentGroupId = null;
  openDmInbox();
});

document.getElementById("groupChatInfoBtn").addEventListener("click", async () => {
  if (!currentGroupId) return;
  document.getElementById("groupInfoName").textContent = currentGroupName;
  const membersList = document.getElementById("groupInfoMembers");
  membersList.innerHTML = '<div class="creator-empty">Loading...</div>';
  openModal("groupInfoModal");
  const memberIds = groupMembersByGroup.get(currentGroupId) || [];
  const { data: profiles } = await supabaseClient.from("profiles").select("id, username").in("id", memberIds);
  membersList.innerHTML = "";
  (profiles || []).forEach((p) => {
    const row = document.createElement("div");
    row.className = "creator-card";
    row.innerHTML = `
      <div class="creator-avatar" style="background:${gradientFor(p.id)}">${p.username[0].toUpperCase()}</div>
      <div class="creator-info"><div class="creator-name">${p.username}${p.id === currentUser.id ? " (You)" : ""}</div></div>
    `;
    membersList.appendChild(row);
  });
});

document.getElementById("leaveGroupBtn").addEventListener("click", async () => {
  if (!currentGroupId || !currentUser) return;
  if (!confirm(`Leave ${currentGroupName}?`)) return;
  await supabaseClient.from("group_members").delete().eq("group_id", currentGroupId).eq("user_id", currentUser.id);
  closeModal("groupInfoModal");
  toast("You left the group");
  if (groupChatChannel) { supabaseClient.removeChannel(groupChatChannel); groupChatChannel = null; }
  currentGroupId = null;
  openDmInbox();
});

function dmPreviewText(msg) {
  if (msg.text) return msg.text;
  if (msg.image_url) return "📷 Photo";
  if (msg.audio_url) return "🎤 Voice message";
  if (msg.drama_share_id) return "🎬 Shared a drama";
  return "";
}

function appendDmMessage(mine, msg) {
  dmMessagesById.set(msg.id, msg);
  const messagesEl = document.getElementById("dmChatMessages");
  const empty = messagesEl.querySelector(".creator-empty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "dm-msg " + (mine ? "mine" : "theirs");
  row.dataset.id = msg.id;
  if (mine) row.dataset.read = String(!!msg.read);

  if (msg.reply_to_id) {
    const original = dmMessagesById.get(msg.reply_to_id);
    const quote = document.createElement("span");
    quote.className = "dm-msg-reply-quote";
    quote.textContent = original ? dmPreviewText(original) : "Original message";
    row.appendChild(quote);
  }
  if (msg.drama_share_id) {
    const drama = DRAMAS.find((d) => d.id === msg.drama_share_id);
    const card = document.createElement("div");
    card.className = "dm-msg-share-card";
    card.innerHTML = `
      <div class="dm-msg-share-cover" style="${drama ? coverStyle(drama) : `background:${gradientFor(msg.drama_share_id)}`}"></div>
      <div>
        <div class="dm-msg-share-title">${drama ? drama.title : "A drama"}</div>
        <div class="dm-msg-share-sub">Tap to watch</div>
      </div>
    `;
    card.addEventListener("click", (e) => { e.stopPropagation(); if (drama) openDetail(drama.id); });
    row.appendChild(card);
  }
  if (msg.image_url) {
    const img = document.createElement("img");
    img.className = "dm-msg-img";
    img.src = msg.image_url;
    img.addEventListener("click", (e) => { e.stopPropagation(); openImagePreview(msg.image_url); });
    row.appendChild(img);
  }
  if (msg.audio_url) {
    const audio = document.createElement("audio");
    audio.className = "dm-msg-audio";
    audio.controls = true;
    audio.src = msg.audio_url;
    row.appendChild(audio);
  }
  if (msg.text) {
    const span = document.createElement("span");
    span.textContent = msg.text;
    row.appendChild(span);
  }
  if (mine && Date.now() - new Date(msg.created_at).getTime() < 10 * 60 * 1000) {
    const delBtn = document.createElement("button");
    delBtn.className = "dm-msg-delete";
    delBtn.textContent = "✕";
    delBtn.title = "Unsend";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteDmMessage(row.dataset.id, row); });
    row.appendChild(delBtn);
  }

  const actions = document.createElement("div");
  actions.className = "dm-msg-actions";
  DM_REACTION_EMOJIS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.className = "react-btn";
    btn.textContent = emoji;
    btn.addEventListener("click", (e) => { e.stopPropagation(); reactToMessage(row.dataset.id, emoji); });
    actions.appendChild(btn);
  });
  const replyBtn = document.createElement("button");
  replyBtn.className = "reply-btn";
  replyBtn.innerHTML = `<svg class="ic"><use href="#ic-reply"/></svg> Reply`;
  replyBtn.addEventListener("click", (e) => { e.stopPropagation(); startReplyTo(row.dataset.id); });
  actions.appendChild(replyBtn);
  row.appendChild(actions);
  row.addEventListener("click", () => row.classList.toggle("actions-open"));

  messagesEl.appendChild(row);
  renderReactionBadges(msg.id);
}

async function deleteDmMessage(id, row) {
  if (!id || id.startsWith("temp-")) { toast("Still sending..."); return; }
  if (!confirm("Unsend this message?")) return;
  const { error } = await supabaseClient.from("dm_messages").delete().eq("id", id);
  if (error) { toast("Couldn't unsend"); return; }
  row.remove();
}

function renderReactionBadges(messageId) {
  const row = document.querySelector(`#dmChatMessages [data-id="${messageId}"]`);
  if (!row) return;
  let badgesEl = row.querySelector(".dm-reaction-badges");
  const reactions = dmReactionsByMessage.get(messageId);
  if (!reactions || !reactions.size) { if (badgesEl) badgesEl.remove(); return; }
  if (!badgesEl) {
    badgesEl = document.createElement("div");
    badgesEl.className = "dm-reaction-badges";
    row.appendChild(badgesEl);
  }
  const counts = {};
  reactions.forEach((emoji) => { counts[emoji] = (counts[emoji] || 0) + 1; });
  badgesEl.innerHTML = Object.entries(counts).map(([emoji, count]) => `<span class="dm-reaction-badge">${emoji}${count > 1 ? " " + count : ""}</span>`).join("");
}

async function reactToMessage(messageId, emoji) {
  if (!currentUser || !messageId || messageId.startsWith("temp-")) return;
  const existing = dmReactionsByMessage.get(messageId)?.get(currentUser.id);
  if (existing === emoji) {
    await supabaseClient.from("dm_message_reactions").delete().eq("message_id", messageId).eq("user_id", currentUser.id);
    dmReactionsByMessage.get(messageId)?.delete(currentUser.id);
  } else {
    await supabaseClient.from("dm_message_reactions").upsert(
      { message_id: messageId, user_id: currentUser.id, emoji },
      { onConflict: "message_id,user_id" }
    );
    if (!dmReactionsByMessage.has(messageId)) dmReactionsByMessage.set(messageId, new Map());
    dmReactionsByMessage.get(messageId).set(currentUser.id, emoji);
  }
  renderReactionBadges(messageId);
}

function startReplyTo(messageId) {
  const msg = dmMessagesById.get(messageId);
  if (!msg) return;
  dmReplyTarget = messageId;
  document.getElementById("dmReplyPreviewText").textContent = "Replying to: " + dmPreviewText(msg);
  document.getElementById("dmReplyPreview").style.display = "flex";
  document.getElementById("dmChatInput").focus();
}
document.getElementById("dmReplyCancelBtn").addEventListener("click", () => {
  dmReplyTarget = null;
  document.getElementById("dmReplyPreview").style.display = "none";
});

function updateSeenIndicator() {
  const messagesEl = document.getElementById("dmChatMessages");
  messagesEl.querySelectorAll(".dm-seen-label").forEach((el) => el.remove());
  const mineRows = messagesEl.querySelectorAll(".dm-msg.mine");
  if (!mineRows.length) return;
  const last = mineRows[mineRows.length - 1];
  if (last !== messagesEl.lastElementChild) return;
  if (last.dataset.read === "true") {
    const label = document.createElement("div");
    label.className = "dm-seen-label";
    label.textContent = "Seen";
    messagesEl.appendChild(label);
  }
}

async function openDmChat(partnerId, partnerName) {
  switchView("dm-chat");
  document.getElementById("dmChatTitle").textContent = partnerName;
  currentDmPartnerId = partnerId;
  currentDmPartnerLastSeen = null;
  dmReplyTarget = null;
  dmMessagesById = new Map();
  dmReactionsByMessage = new Map();
  dmChatSearchActive = false;
  dmChatSearchTerm = "";
  document.getElementById("dmChatSearchBar").style.display = "none";
  document.getElementById("dmChatSearchInput").value = "";
  document.getElementById("dmReplyPreview").style.display = "none";
  document.getElementById("dmChatStatus").textContent = "";
  document.getElementById("dmTypingIndicator").style.display = "none";
  const messagesEl = document.getElementById("dmChatMessages");
  messagesEl.innerHTML = '<div class="creator-empty">Loading...</div>';

  const { data } = await supabaseClient
    .from("dm_messages")
    .select("id, sender_id, text, image_url, audio_url, drama_share_id, reply_to_id, created_at, read")
    .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${currentUser.id})`)
    .order("created_at", { ascending: true });

  const ids = (data || []).map((m) => m.id);
  if (ids.length) {
    const { data: reactions } = await supabaseClient.from("dm_message_reactions").select("message_id, user_id, emoji").in("message_id", ids);
    (reactions || []).forEach((r) => {
      if (!dmReactionsByMessage.has(r.message_id)) dmReactionsByMessage.set(r.message_id, new Map());
      dmReactionsByMessage.get(r.message_id).set(r.user_id, r.emoji);
    });
  }

  messagesEl.innerHTML = "";
  (data || []).forEach((m) => appendDmMessage(m.sender_id === currentUser.id, m));
  messagesEl.scrollTop = messagesEl.scrollHeight;
  updateSeenIndicator();

  const { data: partnerProfile } = await supabaseClient.from("profiles").select("last_seen").eq("id", partnerId).single();
  currentDmPartnerLastSeen = partnerProfile?.last_seen || null;
  renderDmChatStatus(partnerId);

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
        document.getElementById("dmTypingIndicator").style.display = "none";
        appendDmMessage(false, payload.new);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        supabaseClient.from("dm_messages").update({ read: true }).eq("id", payload.new.id);
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "dm_messages", filter: `sender_id=eq.${currentUser.id}` },
      (payload) => {
        if (payload.new.receiver_id !== partnerId || !payload.new.read) return;
        const row = messagesEl.querySelector(`[data-id="${payload.new.id}"]`);
        if (row) { row.dataset.read = "true"; updateSeenIndicator(); }
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "dm_messages", filter: `sender_id=eq.${partnerId}` },
      (payload) => {
        const row = messagesEl.querySelector(`[data-id="${payload.old.id}"]`);
        if (row) row.remove();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dm_message_reactions" },
      (payload) => {
        const messageId = payload.new?.message_id || payload.old?.message_id;
        if (!messageId || !dmMessagesById.has(messageId)) return;
        if (payload.eventType === "DELETE") {
          dmReactionsByMessage.get(messageId)?.delete(payload.old.user_id);
        } else {
          if (!dmReactionsByMessage.has(messageId)) dmReactionsByMessage.set(messageId, new Map());
          dmReactionsByMessage.get(messageId).set(payload.new.user_id, payload.new.emoji);
        }
        renderReactionBadges(messageId);
      }
    )
    .on("broadcast", { event: "typing" }, () => showDmTypingIndicator())
    .subscribe();
}

function showDmTypingIndicator() {
  const el = document.getElementById("dmTypingIndicator");
  if (!el) return;
  el.style.display = "block";
  clearTimeout(dmTypingTimeout);
  dmTypingTimeout = setTimeout(() => { el.style.display = "none"; }, 3000);
}

function openImagePreview(url) {
  document.getElementById("imagePreviewImg").src = url;
  openModal("imagePreviewModal");
}

function applyDmChatSearchFilter() {
  const term = dmChatSearchTerm.trim().toLowerCase();
  document.querySelectorAll("#dmChatMessages .dm-msg").forEach((row) => {
    row.classList.remove("search-hidden", "search-match");
    if (!term) return;
    const msg = dmMessagesById.get(row.dataset.id);
    const text = (msg?.text || "").toLowerCase();
    if (text.includes(term)) row.classList.add("search-match");
    else row.classList.add("search-hidden");
  });
}

document.getElementById("dmChatSearchBtn").addEventListener("click", () => {
  dmChatSearchActive = !dmChatSearchActive;
  document.getElementById("dmChatSearchBar").style.display = dmChatSearchActive ? "flex" : "none";
  if (dmChatSearchActive) {
    document.getElementById("dmChatSearchInput").focus();
  } else {
    dmChatSearchTerm = "";
    document.getElementById("dmChatSearchInput").value = "";
    applyDmChatSearchFilter();
  }
});
document.getElementById("dmChatSearchCloseBtn").addEventListener("click", () => {
  dmChatSearchActive = false;
  dmChatSearchTerm = "";
  document.getElementById("dmChatSearchInput").value = "";
  document.getElementById("dmChatSearchBar").style.display = "none";
  applyDmChatSearchFilter();
});
document.getElementById("dmChatSearchInput").addEventListener("input", (e) => {
  dmChatSearchTerm = e.target.value;
  applyDmChatSearchFilter();
});

document.getElementById("dmChatCallBtn").addEventListener("click", () => startCall(false));
document.getElementById("dmChatVideoCallBtn").addEventListener("click", () => startCall(true));

document.getElementById("dmChatSendBtn").addEventListener("click", sendDmMessage);
document.getElementById("dmChatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendDmMessage(); });
document.getElementById("dmChatInput").addEventListener("input", () => {
  if (!dmChatChannel || !currentDmPartnerId) return;
  const now = Date.now();
  if (now - dmLastTypingSentAt < 2000) return;
  dmLastTypingSentAt = now;
  dmChatChannel.send({ type: "broadcast", event: "typing", payload: {} });
});

function takeDmReplyTarget() {
  const replyToId = dmReplyTarget;
  dmReplyTarget = null;
  document.getElementById("dmReplyPreview").style.display = "none";
  return replyToId;
}

async function sendDmMessage() {
  const input = document.getElementById("dmChatInput");
  const text = input.value.trim();
  if (!text || !currentDmPartnerId) return;
  input.value = "";
  const replyToId = takeDmReplyTarget();
  const tempId = "temp-" + crypto.randomUUID();
  const messagesEl = document.getElementById("dmChatMessages");
  appendDmMessage(true, { id: tempId, text, image_url: null, reply_to_id: replyToId, created_at: new Date().toISOString() });
  messagesEl.scrollTop = messagesEl.scrollHeight;
  const { data, error } = await supabaseClient
    .from("dm_messages")
    .insert({ sender_id: currentUser.id, receiver_id: currentDmPartnerId, text, reply_to_id: replyToId })
    .select()
    .single();
  if (error) { toast("Message couldn't be delivered"); return; }
  const row = messagesEl.querySelector(`[data-id="${tempId}"]`);
  if (row && data) { row.dataset.id = data.id; dmMessagesById.delete(tempId); dmMessagesById.set(data.id, data); }
  markDmAccepted(currentDmPartnerId);
}

function markDmAccepted(partnerId) {
  if (!getDmMeta(partnerId).accepted) setDmMeta(partnerId, { accepted: true });
}

document.getElementById("dmImageBtn").addEventListener("click", () => {
  if (!currentDmPartnerId) return;
  document.getElementById("dmImageInput").click();
});
document.getElementById("dmImageInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !currentDmPartnerId || !currentUser) return;
  const replyToId = takeDmReplyTarget();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${currentUser.id}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabaseClient.storage.from("dm-media").upload(path, file);
  if (uploadError) { toast("Photo upload failed"); return; }
  const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/dm-media/${path}`;
  const { data, error } = await supabaseClient
    .from("dm_messages")
    .insert({ sender_id: currentUser.id, receiver_id: currentDmPartnerId, image_url: imageUrl, reply_to_id: replyToId })
    .select()
    .single();
  if (error) { toast("Message couldn't be delivered"); return; }
  appendDmMessage(true, data);
  document.getElementById("dmChatMessages").scrollTop = document.getElementById("dmChatMessages").scrollHeight;
  markDmAccepted(currentDmPartnerId);
});

document.getElementById("dmVoiceBtn").addEventListener("pointerdown", async (e) => {
  e.preventDefault();
  if (!currentDmPartnerId) return;
  const btn = document.getElementById("dmVoiceBtn");
  try {
    dmVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    dmVoiceChunks = [];
    dmVoiceRecorder = new MediaRecorder(dmVoiceStream);
    dmVoiceRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) dmVoiceChunks.push(ev.data); };
    dmVoiceRecorder.start();
    dmVoiceStartedAt = Date.now();
    btn.classList.add("recording");
  } catch (e) {
    toast("Microphone access denied");
  }
});
async function stopDmVoiceRecording() {
  const btn = document.getElementById("dmVoiceBtn");
  btn.classList.remove("recording");
  if (!dmVoiceRecorder || dmVoiceRecorder.state === "inactive") return;
  const duration = Date.now() - dmVoiceStartedAt;
  const recorder = dmVoiceRecorder;
  const stream = dmVoiceStream;
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  await stopped;
  dmVoiceRecorder = null;
  dmVoiceStream = null;
  if (duration < 500) { dmVoiceChunks = []; return; }
  const mimeType = recorder.mimeType || "audio/webm";
  const blob = new Blob(dmVoiceChunks, { type: mimeType });
  dmVoiceChunks = [];
  if (!currentDmPartnerId || !currentUser) return;
  const replyToId = takeDmReplyTarget();
  const ext = mimeType.includes("mp4") ? "m4a" : "webm";
  const path = `${currentUser.id}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabaseClient.storage.from("dm-voice").upload(path, blob);
  if (uploadError) { toast("Voice note upload failed"); return; }
  const audioUrl = `${SUPABASE_URL}/storage/v1/object/public/dm-voice/${path}`;
  const { data, error } = await supabaseClient
    .from("dm_messages")
    .insert({ sender_id: currentUser.id, receiver_id: currentDmPartnerId, audio_url: audioUrl, reply_to_id: replyToId })
    .select()
    .single();
  if (error) { toast("Message couldn't be delivered"); return; }
  appendDmMessage(true, data);
  document.getElementById("dmChatMessages").scrollTop = document.getElementById("dmChatMessages").scrollHeight;
  markDmAccepted(currentDmPartnerId);
}
document.getElementById("dmVoiceBtn").addEventListener("pointerup", stopDmVoiceRecording);
document.getElementById("dmVoiceBtn").addEventListener("pointerleave", stopDmVoiceRecording);

document.getElementById("copyLinkBtn").addEventListener("click", async () => {
  if (!state.currentDrama) return;
  const url = `${window.location.href.split("#")[0].split("?")[0]}#drama/${state.currentDrama.id}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied!");
  } catch (e) {
    toast("Couldn't copy link");
  }
  closeModal("shareModal");
});

document.getElementById("shareViaMessageBtn").addEventListener("click", async () => {
  if (!currentUser) { toast("Sign in to share"); return; }
  if (!state.currentDrama) return;
  closeModal("shareModal");
  const list = document.getElementById("shareToDmList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';
  openModal("shareToDmModal");

  const { data } = await supabaseClient
    .from("dm_messages")
    .select("sender_id, receiver_id")
    .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`);
  const partnerIds = [...new Set((data || []).map((m) => (m.sender_id === currentUser.id ? m.receiver_id : m.sender_id)))];
  if (!partnerIds.length) {
    list.innerHTML = '<div class="creator-empty">Message someone first to share content with them.</div>';
    return;
  }
  const { data: profiles } = await supabaseClient.from("profiles").select("id, username").in("id", partnerIds);
  list.innerHTML = "";
  (profiles || []).forEach((p) => {
    const row = document.createElement("div");
    row.className = "creator-card";
    row.innerHTML = `
      <div class="creator-avatar" style="background:${gradientFor(p.id)}">${p.username[0].toUpperCase()}</div>
      <div class="creator-info"><div class="creator-name">${p.username}</div></div>
    `;
    row.addEventListener("click", () => shareDramaToDm(p.id, p.username));
    list.appendChild(row);
  });
});

async function shareDramaToDm(partnerId, partnerName) {
  const drama = state.currentDrama;
  if (!drama) return;
  const { error } = await supabaseClient
    .from("dm_messages")
    .insert({ sender_id: currentUser.id, receiver_id: partnerId, drama_share_id: drama.id });
  closeModal("shareToDmModal");
  if (error) { toast("Couldn't share"); return; }
  toast(`Shared with ${partnerName}`);
}

document.getElementById("dmChatBackBtn").addEventListener("click", () => {
  if (dmChatChannel) { supabaseClient.removeChannel(dmChatChannel); dmChatChannel = null; }
  currentDmPartnerId = null;
  dmReplyTarget = null;
  document.getElementById("dmReplyPreview").style.display = "none";
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

/* ---------------- Voice / video calls (LiveKit) ---------------- */
const CALL_RING_TIMEOUT_MS = 45000;

function subscribeIncomingCalls() {
  if (!supabaseClient || !currentUser) return;
  if (callIncomingListenChannel) supabaseClient.removeChannel(callIncomingListenChannel);
  callIncomingListenChannel = supabaseClient
    .channel(`calls-incoming:${currentUser.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "calls", filter: `callee_id=eq.${currentUser.id}` },
      (payload) => {
        if (payload.new.status !== "ringing") return;
        if (!currentCallEnded) {
          supabaseClient.from("calls").update({ status: "declined", ended_at: new Date().toISOString() }).eq("id", payload.new.id);
          return;
        }
        showIncomingCall(payload.new);
      }
    )
    .subscribe();
}
let callIncomingListenChannel = null;

async function showIncomingCall(callRow) {
  pendingIncomingCall = callRow;
  const { data: caller } = await supabaseClient.from("profiles").select("username").eq("id", callRow.caller_id).single();
  const name = caller?.username || "Someone";
  document.getElementById("incomingCallAvatar").style.background = gradientFor(callRow.caller_id);
  document.getElementById("incomingCallAvatar").textContent = name[0].toUpperCase();
  document.getElementById("incomingCallName").textContent = name;
  document.getElementById("incomingCallType").textContent = callRow.is_video ? "Video call..." : "Voice call...";
  openModal("incomingCallModal");
}

document.getElementById("acceptCallBtn").addEventListener("click", async () => {
  const callRow = pendingIncomingCall;
  if (!callRow) return;
  pendingIncomingCall = null;
  closeModal("incomingCallModal");
  await supabaseClient.from("calls").update({ status: "accepted" }).eq("id", callRow.id);
  const { data: caller } = await supabaseClient.from("profiles").select("username").eq("id", callRow.caller_id).single();
  openCallView(callRow.id, callRow.caller_id, caller?.username || "Someone", callRow.is_video, false);
  connectToCall(callRow.room, callRow.is_video);
});

document.getElementById("declineCallBtn").addEventListener("click", async () => {
  const callRow = pendingIncomingCall;
  if (!callRow) return;
  pendingIncomingCall = null;
  closeModal("incomingCallModal");
  await supabaseClient.from("calls").update({ status: "declined", ended_at: new Date().toISOString() }).eq("id", callRow.id);
});

async function startCall(isVideo) {
  if (!currentUser || !currentDmPartnerId) return;
  const partnerId = currentDmPartnerId;
  const partnerName = document.getElementById("dmChatTitle").textContent;
  const room = `call-${[currentUser.id, partnerId].sort().join("_")}`;
  const { data: callRow, error } = await supabaseClient
    .from("calls")
    .insert({ caller_id: currentUser.id, callee_id: partnerId, room, is_video: isVideo, status: "ringing" })
    .select()
    .single();
  if (error || !callRow) { toast("Couldn't start the call"); return; }

  openCallView(callRow.id, partnerId, partnerName, isVideo, true);
  document.getElementById("callStatusText").textContent = "Calling...";

  if (callStatusChannel) supabaseClient.removeChannel(callStatusChannel);
  callStatusChannel = supabaseClient
    .channel(`call-status:${callRow.id}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${callRow.id}` },
      (payload) => {
        if (payload.new.status === "accepted") {
          clearTimeout(callRingTimeoutHandle);
          document.getElementById("callStatusText").textContent = "Connecting...";
          connectToCall(room, isVideo);
        } else if (payload.new.status === "declined") {
          clearTimeout(callRingTimeoutHandle);
          toast(`${partnerName} declined the call`);
          logCallOutcome(partnerId, isVideo, "declined");
          endCallLocal(false);
        }
      }
    )
    .subscribe();

  callRingTimeoutHandle = setTimeout(async () => {
    await supabaseClient.from("calls").update({ status: "missed", ended_at: new Date().toISOString() }).eq("id", callRow.id).eq("status", "ringing");
    toast("No answer");
    logCallOutcome(partnerId, isVideo, "missed");
    endCallLocal(false);
  }, CALL_RING_TIMEOUT_MS);
}

function openCallView(callId, partnerId, partnerName, isVideo, isCaller) {
  currentCallId = callId;
  currentCallIsCaller = isCaller;
  currentCallPartnerId = partnerId;
  currentCallPartnerName = partnerName;
  currentCallIsVideo = isVideo;
  currentCallEnded = false;
  callConnectStartedAt = null;
  switchView("call");
  document.getElementById("callPartnerName").textContent = partnerName;
  document.getElementById("callAvatar").style.background = gradientFor(partnerId);
  document.getElementById("callAvatar").textContent = partnerName[0].toUpperCase();
  document.getElementById("callAvatarBg").style.display = "flex";
  const remoteVideo = document.getElementById("callRemoteVideo");
  const localVideo = document.getElementById("callLocalVideo");
  remoteVideo.style.display = "none";
  localVideo.style.display = "none";
  document.getElementById("callVideoToggleBtn").style.display = isVideo ? "" : "none";
  document.getElementById("callVideoToggleBtn").classList.remove("active");
  document.getElementById("callMuteBtn").classList.remove("active");
}

async function connectToCall(room, isVideo) {
  try {
    const { token, url } = await getLiveKitToken(room);
    const lkRoom = new LivekitClient.Room();
    lkRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === "audio") { track.attach(); return; }
      if (track.kind !== "video") return;
      const video = document.getElementById("callRemoteVideo");
      track.attach(video);
      video.style.display = "block";
      document.getElementById("callAvatarBg").style.display = "none";
    });
    lkRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === "audio") { track.detach().forEach((el) => el.remove()); return; }
      const video = document.getElementById("callRemoteVideo");
      video.style.display = "none";
      document.getElementById("callAvatarBg").style.display = "flex";
    });
    lkRoom.on(LivekitClient.RoomEvent.ParticipantConnected, () => {
      callConnectStartedAt = Date.now();
      document.getElementById("callStatusText").textContent = "Connected";
    });
    lkRoom.on(LivekitClient.RoomEvent.ParticipantDisconnected, () => {
      toast(`${currentCallPartnerName} left the call`);
      endCallLocal(true);
    });
    await lkRoom.connect(url, token);
    callRoom = lkRoom;

    callLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo ? { facingMode: "user" } : false });
    callLocalAudioTrack = callLocalStream.getAudioTracks()[0];
    callLocalVideoTrack = isVideo ? callLocalStream.getVideoTracks()[0] : null;
    await lkRoom.localParticipant.publishTrack(callLocalAudioTrack, { source: LivekitClient.Track.Source.Microphone });
    if (callLocalVideoTrack) {
      await lkRoom.localParticipant.publishTrack(callLocalVideoTrack, { source: LivekitClient.Track.Source.Camera });
      const localVideo = document.getElementById("callLocalVideo");
      localVideo.srcObject = new MediaStream([callLocalVideoTrack]);
      localVideo.style.display = "block";
    }
    if (lkRoom.numParticipants > 0) {
      callConnectStartedAt = Date.now();
      document.getElementById("callStatusText").textContent = "Connected";
    }
  } catch (e) {
    toast("Couldn't connect the call");
    endCallLocal(true);
  }
}

function logCallOutcome(partnerId, isVideo, outcome) {
  if (!currentUser || !partnerId) return;
  const kind = isVideo ? "Video call" : "Voice call";
  let text;
  if (outcome === "missed") text = `📞 Missed ${kind.toLowerCase()}`;
  else if (outcome === "declined") text = `📞 ${kind} declined`;
  else if (outcome === "ended" && callConnectStartedAt) {
    const secs = Math.round((Date.now() - callConnectStartedAt) / 1000);
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, "0");
    text = `📞 ${kind} · ${mm}:${ss}`;
  } else {
    text = `📞 ${kind} ended`;
  }
  supabaseClient.from("dm_messages").insert({ sender_id: currentUser.id, receiver_id: partnerId, text }).then(() => {});
}

function endCallLocal(remoteEnded) {
  if (currentCallEnded) return;
  currentCallEnded = true;
  clearTimeout(callRingTimeoutHandle);
  if (callStatusChannel && supabaseClient) { supabaseClient.removeChannel(callStatusChannel); callStatusChannel = null; }
  if (callRoom) { try { callRoom.disconnect(); } catch (e) {} callRoom = null; }
  if (callLocalStream) { callLocalStream.getTracks().forEach((t) => t.stop()); callLocalStream = null; }
  callLocalVideoTrack = null;
  callLocalAudioTrack = null;
  const partnerId = currentCallPartnerId;
  const partnerName = currentCallPartnerName;
  currentCallId = null;
  currentCallPartnerId = null;
  currentCallPartnerName = null;
  if (state.view === "call") {
    if (partnerId) openDmChat(partnerId, partnerName || "Chat");
    else switchView("dm-inbox");
  }
}

document.getElementById("callEndBtn").addEventListener("click", async () => {
  if (currentCallEnded) return;
  const callId = currentCallId;
  const isCaller = currentCallIsCaller;
  const partnerId = currentCallPartnerId;
  const isVideo = currentCallIsVideo;
  const wasConnected = !!callConnectStartedAt;
  if (callId) {
    await supabaseClient.from("calls").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", callId).neq("status", "ended");
  }
  if (isCaller) logCallOutcome(partnerId, isVideo, wasConnected ? "ended" : "missed");
  endCallLocal(false);
});

document.getElementById("callMuteBtn").addEventListener("click", () => {
  if (!callLocalAudioTrack) return;
  callLocalAudioTrack.enabled = !callLocalAudioTrack.enabled;
  document.getElementById("callMuteBtn").classList.toggle("active", !callLocalAudioTrack.enabled);
});
document.getElementById("callVideoToggleBtn").addEventListener("click", () => {
  if (!callLocalVideoTrack) return;
  callLocalVideoTrack.enabled = !callLocalVideoTrack.enabled;
  document.getElementById("callVideoToggleBtn").classList.toggle("active", !callLocalVideoTrack.enabled);
  document.getElementById("callLocalVideo").style.display = callLocalVideoTrack.enabled ? "block" : "none";
});

/* ---------------- Content upload (real user-generated dramas) ---------------- */
let uploadDramaId = null;
let uploadNextEpisodeNumber = 1;
let episodeLikeCounts = {};
let myLikedEpisodes = new Set();
let episodeCommentCounts = {};

function bumpCommentCount(dramaId, epNum, delta) {
  const key = dramaId + ":" + epNum;
  episodeCommentCounts[key] = Math.max(0, (episodeCommentCounts[key] || 0) + delta);
  document.querySelectorAll(`[data-comment-key="${key}"] span`).forEach((span) => {
    span.textContent = formatCount(episodeCommentCounts[key]);
  });
}

function showUploadStep(step) {
  document.getElementById("uploadStepList").style.display = step === "list" ? "" : "none";
  document.getElementById("uploadStepCreate").style.display = step === "create" ? "" : "none";
  document.getElementById("uploadStepEpisodes").style.display = step === "episodes" ? "" : "none";
  document.getElementById("uploadStepPreview").style.display = step === "preview" ? "" : "none";
  document.getElementById("uploadStepPublished").style.display = step === "published" ? "" : "none";
  document.getElementById("uploadStepEdit").style.display = step === "edit" ? "" : "none";
  const titles = { list: "My Dramas", create: "New Drama", episodes: "Add Episodes", preview: "Preview Drama", published: "Published", edit: "Edit Drama" };
  document.getElementById("uploadModalTitle").textContent = titles[step];

  const stepNByStep = { create: 1, episodes: 2, preview: 3, published: 4 };
  const n = stepNByStep[step];
  document.getElementById("uploadStepsRow").style.display = n ? "flex" : "none";
  if (n) {
    document.querySelectorAll(".upload-step").forEach((el) => {
      const elN = parseInt(el.dataset.stepN, 10);
      el.classList.toggle("active", elN === n);
      el.classList.toggle("done", elN < n);
    });
  }
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
    .select("id, title, genre, is_draft")
    .eq("creator_id", currentUser.id)
    .order("created_at", { ascending: false });

  wrap.innerHTML = "";
  if (!dramaRows || !dramaRows.length) {
    wrap.innerHTML = '<div class="creator-empty">You haven\'t created any dramas yet.</div>';
    return;
  }

  const { data: episodeRows } = await supabaseClient
    .from("episodes")
    .select("drama_id, episode_number")
    .in("drama_id", dramaRows.map((d) => d.id));
  const countByDrama = {};
  (episodeRows || []).forEach((e) => { countByDrama[e.drama_id] = (countByDrama[e.drama_id] || 0) + 1; });

  dramaRows.forEach((row) => {
    const epCount = countByDrama[row.id] || 0;
    const card = document.createElement("div");
    card.className = "creator-card";
    card.innerHTML = `
      <div class="creator-avatar" style="background:${gradientFor(row.id)}">${row.title[0].toUpperCase()}</div>
      <div class="creator-info">
        <div class="creator-name">${row.title} <span class="upload-status-badge${row.is_draft ? "" : " published"}">${row.is_draft ? "Draft" : "Published"}</span></div>
        <div class="creator-status">${epCount} episode${epCount === 1 ? "" : "s"}</div>
      </div>
      <button class="creator-follow-btn edit-drama-btn">Edit</button>
      <button class="creator-follow-btn add-episode-btn">+ Add Episode</button>
    `;
    card.querySelector(".edit-drama-btn").addEventListener("click", () => openEditDrama(row.id));
    card.querySelector(".add-episode-btn").addEventListener("click", () => {
      uploadDramaId = row.id;
      uploadNextEpisodeNumber = epCount + 1;
      document.getElementById("uploadEpisodesForText").textContent = `Add episodes to "${row.title}" — select one or more video files.`;
      document.getElementById("uploadNextEpNum").textContent = uploadNextEpisodeNumber;
      document.getElementById("uploadProgressText").textContent = "";
      document.getElementById("uploadBulkList").innerHTML = "";
      document.getElementById("uploadReleaseAtInput").value = "";
      showUploadStep("episodes");
    });
    wrap.appendChild(card);
  });
}

async function openPreviewDrama(dramaId) {
  showUploadStep("preview");
  const { data: row } = await supabaseClient
    .from("dramas")
    .select("title, description, genre, cover_path, is_draft")
    .eq("id", dramaId)
    .single();
  const { count: epCount } = await supabaseClient
    .from("episodes")
    .select("id", { count: "exact", head: true })
    .eq("drama_id", dramaId);
  if (!row) return;
  const coverUrl = row.cover_path ? `${SUPABASE_URL}/storage/v1/object/public/drama-covers/${row.cover_path}` : null;
  document.getElementById("uploadPreviewCover").style.cssText = coverUrl
    ? `background-image:url('${coverUrl}')`
    : `background:${gradientFor(dramaId)}`;
  document.getElementById("uploadPreviewGenre").textContent = row.genre;
  document.getElementById("uploadPreviewTitle").textContent = row.title;
  document.getElementById("uploadPreviewDesc").textContent = row.description || "";
  document.getElementById("uploadPreviewMeta").textContent = `${epCount || 0} Episode${epCount === 1 ? "" : "s"}`;
  document.getElementById("uploadPublishBtn").textContent = row.is_draft ? "Publish" : "Update & Keep Live";
}

let editDramaId = null;

async function openEditDrama(dramaId) {
  editDramaId = dramaId;
  document.getElementById("editCoverInput").value = "";
  showUploadStep("edit");

  const { data: row } = await supabaseClient.from("dramas").select("title, description, genre, is_draft").eq("id", dramaId).single();
  if (row) {
    document.getElementById("editTitleInput").value = row.title;
    document.getElementById("editDescInput").value = row.description || "";
    document.getElementById("editGenreSelect").value = row.genre;
    updateEditStatusUI(row.is_draft);
  }
  renderEditEpisodeList(dramaId);
}

function updateEditStatusUI(isDraft) {
  const badge = document.getElementById("editStatusBadge");
  badge.textContent = isDraft ? "Draft" : "Published";
  badge.classList.toggle("published", !isDraft);
  document.getElementById("editPublishToggleBtn").textContent = isDraft ? "Publish Now" : "Unpublish";
}

document.getElementById("editPublishToggleBtn").addEventListener("click", async () => {
  const isCurrentlyDraft = document.getElementById("editStatusBadge").textContent === "Draft";
  const btn = document.getElementById("editPublishToggleBtn");
  btn.disabled = true;
  const { error } = await supabaseClient.from("dramas").update({ is_draft: !isCurrentlyDraft }).eq("id", editDramaId);
  btn.disabled = false;
  if (error) { toast("Couldn't update status"); return; }
  updateEditStatusUI(!isCurrentlyDraft);
  toast(isCurrentlyDraft ? "Published!" : "Moved back to drafts");
  await fetchRealDramas();
});

async function renderEditEpisodeList(dramaId) {
  const list = document.getElementById("editEpisodeList");
  list.innerHTML = '<div class="creator-empty">Loading...</div>';
  const { data: episodes } = await supabaseClient
    .from("episodes")
    .select("episode_number, video_path, release_at")
    .eq("drama_id", dramaId)
    .order("episode_number", { ascending: true });
  list.innerHTML = "";
  if (!episodes || !episodes.length) {
    list.innerHTML = '<div class="creator-empty">No episodes uploaded yet.</div>';
    return;
  }
  const lastEpNum = episodes[episodes.length - 1].episode_number;
  episodes.forEach((ep) => {
    const scheduled = ep.release_at && new Date(ep.release_at) > new Date();
    const row = document.createElement("div");
    row.className = "creator-card";
    row.innerHTML = `
      <div class="creator-info">
        <div class="creator-name">Episode ${ep.episode_number}</div>
        ${scheduled ? `<div class="creator-status">Scheduled for ${new Date(ep.release_at).toLocaleString()}</div>` : ""}
      </div>
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
    .insert({ creator_id: currentUser.id, title, description, genre, free_episodes: 3, is_draft: true })
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

  document.getElementById("uploadEpisodesForText").textContent = `Add episodes to "${data.title}" — select one or more video files.`;
  document.getElementById("uploadNextEpNum").textContent = 1;
  document.getElementById("uploadProgressText").textContent = "";
  document.getElementById("uploadBulkList").innerHTML = "";
  document.getElementById("uploadReleaseAtInput").value = "";
  showUploadStep("episodes");
});

document.getElementById("uploadEpisodeBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("uploadVideoInput");
  const files = Array.from(fileInput.files || []);
  if (!files.length) { toast("Choose at least one video file"); return; }
  const releaseInput = document.getElementById("uploadReleaseAtInput");
  const releaseAt = releaseInput.value ? new Date(releaseInput.value).toISOString() : null;
  const btn = document.getElementById("uploadEpisodeBtn");
  const progress = document.getElementById("uploadProgressText");
  const bulkList = document.getElementById("uploadBulkList");
  btn.disabled = true;
  bulkList.innerHTML = "";
  const rows = files.map((file) => {
    const row = document.createElement("div");
    row.className = "upload-bulk-item";
    row.innerHTML = `<span class="upload-bulk-name">${file.name}</span><span class="upload-bulk-status">Waiting...</span>`;
    bulkList.appendChild(row);
    return row;
  });

  let uploadedCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const statusEl = rows[i].querySelector(".upload-bulk-status");
    statusEl.textContent = "Uploading...";
    progress.textContent = `Uploading ${i + 1} of ${files.length}...`;
    const epNum = uploadNextEpisodeNumber;
    const ext = file.name.split(".").pop() || "mp4";
    const path = `${currentUser.id}/${uploadDramaId}/${epNum}.${ext}`;
    const { error: uploadError } = await supabaseClient.storage.from("episode-videos").upload(path, file);
    if (uploadError) {
      statusEl.textContent = "Failed";
      rows[i].classList.add("failed");
      continue;
    }
    const { error: insertError } = await supabaseClient
      .from("episodes")
      .insert({ drama_id: uploadDramaId, episode_number: epNum, video_path: path, release_at: releaseAt });
    if (insertError) {
      statusEl.textContent = "Failed";
      rows[i].classList.add("failed");
      continue;
    }
    statusEl.textContent = "Done";
    rows[i].classList.add("done");
    uploadedCount++;
    uploadNextEpisodeNumber++;
    document.getElementById("uploadNextEpNum").textContent = uploadNextEpisodeNumber;
  }
  btn.disabled = false;
  fileInput.value = "";
  progress.textContent = "";
  if (uploadedCount) toast(`${uploadedCount} episode${uploadedCount === 1 ? "" : "s"} uploaded!`);
});

document.getElementById("uploadEpisodesNextBtn").addEventListener("click", () => openPreviewDrama(uploadDramaId));
document.getElementById("uploadPreviewBackBtn").addEventListener("click", () => showUploadStep("episodes"));

document.getElementById("uploadPublishBtn").addEventListener("click", async () => {
  const btn = document.getElementById("uploadPublishBtn");
  btn.disabled = true;
  const { data: row } = await supabaseClient.from("dramas").select("title").eq("id", uploadDramaId).single();
  const { error } = await supabaseClient.from("dramas").update({ is_draft: false }).eq("id", uploadDramaId);
  btn.disabled = false;
  if (error) { toast("Couldn't publish: " + error.message); return; }
  document.getElementById("uploadPublishedSub").textContent = `Congratulations, "${row?.title || "your drama"}" has published successfully.`;
  showUploadStep("published");
  await fetchRealDramas();
});

document.getElementById("uploadPublishedDoneBtn").addEventListener("click", () => {
  showUploadStep("list");
  renderUploadDramaList();
});

document.getElementById("uploadDoneBtn").addEventListener("click", async () => {
  await fetchRealDramas();
  showUploadStep("list");
  renderUploadDramaList();
});

async function fetchRealDramas() {
  if (!supabaseClient) return;
  const { data: dramaRows, error: dramaError } = await supabaseClient
    .from("dramas")
    .select("id, creator_id, title, description, genre, free_episodes, cover_path, created_at")
    .order("created_at", { ascending: false });
  if (dramaError) { console.error("fetchRealDramas: dramas query failed", dramaError); return; }
  if (!dramaRows) return;

  const creatorIds = [...new Set(dramaRows.map((r) => r.creator_id))];
  const creatorNameById = {};
  if (creatorIds.length) {
    const { data: creatorRows } = await supabaseClient.from("profiles").select("id, username").in("id", creatorIds);
    (creatorRows || []).forEach((p) => { creatorNameById[p.id] = p.username; });
  }

  const { data: episodeRows, error: episodeError } = await supabaseClient.from("episodes").select("drama_id, episode_number, video_path");
  if (episodeError) console.error("fetchRealDramas: episodes query failed", episodeError);
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

  const { data: commentRows } = await supabaseClient.from("comments").select("drama_id, episode_number");
  episodeCommentCounts = {};
  (commentRows || []).forEach((c) => {
    const key = c.drama_id + ":" + c.episode_number;
    episodeCommentCounts[key] = (episodeCommentCounts[key] || 0) + 1;
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
      creatorName: creatorNameById[row.creator_id] || "Creator",
      videoUrls,
      coverUrl: row.cover_path ? `${SUPABASE_URL}/storage/v1/object/public/drama-covers/${row.cover_path}` : null,
    });
  });
  renderFeed();
  if (state.view === "foryou") renderForYouFeed();
  if (state.view === "home") renderHomeDashboard();
}

function openDetail(dramaId) {
  const d = DRAMAS.find(x => x.id === dramaId);
  state.currentDrama = d;
  document.getElementById("detailHero").style.cssText = coverStyle(d) + ";position:relative;";
  document.getElementById("detailTitle").textContent = d.title;
  document.getElementById("detailMeta").textContent = `${d.episodes} Episodes · ${d.label} · @${d.creatorName || "creator"}`;
  document.getElementById("detailDesc").textContent = d.desc;

  const rank = [...DRAMAS].sort((a, b) => parseFloat(b.views) - parseFloat(a.views)).findIndex((x) => x.id === d.id) + 1;
  document.getElementById("detailBadgesRow").innerHTML = rank > 0 && rank <= 10 ? `<span class="detail-rank-badge">TOP ${rank}</span>` : "";

  const followBtn = document.getElementById("followBtn");
  const saved = !!state.followed[d.id];
  followBtn.querySelector("span").textContent = saved ? "Saved" : "My List";
  followBtn.querySelector("use").setAttribute("href", saved ? "#ic-bookmark-filled" : "#ic-bookmark");
  followBtn.classList.toggle("active", saved);

  showDetailTab("episodes");

  const grid = document.getElementById("episodeGrid");
  grid.innerHTML = "";
  for (let n = 1; n <= d.episodes; n++) {
    const unlocked = isUnlocked(d.id, n, d.free) || isDramaFullyUnlocked(d);
    const likeCount = episodeLikeCounts[d.id + ":" + n] || 0;
    const row = document.createElement("button");
    row.className = "episode-row " + (unlocked ? "unlocked" : "locked");
    row.innerHTML = `
      <div class="episode-row-thumb" style="${coverStyle(d)}"><svg class="ic"><use href="#ic-${unlocked ? "play" : "lock"}"/></svg></div>
      <div class="episode-row-info">
        <div class="episode-row-title">${n}. Episode ${n}</div>
        <div class="episode-row-sub">${likeCount} likes</div>
      </div>
    `;
    row.addEventListener("click", () => openPlayer(d.id, n - 1));
    grid.appendChild(row);
  }

  renderMoreLikeThis(d);
  switchView("detail");
}

function renderMoreLikeThis(d) {
  const grid = document.getElementById("moreLikeGrid");
  grid.innerHTML = "";
  const similar = DRAMAS.filter((x) => x.id !== d.id && x.genre === d.genre);
  if (!similar.length) { grid.innerHTML = '<div class="empty-state">Nothing similar yet.</div>'; return; }
  similar.forEach((s) => {
    const card = document.createElement("div");
    card.className = "poster-card";
    card.innerHTML = `
      <div class="poster-cover" style="${coverStyle(s)}"></div>
      <h3 class="poster-title">${s.title}</h3>
      <p class="poster-genre">${s.label}</p>
    `;
    card.addEventListener("click", () => openDetail(s.id));
    grid.appendChild(card);
  });
}

function showDetailTab(tab) {
  document.querySelectorAll(".detail-tab").forEach((t) => t.classList.toggle("active", t.dataset.detailTab === tab));
  document.getElementById("detailPanelEpisodes").classList.toggle("active", tab === "episodes");
  document.getElementById("detailPanelMore").classList.toggle("active", tab === "more");
}
document.querySelectorAll(".detail-tab").forEach((t) => {
  t.addEventListener("click", () => showDetailTab(t.dataset.detailTab));
});

document.getElementById("playFirstBtn").addEventListener("click", () => openPlayer(state.currentDrama.id, 0));
document.getElementById("followBtn").addEventListener("click", () => {
  const d = state.currentDrama;
  state.followed[d.id] = !state.followed[d.id];
  saveState();
  openDetail(d.id);
  toast(state.followed[d.id] ? "Added to My List" : "Removed from My List");
});
document.getElementById("detailShareBtn").addEventListener("click", () => openModal("shareModal"));
document.getElementById("detailReportBtn").addEventListener("click", () => {
  if (state.currentDrama) submitReport(state.currentDrama);
});
document.getElementById("detailMoreBtn").addEventListener("click", () => {
  moreModalTarget = state.currentDrama;
  openModal("moreModal");
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
  const liked = myLikedEpisodes.has(likeKey);
  const likeCount = episodeLikeCounts[likeKey] || 0;

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
      <button class="rail-btn comment-btn" data-comment-key="${likeKey}"><svg class="ic"><use href="#ic-comment"/></svg><span>${formatCount(episodeCommentCounts[likeKey] || 0)}</span></button>
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
    if (!currentUser) { toast("Sign in to like"); openAuthModal("signin"); return; }
    if (forceOn && myLikedEpisodes.has(likeKey)) return;
    const nowLiked = forceOn ? true : !myLikedEpisodes.has(likeKey);
    if (nowLiked) myLikedEpisodes.add(likeKey); else myLikedEpisodes.delete(likeKey);
    episodeLikeCounts[likeKey] = Math.max(0, (episodeLikeCounts[likeKey] || 0) + (nowLiked ? 1 : -1));
    const btn = card.querySelector(".like-btn");
    btn.classList.toggle("liked", nowLiked);
    btn.querySelector("use").setAttribute("href", nowLiked ? "#ic-heart-filled" : "#ic-heart");
    btn.querySelector("span").textContent = formatCount(episodeLikeCounts[likeKey]);
    if (nowLiked) {
      supabaseClient.from("episode_likes").insert({ drama_id: d.id, episode_number: epNum, user_id: currentUser.id });
    } else {
      supabaseClient.from("episode_likes").delete().eq("drama_id", d.id).eq("episode_number", epNum).eq("user_id", currentUser.id);
    }
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

  const visible = (data || []).filter((c) => !blockedIds.has(c.user_id));
  list.innerHTML = "";
  if (!visible.length) {
    list.innerHTML = '<div class="creator-empty">No comments yet — be the first!</div>';
  } else {
    visible.forEach((c) => list.appendChild(commentRow(c.author?.username || "User", c.text)));
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
        if (blockedIds.has(payload.new.user_id)) return;
        bumpCommentCount(drama.id, epNum, 1);
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
  if (error) { toast("Comment failed to send"); return; }
  bumpCommentCount(dramaId, epNum, 1);
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
function openExplore() {
  switchView("explore");
  renderFeed();
}

document.getElementById("exploreBackBtn").addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "foryou"));
  switchView("foryou");
  renderForYouFeed();
});

document.querySelectorAll(".nav-item[data-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    if (tab === "home") { switchView("home"); renderHomeDashboard(); }
    if (tab === "foryou") { switchView("foryou"); renderForYouFeed(); }
    if (tab === "inbox") {
      if (!currentUser) { toast("Sign in to see messages"); openAuthModal("signin"); return; }
      openDmInbox();
    }
    if (tab === "profile") { switchView("mine"); renderMine(); }
  });
});

document.querySelectorAll("#subGenreTabs .genre-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#subGenreTabs .genre-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.feedFilter = tab.dataset.genre;
    renderFeed();
  });
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  state.searchTerm = e.target.value.trim();
  renderFeed();
});
document.getElementById("filterBtn").addEventListener("click", () => toast("More filters coming soon"));
document.getElementById("homeSearchBtn").addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "explore"));
  switchView("explore");
  renderFeed();
  setTimeout(() => document.getElementById("searchInput").focus(), 150);
});
document.getElementById("homeNotifBtn").addEventListener("click", () => openNotifications());
document.getElementById("profileNotifBtn").addEventListener("click", () => openNotifications());
document.getElementById("profileSettingsBtn").addEventListener("click", () => {
  renderSettingsToggles();
  openModal("settingsModal");
});

document.querySelectorAll("[data-see-all]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "explore"));
    switchView("explore");
    state.feedFilter = btn.dataset.seeAll;
    document.querySelectorAll("#subGenreTabs .genre-tab").forEach((t) => t.classList.toggle("active", t.dataset.genre === btn.dataset.seeAll));
    renderFeed();
  });
});
document.querySelectorAll("[data-see-all-mylist]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "mylist"));
    switchView("mylist");
    renderMyList();
  });
});
document.getElementById("subscribeVipBtn").addEventListener("click", () => {
  state.vip = true;
  saveState();
  toast("Welcome to VIP! All series unlocked.");
  closeModal("vipModal");
});

document.querySelectorAll('[data-back="home"]').forEach(btn => {
  btn.addEventListener("click", () => { switchView("home"); renderHomeDashboard(); });
});

/* ---------------- For You (cross-series swipe discovery) ---------------- */
function renderForYouFeed() {
  const feed = document.getElementById("forYouFeed");
  feed.innerHTML = "";

  const maxDramaViews = Math.max(1, ...DRAMAS.map((d) => parseFloat(d.views)));

  // Every creator's free episodes stay grouped in order (ep1, ep2, ...) so a
  // scroll never jumps mid-drama into someone else's upload; only the
  // ordering of whole dramas (and where live sessions slot in) is ranked.
  const dramaGroups = DRAMAS.map((d) => {
    const freeCount = Math.min(d.free || 0, d.episodes);
    const cards = [];
    for (let n = 1; n <= freeCount; n++) {
      if (d.videoUrls && d.videoUrls[n]) cards.push({ type: "episode", data: d, epNum: n });
    }
    if (d.episodes > freeCount) cards.push({ type: "locked", data: d });
    return { mutual: !!d.mutual, score: parseFloat(d.views) / maxDramaViews, cards };
  }).filter((g) => g.cards.length);

  dramaGroups.sort((a, b) => {
    if (a.mutual !== b.mutual) return a.mutual ? -1 : 1;
    return b.score - a.score;
  });

  const items = [
    // Real live sessions always rank as maximally "hot" — someone is live right now.
    ...liveSessionsCache.map((host) => ({ type: "live", data: host })),
    ...dramaGroups.flatMap((g) => g.cards),
  ];

  items.forEach((item) => {
    let card;
    if (item.type === "live") card = buildLiveTeaserCard(item.data);
    else if (item.type === "locked") card = buildLockedEpisodeCard(item.data);
    else card = buildForYouCard(item.data, item.epNum);
    feed.appendChild(card);
  });
  observeForYouCards();
}

function buildLockedEpisodeCard(d) {
  const card = document.createElement("div");
  card.className = "player-card locked-teaser-card";
  card.innerHTML = `
    <div class="player-bg" style="${coverStyle(d, 1)}"></div>
    <div class="player-vignette"></div>
    <div class="locked-teaser-center">
      <svg class="ic locked-lock-ic"><use href="#ic-lock"/></svg>
      <h3>${d.title}</h3>
      <p>You've watched all ${d.free} free episodes. Unlock the rest with coins.</p>
      <button class="btn-watch-now locked-teaser-cta">Unlock Episodes</button>
    </div>
  `;
  card.querySelector(".locked-teaser-cta").addEventListener("click", () => openDetail(d.id));
  card.addEventListener("pointerup", (e) => {
    if (e.target.closest("button")) return;
    openDetail(d.id);
  });
  return card;
}

function buildLiveTeaserCard(host) {
  const card = document.createElement("div");
  card.className = "player-card live-teaser-card";
  card.innerHTML = `
    <div class="player-bg" style="background:${gradientFor(host.id, 2)}"></div>
    <div class="player-vignette"></div>
    <div class="fyu-topbar">
      <div class="fyu-topbar-left">
        <div class="fyu-logo"><svg viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke="currentColor" stroke-width="3"/><text x="32" y="42" font-size="30" font-weight="800" text-anchor="middle" fill="currentColor" font-family="Arial, sans-serif">R</text></svg></div>
        <button class="fyu-explore-btn">Explore</button>
      </div>
      <div class="fyu-topbar-right">
        ${host.following ? '<span class="mutual-badge">Following</span>' : ""}
        <span class="live-teaser-badge">LIVE</span>
      </div>
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
  card.querySelector(".fyu-explore-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openExplore();
  });
  card.addEventListener("pointerup", (e) => {
    if (e.target.closest("button")) return;
    openLiveGuest(host);
  });
  return card;
}

function buildForYouCard(d, epNum) {
  const card = document.createElement("div");
  card.className = "player-card foryou-card";
  const likeKey = d.id + ":" + epNum;
  const claimKey = "foryouClaim:" + d.id + ":" + epNum;
  const liked = myLikedEpisodes.has(likeKey);
  const likeCount = episodeLikeCounts[likeKey] || 0;
  const saved = !!state.followed[d.id];
  const claimed = !!state.claimedTasks[claimKey];
  const followingCreator = followingIds.has(d.creatorId);

  const previewUrl = d.real && d.videoUrls ? d.videoUrls[epNum] : null;

  card.innerHTML = `
    <div class="player-bg" style="${coverStyle(d, 1)}"></div>
    ${previewUrl ? `<video class="foryou-video" muted loop playsinline preload="none" src="${previewUrl}"></video>` : ""}
    <div class="player-vignette"></div>
    <div class="fyu-topbar">
      <div class="fyu-topbar-left">
        <div class="fyu-logo"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="url(#coinGrad)" opacity="0"/><rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke="currentColor" stroke-width="3"/><text x="32" y="42" font-size="30" font-weight="800" text-anchor="middle" fill="currentColor" font-family="Arial, sans-serif">R</text></svg></div>
        <button class="fyu-explore-btn">Explore</button>
      </div>
      <div class="fyu-topbar-right">
        ${d.mutual ? '<span class="mutual-badge">Mutual</span>' : ""}
        <button class="fyu-search-btn"><svg class="ic"><use href="#ic-search"/></svg></button>
      </div>
    </div>
    ${!claimed ? `
    <button class="claim-chip" data-claim="${claimKey}">
      <svg class="ic ic-coin"><use href="#ic-coin"/></svg> Claim +5
    </button>` : ""}
    <div class="center-play-btn"><svg class="ic"><use href="#ic-play"/></svg></div>
    <div class="reel-side-rail">
      <div class="reel-avatar-wrap">
        <div class="reel-avatar" style="background:${gradientFor(d.creatorId || d.id)}">${(d.creatorName || "C")[0].toUpperCase()}</div>
        ${!followingCreator ? `<button class="reel-follow-plus" data-follow-creator="${d.creatorId}">+</button>` : ""}
      </div>
      <button class="reel-action-btn like-btn ${liked ? 'liked' : ''}" data-like="${likeKey}">${heartIconHTML(liked)}<span>${formatCount(likeCount)}</span></button>
      <button class="reel-action-btn comment-btn" data-comment-key="${likeKey}"><svg class="ic"><use href="#ic-comment"/></svg><span>${formatCount(episodeCommentCounts[likeKey] || 0)}</span></button>
      <button class="reel-action-btn share-btn2"><svg class="ic"><use href="#ic-share"/></svg><span>Share</span></button>
      <button class="reel-action-btn bookmark-btn ${saved ? 'saved' : ''}" data-bookmark="${d.id}"><svg class="ic"><use href="#ic-bookmark${saved ? '-filled' : ''}"/></svg></button>
      <button class="reel-action-btn more-btn"><svg class="ic"><use href="#ic-more"/></svg></button>
    </div>
    <div class="reel-bottom-info player-bottom-nav-spacer">
      <div class="reel-creator-row">
        <b class="reel-creator-name">@${d.creatorName || "creator"}</b>
        ${!followingCreator ? `<button class="reel-follow-text-btn" data-follow-creator="${d.creatorId}">Follow</button>` : '<span class="reel-following-tag">Following</span>'}
      </div>
      <p class="reel-caption"><b>${d.title}</b> · EP ${epNum} — ${d.desc} <span class="more-link">More</span></p>
    </div>
  `;

  card.querySelector(".like-btn").addEventListener("click", (e) => {
    if (!currentUser) { toast("Sign in to like"); openAuthModal("signin"); return; }
    const nowLiked = !myLikedEpisodes.has(likeKey);
    if (nowLiked) myLikedEpisodes.add(likeKey); else myLikedEpisodes.delete(likeKey);
    episodeLikeCounts[likeKey] = Math.max(0, (episodeLikeCounts[likeKey] || 0) + (nowLiked ? 1 : -1));
    const btn = e.currentTarget;
    btn.classList.toggle("liked", nowLiked);
    btn.querySelector("use").setAttribute("href", nowLiked ? "#ic-heart-filled" : "#ic-heart");
    btn.querySelector("span").textContent = formatCount(episodeLikeCounts[likeKey]);
    if (nowLiked) {
      supabaseClient.from("episode_likes").insert({ drama_id: d.id, episode_number: epNum, user_id: currentUser.id });
    } else {
      supabaseClient.from("episode_likes").delete().eq("drama_id", d.id).eq("episode_number", epNum).eq("user_id", currentUser.id);
    }
  });
  card.querySelector(".bookmark-btn").addEventListener("click", (e) => {
    state.followed[d.id] = !state.followed[d.id];
    saveState();
    const btn = e.currentTarget;
    btn.classList.toggle("saved", state.followed[d.id]);
    btn.querySelector("use").setAttribute("href", state.followed[d.id] ? "#ic-bookmark-filled" : "#ic-bookmark");
    toast(state.followed[d.id] ? "Added to My List" : "Removed from My List");
  });
  card.querySelector(".comment-btn").addEventListener("click", () => openComments(d, epNum));
  card.querySelector(".share-btn2").addEventListener("click", () => {
    state.currentDrama = d;
    openModal("shareModal");
  });
  card.querySelectorAll("[data-follow-creator]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!d.creatorId) return;
      await toggleFollow(d.creatorId, btn);
      const nowFollowing = followingIds.has(d.creatorId);
      card.querySelectorAll("[data-follow-creator]").forEach((b) => {
        if (nowFollowing) b.remove();
      });
      if (nowFollowing) {
        card.querySelector(".reel-creator-row").insertAdjacentHTML("beforeend", '<span class="reel-following-tag">Following</span>');
      }
    });
  });
  const claimBtn = card.querySelector(".claim-chip");
  if (claimBtn) {
    claimBtn.addEventListener("click", () => {
      state.claimedTasks[claimKey] = true;
      recordClaim("task:" + claimKey);
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
    switchView("mylist");
    renderMyList();
    document.querySelector('.mltab[data-mltab="creators"]').click();
    setTimeout(() => document.getElementById("creatorSearchInput").focus(), 150);
  });
  card.querySelector(".fyu-explore-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openExplore();
  });
  card.querySelector(".reel-caption").addEventListener("click", () => openDetail(d.id));
  card.querySelector(".more-link").addEventListener("click", (e) => { e.stopPropagation(); openDetail(d.id); });

  let lastTap = 0;
  let singleTapTimer = null;
  card.addEventListener("pointerup", (e) => {
    if (e.target.closest("button, .reel-bottom-info")) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      clearTimeout(singleTapTimer);
      if (!myLikedEpisodes.has(likeKey)) card.querySelector(".like-btn").click();
      spawnHeartBurst(card, e.clientX, e.clientY);
    } else {
      singleTapTimer = setTimeout(() => {
        card.classList.toggle("paused");
        const video = card.querySelector(".foryou-video");
        if (video) {
          if (card.classList.contains("paused")) video.pause();
          else video.play().catch(() => {});
        }
      }, 300);
    }
    lastTap = now;
  });

  return card;
}

function observeForYouCards() {
  const cards = document.querySelectorAll("#forYouFeed .player-card");
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = entry.target.querySelector(".foryou-video");
      if (!video) return;
      if (entry.isIntersecting) {
        if (!entry.target.classList.contains("paused")) video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
    });
  }, { threshold: [0.6], root: document.getElementById("forYouFeed") });
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
      recordClaim("quest:" + i);
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
        recordClaim("fresh:" + i);
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
  recordClaim("task:" + key);
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
        recordRedemption(item.id, owned + 1);
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
  analytics: '<path d="M4 20V10M11 20V4M18 20v-7"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 14h.01"/>',
};

const PROFILE_MENU = [
  { key: "setting", label: "My Account" },
  { key: "history", label: "Watch History" },
  { key: "mylist", label: "My List" },
  { key: "earnrewards", label: "Rewards & Quests" },
  { key: "wallet", label: "Wallet & Payments" },
];

const PROFILE_MENU_MORE = [
  { key: "analytics", label: "Analytics" },
  { key: "leaderboard", label: "Leaderboard" },
  { key: "following", label: "Find Creators" },
  { key: "notifications", label: "Notifications", dot: true },
  { key: "invite", label: "Invitation Code" },
  { key: "myitems", label: "My Items" },
  { key: "feedback", label: "Feedback" },
  { key: "language", label: "Language" },
  { key: "about", label: "About Us", version: "V1.0.0" },
];

function renderMine() {
  updateCoinDisplays();
  document.querySelector(".firstlogin-badge").classList.toggle("claimed-btn", !!state.claimedTasks.firstlogin);
  renderProfileMenu();
  renderContinueWatching("profileContinueTitle", "profileContinueStrip");
  renderProfileVipCard();
  loadProfileStats();
}

function renderProfileVipCard() {
  const badge = document.getElementById("profileProBadge");
  const title = document.getElementById("premiumCardTitle");
  const desc = document.getElementById("premiumCardDesc");
  const btn = document.getElementById("premiumCardBtn");
  badge.style.display = state.vip ? "inline-block" : "none";
  if (state.vip) {
    title.textContent = "ReelFlix Premium — Active";
    desc.textContent = "Enjoy ad-free streaming, unlocked episodes, exclusive content and more.";
    btn.textContent = "Manage Plan";
  } else {
    title.textContent = "Become a ReelFlix VIP";
    desc.textContent = "Unlock every episode, skip the coin cost, and get a daily VIP reward.";
    btn.textContent = "GO";
  }
}

async function loadProfileStats() {
  document.getElementById("statFollowing").textContent = followingIds.size;
  document.getElementById("statSaved").textContent = Object.values(state.followed).filter(Boolean).length;

  const watched = Object.entries(state.watchHistory).map(([dramaId, p]) => ({ drama: DRAMAS.find((d) => d.id === dramaId), ...p })).filter((e) => e.drama);
  document.getElementById("statEpisodesWatched").textContent = watched.reduce((sum, e) => sum + e.epNum, 0);
  document.getElementById("statDramasCompleted").textContent = watched.filter((e) => e.epNum >= e.drama.episodes).length;

  const myDramas = DRAMAS.filter((d) => d.creatorId === currentUser?.id);
  document.getElementById("statDramasUploaded").textContent = myDramas.length;

  if (!currentUser || !supabaseClient) {
    document.getElementById("statFollowers").textContent = 0;
    document.getElementById("statLikes").textContent = 0;
    document.getElementById("statCommentsPosted").textContent = 0;
    return;
  }

  const { count: followerCount } = await supabaseClient
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("followed_id", currentUser.id);
  document.getElementById("statFollowers").textContent = followerCount || 0;

  const { count: commentCount } = await supabaseClient
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", currentUser.id);
  document.getElementById("statCommentsPosted").textContent = commentCount || 0;

  const myDramaIds = myDramas.map((d) => d.id);
  if (myDramaIds.length) {
    const { count: likeCount } = await supabaseClient
      .from("episode_likes")
      .select("user_id", { count: "exact", head: true })
      .in("drama_id", myDramaIds);
    document.getElementById("statLikes").textContent = likeCount || 0;
  } else {
    document.getElementById("statLikes").textContent = 0;
  }
}

function renderProfileMenuInto(wrapId, items) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = "";
  const dotCountByKey = { notifications: notificationsUnreadCount };
  items.forEach((item) => {
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

let profileMoreExpanded = false;
function renderProfileMenuMore() {
  if (profileMoreExpanded) {
    renderProfileMenuInto("profileMenuMore", PROFILE_MENU_MORE);
    const row = document.createElement("button");
    row.className = "profile-row";
    row.id = "profileMoreToggle";
    row.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
      <span class="row-label">See Less</span>
    `;
    document.getElementById("profileMenuMore").appendChild(row);
  } else {
    const wrap = document.getElementById("profileMenuMore");
    wrap.innerHTML = `
      <button class="profile-row" id="profileMoreToggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        <span class="row-label">See More</span>
      </button>
    `;
  }
}

function renderProfileMenu() {
  renderProfileMenuInto("profileMenu", PROFILE_MENU);
  renderProfileMenuMore();
}

function handleProfileMenuAction(action) {
  if (action === "analytics") {
    openAnalytics();
  } else if (action === "leaderboard") {
    openLeaderboard();
  } else if (action === "following" || action === "mylist") {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "mylist"));
    switchView("mylist");
    renderMyList();
  } else if (action === "history") {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "mylist"));
    switchView("mylist");
    renderMyList();
    document.querySelector('.mltab[data-mltab="history"]').click();
  } else if (action === "wallet") {
    openModal("coinModal");
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
}

["profileMenu", "profileMenuMore"].forEach((id) => {
  document.getElementById(id).addEventListener("click", (e) => {
    if (e.target.closest("#profileMoreToggle")) {
      profileMoreExpanded = !profileMoreExpanded;
      renderProfileMenuMore();
      return;
    }
    const row = e.target.closest(".profile-row");
    if (!row) return;
    handleProfileMenuAction(row.dataset.action);
  });
});

document.getElementById("profileContinueSeeAll").addEventListener("click", () => handleProfileMenuAction("history"));

document.getElementById("navCreateBtn").addEventListener("click", () => openModal("createChoiceModal"));
document.getElementById("createGoLiveBtn").addEventListener("click", () => {
  closeModal("createChoiceModal");
  openLiveHost();
});
document.getElementById("createUploadDramaBtn").addEventListener("click", () => {
  closeModal("createChoiceModal");
  openUploadModal();
});

document.getElementById("signInBtn").addEventListener("click", () => openAuthModal("signin"));
document.getElementById("signOutBtn").addEventListener("click", async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  toast("Signed out");
});

document.getElementById("editProfileBtn").addEventListener("click", () => {
  if (!currentUser) return;
  document.getElementById("editProfileUsernameInput").value = currentProfile?.username || "";
  document.getElementById("editProfileBioInput").value = currentProfile?.bio || "";
  openModal("editProfileModal");
});
document.getElementById("editProfileSaveBtn").addEventListener("click", async () => {
  if (!currentUser || !supabaseClient) return;
  const username = document.getElementById("editProfileUsernameInput").value.trim();
  const bio = document.getElementById("editProfileBioInput").value.trim();
  if (!username) { toast("Username can't be empty"); return; }
  const { data, error } = await supabaseClient
    .from("profiles")
    .update({ username, bio })
    .eq("id", currentUser.id)
    .select()
    .single();
  if (error) { toast("Couldn't save profile: " + error.message); return; }
  currentProfile = data;
  updateAuthUI();
  closeModal("editProfileModal");
  toast("Profile updated");
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

document.getElementById("authForgotBtn").addEventListener("click", async () => {
  if (!supabaseClient) { showAuthError("Not available in this build."); return; }
  const email = document.getElementById("authEmailInput").value.trim();
  if (!email) { showAuthError("Enter your email above first."); return; }
  const btn = document.getElementById("authForgotBtn");
  btn.disabled = true;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split("#")[0].split("?")[0],
  });
  btn.disabled = false;
  if (error) { showAuthError(error.message); return; }
  toast("Check your email for a reset link");
  closeModal("authModal");
});

document.getElementById("resetPasswordSubmitBtn").addEventListener("click", async () => {
  if (!supabaseClient) return;
  const password = document.getElementById("newPasswordInput").value;
  const errEl = document.getElementById("resetPasswordError");
  if (!password || password.length < 6) {
    errEl.textContent = "Password must be at least 6 characters.";
    errEl.style.display = "";
    return;
  }
  const btn = document.getElementById("resetPasswordSubmitBtn");
  btn.disabled = true;
  const { error } = await supabaseClient.auth.updateUser({ password });
  btn.disabled = false;
  if (error) { errEl.textContent = error.message; errEl.style.display = ""; return; }
  closeModal("resetPasswordModal");
  toast("Password updated!");
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
  recordClaim("task:invite");
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
      type: "gift", senderId: currentUser?.id, name: currentProfile?.username || "Someone", giftId: gift.id, giftName: gift.name, cost: gift.cost,
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
let approvedGuestIdentity = null;
let pendingJoinRequestIdentity = null;

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

/* ---------------- Live effects (filters + AR face overlays, applied via canvas before publish) ---------------- */
const FILTER_PRESETS = {
  none: "none",
  warm: "saturate(1.25) sepia(0.18) brightness(1.05)",
  cool: "saturate(1.1) hue-rotate(-8deg) brightness(1.02) contrast(1.05)",
  bw: "grayscale(1) contrast(1.1)",
  vintage: "sepia(0.35) saturate(0.8) contrast(0.9) brightness(1.05)",
  beauty: "brightness(1.06) contrast(0.95) saturate(1.08) blur(0.6px)",
};

let liveMediaCtrl = null;
let faceApiScriptPromise = null;
let faceApiModelsPromise = null;

function loadFaceApiScript() {
  if (window.faceapi) return Promise.resolve();
  if (faceApiScriptPromise) return faceApiScriptPromise;
  faceApiScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/face-api.min.js?v=41";
    s.onload = () => resolve();
    s.onerror = () => { faceApiScriptPromise = null; reject(new Error("load failed")); };
    document.head.appendChild(s);
  });
  return faceApiScriptPromise;
}

async function ensureFaceModelsLoaded() {
  await loadFaceApiScript();
  if (!faceApiModelsPromise) {
    faceApiModelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("models"),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri("models"),
    ]).catch((e) => { faceApiModelsPromise = null; throw e; });
  }
  return faceApiModelsPromise;
}

function avgPoint(pts) {
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}
function ptDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function drawDogEars(ctx, cx, cy, spread, faceWidth) {
  const earH = faceWidth * 0.55, earW = faceWidth * 0.4;
  [-1, 1].forEach((side) => {
    ctx.save();
    ctx.translate(cx + side * spread, cy);
    ctx.rotate(side * 0.3);
    ctx.fillStyle = "#7a4a2b";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(side * earW, -earH * 0.6, 0, -earH);
    ctx.quadraticCurveTo(side * earW * 0.25, -earH * 0.5, 0, 0);
    ctx.fill();
    ctx.restore();
  });
}
function drawBunnyEars(ctx, cx, cy, spread, faceWidth) {
  const earW = faceWidth * 0.22, earH = faceWidth * 0.85;
  [-1, 1].forEach((side) => {
    ctx.save();
    ctx.translate(cx + side * spread * 0.65, cy - earH * 0.35);
    ctx.rotate(side * 0.1);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(0, 0, earW, earH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7a8c4";
    ctx.beginPath();
    ctx.ellipse(0, earH * 0.08, earW * 0.5, earH * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}
function drawGlasses(ctx, leftEye, rightEye, eyeDist) {
  const r = eyeDist * 0.4;
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = Math.max(2, eyeDist * 0.06);
  [leftEye, rightEye].forEach((eye) => {
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(leftEye.x + r * (leftEye.x < rightEye.x ? 1 : -1), leftEye.y);
  ctx.lineTo(rightEye.x + r * (rightEye.x < leftEye.x ? 1 : -1), rightEye.y);
  ctx.stroke();
}
function drawBlush(ctx, leftEye, rightEye, eyeDist) {
  ctx.fillStyle = "rgba(255,105,135,0.45)";
  [leftEye, rightEye].forEach((eye, i) => {
    const dir = i === 0 ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(eye.x + dir * eyeDist * 0.2, eye.y + eyeDist * 0.8, eyeDist * 0.32, eyeDist * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawArOverlay(ctx, faceResult, arPreset) {
  const landmarks = faceResult.landmarks;
  const leftEye = avgPoint(landmarks.getLeftEye());
  const rightEye = avgPoint(landmarks.getRightEye());
  const jaw = landmarks.getJawOutline();
  const faceWidth = ptDist(jaw[0], jaw[jaw.length - 1]);
  const eyeDist = ptDist(leftEye, rightEye);
  const cx = (leftEye.x + rightEye.x) / 2;
  const cy = Math.min(leftEye.y, rightEye.y) - faceWidth * 0.5;
  const spread = faceWidth * 0.62;

  ctx.save();
  if (arPreset === "dog") {
    drawDogEars(ctx, cx, cy, spread, faceWidth);
    const nose = landmarks.getNose();
    const tip = nose[nose.length - 1];
    ctx.fillStyle = "#2b2b2b";
    ctx.beginPath();
    ctx.ellipse(tip.x, tip.y, faceWidth * 0.09, faceWidth * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (arPreset === "bunny") {
    drawBunnyEars(ctx, cx, cy, spread, faceWidth);
  } else if (arPreset === "glasses") {
    drawGlasses(ctx, leftEye, rightEye, eyeDist);
  } else if (arPreset === "blush") {
    drawBlush(ctx, leftEye, rightEye, eyeDist);
  }
  ctx.restore();
}

class LiveEffectsPipeline {
  constructor(rawStream, effects) {
    this.rawStream = rawStream;
    this.effects = effects;
    this.video = document.createElement("video");
    this.video.srcObject = rawStream;
    this.video.muted = true;
    this.video.playsInline = true;
    // Some browsers pause frame decoding for video elements that are never
    // attached to the document, which would freeze the canvas. Keep it in
    // the DOM but fully hidden off-screen.
    this.video.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:-9999px;top:-9999px";
    document.body.appendChild(this.video);
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.running = false;
    this.faceResult = null;
  }

  async start() {
    await this.video.play();
    this.canvas.width = this.video.videoWidth || 480;
    this.canvas.height = this.video.videoHeight || 854;
    this.running = true;
    this._renderLoop();
    this._detectLoop();
    const outStream = this.canvas.captureStream(30);
    const audioTrack = this.rawStream.getAudioTracks()[0];
    if (audioTrack) outStream.addTrack(audioTrack);
    return outStream;
  }

  _renderLoop() {
    if (!this.running) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.filter = FILTER_PRESETS[this.effects.filter] || "none";
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    if (this.effects.ar !== "none" && this.faceResult) {
      drawArOverlay(ctx, this.faceResult, this.effects.ar);
    }
    requestAnimationFrame(() => this._renderLoop());
  }

  async _detectLoop() {
    while (this.running) {
      if (this.effects.ar !== "none" && window.faceapi && faceApiModelsPromise) {
        try {
          const result = await faceapi
            .detectSingleFace(this.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
            .withFaceLandmarks(true);
          this.faceResult = result || null;
        } catch (e) {
          this.faceResult = null;
        }
      } else {
        this.faceResult = null;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  stop() {
    this.running = false;
    this.rawStream.getTracks().forEach((t) => t.stop());
    this.video.remove();
  }
}

class LiveMediaController {
  constructor() {
    this.effects = { filter: "none", ar: "none" };
    this.pipeline = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.room = null;
  }

  async publish(room, previewEl) {
    this.room = room;
    const rawStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
    try {
      this.pipeline = new LiveEffectsPipeline(rawStream, this.effects);
      const outStream = await this.pipeline.start();
      this.videoTrack = outStream.getVideoTracks()[0];
      this.audioTrack = outStream.getAudioTracks()[0];
    } catch (e) {
      this.pipeline = null;
      this.videoTrack = rawStream.getVideoTracks()[0];
      this.audioTrack = rawStream.getAudioTracks()[0];
    }
    await room.localParticipant.publishTrack(this.videoTrack, { source: LivekitClient.Track.Source.Camera });
    await room.localParticipant.publishTrack(this.audioTrack, { source: LivekitClient.Track.Source.Microphone });
    if (previewEl) {
      previewEl.srcObject = new MediaStream([this.videoTrack]);
      previewEl.style.display = "block";
    }
  }

  setFilter(name) { this.effects.filter = name; }
  setAr(name) { this.effects.ar = name; }

  stop() {
    if (this.room) {
      try {
        if (this.videoTrack) this.room.localParticipant.unpublishTrack(this.videoTrack);
        if (this.audioTrack) this.room.localParticipant.unpublishTrack(this.audioTrack);
      } catch (e) { /* room may already be disconnected */ }
    }
    if (this.pipeline) this.pipeline.stop();
    else {
      if (this.videoTrack) this.videoTrack.stop();
      if (this.audioTrack) this.audioTrack.stop();
    }
    this.pipeline = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.room = null;
  }
}

function resetEffectsUI() {
  document.querySelectorAll("#filterPresetRow .effect-chip").forEach((b) => b.classList.toggle("active", b.dataset.filter === "none"));
  document.querySelectorAll("#arPresetRow .effect-chip").forEach((b) => b.classList.toggle("active", b.dataset.ar === "none"));
}

document.querySelectorAll("#filterPresetRow .effect-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#filterPresetRow .effect-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (liveMediaCtrl) liveMediaCtrl.setFilter(btn.dataset.filter);
  });
});
document.querySelectorAll("#arPresetRow .effect-chip").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const name = btn.dataset.ar;
    if (name !== "none") {
      try {
        await ensureFaceModelsLoaded();
      } catch (e) {
        toast("Couldn't load face effects");
        return;
      }
    }
    document.querySelectorAll("#arPresetRow .effect-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (liveMediaCtrl) liveMediaCtrl.setAr(name);
  });
});

function setupLiveRoomListeners(room, isHost) {
  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
    if (track.kind === "audio") {
      track.attach();
      return;
    }
    if (track.kind !== "video") return;
    if (isHost) {
      if (participant.identity !== approvedGuestIdentity) return;
      const video = document.getElementById("hostGuestVideo");
      track.attach(video);
      video.style.display = "block";
      video.classList.add("split-right");
      document.getElementById("hostCamPreview").classList.add("split-left");
      document.getElementById("removeGuestBtn").style.display = "block";
      return;
    }
    const video = document.getElementById("guestHostVideo");
    track.attach(video);
    video.style.display = "block";
    document.getElementById("liveGuestBg").style.display = "none";
  });
  room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
    if (track.kind === "audio") {
      track.detach().forEach((el) => el.remove());
      return;
    }
    if (track.kind !== "video" || !isHost) return;
    if (participant.identity !== approvedGuestIdentity) return;
    approvedGuestIdentity = null;
    const video = document.getElementById("hostGuestVideo");
    video.style.display = "none";
    video.classList.remove("split-right");
    document.getElementById("hostCamPreview").classList.remove("split-left");
    document.getElementById("removeGuestBtn").style.display = "none";
  });
  room.on(LivekitClient.RoomEvent.DataReceived, (payload, participant) => {
    let msg;
    try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    if (msg.senderId && blockedIds.has(msg.senderId)) return;
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
    } else if (msg.type === "join_request" && isHost) {
      if (approvedGuestIdentity) {
        room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify({ type: "join_reject", reason: "occupied" })),
          { reliable: true, destinationIdentities: [participant.identity] }
        );
        return;
      }
      pendingJoinRequestIdentity = participant.identity;
      document.getElementById("joinRequestText").textContent = `${msg.name || "Someone"} wants to join`;
      document.getElementById("joinRequestBanner").style.display = "flex";
    } else if (msg.type === "join_accept" && !isHost) {
      enableGuestPublishing();
    } else if (msg.type === "join_reject" && !isHost) {
      toast("Host declined your request to join");
      resetJoinGuestBtn();
    } else if (msg.type === "kick_guest" && !isHost) {
      disableGuestPublishing();
      toast("You were removed from the live");
    }
  });
}

function resetJoinGuestBtn() {
  const btn = document.getElementById("joinGuestBtn");
  btn.classList.remove("joined", "pending");
  btn.textContent = "Join";
}

async function enableGuestPublishing() {
  const btn = document.getElementById("joinGuestBtn");
  const pip = document.getElementById("guestCamPip");
  const hostVideo = document.getElementById("guestHostVideo");
  try {
    resetEffectsUI();
    liveMediaCtrl = new LiveMediaController();
    await liveMediaCtrl.publish(currentLiveRoom, pip);
    pip.classList.add("split-right");
    hostVideo.classList.add("split-left");
    btn.classList.remove("pending");
    btn.classList.add("joined");
    btn.textContent = "Leave";
    document.getElementById("guestEffectsBtn").style.display = "flex";
    addLiveChatMessage("guestChatFeed", "You", "joined as a guest!", false);
  } catch (e) {
    toast("Camera access denied");
    resetJoinGuestBtn();
  }
}

async function disableGuestPublishing() {
  const pip = document.getElementById("guestCamPip");
  const hostVideo = document.getElementById("guestHostVideo");
  if (liveMediaCtrl) { liveMediaCtrl.stop(); liveMediaCtrl = null; }
  pip.style.display = "none";
  pip.classList.remove("split-right");
  hostVideo.classList.remove("split-left");
  document.getElementById("guestEffectsBtn").style.display = "none";
  resetJoinGuestBtn();
}

async function openLiveHost() {
  if (!currentUser) { toast("Sign in to go live"); openAuthModal("signin"); return; }
  switchView("live-host");
  document.getElementById("hostChatFeed").innerHTML = "";
  hostSessionEarned = 0;
  document.getElementById("hostEarnedCoins").textContent = "0";
  document.getElementById("hostViewerCount").textContent = "1";
  giftTargetStage = "liveHostStage";
  approvedGuestIdentity = null;
  pendingJoinRequestIdentity = null;
  document.getElementById("joinRequestBanner").style.display = "none";
  document.getElementById("removeGuestBtn").style.display = "none";
  const hostGuestVideo = document.getElementById("hostGuestVideo");
  hostGuestVideo.style.display = "none";
  hostGuestVideo.classList.remove("split-right");
  document.getElementById("hostCamPreview").classList.remove("split-left");

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
  resetEffectsUI();

  try {
    const { token, url } = await getLiveKitToken(roomName);
    const room = new LivekitClient.Room();
    setupLiveRoomListeners(room, true);
    await room.connect(url, token);
    currentLiveRoom = room;
    liveMediaCtrl = new LiveMediaController();
    await liveMediaCtrl.publish(room, video);
    fallback.style.display = "none";
  } catch (e) {
    toast("Camera/mic access needed to go live");
    video.style.display = "none";
    fallback.style.display = "block";
  }

  joinPresence(roomName, "hostViewerCount");
}

async function closeLiveHost() {
  leavePresence();
  if (liveMediaCtrl) { liveMediaCtrl.stop(); liveMediaCtrl = null; }
  if (currentLiveRoom) { currentLiveRoom.disconnect(); currentLiveRoom = null; }
  if (currentLiveRoomName && currentUser) {
    await supabaseClient.from("live_sessions").update({ ended_at: new Date().toISOString() }).eq("room_name", currentLiveRoomName).eq("host_id", currentUser.id);
  }
  const earned = hostSessionEarned;
  currentLiveRoomName = null;
  currentLiveHostId = null;
  approvedGuestIdentity = null;
  pendingJoinRequestIdentity = null;
  document.getElementById("joinRequestBanner").style.display = "none";
  document.getElementById("removeGuestBtn").style.display = "none";
  switchView("mine");
  renderMine();
  toast(earned > 0 ? `Live ended — ${earned} coins earned` : "Live ended");
}
document.getElementById("hostExitBtn").addEventListener("click", closeLiveHost);
document.getElementById("endLiveBtn").addEventListener("click", closeLiveHost);

document.getElementById("joinAcceptBtn").addEventListener("click", () => {
  if (!pendingJoinRequestIdentity || !currentLiveRoom) return;
  approvedGuestIdentity = pendingJoinRequestIdentity;
  pendingJoinRequestIdentity = null;
  document.getElementById("joinRequestBanner").style.display = "none";
  currentLiveRoom.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({ type: "join_accept" })),
    { reliable: true, destinationIdentities: [approvedGuestIdentity] }
  );
});

document.getElementById("joinDeclineBtn").addEventListener("click", () => {
  if (!pendingJoinRequestIdentity || !currentLiveRoom) return;
  const identity = pendingJoinRequestIdentity;
  pendingJoinRequestIdentity = null;
  document.getElementById("joinRequestBanner").style.display = "none";
  currentLiveRoom.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({ type: "join_reject" })),
    { reliable: true, destinationIdentities: [identity] }
  );
});

document.getElementById("removeGuestBtn").addEventListener("click", () => {
  if (!approvedGuestIdentity || !currentLiveRoom) return;
  currentLiveRoom.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({ type: "kick_guest" })),
    { reliable: true, destinationIdentities: [approvedGuestIdentity] }
  );
});

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
  const guestHostVideo = document.getElementById("guestHostVideo");
  guestHostVideo.style.display = "none";
  guestHostVideo.classList.remove("split-left");
  document.getElementById("guestViewerCount").textContent = "1";

  resetJoinGuestBtn();
  const pip = document.getElementById("guestCamPip");
  pip.style.display = "none";
  pip.classList.remove("split-right");
  document.getElementById("guestEffectsBtn").style.display = "none";

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
  if (liveMediaCtrl) { liveMediaCtrl.stop(); liveMediaCtrl = null; }
  if (currentLiveRoom) { currentLiveRoom.disconnect(); currentLiveRoom = null; }
  currentLiveRoomName = null;
  currentLiveHostId = null;
  resetJoinGuestBtn();
  document.getElementById("guestCamPip").classList.remove("split-right");
  document.getElementById("guestHostVideo").classList.remove("split-left");
  document.getElementById("guestEffectsBtn").style.display = "none";
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
  if (!currentLiveRoom) return;
  if (btn.classList.contains("joined")) {
    await disableGuestPublishing();
    return;
  }
  if (btn.classList.contains("pending")) return;
  btn.classList.add("pending");
  btn.textContent = "Requested...";
  const name = currentProfile?.username || "Someone";
  currentLiveRoom.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({ type: "join_request", name })),
    { reliable: true, destinationIdentities: currentLiveHostId ? [currentLiveHostId] : undefined }
  );
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
    const payload = new TextEncoder().encode(JSON.stringify({ type: "chat", senderId: currentUser?.id, name, text }));
    currentLiveRoom.localParticipant.publishData(payload, { reliable: true });
  }
  input.value = "";
});

/* ---------------- Init ---------------- */
function init() {
  loadState();
  updateCoinDisplays();
  renderFeed();
  renderHomeDashboard();
  renderForYouFeed();
  switchView("foryou");
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
      if (event === "PASSWORD_RECOVERY") {
        document.getElementById("newPasswordInput").value = "";
        document.getElementById("resetPasswordError").style.display = "none";
        openModal("resetPasswordModal");
        return;
      }
      if (session?.user) handleSignedIn(session.user);
      else handleSignedOut();
    });
    fetchLiveSessions();
    subscribeLiveSessionsRealtime();
    fetchRealDramas().then(handleSharedLinkHash);
  }
}

function handleSharedLinkHash() {
  const match = location.hash.match(/^#drama\/(.+)$/);
  if (!match) return;
  const drama = DRAMAS.find((d) => d.id === match[1]);
  if (drama) openDetail(drama.id);
}
init();
