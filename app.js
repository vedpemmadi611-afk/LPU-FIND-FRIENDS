const categories = {
  friends: "Friends",
  hackathon: "Hackathon partner",
  roommate: "Room partner",
  gaming: "Gaming teammate",
  relationship: "Relationship talk",
  projects: "Project teammate"
};
const $ = id => document.getElementById(id);
const cards = [...document.querySelectorAll(".category-card")];
let socket = null;
let connected = false;
let matched = false;
let activeCategory = null;

function setStatus(value) { $("chat-status").textContent = value; }
function setNotice(value) { $("notice").textContent = value; }
function enableChat(value) {
  $("message-input").disabled = !value;
  $("send-btn").disabled = !value;
  $("leave-btn").disabled = !value;
  $("report-btn").disabled = !value;
  $("message-input").placeholder = value ? "Write a message…" : "Connect to a partner to send a message…";
}
function emptyState(title, subtitle) {
  $("messages").replaceChildren();
  const wrap = document.createElement("div"); wrap.className = "empty-state";
  const icon = document.createElement("span"); icon.textContent = "✧";
  const strong = document.createElement("strong"); strong.textContent = title;
  const p = document.createElement("p"); p.textContent = subtitle;
  wrap.append(icon, strong, p); $("messages").append(wrap);
}
function addBubble(text, mine, at) {
  const empty = $("messages").querySelector(".empty-state");
  if (empty) empty.remove();
  const bubble = document.createElement("div");
  bubble.className = "bubble" + (mine ? " mine" : "");
  const body = document.createElement("div"); body.textContent = text;
  const time = document.createElement("span"); time.className = "time";
  time.textContent = new Date(at || Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  bubble.append(body, time); $("messages").append(bubble);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function send(data) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}
function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener("open", () => {
    connected = true;
    setStatus("Ready to connect");
    setNotice("Choose a category to find a partner. Messages are temporary and kept in server memory only.");
  });
  socket.addEventListener("message", event => {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    switch (data.type) {
      case "ready":
        setStatus("Ready to connect"); setNotice(data.message); break;
      case "searching":
        matched = false; enableChat(false); setStatus("Searching…");
        setNotice(data.message); emptyState("Looking for a partner…", "Keep this page open while we match you."); break;
      case "matched":
        matched = true; setStatus("Connected · partner matched"); setNotice(data.message);
        enableChat(true); emptyState("Say hello 👋", "A friendly first message can start a great conversation."); break;
      case "chat": addBubble(data.text, data.mine, data.at); break;
      case "left":
      case "partner-left":
      case "queue-timeout":
      case "reported":
        matched = false; enableChat(false); setStatus("Not connected"); setNotice(data.message);
        cards.forEach(c => c.classList.remove("selected"));
        emptyState("Your conversation starts here", "Choose a category and get connected."); break;
      case "error": setNotice(data.message); break;
    }
  });
  socket.addEventListener("close", () => {
    connected = false; matched = false; enableChat(false); setStatus("Disconnected");
    setNotice("Connection lost. Refresh the page to reconnect.");
  });
  socket.addEventListener("error", () => setNotice("Could not connect to the server. Is Node.js running?"));
}
function chooseCategory(category) {
  if (!connected) { setNotice("The server is not connected yet. Please wait or refresh."); return; }
  activeCategory = category;
  cards.forEach(c => c.classList.toggle("selected", c.dataset.category === category));
  $("chat-title").textContent = categories[category];
  enableChat(false);
  matched = false;
  emptyState("Looking for a partner…", "Keep this page open while we match you.");
  send({type:"join", category});
}
cards.forEach(card => card.addEventListener("click", () => chooseCategory(card.dataset.category)));
$("chat-form").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("message-input").value.trim();
  if (!text || !matched || text.length > 500) return;
  send({type:"chat", text});
  $("message-input").value = "";
});
$("leave-btn").addEventListener("click", () => {
  send({type:"leave"});
  matched = false; enableChat(false);
});
$("report-btn").addEventListener("click", () => {
  if (!matched) return;
  if (confirm("Leave this chat? This demo does not send reports to a moderation team.")) send({type:"report"});
});
connect();
